import { getPool } from "./pool.js";
import { runMigrations } from "./migrate.js";
import { loadEnv } from "../env.js";

const direction = process.argv[2] === "down" ? "down" : "up";
const env = loadEnv();
const applied = await runMigrations(getPool(env), direction);
if (applied.length === 0) {
  console.log(`No migrations ${direction === "up" ? "to apply" : "to roll back"}.`);
} else {
  console.log(`${direction === "up" ? "Applied" : "Rolled back"}: ${applied.join(", ")}`);
}
process.exit(0);
