# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Start dev server with hot reload (nodemon)
- `npm start` — Start production server
- `npm run db:init` — Initialize/migrate database schema (idempotent)
- `npm run db:reset` — Drop all tables and reinitialize
- `bash setup.sh` — Full first-time setup (checks Node/PostgreSQL, creates DB, seeds data)

No test suite is configured.

## Architecture

Full-stack Express.js app for a charity walk event (Infusion100). PostgreSQL database, vanilla JS frontend served as a PWA.

**Entry point:** `server.js` — sets up Express, session (connect-pg-simple), Passport OAuth, Web Push, mounts routes, starts engagement notification scheduler.

**Routes:**
- `routes/auth.js` — OAuth flows (Google, GitHub, Strava)
- `routes/api.js` — Participant-facing API (`isAuthenticated` per-route)
- `routes/admin.js` — Admin API (`router.use(isAdmin)` protects all routes)
- `routes/pages.js` — HTML page serving with auth/profile/feature-gate middleware

**Database:** Raw SQL with `pg` library (no ORM). Parameterized queries (`$1, $2, ...`). Schema in `db/schema.sql`, migrations in `db/init.js` (idempotent ALTER TABLE IF NOT EXISTS pattern).

**Auth:** Passport.js with Google, GitHub, Strava OAuth. Session-based (30-day). Admin role determined by `ADMIN_EMAILS` env var. Auto-links accounts by email.

**Frontend:** Vanilla HTML/CSS/JS — no build step. Views in `views/*.html` with inline `<script>` blocks. Shared utilities in `public/js/app.js` (App singleton with `fetchJSON()`, formatters, nav builder). Maps via Leaflet.js (OpenStreetMap tiles).

**Background jobs:** `jobs/engagement-notifications.js` — runs every 5 min, sends Web Push for new likes/comments. Scheduler in `server.js`.

**Key middleware** (`middleware/auth.js`): `isAuthenticated`, `isAdmin`, `isProfileComplete`. Admin middleware returns 403 JSON for `/admin/api/` paths, redirects otherwise.

**Feature toggles** (`config/feature-toggles.js`): `EVENT_DAY_TRACKING` gates event/leaderboard pages.

## Critical Patterns

**Service Worker caching:** `public/sw.js` uses `CACHE_VERSION` for cache-busting. Bump this value whenever modifying files in `public/js/` or `public/css/`.

**API responses:** Success returns `{ data: {...} }` or direct JSON. Errors return `{ error: "message" }` with appropriate status codes.

**Image uploads:** Multer (10MB limit) → Sharp compression to WebP (1200x1200 max, quality 75). Served from `/uploads/images`.

**Strava tokens:** Encrypted with AES-256-CBC via `config/encryption.js` using `ENCRYPTION_KEY` env var.

**Push notifications:** `push_subscriptions` table stores VAPID endpoints. Expired subscriptions (410/404) are auto-deleted.

## Style

- 2-space indentation, LF line endings, UTF-8 (see `.editorconfig`)
- CommonJS modules (`require`/`module.exports`)

## Git Commits

- Single one-line message, no multi-line body
- No Co-Authored-By or similar trailer lines

## Deployment

Hosted on Render (`render.yaml`). Build: `npm install && node db/init.js`. Push to main triggers deploy.
