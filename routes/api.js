const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const db = require('../db');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const { decrypt, encrypt } = require('../config/encryption');
const features = require('../config/feature-toggles');
const router = express.Router();

function gated(toggle, ...fallback) {
  return features[toggle] ? fallback : [isAdmin];
}

// --- Geo Utilities ---
function haversineDistance(points) {
  const R = 6371;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dLat = (points[i].lat - points[i - 1].lat) * Math.PI / 180;
    const dLng = (points[i].lng - points[i - 1].lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(points[i - 1].lat * Math.PI / 180) * Math.cos(points[i].lat * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    total += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return total;
}

function encodePolyline(points) {
  let encoded = '';
  let prevLat = 0, prevLng = 0;
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    encoded += encodeSignedValue(lat - prevLat);
    encoded += encodeSignedValue(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return encoded;
}

function encodeSignedValue(val) {
  let v = val < 0 ? ~(val << 1) : val << 1;
  let encoded = '';
  while (v >= 0x20) {
    encoded += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  encoded += String.fromCharCode(v + 63);
  return encoded;
}

async function verifyPracticeParticipant(userId, practiceWalkId) {
  const result = await db.query(
    'SELECT 1 FROM practice_walk_participants WHERE practice_walk_id = $1 AND participant_id = $2',
    [practiceWalkId, userId]
  );
  return result.rows.length > 0;
}

async function notifyFollowers(app, userId, userName, { title, body, url }) {
  const webpush = app.locals.webpush;
  if (!webpush) return;
  try {
    const subs = await db.query(
      `SELECT ps.*, p.email AS follower_email
       FROM push_subscriptions ps
       JOIN participant_follows pf ON pf.follower_id = ps.participant_id
       JOIN participants p ON p.id = ps.participant_id
       WHERE pf.following_id = $1`,
      [userId]
    );
    if (subs.rows.length === 0) return;
    const payload = JSON.stringify({ title, body, url });
    for (const sub of subs.rows) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth } },
          payload
        );
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await db.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
        }
      }
    }
    const followers = subs.rows.map(s => s.follower_email).join(', ');
    console.log(`[PUSH] Activity notification for ${userName} sent to ${subs.rows.length} followers (${followers})`);
  } catch (err) {
    console.error('Notify followers error:', err);
  }
}

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedMimes = ['application/gpx+xml', 'text/xml', 'application/xml', 'application/octet-stream'];
    if (ext === '.gpx' && allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only GPX files allowed'));
    }
  },
});

const uploadWalk = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'gpx') {
      const ext = path.extname(file.originalname).toLowerCase();
      const allowedMimes = ['application/gpx+xml', 'text/xml', 'application/xml', 'application/octet-stream'];
      if (ext === '.gpx' && allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Only GPX files allowed'));
      }
    } else if (file.fieldname === 'image') {
      const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Only JPEG, PNG, WebP, or HEIC images allowed'));
      }
    } else {
      cb(new Error('Unexpected field'));
    }
  },
});

async function compressImage(inputPath) {
  const outputDir = path.join(__dirname, '..', 'uploads', 'images');
  fs.mkdirSync(outputDir, { recursive: true });
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;
  const outputPath = path.join(outputDir, filename);
  await sharp(inputPath)
    .rotate()
    .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 75 })
    .toFile(outputPath);
  fs.unlinkSync(inputPath);
  return `uploads/images/${filename}`;
}

const STRAVA_ELIGIBLE_EMAIL = 'raj.shah.uk@gmail.com';

function stripStravaFields(walk) {
  walk.strava_id = null;
  walk.polyline = null;
  walk.image_path = null;
  walk.activity_type = null;
}


// --- Feature Toggles ---
router.get('/features', (req, res) => {
  const isAdmin = req.isAuthenticated() && req.user.role === 'admin';
  res.json({
    eventDayTracking: features.EVENT_DAY_TRACKING || isAdmin,
  });
});

// --- Profile ---
router.get('/me', isAuthenticated, (req, res) => {
  const { strava_token, strava_refresh_token, ...user } = req.user;
  user.strava_connected = !!strava_token;
  user.strava_eligible = req.user.email === STRAVA_ELIGIBLE_EMAIL;
  res.json(user);
});

router.put('/me', isAuthenticated, async (req, res) => {
  try {
    const { full_name, phone, emergency_contact_name, emergency_contact_phone,
            walking_on_day, gdpr_consent } = req.body;

    if (walking_on_day && (!emergency_contact_name?.trim() || !emergency_contact_phone?.trim())) {
      return res.status(400).json({ error: 'Emergency contact details are required for event day walkers' });
    }

    const wasNew = !req.user.profile_complete;

    const result = await db.query(
      `UPDATE participants SET full_name = $1, phone = $2, emergency_contact_name = $3,
       emergency_contact_phone = $4, walking_on_day = $5, gdpr_consent = $6, profile_complete = TRUE WHERE id = $7 RETURNING *`,
      [full_name, phone, emergency_contact_name, emergency_contact_phone,
       walking_on_day ?? false, gdpr_consent, req.user.id]
    );
    console.log(`[PROFILE] Updated: ${full_name} (id:${req.user.id})`);
    res.json(result.rows[0]);

    // Notify admins of new registration
    if (wasNew) {
      const webpush = req.app.locals.webpush;
      if (webpush) {
        const walkingText = walking_on_day ? 'Walking on event day' : 'Not walking on event day';
        const payload = JSON.stringify({
          title: 'New Registration',
          body: `${full_name} has registered. ${walkingText}.`,
          url: '/admin/participants',
        });
        const subs = await db.query(
          `SELECT ps.*, p.full_name AS admin_name, p.email AS admin_email
           FROM push_subscriptions ps
           JOIN participants p ON p.id = ps.participant_id
           WHERE p.role = 'admin'`
        );
        for (const sub of subs.rows) {
          const pushSub = {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
          };
          try {
            await webpush.sendNotification(pushSub, payload);
          } catch (err) {
            if (err.statusCode === 410 || err.statusCode === 404) {
              await db.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
            }
          }
        }
        const adminNames = subs.rows.map(s => s.admin_email).join(', ');
        console.log(`[PUSH] New registration notification sent to ${subs.rows.length} admin subscribers (${adminNames})`);
      }
    }
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// --- Public Stats ---
router.get('/participant-count', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        COUNT(*) AS count,
        COUNT(*) FILTER (WHERE walking_on_day = TRUE) AS walkers
      FROM participants WHERE profile_complete = TRUE
    `);
    res.json({ count: parseInt(result.rows[0].count), walkers: parseInt(result.rows[0].walkers) });
  } catch {
    res.json({ count: 0, walkers: 0 });
  }
});

// --- Community Stats (public) ---
router.get('/community-stats', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM participants WHERE profile_complete = TRUE AND walking_on_day = TRUE) AS walkers,
        COUNT(*) AS activities,
        COALESCE(SUM(distance_km), 0) AS total_km
      FROM walks
    `);
    res.json(result.rows[0]);
  } catch {
    res.json({ walkers: 0, activities: 0, total_km: 0 });
  }
});

