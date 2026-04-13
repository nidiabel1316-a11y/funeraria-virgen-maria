-- RECREAR TABLA USERS - Ejecutar en Neon SQL Editor
-- Esto borra la tabla actual y la crea con la estructura correcta.
-- ADVERTENCIA: Se pierden los datos existentes en users.

DROP TABLE IF EXISTS users CASCADE;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  doc_number VARCHAR(24) NOT NULL UNIQUE,
  doc_type VARCHAR(8) NOT NULL DEFAULT 'CC',
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  birth_date DATE,
  address TEXT,
  city VARCHAR(120),
  department VARCHAR(120),
  phone VARCHAR(32),
  whatsapp VARCHAR(32),
  plan_id VARCHAR(32) NOT NULL,
  referral_code VARCHAR(40) NOT NULL UNIQUE,
  sponsor_id UUID REFERENCES users (id) ON DELETE SET NULL,
  beneficiaries JSONB NOT NULL DEFAULT '[]'::jsonb,
  pets JSONB NOT NULL DEFAULT '[]'::jsonb,
  balance_cents BIGINT NOT NULL DEFAULT 0,
  network_size INT NOT NULL DEFAULT 0,
  direct_count INT NOT NULL DEFAULT 0,
  commission_cents BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_referral ON users (referral_code);

CREATE TABLE commission_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_month VARCHAR(7) NOT NULL,
  level SMALLINT NOT NULL CHECK (level IN (1, 2, 3)),
  amount_cents BIGINT NOT NULL,
  from_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_commission_lines_recipient_month ON commission_lines (recipient_id, period_month DESC);
