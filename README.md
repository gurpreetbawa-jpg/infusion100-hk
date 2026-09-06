# Infusion100 HK

Full-stack web app for the **Infusion100 Lantau Charity Walk 2026** — a 100km
event on Saturday, 12 December 2026 on Lantau Island, Hong Kong, raising funds
for the 2027 Infusion100 School Build in Nepal. Participants track training
walks, log GPX routes, view leaderboards, and engage via likes/comments.

## Credits

This project is a fork of [rajshahuk/infusion100](https://github.com/rajshahuk/infusion100),
the platform originally built by **Raj Shah and team** for the Infusion100
London walk. Huge thanks to Raj and the team for their work — this HK edition
builds directly on their foundation.

## Stack

- **Backend:** Node.js + Express 5, PostgreSQL (raw SQL via `pg`, no ORM)
- **Auth:** Passport.js OAuth (Google, GitHub, Strava) with encrypted token storage
- **Frontend:** Vanilla HTML/CSS/JS as a PWA (Leaflet.js maps, service worker, Web Push)
- **Images:** Multer + Sharp (auto WebP compression)
- **Deploy:** Render (auto-deploy from `main`)

## Quick Start

```bash
bash setup.sh          # first-time setup: checks Node/Postgres, creates DB, seeds data
cp .env.example .env   # configure OAuth keys, VAPID keys, DATABASE_URL, ADMIN_EMAILS
npm run dev            # http://localhost:3000
```

## Required Env Vars

- `DATABASE_URL` — Postgres connection string
- `SESSION_SECRET` — session signing key
- `ENCRYPTION_KEY` — 32-byte key for encrypting Strava tokens (AES-256-CBC)
- `ADMIN_EMAILS` — comma-separated admin email list
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — GitHub OAuth
- `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` — Strava OAuth (optional)
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` — Web Push

## Scripts

- `npm run dev` — dev server (nodemon)
- `npm start` — production server
- `npm run db:init` — idempotent schema migration
- `npm run db:reset` — drop all tables + reinit
- `npm run db:seed` — seed test data

## Project Layout

- `server.js` — entry point (Express, sessions, Passport, Web Push, jobs)
- `routes/` — `auth.js`, `api.js`, `admin.js`, `pages.js`
- `middleware/auth.js` — `isAuthenticated`, `isAdmin`, `isProfileComplete`
- `db/schema.sql` + `db/init.js` — schema and idempotent migrations
- `jobs/engagement-notifications.js` — 5-min push notification scheduler
- `config/feature-toggles.js` — e.g. `EVENT_DAY_TRACKING`
- `views/` — HTML pages with inline `<script>`
- `public/` — static assets, `sw.js` (bump `CACHE_VERSION` on JS/CSS changes)

## Deployment

See [DEPLOY.md](DEPLOY.md). Push to `main` triggers Render build:
`npm install && node db/init.js`.

## Additional Docs

- [CLAUDE.md](CLAUDE.md) — architecture guide for AI assistants
- [STATUS.md](STATUS.md) — current dev status
- [infusion100-requirements.md](infusion100-requirements.md) — original requirements
