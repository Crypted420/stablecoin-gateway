import { db, type Executor } from "../pool.js";

export async function beginDelivery(
  eventId: string,
  merchantId: string,
  webhookUrl: string,
  x: Executor = db()
): Promise<boolean> {
  const { rowCount } = await x.query(
    `INSERT INTO webhook_deliveries (event_id, merchant_id, webhook_url, attempts)
     VALUES ($1,$2,$3,1)
     ON CONFLICT (event_id) DO UPDATE
       SET attempts = webhook_deliveries.attempts + 1,
           status = 'pending',
           last_error = NULL
     WHERE webhook_deliveries.status <> 'delivered'`,
    [eventId, merchantId, webhookUrl]
  );
  return (rowCount ?? 0) > 0;
}

export async function markDelivered(eventId: string, responseCode: number, x: Executor = db()): Promise<void> {
  await x.query(
    `UPDATE webhook_deliveries
        SET status = 'delivered', response_code = $2, delivered_at = now(), last_error = NULL
      WHERE event_id = $1`,
    [eventId, responseCode]
  );
}

export async function markFailed(eventId: string, error: string, x: Executor = db()): Promise<void> {
  await x.query(
    "UPDATE webhook_deliveries SET status = 'failed', last_error = $2 WHERE event_id = $1",
    [eventId, error]
  );
}

export async function markDeadLettered(eventId: string, error: string, x: Executor = db()): Promise<void> {
  await x.query(
    "UPDATE webhook_deliveries SET status = 'dead_lettered', last_error = $2 WHERE event_id = $1",
    [eventId, error]
  );
}
