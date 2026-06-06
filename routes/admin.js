const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const multer = require('multer');
const { ZipArchive } = require('archiver');
const unzipper = require('unzipper');
const db = require('../db');
const { isAdmin } = require('../middleware/auth');
const router = express.Router();

const BACKUP_TABLES = [
  'participants', 'bridges', 'practice_walks', 'walks',
  'walk_likes', 'walk_comments', 'participant_follows',
  'location_pings', 'tracking_sessions', 'event_finishes',
  'practice_walk_participants', 'deletion_requests', 'push_subscriptions',
];

const SEQUENCE_TABLES = [
  'participants', 'location_pings', 'tracking_sessions', 'walks',
  'walk_comments', 'event_finishes', 'bridges', 'push_subscriptions',
  'deletion_requests', 'practice_walks',
];

const backupUpload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (req, file, cb) => cb(null, `restore-${Date.now()}.zip`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.zip') || file.mimetype === 'application/zip') {
      cb(null, true);
    } else {
      cb(new Error('Only zip files are allowed'));
    }
  },
});

router.use(isAdmin);

router.get('/api/participants', async (req, res) => {
  try {
    const { page = 1, limit = 25, search } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const pageLimit = Math.min(parseInt(limit) || 25, 100);
    const offset = (pageNum - 1) * pageLimit;

    let query = 'SELECT * FROM participants';
    let countQuery = 'SELECT COUNT(*) FROM participants';
    const params = [];
    const countParams = [];

    if (search) {
      const searchClause = ` WHERE full_name ILIKE $1 OR email ILIKE $1`;
      params.push(`%${search}%`);
      countParams.push(`%${search}%`);
      query += searchClause;
      countQuery += searchClause;
    }

    query += ` ORDER BY registered_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(pageLimit, offset);

    const [result, total] = await Promise.all([
      db.query(query, params),
      db.query(countQuery, countParams),
    ]);

    res.json({
      participants: result.rows.map(p => {
        const { strava_token, strava_refresh_token, ...rest } = p;
        rest.strava_connected = !!strava_token;
        return rest;
      }),
      total: parseInt(total.rows[0].count),
      page: pageNum,
      pages: Math.ceil(total.rows[0].count / pageLimit),
    });
  } catch (err) {
    console.error('Admin participants error:', err);
    res.status(500).json({ error: 'Failed to fetch participants' });
  }
});

router.get('/api/participants/export', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT full_name, email, phone, emergency_contact_name, emergency_contact_phone,
       walking_on_day, registered_at,
       CASE WHEN strava_token IS NOT NULL THEN 'Yes' ELSE 'No' END as strava_connected
       FROM participants ORDER BY registered_at DESC`
    );

    const headers = ['Full Name', 'Email', 'Phone', 'Emergency Contact', 'Emergency Phone',
                     'Walking on Day', 'Registered', 'Strava'];
    const csvRows = [headers.join(',')];

    for (const row of result.rows) {
      csvRows.push([
        `"${(row.full_name || '').replace(/"/g, '""')}"`,
        `"${row.email}"`,
        `"${row.phone || ''}"`,
        `"${(row.emergency_contact_name || '').replace(/"/g, '""')}"`,
        `"${row.emergency_contact_phone || ''}"`,
        row.walking_on_day ? 'Yes' : 'No',
        `"${row.registered_at}"`,
        row.strava_connected,
      ].join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=infusion100-participants.csv');
    res.send(csvRows.join('\n'));
  } catch (err) {
    res.status(500).json({ error: 'Failed to export' });
  }
});

router.put('/api/participants/:id', async (req, res) => {
  try {
    const { full_name, phone, emergency_contact_name, emergency_contact_phone,
            walking_on_day, role } = req.body;

    const result = await db.query(
      `UPDATE participants SET full_name = $1, phone = $2, emergency_contact_name = $3,
       emergency_contact_phone = $4, walking_on_day = $5, role = $6 WHERE id = $7 RETURNING *`,
      [full_name, phone, emergency_contact_name, emergency_contact_phone,
       walking_on_day ?? false, role, req.params.id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Participant not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update participant' });
  }
});

router.delete('/api/participants/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM participants WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete participant' });
  }
});

// --- Admin Stats ---
router.get('/api/stats', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM walks) AS total_walks,
        (SELECT COUNT(*) FROM participants WHERE strava_token IS NOT NULL) AS strava_linked
    `);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// --- Push Notifications ---
router.get('/api/notifications/subscribers', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.id, p.full_name, p.email, COUNT(ps.id) AS device_count
       FROM push_subscriptions ps
       JOIN participants p ON p.id = ps.participant_id
       GROUP BY p.id, p.full_name, p.email
       ORDER BY p.full_name`
    );
    res.json({ count: result.rows.length, subscribers: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to count subscribers' });
  }
});

