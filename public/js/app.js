// Shared utilities
const App = {
  user: null,
  features: {},

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
      const [user, features] = await Promise.all([
        this.fetchJSON('/api/me').catch(() => null),
        this.fetchJSON('/api/features').catch(() => ({})),
      ]);
      this.user = user;
      this.features = features;
    } catch {
      this.user = null;
    }
    this.buildNav();
    if (App._splashEl) {
      App._splashEl.classList.add('splash-hide');
      setTimeout(() => { if (App._splashEl) { App._splashEl.remove(); App._splashEl = null; } }, 300);
    }
    if (typeof showIOSInstallBanner === 'function') showIOSInstallBanner();
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

  formatDateTime(dateStr) {
    const d = new Date(dateStr);
    const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const h = d.getHours(), m = d.getMinutes();
    if (h === 0 && m === 0) return date;
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `${date} at ${time}`;
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

  localDateStr(date) {
    const d = date || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  localTimeStr(date) {
    const d = date || new Date();
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  },

  appendTzOffset(dateTimeStr) {
    const offset = new Date().getTimezoneOffset();
    const sign = offset <= 0 ? '+' : '-';
    const abs = Math.abs(offset);
    const h = String(Math.floor(abs / 60)).padStart(2, '0');
    const m = String(abs % 60).padStart(2, '0');
    return `${dateTimeStr}${sign}${h}:${m}`;
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

  renderMentions(text, mentions) {
    if (!mentions || !mentions.length) return text;
    mentions.forEach(m => {
      const escaped = App.escapeHtml(m.name);
      text = text.replace('@' + escaped, `<a href="/community?walker=${m.id}" class="mention">@${escaped}</a>`);
    });
    return text;
  },
};

// Push notification subscription
App.initPush = async function () {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  try {
    const { publicKey } = await this.fetchJSON('/api/push/vapid-key');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      // Hide banner if denied — no point showing it again
      if (permission === 'denied') App.updatePushUI(true);
      return;
    }

    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    await this.fetchJSON('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(sub.toJSON()),
    });

    App.updatePushUI(true);
    const alertBox = document.getElementById('alertBox');
    if (alertBox) App.showAlert(alertBox, 'Push notifications enabled!', 'success');
  } catch (err) {
    console.error('Push subscription failed:', err);
  }
};

App.disablePush = async function () {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await this.fetchJSON('/api/push/unsubscribe', {
        method: 'DELETE',
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
    App.updatePushUI(false);
  } catch (err) {
    console.error('Push unsubscribe failed:', err);
  }
};

App.updatePushUI = function (subscribed) {
  const banner = document.getElementById('pushBanner');
  if (!banner) return;
  banner.style.display = subscribed ? 'none' : '';
};

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Dynamic nav — builds links based on auth state
App.buildNav = function () {
  const nav = document.getElementById('navLinks');
  if (!nav) return;

  const path = window.location.pathname;
  const loggedIn = !!this.user;

  const isAdmin = loggedIn && this.user.role === 'admin';
  const links = loggedIn
    ? [
        ['/dashboard', 'Dashboard'],
        ['/community', 'Community'],
        ['/walkers', 'Walkers'],

        ...(this.features.eventDayTracking ? [['/leaderboard', 'Live Map']] : []),
        ...(isAdmin ? [['/admin', 'Admin']] : []),
        ['/auth/logout', 'Log Out'],
      ]
    : [
        ['/community', 'Community'],
        ...(this.features.eventDayTracking ? [['/leaderboard', 'Live Map']] : []),
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

// PWA splash screen — only in standalone mode
(function () {
  var isStandalone = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  if (!isStandalone) return;
  var splash = document.createElement('div');
  splash.className = 'pwa-splash';
  splash.innerHTML = '<div class="pwa-splash-brand">Infusion<strong>100</strong></div><div class="spinner"></div>';
  document.body.appendChild(splash);
  App._splashEl = splash;
  setTimeout(function () {
    if (App._splashEl) { App._splashEl.classList.add('splash-hide'); setTimeout(function () { if (App._splashEl) { App._splashEl.remove(); App._splashEl = null; } }, 300); }
  }, 5000);
})();

// iOS "Add to Home Screen" install banner — call after App.loadUser()
function showIOSInstallBanner() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true;
  const dismissed = localStorage.getItem('iosInstallDismissed');

  if (!isIOS || isStandalone || dismissed || !App.user) return;

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
}

// Offline indicator
(function () {
  var bar = document.createElement('div');
  bar.className = 'offline-bar';
  bar.textContent = 'You are offline';
  var navbar = document.querySelector('.navbar');
  if (navbar && navbar.nextSibling) {
    navbar.parentNode.insertBefore(bar, navbar.nextSibling);
  } else if (navbar) {
    navbar.parentNode.appendChild(bar);
  } else {
    document.body.prepend(bar);
  }
  function update() { bar.classList.toggle('visible', !navigator.onLine); }
  update();
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
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
