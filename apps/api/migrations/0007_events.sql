-- P2-M005 — Canonical events. The ONLY identity mobile relies on: events.id.
CREATE TABLE IF NOT EXISTS events (
  id                 UUID PRIMARY KEY,
  title              TEXT NOT NULL,
  normalized_title   TEXT NOT NULL,
  description        TEXT,
  category_id        INTEGER NOT NULL REFERENCES event_categories(id),
  venue_id           UUID REFERENCES venues(id),
  location           geography(Point,4326) NOT NULL,
  locality           TEXT,
  region             TEXT,
  country_code       CHAR(2),
  timezone           TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  starts_at          TIMESTAMPTZ NOT NULL,
  ends_at            TIMESTAMPTZ,
  -- Uncertainty is preserved, never invented (normalized contract).
  starts_at_precision TEXT NOT NULL DEFAULT 'exact'
                      CHECK (starts_at_precision IN ('exact','time_tbd','date_tbd','date_only')),
  -- null end time is preserved (unknown), never invented
  capacity           INTEGER CHECK (capacity IS NULL OR capacity > 0),
  price_min          NUMERIC(10,2) CHECK (price_min IS NULL OR price_min >= 0),
  price_max          NUMERIC(10,2) CHECK (price_max IS NULL OR price_max >= 0),
  currency           CHAR(3),
  canonical_ticket_url TEXT,
  cover_image_url    TEXT,
  age_restriction    TEXT,
  status             TEXT NOT NULL DEFAULT 'scheduled'
                     CHECK (status IN ('scheduled','canceled','postponed','moved','completed')),
  verification_level TEXT NOT NULL DEFAULT 'community'
                     CHECK (verification_level IN ('community','source_verified','multi_source_verified','claimed','verified_organizer','verified_venue','staff_verified')),
  visibility_status  TEXT NOT NULL DEFAULT 'published'
                     CHECK (visibility_status IN ('published','hidden','removed','pending_review')),
  heat_score         NUMERIC(5,2) CHECK (heat_score IS NULL OR (heat_score >= 0 AND heat_score <= 100)),
  heat_confidence    NUMERIC(5,2) CHECK (heat_confidence IS NULL OR (heat_confidence >= 0 AND heat_confidence <= 100)),
  attendance_low     INTEGER,
  attendance_high    INTEGER,
  attendance_estimate_type TEXT NOT NULL DEFAULT 'unknown'
                     CHECK (attendance_estimate_type IN ('unknown','pre_event_forecast','intent_adjusted_forecast','live_estimate','organizer_reported','verified_count')),
  stars_count        INTEGER NOT NULL DEFAULT 0,
  source_count       INTEGER NOT NULL DEFAULT 0,
  created_by         UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ,
  CONSTRAINT events_time_order CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

-- Rollback: DROP TABLE IF EXISTS events;
