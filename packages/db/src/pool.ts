import pg from "pg";
import { config } from "@gateway/core";

pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => v);
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

let pool: pg.Pool | null = null;

export function db(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: config().DATABASE_URL, max: 10 });
  }
  return pool;
}

export type Executor = pg.Pool | pg.PoolClient;

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export const UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === UNIQUE_VIOLATION;
}

export function connectionHint(error: unknown): string | null {
  const message = String((error as { message?: string })?.message ?? error);
  if (/password authentication failed/i.test(message)) {
    return "The database rejected the password in DATABASE_URL. Run: pnpm db:setup";
  }
  if (/database .* does not exist/i.test(message)) {
    return "The database named in DATABASE_URL is missing and could not be created automatically. Run: pnpm db:setup";
  }
  if (/role .* does not exist/i.test(message)) {
    return "The role named in DATABASE_URL does not exist. Run: pnpm db:setup";
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|timeout/i.test(message)) {
    return "PostgreSQL is not reachable at DATABASE_URL. Run: pnpm infra:up && pnpm db:setup";
  }
  return null;
}
