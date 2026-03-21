#!/usr/bin/env node
// DB initialization script — runs schema.sql and seed-bridges.sql
// Usage: node db/init.js  (reads DATABASE_URL from .env or environment)

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

const reset = process.argv.includes('--reset');

async function run() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const seed = fs.readFileSync(path.join(__dirname, 'seed-bridges.sql'), 'utf8');

  if (reset) {
    console.log('Dropping all tables...');
    await pool.query(`
      DROP TABLE IF EXISTS walk_comments CASCADE;
      DROP TABLE IF EXISTS participant_follows CASCADE;
      DROP TABLE IF EXISTS walk_likes CASCADE;
      DROP TABLE IF EXISTS walks CASCADE;
      DROP TABLE IF EXISTS location_pings CASCADE;
      DROP TABLE IF EXISTS tracking_sessions CASCADE;
      DROP TABLE IF EXISTS bridges CASCADE;
      DROP TABLE IF EXISTS push_subscriptions CASCADE;
      DROP TABLE IF EXISTS "session" CASCADE;
      DROP TABLE IF EXISTS practice_walk_participants CASCADE;
      DROP TABLE IF EXISTS practice_walks CASCADE;
      DROP TABLE IF EXISTS participants CASCADE;
    `);
  }

  console.log('[DB INIT] Applying schema...');
  await pool.query(schema);
  console.log('[DB INIT] Schema applied');

  console.log('[DB INIT] Seeding bridges...');
  await pool.query(seed);
  console.log('[DB INIT] Bridges seeded');

  // Add any missing columns to existing tables
  const migrations = [
    `ALTER TABLE participants ADD COLUMN IF NOT EXISTS strava_sync_types VARCHAR(255) DEFAULT 'Walk,Hike,Run'`,
    `UPDATE participants SET strava_sync_types = 'Walk,Hike,Run' WHERE strava_sync_types = 'Walk,Hike'`,
    `ALTER TABLE walks ADD COLUMN IF NOT EXISTS activity_type VARCHAR(30)`,
    `ALTER TABLE walks ADD COLUMN IF NOT EXISTS image_path TEXT`,
    `ALTER TABLE participants DROP COLUMN IF EXISTS start_bridge`,
    `ALTER TABLE participants DROP COLUMN IF EXISTS end_bridge`,
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      participant_id INTEGER REFERENCES participants(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      keys_p256dh TEXT NOT NULL,
      keys_auth TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `ALTER TABLE walks ADD COLUMN IF NOT EXISTS description TEXT`,
    `ALTER TABLE walk_likes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE participants ADD COLUMN IF NOT EXISTS last_engagement_notified_at TIMESTAMPTZ DEFAULT NOW()`,
    // Copy caption into description for walks that don't have one yet
    `UPDATE walks SET description = caption WHERE caption IS NOT NULL AND description IS NULL`,
    // Clear description where it's just a duplicate of caption
    `UPDATE walks SET description = NULL WHERE caption = description`,
    `ALTER TABLE walks ALTER COLUMN date TYPE TIMESTAMPTZ USING date::timestamptz`,
    `ALTER TABLE participants ADD COLUMN IF NOT EXISTS walking_on_day BOOLEAN DEFAULT FALSE`,
    `CREATE TABLE IF NOT EXISTS participant_follows (
      follower_id INT REFERENCES participants(id) ON DELETE CASCADE,
      following_id INT REFERENCES participants(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (follower_id, following_id),
      CHECK (follower_id != following_id)
    )`,
    `ALTER TABLE walks ADD COLUMN IF NOT EXISTS mentions JSONB`,
    `CREATE TABLE IF NOT EXISTS deletion_requests (
      id SERIAL PRIMARY KEY,
      participant_id INTEGER REFERENCES participants(id) ON DELETE SET NULL,
      email VARCHAR(255) NOT NULL,
      full_name VARCHAR(255),
      reason TEXT,
      status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      resolved_by INTEGER REFERENCES participants(id) ON DELETE SET NULL
    )`,
    // Practice walks
    `CREATE TABLE IF NOT EXISTS practice_walks (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      walk_date DATE NOT NULL,
      walk_time TIME,
      created_by INT REFERENCES participants(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS practice_walk_participants (
      practice_walk_id INT REFERENCES practice_walks(id) ON DELETE CASCADE,
      participant_id INT REFERENCES participants(id) ON DELETE CASCADE,
      PRIMARY KEY (practice_walk_id, participant_id)
    )`,
    `ALTER TABLE tracking_sessions ADD COLUMN IF NOT EXISTS practice_walk_id INT REFERENCES practice_walks(id) ON DELETE SET NULL`,
    `ALTER TABLE location_pings ADD COLUMN IF NOT EXISTS practice_walk_id INT REFERENCES practice_walks(id) ON DELETE SET NULL`,
    `CREATE INDEX IF NOT EXISTS idx_tracking_practice ON tracking_sessions(practice_walk_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pings_practice ON location_pings(practice_walk_id)`,
  ];
  console.log(`[DB INIT] Running ${migrations.length} migrations...`);
  for (let i = 0; i < migrations.length; i++) {
    const sql = migrations[i];
    const preview = sql.replace(/\s+/g, ' ').trim().substring(0, 80);
    try {
      const result = await pool.query(sql);
      console.log(`[DB INIT]   [${i + 1}/${migrations.length}] OK (${result.rowCount ?? 0} rows): ${preview}...`);
    } catch (err) {
      console.error(`[DB INIT]   [${i + 1}/${migrations.length}] FAILED: ${preview}...`);
      console.error(`[DB INIT]     Error: ${err.message}`);
    }
  }

  console.log(`[DB INIT] ${reset ? 'Database reset complete.' : 'Database initialized.'}`);
  await pool.end();
}

run().catch((err) => {
  console.error('DB init failed:', err.message);
  process.exit(1);
});
