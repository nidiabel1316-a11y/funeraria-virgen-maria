-- Quién registró cada pago en efectivo (cierre de caja y auditoría por operador).
ALTER TABLE admin_cash_payments
  ADD COLUMN IF NOT EXISTS registered_by_username VARCHAR(160);

COMMENT ON COLUMN admin_cash_payments.registered_by_username IS 'Usuario del panel admin que registró el movimiento (JWT u).';
