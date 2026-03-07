const express = require('express');
const path = require('path');
const { isAuthenticated, isAdmin, isProfileComplete } = require('../middleware/auth');
const router = express.Router();

const sendPage = (page) => (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', page));
};

// Public pages
router.get('/', sendPage('index.html'));
router.get('/login', sendPage('login.html'));
router.get('/leaderboard', sendPage('leaderboard.html'));
router.get('/privacy', sendPage('privacy.html'));

// Auth-required pages
router.get('/register', isAuthenticated, sendPage('register.html'));
router.get('/dashboard', isAuthenticated, isProfileComplete, sendPage('dashboard.html'));
router.get('/walk/log', isAuthenticated, isProfileComplete, sendPage('log-walk.html'));
router.get('/walk/:id', sendPage('walk-detail.html'));
router.get('/community', sendPage('community.html'));
router.get('/stats', isAuthenticated, isProfileComplete, sendPage('stats.html'));
router.get('/event', isAuthenticated, isProfileComplete, sendPage('event.html'));

// Admin pages
router.get('/admin', isAdmin, sendPage('admin.html'));
router.get('/admin/participants', isAdmin, sendPage('admin-participants.html'));
router.get('/admin/map', isAdmin, sendPage('admin-map.html'));

module.exports = router;
