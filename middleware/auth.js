function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  res.redirect('/login');
}

function isAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user.role === 'admin') return next();
  if (req.xhr || req.path.startsWith('/api/') || req.path.startsWith('/admin/api/')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  res.redirect('/');
}

function isProfileComplete(req, res, next) {
  if (req.isAuthenticated() && !req.user.profile_complete) {
    if (req.path !== '/register' && !req.path.startsWith('/api/me') && !req.path.startsWith('/auth/')) {
      return res.redirect('/register');
    }
  }
  next();
}

module.exports = { isAuthenticated, isAdmin, isProfileComplete };
