-- P0 — City configuration. City logic is data, not code.
CREATE TABLE IF NOT EXISTS city_configs (
  city_key        TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  timezone        TEXT NOT NULL,
  center_lat      DOUBLE PRECISION NOT NULL,
  center_lng      DOUBLE PRECISION NOT NULL,
  bounds          JSONB NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  tonight_start_hour_local SMALLINT NOT NULL DEFAULT 16 CHECK (tonight_start_hour_local BETWEEN 0 AND 23),
  tonight_end_hour_local   SMALLINT NOT NULL DEFAULT 6  CHECK (tonight_end_hour_local BETWEEN 0 AND 23),
  map_default_zoom NUMERIC(4,1) NOT NULL DEFAULT 13.0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rollback: DROP TABLE IF EXISTS city_configs;
