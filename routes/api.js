const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('../db');
const { isAuthenticated } = require('../middleware/auth');
const { decrypt, encrypt } = require('../config/encryption');
const router = express.Router();

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.gpx') {
      cb(null, true);
    } else {
      cb(new Error('Only GPX files allowed'));
    }
  },
});

// --- Profile ---
router.get('/me', isAuthenticated, (req, res) => {
  const { strava_token, strava_refresh_token, ...user } = req.user;
  user.strava_connected = !!strava_token;
  res.json(user);
});

router.put('/me', isAuthenticated, async (req, res) => {
  try {
    const { full_name, phone, emergency_contact_name, emergency_contact_phone,
            gdpr_consent } = req.body;

    const result = await db.query(
      `UPDATE participants SET full_name = $1, phone = $2, emergency_contact_name = $3,
       emergency_contact_phone = $4, gdpr_consent = $5, profile_complete = TRUE WHERE id = $6 RETURNING *`,
      [full_name, phone, emergency_contact_name, emergency_contact_phone,
       gdpr_consent, req.user.id]
    );
    console.log(`[PROFILE] Updated: ${full_name} (id:${req.user.id})`);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// --- Public Stats ---
router.get('/participant-count', async (req, res) => {
  try {
    const result = await db.query('SELECT COUNT(*) FROM participants WHERE profile_complete = TRUE');
    res.json({ count: parseInt(result.rows[0].count) });
  } catch {
    res.json({ count: 0 });
  }
});

// --- Community Stats (public) ---
router.get('/community-stats', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM participants WHERE profile_complete = TRUE) AS walkers,
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
    const { lat, lng } = req.body;
    if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

    await db.query(
      'INSERT INTO location_pings (participant_id, lat, lng) VALUES ($1, $2, $3)',
      [req.user.id, lat, lng]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Location ping error:', err);
    res.status(500).json({ error: 'Failed to save location' });
  }
});

router.post('/tracking/start', isAuthenticated, async (req, res) => {
  try {
    // End any active sessions first
    await db.query(
      `UPDATE tracking_sessions SET status = 'stopped', stopped_at = NOW()
       WHERE participant_id = $1 AND status = 'active'`,
      [req.user.id]
    );
    const result = await db.query(
      'INSERT INTO tracking_sessions (participant_id) VALUES ($1) RETURNING *',
      [req.user.id]
    );
    console.log(`[TRACKING] Started: ${req.user.full_name || req.user.email} (id:${req.user.id})`);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to start tracking' });
  }
});

router.post('/tracking/stop', isAuthenticated, async (req, res) => {
  try {
    await db.query(
      `UPDATE tracking_sessions SET status = 'stopped', stopped_at = NOW()
       WHERE participant_id = $1 AND status = 'active'`,
      [req.user.id]
    );
    console.log(`[TRACKING] Stopped: ${req.user.full_name || req.user.email} (id:${req.user.id})`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to stop tracking' });
  }
});

router.get('/tracking/status', isAuthenticated, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM tracking_sessions WHERE participant_id = $1 AND status = 'active' LIMIT 1`,
      [req.user.id]
    );
    res.json({ active: result.rows.length > 0, session: result.rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get tracking status' });
  }
});

// --- Live Locations (public) ---
router.get('/locations/live', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT DISTINCT ON (p.id)
        p.id, p.full_name, p.avatar_url, p.start_bridge, p.end_bridge,
        lp.lat, lp.lng, lp.recorded_at,
        ts.status as tracking_status
      FROM participants p
      INNER JOIN location_pings lp ON lp.participant_id = p.id
      LEFT JOIN tracking_sessions ts ON ts.participant_id = p.id AND ts.status = 'active'
      ORDER BY p.id, lp.recorded_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Live locations error:', err);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

// --- Walks ---
router.get('/walks', async (req, res) => {
  try {
    const { cursor, limit = 20, participant_id } = req.query;
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
    if (cursor) {
      params.push(cursor);
      conditions.push(`w.id < $${params.length}`);
    }
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');

    params.push(pageLimit);
    query += ` ORDER BY w.created_at DESC LIMIT $${params.length}`;

    const result = await db.query(query, params);

    // Check likes for current user
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
    }

    const nextCursor = result.rows.length === pageLimit
      ? result.rows[result.rows.length - 1].id : null;

    res.json({ walks: result.rows, nextCursor });
  } catch (err) {
    console.error('Walks list error:', err);
    res.status(500).json({ error: 'Failed to fetch walks' });
  }
});

router.post('/walks', isAuthenticated, upload.single('gpx'), async (req, res) => {
  try {
    const { date, distance_km, duration_mins, caption } = req.body;
    const gpxPath = req.file ? req.file.path : null;

    const result = await db.query(
      `INSERT INTO walks (participant_id, date, distance_km, duration_mins, caption, gpx_path)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.id, date, distance_km, duration_mins, caption, gpxPath]
    );
    console.log(`[WALK] Logged: "${caption || 'Walk'}" ${distance_km}km by ${req.user.full_name} (id:${req.user.id})`);
    res.json(result.rows[0]);
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

    if (req.user) {
      const liked = await db.query(
        'SELECT 1 FROM walk_likes WHERE walk_id = $1 AND participant_id = $2',
        [walk.id, req.user.id]
      );
      walk.user_liked = liked.rows.length > 0;
    }

    res.json(walk);
  } catch (err) {
    console.error('Get walk error:', err);
    res.status(500).json({ error: 'Failed to fetch walk' });
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

// --- Delete Walk ---
router.delete('/walks/:id', isAuthenticated, async (req, res) => {
  try {
    const result = await db.query(
      'DELETE FROM walks WHERE id = $1 AND participant_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Walk not found' });
    }
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

        await db.query(
          `INSERT INTO walks (participant_id, date, distance_km, duration_mins, caption, polyline, strava_id, activity_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            req.user.id,
            activity.start_date_local.split('T')[0],
            (activity.distance / 1000).toFixed(2),
            Math.round(activity.moving_time / 60),
            activity.name,
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
  } catch (err) {
    console.error('Strava sync error:', err);
    res.status(500).json({ error: 'Failed to sync Strava activities' });
  }
});

router.delete('/strava/unlink', isAuthenticated, async (req, res) => {
  try {
    await db.query(
      `UPDATE participants SET strava_token = NULL, strava_refresh_token = NULL,
       strava_token_expires_at = NULL, strava_athlete_id = NULL WHERE id = $1`,
      [req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unlink Strava' });
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

module.exports = router;
