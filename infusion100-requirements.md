# Infusion100 — Website Requirements Document

## Overview

**Project name:** Infusion100  
**Event date:** Saturday, 16th May 2026  
**Event:** A sponsored charity walk across all the bridges of the River Thames in London  
**Format:** Participants choose their own start and end bridges, walking any subset of the route  
**Charity:** Infusion 100

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | Vanilla HTML5, CSS3, ES6 JavaScript (no frameworks) |
| Backend | Node.js with Express.js |
| Database | PostgreSQL |
| Auth | OAuth 2.0 via Google and Apple; Strava OAuth for activity linking |
| Maps | Leaflet.js (open source, no API cost) with OpenStreetMap tiles |
| Hosting | Self hosting on Linux, create script to setup the environment if needed |

---

## Design & Branding

- **Site name:** Infusion100
- **Visual style:** Clean, modern, and athletic — inspired by Strava's UI aesthetic. Bold typography, clear data visualisation, strong use of whitespace.
- **Colour palette (suggested):** Deep navy (`#1A1F36`) as primary, vibrant orange (`#FC4C02`, Strava orange) as accent, white and light grey for surfaces.
- **Typography (suggested):** Inter or DM Sans — clean sans-serif throughout.
- **Responsive:** Full mobile-first responsiveness required. The app will be used on phones during the walk.
- **Logo/favicon:** Charity logo + Infusion100 wordmark in the header. Placeholder to be swapped once confirmed.

---

## Site Structure

```
/                        → Public landing page
/register                → Registration / sign-up
/login                   → Login (OAuth)
/dashboard               → Participant dashboard (authenticated)
/walk/log                → Log a practice walk
/walk/:id                → View a single walk
/community               → Community feed (practice walks, comments, likes)
/stats                   → Personal stats page
/event                   → Event day page — live map & instructions
/leaderboard             → Public live map on event day
/admin                   → Admin dashboard (protected, admin role only)
/admin/participants      → Manage registrations & export data
/admin/map               → Live event map view
```

---

## Feature Specifications

---

### 1. Authentication & Accounts

#### OAuth Sign-in
- Participants register and log in using **Google** or **Apple** OAuth 2.0.
- No separate username/password system required.
- On first OAuth login, user is prompted to complete their profile (see Registration below).
- Session managed server-side using `express-session` with PostgreSQL session store.

#### Strava Linking
- Once logged in, participants can optionally **connect their Strava account** from their dashboard.
- Uses Strava OAuth 2.0 API.
- Linked accounts enable automatic import of Strava activities as practice walks (see Practice Walks).
- Users can unlink Strava at any time.

---

### 2. Registration

Triggered after first OAuth login. A one-time profile completion form collects:

| Field | Required | Notes |
|---|---|---|
| Full name | Yes | Pre-filled from OAuth where available |
| Email address | Yes | Pre-filled from OAuth, read-only |
| Phone number | Yes | Mobile preferred |
| Emergency contact name | Yes | |
| Emergency contact phone | Yes | |
| JustGiving / fundraising page URL | No | Link to their personal fundraising page |
| Start bridge | Yes | Dropdown of all Thames bridges |
| End bridge | Yes | Dropdown of all Thames bridges |

- Registration is **open to anyone** — no approval required. No registration deadline.
- No participant cap — unlimited registrations.
- Participant data is stored in the `participants` table in PostgreSQL.

---

### 3. Event Day — Live GPS Tracking

#### Participant Experience
- On event day (16th May 2026), the participant's dashboard shows an **"I'm walking — start tracking"** button.
- On activation, the browser requests **Geolocation API** permission.
- Location is polled every **30 seconds** (configurable) and sent via `POST /api/location` to the server.
- A banner shows their current status: tracking active / paused / stopped.
- Participants can **pause** or **stop** tracking at any time.
- GPS data is stored in the `location_pings` table with `participant_id`, `lat`, `lng`, `timestamp`.

#### Technical Notes
- Use `navigator.geolocation.watchPosition()` for continuous tracking.
- Gracefully handle permission denied — show a clear message explaining why it's needed.
- On mobile browsers, the page must remain open for tracking to continue; include a note advising participants not to close the tab. Consider a Wake Lock API call to prevent screen sleep.

---

### 4. Public Live Map (Event Day)

- A publicly accessible page at `/leaderboard` showing a **live Leaflet.js map**.
- Displays **all active participants** as markers on the Thames.
- Markers show participant's first name and a colour-coded indicator (walking / finished / not started).
- Map auto-refreshes every **30 seconds** via `GET /api/locations/live` on event day.
- **After the event**, the map remains live as a historical record, showing final positions with a "Walk completed" banner.
- The Thames bridge locations are pre-seeded as named markers on the map.
- No login required to view this page — it is fully public.
- Clicking a participant marker shows: name, bridges completed, distance walked (approximate).

