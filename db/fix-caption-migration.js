#!/usr/bin/env node
// One-off fix: the previous migration incorrectly moved caption → description and nulled caption.
// This script:
//   1. Restores caption from description for rows where the old migration wiped it
//   2. Copies caption into description for any walks still missing a description
//
// Safe to run multiple times — both queries are idempotent.
// Usage: node db/fix-caption-migration.js

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

async function run() {
  // Step 1: Undo the bad migration — restore caption from description
  // where caption was wiped (non-Strava walks with null caption but existing description)
  const undo = await pool.query(
    `UPDATE walks SET caption = description
     WHERE strava_id IS NULL AND caption IS NULL AND description IS NOT NULL`
  );
  console.log(`Restored caption for ${undo.rowCount} walk(s)`);

  // Step 2: Copy caption into description for walks that don't have one
  const copy = await pool.query(
    `UPDATE walks SET description = caption
     WHERE caption IS NOT NULL AND description IS NULL`
  );
  console.log(`Copied caption to description for ${copy.rowCount} walk(s)`);

  await pool.end();
  console.log('Done.');
}

run().catch((err) => {
  console.error('Migration fix failed:', err.message);
  process.exit(1);
});
