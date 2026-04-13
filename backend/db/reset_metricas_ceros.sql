-- Poner en CERO balance, red, directos y comisiones acumuladas para TODOS los afiliados.
-- Útil antes de producción o para limpiar datos de prueba.
-- Las nuevas altas ya nacen en 0 por defecto en el esquema.

BEGIN;

DELETE FROM commission_lines;

UPDATE users SET
  balance_cents = 0,
  network_size = 0,
  direct_count = 0,
  commission_cents = 0,
  updated_at = NOW();

COMMIT;