---

### 5. Practice Walks

#### Logging a Walk Manually
- Authenticated participants can log a practice walk at `/walk/log`.
- Fields: date, distance (km/miles toggle), duration, route description, optional GPX file upload.
- If a GPX file is uploaded, the route is rendered on a Leaflet map preview.
- Walk is saved to the `walks` table.

#### Strava Auto-Import
- If Strava is linked, a **"Sync from Strava"** button on the dashboard fetches recent activities via the Strava API.
- Walks are imported with: date, distance, duration, map polyline (if available).
- Duplicate detection via Strava activity ID — no double imports.
- Imported walks are marked with a Strava badge in the UI.

#### Community Feed (`/community`)
- A scrollable feed of all participants' practice walks, most recent first.
- Each walk card shows: participant name + avatar, date, distance, route map thumbnail, any caption.
- **Likes:** Participants can like any walk. Like count shown on each card.
- **Comments / encouragement:** Participants can leave a short text comment on any walk. Comments are shown below the walk card, threaded simply (no nested replies needed).
- Comment and like actions require login.

#### Personal Stats Page (`/stats`)
- Shows the authenticated participant's cumulative stats:
  - Total distance logged (practice + event)
  - Number of walks
  - Longest single walk
  - Activity calendar heatmap (GitHub-style)
  - List of all their walks

---

### 6. Admin Dashboard

Access restricted to users with `role = 'admin'` in the database. Manually assigned.

#### Participants View (`/admin/participants`)
- Paginated table of all registered participants.
- Columns: name, email, phone, start/end bridge, registration date, JustGiving URL, Strava linked (Y/N).
- **Search and filter** by name or email.
- **Export to CSV** button — exports all participant data including email addresses and phone numbers.
- Click a row to view/edit full participant details.
- **Delete participant** — removes the record (GDPR compliance).

#### Live Event Map (`/admin/map`)
- Same live Leaflet map as the public leaderboard but with additional detail.
- Shows all participants including those not yet started.
- Includes last-ping timestamp for each participant.

---



## Database Schema (Outline)

```sql
-- Users / participants
CREATE TABLE participants (
  id            SERIAL PRIMARY KEY,
  oauth_provider VARCHAR(20),       -- 'google' | 'apple'
  oauth_id      VARCHAR(255) UNIQUE,
  email         VARCHAR(255) UNIQUE NOT NULL,
  full_name     VARCHAR(255),
  phone         VARCHAR(50),
  emergency_contact_name  VARCHAR(255),
  emergency_contact_phone VARCHAR(50),
  justgiving_url VARCHAR(500),
  start_bridge  VARCHAR(100),
  end_bridge    VARCHAR(100),
  strava_token  TEXT,               -- encrypted
  strava_athlete_id BIGINT,
  role          VARCHAR(20) DEFAULT 'participant',
  registered_at TIMESTAMPTZ DEFAULT NOW()
);

-- Location pings on event day
CREATE TABLE location_pings (
  id            SERIAL PRIMARY KEY,
  participant_id INT REFERENCES participants(id),
  lat           DECIMAL(9,6),
  lng           DECIMAL(9,6),
  recorded_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Practice and event walks
CREATE TABLE walks (
  id            SERIAL PRIMARY KEY,
  participant_id INT REFERENCES participants(id),
  date          DATE,
  distance_km   DECIMAL(8,2),
  duration_mins INT,
  caption       TEXT,
  gpx_path      TEXT,
  polyline      TEXT,               -- encoded polyline for map display
  strava_id     BIGINT UNIQUE,      -- null if manually logged
  is_event_day  BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Likes on walks
CREATE TABLE walk_likes (
  walk_id       INT REFERENCES walks(id),
  participant_id INT REFERENCES participants(id),
  PRIMARY KEY (walk_id, participant_id)
);

-- Comments on walks
CREATE TABLE walk_comments (
  id            SERIAL PRIMARY KEY,
  walk_id       INT REFERENCES walks(id),
  participant_id INT REFERENCES participants(id),
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Thames bridges (pre-seeded)
CREATE TABLE bridges (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100),
  lat           DECIMAL(9,6),
  lng           DECIMAL(9,6),
  order_index   INT             -- West to East ordering
);

```

---

## Thames Bridges Reference

Pre-seed the `bridges` table with all crossings from Teddington Lock to Tower Bridge (and beyond if desired). Key bridges include (West → East):

