-- Academia: inscripciones y avisos del administrador a afiliados
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS academy_registrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  affiliate_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  course_interest TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_academy_reg_created ON academy_registrations (created_at DESC);

CREATE TABLE IF NOT EXISTS academy_broadcasts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  body TEXT,
  course_name TEXT,
  start_date DATE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_academy_broadcast_active ON academy_broadcasts (active, created_at DESC);

-- Bolsa de empleo (empresas y candidatos independientes del afiliado MLM)
CREATE TABLE IF NOT EXISTS job_employers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_seekers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone TEXT,
  skills TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_listings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employer_id UUID NOT NULL REFERENCES job_employers (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  city TEXT,
  modality TEXT,
  salary_hint TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_list_active ON job_listings (is_active, created_at DESC);

COMMENT ON TABLE academy_registrations IS 'Preinscripciones a cursos de la Academia FVM';
COMMENT ON TABLE academy_broadcasts IS 'Avisos del admin visibles para afiliados en el panel';
COMMENT ON TABLE job_listings IS 'Ofertas publicadas por empresas registradas en la bolsa';
