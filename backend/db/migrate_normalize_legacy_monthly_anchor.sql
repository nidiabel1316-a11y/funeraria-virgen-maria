-- Normaliza valores legacy YYYY-MM a vencimiento anclado al día de afiliación.
-- Ejemplo: afiliación 2026-03-22 + monthly_paid_through='2026-03' => '2026-04-22'.
-- Ejecutar después de:
--   1) migrate_payment_affiliation.sql
--   2) migrate_admin_cash_payments.sql
--   3) migrate_monthly_paid_through_ymd.sql

WITH users_norm AS (
  SELECT
    u.id,
    u.monthly_paid_through,
    EXTRACT(DAY FROM ((u.affiliation_paid_at AT TIME ZONE 'UTC')::date))::int AS anchor_day,
    to_date(u.monthly_paid_through || '-01', 'YYYY-MM-DD') AS legacy_first_day
  FROM users u
  WHERE u.affiliation_paid_at IS NOT NULL
    AND trim(COALESCE(u.monthly_paid_through, '')) ~ '^[0-9]{4}-[0-9]{2}$'
),
users_target AS (
  SELECT
    n.id,
    make_date(
      EXTRACT(YEAR FROM (date_trunc('month', n.legacy_first_day + interval '1 month')::date))::int,
      EXTRACT(MONTH FROM (date_trunc('month', n.legacy_first_day + interval '1 month')::date))::int,
      LEAST(
        n.anchor_day,
        EXTRACT(
          DAY FROM (
            date_trunc('month', n.legacy_first_day + interval '2 month')::date - interval '1 day'
          )
        )::int
      )
    )::text AS normalized_ymd
  FROM users_norm n
)
UPDATE users u
SET monthly_paid_through = t.normalized_ymd
FROM users_target t
WHERE u.id = t.id;

WITH cash_norm AS (
  SELECT
    p.id,
    EXTRACT(DAY FROM ((u.affiliation_paid_at AT TIME ZONE 'UTC')::date))::int AS anchor_day,
    p.monthly_paid_through_before,
    p.monthly_paid_through_after
  FROM admin_cash_payments p
  JOIN users u ON u.id = p.user_id
  WHERE u.affiliation_paid_at IS NOT NULL
),
cash_target AS (
  SELECT
    c.id,
    CASE
      WHEN trim(COALESCE(c.monthly_paid_through_before, '')) ~ '^[0-9]{4}-[0-9]{2}$' THEN
        make_date(
          EXTRACT(YEAR FROM (date_trunc('month', to_date(c.monthly_paid_through_before || '-01','YYYY-MM-DD') + interval '1 month')::date))::int,
          EXTRACT(MONTH FROM (date_trunc('month', to_date(c.monthly_paid_through_before || '-01','YYYY-MM-DD') + interval '1 month')::date))::int,
          LEAST(
            c.anchor_day,
            EXTRACT(
              DAY FROM (
                date_trunc('month', to_date(c.monthly_paid_through_before || '-01','YYYY-MM-DD') + interval '2 month')::date - interval '1 day'
              )
            )::int
          )
        )::text
      ELSE c.monthly_paid_through_before
    END AS before_norm,
    CASE
      WHEN trim(COALESCE(c.monthly_paid_through_after, '')) ~ '^[0-9]{4}-[0-9]{2}$' THEN
        make_date(
          EXTRACT(YEAR FROM (date_trunc('month', to_date(c.monthly_paid_through_after || '-01','YYYY-MM-DD') + interval '1 month')::date))::int,
          EXTRACT(MONTH FROM (date_trunc('month', to_date(c.monthly_paid_through_after || '-01','YYYY-MM-DD') + interval '1 month')::date))::int,
          LEAST(
            c.anchor_day,
            EXTRACT(
              DAY FROM (
                date_trunc('month', to_date(c.monthly_paid_through_after || '-01','YYYY-MM-DD') + interval '2 month')::date - interval '1 day'
              )
            )::int
          )
        )::text
      ELSE c.monthly_paid_through_after
    END AS after_norm
  FROM cash_norm c
)
UPDATE admin_cash_payments p
SET
  monthly_paid_through_before = t.before_norm,
  monthly_paid_through_after = t.after_norm
FROM cash_target t
WHERE p.id = t.id;
