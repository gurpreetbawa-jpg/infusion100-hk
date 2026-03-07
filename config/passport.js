const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db = require('../db');

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const result = await db.query('SELECT * FROM participants WHERE id = $1', [id]);
    done(null, result.rows[0] || null);
  } catch (err) {
    done(err, null);
  }
});

// Google OAuth Strategy
if (process.env.GOOGLE_CLIENT_ID) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL,
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails[0].value;
      const existing = await db.query(
        'SELECT * FROM participants WHERE oauth_provider = $1 AND oauth_id = $2',
        ['google', profile.id]
      );

      if (existing.rows.length > 0) {
        return done(null, existing.rows[0]);
      }

      // Check if email already exists
      const emailCheck = await db.query('SELECT * FROM participants WHERE email = $1', [email]);
      if (emailCheck.rows.length > 0) {
        // Link the OAuth to existing account
        const updated = await db.query(
          'UPDATE participants SET oauth_provider = $1, oauth_id = $2, avatar_url = $3 WHERE email = $4 RETURNING *',
          ['google', profile.id, profile.photos?.[0]?.value, email]
        );
        return done(null, updated.rows[0]);
      }

      const result = await db.query(
        `INSERT INTO participants (oauth_provider, oauth_id, email, full_name, avatar_url)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        ['google', profile.id, email, profile.displayName, profile.photos?.[0]?.value]
      );
      done(null, result.rows[0]);
    } catch (err) {
      done(err, null);
    }
  }));
}

// Apple OAuth Strategy - configured when credentials are available
if (process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID) {
  try {
    const AppleStrategy = require('passport-apple');
    passport.use(new AppleStrategy({
      clientID: process.env.APPLE_CLIENT_ID,
      teamID: process.env.APPLE_TEAM_ID,
      keyID: process.env.APPLE_KEY_ID,
      privateKeyLocation: process.env.APPLE_PRIVATE_KEY_PATH,
      callbackURL: process.env.APPLE_CALLBACK_URL,
      passReqToCallback: true,
    }, async (req, accessToken, refreshToken, idToken, profile, done) => {
      try {
        const email = profile.email || idToken.email;
        const name = profile.name
          ? `${profile.name.firstName || ''} ${profile.name.lastName || ''}`.trim()
          : '';

        const existing = await db.query(
          'SELECT * FROM participants WHERE oauth_provider = $1 AND oauth_id = $2',
          ['apple', profile.id]
        );

        if (existing.rows.length > 0) {
          return done(null, existing.rows[0]);
        }

        const result = await db.query(
          `INSERT INTO participants (oauth_provider, oauth_id, email, full_name)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          ['apple', profile.id, email, name]
        );
        done(null, result.rows[0]);
      } catch (err) {
        done(err, null);
      }
    }));
  } catch (e) {
    console.log('Apple OAuth not configured:', e.message);
  }
}

module.exports = passport;
