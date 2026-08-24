-- P2-M003 — Canonical venues/places. Provider IDs live in venue_sources.
CREATE TABLE IF NOT EXISTS venues (
  id               UUID PRIMARY KEY,
  name             TEXT NOT NULL,
  normalized_name  TEXT NOT NULL,
  slug             TEXT UNIQUE,
  location         geography(Point,4326) NOT NULL,
  street_address   TEXT,
  locality         TEXT,
  region           TEXT,
  postal_code      TEXT,
  country_code     CHAR(2),
  timezone         TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  capacity         INTEGER CHECK (capacity IS NULL OR capacity > 0),
  place_type       TEXT,
  google_place_id  TEXT,
  overture_id      TEXT,
  gers_id          TEXT,
  verified_owner_id UUID REFERENCES users(id),
  verification_level TEXT NOT NULL DEFAULT 'community'
                     CHECK (verification_level IN ('community','source_verified','multi_source_verified','claimed','verified_organizer','verified_venue','staff_verified')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT venues_name_len CHECK (char_length(name) BETWEEN 1 AND 200)
);

-- Rollback: DROP TABLE IF EXISTS venues;
