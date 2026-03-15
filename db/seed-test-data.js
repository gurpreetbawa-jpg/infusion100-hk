#!/usr/bin/env node
// Seed script: populates the database with realistic test data for local development.
// All test participants use oauth_provider='test' and @test.local emails.
// Safe to run multiple times — cleans up previous test data first.
// Usage: node db/seed-test-data.js  (or: npm run db:seed)

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

const PARTICIPANTS = [
  { name: 'Sarah Chen', email: 'sarah.chen@test.local', oauthId: 'test-001', regDate: '2026-01-05' },
  { name: 'James Okafor', email: 'james.okafor@test.local', oauthId: 'test-002', regDate: '2026-01-12' },
  { name: 'Priya Sharma', email: 'priya.sharma@test.local', oauthId: 'test-003', regDate: '2026-01-20' },
  { name: 'Tom Bailey', email: 'tom.bailey@test.local', oauthId: 'test-004', regDate: '2026-01-28' },
  { name: 'Aisha Rahman', email: 'aisha.rahman@test.local', oauthId: 'test-005', regDate: '2026-02-03' },
  { name: 'David Kim', email: 'david.kim@test.local', oauthId: 'test-006', regDate: '2026-02-10' },
  { name: 'Emma Wilson', email: 'emma.wilson@test.local', oauthId: 'test-007', regDate: '2026-02-18' },
  { name: 'Marcus Brown', email: 'marcus.brown@test.local', oauthId: 'test-008', regDate: '2026-02-25' },
  { name: 'Lily Zhang', email: 'lily.zhang@test.local', oauthId: 'test-009', regDate: '2026-03-02' },
  { name: 'Oliver Patel', email: 'oliver.patel@test.local', oauthId: 'test-010', regDate: '2026-03-08' },
];

const CAPTIONS = [
  'Morning walk along the Thames',
  'Training for the big day!',
  'Lovely spring weather for a walk',
  'Lunchtime stroll through the park',
  'Exploring new routes today',
  'Weekend warrior mode',
  'Early bird gets the miles',
  'Beautiful sunrise walk',
  'Quick evening loop',
  'Bridge spotting adventure',
  'Getting those steps in',
  'Rainy but worth it',
  'Perfect walking weather',
  'Pushing the distance today',
  'Recovery walk after yesterday',
  'First walk of the week',
  'New personal best!',
  'Charity miles adding up',
  'Walked with friends today',
  'Post-work de-stress walk',
];

const DESCRIPTIONS = [
  'Started at Tower Bridge and worked my way west. The river was beautiful this morning.',
  'Feeling stronger every week. Only two months until the event!',
  'Discovered a lovely path through Greenwich Park I hadn\'t tried before.',
  null, null, null, null, null, null, null,
  'Joined by a few colleagues from work. Great to have company!',
  null, null, null, null, null, null, null, null, null,
];

const COMMENT_TEXTS = [
  'Great effort!',
  'Love this route!',
  'Keep it up! 💪',
  'Impressive distance!',
  'Beautiful day for it',
  'You\'re smashing it!',
  'Wish I could have joined',
  'That\'s a lovely area to walk',
  'Getting close to the target!',
  'Well done!',
  'What a great pace!',
  'Inspiring stuff',
  'Need to try this route myself',
  'The Thames path is gorgeous',
  'Brilliant work!',
];

