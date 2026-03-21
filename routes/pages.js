const express = require('express');
const path = require('path');
const { isAuthenticated, isAdmin, isProfileComplete } = require('../middleware/auth');
const features = require('../config/feature-toggles');
const router = express.Router();

const sendPage = (page) => (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', page));
};

// Requires admin when a feature toggle is off, otherwise falls back to given middleware
function gated(toggle, ...fallback) {
  return features[toggle] ? fallback : [isAdmin];
}

// Public pages
router.get('/', sendPage('index.html'));
router.get('/login', sendPage('login.html'));
router.get('/leaderboard', ...gated('EVENT_DAY_TRACKING'), sendPage('leaderboard.html'));
router.get('/privacy', sendPage('privacy.html'));
router.get('/data-deletion', sendPage('data-deletion.html'));

// Auth-required pages
router.get('/register', isAuthenticated, sendPage('register.html'));
router.get('/dashboard', isAuthenticated, isProfileComplete, sendPage('dashboard.html'));
router.get('/walk/log', isAuthenticated, isProfileComplete, sendPage('log-walk.html'));
router.get('/walk/:id', sendPage('walk-detail.html'));
router.get('/community', sendPage('community.html'));
router.get('/stats', (req, res) => res.redirect('/dashboard'));
router.get('/walkers', isAuthenticated, isProfileComplete, sendPage('walkers.html'));
router.get('/event', ...gated('EVENT_DAY_TRACKING', isAuthenticated, isProfileComplete), sendPage('event.html'));

router.get('/practice-walk/:id', isAuthenticated, isProfileComplete, sendPage('practice-walk.html'));

// Admin pages
router.get('/admin', isAdmin, sendPage('admin.html'));
router.get('/admin/participants', isAdmin, sendPage('admin-participants.html'));
router.get('/admin/practice-walks', isAdmin, sendPage('admin-practice-walks.html'));
router.get('/admin/map', isAdmin, sendPage('admin-map.html'));

module.exports = router;
