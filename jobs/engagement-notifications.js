const db = require('../db');

async function runEngagementNotifications(webpush) {
  if (!webpush) return;

  try {
    // Find new likes since each walk owner's last_engagement_notified_at, excluding self-likes
    const likesResult = await db.query(`
      SELECT w.participant_id AS owner_id, w.id AS walk_id, COUNT(*) AS like_count,
        array_agg(DISTINCT wl.participant_id) AS actor_ids
      FROM walk_likes wl
      JOIN walks w ON w.id = wl.walk_id
      JOIN participants p ON p.id = w.participant_id
      WHERE wl.created_at > p.last_engagement_notified_at
        AND wl.participant_id != w.participant_id
      GROUP BY w.participant_id, w.id
    `);

    // Find new comments since each walk owner's last_engagement_notified_at, excluding self-comments
    const commentsResult = await db.query(`
      SELECT w.participant_id AS owner_id, w.id AS walk_id, COUNT(*) AS comment_count,
        array_agg(DISTINCT wc.participant_id) AS actor_ids
      FROM walk_comments wc
      JOIN walks w ON w.id = wc.walk_id
      JOIN participants p ON p.id = w.participant_id
      WHERE wc.created_at > p.last_engagement_notified_at
        AND wc.participant_id != w.participant_id
      GROUP BY w.participant_id, w.id
    `);

    // Group by owner
    const owners = new Map();

    for (const row of likesResult.rows) {
      if (!owners.has(row.owner_id)) {
        owners.set(row.owner_id, { walks: new Set(), totalLikes: 0, totalComments: 0, actors: new Set() });
      }
      const entry = owners.get(row.owner_id);
      entry.walks.add(row.walk_id);
      entry.totalLikes += parseInt(row.like_count);
      for (const id of row.actor_ids) entry.actors.add(id);
    }

    for (const row of commentsResult.rows) {
      if (!owners.has(row.owner_id)) {
        owners.set(row.owner_id, { walks: new Set(), totalLikes: 0, totalComments: 0, actors: new Set() });
      }
      const entry = owners.get(row.owner_id);
      entry.walks.add(row.walk_id);
      entry.totalComments += parseInt(row.comment_count);
      for (const id of row.actor_ids) entry.actors.add(id);
    }

    console.log(`[ENGAGEMENT] Running: found ${likesResult.rows.length} like entries, ${commentsResult.rows.length} comment entries across ${owners.size} user(s)`);

    if (owners.size === 0) {
      console.log('[ENGAGEMENT] No new engagement to notify');
      return;
    }

    let totalSent = 0;
    let totalFailed = 0;
    let totalExpired = 0;
    const processedOwnerIds = [];

    for (const [ownerId, data] of owners) {
      const walkCount = data.walks.size;
      const { totalLikes, totalComments } = data;

      // Compose message
      const walkWord = walkCount === 1 ? 'walk' : 'walks';
      const parts = [];
      if (totalLikes > 0) parts.push(`${totalLikes} like${totalLikes !== 1 ? 's' : ''}`);
      if (totalComments > 0) parts.push(`${totalComments} ${totalComments !== 1 ? 'comments' : 'comment'}`);

      let fromSuffix = '';
      if (data.actors.size === 1) {
        const actorId = [...data.actors][0];
        const actorResult = await db.query('SELECT full_name FROM participants WHERE id = $1', [actorId]);
        if (actorResult.rows.length > 0 && actorResult.rows[0].full_name) {
          const firstName = actorResult.rows[0].full_name.split(' ')[0];
          fromSuffix = ` from ${firstName}`;
        }
      }

      const body = `Your ${walkWord} got ${parts.join(' and ')}${fromSuffix}!`;

      // Deep link: single walk → walk page, multiple → dashboard
      const url = walkCount === 1
        ? `/walk/${[...data.walks][0]}`
        : '/dashboard';

      const payload = JSON.stringify({
        title: 'Infusion100',
        body,
        url,
      });

      // Send to all of this user's push subscriptions
      const subs = await db.query(
        'SELECT * FROM push_subscriptions WHERE participant_id = $1',
        [ownerId]
      );

      console.log(`[ENGAGEMENT] User ${ownerId}: ${totalLikes} like(s), ${totalComments} comment(s) on ${walkCount} ${walkWord} → ${subs.rows.length} subscription(s)`);

      for (const sub of subs.rows) {
        const pushSub = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
        };
        try {
          await webpush.sendNotification(pushSub, payload);
          totalSent++;
        } catch (err) {
          totalFailed++;
          if (err.statusCode === 410 || err.statusCode === 404) {
            await db.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
            totalExpired++;
            console.log(`[ENGAGEMENT] Removed expired subscription ${sub.id} for user ${ownerId}`);
          } else {
            console.error(`[ENGAGEMENT] Push failed for user ${ownerId}: ${err.statusCode || err.message}`);
          }
        }
      }

      processedOwnerIds.push(ownerId);
    }

    // Update last_engagement_notified_at for all processed users
    if (processedOwnerIds.length > 0) {
      await db.query(
        `UPDATE participants SET last_engagement_notified_at = NOW() WHERE id = ANY($1)`,
        [processedOwnerIds]
      );
    }

    console.log(`[ENGAGEMENT] Done: ${processedOwnerIds.length} user(s) notified, ${totalSent} sent, ${totalFailed} failed${totalExpired ? `, ${totalExpired} expired removed` : ''}`);
  } catch (err) {
    console.error('[ENGAGEMENT] Job failed:', err.message);
  }
}

module.exports = { runEngagementNotifications };
