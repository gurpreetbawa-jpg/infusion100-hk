/**
 * GpsTracker — shared GPS tracking module for event day and practice walks.
 *
 * Handles: GPS watch lifecycle, ping buffering + batch flush, sessionStorage
 * persistence, visibilitychange/pagehide handling, Wake Lock management.
 *
 * Usage:
 *   const tracker = new GpsTracker({ practiceWalkId, onPosition, onPingCount, onStatusChange, onAlert });
 *   await tracker.checkAndResume();
 */
window.GpsTracker = function(options) {
  var self = this;
  var opts = options || {};

  // State
  var watchId = null;
  var flushInterval = null;
  var wakeLock = null;
  var hiddenAt = null;
  var pingBuffer = [];
  var pingCount = 0;
  var isTracking = false;
  var paused = false;

  var FLUSH_INTERVAL_MS = 60000;
  var STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

  var storageKey = opts.practiceWalkId
    ? 'gpsTracking:' + opts.practiceWalkId : 'gpsTracking:event';

  // --- Public API ---

  self.start = async function() {
    if (!('geolocation' in navigator)) {
      notify('Geolocation is not supported by your browser.', 'danger');
      return false;
    }

    try {
      var pos = await new Promise(function(resolve, reject) {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true, timeout: 10000
        });
      });

      var body = opts.practiceWalkId
        ? JSON.stringify({ practice_walk_id: opts.practiceWalkId })
        : undefined;
      await App.fetchJSON('/api/tracking/start', { method: 'POST', body: body });

      isTracking = true;
      paused = false;
      pingCount = 0;
      pingBuffer = [];

      startGpsWatch();
      bufferLocation(pos);
      flushPings();
      await acquireWakeLock();
      saveState();
      fireStatus('tracking');
      return true;
    } catch (err) {
      var msg = 'Location access denied. Please enable location services and try again.';
      if (err.code === 2) msg = 'Location unavailable. Please check your GPS settings.';
      if (err.code === 3) msg = 'Location request timed out. Please try again.';
      notify(msg, 'danger');
      return false;
    }
  };

  self.stop = async function() {
    stopGpsWatch();
    await flushPings();
    releaseWakeLock();

    var body = opts.practiceWalkId
      ? JSON.stringify({ practice_walk_id: opts.practiceWalkId })
      : undefined;
    var result = await App.fetchJSON('/api/tracking/stop', { method: 'POST', body: body });

    isTracking = false;
    paused = false;
    pingCount = 0;
    pingBuffer = [];
    clearState();
    fireStatus('stopped');
    return result;
  };

  self.pause = async function() {
    stopGpsWatch();
    await flushPings();
    releaseWakeLock();
    paused = true;
    saveState();
    fireStatus('paused');
  };

  self.resume = async function() {
    paused = false;
    startGpsWatch();
    await acquireWakeLock();
    saveState();
    fireStatus('tracking');
  };

  self.checkAndResume = async function() {
    var saved = loadState();
    if (!saved || !saved.isTracking) return;

    // Verify server session is still active
    try {
      var url = '/api/tracking/status';
      if (opts.practiceWalkId) url += '?practice_walk_id=' + opts.practiceWalkId;
      var status = await App.fetchJSON(url);

      if (!status.active) {
        clearState();
        return;
      }

      // Restore state
      isTracking = true;
      paused = saved.paused || false;
      pingCount = status.ping_count || saved.pingCount || 0;

      if (paused) {
        fireStatus('paused');
        firePingCount();
      } else {
        startGpsWatch();
        await acquireWakeLock();
        fireStatus('tracking');
        firePingCount();
      }
      saveState();
    } catch (err) {
      clearState();
    }
  };

  self.getPingCount = function() { return pingCount + pingBuffer.length; };
  self.isActive = function() { return isTracking; };
  self.isPaused = function() { return paused; };

  // --- Internal ---

  function startGpsWatch() {
    if (watchId !== null) stopGpsWatch();
    watchId = navigator.geolocation.watchPosition(
      bufferLocation,
      function(err) { console.warn('GPS error:', err.message); },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 }
    );
    flushInterval = setInterval(flushPings, FLUSH_INTERVAL_MS);
  }

  function stopGpsWatch() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if (flushInterval) {
      clearInterval(flushInterval);
      flushInterval = null;
    }
  }

  function bufferLocation(position) {
    var lat = position.coords.latitude;
    var lng = position.coords.longitude;
    pingBuffer.push({ lat: lat, lng: lng });
    firePingCount();
    if (opts.onPosition) opts.onPosition(lat, lng);
  }

  async function flushPings() {
    if (pingBuffer.length === 0) return;
    var pings = pingBuffer.splice(0);
    try {
      var body = { pings: pings };
      if (opts.practiceWalkId) body.practice_walk_id = opts.practiceWalkId;
      await App.fetchJSON('/api/location/batch', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      pingCount += pings.length;
      firePingCount();
      saveState();
    } catch (e) {
      pingBuffer.unshift.apply(pingBuffer, pings);
    }
  }

  function flushViaBeacon() {
    if (pingBuffer.length === 0) return;
    var pings = pingBuffer.splice(0);
    var body = { pings: pings };
    if (opts.practiceWalkId) body.practice_walk_id = opts.practiceWalkId;
    navigator.sendBeacon(
      '/api/location/batch',
      new Blob([JSON.stringify(body)], { type: 'application/json' })
    );
    pingCount += pings.length;
    saveState();
  }

  // --- Wake Lock ---

  var wakeLockTipShown = false;

  async function acquireWakeLock() {
    if (!('wakeLock' in navigator)) {
      if (!wakeLockTipShown) {
        wakeLockTipShown = true;
        notify('Tip: Keep your screen on manually for reliable tracking.', 'info');
      }
      return;
    }
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', function() { wakeLock = null; });
    } catch (e) {
      // Wake Lock request failed (e.g., low battery)
    }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(function() {});
      wakeLock = null;
    }
  }

  // --- Persistence ---

  function saveState() {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({
        isTracking: isTracking,
        paused: paused,
        pingCount: pingCount,
        practiceWalkId: opts.practiceWalkId || null,
      }));
    } catch (e) {}
  }

  function loadState() {
    try {
      var raw = sessionStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function clearState() {
    try { sessionStorage.removeItem(storageKey); } catch (e) {}
  }

  // --- Visibility / Lifecycle ---

  function onVisibilityChange() {
    if (!isTracking) return;

    if (document.hidden) {
      hiddenAt = Date.now();
      flushPings();
    } else {
      // Page became visible again
      var wasGoneLong = hiddenAt && (Date.now() - hiddenAt > STALE_THRESHOLD_MS);
      hiddenAt = null;

      if (paused) return;

      // Restart GPS watch (old one may be stale after background)
      stopGpsWatch();
      startGpsWatch();
      acquireWakeLock();
      flushPings();

      // If backgrounded > 5 min, verify session still active
      if (wasGoneLong) {
        var url = '/api/tracking/status';
        if (opts.practiceWalkId) url += '?practice_walk_id=' + opts.practiceWalkId;
        App.fetchJSON(url).then(function(status) {
          if (!status.active) {
            stopGpsWatch();
            releaseWakeLock();
            isTracking = false;
            paused = false;
            clearState();
            fireStatus('stopped');
          }
        }).catch(function() {});
      }
    }
  }

  function onPageHide() {
    if (!isTracking || paused) return;
    flushViaBeacon();
  }

  // --- Callbacks ---

  function notify(msg, type) {
    if (opts.onAlert) opts.onAlert(msg, type);
  }

  function firePingCount() {
    if (opts.onPingCount) opts.onPingCount(pingCount + pingBuffer.length);
  }

  function fireStatus(status) {
    if (opts.onStatusChange) opts.onStatusChange(status);
  }

  // --- Register listeners ---
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
};
