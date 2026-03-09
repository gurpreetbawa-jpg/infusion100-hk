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

    const result = await db.query(
      `UPDATE participants SET full_name = $1, phone = $2, emergency_contact_name = $3,
       emergency_contact_phone = $4, walking_on_day = $5, gdpr_consent = $6, profile_complete = TRUE WHERE id = $7 RETURNING *`,
      [full_name, phone, emergency_contact_name, emergency_contact_phone,
       walking_on_day ?? false, gdpr_consent, req.user.id]
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
router.post('/location', ...gated('EVENT_DAY_TRACKING', isAuthenticated), async (req, res) => {
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

router.post('/tracking/start', ...gated('EVENT_DAY_TRACKING', isAuthenticated), async (req, res) => {
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

router.post('/tracking/stop', ...gated('EVENT_DAY_TRACKING', isAuthenticated), async (req, res) => {
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

router.get('/tracking/status', ...gated('EVENT_DAY_TRACKING', isAuthenticated), async (req, res) => {
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

// --- Live Locations ---
router.get('/locations/live', ...gated('EVENT_DAY_TRACKING'), async (req, res) => {
  try {
    const result = await db.query(`
      SELECT DISTINCT ON (p.id)
        p.id, p.full_name, p.avatar_url,
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
    const { cursor, limit = 20, participant_id, sort } = req.query;
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
    const { date, distance_km, duration_mins, caption, description } = req.body;
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

    const result = await db.query(
      `INSERT INTO walks (participant_id, date, distance_km, duration_mins, caption, description, gpx_path, image_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.user.id, date, distance_km, duration_mins, caption, description || null, gpxPath, imagePath]
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

      const followed = await db.query(
        'SELECT 1 FROM participant_follows WHERE follower_id = $1 AND following_id = $2',
        [req.user.id, walk.participant_id]
      );
      walk.user_following = followed.rows.length > 0;
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

        // Fetch detailed activity to get description and photos
        let description = null;
        let imagePath = null;
        try {
          const detailRes = await fetch(
            `https://www.strava.com/api/v3/activities/${activity.id}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (detailRes.ok) {
            const detail = await detailRes.json();
            description = detail.description || null;

            // Download primary photo if available
            const photoUrl = detail.photos?.primary?.urls?.['600'];
            if (photoUrl) {
              try {
                const photoRes = await fetch(photoUrl);
                if (photoRes.ok) {
                  const buffer = Buffer.from(await photoRes.arrayBuffer());
                  const tmpPath = path.join('uploads', `strava-${activity.id}-${Date.now()}`);
                  fs.writeFileSync(tmpPath, buffer);
                  imagePath = await compressImage(tmpPath);
                  console.log(`[STRAVA] Downloaded photo for activity ${activity.id}`);
                }
              } catch (photoErr) {
                console.log(`[STRAVA] Could not download photo for activity ${activity.id}: ${photoErr.message}`);
              }
            }
          }
        } catch (err) {
          console.log(`[STRAVA] Could not fetch detail for activity ${activity.id}: ${err.message}`);
        }

        await db.query(
          `INSERT INTO walks (participant_id, date, distance_km, duration_mins, caption, description, polyline, strava_id, activity_type, image_path)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
            imagePath,
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
    if (req.user.email !== STRAVA_ELIGIBLE_EMAIL) {
      return res.status(403).json({ error: 'Strava integration is temporarily limited' });
    }
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
