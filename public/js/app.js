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
      return `<img class="${cls}" src="${user.avatar_url}" alt="${user.full_name || ''}" />`;
    }
    return `<div class="${cls}">${App.getInitials(user.full_name)}</div>`;
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
