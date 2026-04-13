/**
 * Cobertura de mensualidad por fecha de vencimiento (día de anclaje = día de pago de afiliación en America/Bogota).
 * Valor almacenado: YYYY-MM-DD = último día INCLUSIVO cubierto.
 * Compatibilidad: YYYY-MM legacy = fin de ese mes calendario.
 */

export const BOGOTA_TZ = "America/Bogota";

export function todayYmdBogota(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: BOGOTA_TZ });
}

export function ymdFromTimestampInBogota(ts) {
  if (ts == null) return todayYmdBogota();
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return todayYmdBogota();
  return d.toLocaleDateString("en-CA", { timeZone: BOGOTA_TZ });
}

/**
 * Fecha ancla de afiliación basada en la fecha del timestamp (UTC/ISO),
 * evitando desfases de día por conversión horaria en datos legacy.
 */
export function affiliationAnchorYmd(ts) {
  if (ts == null) return todayYmdBogota();
  if (typeof ts === "string") {
    const raw = ts.trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  }
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return todayYmdBogota();
  return d.toISOString().slice(0, 10);
}

function parseLegacyYm(ym) {
  const m = String(ym || "").trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  const [y, mo] = m.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return null;
  return { y, mo };
}

/** YYYY-MM → último día del mes como YYYY-MM-DD */
export function legacyCalendarMonthToEndYmd(ym) {
  const p = parseLegacyYm(ym);
  if (!p) return null;
  const { y, mo } = p;
  const last = new Date(Date.UTC(y, mo, 0));
  const yy = last.getUTCFullYear();
  const mm = String(last.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(last.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Legacy YYYY-MM + afiliación -> fecha de vencimiento anclada al día de afiliación.
 * Ejemplo: afiliación 2026-03-22 + legacy 2026-03 => 2026-04-22.
 */
export function legacyMonthToAnchoredEndYmd(ym, affiliationPaidAt) {
  const p = parseLegacyYm(ym);
  if (!p) return null;
  const anchor = affiliationAnchorYmd(affiliationPaidAt);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return null;
  const anchorDay = Number(anchor.slice(8, 10));
  if (!Number.isFinite(anchorDay) || anchorDay < 1 || anchorDay > 31) return null;
  const dt = new Date(Date.UTC(p.y, p.mo - 1, anchorDay));
  dt.setUTCMonth(dt.getUTCMonth() + 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Normaliza valor guardado a fecha fin inclusiva YYYY-MM-DD */
export function storedCoverageToEndYmd(stored, affiliationPaidAt = null) {
  if (stored == null) return null;
  const s = String(stored).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) {
    return legacyMonthToAnchoredEndYmd(s, affiliationPaidAt) ?? legacyCalendarMonthToEndYmd(s);
  }
  return null;
}

export function addMonthsToYmd(ymd, delta) {
  const [y, m, day] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  dt.setUTCMonth(dt.getUTCMonth() + delta);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Primer vencimiento tras registrar afiliación: mismo día del mes siguiente (Bogotá). */
export function initialAffiliationCoverageEndYmd(affiliationPaidAt) {
  const anchor = ymdFromTimestampInBogota(affiliationPaidAt);
  return addMonthsToYmd(anchor, 1);
}

export function isMonthlyCoverageCurrent(stored) {
  const end = storedCoverageToEndYmd(stored);
  if (!end) return false;
  const today = todayYmdBogota();
  return end >= today;
}

export function paymentFlagsFromCoverageRow(row) {
  const affiliationPaid = Boolean(row?.affiliation_paid_at);
  const monthlyPaidThrough = row?.monthly_paid_through ?? null;
  const monthlyCoversCurrent =
    storedCoverageToEndYmd(monthlyPaidThrough, row?.affiliation_paid_at) >= todayYmdBogota();
  const legacyNoMonthly =
    affiliationPaid && (monthlyPaidThrough == null || String(monthlyPaidThrough).trim() === "");
  const receivesCommission = affiliationPaid && (monthlyCoversCurrent || legacyNoMonthly);
  let moraReason = null;
  if (!affiliationPaid) moraReason = "sin_inscripcion";
  else if (!monthlyCoversCurrent && !legacyNoMonthly) moraReason = "mensualidad";
  return {
    affiliationPaid,
    monthlyPaidThrough,
    receivesCommission,
    mora: !receivesCommission,
    moraReason,
  };
}

export function lastDayOfCalendarMonthYmd(periodYm) {
  return legacyCalendarMonthToEndYmd(periodYm);
}

/** ¿La cobertura llega al menos hasta el último día del mes de comisión periodYm (YYYY-MM)? */
export function coversCommissionPeriod(stored, periodYm, affiliationPaidAt = null) {
  const end = storedCoverageToEndYmd(stored, affiliationPaidAt);
  const last = lastDayOfCalendarMonthYmd(periodYm);
  if (!end || !last) return false;
  return end >= last;
}

/**
 * Expresión SQL: fecha fin de cobertura a partir de monthly_paid_through (text).
 * @param {string} col referencia calificada, ej. "monthly_paid_through" o "u.monthly_paid_through"
 */
export function pgCoverageEndDateExpr(col) {
  return `(CASE
    WHEN trim(${col}::text) ~ '^[0-9]{4}-[0-9]{2}$' THEN (date_trunc('month', to_date(trim(${col}::text) || '-01', 'YYYY-MM-DD'))::date + interval '1 month - 1 day')::date
    WHEN trim(${col}::text) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN to_date(substring(trim(${col}::text) from 1 for 10), 'YYYY-MM-DD')
    ELSE NULL::date
  END)`;
}
