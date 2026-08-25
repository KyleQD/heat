-- Phase C — runtime feature flags. Defaults live in @heat/config; rows here
-- override them per environment without a redeploy (doc 74 rollback levers).
CREATE TABLE IF NOT EXISTS feature_flag_overrides (
  key        TEXT PRIMARY KEY,
  enabled    BOOLEAN NOT NULL,
  reason     TEXT,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rollback: DROP TABLE IF EXISTS feature_flag_overrides;
