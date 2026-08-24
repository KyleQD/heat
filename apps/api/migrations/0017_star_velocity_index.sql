-- P11 perf — covering index so hourly star-velocity aggregates are index-only.
CREATE INDEX IF NOT EXISTS idx_stars_velocity_active
  ON event_stars (event_id, created_at)
  INCLUDE (user_id)
  WHERE removed_at IS NULL;

-- Rollback: DROP INDEX IF EXISTS idx_stars_velocity_active;
