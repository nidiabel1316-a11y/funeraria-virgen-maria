-- Datos bancarios para consignación de comisiones (JSONB)
ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_details JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN users.bank_details IS 'Datos bancarios del afiliado: bankName, accountType, accountNumber, holderName, idDoc, notes (opcionales)';
