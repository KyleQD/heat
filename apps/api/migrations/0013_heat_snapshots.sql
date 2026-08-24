-- P11 groundwork — HEAT score history. Product rule: score history is stored,
-- confidence is stored separately from score, model versions are explicit.
CREATE TABLE IF NOT EXISTS event_heat_snapshots (
  id                    BIGSERIAL PRIMARY KEY,
  event_id              UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  calculated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  heat_score            NUMERIC(5,2) NOT NULL CHECK (heat_score BETWEEN 0 AND 100),
  heat_confidence       NUMERIC(5,2) CHECK (heat_confidence BETWEEN 0 AND 100),
  expected_score        NUMERIC(5,2),
  intent_score          NUMERIC(5,2),
  presence_score        NUMERIC(5,2),
  momentum_score        NUMERIC(5,2),
  attendance_low        INTEGER,
  attendance_high       INTEGER,
  trend                 TEXT,
  scoring_model_version TEXT NOT NULL,
  input_version         TEXT,
  diagnostic            JSONB
);

-- Rollback: DROP TABLE IF EXISTS event_heat_snapshots;
