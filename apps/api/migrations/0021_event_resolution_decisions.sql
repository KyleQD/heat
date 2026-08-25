-- Phase E — auditable, reversible resolution decisions.
CREATE TABLE IF NOT EXISTS event_resolution_decisions (
  id                  UUID PRIMARY KEY,
  source_event_id     UUID NOT NULL REFERENCES event_sources(id),
  candidate_event_id  UUID REFERENCES events(id),
  decision            TEXT NOT NULL CHECK (decision IN
                      ('auto_match','manual_match','new_event','rejected_match','split')),
  match_score         NUMERIC(4,3) CHECK (match_score BETWEEN 0 AND 1),
  title_score         NUMERIC(4,3),
  venue_score         NUMERIC(4,3),
  time_score          NUMERIC(4,3),
  category_score      NUMERIC(4,3),
  rule_version        TEXT NOT NULL,
  decided_by          TEXT NOT NULL DEFAULT 'engine',
  reversed_at         TIMESTAMPTZ,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resolution_source ON event_resolution_decisions (source_event_id);

-- Rollback: DROP TABLE IF EXISTS event_resolution_decisions;
