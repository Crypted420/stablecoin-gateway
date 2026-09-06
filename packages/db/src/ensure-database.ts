import pg from "pg";
import { config, createLogger } from "@gateway/core";

const log = createLogger("migrate");
const CREATE_LOCK = 8171923456789n;

export async function ensureDatabase(): Promise<void> {
  const url = new URL(config().DATABASE_URL);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!name) return;

  const admin = new URL(url.toString());
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });

  try {
    await client.connect();
  } catch {
    return;
  }

  try {
    await client.query("SELECT pg_advisory_lock($1)", [CREATE_LOCK.toString()]);
    const { rows } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (rows.length === 0) {
      await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
      log.info("database created", { name });
    }
  } catch (error) {
    if ((error as { code?: string })?.code !== "42P04") {
      log.warn("could not create the database, continuing", {
        name,
        error: String((error as { message?: string })?.message ?? error)
      });
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [CREATE_LOCK.toString()]).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}