// Walk distribution: [participantIndex, count]
// Some are power users, some casual
const WALK_DISTRIBUTION = [
  [0, 6], // Sarah - power user
  [1, 5], // James
  [2, 4], // Priya
  [3, 3], // Tom
  [4, 5], // Aisha
  [5, 2], // David - casual
  [6, 4], // Emma
  [7, 3], // Marcus
  [8, 2], // Lily - casual
  [9, 3], // Oliver
];

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(startStr, endStr) {
  const start = new Date(startStr).getTime();
  const end = new Date(endStr).getTime();
  return new Date(start + Math.random() * (end - start));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function run() {
  console.log('[SEED] Starting test data seed...');
  console.log(`[SEED] DATABASE_URL: ${process.env.DATABASE_URL ? 'set' : 'NOT SET'}`);

  // Step 1: Cleanup previous test data (CASCADE handles walks, likes, comments, follows)
  const deleted = await pool.query(`DELETE FROM participants WHERE oauth_provider = 'test'`);
  console.log(`[SEED] Cleaned up ${deleted.rowCount} previous test participant(s)`);

  // Step 2: Insert test participants
  const participantIds = [];
  for (const p of PARTICIPANTS) {
    const result = await pool.query(
      `INSERT INTO participants
        (oauth_provider, oauth_id, email, full_name, profile_complete, gdpr_consent,
         last_engagement_notified_at, registered_at)
       VALUES ('test', $1, $2, $3, true, true, NOW() - INTERVAL '7 days', $4)
       RETURNING id`,
      [p.oauthId, p.email, p.name, p.regDate]
    );
    participantIds.push(result.rows[0].id);
  }
  console.log(`[SEED] Created ${participantIds.length} test participants`);

  // Step 3: Insert walks
  const walkRows = []; // { id, participantId, participantIndex }
  let captionIdx = 0;
  let descIdx = 0;
  for (const [pIdx, count] of WALK_DISTRIBUTION) {
    const pid = participantIds[pIdx];
    for (let i = 0; i < count; i++) {
      const date = randomDate('2026-03-01', '2026-05-15');
      const distKm = (randomBetween(30, 250) / 10).toFixed(2); // 3.0 – 25.0 km
      const paceMinPerKm = randomBetween(12, 15);
      const durationMins = Math.round(parseFloat(distKm) * paceMinPerKm);
      const caption = CAPTIONS[captionIdx % CAPTIONS.length];
      const description = DESCRIPTIONS[descIdx % DESCRIPTIONS.length];
      captionIdx++;
      descIdx++;

      const result = await pool.query(
        `INSERT INTO walks (participant_id, date, distance_km, duration_mins, caption, description, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $2)
         RETURNING id`,
        [pid, date.toISOString(), distKm, durationMins, caption, description]
      );
      walkRows.push({ id: result.rows[0].id, participantId: pid, participantIndex: pIdx });
    }
  }
  console.log(`[SEED] Created ${walkRows.length} walks`);

  // Step 4: Insert likes
  // Strategy: a few walks get lots of likes, some get a few, many get none
  let likeCount = 0;

  // Pick 2-3 walks to be "popular" (6-8 likes each)
  const popularWalks = walkRows.slice(0, 3);
  for (const walk of popularWalks) {
    const likerCount = randomBetween(6, 8);
    const possibleLikers = participantIds.filter(id => id !== walk.participantId);
    const likers = possibleLikers.sort(() => Math.random() - 0.5).slice(0, likerCount);
    for (const likerId of likers) {
      await pool.query(
        `INSERT INTO walk_likes (walk_id, participant_id, created_at)
         VALUES ($1, $2, NOW() - INTERVAL '${randomBetween(1, 72)} hours')
         ON CONFLICT DO NOTHING`,
        [walk.id, likerId]
      );
      likeCount++;
    }
  }

  // Several walks get 2-4 likes
  const mediumWalks = walkRows.slice(3, 10);
  for (const walk of mediumWalks) {
    const likerCount = randomBetween(2, 4);
    const possibleLikers = participantIds.filter(id => id !== walk.participantId);
    const likers = possibleLikers.sort(() => Math.random() - 0.5).slice(0, likerCount);
    for (const likerId of likers) {
      await pool.query(
        `INSERT INTO walk_likes (walk_id, participant_id, created_at)
         VALUES ($1, $2, NOW() - INTERVAL '${randomBetween(1, 120)} hours')
         ON CONFLICT DO NOTHING`,
        [walk.id, likerId]
      );
      likeCount++;
    }
  }

  // ~10 walks get 1 like
  const singleLikeWalks = walkRows.slice(10, 20);
  for (const walk of singleLikeWalks) {
    const possibleLikers = participantIds.filter(id => id !== walk.participantId);
    const liker = pick(possibleLikers);
    await pool.query(
      `INSERT INTO walk_likes (walk_id, participant_id, created_at)
       VALUES ($1, $2, NOW() - INTERVAL '${randomBetween(1, 168)} hours')
       ON CONFLICT DO NOTHING`,
      [walk.id, liker]
    );
    likeCount++;
  }
  // Remaining walks get 0 likes
  console.log(`[SEED] Created ${likeCount} likes`);

  // Step 5: Insert comments
  let commentCount = 0;
  // Popular walks get 2-3 comments
  for (const walk of popularWalks) {
    const numComments = randomBetween(2, 3);
    const possibleCommenters = participantIds.filter(id => id !== walk.participantId);
    const commenters = possibleCommenters.sort(() => Math.random() - 0.5).slice(0, numComments);
    for (const commenterId of commenters) {
      await pool.query(
        `INSERT INTO walk_comments (walk_id, participant_id, body, created_at)
         VALUES ($1, $2, $3, NOW() - INTERVAL '${randomBetween(1, 48)} hours')`,
        [walk.id, commenterId, pick(COMMENT_TEXTS)]
      );
      commentCount++;
    }
  }
  // Medium walks get 1-2 comments
  for (const walk of mediumWalks.slice(0, 5)) {
    const numComments = randomBetween(1, 2);
    const possibleCommenters = participantIds.filter(id => id !== walk.participantId);
    const commenters = possibleCommenters.sort(() => Math.random() - 0.5).slice(0, numComments);
    for (const commenterId of commenters) {
      await pool.query(
        `INSERT INTO walk_comments (walk_id, participant_id, body, created_at)
         VALUES ($1, $2, $3, NOW() - INTERVAL '${randomBetween(1, 96)} hours')`,
        [walk.id, commenterId, pick(COMMENT_TEXTS)]
      );
      commentCount++;
    }
  }
  console.log(`[SEED] Created ${commentCount} comments`);

  // Step 6: Insert follow relationships
  let followCount = 0;
  // follower → [following indices]
  const followMap = [
    [0, [1, 2, 3, 4, 5, 6]],  // Sarah follows many
    [1, [0, 2, 4, 7]],         // James follows a few, mutual with Sarah
    [2, [0, 1, 3, 5, 8]],      // Priya follows several
    [3, [0, 6]],                // Tom follows few
    [4, [0, 1, 2, 6, 7, 9]],   // Aisha follows many
    [5, [2]],                   // David follows one
    [6, [0, 3, 4]],             // Emma
    [7, [1, 4]],                // Marcus, mutual with James and Aisha
    // Lily and Oliver follow nobody
  ];

  for (const [followerIdx, followingIndices] of followMap) {
    for (const followingIdx of followingIndices) {
      await pool.query(
        `INSERT INTO participant_follows (follower_id, following_id, created_at)
         VALUES ($1, $2, NOW() - INTERVAL '${randomBetween(1, 336)} hours')
         ON CONFLICT DO NOTHING`,
        [participantIds[followerIdx], participantIds[followingIdx]]
      );
      followCount++;
    }
  }
  console.log(`[SEED] Created ${followCount} follows`);

  // Summary
  console.log('');
  console.log(`[SEED] ✓ Created ${participantIds.length} participants, ${walkRows.length} walks, ${likeCount} likes, ${commentCount} comments, ${followCount} follows`);
  console.log(`[SEED] Done! Run \`npm run dev\` and browse /community to see test data.`);

  await pool.end();
}

run().catch((err) => {
  console.error('[SEED] FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
