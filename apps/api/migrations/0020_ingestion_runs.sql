-- Phase D — ingestion run telemetry (observability requirement per doc 04 §11).
CREATE TABLE IF NOT EXISTS ingestion_runs (
  id                UUID PRIMARY KEY,
  provider          TEXT NOT NULL CHECK (provider IN ('ticketmaster','seatgeek','predicthq','places')),
  scope             TEXT NOT NULL DEFAULT 'las_vegas_nv',
  status            TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','success','partial','failed')),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  records_received  INTEGER NOT NULL DEFAULT 0,
  records_created   INTEGER NOT NULL DEFAULT 0,
  records_attached  INTEGER NOT NULL DEFAULT 0,
  records_updated   INTEGER NOT NULL DEFAULT 0,
  records_failed    INTEGER NOT NULL DEFAULT 0,
  request_count     INTEGER NOT NULL DEFAULT 0,
  rate_limit_events INTEGER NOT NULL DEFAULT 0,
  error_summary     TEXT
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_provider_time
  ON ingestion_runs (provider, started_at DESC);

-- Rollback: DROP TABLE IF EXISTS ingestion_runs;
