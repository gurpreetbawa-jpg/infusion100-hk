-- Infusion100 Database Schema

CREATE TABLE IF NOT EXISTS participants (
  id            SERIAL PRIMARY KEY,
  oauth_provider VARCHAR(20),
  oauth_id      VARCHAR(255) UNIQUE,
  email         VARCHAR(255) UNIQUE NOT NULL,
  full_name     VARCHAR(255),
  phone         VARCHAR(50),
  emergency_contact_name  VARCHAR(255),
  emergency_contact_phone VARCHAR(50),
  avatar_url    TEXT,
  strava_token  TEXT,
  strava_refresh_token TEXT,
  strava_token_expires_at BIGINT,
  strava_athlete_id BIGINT,
  strava_sync_types VARCHAR(255) DEFAULT 'Walk,Hike,Run',
  role          VARCHAR(20) DEFAULT 'participant',
  walking_on_day BOOLEAN DEFAULT FALSE,
  profile_complete BOOLEAN DEFAULT FALSE,
  gdpr_consent  BOOLEAN DEFAULT FALSE,
  last_engagement_notified_at TIMESTAMPTZ DEFAULT NOW(),
  registered_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS location_pings (
  id            SERIAL PRIMARY KEY,
  participant_id INT REFERENCES participants(id) ON DELETE CASCADE,
  lat           DECIMAL(9,6),
  lng           DECIMAL(9,6),
  recorded_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pings_participant ON location_pings(participant_id);
CREATE INDEX IF NOT EXISTS idx_pings_recorded ON location_pings(recorded_at);

CREATE TABLE IF NOT EXISTS tracking_sessions (
  id            SERIAL PRIMARY KEY,
  participant_id INT REFERENCES participants(id) ON DELETE CASCADE,
  status        VARCHAR(20) DEFAULT 'active',
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  stopped_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS walks (
  id            SERIAL PRIMARY KEY,
  participant_id INT REFERENCES participants(id) ON DELETE CASCADE,
  date          TIMESTAMPTZ,
  distance_km   DECIMAL(8,2),
  duration_mins INT,
  caption       TEXT,
  description   TEXT,
  gpx_path      TEXT,
  image_path    TEXT,
  polyline      TEXT,
  strava_id     BIGINT UNIQUE,
  activity_type VARCHAR(30),
  is_event_day  BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_walks_participant ON walks(participant_id);
CREATE INDEX IF NOT EXISTS idx_walks_date ON walks(date);

CREATE TABLE IF NOT EXISTS walk_likes (
  walk_id       INT REFERENCES walks(id) ON DELETE CASCADE,
  participant_id INT REFERENCES participants(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (walk_id, participant_id)
);

CREATE TABLE IF NOT EXISTS walk_comments (
  id            SERIAL PRIMARY KEY,
  walk_id       INT REFERENCES walks(id) ON DELETE CASCADE,
  participant_id INT REFERENCES participants(id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bridges (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100),
  lat           DECIMAL(9,6),
  lng           DECIMAL(9,6),
  order_index   INT
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  participant_id INTEGER REFERENCES participants(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  keys_p256dh TEXT NOT NULL,
  keys_auth TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Session store table for connect-pg-simple
CREATE TABLE IF NOT EXISTS "session" (
  "sid" VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  "sess" JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL
) WITH (OIDS=FALSE);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
