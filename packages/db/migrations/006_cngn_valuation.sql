ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_cngn_minimum_check;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_cngn_minimum_check
  CHECK (token_symbol <> 'cNGN' OR amount_expected >= 0.01);

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_cngn_precision_check;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_cngn_precision_check
  CHECK (token_symbol <> 'cNGN' OR amount_expected = trunc(amount_expected, 6));

ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS valuation_basis VARCHAR(20);

UPDATE settlements s
       SET valuation_basis = CASE WHEN p.token_symbol = 'cNGN' THEN 'par' ELSE 'market' END,
       quote_rate = CASE
         WHEN p.token_symbol = 'cNGN' THEN 1.00000000
         ELSE s.quote_rate
       END,
       quote_locked_at = CASE
         WHEN p.token_symbol = 'cNGN' THEN COALESCE(s.quote_locked_at, s.created_at)
         ELSE s.quote_locked_at
       END
  FROM payments p
 WHERE p.id = s.payment_id
   AND s.valuation_basis IS NULL;

UPDATE settlements
   SET valuation_basis = 'market'
 WHERE valuation_basis IS NULL;

ALTER TABLE settlements
  ALTER COLUMN valuation_basis SET DEFAULT 'market',
  ALTER COLUMN valuation_basis SET NOT NULL;

ALTER TABLE settlements DROP CONSTRAINT IF EXISTS settlements_valuation_basis_check;
ALTER TABLE settlements
  ADD CONSTRAINT settlements_valuation_basis_check
  CHECK (valuation_basis IN ('market', 'par'));

ALTER TABLE settlements DROP CONSTRAINT IF EXISTS settlements_par_valuation_check;
ALTER TABLE settlements
  ADD CONSTRAINT settlements_par_valuation_check
  CHECK (
    valuation_basis <> 'par'
    OR (quote_rate = 1.00000000 AND quote_locked_at IS NOT NULL)
  );
