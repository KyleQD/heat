-- P2-M004 — Venue source evidence (provider place identity). Raw payloads are
-- evidence and must never be deleted on merge.
CREATE TABLE IF NOT EXISTS venue_sources (
  id                UUID PRIMARY KEY,
  venue_id          UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL
                    CHECK (provider IN ('native','ticketmaster','seatgeek','predicthq','places')),
  external_venue_id TEXT NOT NULL,
  raw_payload       JSONB,
  source_url        TEXT,
  confidence        NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1),
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at    TIMESTAMPTZ,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT venue_sources_provider_external UNIQUE (provider, external_venue_id)
);

-- Rollback: DROP TABLE IF EXISTS venue_sources;
