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
  console.log('[FIX-MIGRATION] Starting caption/description fix...');
  console.log(`[FIX-MIGRATION] DATABASE_URL: ${process.env.DATABASE_URL ? 'set' : 'NOT SET'}`);
  console.log(`[FIX-MIGRATION] NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);

  // Check current state
  const before = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(caption) AS has_caption,
      COUNT(description) AS has_description,
      COUNT(*) FILTER (WHERE caption IS NULL AND description IS NOT NULL AND strava_id IS NULL) AS needs_caption_restore,
      COUNT(*) FILTER (WHERE caption IS NOT NULL AND description IS NULL) AS needs_description_copy
    FROM walks
  `);
  const stats = before.rows[0];
  console.log(`[FIX-MIGRATION] Current state: ${stats.total} walks total, ${stats.has_caption} with caption, ${stats.has_description} with description`);
  console.log(`[FIX-MIGRATION]   Needs caption restore: ${stats.needs_caption_restore}`);
  console.log(`[FIX-MIGRATION]   Needs description copy: ${stats.needs_description_copy}`);

  // Step 1: Undo the bad migration — restore caption from description
  // where caption was wiped (non-Strava walks with null caption but existing description)
  const undo = await pool.query(
    `UPDATE walks SET caption = description
     WHERE strava_id IS NULL AND caption IS NULL AND description IS NOT NULL`
  );
  console.log(`[FIX-MIGRATION] Step 1: Restored caption for ${undo.rowCount} walk(s)`);

  // Step 2: Copy caption into description for walks that don't have one
  const copy = await pool.query(
    `UPDATE walks SET description = caption
     WHERE caption IS NOT NULL AND description IS NULL`
  );
  console.log(`[FIX-MIGRATION] Step 2: Copied caption to description for ${copy.rowCount} walk(s)`);

  // Verify final state
  const after = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(caption) AS has_caption,
      COUNT(description) AS has_description,
      COUNT(*) FILTER (WHERE caption IS NULL AND description IS NULL) AS both_null
    FROM walks
  `);
  const final = after.rows[0];
  console.log(`[FIX-MIGRATION] Final state: ${final.total} walks total, ${final.has_caption} with caption, ${final.has_description} with description, ${final.both_null} with neither`);

  await pool.end();
  console.log('[FIX-MIGRATION] Done.');
}

run().catch((err) => {
  console.error('[FIX-MIGRATION] FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
