-- Pagos de afiliación / mensualidad y fecha fija de contrato
-- Ejecutar en Neon después de las migraciones anteriores.

ALTER TABLE users ADD COLUMN IF NOT EXISTS affiliation_paid_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_paid_through VARCHAR(10);
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_commissions_applied BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS contract_issue_date DATE;

-- Usuarios ya existentes: considerados con afiliación pagada (no bloquear)
UPDATE users SET affiliation_paid_at = COALESCE(affiliation_paid_at, created_at);
UPDATE users SET contract_issue_date = COALESCE(contract_issue_date, (created_at AT TIME ZONE 'UTC')::date) WHERE contract_issue_date IS NULL;
UPDATE users u SET signup_commissions_applied = true
WHERE EXISTS (SELECT 1 FROM commission_lines cl WHERE cl.from_user_id = u.id);

ALTER TABLE users ALTER COLUMN contract_issue_date SET DEFAULT CURRENT_DATE;

COMMENT ON COLUMN users.affiliation_paid_at IS 'Cuando el afiliado completó el pago de inscripción; entonces se acreditan comisiones N1-N3 a la red';
COMMENT ON COLUMN users.monthly_paid_through IS 'Fecha fin de cobertura YYYY-MM-DD (legacy YYYY-MM = fin de mes calendario)';
COMMENT ON COLUMN users.signup_commissions_applied IS 'Evita duplicar líneas de comisión por alta';
COMMENT ON COLUMN users.contract_issue_date IS 'Fecha del contrato (solo admin puede corregir)';
