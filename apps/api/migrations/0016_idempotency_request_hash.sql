-- P3-011 hardening — detect Idempotency-Key reuse with a DIFFERENT payload.
ALTER TABLE native_event_submissions
  ADD COLUMN IF NOT EXISTS request_hash TEXT;

-- Rollback: ALTER TABLE native_event_submissions DROP COLUMN IF EXISTS request_hash;
