-- P5 — Stars: persistent intent signal. A star means "interested", never attendance.
CREATE TABLE IF NOT EXISTS event_stars (
  id                       UUID PRIMARY KEY,
  event_id                 UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at               TIMESTAMPTZ,
  event_start_at_snapshot  TIMESTAMPTZ,
  heat_score_snapshot      NUMERIC(5,2),
  distance_bucket          TEXT,
  source_surface           TEXT,
  -- One ACTIVE star per (user, event): enforced by partial unique index below
  -- (table-level UNIQUE treats NULLs as distinct and would allow duplicates).
  CONSTRAINT event_stars_removed_order CHECK (removed_at IS NULL OR removed_at >= created_at)
);

-- Partial unique active-star index (P5-002). Unstar preserves history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_stars_active
  ON event_stars (user_id, event_id)
  WHERE removed_at IS NULL;

-- Rollback: DROP TABLE IF EXISTS event_stars;
