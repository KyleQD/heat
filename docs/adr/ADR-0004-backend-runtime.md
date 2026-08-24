# ADR-0004 — Backend: TypeScript modular monolith (Fastify)

**Status:** Accepted (matches suite recommendation)

## Decision
Single deployable Fastify service with module boundaries
(map/events/stars/routing/native-events/search/config), zod validation at the
API boundary (@heat/api-contracts), structured logs with request IDs and
redacted auth headers, rate limiting, idempotency keys for creation.
Background jobs (ingestion/HEAT recalculation) attach later without contract churn.
