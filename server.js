require('dotenv').config();
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { pool } = require('./db');
const passport = require('./config/passport');
const webpush = require('web-push');

// Fail fast if critical secrets are missing
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 16) {
  console.error('FATAL: SESSION_SECRET is missing or too short. Set it in your environment.');
  process.exit(1);
}
if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length < 16) {
  console.error('FATAL: ENCRYPTION_KEY is missing or too short. Set it in your environment.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Web Push
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:noreply@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  app.locals.webpush = webpush;
}

// Trust Render's reverse proxy for secure cookies
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Security
app.use(helmet({
  hsts: process.env.NODE_ENV === 'production',
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://*.tile.openstreetmap.org", "https://*.googleapis.com", "https://*.googleusercontent.com", "https://dgalywyr863hv.cloudfront.net"],
      connectSrc: ["'self'"],
      workerSrc: ["'self'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
}));
app.use(cors({ origin: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting for location endpoint
const locationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many requests' },
});

// Session
app.use(session({
  store: new PgSession({ pool, tableName: 'session' }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
  },
}));

// Passport
app.use(passport.initialize());
app.use(passport.session());

// Make user available to all responses
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  next();
});

// Request logging
app.use((req, res, next) => {
  // Skip static files and noisy endpoints
  if (req.path.match(/\.(css|js|ico|png|jpg|svg|woff2?)$/) || req.path === '/api/locations/live') {
    return next();
  }
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const user = req.user ? req.user.full_name || req.user.email : 'anonymous';
    const status = res.statusCode;
    const color = status >= 500 ? '\x1b[31m' : status >= 400 ? '\x1b[33m' : '\x1b[32m';
    console.log(`${color}${req.method} ${req.path} ${status}\x1b[0m ${ms}ms [${user}]`);
  });
  next();
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/auth', require('./routes/auth'));
app.post('/api/location', locationLimiter);
app.use('/api', require('./routes/api'));
app.use('/admin', require('./routes/admin'));
app.use('/', require('./routes/pages'));

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong' });
});

app.listen(PORT, async () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║         Infusion100 Server           ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
  console.log(`  URL:          http://localhost:${PORT}`);
  console.log(`  Environment:  ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Node:         ${process.version}`);
  console.log('');

  // Database check
  try {
    const dbResult = await pool.query('SELECT NOW() AS time, current_database() AS db');
    const row = dbResult.rows[0];
    console.log(`  Database:     ${row.db} (connected)`);
  } catch (err) {
    console.log(`  Database:     FAILED - ${err.message}`);
  }

  // Table check
  try {
    const tables = await pool.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `);
    console.log(`  Tables:       ${tables.rows.map(r => r.tablename).join(', ')}`);

    const pCount = await pool.query('SELECT COUNT(*) FROM participants');
    const bCount = await pool.query('SELECT COUNT(*) FROM bridges');
    const wCount = await pool.query('SELECT COUNT(*) FROM walks');
    console.log(`  Participants: ${pCount.rows[0].count}`);
    console.log(`  Bridges:      ${bCount.rows[0].count}`);
    console.log(`  Walks:        ${wCount.rows[0].count}`);
  } catch {}

  // OAuth config check
  console.log('');
  console.log('  OAuth:');
  console.log(`    Google:     ${process.env.GOOGLE_CLIENT_ID ? 'configured' : 'not configured'}`);
  console.log(`    GitHub:     ${process.env.GITHUB_CLIENT_ID ? 'configured' : 'not configured'}`);
  console.log(`    Strava:     ${process.env.STRAVA_CLIENT_ID ? 'configured' : 'not configured'}`);
  console.log('');
});
