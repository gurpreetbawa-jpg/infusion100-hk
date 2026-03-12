const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const db = require('../db');

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const result = await db.query('SELECT * FROM participants WHERE id = $1', [id]);
    const user = result.rows[0] || null;
    if (user && ADMIN_EMAILS.includes(user.email.toLowerCase()) && user.role !== 'admin') {
      await db.query('UPDATE participants SET role = $1 WHERE id = $2', ['admin', user.id]);
      user.role = 'admin';
    }
    done(null, user);
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

      const role = ADMIN_EMAILS.includes(email.toLowerCase()) ? 'admin' : 'participant';
      const result = await db.query(
        `INSERT INTO participants (oauth_provider, oauth_id, email, full_name, avatar_url, role)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        ['google', profile.id, email, profile.displayName, profile.photos?.[0]?.value, role]
      );
      done(null, result.rows[0]);
    } catch (err) {
      done(err, null);
    }
  }));
}

// GitHub OAuth Strategy
if (process.env.GITHUB_CLIENT_ID) {
  passport.use(new GitHubStrategy({
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: process.env.GITHUB_CALLBACK_URL,
    scope: ['user:email'],
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value || `${profile.username}@github`;
      const existing = await db.query(
        'SELECT * FROM participants WHERE oauth_provider = $1 AND oauth_id = $2',
        ['github', profile.id]
      );

      if (existing.rows.length > 0) {
        return done(null, existing.rows[0]);
      }

      const emailCheck = await db.query('SELECT * FROM participants WHERE email = $1', [email]);
      if (emailCheck.rows.length > 0) {
        const updated = await db.query(
          'UPDATE participants SET oauth_provider = $1, oauth_id = $2, avatar_url = $3 WHERE email = $4 RETURNING *',
          ['github', profile.id, profile.photos?.[0]?.value, email]
        );
        return done(null, updated.rows[0]);
      }

      const role = ADMIN_EMAILS.includes(email.toLowerCase()) ? 'admin' : 'participant';
      const result = await db.query(
        `INSERT INTO participants (oauth_provider, oauth_id, email, full_name, avatar_url, role)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        ['github', profile.id, email, profile.displayName || profile.username, profile.photos?.[0]?.value, role]
      );
      done(null, result.rows[0]);
    } catch (err) {
      done(err, null);
    }
  }));
}

// Facebook OAuth Strategy
if (process.env.FACEBOOK_APP_ID) {
  passport.use(new FacebookStrategy({
    clientID: process.env.FACEBOOK_APP_ID,
    clientSecret: process.env.FACEBOOK_APP_SECRET,
    callbackURL: process.env.FACEBOOK_CALLBACK_URL,
    profileFields: ['id', 'displayName', 'emails', 'photos'],
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value || `${profile.id}@facebook`;
      const existing = await db.query(
        'SELECT * FROM participants WHERE oauth_provider = $1 AND oauth_id = $2',
        ['facebook', profile.id]
      );

      if (existing.rows.length > 0) {
        return done(null, existing.rows[0]);
      }

      const emailCheck = await db.query('SELECT * FROM participants WHERE email = $1', [email]);
      if (emailCheck.rows.length > 0) {
        const updated = await db.query(
          'UPDATE participants SET oauth_provider = $1, oauth_id = $2, avatar_url = $3 WHERE email = $4 RETURNING *',
          ['facebook', profile.id, profile.photos?.[0]?.value, email]
        );
        return done(null, updated.rows[0]);
      }

      const role = ADMIN_EMAILS.includes(email.toLowerCase()) ? 'admin' : 'participant';
      const result = await db.query(
        `INSERT INTO participants (oauth_provider, oauth_id, email, full_name, avatar_url, role)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        ['facebook', profile.id, email, profile.displayName, profile.photos?.[0]?.value, role]
      );
      done(null, result.rows[0]);
    } catch (err) {
      done(err, null);
    }
  }));
}

module.exports = passport;
module.exports.ADMIN_EMAILS = ADMIN_EMAILS;
