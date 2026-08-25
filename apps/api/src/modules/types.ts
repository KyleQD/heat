/** Shared module types. */
import type { Pool } from "pg";

/** Route modules need pool-level access (transactions via connect()). */
export type PgPoolLike = Pool;
