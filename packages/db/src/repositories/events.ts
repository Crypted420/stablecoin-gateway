import { db, isUniqueViolation, type Executor } from "../pool.js";

export async function claimEvent(
  eventKey: string,
  consumer: string,
  x: Executor = db()
): Promise<boolean> {
  try {
    const { rowCount } = await x.query(
      "INSERT INTO processed_events (event_key, consumer) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [`${consumer}:${eventKey}`, consumer]
    );
    return (rowCount ?? 0) > 0;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

export async function recordDeadLetter(
  input: { stream: string; consumer: string; payload: unknown; error: string; attempts: number },
  x: Executor = db()
): Promise<void> {
  const eventId =
    typeof input.payload === "object" && input.payload !== null && "eventId" in input.payload
      ? String((input.payload as { eventId: unknown }).eventId)
      : null;
  await x.query(
    `INSERT INTO dead_letters (stream, consumer, payload, error, attempts, event_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (consumer, event_id) WHERE event_id IS NOT NULL
     DO UPDATE SET error = EXCLUDED.error, attempts = GREATEST(dead_letters.attempts, EXCLUDED.attempts)`,
    [input.stream, input.consumer, JSON.stringify(input.payload), input.error, input.attempts, eventId]
  );
}

export async function listDeadLetters(limit = 50, x: Executor = db()) {
  const { rows } = await x.query(
    "SELECT * FROM dead_letters WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT $1",
    [limit]
  );
  return rows;
}
