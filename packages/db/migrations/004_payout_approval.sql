ALTER TABLE settlements DROP CONSTRAINT IF EXISTS settlements_status_check;
ALTER TABLE settlements
  ADD CONSTRAINT settlements_status_check
  CHECK (status IN (
    'pending', 'awaiting_approval', 'submitted', 'completed', 'failed', 'rejected', 'dead_lettered'
  ));

ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS approved_by  VARCHAR(120),
  ADD COLUMN IF NOT EXISTS approved_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_note TEXT;

CREATE INDEX IF NOT EXISTS settlements_awaiting_approval_idx
  ON settlements (created_at)
  WHERE status = 'awaiting_approval';
