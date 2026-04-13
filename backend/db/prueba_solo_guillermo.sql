-- Dejar SOLO al usuario de prueba "Guillermo" y borrar el resto de afiliados.
-- Los logins del panel Admin (admin, nidia, hector) están en index.html, no en esta tabla.
--
-- Edita el LIKE si tu Guillermo tiene otro correo/nombre.

DO $$
DECLARE
  gid uuid;
BEGIN
  SELECT id INTO gid
  FROM users
  WHERE LOWER(email) LIKE '%guillermo%'
     OR LOWER(full_name) LIKE '%guillermo%'
  ORDER BY created_at ASC
  LIMIT 1;

  IF gid IS NULL THEN
    RAISE EXCEPTION 'No se encontró usuario con guillermo en email o nombre. Ajusta el script en Neon.';
  END IF;

  DELETE FROM commission_lines;
  DELETE FROM users WHERE id <> gid;
END $$;
