-- P2-M006 — Event source evidence. Provider identity attaches here; provider
-- IDs are evidence, never canonical identity. Raw payloads preserved.
CREATE TABLE IF NOT EXISTS event_sources (
  id                 UUID PRIMARY KEY,
  event_id           UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  provider           TEXT NOT NULL
                     CHECK (provider IN ('native','ticketmaster','seatgeek','predicthq','places')),
  external_event_id  TEXT NOT NULL,
  external_venue_id  TEXT,
  source_url         TEXT,
  raw_payload        JSONB,
  normalized_payload JSONB,
  source_priority    SMALLINT NOT NULL DEFAULT 50,
  source_confidence  NUMERIC(3,2) CHECK (source_confidence BETWEEN 0 AND 1),
  first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at     TIMESTAMPTZ,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  source_status      TEXT,
  CONSTRAINT event_sources_provider_external UNIQUE (provider, external_event_id)
);

-- Rollback: DROP TABLE IF EXISTS event_sources;
