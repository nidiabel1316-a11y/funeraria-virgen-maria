-- Migración: agregar columnas de autenticación y afiliación a users
-- Ejecutar en Neon SQL Editor si la tabla users existe pero sin password_hash

-- password_hash (requerido para login)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='password_hash') THEN
    ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

-- beneficiaries (JSONB)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='beneficiaries') THEN
    ALTER TABLE users ADD COLUMN beneficiaries JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- pets (JSONB)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='pets') THEN
    ALTER TABLE users ADD COLUMN pets JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- Otras columnas que podrían faltar
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='sponsor_id') THEN
    ALTER TABLE users ADD COLUMN sponsor_id UUID REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='balance_cents') THEN
    ALTER TABLE users ADD COLUMN balance_cents BIGINT NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='network_size') THEN
    ALTER TABLE users ADD COLUMN network_size INT NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='direct_count') THEN
    ALTER TABLE users ADD COLUMN direct_count INT NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='commission_cents') THEN
    ALTER TABLE users ADD COLUMN commission_cents BIGINT NOT NULL DEFAULT 0;
  END IF;
END $$;

