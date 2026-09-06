ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS network VARCHAR(20),
  ADD COLUMN IF NOT EXISTS token_symbol VARCHAR(10),
  ADD COLUMN IF NOT EXISTS block_hash VARCHAR(66);

UPDATE payments p
   SET network = i.network,
       token_symbol = i.token_symbol
  FROM invoices i
 WHERE i.id = p.invoice_id
   AND (p.network IS NULL OR p.token_symbol IS NULL);

ALTER TABLE payments
  ALTER COLUMN network SET NOT NULL,
  ALTER COLUMN token_symbol SET NOT NULL;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_natural_key;
ALTER TABLE payments
  ADD CONSTRAINT payments_natural_key UNIQUE (network, tx_hash, log_index);

CREATE UNIQUE INDEX IF NOT EXISTS payments_one_per_invoice_idx ON payments (invoice_id);

CREATE SEQUENCE IF NOT EXISTS invoice_derivation_seq MINVALUE 0 START 0;
SELECT setval(
  'invoice_derivation_seq',
  COALESCE((SELECT MAX(derivation_index) + 1 FROM invoices), 0),
  false
);

ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

ALTER TABLE ledger_entries
  ADD COLUMN IF NOT EXISTS journal_key VARCHAR(160);

CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_journal_line_key
  ON ledger_entries (journal_key, account, direction)
  WHERE journal_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS outbox_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL UNIQUE,
  payload      JSONB NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at    TIMESTAMPTZ,
  locked_by    VARCHAR(100),
  published_at TIMESTAMPTZ,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE dead_letters ADD COLUMN IF NOT EXISTS event_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS dead_letters_consumer_event_idx
  ON dead_letters (consumer, event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS outbox_events_ready_idx
  ON outbox_events (available_at, created_at)
  WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  event_id       UUID PRIMARY KEY,
  merchant_id    UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  webhook_url    TEXT NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts       INTEGER NOT NULL DEFAULT 0,
  response_code  INTEGER,
  last_error     TEXT,
  delivered_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT webhook_delivery_status_check
    CHECK (status IN ('pending','delivered','failed','dead_lettered'))
);

CREATE TABLE IF NOT EXISTS reconciliation_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start TIMESTAMPTZ NOT NULL,
  period_end   TIMESTAMPTZ NOT NULL,
  report       JSONB NOT NULL,
  balanced     BOOLEAN NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reconciliation_reports_created_idx
  ON reconciliation_reports (created_at DESC);
