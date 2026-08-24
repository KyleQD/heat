-- P0/P4 — First-party interaction telemetry on canonical events.
-- Privacy: no exact coordinates in metadata; broad buckets only.
CREATE TABLE IF NOT EXISTS event_interactions (
  id                   BIGSERIAL PRIMARY KEY,
  user_id              UUID REFERENCES users(id),
  anonymous_session_id TEXT,
  event_id             UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  interaction_type     TEXT NOT NULL
                       CHECK (interaction_type IN ('impression','select','expand','star','unstar','ticket_click','route_preview','navigation_start','create_duplicate_view','report')),
  occurred_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT interactions_no_exact_geo CHECK (
    NOT (metadata ? 'lat') AND NOT (metadata ? 'lng') AND NOT (metadata ? 'originLat')
  )
);

-- Rollback: DROP TABLE IF EXISTS event_interactions;
