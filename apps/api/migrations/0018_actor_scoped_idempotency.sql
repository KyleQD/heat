-- R2-003 — Idempotency keys are scoped per actor. A global unique key let one
-- user's retry key collide with another user's unrelated publish.
ALTER TABLE native_event_submissions
  DROP CONSTRAINT IF EXISTS native_submissions_idem;

-- Backfill creator for legacy NULL-safe uniqueness is unnecessary in dev;
-- composite unique covers all future rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_submissions_actor_key
  ON native_event_submissions (creator_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Rollback: DROP INDEX IF EXISTS uq_submissions_actor_key;
--   ALTER TABLE native_event_submissions
--     ADD CONSTRAINT native_submissions_idem UNIQUE (idempotency_key);