Teddington Lock, Kingston, Hampton Court, Walton, Chertsey, Staines, Richmond, Twickenham, Richmond Railway, Kew, Chiswick, Barnes Railway, Hammersmith, Putney Railway, Putney, Wandsworth, Battersea Railway, Battersea, Chelsea, Albert, Vauxhall, Lambeth, Westminster, Hungerford/Golden Jubilee, Waterloo, Blackfriars Railway, Blackfriars, Millennium, Southwark, London, Cannon Street Railway, Tower.

---

## API Endpoints (Outline)

```
POST   /auth/google            → Initiate Google OAuth
POST   /auth/apple             → Initiate Apple OAuth
GET    /auth/callback/:provider → OAuth callback handler
GET    /auth/strava            → Initiate Strava OAuth
DELETE /auth/logout            → Destroy session

GET    /api/me                 → Current user profile
PUT    /api/me                 → Update profile

POST   /api/location           → Submit GPS ping (authenticated, event day)
GET    /api/locations/live     → All live participant positions (public)

GET    /api/walks              → List walks (community feed, paginated)
POST   /api/walks              → Log a new walk
GET    /api/walks/:id          → Get a single walk
POST   /api/walks/:id/like     → Toggle like
POST   /api/walks/:id/comments → Post a comment

GET    /api/strava/sync        → Import recent Strava activities

GET    /admin/api/participants → List all participants (admin)
GET    /admin/api/participants/export → CSV export of all participant data incl. email & phone (admin)
PUT    /admin/api/participants/:id    → Edit participant (admin)
DELETE /admin/api/participants/:id   → Delete participant (admin, GDPR)
```

---

## Non-Functional Requirements

- **Security:** All routes that modify data require an authenticated session. Admin routes additionally check `role = 'admin'`. Strava tokens stored encrypted at rest. Rate-limit the `/api/location` endpoint.
- **Performance:** Location pings are lightweight — keep payload minimal. Community feed uses cursor-based pagination.
- **Accessibility:** Semantic HTML throughout. Sufficient colour contrast. Keyboard-navigable navigation.
- **Browser support:** Modern evergreen browsers (Chrome, Safari, Firefox, Edge). iOS Safari specifically tested for GPS tracking.
- **GDPR:** Privacy policy page required. Participants must tick a consent checkbox at registration. Data export / deletion on request (admin can delete a participant record).

---

## Out of Scope (v1)

- Native mobile app
- In-app payments or donation processing (deferred to JustGiving links)
- Group / team functionality
- Push notifications
- Offline mode

---

## Resolved Decisions

| Question | Decision |
|---|---|
| Charity name | Infusion 100 |
| Registration deadline | None — open indefinitely |
| Email system | Removed from v1. Admin can export CSV of all emails & phone numbers. |
| Participant cap | None |
| Post-event leaderboard | Remains live as a historical record |
| OAuth providers | Google + Apple (credentials setup — see below) |
| Strava | OAuth integration (credentials setup — see below) |

---

## Environment Variables

Once credentials are obtained (see setup guide below), create a `.env` file in the project root:

```
# Server
PORT=3000
SESSION_SECRET=your_random_secret_here

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/infusion100

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=https://yourdomain.com/auth/callback/google

# Apple OAuth
APPLE_CLIENT_ID=
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_PRIVATE_KEY_PATH=./config/apple_private_key.p8
APPLE_CALLBACK_URL=https://yourdomain.com/auth/callback/apple

# Strava OAuth
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_CALLBACK_URL=https://yourdomain.com/auth/callback/strava

# Encryption (for Strava token storage)
ENCRYPTION_KEY=your_32_char_random_key_here
```

---

## Credentials Setup Guide

### Recommended npm packages for OAuth

```
passport
passport-google-oauth20
passport-apple
passport-strava   (or handle Strava manually — it's straightforward)
```

---

### 1. Google OAuth Setup

**Time required:** ~10 minutes  
**Prerequisite:** A Google account

#### Steps

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com) and sign in.
2. Click the project dropdown at the top → **New Project** → give it a name (e.g. `infusion100`) → **Create**.
3. In the left menu go to **APIs & Services → OAuth consent screen**.
4. Choose **External** (allows any Google user to sign in) → **Create**.
5. Fill in:
   - App name: `Infusion100`
   - User support email: your email
   - Developer contact email: your email
   - Click **Save and Continue** through the remaining steps (scopes can be left as default for now).
6. Go to **APIs & Services → Credentials** → **+ Create Credentials → OAuth client ID**.
7. Application type: **Web application**.
8. Name: `Infusion100 Web`
9. Under **Authorised redirect URIs** add:
   - `http://localhost:3000/auth/callback/google` (for local development)
   - `https://yourdomain.com/auth/callback/google` (production — add once you have a domain)
10. Click **Create**. A dialog shows your **Client ID** and **Client Secret** — copy both into `.env`.

