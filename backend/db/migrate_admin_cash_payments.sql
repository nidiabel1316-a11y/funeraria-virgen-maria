-- Registro de pagos en efectivo ingresados por administrador.
-- Permite trazabilidad y reportes de ingresos en caja.

CREATE TABLE IF NOT EXISTS admin_cash_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_number VARCHAR(32) NOT NULL,
  full_name VARCHAR(180) NOT NULL,
  payment_type VARCHAR(20) NOT NULL CHECK (payment_type IN ('affiliation', 'monthly')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  months_count INT NOT NULL DEFAULT 1 CHECK (months_count >= 1),
  monthly_paid_through_before VARCHAR(10),
  monthly_paid_through_after VARCHAR(10),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_cash_payments_user_created
  ON admin_cash_payments (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_cash_payments_created
  ON admin_cash_payments (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_cash_payments_doc
  ON admin_cash_payments (doc_number);
