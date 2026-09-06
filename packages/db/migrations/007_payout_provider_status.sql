ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS provider_status VARCHAR(30);

UPDATE settlements
   SET provider_status = 'success'
 WHERE status = 'completed'
   AND provider_status IS NULL;

CREATE INDEX IF NOT EXISTS settlements_submitted_status_idx
  ON settlements (submitted_at)
  WHERE status = 'submitted';