router.post('/api/notifications/send', async (req, res) => {
  try {
    const webpush = req.app.locals.webpush;
    if (!webpush) return res.status(500).json({ error: 'Push not configured' });

    const { title, body, url, participant_id } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'Title and body required' });

    let query = 'SELECT * FROM push_subscriptions';
    const params = [];
    if (participant_id) {
      query += ' WHERE participant_id = $1';
      params.push(participant_id);
    }

    const subs = await db.query(query, params);
    const payload = JSON.stringify({ title, body, ...(url && { url }) });

    let sent = 0;
    let failed = 0;
    for (const sub of subs.rows) {
      const pushSub = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
      };
      try {
        await webpush.sendNotification(pushSub, payload);
        sent++;
      } catch (err) {
        failed++;
        if (err.statusCode === 410 || err.statusCode === 404) {
          await db.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
        }
      }
    }

    console.log(`[PUSH] Sent ${sent}, failed ${failed} (target: ${participant_id || 'broadcast'})`);
    res.json({ sent, failed });
  } catch (err) {
    console.error('Send notification error:', err);
    res.status(500).json({ error: 'Failed to send notifications' });
  }
});

// --- Deletion Requests ---
router.get('/api/deletion-requests', async (req, res) => {
  try {
    const { status } = req.query;
    let query = 'SELECT * FROM deletion_requests';
    const params = [];
    if (status) {
      params.push(status);
      query += ' WHERE status = $1';
    }
    query += ' ORDER BY created_at DESC';
    const result = await db.query(query, params);
    res.json({ requests: result.rows });
  } catch (err) {
    console.error('Deletion requests list error:', err);
    res.status(500).json({ error: 'Failed to fetch deletion requests' });
  }
});

router.put('/api/deletion-requests/:id', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['completed', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status must be completed or rejected' });
    }
    const result = await db.query(
      `UPDATE deletion_requests SET status = $1, resolved_at = NOW(), resolved_by = $2
       WHERE id = $3 RETURNING *`,
      [status, req.user.id, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }
    console.log(`[DELETION] Request ${req.params.id} marked as ${status} by ${req.user.full_name}`);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update deletion request error:', err);
    res.status(500).json({ error: 'Failed to update deletion request' });
  }
});

// --- Practice Walks ---
router.get('/api/practice-walks', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT pw.*,
        (SELECT COUNT(*) FROM practice_walk_participants WHERE practice_walk_id = pw.id) AS participant_count
      FROM practice_walks pw
      ORDER BY pw.walk_date DESC, pw.walk_time DESC NULLS LAST
    `);
    res.json({ practice_walks: result.rows });
  } catch (err) {
    console.error('Admin practice walks list error:', err);
    res.status(500).json({ error: 'Failed to fetch practice walks' });
  }
});

router.get('/api/practice-walks/:id', async (req, res) => {
  try {
    const walk = await db.query('SELECT * FROM practice_walks WHERE id = $1', [req.params.id]);
    if (walk.rows.length === 0) return res.status(404).json({ error: 'Practice walk not found' });

    const participants = await db.query(`
      SELECT p.id, p.full_name, p.email, p.avatar_url
      FROM practice_walk_participants pwp
      JOIN participants p ON p.id = pwp.participant_id
      WHERE pwp.practice_walk_id = $1
      ORDER BY p.full_name
    `, [req.params.id]);

    res.json({ ...walk.rows[0], participants: participants.rows });
  } catch (err) {
    console.error('Admin practice walk detail error:', err);
    res.status(500).json({ error: 'Failed to fetch practice walk' });
  }
});

router.post('/api/practice-walks', async (req, res) => {
  const client = await db.getClient();
  try {
    const { title, walk_date, walk_time, participant_ids } = req.body;
    if (!title || !walk_date) return res.status(400).json({ error: 'Title and date are required' });

    await client.query('BEGIN');
    const result = await client.query(
      'INSERT INTO practice_walks (title, walk_date, walk_time, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [title, walk_date, walk_time || null, req.user.id]
    );
    const pw = result.rows[0];

    if (participant_ids && participant_ids.length > 0) {
      const values = participant_ids.map((pid, i) => `($1, $${i + 2})`).join(', ');
      await client.query(
        `INSERT INTO practice_walk_participants (practice_walk_id, participant_id) VALUES ${values}`,
        [pw.id, ...participant_ids]
      );
    }

    await client.query('COMMIT');
    console.log(`[PRACTICE] Created: "${title}" on ${walk_date} by ${req.user.full_name}`);
    res.json(pw);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create practice walk error:', err);
    res.status(500).json({ error: 'Failed to create practice walk' });
  } finally {
    client.release();
  }
});

router.put('/api/practice-walks/:id', async (req, res) => {
  const client = await db.getClient();
  try {
    const { title, walk_date, walk_time, participant_ids } = req.body;
    if (!title || !walk_date) return res.status(400).json({ error: 'Title and date are required' });

    await client.query('BEGIN');
    const result = await client.query(
      'UPDATE practice_walks SET title = $1, walk_date = $2, walk_time = $3 WHERE id = $4 RETURNING *',
      [title, walk_date, walk_time || null, req.params.id]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Practice walk not found' });
    }

    await client.query('DELETE FROM practice_walk_participants WHERE practice_walk_id = $1', [req.params.id]);
    if (participant_ids && participant_ids.length > 0) {
      const values = participant_ids.map((pid, i) => `($1, $${i + 2})`).join(', ');
      await client.query(
        `INSERT INTO practice_walk_participants (practice_walk_id, participant_id) VALUES ${values}`,
        [req.params.id, ...participant_ids]
      );
    }

    await client.query('COMMIT');
    console.log(`[PRACTICE] Updated: "${title}" (id:${req.params.id})`);
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update practice walk error:', err);
    res.status(500).json({ error: 'Failed to update practice walk' });
  } finally {
    client.release();
  }
});

router.delete('/api/practice-walks/:id', async (req, res) => {
  try {
    const result = await db.query('DELETE FROM practice_walks WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Practice walk not found' });
    console.log(`[PRACTICE] Deleted: id:${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete practice walk error:', err);
    res.status(500).json({ error: 'Failed to delete practice walk' });
  }
});

