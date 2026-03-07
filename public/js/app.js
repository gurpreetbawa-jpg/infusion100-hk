// Shared utilities
const App = {
  user: null,

  async fetchJSON(url, options = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    if (res.status === 401) {
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Request failed');
    }
    return res.json();
  },

  async loadUser() {
    try {
      this.user = await this.fetchJSON('/api/me');
    } catch {
      this.user = null;
    }
    this.buildNav();
    return this.user;
  },

  formatDistance(km, unit = 'km') {
    if (unit === 'miles') return (km * 0.621371).toFixed(1) + ' mi';
    return parseFloat(km).toFixed(1) + ' km';
  },

  formatDuration(mins) {
    if (!mins) return '--';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  },

  formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric'
    });
  },

  formatRelative(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return App.formatDate(dateStr);
  },

  getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  },

  renderAvatar(user, size = '') {
    const cls = 'avatar' + (size ? ` avatar-${size}` : '');
    if (user.avatar_url) {
      return `<img class="${cls}" src="${App.escapeHtml(user.avatar_url)}" alt="${App.escapeHtml(user.full_name || '')}" />`;
    }
    return `<div class="${cls}">${App.escapeHtml(App.getInitials(user.full_name))}</div>`;
  },

  showAlert(container, message, type = 'info') {
    const el = document.createElement('div');
    el.className = `alert alert-${type}`;
    el.textContent = message;
    container.prepend(el);
    setTimeout(() => el.remove(), 5000);
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};

// Dynamic nav — builds links based on auth state
App.buildNav = function () {
  const nav = document.getElementById('navLinks');
  if (!nav) return;

  const path = window.location.pathname;
  const loggedIn = !!this.user;

  const links = loggedIn
    ? [
        ['/dashboard', 'Dashboard'],
        ['/community', 'Community'],
        ['/stats', 'My Stats'],
        ['/leaderboard', 'Live Map'],
        ['/auth/logout', 'Log Out'],
      ]
    : [
        ['/community', 'Community'],
        ['/leaderboard', 'Live Map'],
        ['/login', 'Log In'],
      ];

  nav.innerHTML = links
    .map(([href, label]) => {
      const active = path === href ? ' class="active"' : '';
      return `<li><a href="${href}"${active}>${label}</a></li>`;
    })
    .join('');
};

// Service worker registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

// iOS "Add to Home Screen" install banner
(function () {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true;
  const dismissed = localStorage.getItem('iosInstallDismissed');

  if (isIOS && !isStandalone && !dismissed) {
    window.addEventListener('DOMContentLoaded', function () {
      const banner = document.createElement('div');
      banner.className = 'ios-install-banner';
      banner.innerHTML =
        '<img class="ios-install-banner-icon" src="/icons/icon-192.png" alt="Infusion100">' +
        '<div class="ios-install-banner-text">' +
          '<strong>Install Infusion100</strong>' +
          'Tap <svg class="ios-share-icon" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg">' +
          '<rect x="15" y="20" width="20" height="18" rx="3" stroke="currentColor" stroke-width="3" fill="none"/>' +
          '<line x1="25" y1="8" x2="25" y2="30" stroke="currentColor" stroke-width="3"/>' +
          '<polyline points="18,15 25,8 32,15" stroke="currentColor" stroke-width="3" fill="none"/>' +
          '</svg> then <strong style="display:inline">"Add to Home Screen"</strong>' +
        '</div>' +
        '<button class="ios-install-banner-close" aria-label="Dismiss">&times;</button>';

      banner.querySelector('.ios-install-banner-close').addEventListener('click', function () {
        banner.remove();
        localStorage.setItem('iosInstallDismissed', '1');
      });

      document.body.appendChild(banner);
    });
  }
})();

// Mobile nav toggle
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.navbar-toggle');
  const links = document.querySelector('.navbar-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => links.classList.toggle('open'));
    links.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') links.classList.remove('open');
    });
  }
});
