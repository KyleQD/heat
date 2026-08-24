-- P6 — Route intent. ADR-0007: exact route origin is NEVER persisted.
-- Only broad geo bucket + distance/duration metrics are stored.
CREATE TABLE IF NOT EXISTS event_route_requests (
  id                    UUID PRIMARY KEY,
  user_id               UUID REFERENCES users(id),
  session_id            TEXT,
  event_id              UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  mode                  TEXT NOT NULL CHECK (mode IN ('drive','walk','transit','bike')),
  origin_geo_bucket     TEXT,
  distance_meters       INTEGER,
  duration_seconds      INTEGER,
  provider              TEXT,
  heat_score_snapshot   NUMERIC(5,2),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  external_navigation_started_at TIMESTAMPTZ
  -- ADR-0007: raw origin coordinates are never persisted; only this broad
  -- ~5 km grid bucket label (e.g. "g721_-2304") plus distance metrics.
);

CREATE TABLE IF NOT EXISTS navigation_starts (
  id              UUID PRIMARY KEY,
  route_request_id UUID REFERENCES event_route_requests(id),
  user_id         UUID REFERENCES users(id),
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  mode            TEXT NOT NULL CHECK (mode IN ('drive','walk','transit','bike')),
  provider        TEXT NOT NULL CHECK (provider IN ('apple_maps','google_maps')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rollback: DROP TABLE IF EXISTS navigation_starts; DROP TABLE IF EXISTS event_route_requests;
