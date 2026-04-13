-- Opcional: alinear users.commission_cents y balance_cents con la suma real de commission_lines
-- (solo filas que tienen movimientos en commission_lines)
UPDATE users u
SET
  commission_cents = COALESCE(s.t, 0),
  balance_cents = COALESCE(s.t, 0),
  updated_at = NOW()
FROM (
  SELECT recipient_id, SUM(amount_cents)::bigint AS t
  FROM commission_lines
  GROUP BY recipient_id
) s
WHERE u.id = s.recipient_id;
