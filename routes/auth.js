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

// Apple OAuth
router.post('/apple', passport.authenticate('apple'));

router.post('/callback/apple', passport.authenticate('apple', {
  failureRedirect: '/login?error=apple_failed',
}), (req, res) => {
  console.log(`[AUTH] Apple login: ${req.user.email} (id:${req.user.id})`);
  if (!req.user.profile_complete) {
    return res.redirect('/register');
  }
  res.redirect('/dashboard');
});

// Strava OAuth (linking, not login)
router.get('/strava', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/login');
  const clientId = process.env.STRAVA_CLIENT_ID;
  const callbackUrl = process.env.STRAVA_CALLBACK_URL;
  const url = `https://www.strava.com/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=read,activity:read&approval_prompt=auto`;
  res.redirect(url);
});

router.get('/callback/strava', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/login');
  const { code } = req.query;
  if (!code) return res.redirect('/dashboard?error=strava_denied');

  try {
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

    if (data.access_token) {
      const { encrypt } = require('../config/encryption');
      const db = require('../db');
      await db.query(
        `UPDATE participants SET strava_token = $1, strava_refresh_token = $2,
         strava_token_expires_at = $3, strava_athlete_id = $4 WHERE id = $5`,
        [encrypt(data.access_token), encrypt(data.refresh_token),
         data.expires_at, data.athlete.id, req.user.id]
      );
      console.log(`[AUTH] Strava linked: ${req.user.email} (athlete:${data.athlete.id})`);
      res.redirect('/dashboard?strava=connected');
    } else {
      res.redirect('/dashboard?error=strava_failed');
    }
  } catch (err) {
    console.error('Strava OAuth error:', err);
    res.redirect('/dashboard?error=strava_failed');
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
