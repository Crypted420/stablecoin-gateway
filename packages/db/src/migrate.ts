import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLogger } from "@gateway/core";
import { ensureDatabase } from "./ensure-database.js";
import { closeDb, db } from "./pool.js";

const log = createLogger("migrate");
const here = dirname(fileURLToPath(import.meta.url));

const MIGRATION_LOCK = "8171923456790";

export async function migrate(): Promise<void> {
  await ensureDatabase();

  const dir = join(here, "..", "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  const client = await db().connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
    );
    const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.name));

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(dir, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      log.info("migration applied", { file });
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";

if (import.meta.url === entrypoint) {
  migrate()
    .then(() => closeDb())
    .then(() => log.debug("migrations up to date"))
    .catch((error) => {
      log.error("migration failed", { error: String(error) });
      process.exitCode = 1;
    });
}
