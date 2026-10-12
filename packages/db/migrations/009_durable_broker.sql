CREATE TABLE IF NOT EXISTS broker_events (
  event_id UUID PRIMARY KEY,
  ordinal BIGSERIAL UNIQUE NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS broker_deliveries (
  group_name TEXT NOT NULL,
  event_id UUID NOT NULL REFERENCES broker_events(event_id) ON DELETE RESTRICT,
  consumer_name TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acked_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_name, event_id)
);

CREATE INDEX IF NOT EXISTS broker_pending_deliveries
  ON broker_deliveries (group_name, locked_at) WHERE acked_at IS NULL;

CREATE TABLE IF NOT EXISTS broker_dead_letters (
  group_name TEXT NOT NULL,
  event_id UUID NOT NULL REFERENCES broker_events(event_id) ON DELETE RESTRICT,
  error TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_name, event_id)
);
