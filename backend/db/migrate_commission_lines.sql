-- Ejecutar en Neon (SQL Editor) si ya tienes la tabla users
-- Tabla de líneas de comisión por afiliación (N1/N2/N3 al registrarse un nuevo miembro)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS commission_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_month VARCHAR(7) NOT NULL,
  level SMALLINT NOT NULL CHECK (level IN (1, 2, 3)),
  amount_cents BIGINT NOT NULL,
  from_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commission_lines_recipient_month
  ON commission_lines (recipient_id, period_month DESC);

COMMENT ON TABLE commission_lines IS 'Comisiones por nivel generadas en eventos (ej. alta de referido)';
