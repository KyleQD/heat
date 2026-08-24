-- P3 — Native submission metadata: creation audit trail + moderation baseline.
CREATE TABLE IF NOT EXISTS native_event_submissions (
  id                   UUID PRIMARY KEY,
  event_id             UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  creator_user_id      UUID NOT NULL REFERENCES users(id),
  submitted_payload    JSONB NOT NULL,
  duplicate_candidates JSONB,
  moderation_state     TEXT NOT NULL DEFAULT 'auto_published'
                       CHECK (moderation_state IN ('auto_published','flagged','under_review','approved','rejected')),
  idempotency_key      TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT native_submissions_idem UNIQUE (idempotency_key)
);

-- Rollback: DROP TABLE IF EXISTS native_event_submissions;
