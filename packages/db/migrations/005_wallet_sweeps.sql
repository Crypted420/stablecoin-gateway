CREATE TABLE IF NOT EXISTS wallet_sweeps (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id           UUID NOT NULL UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,
  invoice_id           UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  network              VARCHAR(20) NOT NULL,
  token_symbol         VARCHAR(10) NOT NULL,
  deposit_address      VARCHAR(42) NOT NULL,
  derivation_index     INTEGER NOT NULL,
  treasury_address     VARCHAR(42) NOT NULL,
  token_balance_raw    NUMERIC(78,0),
  native_balance_raw   NUMERIC(78,0),
  required_gas_raw     NUMERIC(78,0),
  status               VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts             INTEGER NOT NULL DEFAULT 0,
  last_error           TEXT,
  completed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wallet_sweeps_status_check CHECK (
    status IN ('pending','funding','funded','sweeping','completed','empty','failed')
  )
);

CREATE INDEX IF NOT EXISTS wallet_sweeps_status_idx ON wallet_sweeps (status, updated_at);

CREATE TABLE IF NOT EXISTS wallet_sweep_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sweep_id         UUID NOT NULL REFERENCES wallet_sweeps(id) ON DELETE RESTRICT,
  kind             VARCHAR(10) NOT NULL CHECK (kind IN ('funding','sweep')),
  tx_hash          VARCHAR(66) NOT NULL UNIQUE,
  raw_transaction  TEXT NOT NULL,
  amount_raw       NUMERIC(78,0) NOT NULL CHECK (amount_raw > 0),
  status           VARCHAR(20) NOT NULL DEFAULT 'prepared'
                   CHECK (status IN ('prepared','submitted','confirmed','failed')),
  last_error       TEXT,
  submitted_at     TIMESTAMPTZ,
  confirmed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wallet_sweep_transactions_open_idx
  ON wallet_sweep_transactions (sweep_id, kind, created_at DESC)
  WHERE status IN ('prepared','submitted');
