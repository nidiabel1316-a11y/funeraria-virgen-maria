-- Diagnóstico: cuántos afiliados hay DEBAJO de un patrocinador (toda la profundidad).
-- Sustituye 'PON-AQUI-UUID-DEL-PATROCINADOR' por el id real (ej. users.id de Guillermo).

WITH RECURSIVE descendants AS (
  SELECT id, sponsor_id, full_name
  FROM users
  WHERE sponsor_id = 'PON-AQUI-UUID-DEL-PATROCINADOR'::uuid
  UNION ALL
  SELECT u.id, u.sponsor_id, u.full_name
  FROM users u
  INNER JOIN descendants d ON u.sponsor_id = d.id
)
SELECT COUNT(*)::int AS total_downline FROM descendants;

-- Listar nivel 1 (invitados directos del raíz):
-- SELECT id, full_name, referral_code, plan_id, sponsor_id
-- FROM users WHERE sponsor_id = 'PON-AQUI-UUID-DEL-PATROCINADOR'::uuid
-- ORDER BY created_at;