router.delete('/api/event-day', async (req, res) => {
  try {
    const pings = await db.query('DELETE FROM location_pings WHERE practice_walk_id IS NULL RETURNING id');
    const finishes = await db.query('DELETE FROM event_finishes RETURNING id');
    console.log(`[EVENT-DAY RESET] Deleted ${pings.rowCount} check-ins, ${finishes.rowCount} finishes`);
    res.json({ checkins_deleted: pings.rowCount, finishes_deleted: finishes.rowCount });
  } catch (err) {
    console.error('Event day reset error:', err);
    res.status(500).json({ error: 'Failed to reset event day data' });
  }
});

// --- Backup & Restore ---
router.get('/api/backup', async (req, res) => {
  try {
    const date = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=infusion100-backup-${date}.zip`);

    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.on('error', err => {
      console.error('Archiver error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Backup failed' });
      else res.destroy();
    });
    archive.pipe(res);

    for (const table of BACKUP_TABLES) {
      const result = await db.query(`SELECT * FROM ${table} ORDER BY 1`);
      archive.append(JSON.stringify(result.rows, null, 2), { name: `data/${table}.json` });
    }

    const uploadsDir = path.join(__dirname, '..', 'uploads');
    if (fs.existsSync(uploadsDir)) {
      archive.directory(uploadsDir, 'files/uploads');
    }

    await archive.finalize();
  } catch (err) {
    console.error('Backup error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Backup failed' });
  }
});

router.post('/api/restore', backupUpload.single('backup'), async (req, res) => {
  const zipPath = req.file?.path;
  try {
    if (!zipPath) return res.status(400).json({ error: 'No backup file provided' });

    const tableData = {};
    const fileEntries = [];

    const directory = await unzipper.Open.file(zipPath);
    for (const entry of directory.files) {
      if (entry.type === 'Directory') continue;
      if (entry.path.startsWith('data/') && entry.path.endsWith('.json')) {
        const tableName = path.basename(entry.path, '.json');
        const content = await entry.buffer();
        tableData[tableName] = JSON.parse(content.toString());
      } else if (entry.path.startsWith('files/uploads/')) {
        fileEntries.push(entry);
      }
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      await client.query(`
        TRUNCATE TABLE
          walk_likes, walk_comments, participant_follows, event_finishes,
          push_subscriptions, practice_walk_participants, location_pings,
          tracking_sessions, deletion_requests, walks, practice_walks,
          participants, bridges
        RESTART IDENTITY CASCADE
      `);

      for (const table of BACKUP_TABLES) {
        const rows = tableData[table] || [];
        for (const row of rows) {
          const keys = Object.keys(row);
          if (keys.length === 0) continue;
          const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
          await client.query(
            `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`,
            Object.values(row)
          );
        }
      }

      for (const table of SEQUENCE_TABLES) {
        await client.query(`
          SELECT setval(
            pg_get_serial_sequence('${table}', 'id'),
            COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1,
            false
          )
        `);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const uploadsDir = path.join(__dirname, '..', 'uploads');
    if (fs.existsSync(uploadsDir)) fs.rmSync(uploadsDir, { recursive: true });
    fs.mkdirSync(uploadsDir, { recursive: true });

    for (const entry of fileEntries) {
      const relativePath = entry.path.replace('files/uploads/', '');
      const destPath = path.join(uploadsDir, relativePath);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      const content = await entry.buffer();
      fs.writeFileSync(destPath, content);
    }

    const totalRows = Object.values(tableData).reduce((sum, rows) => sum + rows.length, 0);
    console.log(`[RESTORE] ${totalRows} rows across ${Object.keys(tableData).length} tables, ${fileEntries.length} files`);
    res.json({ success: true, tables: Object.keys(tableData).length, files: fileEntries.length });
  } catch (err) {
    console.error('Restore error:', err);
    res.status(500).json({ error: err.message || 'Restore failed' });
  } finally {
    if (zipPath) {
      try { fs.unlinkSync(zipPath); } catch {}
    }
  }
});

module.exports = router;
