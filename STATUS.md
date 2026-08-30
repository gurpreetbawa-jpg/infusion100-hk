# Infusion100 HK — Dev Status

**Last updated:** 30 Aug 2026

## What's done

- [x] Cloned from `rajshahuk/infusion100` → `~/infusion-hk-walk`
- [x] PostgreSQL 16 installed via brew, DB `infusion100` created, schema + migrations applied
- [x] Full HK reskin committed (commit `2069abd`):
  - GPX route from `COURSE_485373830.gpx` (50.8 km, 611 pts) → `public/route.geojson`
  - 7 checkpoints: Discovery Bay → Mui Wo → Pui O → Shek Pik → Ngong Ping → Tai O → Tung Chung
  - Event date: Saturday 12 December 2026
  - Donation page: https://act.buildon.org/team/843985
  - Charity: 2027 School Build in Nepal
  - All map centres shifted to Lantau `[22.26, 113.94]`
  - All copy, titles, manifest updated
- [x] Remote origin set to `gurpreetbawa-jpg/infusion100-hk`
- [x] Server verified running at `http://localhost:3000`

## Not yet pushed

The commit is local only. Push blocked by HTTPS auth. Needs:

```
git remote set-url origin git@github.com:gurpreetbawa-jpg/infusion100-hk.git
git push origin main
```

(or use a personal access token with HTTPS)

## Not yet done / TODO

- [ ] **Checkpoint coords need verification** — current coords are best-guess for each location. User will confirm actual checkpoints.
- [ ] **OAuth credentials** — `.env` has empty `GOOGLE_CLIENT_ID`, `GITHUB_CLIENT_ID`, `STRAVA_CLIENT_ID`. Must be filled before login works.
- [ ] **ADMIN_EMAILS** — set in `.env` to enable `/admin` access.
- [ ] **VAPID keys** — generate for push notifications: `npx web-push generate-vapid-keys`
- [ ] **Render deployment** — blueprint in `render.yaml`, needs env vars set in dashboard.
- [ ] **Icons** — still using the London Infusion100 icons. HK-branded ones needed.
- [ ] **seed-test-data.js** — still has London sample data (Thames captions etc). Low priority.

## Running locally

```bash
# Start PostgreSQL
brew services start postgresql@16

# Start server
cd ~/infusion-hk-walk
npm start

# Stop PostgreSQL when done
brew services stop postgresql@16
```

## Key files

| File | Purpose |
|---|---|
| `COURSE_485373830.gpx` | Original Garmin course (2439 trackpoints) |
| `public/route.geojson` | Decimated route for Leaflet maps (611 pts) |
| `db/seed-bridges.sql` | 7 HK checkpoints |
| `.env` | Local config (gitignored, from `.env.example`) |
| `render.yaml` | Render deployment blueprint |
| `STATUS.md` | This file |