-- Recuperación de contraseña por correo (tokens de un solo uso)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pwd_reset_user ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_pwd_reset_expires ON password_reset_tokens (expires_at);

COMMENT ON TABLE password_reset_tokens IS 'Enlaces de restablecimiento de contraseña (expiran en ~1 h).';