// --- Bridges ---
router.get('/bridges', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM bridges ORDER BY order_index');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bridges' });
  }
});

// --- Location Tracking ---
router.post('/location', isAuthenticated, async (req, res) => {
  try {
    const { lat, lng, practice_walk_id } = req.body;
    if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

    if (practice_walk_id) {
      if (!(await verifyPracticeParticipant(req.user.id, practice_walk_id))) {
        return res.status(403).json({ error: 'Not a participant of this practice walk' });
      }
    } else if (!features.EVENT_DAY_TRACKING && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Event day tracking is not enabled' });
    }

    if (!practice_walk_id) {
      await db.query('DELETE FROM event_finishes WHERE participant_id = $1', [req.user.id]);
    }

    const pingResult = await db.query(
      'INSERT INTO location_pings (participant_id, lat, lng, practice_walk_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [req.user.id, lat, lng, practice_walk_id || null]
    );
    res.json({ success: true });

    // Fire-and-forget reverse geocode to store human-readable location
    const pingId = pingResult.rows[0].id;
    fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16`, {
      headers: { 'User-Agent': 'Infusion100 Charity Walk App' },
    })
      .then(r => r.json())
      .then(data => {
        if (data && data.address) {
          const a = data.address;
          const name = a.leisure || a.tourism || a.amenity || a.road || a.hamlet || a.suburb || a.village || a.town || a.city || '';
          const area = a.suburb || a.village || a.town || a.city || a.county || '';
          const location = name && area && name !== area ? `${name}, ${area}` : name || area;
          if (location) {
            db.query('UPDATE location_pings SET location_name = $1 WHERE id = $2', [location, pingId]);
          }
        }
      })
      .catch(() => {});
  } catch (err) {
    console.error('Location ping error:', err);
    res.status(500).json({ error: 'Failed to save location' });
  }
});

router.post('/location/batch', isAuthenticated, async (req, res) => {
  try {
    const { pings, practice_walk_id } = req.body;
    if (!Array.isArray(pings) || pings.length === 0) {
      return res.status(400).json({ error: 'pings array required' });
    }

    if (practice_walk_id) {
      if (!(await verifyPracticeParticipant(req.user.id, practice_walk_id))) {
        return res.status(403).json({ error: 'Not a participant of this practice walk' });
      }
    } else if (!features.EVENT_DAY_TRACKING && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Event day tracking is not enabled' });
    }

    const values = [];
    const placeholders = [];
    let idx = 1;
    for (const p of pings) {
      if (!p.lat || !p.lng) continue;
      placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3})`);
      values.push(req.user.id, p.lat, p.lng, practice_walk_id || null);
      idx += 4;
    }

    if (placeholders.length > 0) {
      await db.query(
        `INSERT INTO location_pings (participant_id, lat, lng, practice_walk_id) VALUES ${placeholders.join(', ')}`,
        values
      );
    }

    res.json({ success: true, count: placeholders.length });
  } catch (err) {
    console.error('Location batch error:', err);
    res.status(500).json({ error: 'Failed to save locations' });
  }
});

router.post('/tracking/start', isAuthenticated, async (req, res) => {
  try {
    const { practice_walk_id } = req.body;

    if (practice_walk_id) {
      if (!(await verifyPracticeParticipant(req.user.id, practice_walk_id))) {
        return res.status(403).json({ error: 'Not a participant of this practice walk' });
      }
    } else if (!features.EVENT_DAY_TRACKING && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Event day tracking is not enabled' });
    }

    // End any active sessions first (scoped to same context)
    if (practice_walk_id) {
      await db.query(
        `UPDATE tracking_sessions SET status = 'stopped', stopped_at = NOW()
         WHERE participant_id = $1 AND status = 'active' AND practice_walk_id = $2`,
        [req.user.id, practice_walk_id]
      );
    } else {
      await db.query(
        `UPDATE tracking_sessions SET status = 'stopped', stopped_at = NOW()
         WHERE participant_id = $1 AND status = 'active' AND practice_walk_id IS NULL`,
        [req.user.id]
      );
    }

    const result = await db.query(
      'INSERT INTO tracking_sessions (participant_id, practice_walk_id) VALUES ($1, $2) RETURNING *',
      [req.user.id, practice_walk_id || null]
    );
    console.log(`[TRACKING] Started: ${req.user.full_name || req.user.email} (id:${req.user.id})${practice_walk_id ? ` practice:${practice_walk_id}` : ''}`);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to start tracking' });
  }
});

