-- Cuentas de panel admin (bcrypt) y auditoría de acciones (quién, cuándo, qué)

CREATE TABLE IF NOT EXISTS admin_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'secretary')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_account_id UUID REFERENCES admin_accounts (id) ON DELETE SET NULL,
  admin_username TEXT NOT NULL,
  admin_role TEXT NOT NULL,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_username ON admin_audit_log (LOWER(admin_username), created_at DESC);

COMMENT ON TABLE admin_accounts IS 'Usuarios del panel /api/admin; rol owner = acceso total, secretary = asociados y pagos en efectivo.';
COMMENT ON TABLE admin_audit_log IS 'Registro de acciones admin sensibles (usuario, rol, acción, detalle JSON, fecha/hora).';
