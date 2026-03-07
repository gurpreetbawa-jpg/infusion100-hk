const express = require('express');
const db = require('../db');
const { isAdmin } = require('../middleware/auth');
const router = express.Router();

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
       registered_at,
       CASE WHEN strava_token IS NOT NULL THEN 'Yes' ELSE 'No' END as strava_connected
       FROM participants ORDER BY registered_at DESC`
    );

    const headers = ['Full Name', 'Email', 'Phone', 'Emergency Contact', 'Emergency Phone',
                     'Registered', 'Strava'];
    const csvRows = [headers.join(',')];

    for (const row of result.rows) {
      csvRows.push([
        `"${(row.full_name || '').replace(/"/g, '""')}"`,
        `"${row.email}"`,
        `"${row.phone || ''}"`,
        `"${(row.emergency_contact_name || '').replace(/"/g, '""')}"`,
        `"${row.emergency_contact_phone || ''}"`,
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
            start_bridge, end_bridge, role } = req.body;

    const result = await db.query(
      `UPDATE participants SET full_name = $1, phone = $2, emergency_contact_name = $3,
       emergency_contact_phone = $4, start_bridge = $5, end_bridge = $6,
       role = $7 WHERE id = $8 RETURNING *`,
      [full_name, phone, emergency_contact_name, emergency_contact_phone,
       start_bridge, end_bridge, role, req.params.id]
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

// --- Push Notifications ---
router.get('/api/notifications/subscribers', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT COUNT(DISTINCT participant_id) FROM push_subscriptions'
    );
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to count subscribers' });
  }
});

router.post('/api/notifications/send', async (req, res) => {
  try {
    const webpush = req.app.locals.webpush;
    if (!webpush) return res.status(500).json({ error: 'Push not configured' });

    const { title, body, participant_id } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'Title and body required' });

    let query = 'SELECT * FROM push_subscriptions';
    const params = [];
    if (participant_id) {
      query += ' WHERE participant_id = $1';
      params.push(participant_id);
    }

    const subs = await db.query(query, params);
    const payload = JSON.stringify({ title, body });

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

module.exports = router;
