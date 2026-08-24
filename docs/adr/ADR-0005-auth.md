# ADR-0005 — Auth: anonymous browsing + session-on-action

**Status:** Accepted

## Decision
Browsing requires no account (PR/ADR-0006 of suite). At the first state-changing
action (star/create/report), the client lazily mints an anonymous server session
(`POST /v1/auth/session`); tokens persist in Keychain. The pending-action model
(doc 25 §4) resumes interrupted actions after any future real sign-in flow
(provider selection deliberately deferred — flagged open item, reversible).

## Consequences
Stars already bind to durable server-side user rows, so account upgrade later
keeps intent history intact. No fake email flows were shipped to simulate auth.