#### Scopes needed
`openid`, `email`, `profile` — these are requested automatically by `passport-google-oauth20`.

---

### 2. Apple Sign-In Setup

**Time required:** ~30 minutes  
**Prerequisite:** An Apple Developer account ($99/year at [developer.apple.com](https://developer.apple.com))

Apple's setup is more involved than Google's. Follow these steps carefully.

#### Step A — Register an App ID

1. Sign in at [https://developer.apple.com/account](https://developer.apple.com/account).
2. Go to **Certificates, Identifiers & Profiles → Identifiers → +**.
3. Select **App IDs** → **App** → Continue.
4. Description: `Infusion100`
5. Bundle ID (Explicit): e.g. `com.infusion100.web`
6. Scroll down and tick **Sign In with Apple** → Continue → Register.

#### Step B — Create a Services ID (this is what web apps use)

1. Go to **Identifiers → +** → select **Services IDs** → Continue.
2. Description: `Infusion100 Web`
3. Identifier: `com.infusion100.web.service` (must be different from the App ID)
4. Register, then click on the new Services ID to edit it.
5. Tick **Sign In with Apple** → Configure.
6. Primary App ID: select the App ID you just created.
7. Domains: add your domain (e.g. `yourdomain.com`)
8. Return URLs: add `https://yourdomain.com/auth/callback/apple`
9. Save → Continue → Register.
10. Note down the **Services ID identifier** — this is your `APPLE_CLIENT_ID`.

#### Step C — Create a Private Key

1. Go to **Keys → +**.
2. Name: `Infusion100 Sign In Key`
3. Tick **Sign In with Apple** → Configure → select your Primary App ID → Save.
4. Continue → Register.
5. **Download the `.p8` file immediately** — Apple only lets you download it once.
6. Place it at `./config/apple_private_key.p8` in your project (add this path to `.gitignore`).
7. Note down the **Key ID** — this is your `APPLE_KEY_ID`.

#### Step D — Find your Team ID

1. Go to [https://developer.apple.com/account](https://developer.apple.com/account) → top right corner shows your **Team ID** (10-character string).
2. This is your `APPLE_TEAM_ID`.

#### Notes
- Apple Sign-In **requires HTTPS**. You cannot test it on `localhost`. Use a tunnelling tool like [ngrok](https://ngrok.com) during development (`ngrok http 3000` gives you a public HTTPS URL to use as your callback).
- `passport-apple` handles the JWT client secret generation from your `.p8` key automatically.

---

### 3. Strava API Setup

**Time required:** ~10 minutes  
**Prerequisite:** A Strava account (free)

#### Steps

1. Go to [https://www.strava.com/settings/api](https://www.strava.com/settings/api) (sign in if prompted).
2. Fill in the application form:
   - **Application Name:** `Infusion100`
   - **Category:** `Charity`
   - **Club:** leave blank
   - **Website:** `https://yourdomain.com` (or `http://localhost:3000` temporarily)
   - **Application Description:** A charity walk tracking app for the Infusion 100 Thames bridges walk.
   - **Authorization Callback Domain:** `yourdomain.com` (just the domain, no path, no `https://`)
3. Agree to the API terms → **Create**.
4. Your app page now shows:
   - **Client ID** → `STRAVA_CLIENT_ID`
   - **Client Secret** → `STRAVA_CLIENT_SECRET`

#### Scopes needed
When redirecting users to Strava for authorisation, request:
```
scope=read,activity:read
```
This allows reading the user's public profile and their activities.

#### How the Strava OAuth flow works in the app
1. User clicks "Connect Strava" on their dashboard.
2. App redirects to `https://www.strava.com/oauth/authorize?client_id=...&scope=read,activity:read&response_type=code&redirect_uri=...`
3. User approves → Strava redirects to `/auth/callback/strava?code=...`
4. App exchanges the code for an access token + refresh token via `POST https://www.strava.com/oauth/token`.
5. Tokens are stored encrypted in the `participants` table.
6. When syncing, if the access token is expired, use the refresh token to get a new one automatically.

#### Strava API rate limits
- 100 requests per 15 minutes, 1,000 per day per app (free tier).
- This is ample for the number of participants expected.

---

### Local Development Checklist

Before running `node server.js` for the first time:

- [ ] PostgreSQL running locally, database `infusion100` created
- [ ] `.env` file created with all variables (see template above)
- [ ] Google OAuth credentials added to `.env`
- [ ] Apple credentials and `.p8` key file in place (or skipped until HTTPS available)
- [ ] Strava credentials added to `.env`
- [ ] `npm install` completed
- [ ] Database migrations / schema applied
- [ ] Bridges table seeded with Thames bridge data
