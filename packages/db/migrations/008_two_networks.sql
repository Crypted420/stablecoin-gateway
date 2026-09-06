ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_network_check;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_network_check CHECK (network IN ('polygon', 'bsc'));
