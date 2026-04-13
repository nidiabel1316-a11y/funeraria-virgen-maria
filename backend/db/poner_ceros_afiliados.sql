-- Corrige usuarios existentes: pone en 0 Balance, Red, Directos, Comisión
-- Ejecutar en Neon SQL Editor para que Guillermo y otros vean ceros reales

UPDATE users SET
  balance_cents = 0,
  network_size = 0,
  direct_count = 0,
  commission_cents = 0
WHERE balance_cents > 0 OR network_size > 0 OR direct_count > 0 OR commission_cents > 0;
