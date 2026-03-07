const express = require('express');
const passport = require('passport');
const router = express.Router();

// Google OAuth
router.get('/google', passport.authenticate('google', {
  scope: ['openid', 'email', 'profile'],
}));

router.get('/callback/google', passport.authenticate('google', {
  failureRedirect: '/login?error=google_failed',
}), (req, res) => {
  console.log(`[AUTH] Google login: ${req.user.email} (id:${req.user.id})`);
  if (!req.user.profile_complete) {
    return res.redirect('/register');
  }
  res.redirect('/dashboard');
});

// GitHub OAuth
router.get('/github', passport.authenticate('github', {
  scope: ['user:email'],
}));

router.get('/callback/github', passport.authenticate('github', {
  failureRedirect: '/login?error=github_failed',
}), (req, res) => {
  console.log(`[AUTH] GitHub login: ${req.user.email} (id:${req.user.id})`);
  if (!req.user.profile_complete) {
    return res.redirect('/register');
  }
  res.redirect('/dashboard');
});

// Strava OAuth (login + linking)
router.get('/strava', (req, res) => {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const callbackUrl = process.env.STRAVA_CALLBACK_URL;
  const scope = req.isAuthenticated() ? 'read,activity:read' : 'read,activity:read';
  const state = req.isAuthenticated() ? 'link' : 'login';
  const url = `https://www.strava.com/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${scope}&approval_prompt=auto&state=${state}`;
  res.redirect(url);
});

router.get('/callback/strava', async (req, res) => {
  const { code, state } = req.query;
  if (!code) {
    return res.redirect(req.isAuthenticated() ? '/dashboard?error=strava_denied' : '/login?error=strava_denied');
  }

  try {
    const { encrypt } = require('../config/encryption');
    const db = require('../db');

    const response = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
      }),
    });
    const data = await response.json();

    if (!data.access_token) {
      return res.redirect(req.isAuthenticated() ? '/dashboard?error=strava_failed' : '/login?error=strava_failed');
    }

    // Linking to existing account
    if (state === 'link' && req.isAuthenticated()) {
      await db.query(
        `UPDATE participants SET strava_token = $1, strava_refresh_token = $2,
         strava_token_expires_at = $3, strava_athlete_id = $4 WHERE id = $5`,
        [encrypt(data.access_token), encrypt(data.refresh_token),
         data.expires_at, data.athlete.id, req.user.id]
      );
      console.log(`[AUTH] Strava linked: ${req.user.email} (athlete:${data.athlete.id})`);
      return res.redirect('/dashboard?strava=connected');
    }

    // Login/signup via Strava
    const athlete = data.athlete;
    const email = athlete.email || `${athlete.id}@strava`;

    let existing = await db.query(
      'SELECT * FROM participants WHERE oauth_provider = $1 AND oauth_id = $2',
      ['strava', String(athlete.id)]
    );

    if (existing.rows.length === 0) {
      const emailCheck = await db.query('SELECT * FROM participants WHERE email = $1', [email]);
      if (emailCheck.rows.length > 0) {
        existing = await db.query(
          `UPDATE participants SET oauth_provider = 'strava', oauth_id = $1, avatar_url = $2,
           strava_token = $3, strava_refresh_token = $4, strava_token_expires_at = $5, strava_athlete_id = $6
           WHERE email = $7 RETURNING *`,
          [String(athlete.id), athlete.profile, encrypt(data.access_token), encrypt(data.refresh_token),
           data.expires_at, athlete.id, email]
        );
      } else {
        const { ADMIN_EMAILS } = require('../config/passport');
        const role = ADMIN_EMAILS.includes(email.toLowerCase()) ? 'admin' : 'participant';
        existing = await db.query(
          `INSERT INTO participants (oauth_provider, oauth_id, email, full_name, avatar_url,
           strava_token, strava_refresh_token, strava_token_expires_at, strava_athlete_id, role)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
          ['strava', String(athlete.id), email,
           `${athlete.firstname || ''} ${athlete.lastname || ''}`.trim(),
           athlete.profile, encrypt(data.access_token), encrypt(data.refresh_token),
           data.expires_at, athlete.id, role]
        );
      }
    } else {
      await db.query(
        `UPDATE participants SET strava_token = $1, strava_refresh_token = $2,
         strava_token_expires_at = $3 WHERE id = $4`,
        [encrypt(data.access_token), encrypt(data.refresh_token),
         data.expires_at, existing.rows[0].id]
      );
    }

    const user = existing.rows[0];
    console.log(`[AUTH] Strava login: ${user.email} (id:${user.id})`);

    req.login(user, (err) => {
      if (err) return res.redirect('/login?error=strava_failed');
      if (!user.profile_complete) return res.redirect('/register');
      res.redirect('/dashboard');
    });
  } catch (err) {
    console.error('Strava OAuth error:', err);
    res.redirect(req.isAuthenticated() ? '/dashboard?error=strava_failed' : '/login?error=strava_failed');
  }
});

// Logout
router.get('/logout', (req, res) => {
  console.log(`[AUTH] Logout: ${req.user?.email || 'unknown'}`);
  req.logout(() => {
    req.session.destroy(() => {
      res.redirect('/');
    });
  });
});

router.delete('/logout', (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });
});

module.exports = router;
