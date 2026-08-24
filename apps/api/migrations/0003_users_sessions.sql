-- P0/ADR-0005 — Users. V1 uses anonymous sessions (auth-on-action).
-- Real identity providers attach later without changing canonical event schema.
CREATE TABLE IF NOT EXISTS users (
  id               UUID PRIMARY KEY,
  display_name     TEXT,
  auth_provider    TEXT NOT NULL DEFAULT 'anonymous'
                   CHECK (auth_provider IN ('anonymous','email','apple','google')),
  auth_provider_id TEXT,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (auth_provider, auth_provider_id)
);

CREATE INDEX IF NOT EXISTS idx_users_auth_provider_id ON users (auth_provider, auth_provider_id);

CREATE TABLE IF NOT EXISTS sessions (
  token     TEXT PRIMARY KEY,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

-- Rollback: DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS users;
