CREATE TABLE IF NOT EXISTS merchants (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_name        VARCHAR(150) NOT NULL,
  bank_account_number VARCHAR(20)  NOT NULL,
  bank_name           VARCHAR(100) NOT NULL,
  bank_code           VARCHAR(10)  NOT NULL,
  account_verified    BOOLEAN      NOT NULL DEFAULT FALSE,
  webhook_url         TEXT,
  status              VARCHAR(20)  NOT NULL DEFAULT 'active',
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT merchants_status_check CHECK (status IN ('active', 'suspended')),
  CONSTRAINT merchants_bank_identity UNIQUE (bank_account_number, bank_code)
);

CREATE TABLE IF NOT EXISTS invoices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id      UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  reference        VARCHAR(64) NOT NULL UNIQUE,
  amount_expected  NUMERIC(24,8) NOT NULL CHECK (amount_expected > 0),
  token_symbol     VARCHAR(10) NOT NULL,
  network          VARCHAR(20) NOT NULL,
  deposit_address  VARCHAR(42) NOT NULL UNIQUE,
  derivation_index INTEGER NOT NULL UNIQUE,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending',
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT invoices_token_check CHECK (token_symbol IN ('USDT', 'USDC', 'cNGN')),
  CONSTRAINT invoices_network_check CHECK (network IN ('ethereum', 'polygon', 'bsc')),
  CONSTRAINT invoices_status_check CHECK (status IN ('pending','detected','confirmed','settled','expired'))
);

CREATE INDEX IF NOT EXISTS invoices_deposit_address_idx ON invoices (lower(deposit_address));
CREATE INDEX IF NOT EXISTS invoices_merchant_created_idx ON invoices (merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS invoices_status_expires_idx ON invoices (status, expires_at);

CREATE TABLE IF NOT EXISTS payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  tx_hash       VARCHAR(66) NOT NULL,
  log_index     INTEGER NOT NULL,
  from_address  VARCHAR(42) NOT NULL,
  amount_raw    NUMERIC(78,0) NOT NULL CHECK (amount_raw > 0),
  block_number  BIGINT NOT NULL,
  confirmations INTEGER NOT NULL DEFAULT 0,
  status        VARCHAR(20) NOT NULL DEFAULT 'detected',
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at  TIMESTAMPTZ,
  CONSTRAINT payments_natural_key UNIQUE (tx_hash, log_index),
  CONSTRAINT payments_status_check CHECK (status IN ('detected','confirmed','underpaid','overpaid','orphaned'))
);

CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status);
CREATE INDEX IF NOT EXISTS payments_invoice_idx ON payments (invoice_id);

CREATE TABLE IF NOT EXISTS settlements (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id         UUID NOT NULL UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,
  quote_rate         NUMERIC(20,8),
  quote_locked_at    TIMESTAMPTZ,
  amount_ngn         NUMERIC(20,2) NOT NULL CHECK (amount_ngn > 0),
  provider_reference VARCHAR(100) UNIQUE,
  status             VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts           INTEGER NOT NULL DEFAULT 0,
  last_error         TEXT,
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT settlements_status_check CHECK (status IN ('pending','submitted','completed','failed','dead_lettered'))
);

CREATE INDEX IF NOT EXISTS settlements_status_idx ON settlements (status);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id UUID NOT NULL REFERENCES settlements(id) ON DELETE RESTRICT,
  account       VARCHAR(50) NOT NULL,
  direction     VARCHAR(6) NOT NULL CHECK (direction IN ('debit','credit')),
  amount        NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  currency      VARCHAR(10) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ledger_entries_settlement_idx ON ledger_entries (settlement_id);

CREATE TABLE IF NOT EXISTS processed_events (
  event_key    VARCHAR(120) PRIMARY KEY,
  consumer     VARCHAR(60) NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dead_letters (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream      VARCHAR(60) NOT NULL,
  consumer    VARCHAR(60) NOT NULL,
  payload     JSONB NOT NULL,
  error       TEXT NOT NULL,
  attempts    INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION ledger_entries_no_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only; record a compensating entry instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entries_immutable ON ledger_entries;
CREATE TRIGGER ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_no_mutation();