router.post('/tracking/stop', isAuthenticated, async (req, res) => {
  try {
    const { practice_walk_id } = req.body;

    if (practice_walk_id) {
      if (!(await verifyPracticeParticipant(req.user.id, practice_walk_id))) {
        return res.status(403).json({ error: 'Not a participant of this practice walk' });
      }
    } else if (!features.EVENT_DAY_TRACKING && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Event day tracking is not enabled' });
    }

    let sessionQuery;
    if (practice_walk_id) {
      sessionQuery = await db.query(
        `UPDATE tracking_sessions SET status = 'stopped', stopped_at = NOW()
         WHERE participant_id = $1 AND status = 'active' AND practice_walk_id = $2
         RETURNING *`,
        [req.user.id, practice_walk_id]
      );
    } else {
      sessionQuery = await db.query(
        `UPDATE tracking_sessions SET status = 'stopped', stopped_at = NOW()
         WHERE participant_id = $1 AND status = 'active' AND practice_walk_id IS NULL
         RETURNING *`,
        [req.user.id]
      );
    }

    console.log(`[TRACKING] Stopped: ${req.user.full_name || req.user.email} (id:${req.user.id})${practice_walk_id ? ` practice:${practice_walk_id}` : ''}`);

    // For practice walks, return route data for walk log prompt
    if (practice_walk_id && sessionQuery.rows.length > 0) {
      const session = sessionQuery.rows[0];
      const pings = await db.query(
        `SELECT lat, lng, recorded_at FROM location_pings
         WHERE participant_id = $1 AND practice_walk_id = $2
           AND recorded_at >= $3 AND recorded_at <= $4
         ORDER BY recorded_at ASC`,
        [req.user.id, practice_walk_id, session.started_at, session.stopped_at]
      );

      if (pings.rows.length >= 2) {
        const points = pings.rows.map(p => ({ lat: parseFloat(p.lat), lng: parseFloat(p.lng) }));
        const distance_km = haversineDistance(points);
        const duration_mins = Math.round((new Date(session.stopped_at) - new Date(session.started_at)) / 60000);
        const polyline = encodePolyline(points);
        return res.json({
          success: true,
          route: { distance_km: parseFloat(distance_km.toFixed(2)), duration_mins, polyline, points }
        });
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Stop tracking error:', err);
    res.status(500).json({ error: 'Failed to stop tracking' });
  }
});

router.get('/tracking/status', isAuthenticated, async (req, res) => {
  try {
    const { practice_walk_id } = req.query;

    if (practice_walk_id) {
      if (!(await verifyPracticeParticipant(req.user.id, practice_walk_id))) {
        return res.status(403).json({ error: 'Not a participant of this practice walk' });
      }
    } else if (!features.EVENT_DAY_TRACKING && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Event day tracking is not enabled' });
    }

    let result;
    if (practice_walk_id) {
      result = await db.query(
        `SELECT * FROM tracking_sessions WHERE participant_id = $1 AND status = 'active' AND practice_walk_id = $2 LIMIT 1`,
        [req.user.id, practice_walk_id]
      );
    } else {
      result = await db.query(
        `SELECT * FROM tracking_sessions WHERE participant_id = $1 AND status = 'active' AND practice_walk_id IS NULL LIMIT 1`,
        [req.user.id]
      );
    }
    if (result.rows.length > 0) {
      const session = result.rows[0];
      const countParams = [req.user.id, session.started_at];
      let countSql = `SELECT COUNT(*) FROM location_pings WHERE participant_id = $1 AND recorded_at >= $2`;
      if (practice_walk_id) {
        countSql += ` AND practice_walk_id = $3`;
        countParams.push(practice_walk_id);
      } else {
        countSql += ` AND practice_walk_id IS NULL`;
      }
      const countResult = await db.query(countSql, countParams);
      return res.json({ active: true, session, ping_count: parseInt(countResult.rows[0].count) });
    }
    res.json({ active: false, session: null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get tracking status' });
  }
});

// --- Live Locations ---
router.get('/locations/live', async (req, res) => {
  try {
    const { practice_walk_id } = req.query;

    if (practice_walk_id) {
      // Practice walk: show only participants of this practice walk
      const result = await db.query(`
        SELECT DISTINCT ON (p.id)
          p.id, p.full_name, p.avatar_url,
          lp.lat, lp.lng, lp.recorded_at, lp.location_name,
          ts.status as tracking_status
        FROM participants p
        INNER JOIN practice_walk_participants pwp ON pwp.participant_id = p.id AND pwp.practice_walk_id = $1
        INNER JOIN location_pings lp ON lp.participant_id = p.id AND lp.practice_walk_id = $1
        LEFT JOIN tracking_sessions ts ON ts.participant_id = p.id AND ts.status = 'active' AND ts.practice_walk_id = $1
        ORDER BY p.id, lp.recorded_at DESC
      `, [practice_walk_id]);
      return res.json(result.rows);
    }

    if (!features.EVENT_DAY_TRACKING && (!req.user || req.user.role !== 'admin')) {
      return res.status(403).json({ error: 'Event day tracking is not enabled' });
    }

    const result = await db.query(`
      SELECT DISTINCT ON (p.id)
        p.id, p.full_name, p.avatar_url,
        lp.lat, lp.lng, lp.recorded_at, lp.location_name,
        ts.status as tracking_status
      FROM participants p
      INNER JOIN location_pings lp ON lp.participant_id = p.id AND lp.practice_walk_id IS NULL
      LEFT JOIN tracking_sessions ts ON ts.participant_id = p.id AND ts.status = 'active' AND ts.practice_walk_id IS NULL
      ORDER BY p.id, lp.recorded_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Live locations error:', err);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

// --- Practice Walks (Participant) ---
router.get('/practice-walks', isAuthenticated, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT pw.*,
        (SELECT COUNT(*) FROM practice_walk_participants WHERE practice_walk_id = pw.id) AS participant_count
      FROM practice_walks pw
      JOIN practice_walk_participants pwp ON pwp.practice_walk_id = pw.id
      WHERE pwp.participant_id = $1
      ORDER BY pw.walk_date ASC, pw.walk_time ASC NULLS LAST
    `, [req.user.id]);

    const today = new Date().toISOString().split('T')[0];
    const toDateStr = (w) => (w.walk_date instanceof Date ? w.walk_date.toISOString() : String(w.walk_date)).split('T')[0];
    const upcoming = result.rows.filter(w => toDateStr(w) >= today);
    const past = result.rows.filter(w => toDateStr(w) < today);
    res.json({ upcoming, past });
  } catch (err) {
    console.error('Practice walks list error:', err);
    res.status(500).json({ error: 'Failed to fetch practice walks' });
  }
});

router.get('/practice-walks/:id', isAuthenticated, async (req, res) => {
  try {
    if (!(await verifyPracticeParticipant(req.user.id, req.params.id))) {
      return res.status(403).json({ error: 'Not a participant of this practice walk' });
    }
    const walk = await db.query('SELECT * FROM practice_walks WHERE id = $1', [req.params.id]);
    if (walk.rows.length === 0) return res.status(404).json({ error: 'Practice walk not found' });

    const participants = await db.query(`
      SELECT p.id, p.full_name, p.avatar_url
      FROM practice_walk_participants pwp
      JOIN participants p ON p.id = pwp.participant_id
      WHERE pwp.practice_walk_id = $1
      ORDER BY p.full_name
    `, [req.params.id]);

    res.json({ ...walk.rows[0], participants: participants.rows });
  } catch (err) {
    console.error('Practice walk detail error:', err);
    res.status(500).json({ error: 'Failed to fetch practice walk' });
  }
});

// --- Walks ---
router.get('/walks', async (req, res) => {
  try {
    const { cursor, limit = 20, participant_id, sort, following } = req.query;
    const sortByDate = sort !== 'upload';
    const pageLimit = Math.min(parseInt(limit) || 20, 50);
    let query = `
      SELECT w.*, p.full_name, p.avatar_url,
        (SELECT COUNT(*) FROM walk_likes WHERE walk_id = w.id) as like_count,
        (SELECT COUNT(*) FROM walk_comments WHERE walk_id = w.id) as comment_count
      FROM walks w
      JOIN participants p ON w.participant_id = p.id
    `;
    const params = [];
    const conditions = [];

    if (participant_id) {
      params.push(participant_id);
      conditions.push(`w.participant_id = $${params.length}`);
    }
    if (following && req.user) {
      params.push(req.user.id);
      conditions.push(`w.participant_id IN (SELECT following_id FROM participant_follows WHERE follower_id = $${params.length})`);
    }
    if (cursor) {
      if (sortByDate && cursor.includes('_')) {
        const sep = cursor.indexOf('_');
        const cursorDate = cursor.substring(0, sep);
        const cursorId = cursor.substring(sep + 1);
        params.push(cursorDate, cursorId);
        conditions.push(`(w.date < $${params.length - 1} OR (w.date = $${params.length - 1} AND w.id < $${params.length}))`);
      } else {
        params.push(cursor);
        conditions.push(`w.id < $${params.length}`);
      }
    }
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');

    params.push(pageLimit);
    if (sortByDate) {
      query += ` ORDER BY w.date DESC, w.id DESC LIMIT $${params.length}`;
    } else {
      query += ` ORDER BY w.created_at DESC LIMIT $${params.length}`;
    }

    const result = await db.query(query, params);

    // Check likes and follows for current user
    if (req.user) {
      const walkIds = result.rows.map(w => w.id);
      if (walkIds.length > 0) {
        const likes = await db.query(
          'SELECT walk_id FROM walk_likes WHERE participant_id = $1 AND walk_id = ANY($2)',
          [req.user.id, walkIds]
        );
        const likedSet = new Set(likes.rows.map(l => l.walk_id));
        result.rows.forEach(w => { w.user_liked = likedSet.has(w.id); });
      }
      const pIds = [...new Set(result.rows.map(w => w.participant_id))];
      if (pIds.length) {
        const follows = await db.query(
          'SELECT following_id FROM participant_follows WHERE follower_id = $1 AND following_id = ANY($2)',
          [req.user.id, pIds]
        );
        const followSet = new Set(follows.rows.map(f => f.following_id));
        result.rows.forEach(w => { w.user_following = followSet.has(w.participant_id); });
      }
    }

    let nextCursor = null;
    if (result.rows.length === pageLimit) {
      const last = result.rows[result.rows.length - 1];
      if (sortByDate) {
        const d = last.date instanceof Date ? last.date.toISOString().split('T')[0] : String(last.date).split('T')[0];
        nextCursor = `${d}_${last.id}`;
      } else {
        nextCursor = last.id;
      }
    }

    // Strip Strava-specific data from walks not owned by the viewer
    for (const walk of result.rows) {
      if (walk.strava_id && walk.participant_id !== req.user?.id) {
        stripStravaFields(walk);
      }
    }

    res.json({ walks: result.rows, nextCursor });
  } catch (err) {
    console.error('Walks list error:', err);
    res.status(500).json({ error: 'Failed to fetch walks' });
  }
});

router.post('/walks', isAuthenticated, uploadWalk.fields([
  { name: 'gpx', maxCount: 1 },
  { name: 'image', maxCount: 1 },
]), async (req, res) => {
  try {
    const { date, distance_km, duration_mins, caption, description, mentions: mentionsRaw, polyline } = req.body;
    if (date && new Date(date) > new Date()) {
      return res.status(400).json({ error: 'Date cannot be in the future' });
    }
    const gpxFile = req.files?.gpx?.[0];
    const imageFile = req.files?.image?.[0];
    const gpxPath = gpxFile ? gpxFile.path : null;
    let imagePath = null;
    if (imageFile) {
      imagePath = await compressImage(imageFile.path);
    }

    let mentions = null;
    if (mentionsRaw) {
      try { mentions = JSON.parse(mentionsRaw); } catch {}
    }

    const result = await db.query(
      `INSERT INTO walks (participant_id, date, distance_km, duration_mins, caption, description, gpx_path, image_path, mentions, polyline)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [req.user.id, date, distance_km, duration_mins, caption, description || null, gpxPath, imagePath, mentions ? JSON.stringify(mentions) : null, polyline || null]
    );
    const walk = result.rows[0];
    console.log(`[WALK] Logged: "${caption || 'Walk'}" ${distance_km}km by ${req.user.full_name} (id:${req.user.id})`);
    res.json(walk);

    notifyFollowers(req.app, req.user.id, req.user.full_name, {
      title: 'New Activity',
      body: `${req.user.full_name} logged: ${caption || 'Walk'}`,
      url: `/walk/${walk.id}`,
    });
  } catch (err) {
    console.error('Log walk error:', err);
    res.status(500).json({ error: 'Failed to log walk' });
  }
});

router.get('/walks/:id', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT w.*, p.full_name, p.avatar_url,
        (SELECT COUNT(*) FROM walk_likes WHERE walk_id = w.id) as like_count
      FROM walks w
      JOIN participants p ON w.participant_id = p.id
      WHERE w.id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Walk not found' });

    const comments = await db.query(`
      SELECT wc.*, p.full_name, p.avatar_url
      FROM walk_comments wc
      JOIN participants p ON wc.participant_id = p.id
      WHERE wc.walk_id = $1
      ORDER BY wc.created_at ASC
    `, [req.params.id]);

    const walk = result.rows[0];
    walk.comments = comments.rows;

    const recentLikers = await db.query(`
      SELECT p.id, p.full_name, p.avatar_url
      FROM walk_likes wl JOIN participants p ON wl.participant_id = p.id
      WHERE wl.walk_id = $1 ORDER BY wl.created_at DESC LIMIT 3
    `, [req.params.id]);
    walk.recent_likers = recentLikers.rows;

    if (req.user) {
      const liked = await db.query(
        'SELECT 1 FROM walk_likes WHERE walk_id = $1 AND participant_id = $2',
        [walk.id, req.user.id]
      );
      walk.user_liked = liked.rows.length > 0;

      const followed = await db.query(
        'SELECT 1 FROM participant_follows WHERE follower_id = $1 AND following_id = $2',
        [req.user.id, walk.participant_id]
      );
      walk.user_following = followed.rows.length > 0;
    }

    // Strip Strava-specific data if viewer is not the owner
    if (walk.strava_id && walk.participant_id !== req.user?.id) {
      stripStravaFields(walk);
    }

    res.json(walk);
  } catch (err) {
    console.error('Get walk error:', err);
    res.status(500).json({ error: 'Failed to fetch walk' });
  }
});

router.get('/walks/:id/likes', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT p.id, p.full_name, p.avatar_url, wl.created_at
      FROM walk_likes wl
      JOIN participants p ON wl.participant_id = p.id
      WHERE wl.walk_id = $1
      ORDER BY wl.created_at DESC
    `, [req.params.id]);
    res.json({ likes: result.rows });
  } catch (err) {
    console.error('Get likes error:', err);
    res.status(500).json({ error: 'Failed to fetch likes' });
  }
});

router.post('/walks/:id/like', isAuthenticated, async (req, res) => {
  try {
    const walkId = req.params.id;
    const existing = await db.query(
      'SELECT 1 FROM walk_likes WHERE walk_id = $1 AND participant_id = $2',
      [walkId, req.user.id]
    );

    if (existing.rows.length > 0) {
      await db.query(
        'DELETE FROM walk_likes WHERE walk_id = $1 AND participant_id = $2',
        [walkId, req.user.id]
      );
    } else {
      await db.query(
        'INSERT INTO walk_likes (walk_id, participant_id) VALUES ($1, $2)',
        [walkId, req.user.id]
      );
    }

    const count = await db.query(
      'SELECT COUNT(*) FROM walk_likes WHERE walk_id = $1',
      [walkId]
    );
    res.json({ liked: existing.rows.length === 0, count: parseInt(count.rows[0].count) });
  } catch (err) {
    console.error('Like error:', err);
    res.status(500).json({ error: 'Failed to toggle like' });
  }
});

router.post('/walks/:id/comments', isAuthenticated, async (req, res) => {
  try {
    const { body } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ error: 'Comment body required' });

    const result = await db.query(
      `INSERT INTO walk_comments (walk_id, participant_id, body)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, req.user.id, body.trim()]
    );

    const comment = result.rows[0];
    comment.full_name = req.user.full_name;
    comment.avatar_url = req.user.avatar_url;
    res.json(comment);
  } catch (err) {
    console.error('Comment error:', err);
    res.status(500).json({ error: 'Failed to post comment' });
  }
});

// --- Edit Walk ---
router.put('/walks/:id', isAuthenticated, uploadWalk.single('image'), async (req, res) => {
  try {
    const { date, distance_km, duration_mins, caption, description } = req.body;
    if (date && new Date(date) > new Date()) {
      return res.status(400).json({ error: 'Date cannot be in the future' });
    }

    let imagePath = undefined;
    if (req.file) {
      imagePath = await compressImage(req.file.path);
    }

    const fields = ['date = $1', 'distance_km = $2', 'duration_mins = $3', 'caption = $4', 'description = $5'];
    const values = [date, distance_km, duration_mins || null, caption, description || null];

    if (imagePath !== undefined) {
      values.push(imagePath);
      fields.push(`image_path = $${values.length}`);
    }

    values.push(req.params.id, req.user.id);
    const idIdx = values.length - 1;

    const result = await db.query(
      `UPDATE walks SET ${fields.join(', ')}
       WHERE id = $${idIdx} AND participant_id = $${idIdx + 1} RETURNING *`,
      values
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Walk not found' });
    }
    console.log(`[WALK] Updated: walk ${req.params.id} by ${req.user.full_name} (id:${req.user.id})`);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update walk error:', err);
    res.status(500).json({ error: 'Failed to update walk' });
  }
});

// --- Delete Walk ---
router.delete('/walks/:id', isAuthenticated, async (req, res) => {
  try {
    const result = await db.query(
      'DELETE FROM walks WHERE id = $1 AND participant_id = $2 RETURNING id, gpx_path, image_path',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Walk not found' });
    }
    // Clean up files
    const walk = result.rows[0];
    if (walk.gpx_path) fs.unlink(walk.gpx_path, () => {});
    if (walk.image_path) fs.unlink(walk.image_path, () => {});
    console.log(`[WALK] Deleted: walk ${req.params.id} by ${req.user.full_name} (id:${req.user.id})`);
    res.json({ deleted: true });
  } catch (err) {
    console.error('Delete walk error:', err);
    res.status(500).json({ error: 'Failed to delete walk' });
  }
});

// --- Strava Sync ---
router.get('/strava/sync', isAuthenticated, async (req, res) => {
  try {
    if (req.user.email !== STRAVA_ELIGIBLE_EMAIL) {
      return res.status(403).json({ error: 'Strava integration is temporarily limited' });
    }
    if (!req.user.strava_token) {
      return res.status(400).json({ error: 'Strava not connected' });
    }

    let accessToken = decrypt(req.user.strava_token);
    const expiresAt = req.user.strava_token_expires_at;

    // Refresh if expired
    if (expiresAt && Date.now() / 1000 > expiresAt) {
      const refreshToken = decrypt(req.user.strava_refresh_token);
      const refreshRes = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: process.env.STRAVA_CLIENT_ID,
          client_secret: process.env.STRAVA_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });
      const refreshData = await refreshRes.json();
      accessToken = refreshData.access_token;

      await db.query(
        `UPDATE participants SET strava_token = $1, strava_refresh_token = $2,
         strava_token_expires_at = $3 WHERE id = $4`,
        [encrypt(accessToken), encrypt(refreshData.refresh_token),
         refreshData.expires_at, req.user.id]
      );
    }

    // Force sync: delete all existing Strava activities and re-import
    const force = req.query.force === '1';
    if (force) {
      const deleted = await db.query(
        'DELETE FROM walks WHERE participant_id = $1 AND strava_id IS NOT NULL',
        [req.user.id]
      );
      console.log(`[STRAVA] Force sync: deleted ${deleted.rowCount} existing Strava activities for ${req.user.full_name}`);
    }

    // Filter by activity types if provided (comma-separated query param)
    const typeFilter = req.query.types
      ? req.query.types.split(',').map(t => t.trim())
      : null;

    // Save the user's type preference
    if (req.query.types) {
      await db.query(
        'UPDATE participants SET strava_sync_types = $1 WHERE id = $2',
        [req.query.types, req.user.id]
      );
    }

    // Fetch activities from March 1st onwards, paginating
    const after = Math.floor(new Date('2026-03-01').getTime() / 1000);
    let imported = 0;
    let page = 1;

    while (true) {
      const activitiesRes = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100&page=${page}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const activities = await activitiesRes.json();
      if (!Array.isArray(activities) || activities.length === 0) break;

      console.log(`Strava sync page ${page}: ${activities.length} activities fetched`);
      for (const activity of activities) {
        const actType = activity.sport_type || activity.type;
        console.log(`  - ${activity.name} | type=${actType} | ${activity.start_date_local}`);

        if (typeFilter && !typeFilter.includes(actType)) continue;

        const exists = await db.query(
          'SELECT 1 FROM walks WHERE strava_id = $1', [activity.id]
        );
        if (exists.rows.length > 0) continue;

        // Fetch detailed activity to get description
        let description = null;
        try {
          const detailRes = await fetch(
            `https://www.strava.com/api/v3/activities/${activity.id}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (detailRes.ok) {
            const detail = await detailRes.json();
            description = detail.description || null;
          }
        } catch (err) {
          console.log(`[STRAVA] Could not fetch detail for activity ${activity.id}: ${err.message}`);
        }

        await db.query(
          `INSERT INTO walks (participant_id, date, distance_km, duration_mins, caption, description, polyline, strava_id, activity_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            req.user.id,
            activity.start_date_local,
            (activity.distance / 1000).toFixed(2),
            Math.round(activity.moving_time / 60),
            activity.name,
            description,
            activity.map?.summary_polyline || null,
            activity.id,
            actType,
          ]
        );
        imported++;
      }

      if (activities.length < 100) break;
      page++;
    }

    console.log(`[STRAVA] Synced ${imported} activity(ies) for ${req.user.full_name} (id:${req.user.id})`);
    res.json({ imported, message: `Imported ${imported} new activity(ies) from Strava` });

    if (imported > 0) {
      const latest = await db.query(
        'SELECT id FROM walks WHERE participant_id = $1 ORDER BY id DESC LIMIT 1',
        [req.user.id]
      );
      const activityWord = imported === 1 ? 'activity' : 'activities';
      notifyFollowers(req.app, req.user.id, req.user.full_name, {
        title: 'New Activity',
        body: `${req.user.full_name} logged ${imported} new ${activityWord}`,
        url: `/walk/${latest.rows[0].id}`,
      });
    }
  } catch (err) {
    console.error('Strava sync error:', err);
    res.status(500).json({ error: 'Failed to sync Strava activities' });
  }
});

router.delete('/strava/unlink', isAuthenticated, async (req, res) => {
  try {
    if (req.user.email !== STRAVA_ELIGIBLE_EMAIL) {
      return res.status(403).json({ error: 'Strava integration is temporarily limited' });
    }
    // Delete Strava walk images from disk
    const stravaWalks = await db.query(
      'SELECT image_path FROM walks WHERE participant_id = $1 AND strava_id IS NOT NULL AND image_path IS NOT NULL',
      [req.user.id]
    );
    for (const w of stravaWalks.rows) {
      fs.unlink(w.image_path, () => {});
    }
    // Delete Strava walks from DB
    await db.query(
      'DELETE FROM walks WHERE participant_id = $1 AND strava_id IS NOT NULL',
      [req.user.id]
    );
    await db.query(
      `UPDATE participants SET strava_token = NULL, strava_refresh_token = NULL,
       strava_token_expires_at = NULL, strava_athlete_id = NULL WHERE id = $1`,
      [req.user.id]
    );
    console.log(`[STRAVA] Unlinked and deleted all Strava data for ${req.user.full_name} (id:${req.user.id})`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unlink Strava' });
  }
});

// --- Push Notifications ---
router.get('/push/vapid-key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(404).json({ error: 'Push not configured' });
  res.json({ publicKey: key });
});

router.post('/push/subscribe', isAuthenticated, async (req, res) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }
    await db.query(
      `INSERT INTO push_subscriptions (participant_id, endpoint, keys_p256dh, keys_auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET
         participant_id = EXCLUDED.participant_id,
         keys_p256dh = EXCLUDED.keys_p256dh,
         keys_auth = EXCLUDED.keys_auth`,
      [req.user.id, endpoint, keys.p256dh, keys.auth]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Push subscribe error:', err);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

router.delete('/push/unsubscribe', isAuthenticated, async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'Endpoint required' });
    await db.query(
      'DELETE FROM push_subscriptions WHERE endpoint = $1 AND participant_id = $2',
      [endpoint, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Push unsubscribe error:', err);
    res.status(500).json({ error: 'Failed to remove subscription' });
  }
});

router.get('/push/status', isAuthenticated, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT COUNT(*) FROM push_subscriptions WHERE participant_id = $1',
      [req.user.id]
    );
    res.json({ subscribed: parseInt(result.rows[0].count) > 0 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check subscription status' });
  }
});

// --- Follows ---
router.post('/follows/:participantId', isAuthenticated, async (req, res) => {
  try {
    const followingId = parseInt(req.params.participantId);
    if (followingId === req.user.id) {
      return res.status(400).json({ error: 'Cannot follow yourself' });
    }
    const existing = await db.query(
      'SELECT 1 FROM participant_follows WHERE follower_id = $1 AND following_id = $2',
      [req.user.id, followingId]
    );
    if (existing.rows.length > 0) {
      await db.query(
        'DELETE FROM participant_follows WHERE follower_id = $1 AND following_id = $2',
        [req.user.id, followingId]
      );
      res.json({ following: false });
    } else {
      await db.query(
        'INSERT INTO participant_follows (follower_id, following_id) VALUES ($1, $2)',
        [req.user.id, followingId]
      );
      res.json({ following: true });
    }
  } catch (err) {
    console.error('Follow toggle error:', err);
    res.status(500).json({ error: 'Failed to toggle follow' });
  }
});

router.get('/follows', isAuthenticated, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.id, p.full_name, p.avatar_url
       FROM participant_follows pf
       JOIN participants p ON p.id = pf.following_id
       WHERE pf.follower_id = $1
       ORDER BY pf.created_at DESC`,
      [req.user.id]
    );
    res.json({ following: result.rows });
  } catch (err) {
    console.error('Get follows error:', err);
    res.status(500).json({ error: 'Failed to fetch follows' });
  }
});

// --- Participants Directory ---
router.get('/participants', isAuthenticated, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.id, p.full_name, p.avatar_url
       FROM participants p
       WHERE p.profile_complete = TRUE AND p.walking_on_day = TRUE
       ORDER BY p.full_name`
    );

    const [followingRes, followersRes] = await Promise.all([
      db.query('SELECT following_id FROM participant_follows WHERE follower_id = $1', [req.user.id]),
      db.query('SELECT follower_id FROM participant_follows WHERE following_id = $1', [req.user.id]),
    ]);

    const followingSet = new Set(followingRes.rows.map(r => r.following_id));
    const followerSet = new Set(followersRes.rows.map(r => r.follower_id));

    const participants = result.rows.map(p => ({
      ...p,
      user_following: followingSet.has(p.id),
      user_follows_you: followerSet.has(p.id),
    }));

    res.json({ participants });
  } catch (err) {
    console.error('Participants list error:', err);
    res.status(500).json({ error: 'Failed to fetch participants' });
  }
});

// --- Data Deletion Requests ---
router.post('/deletion-request', async (req, res) => {
  try {
    const { email, reason } = req.body;
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const trimmedEmail = email.trim().toLowerCase();

    // Check for existing pending request
    const existing = await db.query(
      `SELECT 1 FROM deletion_requests WHERE email = $1 AND status = 'pending'`,
      [trimmedEmail]
    );
    if (existing.rows.length > 0) {
      return res.json({ success: true, message: 'Your data deletion request has been submitted. We will process it within 30 days.' });
    }

    // Look up participant for audit trail
    const participant = await db.query(
      'SELECT id, full_name FROM participants WHERE email = $1',
      [trimmedEmail]
    );
    const participantId = participant.rows[0]?.id || null;
    const fullName = participant.rows[0]?.full_name || null;

    await db.query(
      `INSERT INTO deletion_requests (participant_id, email, full_name, reason)
       VALUES ($1, $2, $3, $4)`,
      [participantId, trimmedEmail, fullName, reason?.trim() || null]
    );

    console.log(`[DELETION] Request submitted for ${trimmedEmail}`);
    res.json({ success: true, message: 'Your data deletion request has been submitted. We will process it within 30 days.' });
  } catch (err) {
    console.error('Deletion request error:', err);
    res.status(500).json({ error: 'Failed to submit deletion request' });
  }
});

// --- Stats ---
router.get('/stats', isAuthenticated, async (req, res) => {
  try {
    const stats = await db.query(`
      SELECT
        COUNT(*) as total_walks,
        COALESCE(SUM(distance_km), 0) as total_distance,
        COALESCE(MAX(distance_km), 0) as longest_walk
      FROM walks WHERE participant_id = $1
    `, [req.user.id]);

    const calendar = await db.query(`
      SELECT date, COUNT(*) as count, SUM(distance_km) as distance
      FROM walks WHERE participant_id = $1
      GROUP BY date ORDER BY date
    `, [req.user.id]);

    res.json({
      ...stats.rows[0],
      calendar: calendar.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// --- Strava Webhooks ---
// GET /webhooks/strava — subscription verification
router.get('/webhooks/strava', (req, res) => {
  if (req.query['hub.verify_token'] === process.env.STRAVA_WEBHOOK_VERIFY_TOKEN) {
    res.json({ 'hub.challenge': req.query['hub.challenge'] });
  } else {
    res.status(403).end();
  }
});

// POST /webhooks/strava — event handler
router.post('/webhooks/strava', async (req, res) => {
  res.status(200).end(); // Respond immediately per Strava requirements
  const { object_type, aspect_type, object_id, owner_id } = req.body;
  try {
    if (object_type === 'activity' && aspect_type === 'delete') {
      const deleted = await db.query('DELETE FROM walks WHERE strava_id = $1 RETURNING image_path', [object_id]);
      for (const w of deleted.rows) {
        if (w.image_path) fs.unlink(w.image_path, () => {});
      }
      console.log(`[STRAVA WEBHOOK] Deleted activity ${object_id}`);
    }
    if (object_type === 'athlete' && aspect_type === 'update' && req.body.updates?.authorized === 'false') {
      // Deauthorization — clear all Strava data for this athlete
      const user = await db.query('SELECT id FROM participants WHERE strava_athlete_id = $1', [owner_id]);
      if (user.rows[0]) {
        const walks = await db.query(
          'DELETE FROM walks WHERE participant_id = $1 AND strava_id IS NOT NULL RETURNING image_path',
          [user.rows[0].id]
        );
        for (const w of walks.rows) {
          if (w.image_path) fs.unlink(w.image_path, () => {});
        }
        await db.query(
          'UPDATE participants SET strava_token = NULL, strava_refresh_token = NULL, strava_token_expires_at = NULL, strava_athlete_id = NULL WHERE id = $1',
          [user.rows[0].id]
        );
        console.log(`[STRAVA WEBHOOK] Deauthorized athlete ${owner_id}, cleared data for participant ${user.rows[0].id}`);
      }
    }
  } catch (err) {
    console.error('[STRAVA WEBHOOK] Error:', err);
  }
});

// --- Event Finishes ---
router.post('/finish', isAuthenticated, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const result = await db.query(
      `INSERT INTO event_finishes (participant_id, lat, lng)
       VALUES ($1, $2, $3)
       ON CONFLICT (participant_id) DO NOTHING
       RETURNING id`,
      [req.user.id, lat || null, lng || null]
    );
    res.json({ success: true });

    if (lat && lng && result.rows.length > 0) {
      const finishId = result.rows[0].id;
      fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16`, {
        headers: { 'User-Agent': 'Infusion100 Charity Walk App' },
      })
        .then(r => r.json())
        .then(data => {
          if (data && data.address) {
            const a = data.address;
            const name = a.leisure || a.tourism || a.amenity || a.road || a.hamlet || a.suburb || a.village || a.town || a.city || '';
            const area = a.suburb || a.village || a.town || a.city || a.county || '';
            const location = name && area && name !== area ? `${name}, ${area}` : name || area;
            if (location) {
              db.query('UPDATE event_finishes SET location_name = $1 WHERE id = $2', [location, finishId]);
            }
          }
        })
        .catch(() => {});
    }
  } catch (err) {
    console.error('Finish error:', err);
    res.status(500).json({ error: 'Failed to record finish' });
  }
});

router.get('/finishes', isAuthenticated, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT p.id, p.full_name, p.avatar_url, ef.finished_at, ef.location_name
      FROM event_finishes ef
      JOIN participants p ON p.id = ef.participant_id
      ORDER BY ef.finished_at ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Finishes fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch finishes' });
  }
});

module.exports = router;
