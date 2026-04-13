-- Reportes, mora/cierre mensual, desembolsos, solicitudes de cambio de contrato (solo admin aprueba)

ALTER TABLE commission_lines ADD COLUMN IF NOT EXISTS forfeited_at TIMESTAMPTZ;
ALTER TABLE commission_lines ADD COLUMN IF NOT EXISTS forfeiture_reason TEXT;

COMMENT ON COLUMN commission_lines.forfeited_at IS 'Si no NULL, la línea no cuenta para balance (mora al cierre del mes).';

CREATE TABLE IF NOT EXISTS contract_change_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  proposed_beneficiaries JSONB NOT NULL DEFAULT '[]'::jsonb,
  proposed_pets JSONB NOT NULL DEFAULT '[]'::jsonb,
  note TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_contract_req_status ON contract_change_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS contract_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  action VARCHAR(80) NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_audit_user ON contract_audit_log (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS disbursement_payouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  period_month VARCHAR(7),
  authorized_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disburse_user ON disbursement_payouts (user_id, created_at DESC);

COMMENT ON TABLE disbursement_payouts IS 'Desembolsos autorizados/pagados; restan del saldo disponible (comisiones - pagos).';
