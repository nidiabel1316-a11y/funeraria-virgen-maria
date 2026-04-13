-- Ampliar monthly_paid_through a YYYY-MM-DD (10 caracteres).
-- Ejecutar en Neon si ya aplicaste migrate_payment_affiliation.sql y migrate_admin_cash_payments.sql con VARCHAR(7).

ALTER TABLE users
  ALTER COLUMN monthly_paid_through TYPE VARCHAR(10);

ALTER TABLE admin_cash_payments
  ALTER COLUMN monthly_paid_through_before TYPE VARCHAR(10),
  ALTER COLUMN monthly_paid_through_after TYPE VARCHAR(10);

COMMENT ON COLUMN users.monthly_paid_through IS 'Fecha fin de cobertura de mensualidad YYYY-MM-DD (legacy YYYY-MM = fin de mes calendario)';
