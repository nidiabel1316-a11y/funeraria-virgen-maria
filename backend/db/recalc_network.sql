-- Recalcular direct_count y network_size desde sponsor_id (datos históricos)
-- Ejecutar en Neon después de desplegar la lógica de registro.

-- 1) Directos: cuántos tienen sponsor_id = este usuario
UPDATE users u
SET direct_count = COALESCE((
  SELECT COUNT(*)::int FROM users c WHERE c.sponsor_id = u.id
), 0);

-- 2) Tamaño de red: todos los descendientes (recursivo)
UPDATE users u
SET network_size = COALESCE((
  WITH RECURSIVE descendants AS (
    SELECT id FROM users WHERE sponsor_id = u.id
    UNION ALL
    SELECT x.id FROM users x
    INNER JOIN descendants d ON x.sponsor_id = d.id
  )
  SELECT COUNT(*)::int FROM descendants
), 0);
