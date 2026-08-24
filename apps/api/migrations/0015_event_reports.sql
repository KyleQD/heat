-- P13 baseline — user reports (moderation queue input).
CREATE TABLE IF NOT EXISTS event_reports (
  id             UUID PRIMARY KEY,
  event_id       UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  reporter_user_id UUID REFERENCES users(id),
  reason         TEXT NOT NULL CHECK (reason IN (
                   'duplicate','fake_event','canceled','postponed','wrong_location',
                   'wrong_time','wrong_venue','scam_ticket_link','unsafe_location',
                   'inappropriate_content','impersonation','other')),
  details        TEXT,
  status         TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','triaged','investigating','actioned','resolved','dismissed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ,
  resolved_by    UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_event_reports_event ON event_reports (event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_event_reports_open ON event_reports (status, created_at) WHERE status = 'open';

-- Rollback: DROP TABLE IF EXISTS event_reports;
