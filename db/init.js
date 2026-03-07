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
      DROP TABLE IF EXISTS walk_likes CASCADE;
      DROP TABLE IF EXISTS walks CASCADE;
      DROP TABLE IF EXISTS location_pings CASCADE;
      DROP TABLE IF EXISTS tracking_sessions CASCADE;
      DROP TABLE IF EXISTS bridges CASCADE;
      DROP TABLE IF EXISTS "session" CASCADE;
      DROP TABLE IF EXISTS participants CASCADE;
    `);
  }

  console.log('Applying schema...');
  await pool.query(schema);

  console.log('Seeding bridges...');
  await pool.query(seed);

  // Add any missing columns to existing tables
  const migrations = [
    `ALTER TABLE participants ADD COLUMN IF NOT EXISTS strava_sync_types VARCHAR(255) DEFAULT 'Walk,Hike,Run'`,
    `ALTER TABLE walks ADD COLUMN IF NOT EXISTS activity_type VARCHAR(30)`,
  ];
  for (const sql of migrations) {
    await pool.query(sql).catch(() => {});
  }

  console.log(reset ? 'Database reset complete.' : 'Database initialized.');
  await pool.end();
}

run().catch((err) => {
  console.error('DB init failed:', err.message);
  process.exit(1);
});
