-- Corregir saldo y red de UN afiliado (p. ej. datos inconsistentes en pruebas)
-- 1) En Neon: SELECT id, email, full_name, balance_cents, network_size, direct_count FROM users WHERE email ILIKE '%nidia%';
-- 2) Sustituye el UUID abajo y ejecuta.

-- UPDATE users SET
--   balance_cents = 0,
--   commission_cents = 0,
--   network_size = 0,
--   direct_count = 0,
--   updated_at = NOW()
-- WHERE id = 'PON-AQUI-TU-UUID'::uuid;

-- Opcional: quitar líneas de comisión recibidas por ese usuario (solo si están mal)
-- DELETE FROM commission_lines WHERE recipient_id = 'PON-AQUI-TU-UUID'::uuid;
