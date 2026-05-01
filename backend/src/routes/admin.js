import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { pool } from "../db.js";
import { countDirectReferrals, countNetworkDownline } from "../networkCounts.js";
import { computeAvailableBalanceCents } from "../ledgerBalance.js";
import {
  paymentFlagsFromCoverageRow as paymentFlagsFromRowAdm,
  initialAffiliationCoverageEndYmd,
  storedCoverageToEndYmd,
  addMonthsToYmd,
  todayYmdBogota,
  pgCoverageEndDateExpr,
  coversCommissionPeriod,
} from "../monthlyCoverage.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

function normalizeAdminEnv(s) {
  return String(s ?? "")
    .replace(/\uFEFF/g, "")
    .replace(/[\u200B-\u200D]/g, "")
    .replace(/\u00A0/g, " ")
    .trim();
}

function normalizeAdminBody(s) {
  return String(s ?? "")
    .replace(/\uFEFF/g, "")
    .replace(/[\u200B-\u200D]/g, "")
    .replace(/\u00A0/g, " ")
    .trim();
}

/** Quita comillas simples/dobles si el valor en Render/cPanel quedó guardado como "clave". */
function stripSurroundingQuotes(s) {
  const t = String(s ?? "").trim();
  if (t.length < 2) return t;
  const a = t[0];
  const b = t[t.length - 1];
  if ((a === '"' && b === '"') || (a === "'" && b === "'")) return t.slice(1, -1).trim();
  return t;
}

/**
 * Credenciales secretaría leídas en caliente (Render inyecta env al arranque; evita valores vacíos por orden de carga).
 * Alias: DMIN_SECRETARY_PASSWORD; ADMIN_SECRETARY_PASSWOR (falta la D final en Render).
 */
function readSecretaryEnvCreds() {
  const rawU = process.env.ADMIN_SECRETARY_USER || process.env.DMIN_SECRETARY_USER;
  const rawP =
    process.env.ADMIN_SECRETARY_PASSWORD ||
    process.env.DMIN_SECRETARY_PASSWORD ||
    process.env.ADMIN_SECRETARY_PASSWOR;
  const user = normalizeAdminEnv(stripSurroundingQuotes(rawU));
  const password = normalizeAdminEnv(stripSurroundingQuotes(rawP));
  return { user, password };
}

/** Recorta espacios/saltos: en paneles cloud a veces se copian secretos con \\n final. */
const ADMIN_USER = normalizeAdminEnv(process.env.ADMIN_USER) || "admin";
const ADMIN_PASSWORD = normalizeAdminEnv(process.env.ADMIN_PASSWORD) || "__no_admin_password_set__";

try {
  const s = readSecretaryEnvCreds();
  console.info("[FVM admin] Login secretaría (.env):", s.user && s.password ? "configurado" : "no configurado");
} catch (_e) {
  /* ignore */
}

/**
 * Login admin:
 * 1) `ADMIN_SECRETARY_USER` / `ADMIN_SECRETARY_PASSWORD` (o DMIN_*) en .env → **secretary** (antes que BD: evita choque con `admin_accounts`)
 * 2) Cuenta en `admin_accounts` (bcrypt), rol owner o secretary
 * 3) `ADMIN_USER` / `ADMIN_PASSWORD` → **owner**
 */
router.post("/login", async (req, res) => {
  const rawUser = req.body?.user ?? req.body?.username ?? "";
  const rawPass = req.body?.password ?? req.body?.pass ?? "";
  const user = normalizeAdminBody(rawUser);
  const password = normalizeAdminBody(rawPass);
  if (!user || !password) {
    return res.status(400).json({ error: "Usuario y contraseña requeridos" });
  }
  const secEnv = readSecretaryEnvCreds();
  const secretaryEnvConfigured = secEnv.user.length > 0 && secEnv.password.length > 0;
  const passMatchesSecretaryEnv =
    password === secEnv.password ||
    password.toLowerCase() === String(secEnv.password).toLowerCase();
  const matchSecretaryEnv =
    secretaryEnvConfigured &&
    user.toLowerCase() === secEnv.user.toLowerCase() &&
    passMatchesSecretaryEnv;
  if (matchSecretaryEnv) {
    const token = jwt.sign(
      { admin: true, aid: null, role: "secretary", u: secEnv.user },
      JWT_SECRET,
      { expiresIn: "8h" }
    );
    return res.json({ token, role: "secretary", username: secEnv.user });
  }
  const unLower = user.toLowerCase();
  try {
    const br = await pool.query(
      `SELECT id, username, password_hash, role FROM admin_accounts WHERE LOWER(username) = $1 AND is_active = TRUE`,
      [unLower]
    );
    if (br.rows[0]) {
      const row = br.rows[0];
      const ok = await bcrypt.compare(password, row.password_hash);
      if (ok) {
        const token = jwt.sign(
          { admin: true, aid: String(row.id), role: row.role, u: row.username },
          JWT_SECRET,
          { expiresIn: "8h" }
        );
        return res.json({ token, role: row.role, username: row.username });
      }
    }
  } catch (e) {
    if (e.code !== "42P01") console.error(e);
  }
  const matchEnv =
    user.toLowerCase() === String(ADMIN_USER).toLowerCase() &&
    password.toLowerCase() === String(ADMIN_PASSWORD).toLowerCase();
  if (matchEnv) {
    const token = jwt.sign(
      { admin: true, aid: null, role: "owner", u: ADMIN_USER },
      JWT_SECRET,
      { expiresIn: "8h" }
    );
    return res.json({ token, role: "owner", username: ADMIN_USER });
  }
  return res.status(401).json({ error: "Credenciales inválidas" });
});

async function logAdminAudit(req, action, detail = {}) {
  const ctx = req.adminCtx;
  if (!ctx) return;
  try {
    await pool.query(
      `INSERT INTO admin_audit_log (admin_account_id, admin_username, admin_role, action, detail, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [
        ctx.aid || null,
        ctx.username,
        ctx.role,
        action,
        JSON.stringify(detail ?? {}),
        String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").slice(0, 200),
        String(req.headers["user-agent"] || "").slice(0, 400),
      ]
    );
  } catch (e) {
    if (e.code !== "42P01") console.error("admin_audit_log:", e.message);
  }
}

function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"] || req.headers["authorization"]?.replace("Bearer ", "");
  if (!token) {
    return res.status(403).json({ error: "Token requerido" });
  }
  try {
    const decoded = jwt.verify(String(token).trim(), JWT_SECRET);
    if (!decoded.admin) return res.status(403).json({ error: "Acceso denegado" });
    const role = decoded.role === "secretary" ? "secretary" : "owner";
    req.adminCtx = {
      aid: decoded.aid && /^[0-9a-f-]{36}$/i.test(String(decoded.aid)) ? String(decoded.aid) : null,
      role,
      username: String(decoded.u || "admin"),
    };
    next();
  } catch {
    return res.status(403).json({ error: "Token inválido" });
  }
}

function requireOwner(req, res, next) {
  if (!req.adminCtx || req.adminCtx.role !== "owner") {
    return res.status(403).json({ error: "Solo el administrador principal puede realizar esta acción." });
  }
  next();
}

router.use(requireAdmin);

router.get("/me", (req, res) => {
  res.json({
    username: req.adminCtx.username,
    role: req.adminCtx.role,
    accountId: req.adminCtx.aid,
  });
});

router.get("/audit-log", requireOwner, async (req, res) => {
  const lim = Math.min(500, Math.max(1, Number(req.query.limit) || 120));
  try {
    const r = await pool.query(
      `SELECT id, admin_username, admin_role, action, detail, ip, created_at
       FROM admin_audit_log ORDER BY created_at DESC LIMIT $1::int`,
      [lim]
    );
    return res.json({
      items: r.rows.map((row) => ({
        id: row.id,
        adminUsername: row.admin_username,
        adminRole: row.admin_role,
        action: row.action,
        detail: row.detail,
        ip: row.ip,
        createdAt: row.created_at,
      })),
    });
  } catch (e) {
    if (e.code === "42P01") {
      return res.status(503).json({ error: "Ejecuta migrate_admin_roles_audit.sql en la base de datos" });
    }
    console.error(e);
    return res.status(500).json({ error: "Error al listar auditoría" });
  }
});

const NETWORK_WIDTH_ADMIN = { n1: 8, n2: 64, n3: 512 };
const PLAN_BASE_PESOS_ADM = { elite: 100000, premium: 250000, platinum: 500000 };
const COMMISSION_PCTS_ADM = [0.1, 0.1, 0.1];

function currentPeriodMonthAdm() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeDocAdm(doc) {
  return String(doc || "").replace(/\D/g, "");
}

function planBaseCentsAdm(planId) {
  const pesos = PLAN_BASE_PESOS_ADM[planId] ?? 100000;
  return Math.floor(pesos * 100);
}

async function getCommissionUplinesAdm(client, directSponsorId) {
  const recipients = [];
  let current = directSponsorId;
  for (let i = 0; i < 3 && current; i++) {
    recipients.push(current);
    const r = await client.query(`SELECT sponsor_id FROM users WHERE id = $1`, [current]);
    current = r.rows[0]?.sponsor_id ?? null;
  }
  return recipients;
}

async function distributeSignupCommissionsAdm(client, newUserId, planId, directSponsorId, periodMonth) {
  if (!directSponsorId) return;
  const baseCents = planBaseCentsAdm(planId);
  const uplines = await getCommissionUplinesAdm(client, directSponsorId);
  for (let i = 0; i < uplines.length; i++) {
    const recipientId = uplines[i];
    const pr = await client.query(
      `SELECT affiliation_paid_at, monthly_paid_through FROM users WHERE id = $1`,
      [recipientId]
    );
    const flags = paymentFlagsFromRowAdm(pr.rows[0]);
    if (!flags.receivesCommission) continue;
    const pct = COMMISSION_PCTS_ADM[i];
    const amt = Math.floor(baseCents * pct);
    if (amt <= 0) continue;
    await client.query(
      `INSERT INTO commission_lines (recipient_id, period_month, level, amount_cents, from_user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [recipientId, periodMonth, i + 1, amt, newUserId]
    );
    await client.query(
      `UPDATE users SET commission_cents = commission_cents + $1, balance_cents = balance_cents + $1, updated_at = NOW()
       WHERE id = $2`,
      [amt, recipientId]
    );
  }
}

async function applySignupCommissionsOnceAdm(client, newUserId) {
  const r = await client.query(
    `SELECT plan_id, sponsor_id, signup_commissions_applied FROM users WHERE id = $1 FOR UPDATE`,
    [newUserId]
  );
  const row = r.rows[0];
  if (!row || row.signup_commissions_applied || !row.sponsor_id) return { applied: false };
  const periodMonth = currentPeriodMonthAdm();
  await distributeSignupCommissionsAdm(client, newUserId, row.plan_id, row.sponsor_id, periodMonth);
  await client.query(`UPDATE users SET signup_commissions_applied = true, updated_at = NOW() WHERE id = $1`, [
    newUserId,
  ]);
  return { applied: true };
}

/** Métricas globales (dashboard admin). Secretaría: solo conteos operativos (sin MRR/comisiones/caja global). */
router.get("/stats", async (req, res) => {
  try {
    if (req.adminCtx?.role === "secretary") {
      const r = await pool.query(`SELECT COUNT(*)::int AS total FROM users`);
      const total = Number(r.rows[0].total);
      let affiliated = total;
      try {
        const a = await pool.query(
          `SELECT COUNT(*)::int AS c FROM users WHERE affiliation_paid_at IS NOT NULL`
        );
        affiliated = a.rows[0].c;
      } catch (e) {
        if (e.code !== "42703") throw e;
      }
      const retentionPct = total > 0 ? Math.round((affiliated / total) * 1000) / 10 : 0;
      // Caja del día y del mes — solo movimientos registrados por esta secretaria
      let myCashTodayPesos = 0;
      let myCashTodayCount = 0;
      let myCashMonthPesos = 0;
      let myCashMonthCount = 0;
      const myUser = String(req.adminCtx?.username || "").trim();
      try {
        const t = await pool.query(
          `SELECT
             COALESCE(SUM(amount_cents) FILTER (
               WHERE ((created_at AT TIME ZONE 'America/Bogota')::date)
                   = (NOW() AT TIME ZONE 'America/Bogota')::date
             ), 0)::bigint AS day_t,
             COUNT(*) FILTER (
               WHERE ((created_at AT TIME ZONE 'America/Bogota')::date)
                   = (NOW() AT TIME ZONE 'America/Bogota')::date
             )::int AS day_n,
             COALESCE(SUM(amount_cents) FILTER (
               WHERE to_char((created_at AT TIME ZONE 'America/Bogota'), 'YYYY-MM')
                   = to_char((NOW() AT TIME ZONE 'America/Bogota'), 'YYYY-MM')
             ), 0)::bigint AS m_t,
             COUNT(*) FILTER (
               WHERE to_char((created_at AT TIME ZONE 'America/Bogota'), 'YYYY-MM')
                   = to_char((NOW() AT TIME ZONE 'America/Bogota'), 'YYYY-MM')
             )::int AS m_n
           FROM admin_cash_payments
           WHERE LOWER(COALESCE(registered_by_username,'')) = LOWER($1)`,
          [myUser]
        );
        myCashTodayPesos = Math.round(Number(t.rows[0].day_t) / 100);
        myCashTodayCount = Number(t.rows[0].day_n);
        myCashMonthPesos = Math.round(Number(t.rows[0].m_t) / 100);
        myCashMonthCount = Number(t.rows[0].m_n);
      } catch (e) {
        // 42P01: tabla aún no creada · 42703: columna registered_by_username aún no creada
        if (e.code !== "42P01" && e.code !== "42703") throw e;
      }
      return res.json({
        scope: "secretary",
        totalUsers: total,
        affiliatedUsers: affiliated,
        retentionPct,
        myCashTodayPesos,
        myCashTodayCount,
        myCashMonthPesos,
        myCashMonthCount,
      });
    }

    const r = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE plan_id = 'elite')::int AS elite,
        COUNT(*) FILTER (WHERE plan_id = 'premium')::int AS premium,
        COUNT(*) FILTER (WHERE plan_id = 'platinum')::int AS platinum,
        COALESCE(SUM(commission_cents), 0)::bigint AS total_commission_cents,
        COALESCE(SUM(balance_cents), 0)::bigint AS total_balance_cents
      FROM users
    `);
    const row = r.rows[0];
    let affiliated = Number(row.total);
    try {
      const a = await pool.query(
        `SELECT COUNT(*)::int AS c FROM users WHERE affiliation_paid_at IS NOT NULL`
      );
      affiliated = a.rows[0].c;
    } catch (e) {
      if (e.code !== "42703") throw e;
    }
    const elite = Number(row.elite);
    const premium = Number(row.premium);
    const platinum = Number(row.platinum);
    const mrrReferencialPesos = elite * 100000 + premium * 250000 + platinum * 500000;
    let commissionsFromLinesPesos = 0;
    try {
      let cl;
      try {
        cl = await pool.query(
          `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS t FROM commission_lines WHERE forfeited_at IS NULL`
        );
      } catch (e2) {
        if (e2.code !== "42703") throw e2;
        cl = await pool.query(
          `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS t FROM commission_lines`
        );
      }
      commissionsFromLinesPesos = Math.round(Number(cl.rows[0].t) / 100);
    } catch (e) {
      if (e.code !== "42P01") throw e;
    }
    const total = Number(row.total);
    const retentionPct = total > 0 ? Math.round((affiliated / total) * 1000) / 10 : 0;
    let cashCollectedPesos = 0;
    let cashTodayPesos = 0;
    let cashTodayCount = 0;
    let cashMonthPesos = 0;
    let cashMonthCount = 0;
    try {
      const c = await pool.query(
        `SELECT
           COALESCE(SUM(amount_cents), 0)::bigint AS all_t,
           COALESCE(SUM(amount_cents) FILTER (
             WHERE ((created_at AT TIME ZONE 'America/Bogota')::date)
                 = (NOW() AT TIME ZONE 'America/Bogota')::date
           ), 0)::bigint AS day_t,
           COUNT(*) FILTER (
             WHERE ((created_at AT TIME ZONE 'America/Bogota')::date)
                 = (NOW() AT TIME ZONE 'America/Bogota')::date
           )::int AS day_n,
           COALESCE(SUM(amount_cents) FILTER (
             WHERE to_char((created_at AT TIME ZONE 'America/Bogota'), 'YYYY-MM')
                 = to_char((NOW() AT TIME ZONE 'America/Bogota'), 'YYYY-MM')
           ), 0)::bigint AS m_t,
           COUNT(*) FILTER (
             WHERE to_char((created_at AT TIME ZONE 'America/Bogota'), 'YYYY-MM')
                 = to_char((NOW() AT TIME ZONE 'America/Bogota'), 'YYYY-MM')
           )::int AS m_n
         FROM admin_cash_payments`
      );
      cashCollectedPesos = Math.round(Number(c.rows[0].all_t) / 100);
      cashTodayPesos = Math.round(Number(c.rows[0].day_t) / 100);
      cashTodayCount = Number(c.rows[0].day_n);
      cashMonthPesos = Math.round(Number(c.rows[0].m_t) / 100);
      cashMonthCount = Number(c.rows[0].m_n);
    } catch (e) {
      if (e.code !== "42P01") throw e;
    }
    return res.json({
      totalUsers: total,
      affiliatedUsers: affiliated,
      planElite: elite,
      planPremium: premium,
      planPlatinum: platinum,
      mrrReferencialPesos,
      totalCommissionCents: Number(row.total_commission_cents),
      totalBalanceCents: Number(row.total_balance_cents),
      commissionsFromLinesPesos,
      cashCollectedPesos,
      cashTodayPesos,
      cashTodayCount,
      cashMonthPesos,
      cashMonthCount,
      retentionPct,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error al cargar estadísticas" });
  }
});

/** True si existe la columna registered_by_username (migración opcional). */
let _cashPayHasRegistrarCol = null;
async function adminCashPaymentsHasRegistrarColumn() {
  if (_cashPayHasRegistrarCol !== null) return _cashPayHasRegistrarCol;
  try {
    const r = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'admin_cash_payments' AND column_name = 'registered_by_username'
       LIMIT 1`
    );
    _cashPayHasRegistrarCol = r.rowCount > 0;
  } catch {
    _cashPayHasRegistrarCol = false;
  }
  return _cashPayHasRegistrarCol;
}

/** True si existe la columna payment_channel (migración opcional). */
let _cashPayHasChannelCol = null;
async function adminCashPaymentsHasChannelColumn() {
  if (_cashPayHasChannelCol !== null) return _cashPayHasChannelCol;
  try {
    const r = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'admin_cash_payments' AND column_name = 'payment_channel'
       LIMIT 1`
    );
    _cashPayHasChannelCol = r.rowCount > 0;
  } catch {
    _cashPayHasChannelCol = false;
  }
  return _cashPayHasChannelCol;
}

/** Listado de pagos de caja. ?date=YYYY-MM-DD (día calendario America/Bogota) + totales del día; ?registrar= (solo owner) filtra por quien registró; ?channel=cash|consignment filtra por medio. La secretaría siempre ve solo sus propios movimientos (filtro forzado). */
router.get("/payments/cash", async (req, res) => {
  const limRaw = parseInt(String(req.query.limit || "80"), 10);
  const limit = Number.isFinite(limRaw) ? Math.min(200, Math.max(1, limRaw)) : 80;
  const dateRaw = String(req.query.date || "").trim();
  const registrarRaw = String(req.query.registrar || "").trim();
  const channelRaw = String(req.query.channel || "").trim().toLowerCase();
  const channelFilter = ["cash", "consignment"].includes(channelRaw) ? channelRaw : "";
  let dateFilter = null;
  if (dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
    dateFilter = dateRaw;
  }
  const isSecretary = req.adminCtx?.role === "secretary";
  // La secretaría no puede filtrar por otro registrador: el filtro se fuerza a su propio usuario.
  if (registrarRaw && !isSecretary && req.adminCtx?.role !== "owner") {
    return res.status(403).json({ error: "Solo el administrador principal puede filtrar por registrador." });
  }
  let regNorm = registrarRaw ? normalizeAdminBody(registrarRaw) : "";
  if (isSecretary) {
    regNorm = String(req.adminCtx?.username || "").trim();
  }
  try {
    const hasRegCol = await adminCashPaymentsHasRegistrarColumn();
    const hasChannelCol = await adminCashPaymentsHasChannelColumn();
    const conds = [];
    const params = [];
    let pi = 1;
    if (dateFilter) {
      conds.push(`((p.created_at AT TIME ZONE 'America/Bogota')::date) = $${pi}::date`);
      params.push(dateFilter);
      pi++;
    }
    if (regNorm && hasRegCol) {
      conds.push(`LOWER(COALESCE(p.registered_by_username,'')) = LOWER($${pi})`);
      params.push(regNorm);
      pi++;
    }
    if (channelFilter) {
      if (!hasChannelCol) {
        return res.status(503).json({
          error:
            "Ejecuta en Neon: db/migrate_admin_cash_payment_channel.sql para filtrar por medio de pago.",
        });
      }
      conds.push(`COALESCE(p.payment_channel,'cash') = $${pi}`);
      params.push(channelFilter);
      pi++;
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    let daySummary = null;
    if (dateFilter) {
      const sumParams = [dateFilter];
      let sumWhere = `WHERE ((p.created_at AT TIME ZONE 'America/Bogota')::date) = $1::date`;
      if (regNorm && hasRegCol) {
        sumWhere += ` AND LOWER(COALESCE(p.registered_by_username,'')) = LOWER($2)`;
        sumParams.push(regNorm);
      }
      if (channelFilter && hasChannelCol) {
        sumWhere += ` AND COALESCE(p.payment_channel,'cash') = $${sumParams.length + 1}`;
        sumParams.push(channelFilter);
      }
      const sq = await pool.query(
        `SELECT
           COALESCE(SUM(amount_cents), 0)::bigint AS total_cents,
           COUNT(*)::int AS n,
           COALESCE(SUM(amount_cents) FILTER (WHERE payment_type = 'affiliation'), 0)::bigint AS aff_cents,
           COALESCE(SUM(amount_cents) FILTER (WHERE payment_type = 'monthly'), 0)::bigint AS mon_cents,
           COALESCE(SUM(amount_cents) FILTER (WHERE COALESCE(payment_channel,'cash') = 'cash'), 0)::bigint AS cash_cents,
           COALESCE(SUM(amount_cents) FILTER (WHERE COALESCE(payment_channel,'cash') = 'consignment'), 0)::bigint AS cons_cents
         FROM admin_cash_payments p
         ${sumWhere}`,
        sumParams
      );
      const sr = sq.rows[0];
      daySummary = {
        date: dateFilter,
        totalPesos: Math.round(Number(sr.total_cents) / 100),
        count: Number(sr.n),
        affiliationPesos: Math.round(Number(sr.aff_cents) / 100),
        monthlyPesos: Math.round(Number(sr.mon_cents) / 100),
        cashPesos: Math.round(Number(sr.cash_cents) / 100),
        consignmentPesos: Math.round(Number(sr.cons_cents) / 100),
      };
    }

    params.push(limit);
    const limPh = `$${pi}`;
    const optSel = [
      hasRegCol ? "p.registered_by_username" : null,
      hasChannelCol ? "p.payment_channel" : null,
    ]
      .filter(Boolean)
      .join(", ");
    const optSelSql = optSel ? `, ${optSel}` : "";
    const r = await pool.query(
      `SELECT p.id, p.doc_number, p.full_name, p.payment_type, p.amount_cents, p.months_count,
              p.monthly_paid_through_before, p.monthly_paid_through_after, p.note, p.created_at${optSelSql},
              u.affiliation_paid_at
       FROM admin_cash_payments p
       LEFT JOIN users u ON u.id = p.user_id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT ${limPh}::int`,
      params
    );
    const items = r.rows.map((row) => ({
      id: row.id,
      docNumber: row.doc_number,
      fullName: row.full_name,
      paymentType: row.payment_type,
      amountPesos: Math.round(Number(row.amount_cents) / 100),
      monthsCount: row.months_count,
      affiliationPaidAt: row.affiliation_paid_at ?? null,
      monthlyPaidThroughBefore: storedCoverageToEndYmd(
        row.monthly_paid_through_before,
        row.affiliation_paid_at
      ),
      monthlyPaidThroughAfter: storedCoverageToEndYmd(
        row.monthly_paid_through_after,
        row.affiliation_paid_at
      ),
      note: row.note,
      createdAt: row.created_at,
      registeredBy: hasRegCol ? row.registered_by_username || null : null,
      paymentChannel: hasChannelCol
        ? row.payment_channel === "consignment"
          ? "consignment"
          : "cash"
        : "cash",
    }));
    const out = { items };
    if (daySummary) out.daySummary = daySummary;
    return res.json(out);
  } catch (e) {
    if (e.code === "42P01") {
      return res.status(503).json({ error: "Ejecuta migrate_admin_cash_payments.sql en la base de datos" });
    }
    console.error(e);
    return res.status(500).json({ error: "Error al listar pagos en efectivo" });
  }
});

router.post("/payments/cash", async (req, res) => {
  const registeredBy = String(req.adminCtx?.username || "")
    .trim()
    .slice(0, 160);
  const docNumber = normalizeDocAdm(req.body?.docNumber);
  const userIdRaw = req.body?.userId != null ? String(req.body.userId).trim() : "";
  const hasUserId = /^[0-9a-fA-F-]{36}$/.test(userIdRaw);
  const paymentType = String(req.body?.paymentType || "").trim();
  const paymentChannelRaw = String(req.body?.paymentChannel || "").trim().toLowerCase();
  const paymentChannel = paymentChannelRaw || "cash";
  const amountPesos = Number(req.body?.amountPesos);
  const note = req.body?.note != null ? String(req.body.note).slice(0, 500) : null;
  const monthsRaw = Number(req.body?.months);
  const months = Number.isFinite(monthsRaw) && monthsRaw > 0 ? Math.floor(monthsRaw) : 1;
  if (!docNumber || docNumber.length < 6) {
    return res.status(400).json({ error: "Cédula inválida" });
  }
  if (!["affiliation", "monthly"].includes(paymentType)) {
    return res.status(400).json({ error: "paymentType debe ser affiliation o monthly" });
  }
  if (!["cash", "consignment"].includes(paymentChannel)) {
    return res.status(400).json({ error: "paymentChannel debe ser cash o consignment" });
  }
  if (!Number.isFinite(amountPesos) || amountPesos <= 0) {
    return res.status(400).json({ error: "Monto inválido" });
  }
  if (months > 24) {
    return res.status(400).json({ error: "Máximo 24 meses por registro" });
  }
  const amountCents = Math.round(amountPesos * 100);
  const client = await pool.connect();
  try {
    const hasRegCol = await adminCashPaymentsHasRegistrarColumn();
    const hasChannelCol = await adminCashPaymentsHasChannelColumn();
    if (!hasChannelCol && paymentChannel !== "cash") {
      return res.status(503).json({
        error:
          "Ejecuta en Neon: db/migrate_admin_cash_payment_channel.sql para registrar consignación en caja.",
      });
    }
    await client.query("BEGIN");
    const qr = hasUserId
      ? await client.query(
          `SELECT id, doc_number, full_name, referral_code, sponsor_id, plan_id, affiliation_paid_at, monthly_paid_through
           FROM users WHERE id = $1::uuid FOR UPDATE`,
          [userIdRaw]
        )
      : await client.query(
          `SELECT id, doc_number, full_name, referral_code, sponsor_id, plan_id, affiliation_paid_at, monthly_paid_through
           FROM users
           WHERE regexp_replace(COALESCE(doc_number,''), '\\D', '', 'g') = $1
           FOR UPDATE`,
          [docNumber]
        );
    const u = qr.rows[0];
    if (!u) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "No se encontró afiliado con esa cédula" });
    }
    if (paymentType === "monthly" && !u.affiliation_paid_at) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Primero registra el pago de afiliación/inscripción" });
    }
    if (paymentType === "affiliation") {
      const beforeStored = u.monthly_paid_through;
      const beforeForLog =
        storedCoverageToEndYmd(beforeStored, u.affiliation_paid_at) ?? beforeStored ?? null;
      await client.query(
        `UPDATE users SET affiliation_paid_at = COALESCE(affiliation_paid_at, NOW()), updated_at = NOW()
         WHERE id = $1::uuid`,
        [u.id]
      );
      const ref = await client.query(
        `SELECT affiliation_paid_at, monthly_paid_through FROM users WHERE id = $1::uuid`,
        [u.id]
      );
      const r0 = ref.rows[0];
      let mpt = r0?.monthly_paid_through;
      if (mpt == null || String(mpt).trim() === "") {
        mpt = initialAffiliationCoverageEndYmd(r0.affiliation_paid_at);
        await client.query(`UPDATE users SET monthly_paid_through = $2 WHERE id = $1::uuid`, [u.id, mpt]);
      }
      const out = await applySignupCommissionsOnceAdm(client, u.id);
      const refreshed = await client.query(`SELECT monthly_paid_through FROM users WHERE id = $1::uuid`, [u.id]);
      const newMonthlyPaidThrough = refreshed.rows[0]?.monthly_paid_through;
      if (hasRegCol) {
        if (hasChannelCol) {
          await client.query(
            `INSERT INTO admin_cash_payments (
               user_id, doc_number, full_name, payment_type, payment_channel, amount_cents, months_count,
               monthly_paid_through_before, monthly_paid_through_after, note, registered_by_username
             ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              u.id,
              u.doc_number,
              u.full_name,
              paymentType,
              paymentChannel,
              amountCents,
              1,
              beforeForLog,
              newMonthlyPaidThrough,
              note,
              registeredBy || null,
            ]
          );
        } else {
          await client.query(
            `INSERT INTO admin_cash_payments (
               user_id, doc_number, full_name, payment_type, amount_cents, months_count,
               monthly_paid_through_before, monthly_paid_through_after, note, registered_by_username
             ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              u.id,
              u.doc_number,
              u.full_name,
              paymentType,
              amountCents,
              1,
              beforeForLog,
              newMonthlyPaidThrough,
              note,
              registeredBy || null,
            ]
          );
        }
      } else {
        if (hasChannelCol) {
          await client.query(
            `INSERT INTO admin_cash_payments (
               user_id, doc_number, full_name, payment_type, payment_channel, amount_cents, months_count,
               monthly_paid_through_before, monthly_paid_through_after, note
             ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              u.id,
              u.doc_number,
              u.full_name,
              paymentType,
              paymentChannel,
              amountCents,
              1,
              beforeForLog,
              newMonthlyPaidThrough,
              note,
            ]
          );
        } else {
          await client.query(
            `INSERT INTO admin_cash_payments (
               user_id, doc_number, full_name, payment_type, amount_cents, months_count,
               monthly_paid_through_before, monthly_paid_through_after, note
             ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              u.id,
              u.doc_number,
              u.full_name,
              paymentType,
              amountCents,
              1,
              beforeForLog,
              newMonthlyPaidThrough,
              note,
            ]
          );
        }
      }
      await client.query("COMMIT");
      await logAdminAudit(req, "payments.cash", {
        paymentType: "affiliation",
        affiliateUserId: u.id,
        docNumber: u.doc_number,
        referralCode: u.referral_code ?? null,
        fullName: u.full_name,
        amountPesos,
        paymentChannel,
        commissionsApplied: out.applied,
        registeredBy: registeredBy || null,
      });
      return res.json({
        ok: true,
        userId: u.id,
        docNumber: u.doc_number,
        fullName: u.full_name,
        paymentType,
        paymentChannel,
        monthlyPaidThrough: newMonthlyPaidThrough,
        commissionsApplied: out.applied,
      });
    }
    const beforeStored = u.monthly_paid_through;
    const beforeForLog =
      storedCoverageToEndYmd(beforeStored, u.affiliation_paid_at) ?? beforeStored ?? null;
    let endYmd = storedCoverageToEndYmd(beforeStored, u.affiliation_paid_at);
    if (!endYmd) {
      endYmd = initialAffiliationCoverageEndYmd(u.affiliation_paid_at);
    }
    let paidThrough = endYmd;
    for (let i = 0; i < months; i++) {
      paidThrough = addMonthsToYmd(paidThrough, 1);
    }
    await client.query(
      `UPDATE users SET monthly_paid_through = $1, updated_at = NOW() WHERE id = $2::uuid`,
      [paidThrough, u.id]
    );
    if (hasRegCol) {
      if (hasChannelCol) {
        await client.query(
          `INSERT INTO admin_cash_payments (
             user_id, doc_number, full_name, payment_type, payment_channel, amount_cents, months_count,
             monthly_paid_through_before, monthly_paid_through_after, note, registered_by_username
           ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            u.id,
            u.doc_number,
            u.full_name,
            paymentType,
            paymentChannel,
            amountCents,
            months,
            beforeForLog,
            paidThrough,
            note,
            registeredBy || null,
          ]
        );
      } else {
        await client.query(
          `INSERT INTO admin_cash_payments (
             user_id, doc_number, full_name, payment_type, amount_cents, months_count,
             monthly_paid_through_before, monthly_paid_through_after, note, registered_by_username
           ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            u.id,
            u.doc_number,
            u.full_name,
            paymentType,
            amountCents,
            months,
            beforeForLog,
            paidThrough,
            note,
            registeredBy || null,
          ]
        );
      }
    } else {
      if (hasChannelCol) {
        await client.query(
          `INSERT INTO admin_cash_payments (
             user_id, doc_number, full_name, payment_type, payment_channel, amount_cents, months_count,
             monthly_paid_through_before, monthly_paid_through_after, note
           ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            u.id,
            u.doc_number,
            u.full_name,
            paymentType,
            paymentChannel,
            amountCents,
            months,
            beforeForLog,
            paidThrough,
            note,
          ]
        );
      } else {
        await client.query(
          `INSERT INTO admin_cash_payments (
             user_id, doc_number, full_name, payment_type, amount_cents, months_count,
             monthly_paid_through_before, monthly_paid_through_after, note
           ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            u.id,
            u.doc_number,
            u.full_name,
            paymentType,
            amountCents,
            months,
            beforeForLog,
            paidThrough,
            note,
          ]
        );
      }
    }
    await client.query("COMMIT");
    await logAdminAudit(req, "payments.cash", {
      paymentType: "monthly",
      affiliateUserId: u.id,
      docNumber: u.doc_number,
      referralCode: u.referral_code ?? null,
      fullName: u.full_name,
      amountPesos,
      months,
      paymentChannel,
      registeredBy: registeredBy || null,
    });
    return res.json({
      ok: true,
      userId: u.id,
      docNumber: u.doc_number,
      fullName: u.full_name,
      paymentType,
      paymentChannel,
      months,
      monthlyPaidThrough: paidThrough,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    if (e.code === "42P01") {
      return res.status(503).json({ error: "Ejecuta migrate_admin_cash_payments.sql en la base de datos" });
    }
    if (e.code === "42703") {
      const em = String(e.message || "");
      if (em.includes("registered_by_username")) {
        return res.status(503).json({
          error:
            "Ejecuta en Neon: db/migrate_admin_cash_registered_by.sql (columna registered_by_username). Tras desplegar el último código ya no debería ser obligatorio.",
        });
      }
      return res.status(503).json({ error: "Ejecuta migrate_payment_affiliation.sql y luego migrate_admin_cash_payments.sql" });
    }
    return res.status(500).json({ error: "No se pudo registrar el pago de caja" });
  } finally {
    client.release();
  }
});

/** Comisiones globales por mes (toda la red; excluye líneas anuladas por mora/cierre) */
router.get("/commissions/summary", requireOwner, async (_req, res) => {
  try {
    let r;
    try {
      r = await pool.query(`
      SELECT period_month,
        COALESCE(SUM(CASE WHEN level = 1 THEN amount_cents ELSE 0 END), 0)::bigint AS n1,
        COALESCE(SUM(CASE WHEN level = 2 THEN amount_cents ELSE 0 END), 0)::bigint AS n2,
        COALESCE(SUM(CASE WHEN level = 3 THEN amount_cents ELSE 0 END), 0)::bigint AS n3,
        COALESCE(SUM(amount_cents), 0)::bigint AS total
      FROM commission_lines
      WHERE forfeited_at IS NULL
      GROUP BY period_month
      ORDER BY period_month DESC
      LIMIT 36
    `);
    } catch (e) {
      if (e.code !== "42703") throw e;
      r = await pool.query(`
      SELECT period_month,
        COALESCE(SUM(CASE WHEN level = 1 THEN amount_cents ELSE 0 END), 0)::bigint AS n1,
        COALESCE(SUM(CASE WHEN level = 2 THEN amount_cents ELSE 0 END), 0)::bigint AS n2,
        COALESCE(SUM(CASE WHEN level = 3 THEN amount_cents ELSE 0 END), 0)::bigint AS n3,
        COALESCE(SUM(amount_cents), 0)::bigint AS total
      FROM commission_lines
      GROUP BY period_month
      ORDER BY period_month DESC
      LIMIT 36
    `);
    }
    const months = r.rows.map((row) => ({
      month: row.period_month,
      n1: Math.round(Number(row.n1) / 100),
      n2: Math.round(Number(row.n2) / 100),
      n3: Math.round(Number(row.n3) / 100),
      total: Math.round(Number(row.total) / 100),
    }));
    return res.json({ months });
  } catch (e) {
    if (e.code === "42P01") {
      return res.json({ months: [] });
    }
    console.error(e);
    return res.status(500).json({ error: "Error al cargar comisiones" });
  }
});

const SQL_ADM_ROOT = `SELECT full_name, referral_code, plan_id, profile_photo_url, affiliation_paid_at, monthly_paid_through FROM users WHERE id = $1`;
const SQL_ADM_ROOT_NO = `SELECT full_name, referral_code, plan_id, affiliation_paid_at, monthly_paid_through FROM users WHERE id = $1`;
const SQL_ADM_LVL = `SELECT id, sponsor_id, doc_number, full_name, email, plan_id, referral_code, created_at, profile_photo_url, affiliation_paid_at, monthly_paid_through FROM users WHERE sponsor_id = ANY($1::uuid[]) ORDER BY created_at`;
const SQL_ADM_LVL_NO = `SELECT id, sponsor_id, doc_number, full_name, email, plan_id, referral_code, created_at, affiliation_paid_at, monthly_paid_through FROM users WHERE sponsor_id = ANY($1::uuid[]) ORDER BY created_at`;

/** Red MLM (3 niveles) vista admin — mismo formato que GET /auth/network */
router.get("/affiliates/:id/network", requireOwner, async (req, res) => {
  const userId = req.params.id;
  try {
    let meRow;
    try {
      meRow = await pool.query(SQL_ADM_ROOT, [userId]);
    } catch (e) {
      if (e.code === "42703") {
        meRow = await pool.query(SQL_ADM_ROOT_NO, [userId]);
      } else throw e;
    }
    if (!meRow.rows.length) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    const r0 = meRow.rows[0];
    const hasPhoto = Object.prototype.hasOwnProperty.call(r0, "profile_photo_url");
    const rootPay = paymentFlagsFromRowAdm(r0);
    const root = {
      id: userId,
      fullName: r0.full_name,
      refCode: r0.referral_code,
      planId: r0.plan_id,
      profilePhotoUrl: hasPhoto ? r0.profile_photo_url || null : null,
      affiliationPaid: rootPay.affiliationPaid,
      monthlyPaidThrough: rootPay.monthlyPaidThrough,
      receivesCommission: rootPay.receivesCommission,
      mora: rootPay.mora,
      moraReason: rootPay.moraReason,
    };

    const fetchBySponsors = async (sponsorIds) => {
      if (!sponsorIds?.length) return [];
      let q;
      try {
        q = await pool.query(SQL_ADM_LVL, [sponsorIds]);
      } catch (e) {
        if (e.code === "42703") {
          q = await pool.query(SQL_ADM_LVL_NO, [sponsorIds]);
        } else throw e;
      }
      return q.rows.map((r) => {
        const pf = paymentFlagsFromRowAdm(r);
        const hasP = Object.prototype.hasOwnProperty.call(r, "profile_photo_url");
        return {
          id: r.id,
          sponsorId: r.sponsor_id,
          fullName: r.full_name,
          email: r.email,
          planId: r.plan_id,
          refCode: r.referral_code,
          docNumber: r.doc_number,
          createdAt: r.created_at,
          profilePhotoUrl: hasP ? r.profile_photo_url || null : null,
          affiliationPaid: pf.affiliationPaid,
          monthlyPaidThrough: pf.monthlyPaidThrough,
          receivesCommission: pf.receivesCommission,
          mora: pf.mora,
          moraReason: pf.moraReason,
        };
      });
    };

    const level1 = await fetchBySponsors([userId]);
    const l1Ids = level1.map((r) => r.id);
    const level2 = await fetchBySponsors(l1Ids);
    const l2Ids = level2.map((r) => r.id);
    const level3 = await fetchBySponsors(l2Ids);

    const totalMlmThreeLevels = level1.length + level2.length + level3.length;
    const totalDownlineRecursive = await countNetworkDownline(pool, userId);

    return res.json({
      root,
      capacity: NETWORK_WIDTH_ADMIN,
      level1,
      level2,
      level3,
      totalMlmThreeLevels,
      totalDownlineRecursive,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error al cargar la red" });
  }
});

/** Lista todos los afiliados. ?q=texto: nombre, correo, documento o código (ILIKE ≥2); o ≥5 dígitos en doc normalizado. */
router.get("/affiliates", async (req, res) => {
  try {
    const qRaw = String(req.query?.q || "").trim();
    const qDigits = qRaw.replace(/\D/g, "");
    const params = [];
    let where = "";
    const minText = qRaw.length >= 2;
    const minDocDigits = qDigits.length >= 5;
    if (minText && minDocDigits) {
      params.push(`%${qRaw}%`, `%${qRaw}%`, `%${qRaw}%`, `%${qRaw}%`, `%${qDigits}%`);
      where = ` WHERE (
        full_name ILIKE $1 OR email ILIKE $2 OR doc_number ILIKE $3 OR referral_code ILIKE $4
        OR regexp_replace(COALESCE(doc_number, ''), '[^0-9]', '', 'g') LIKE $5
      )`;
    } else if (minText) {
      params.push(`%${qRaw}%`, `%${qRaw}%`, `%${qRaw}%`, `%${qRaw}%`);
      where = ` WHERE (
        full_name ILIKE $1 OR email ILIKE $2 OR doc_number ILIKE $3 OR referral_code ILIKE $4
      )`;
    } else if (minDocDigits) {
      params.push(`%${qDigits}%`);
      where = ` WHERE regexp_replace(COALESCE(doc_number, ''), '[^0-9]', '', 'g') LIKE $1`;
    }
    let r;
    try {
      r = await pool.query(
        `SELECT id, doc_number, doc_type, full_name, email, plan_id, referral_code,
                sponsor_id, balance_cents, network_size, direct_count, commission_cents,
                beneficiaries, pets, city, created_at,
                affiliation_paid_at, monthly_paid_through
         FROM users
         ${where}
         ORDER BY created_at DESC
         LIMIT 500`,
        params
      );
    } catch (e) {
      if (e.code !== "42703") throw e;
      r = await pool.query(
        `SELECT id, doc_number, doc_type, full_name, email, plan_id, referral_code,
                sponsor_id, balance_cents, network_size, direct_count, commission_cents,
                beneficiaries, pets, city, created_at
         FROM users
         ${where}
         ORDER BY created_at DESC
         LIMIT 500`,
        params
      );
    }
    const affiliates = r.rows.map((u) => {
      const pay =
        Object.prototype.hasOwnProperty.call(u, "affiliation_paid_at") ||
        Object.prototype.hasOwnProperty.call(u, "monthly_paid_through")
          ? paymentFlagsFromRowAdm({
              affiliation_paid_at: u.affiliation_paid_at,
              monthly_paid_through: u.monthly_paid_through,
            })
          : null;
      return {
        id: u.id,
        docNumber: u.doc_number,
        docType: u.doc_type,
        fullName: u.full_name,
        email: u.email,
        planId: u.plan_id,
        refCode: u.referral_code,
        sponsorId: u.sponsor_id,
        balance: Math.round(Number(u.balance_cents) / 100),
        networkSize: u.network_size,
        directCount: u.direct_count,
        commission: Math.round(Number(u.commission_cents) / 100),
        beneficiaries: u.beneficiaries || [],
        pets: u.pets || [],
        city: u.city,
        createdAt: u.created_at,
        affiliationPaidAt: u.affiliation_paid_at
          ? u.affiliation_paid_at instanceof Date
            ? u.affiliation_paid_at.toISOString()
            : String(u.affiliation_paid_at)
          : null,
        monthlyPaidThrough: u.monthly_paid_through ?? null,
        mora: pay ? pay.mora : null,
        moraReason: pay ? pay.moraReason : null,
        receivesCommission: pay ? pay.receivesCommission : null,
      };
    });
    if (req.adminCtx?.role === "secretary") {
      const redacted = affiliates.map((a) => {
        const {
          balance: _b,
          commission: _c,
          networkSize: _n,
          directCount: _d,
          ...rest
        } = a;
        return rest;
      });
      return res.json(redacted);
    }
    return res.json(affiliates);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error al listar afiliados" });
  }
});

/** Detalle de afiliado con beneficiarios y referidos hasta 3 niveles */
router.get("/affiliates/:id", async (req, res) => {
  try {
    const { id } = req.params;
    let u;
    try {
      u = await pool.query(
        `SELECT id, doc_number, doc_type, full_name, email, plan_id, referral_code,
                sponsor_id, address, city, department, phone, whatsapp,
                birth_date, contract_issue_date, affiliation_paid_at, monthly_paid_through,
                balance_cents, network_size, direct_count, commission_cents,
                beneficiaries, pets, created_at
         FROM users WHERE id = $1`,
        [id]
      );
    } catch (e) {
      if (e.code !== "42703") throw e;
      u = await pool.query(
        `SELECT id, doc_number, doc_type, full_name, email, plan_id, referral_code,
                sponsor_id, address, city, department, phone, whatsapp,
                balance_cents, network_size, direct_count, commission_cents,
                beneficiaries, pets, created_at
         FROM users WHERE id = $1`,
        [id]
      );
    }
    const row = u.rows[0];
    if (!row) {
      return res.status(404).json({ error: "Afiliado no encontrado" });
    }

    const bd =
      row.birth_date instanceof Date
        ? row.birth_date.toISOString().slice(0, 10)
        : row.birth_date
          ? String(row.birth_date).slice(0, 10)
          : null;
    const cfd =
      row.contract_issue_date instanceof Date
        ? row.contract_issue_date.toISOString().slice(0, 10)
        : row.contract_issue_date
          ? String(row.contract_issue_date).slice(0, 10)
          : null;

    let sponsor = null;
    if (row.sponsor_id) {
      try {
        const sp = await pool.query(
          `SELECT full_name, doc_number, referral_code FROM users WHERE id = $1::uuid`,
          [row.sponsor_id]
        );
        if (sp.rows[0]) {
          sponsor = {
            fullName: sp.rows[0].full_name,
            docNumber: sp.rows[0].doc_number,
            refCode: sp.rows[0].referral_code,
          };
        }
      } catch (_) {
        /* ignore */
      }
    }

    if (req.adminCtx?.role === "secretary") {
      const affiliateSec = {
        id: row.id,
        docNumber: row.doc_number,
        docType: row.doc_type,
        fullName: row.full_name,
        email: row.email,
        planId: row.plan_id,
        refCode: row.referral_code,
        sponsorId: row.sponsor_id,
        sponsor,
        address: row.address,
        city: row.city,
        department: row.department,
        phone: row.phone,
        whatsapp: row.whatsapp,
        birthDate: bd,
        contractIssueDate: Object.prototype.hasOwnProperty.call(row, "contract_issue_date") ? cfd : null,
        affiliationPaidAt: row.affiliation_paid_at
          ? row.affiliation_paid_at instanceof Date
            ? row.affiliation_paid_at.toISOString()
            : String(row.affiliation_paid_at)
          : null,
        monthlyPaidThrough: row.monthly_paid_through ?? null,
        beneficiaries: row.beneficiaries || [],
        pets: row.pets || [],
        createdAt: row.created_at,
      };
      const payRow = await pool.query(
        `SELECT affiliation_paid_at, monthly_paid_through FROM users WHERE id = $1`,
        [id]
      );
      const payment = payRow.rows[0] ? paymentFlagsFromRowAdm(payRow.rows[0]) : null;
      await logAdminAudit(req, "affiliates.view_detail", {
        userId: id,
        referralCode: affiliateSec.refCode,
        docNumber: affiliateSec.docNumber,
        fullName: affiliateSec.fullName,
        mora: payment?.mora ?? null,
        moraReason: payment?.moraReason ?? null,
      });
      return res.json({
        affiliate: { ...affiliateSec, payment },
        referrals: { level1: [], level2: [], level3: [] },
        scope: "secretary",
      });
    }

    const [directCount, networkSize] = await Promise.all([
      countDirectReferrals(pool, id),
      countNetworkDownline(pool, id),
    ]);

    const affiliate = {
      id: row.id,
      docNumber: row.doc_number,
      docType: row.doc_type,
      fullName: row.full_name,
      email: row.email,
      planId: row.plan_id,
      refCode: row.referral_code,
      sponsorId: row.sponsor_id,
      sponsor,
      address: row.address,
      city: row.city,
      department: row.department,
      phone: row.phone,
      whatsapp: row.whatsapp,
      birthDate: bd,
      contractIssueDate: Object.prototype.hasOwnProperty.call(row, "contract_issue_date") ? cfd : null,
      affiliationPaidAt: row.affiliation_paid_at
        ? row.affiliation_paid_at instanceof Date
          ? row.affiliation_paid_at.toISOString()
          : String(row.affiliation_paid_at)
        : null,
      monthlyPaidThrough: row.monthly_paid_through ?? null,
      balance: Math.round(Number(row.balance_cents) / 100),
      networkSize,
      directCount,
      commission: Math.round(Number(row.commission_cents) / 100),
      beneficiaries: row.beneficiaries || [],
      pets: row.pets || [],
      createdAt: row.created_at,
    };

    const referrals = { level1: [], level2: [], level3: [] };

    const fetchBySponsors = async (sponsorIds) => {
      if (!sponsorIds?.length) return [];
      const q = await pool.query(
        `SELECT id, sponsor_id, doc_number, full_name, email, plan_id, referral_code, created_at
         FROM users WHERE sponsor_id = ANY($1::uuid[]) ORDER BY created_at`,
        [sponsorIds]
      );
      return q.rows.map((r) => ({
        id: r.id,
        sponsorId: r.sponsor_id,
        docNumber: r.doc_number,
        fullName: r.full_name,
        email: r.email,
        planId: r.plan_id,
        refCode: r.referral_code,
        createdAt: r.created_at,
      }));
    };

    referrals.level1 = await fetchBySponsors([id]);
    const l1Ids = referrals.level1.map((r) => r.id);
    referrals.level2 = await fetchBySponsors(l1Ids);
    const l2Ids = referrals.level2.map((r) => r.id);
    referrals.level3 = await fetchBySponsors(l2Ids);

    let payment = null;
    let commissionEarnedPesos = affiliate.commission;
    let availableBalancePesos = affiliate.balance;
    let disbursementsPending = [];
    try {
      const payRow = await pool.query(
        `SELECT affiliation_paid_at, monthly_paid_through FROM users WHERE id = $1`,
        [id]
      );
      if (payRow.rows[0]) {
        payment = paymentFlagsFromRowAdm(payRow.rows[0]);
      }
      const earned = await pool.query(
        `SELECT COALESCE(SUM(amount_cents),0)::bigint AS t FROM commission_lines WHERE recipient_id = $1::uuid AND (forfeited_at IS NULL)`,
        [id]
      );
      commissionEarnedPesos = Math.round(Number(earned.rows[0].t) / 100);
    } catch (e) {
      if (e.code === "42703") {
        const earned = await pool.query(
          `SELECT COALESCE(SUM(amount_cents),0)::bigint AS t FROM commission_lines WHERE recipient_id = $1::uuid`,
          [id]
        );
        commissionEarnedPesos = Math.round(Number(earned.rows[0].t) / 100);
      } else if (e.code !== "42P01") throw e;
    }
    try {
      const av = await computeAvailableBalanceCents(pool, id);
      availableBalancePesos = Math.round(Number(av) / 100);
    } catch (_) {
      /* sin tabla disbursement o lines */
    }
    try {
      const dis = await pool.query(
        `SELECT id, amount_cents, authorized_at, paid_at, note, created_at, period_month
         FROM disbursement_payouts WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT 24`,
        [id]
      );
      disbursementsPending = dis.rows.map((d) => ({
        id: d.id,
        amount: Math.round(Number(d.amount_cents) / 100),
        authorizedAt: d.authorized_at,
        paidAt: d.paid_at,
        note: d.note,
        createdAt: d.created_at,
        periodMonth: d.period_month,
      }));
    } catch (e) {
      if (e.code !== "42P01") throw e;
    }

    let contractAudit = [];
    try {
      const au = await pool.query(
        `SELECT action, detail, created_at FROM contract_audit_log WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT 20`,
        [id]
      );
      contractAudit = au.rows.map((a) => ({
        action: a.action,
        detail: a.detail,
        createdAt: a.created_at,
      }));
    } catch (e) {
      if (e.code !== "42P01") throw e;
    }

    await logAdminAudit(req, "affiliates.view_detail", {
      userId: id,
      referralCode: affiliate.refCode,
      docNumber: affiliate.docNumber,
      fullName: affiliate.fullName,
      mora: payment?.mora ?? null,
      moraReason: payment?.moraReason ?? null,
    });

    return res.json({
      affiliate: {
        ...affiliate,
        commissionEarnedPesos,
        availableBalancePesos,
        payment,
        disbursements: disbursementsPending,
        contractAudit,
      },
      referrals,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error al obtener afiliado" });
  }
});

/** Resumen para panel Reportes (mora, solicitudes, cierre) */
router.get("/reports/summary", requireOwner, async (_req, res) => {
  const cur = currentPeriodMonthAdm();
  const todayBog = todayYmdBogota();
  const covEnd = pgCoverageEndDateExpr("monthly_paid_through");
  try {
    const moraMensual = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users
       WHERE affiliation_paid_at IS NOT NULL
       AND monthly_paid_through IS NOT NULL AND trim(monthly_paid_through::text) <> ''
       AND ${covEnd} IS NOT NULL AND ${covEnd} < $1::date`,
      [todayBog]
    );
    const sinInscripcion = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users WHERE affiliation_paid_at IS NULL`
    );
    let pendingContracts = { rows: [{ n: 0 }] };
    try {
      pendingContracts = await pool.query(
        `SELECT COUNT(*)::int AS n FROM contract_change_requests WHERE status = 'pending'`
      );
    } catch (e) {
      if (e.code !== "42P01") throw e;
    }
    let forfeitedLines = { rows: [{ n: 0 }] };
    try {
      forfeitedLines = await pool.query(
        `SELECT COUNT(*)::int AS n FROM commission_lines
         WHERE forfeited_at IS NOT NULL AND forfeited_at >= date_trunc('month', NOW()::timestamptz)`
      );
    } catch (e) {
      if (e.code !== "42703") throw e;
    }

    let moraList = [];
    try {
      const ml = await pool.query(
        `SELECT id, full_name, email, referral_code, monthly_paid_through, phone, plan_id
         FROM users
         WHERE affiliation_paid_at IS NOT NULL
         AND monthly_paid_through IS NOT NULL AND trim(monthly_paid_through::text) <> ''
         AND ${covEnd} IS NOT NULL AND ${covEnd} < $1::date
         ORDER BY full_name ASC
         LIMIT 500`,
        [todayBog]
      );
      moraList = ml.rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        email: r.email,
        refCode: r.referral_code,
        monthlyPaidThrough: r.monthly_paid_through,
        phone: r.phone,
        planId: r.plan_id,
        moraReason: "mensualidad",
      }));
    } catch (e) {
      console.error(e);
    }

    let sinInscripcionList = [];
    try {
      const sl = await pool.query(
        `SELECT id, full_name, email, referral_code, created_at, plan_id
         FROM users WHERE affiliation_paid_at IS NULL
         ORDER BY created_at DESC
         LIMIT 200`
      );
      sinInscripcionList = sl.rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        email: r.email,
        refCode: r.referral_code,
        planId: r.plan_id,
        createdAt: r.created_at,
        moraReason: "sin_inscripcion",
      }));
    } catch (e) {
      console.error(e);
    }

    return res.json({
      currentMonth: cur,
      moraMensualCount: moraMensual.rows[0].n,
      sinInscripcionCount: sinInscripcion.rows[0].n,
      pendingContractRequests: pendingContracts.rows[0].n,
      linesForfeitedThisMonth: forfeitedLines.rows[0].n,
      moraList,
      sinInscripcionList,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error al cargar reportes" });
  }
});

/** Datos para exportar reporte mensual (CSV / análisis) */
router.get("/reports/data/monthly", requireOwner, async (req, res) => {
  const month = String(req.query.month || "").trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "Indica month=YYYY-MM" });
  }
  try {
    let comm = { n1: 0, n2: 0, n3: 0, total: 0 };
    try {
      const c = await pool.query(
        `SELECT
          COALESCE(SUM(CASE WHEN level = 1 THEN amount_cents ELSE 0 END), 0)::bigint AS n1,
          COALESCE(SUM(CASE WHEN level = 2 THEN amount_cents ELSE 0 END), 0)::bigint AS n2,
          COALESCE(SUM(CASE WHEN level = 3 THEN amount_cents ELSE 0 END), 0)::bigint AS n3,
          COALESCE(SUM(amount_cents), 0)::bigint AS total
         FROM commission_lines WHERE period_month = $1::text AND (forfeited_at IS NULL)`,
        [month]
      );
      const z = c.rows[0];
      comm = {
        n1: Math.round(Number(z.n1) / 100),
        n2: Math.round(Number(z.n2) / 100),
        n3: Math.round(Number(z.n3) / 100),
        total: Math.round(Number(z.total) / 100),
      };
    } catch (e) {
      if (e.code !== "42703") throw e;
      const c = await pool.query(
        `SELECT
          COALESCE(SUM(CASE WHEN level = 1 THEN amount_cents ELSE 0 END), 0)::bigint AS n1,
          COALESCE(SUM(CASE WHEN level = 2 THEN amount_cents ELSE 0 END), 0)::bigint AS n2,
          COALESCE(SUM(CASE WHEN level = 3 THEN amount_cents ELSE 0 END), 0)::bigint AS n3,
          COALESCE(SUM(amount_cents), 0)::bigint AS total
         FROM commission_lines WHERE period_month = $1::text`,
        [month]
      );
      const z = c.rows[0];
      comm = {
        n1: Math.round(Number(z.n1) / 100),
        n2: Math.round(Number(z.n2) / 100),
        n3: Math.round(Number(z.n3) / 100),
        total: Math.round(Number(z.total) / 100),
      };
    }

    const newAff = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users
       WHERE to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM') = $1`,
      [month]
    );

    const totalUsers = await pool.query(`SELECT COUNT(*)::int AS n FROM users`);
    const affiliated = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE affiliation_paid_at IS NOT NULL`);

    const todayBog = todayYmdBogota();
    const covEndM = pgCoverageEndDateExpr("monthly_paid_through");
    let moraList = [];
    try {
      const ml = await pool.query(
        `SELECT id, full_name, email, referral_code, monthly_paid_through, phone, plan_id
         FROM users
         WHERE affiliation_paid_at IS NOT NULL
         AND monthly_paid_through IS NOT NULL AND trim(monthly_paid_through::text) <> ''
         AND ${covEndM} IS NOT NULL AND ${covEndM} < $1::date
         ORDER BY full_name ASC
         LIMIT 500`,
        [todayBog]
      );
      moraList = ml.rows.map((r) => ({
        fullName: r.full_name,
        email: r.email,
        refCode: r.referral_code,
        monthlyPaidThrough: r.monthly_paid_through,
        phone: r.phone,
        planId: r.plan_id,
      }));
    } catch (e) {
      console.error(e);
    }
    let sinInscripcionList = [];
    try {
      const sl = await pool.query(
        `SELECT full_name, email, referral_code, plan_id, created_at
         FROM users WHERE affiliation_paid_at IS NULL
         ORDER BY created_at DESC LIMIT 200`
      );
      sinInscripcionList = sl.rows.map((r) => ({
        fullName: r.full_name,
        email: r.email,
        refCode: r.referral_code,
        planId: r.plan_id,
        createdAt: r.created_at,
      }));
    } catch (e) {
      console.error(e);
    }

    let cashIncomePesos = 0;
    try {
      const ci = await pool.query(
        `SELECT COALESCE(SUM(amount_cents),0)::bigint AS t
         FROM admin_cash_payments
         WHERE to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM') = $1`,
        [month]
      );
      cashIncomePesos = Math.round(Number(ci.rows[0].t) / 100);
    } catch (e) {
      if (e.code !== "42P01") throw e;
    }
    return res.json({
      generatedAt: new Date().toISOString(),
      month,
      commissionGlobal: comm,
      cashIncomePesos,
      newAffiliatesInMonth: newAff.rows[0].n,
      totalUsers: totalUsers.rows[0].n,
      affiliatedUsers: affiliated.rows[0].n,
      moraList,
      sinInscripcionList,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error al generar datos del mes" });
  }
});

/** Balance anual: comisiones y altas por mes + totales (crecimiento) */
router.get("/reports/data/annual", requireOwner, async (req, res) => {
  const year = String(req.query.year || "").trim();
  if (!/^\d{4}$/.test(year)) {
    return res.status(400).json({ error: "Indica year=YYYY" });
  }
  const yPrev = String(Number(year) - 1);
  try {
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const ym = `${year}-${String(m).padStart(2, "0")}`;
      let comm = { n1: 0, n2: 0, n3: 0, total: 0 };
      try {
        const c = await pool.query(
          `SELECT
            COALESCE(SUM(CASE WHEN level = 1 THEN amount_cents ELSE 0 END), 0)::bigint AS n1,
            COALESCE(SUM(CASE WHEN level = 2 THEN amount_cents ELSE 0 END), 0)::bigint AS n2,
            COALESCE(SUM(CASE WHEN level = 3 THEN amount_cents ELSE 0 END), 0)::bigint AS n3,
            COALESCE(SUM(amount_cents), 0)::bigint AS total
           FROM commission_lines WHERE period_month = $1::text AND (forfeited_at IS NULL)`,
          [ym]
        );
        const z = c.rows[0];
        comm = {
          n1: Math.round(Number(z.n1) / 100),
          n2: Math.round(Number(z.n2) / 100),
          n3: Math.round(Number(z.n3) / 100),
          total: Math.round(Number(z.total) / 100),
        };
      } catch (e) {
        if (e.code !== "42703") throw e;
        const c = await pool.query(
          `SELECT
            COALESCE(SUM(CASE WHEN level = 1 THEN amount_cents ELSE 0 END), 0)::bigint AS n1,
            COALESCE(SUM(CASE WHEN level = 2 THEN amount_cents ELSE 0 END), 0)::bigint AS n2,
            COALESCE(SUM(CASE WHEN level = 3 THEN amount_cents ELSE 0 END), 0)::bigint AS n3,
            COALESCE(SUM(amount_cents), 0)::bigint AS total
           FROM commission_lines WHERE period_month = $1::text`,
          [ym]
        );
        const z = c.rows[0];
        comm = {
          n1: Math.round(Number(z.n1) / 100),
          n2: Math.round(Number(z.n2) / 100),
          n3: Math.round(Number(z.n3) / 100),
          total: Math.round(Number(z.total) / 100),
        };
      }
      const na = await pool.query(
        `SELECT COUNT(*)::int AS n FROM users
         WHERE to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM') = $1`,
        [ym]
      );
      months.push({ month: ym, commission: comm, newAffiliates: na.rows[0].n });
    }

    let yearCommissionTotal = 0;
    try {
      const yt = await pool.query(
        `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS t FROM commission_lines
         WHERE period_month >= $1 AND period_month <= $2 AND (forfeited_at IS NULL)`,
        [`${year}-01`, `${year}-12`]
      );
      yearCommissionTotal = Math.round(Number(yt.rows[0].t) / 100);
    } catch (e) {
      if (e.code !== "42703") throw e;
      const yt = await pool.query(
        `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS t FROM commission_lines
         WHERE period_month >= $1 AND period_month <= $2`,
        [`${year}-01`, `${year}-12`]
      );
      yearCommissionTotal = Math.round(Number(yt.rows[0].t) / 100);
    }

    const newUsersYear = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users
       WHERE to_char(created_at AT TIME ZONE 'UTC', 'YYYY') = $1`,
      [year]
    );
    const newUsersPrev = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users
       WHERE to_char(created_at AT TIME ZONE 'UTC', 'YYYY') = $1`,
      [yPrev]
    );

    const totalUsers = await pool.query(`SELECT COUNT(*)::int AS n FROM users`);

    let yearCashTotal = 0;
    try {
      const yc = await pool.query(
        `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS t FROM admin_cash_payments
         WHERE to_char(created_at AT TIME ZONE 'UTC', 'YYYY') = $1`,
        [year]
      );
      yearCashTotal = Math.round(Number(yc.rows[0].t) / 100);
    } catch (e) {
      if (e.code !== "42P01") throw e;
    }
    return res.json({
      generatedAt: new Date().toISOString(),
      year,
      months,
      yearCommissionTotalPesos: yearCommissionTotal,
      yearCashTotalPesos: yearCashTotal,
      newUsersInYear: newUsersYear.rows[0].n,
      newUsersPreviousYear: newUsersPrev.rows[0].n,
      growthNewUsersPct:
        newUsersPrev.rows[0].n > 0
          ? Math.round(((newUsersYear.rows[0].n - newUsersPrev.rows[0].n) / newUsersPrev.rows[0].n) * 1000) / 10
          : null,
      totalUsersEnd: totalUsers.rows[0].n,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error al generar balance anual" });
  }
});

/** Comisiones por asociado en un mes (N1/N2/N3 + estado de pago) */
router.get("/commissions/by-affiliate", requireOwner, async (req, res) => {
  const month = String(req.query.month || "").trim();
  const showAll = req.query.all === "1";
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "Indica month=YYYY-MM" });
  }
  const mapRow = (row) => {
    const pf = paymentFlagsFromRowAdm(row);
    return {
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      planId: row.plan_id,
      refCode: row.referral_code,
      n1: Math.round(Number(row.n1) / 100),
      n2: Math.round(Number(row.n2) / 100),
      n3: Math.round(Number(row.n3) / 100),
      total: Math.round(Number(row.total) / 100),
      affiliationPaid: pf.affiliationPaid,
      monthlyPaidThrough: pf.monthlyPaidThrough,
      receivesCommission: pf.receivesCommission,
      mora: pf.mora,
      moraReason: pf.moraReason,
    };
  };
  try {
    let r;
    try {
      r = await pool.query(
        `SELECT u.id, u.full_name, u.email, u.plan_id, u.referral_code,
                u.affiliation_paid_at, u.monthly_paid_through,
                COALESCE(SUM(CASE WHEN cl.level = 1 THEN cl.amount_cents ELSE 0 END), 0)::bigint AS n1,
                COALESCE(SUM(CASE WHEN cl.level = 2 THEN cl.amount_cents ELSE 0 END), 0)::bigint AS n2,
                COALESCE(SUM(CASE WHEN cl.level = 3 THEN cl.amount_cents ELSE 0 END), 0)::bigint AS n3,
                COALESCE(SUM(cl.amount_cents), 0)::bigint AS total
         FROM users u
         LEFT JOIN commission_lines cl ON cl.recipient_id = u.id AND cl.period_month = $1::text
           AND (cl.forfeited_at IS NULL)
         GROUP BY u.id, u.full_name, u.email, u.plan_id, u.referral_code, u.affiliation_paid_at, u.monthly_paid_through
         ${showAll ? "" : "HAVING COALESCE(SUM(cl.amount_cents), 0) <> 0"}
         ORDER BY u.full_name ASC
         LIMIT 500`,
        [month]
      );
    } catch (e) {
      if (e.code !== "42703") throw e;
      r = await pool.query(
        `SELECT u.id, u.full_name, u.email, u.plan_id, u.referral_code,
                u.affiliation_paid_at, u.monthly_paid_through,
                COALESCE(SUM(CASE WHEN cl.level = 1 THEN cl.amount_cents ELSE 0 END), 0)::bigint AS n1,
                COALESCE(SUM(CASE WHEN cl.level = 2 THEN cl.amount_cents ELSE 0 END), 0)::bigint AS n2,
                COALESCE(SUM(CASE WHEN cl.level = 3 THEN cl.amount_cents ELSE 0 END), 0)::bigint AS n3,
                COALESCE(SUM(cl.amount_cents), 0)::bigint AS total
         FROM users u
         LEFT JOIN commission_lines cl ON cl.recipient_id = u.id AND cl.period_month = $1::text
         GROUP BY u.id, u.full_name, u.email, u.plan_id, u.referral_code, u.affiliation_paid_at, u.monthly_paid_through
         ${showAll ? "" : "HAVING COALESCE(SUM(cl.amount_cents), 0) <> 0"}
         ORDER BY u.full_name ASC
         LIMIT 500`,
        [month]
      );
    }
    return res.json({ month, affiliates: r.rows.map(mapRow) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error al listar comisiones por asociado" });
  }
});

/** Cierre mensual: anula comisiones del mes para quien no esté al día con la mensualidad a esa fecha. */
router.post("/commissions/close-month", requireOwner, async (req, res) => {
  const month = String(req.body?.month || "").trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "Envía month en formato YYYY-MM" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rec = await client.query(
      `SELECT DISTINCT recipient_id FROM commission_lines WHERE period_month = $1::text AND forfeited_at IS NULL`,
      [month]
    );
    let forfeited = 0;
    for (const { recipient_id } of rec.rows) {
      const ur = await client.query(
        `SELECT affiliation_paid_at, monthly_paid_through FROM users WHERE id = $1`,
        [recipient_id]
      );
      const u = ur.rows[0];
      if (!u || !u.affiliation_paid_at) continue;
      const monthly = u.monthly_paid_through;
      const covers = coversCommissionPeriod(monthly, month, u.affiliation_paid_at);
      const legacy = String(monthly ?? "").trim() === "";
      const eligible = covers || legacy;
      if (!eligible) {
        const up = await client.query(
          `UPDATE commission_lines SET forfeited_at = NOW(), forfeiture_reason = $3
           WHERE period_month = $1::text AND recipient_id = $2::uuid AND forfeited_at IS NULL`,
          [month, recipient_id, "mora_mensualidad_cierre"]
        );
        forfeited += up.rowCount ?? 0;
      }
    }
    await client.query("COMMIT");
    await logAdminAudit(req, "commissions.close_month", { month, linesForfeited: forfeited });
    return res.json({ ok: true, month, linesForfeited: forfeited });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    if (e.code === "42703") {
      return res.status(503).json({ error: "Falta columna forfeited_at. Ejecuta migrate_admin_reports_contracts.sql" });
    }
    return res.status(500).json({ error: "Error en cierre de mes" });
  } finally {
    client.release();
  }
});

/** Autoriza desembolso (solo si el afiliado está al día y hay saldo) */
router.post("/disbursements/authorize", requireOwner, async (req, res) => {
  const userId = String(req.body?.userId || "").trim();
  const amountPesos = Number(req.body?.amountPesos);
  const note = req.body?.note != null ? String(req.body.note).slice(0, 500) : null;
  const periodMonth =
    req.body?.periodMonth != null ? String(req.body.periodMonth).trim().slice(0, 7) : null;
  if (!userId || !Number.isFinite(amountPesos) || amountPesos <= 0) {
    return res.status(400).json({ error: "userId y amountPesos válidos requeridos" });
  }
  const amountCents = Math.round(amountPesos * 100);
  if (amountCents < 1) {
    return res.status(400).json({ error: "Monto inválido" });
  }
  try {
    const ur = await pool.query(
      `SELECT affiliation_paid_at, monthly_paid_through, referral_code, doc_number, full_name FROM users WHERE id = $1::uuid`,
      [userId]
    );
    if (!ur.rows.length) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    const urow = ur.rows[0];
    const pf = paymentFlagsFromRowAdm(urow);
    if (!pf.receivesCommission) {
      return res.status(400).json({ error: "El afiliado no está al día; no se puede autorizar desembolso." });
    }
    const avail = await computeAvailableBalanceCents(pool, userId);
    if (avail < BigInt(amountCents)) {
      return res.status(400).json({ error: "Saldo disponible insuficiente." });
    }
    const ins = await pool.query(
      `INSERT INTO disbursement_payouts (user_id, amount_cents, period_month, authorized_at, note)
       VALUES ($1::uuid, $2, $3, NOW(), $4)
       RETURNING id, created_at`,
      [userId, amountCents, periodMonth || null, note]
    );
    await logAdminAudit(req, "disbursements.authorize", {
      disbursementId: ins.rows[0].id,
      beneficiaryUserId: userId,
      docNumber: urow.doc_number,
      referralCode: urow.referral_code ?? null,
      fullName: urow.full_name,
      amountPesos,
      periodMonth: periodMonth || null,
    });
    return res.json({
      ok: true,
      id: ins.rows[0].id,
      createdAt: ins.rows[0].created_at,
    });
  } catch (e) {
    console.error(e);
    if (e.code === "42P01") {
      return res.status(503).json({ error: "Ejecuta migrate_admin_reports_contracts.sql (tabla disbursement_payouts)" });
    }
    return res.status(500).json({ error: "No se pudo autorizar el desembolso" });
  }
});

router.post("/disbursements/:id/mark-paid", requireOwner, async (req, res) => {
  const { id } = req.params;
  try {
    const r = await pool.query(
      `UPDATE disbursement_payouts SET paid_at = NOW() WHERE id = $1::uuid AND paid_at IS NULL RETURNING id`,
      [id]
    );
    if (!r.rows.length) {
      return res.status(404).json({ error: "Desembolso no encontrado o ya pagado" });
    }
    await logAdminAudit(req, "disbursements.mark_paid", { disbursementId: id });
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    if (e.code === "42P01") {
      return res.status(503).json({ error: "Ejecuta migrate_admin_reports_contracts.sql" });
    }
    return res.status(500).json({ error: "Error al marcar pago" });
  }
});

router.get("/contract-requests", requireOwner, async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT cr.id, cr.user_id, cr.proposed_beneficiaries, cr.proposed_pets, cr.note, cr.status,
              cr.created_at, cr.resolved_at, cr.resolved_note,
              u.full_name AS user_full_name, u.email AS user_email, u.referral_code
       FROM contract_change_requests cr
       JOIN users u ON u.id = cr.user_id
       ORDER BY cr.created_at DESC
       LIMIT 200`
    );
    return res.json({
      requests: r.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        userFullName: row.user_full_name,
        userEmail: row.user_email,
        referralCode: row.referral_code,
        proposedBeneficiaries: row.proposed_beneficiaries,
        proposedPets: row.proposed_pets,
        note: row.note,
        status: row.status,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
        resolvedNote: row.resolved_note,
      })),
    });
  } catch (e) {
    console.error(e);
    if (e.code === "42P01") {
      return res.json({ requests: [] });
    }
    return res.status(500).json({ error: "Error al listar solicitudes" });
  }
});

router.post("/contract-requests/:id/approve", requireOwner, async (req, res) => {
  const { id } = req.params;
  const resolvedNote = req.body?.resolvedNote != null ? String(req.body.resolvedNote).slice(0, 500) : null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const q = await client.query(
      `SELECT id, user_id, proposed_beneficiaries, proposed_pets, status FROM contract_change_requests WHERE id = $1::uuid FOR UPDATE`,
      [id]
    );
    const reqRow = q.rows[0];
    if (!reqRow || reqRow.status !== "pending") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Solicitud no pendiente o inexistente" });
    }
    await client.query(
      `UPDATE users SET beneficiaries = $1::jsonb, pets = $2::jsonb, updated_at = NOW() WHERE id = $3::uuid`,
      [reqRow.proposed_beneficiaries, reqRow.proposed_pets, reqRow.user_id]
    );
    await client.query(
      `INSERT INTO contract_audit_log (user_id, action, detail)
       VALUES ($1::uuid, $2, $3::jsonb)`,
      [
        reqRow.user_id,
        "contract_change_approved",
        { requestId: id, at: new Date().toISOString() },
      ]
    );
    await client.query(
      `UPDATE contract_change_requests SET status = 'approved', resolved_at = NOW(), resolved_note = $2 WHERE id = $1::uuid`,
      [id, resolvedNote]
    );
    await client.query("COMMIT");
    await logAdminAudit(req, "contract_requests.approve", {
      requestId: id,
      affiliateUserId: reqRow.user_id,
    });
    return res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    if (e.code === "42P01") {
      return res.status(503).json({ error: "Ejecuta migrate_admin_reports_contracts.sql" });
    }
    return res.status(500).json({ error: "No se pudo aprobar la solicitud" });
  } finally {
    client.release();
  }
});

router.post("/contract-requests/:id/reject", requireOwner, async (req, res) => {
  const { id } = req.params;
  const resolvedNote = req.body?.resolvedNote != null ? String(req.body.resolvedNote).slice(0, 500) : null;
  try {
    const r = await pool.query(
      `UPDATE contract_change_requests SET status = 'rejected', resolved_at = NOW(), resolved_note = $2
       WHERE id = $1::uuid AND status = 'pending' RETURNING id`,
      [id, resolvedNote]
    );
    if (!r.rows.length) {
      return res.status(400).json({ error: "Solicitud no pendiente o inexistente" });
    }
    await logAdminAudit(req, "contract_requests.reject", { requestId: id });
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error al rechazar" });
  }
});

/** Solo admin: fecha del contrato (no debe cambiar al reimprimir; solo desde aquí) */
router.patch("/affiliates/:id/contract-date", requireOwner, async (req, res) => {
  try {
    const { id } = req.params;
    const d = String(req.body?.contractIssueDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return res.status(400).json({ error: "Usa fecha YYYY-MM-DD" });
    }
    const r = await pool.query(
      `UPDATE users SET contract_issue_date = $1::date, updated_at = NOW() WHERE id = $2::uuid RETURNING id, referral_code, doc_number, full_name`,
      [d, id]
    );
    if (!r.rows.length) {
      return res.status(404).json({ error: "Afiliado no encontrado" });
    }
    const row = r.rows[0];
    await logAdminAudit(req, "affiliates.contract_date", {
      affiliateUserId: row.id,
      docNumber: row.doc_number,
      referralCode: row.referral_code ?? null,
      fullName: row.full_name,
      contractIssueDate: d,
    });
    return res.json({ ok: true, contractIssueDate: d });
  } catch (e) {
    console.error(e);
    if (e.code === "42703") {
      return res.status(500).json({ error: "Falta columna contract_issue_date. Ejecuta migrate_payment_affiliation.sql" });
    }
    return res.status(500).json({ error: "Error al actualizar" });
  }
});

/** Inscripciones a cursos — Academia */
router.get("/academy/registrations", requireOwner, async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, affiliate_user_id, full_name, email, phone, course_interest, notes, status, created_at
       FROM academy_registrations ORDER BY created_at DESC LIMIT 500`
    );
    return res.json({ registrations: r.rows });
  } catch (e) {
    if (e.code === "42P01") return res.json({ registrations: [] });
    console.error(e);
    return res.status(500).json({ error: "Error al listar inscripciones" });
  }
});

/** Crear aviso / oferta de curso para afiliados */
router.post("/academy/broadcasts", requireOwner, async (req, res) => {
  const title = String(req.body?.title || "").trim();
  const body = String(req.body?.body || "").trim().slice(0, 4000);
  const courseName = String(req.body?.courseName || "").trim().slice(0, 200);
  const startDate = req.body?.startDate != null ? String(req.body.startDate).trim() : "";
  if (title.length < 3) {
    return res.status(400).json({ error: "Título requerido (mín. 3 caracteres)" });
  }
  const sd =
    startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : null;
  try {
    const ins = await pool.query(
      `INSERT INTO academy_broadcasts (title, body, course_name, start_date)
       VALUES ($1, $2, $3, $4) RETURNING id, title, body, course_name, start_date, created_at`,
      [title, body || null, courseName || null, sd]
    );
    await logAdminAudit(req, "academy.broadcast_create", {
      broadcastId: ins.rows[0].id,
      title: ins.rows[0].title,
    });
    return res.json({ broadcast: ins.rows[0] });
  } catch (e) {
    console.error(e);
    if (e.code === "42P01") {
      return res.status(503).json({ error: "Ejecuta migrate_academy_jobs.sql en la base de datos" });
    }
    return res.status(500).json({ error: "No se pudo crear el aviso" });
  }
});

router.get("/academy/broadcasts", requireOwner, async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, title, body, course_name, start_date, active, created_at
       FROM academy_broadcasts ORDER BY created_at DESC LIMIT 100`
    );
    return res.json({ broadcasts: r.rows });
  } catch (e) {
    if (e.code === "42P01") return res.json({ broadcasts: [] });
    return res.status(500).json({ error: "Error" });
  }
});

/* ===========================================================================
 * CIERRES DE CAJA — snapshots inmutables
 * -----------------------------------------------------------------------
 * - Secretaria: hace POST /closures/daily → guarda su cierre del día.
 * - Owner: hace POST /closures/monthly → guarda el cierre del mes.
 * - Una vez guardado, NO se modifica.
 * - El listado y el detalle (GET) se usan para que el admin descargue PDF.
 * =========================================================================*/

/** Verifica si la tabla cash_closures existe (la migración pudo no haberse ejecutado). */
let _cashClosuresTableExists = null;
async function cashClosuresTableExists() {
  if (_cashClosuresTableExists !== null) return _cashClosuresTableExists;
  try {
    const r = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'cash_closures' LIMIT 1`
    );
    _cashClosuresTableExists = r.rowCount > 0;
  } catch {
    _cashClosuresTableExists = false;
  }
  return _cashClosuresTableExists;
}

/** Construye el snapshot del cierre diario sin guardarlo en BD (función reutilizable). */
async function buildDailyClosureData({ adminCtx, dateRaw, registrarRaw }) {
  const dateFilter = /^\d{4}-\d{2}-\d{2}$/.test(String(dateRaw || "").trim())
    ? String(dateRaw).trim()
    : null;
  const isSecretary = adminCtx?.role === "secretary";
  let regFilter = registrarRaw ? normalizeAdminBody(String(registrarRaw)) : "";
  if (isSecretary) {
    regFilter = String(adminCtx?.username || "").trim();
  }

  const hasRegCol = await adminCashPaymentsHasRegistrarColumn();
  const hasChannelCol = await adminCashPaymentsHasChannelColumn();
  const conds = [];
  const params = [];
  let pi = 1;

  // Día (zona Bogotá). Si no se pasó, se usa hoy.
  if (dateFilter) {
    conds.push(`((p.created_at AT TIME ZONE 'America/Bogota')::date) = $${pi}::date`);
    params.push(dateFilter);
    pi++;
  } else {
    conds.push(`((p.created_at AT TIME ZONE 'America/Bogota')::date) = (NOW() AT TIME ZONE 'America/Bogota')::date`);
  }
  if (regFilter && hasRegCol) {
    conds.push(`LOWER(COALESCE(p.registered_by_username,'')) = LOWER($${pi})`);
    params.push(regFilter);
    pi++;
  }
  const where = `WHERE ${conds.join(" AND ")}`;
  const channelExpr = hasChannelCol ? `COALESCE(p.payment_channel,'cash')` : `'cash'`;

  const sumQ = await pool.query(
    `SELECT
       COALESCE(SUM(p.amount_cents), 0)::bigint AS total_cents,
       COUNT(*)::int AS n,
       COALESCE(SUM(p.amount_cents) FILTER (WHERE p.payment_type = 'affiliation'), 0)::bigint AS aff_cents,
       COALESCE(SUM(p.amount_cents) FILTER (WHERE p.payment_type = 'monthly'), 0)::bigint AS mon_cents,
       COALESCE(SUM(p.amount_cents) FILTER (WHERE ${channelExpr} = 'cash'), 0)::bigint AS cash_cents,
       COALESCE(SUM(p.amount_cents) FILTER (WHERE ${channelExpr} = 'consignment'), 0)::bigint AS cons_cents,
       MIN((p.created_at AT TIME ZONE 'America/Bogota')::date)::text AS resolved_date
     FROM admin_cash_payments p
     ${where}`,
    params
  );
  const sr = sumQ.rows[0];

  // Si no se pasó date, devolvemos también la fecha real (hoy en Bogotá), aunque no haya movimientos.
  let resolvedDate = dateFilter || sr.resolved_date;
  if (!resolvedDate) {
    const t = await pool.query(
      `SELECT to_char((NOW() AT TIME ZONE 'America/Bogota')::date, 'YYYY-MM-DD') AS d`
    );
    resolvedDate = t.rows[0].d;
  }

  let byRegistrar = [];
  if (!isSecretary && hasRegCol) {
    const brQ = await pool.query(
      `SELECT
         COALESCE(p.registered_by_username, '(sin registrar)') AS registrar,
         COALESCE(SUM(p.amount_cents), 0)::bigint AS total_cents,
         COUNT(*)::int AS n
       FROM admin_cash_payments p
       ${where}
       GROUP BY COALESCE(p.registered_by_username, '(sin registrar)')
       ORDER BY total_cents DESC`,
      params
    );
    byRegistrar = brQ.rows.map((r) => ({
      registrar: r.registrar,
      totalPesos: Math.round(Number(r.total_cents) / 100),
      count: Number(r.n),
    }));
  }

  const optSel = [
    hasRegCol ? "p.registered_by_username" : null,
    hasChannelCol ? "p.payment_channel" : null,
  ]
    .filter(Boolean)
    .join(", ");
  const optSelSql = optSel ? `, ${optSel}` : "";
  const itemsQ = await pool.query(
    `SELECT p.id, p.doc_number, p.full_name, p.payment_type, p.amount_cents, p.months_count,
            p.monthly_paid_through_before, p.monthly_paid_through_after, p.note, p.created_at${optSelSql}
     FROM admin_cash_payments p
     ${where}
     ORDER BY p.created_at ASC`,
    params
  );
  const items = itemsQ.rows.map((row) => ({
    id: row.id,
    docNumber: row.doc_number,
    fullName: row.full_name,
    paymentType: row.payment_type,
    amountPesos: Math.round(Number(row.amount_cents) / 100),
    monthsCount: row.months_count,
    monthlyPaidThroughBefore: row.monthly_paid_through_before,
    monthlyPaidThroughAfter: row.monthly_paid_through_after,
    note: row.note,
    createdAt: row.created_at,
    registeredBy: hasRegCol ? row.registered_by_username || null : null,
    paymentChannel: hasChannelCol
      ? (row.payment_channel === "consignment" ? "consignment" : "cash")
      : "cash",
  }));

  return {
    scope: isSecretary ? "secretary" : "owner",
    date: resolvedDate,
    registrar: regFilter || null,
    summary: {
      totalCents: Number(sr.total_cents),
      totalPesos: Math.round(Number(sr.total_cents) / 100),
      count: Number(sr.n),
      affiliationCents: Number(sr.aff_cents),
      affiliationPesos: Math.round(Number(sr.aff_cents) / 100),
      monthlyCents: Number(sr.mon_cents),
      monthlyPesos: Math.round(Number(sr.mon_cents) / 100),
      cashCents: Number(sr.cash_cents),
      cashPesos: Math.round(Number(sr.cash_cents) / 100),
      consignmentCents: Number(sr.cons_cents),
      consignmentPesos: Math.round(Number(sr.cons_cents) / 100),
    },
    byRegistrar,
    items,
  };
}

/** Construye el snapshot del cierre mensual sin guardarlo. */
async function buildMonthlyClosureData({ month }) {
  const hasRegCol = await adminCashPaymentsHasRegistrarColumn();
  const hasChannelCol = await adminCashPaymentsHasChannelColumn();
  const channelExpr = hasChannelCol ? `COALESCE(p.payment_channel,'cash')` : `'cash'`;

  const sumQ = await pool.query(
    `SELECT
       COALESCE(SUM(p.amount_cents), 0)::bigint AS total_cents,
       COUNT(*)::int AS n,
       COALESCE(SUM(p.amount_cents) FILTER (WHERE p.payment_type = 'affiliation'), 0)::bigint AS aff_cents,
       COALESCE(SUM(p.amount_cents) FILTER (WHERE p.payment_type = 'monthly'), 0)::bigint AS mon_cents,
       COALESCE(SUM(p.amount_cents) FILTER (WHERE ${channelExpr} = 'cash'), 0)::bigint AS cash_cents,
       COALESCE(SUM(p.amount_cents) FILTER (WHERE ${channelExpr} = 'consignment'), 0)::bigint AS cons_cents
     FROM admin_cash_payments p
     WHERE to_char((p.created_at AT TIME ZONE 'America/Bogota'), 'YYYY-MM') = $1`,
    [month]
  );
  const sr = sumQ.rows[0];

  const byDayQ = await pool.query(
    `SELECT
       to_char((p.created_at AT TIME ZONE 'America/Bogota')::date, 'YYYY-MM-DD') AS day,
       COALESCE(SUM(p.amount_cents), 0)::bigint AS total_cents,
       COUNT(*)::int AS n
     FROM admin_cash_payments p
     WHERE to_char((p.created_at AT TIME ZONE 'America/Bogota'), 'YYYY-MM') = $1
     GROUP BY (p.created_at AT TIME ZONE 'America/Bogota')::date
     ORDER BY (p.created_at AT TIME ZONE 'America/Bogota')::date ASC`,
    [month]
  );
  const byDay = byDayQ.rows.map((r) => ({
    day: r.day,
    totalPesos: Math.round(Number(r.total_cents) / 100),
    count: Number(r.n),
  }));

  let byRegistrar = [];
  if (hasRegCol) {
    const brQ = await pool.query(
      `SELECT
         COALESCE(p.registered_by_username, '(sin registrar)') AS registrar,
         COALESCE(SUM(p.amount_cents), 0)::bigint AS total_cents,
         COUNT(*)::int AS n,
         COALESCE(SUM(p.amount_cents) FILTER (WHERE p.payment_type = 'affiliation'), 0)::bigint AS aff_cents,
         COALESCE(SUM(p.amount_cents) FILTER (WHERE p.payment_type = 'monthly'), 0)::bigint AS mon_cents
       FROM admin_cash_payments p
       WHERE to_char((p.created_at AT TIME ZONE 'America/Bogota'), 'YYYY-MM') = $1
       GROUP BY COALESCE(p.registered_by_username, '(sin registrar)')
       ORDER BY total_cents DESC`,
      [month]
    );
    byRegistrar = brQ.rows.map((r) => ({
      registrar: r.registrar,
      totalPesos: Math.round(Number(r.total_cents) / 100),
      count: Number(r.n),
      affiliationPesos: Math.round(Number(r.aff_cents) / 100),
      monthlyPesos: Math.round(Number(r.mon_cents) / 100),
    }));
  }

  return {
    month,
    summary: {
      totalCents: Number(sr.total_cents),
      totalPesos: Math.round(Number(sr.total_cents) / 100),
      count: Number(sr.n),
      affiliationCents: Number(sr.aff_cents),
      affiliationPesos: Math.round(Number(sr.aff_cents) / 100),
      monthlyCents: Number(sr.mon_cents),
      monthlyPesos: Math.round(Number(sr.mon_cents) / 100),
      cashCents: Number(sr.cash_cents),
      cashPesos: Math.round(Number(sr.cash_cents) / 100),
      consignmentCents: Number(sr.cons_cents),
      consignmentPesos: Math.round(Number(sr.cons_cents) / 100),
    },
    byDay,
    byRegistrar,
  };
}

/**
 * GET /closures/daily — Vista previa del cierre del día (NO guarda).
 * - Secretaria: SOLO sus movimientos del día (filtro forzado por su usuario).
 * - Owner: por defecto todos los movimientos del día. Con ?registrar=USER filtra por uno.
 */
router.get("/closures/daily", async (req, res) => {
  try {
    const data = await buildDailyClosureData({
      adminCtx: req.adminCtx,
      dateRaw: req.query.date,
      registrarRaw: req.query.registrar,
    });
    return res.json(data);
  } catch (e) {
    if (e.code === "42P01") {
      return res.status(503).json({ error: "Ejecuta migrate_admin_cash_payments.sql en la base de datos" });
    }
    console.error(e);
    return res.status(500).json({ error: "Error al generar cierre diario" });
  }
});

/**
 * POST /closures/daily — Genera el cierre del día, lo GUARDA como snapshot
 * inmutable en cash_closures y devuelve el snapshot completo para mostrar en pantalla.
 *
 * - Secretaria: cierre filtrado por su propio usuario (es su cierre personal).
 * - Owner: cierre global del día (todos los registradores) o filtrado por ?registrar=
 *
 * Si ya existe un cierre con la misma combinación (tipo, fecha, registrador):
 * devuelve 409 con el cierre existente. No se permite cerrar dos veces el mismo día.
 */
router.post("/closures/daily", async (req, res) => {
  try {
    if (!(await cashClosuresTableExists())) {
      return res.status(503).json({
        error: "Ejecuta en Neon: db/migrate_cash_closures.sql para habilitar los cierres guardados.",
      });
    }
    const data = await buildDailyClosureData({
      adminCtx: req.adminCtx,
      dateRaw: req.query.date || req.body?.date,
      registrarRaw: req.query.registrar || req.body?.registrar,
    });
    const period = data.date; // YYYY-MM-DD
    const filterRegistrar = data.registrar || null;
    const generatedBy = String(req.adminCtx?.username || "").trim();
    const generatedRole = req.adminCtx?.role || "owner";
    const closureYear = parseInt(period.slice(0, 4), 10);

    // Verificar existencia previa para devolver el snapshot ya guardado en lugar de fallar.
    const existing = await pool.query(
      `SELECT id, snapshot, created_at, consecutive_number
       FROM cash_closures
       WHERE closure_type = 'daily' AND period = $1
         AND COALESCE(filter_registrar, '__GLOBAL__') = COALESCE($2, '__GLOBAL__')
       LIMIT 1`,
      [period, filterRegistrar]
    );
    if (existing.rowCount > 0) {
      const row = existing.rows[0];
      return res.status(409).json({
        error: "Este día ya tiene un cierre generado. No se puede cerrar dos veces.",
        existing: {
          id: row.id,
          consecutiveNumber: row.consecutive_number,
          createdAt: row.created_at,
          ...row.snapshot,
        },
      });
    }

    // Calcular consecutivo del año (por tipo)
    const consQ = await pool.query(
      `SELECT COALESCE(MAX(consecutive_number), 0) + 1 AS next
       FROM cash_closures
       WHERE closure_type = 'daily' AND closure_year = $1`,
      [closureYear]
    );
    const consecutiveNumber = consQ.rows[0].next;

    const ins = await pool.query(
      `INSERT INTO cash_closures (
         closure_type, period, filter_registrar,
         generated_by_username, generated_by_role,
         closure_year, consecutive_number,
         total_cents, movements_count,
         affiliation_cents, monthly_cents, cash_cents, consignment_cents,
         snapshot
       ) VALUES (
         'daily', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb
       )
       RETURNING id, created_at, consecutive_number`,
      [
        period,
        filterRegistrar,
        generatedBy,
        generatedRole,
        closureYear,
        consecutiveNumber,
        data.summary.totalCents,
        data.summary.count,
        data.summary.affiliationCents,
        data.summary.monthlyCents,
        data.summary.cashCents,
        data.summary.consignmentCents,
        JSON.stringify(data),
      ]
    );

    await logAdminAudit(req, "closures.daily.create", {
      closureId: ins.rows[0].id,
      period,
      filterRegistrar,
      consecutiveNumber: ins.rows[0].consecutive_number,
      totalPesos: data.summary.totalPesos,
      count: data.summary.count,
    });

    return res.json({
      id: ins.rows[0].id,
      consecutiveNumber: ins.rows[0].consecutive_number,
      createdAt: ins.rows[0].created_at,
      generatedBy,
      ...data,
    });
  } catch (e) {
    if (e.code === "42P01") {
      return res.status(503).json({
        error: "Ejecuta en Neon: db/migrate_cash_closures.sql para habilitar los cierres guardados.",
      });
    }
    if (e.code === "23505") {
      return res.status(409).json({ error: "Este día ya tiene un cierre generado. No se puede cerrar dos veces." });
    }
    console.error(e);
    return res.status(500).json({ error: "No se pudo guardar el cierre del día" });
  }
});

/**
 * GET /closures/monthly — Vista previa del cierre mensual (solo owner, NO guarda).
 */
router.get("/closures/monthly", requireOwner, async (req, res) => {
  const monthRaw = String(req.query.month || "").trim();
  const month = /^\d{4}-\d{2}$/.test(monthRaw) ? monthRaw : null;
  if (!month) {
    return res.status(400).json({ error: "Parámetro month requerido en formato YYYY-MM" });
  }
  try {
    const data = await buildMonthlyClosureData({ month });
    return res.json(data);
  } catch (e) {
    if (e.code === "42P01") {
      return res.status(503).json({ error: "Ejecuta migrate_admin_cash_payments.sql en la base de datos" });
    }
    console.error(e);
    return res.status(500).json({ error: "Error al generar cierre mensual" });
  }
});

/**
 * POST /closures/monthly — Genera y GUARDA el cierre mensual (solo owner).
 */
router.post("/closures/monthly", requireOwner, async (req, res) => {
  const monthRaw = String(req.query.month || req.body?.month || "").trim();
  const month = /^\d{4}-\d{2}$/.test(monthRaw) ? monthRaw : null;
  if (!month) {
    return res.status(400).json({ error: "Parámetro month requerido en formato YYYY-MM" });
  }
  try {
    if (!(await cashClosuresTableExists())) {
      return res.status(503).json({
        error: "Ejecuta en Neon: db/migrate_cash_closures.sql para habilitar los cierres guardados.",
      });
    }
    const data = await buildMonthlyClosureData({ month });
    const generatedBy = String(req.adminCtx?.username || "").trim();
    const generatedRole = req.adminCtx?.role || "owner";
    const closureYear = parseInt(month.slice(0, 4), 10);

    const existing = await pool.query(
      `SELECT id, snapshot, created_at, consecutive_number
       FROM cash_closures
       WHERE closure_type = 'monthly' AND period = $1
         AND COALESCE(filter_registrar, '__GLOBAL__') = '__GLOBAL__'
       LIMIT 1`,
      [month]
    );
    if (existing.rowCount > 0) {
      const row = existing.rows[0];
      return res.status(409).json({
        error: "Este mes ya tiene un cierre generado. No se puede cerrar dos veces.",
        existing: {
          id: row.id,
          consecutiveNumber: row.consecutive_number,
          createdAt: row.created_at,
          ...row.snapshot,
        },
      });
    }

    const consQ = await pool.query(
      `SELECT COALESCE(MAX(consecutive_number), 0) + 1 AS next
       FROM cash_closures
       WHERE closure_type = 'monthly' AND closure_year = $1`,
      [closureYear]
    );
    const consecutiveNumber = consQ.rows[0].next;

    const ins = await pool.query(
      `INSERT INTO cash_closures (
         closure_type, period, filter_registrar,
         generated_by_username, generated_by_role,
         closure_year, consecutive_number,
         total_cents, movements_count,
         affiliation_cents, monthly_cents, cash_cents, consignment_cents,
         snapshot
       ) VALUES (
         'monthly', $1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb
       )
       RETURNING id, created_at, consecutive_number`,
      [
        month,
        generatedBy,
        generatedRole,
        closureYear,
        consecutiveNumber,
        data.summary.totalCents,
        data.summary.count,
        data.summary.affiliationCents,
        data.summary.monthlyCents,
        data.summary.cashCents,
        data.summary.consignmentCents,
        JSON.stringify(data),
      ]
    );

    await logAdminAudit(req, "closures.monthly.create", {
      closureId: ins.rows[0].id,
      period: month,
      consecutiveNumber: ins.rows[0].consecutive_number,
      totalPesos: data.summary.totalPesos,
      count: data.summary.count,
    });

    return res.json({
      id: ins.rows[0].id,
      consecutiveNumber: ins.rows[0].consecutive_number,
      createdAt: ins.rows[0].created_at,
      generatedBy,
      ...data,
    });
  } catch (e) {
    if (e.code === "42P01") {
      return res.status(503).json({
        error: "Ejecuta en Neon: db/migrate_cash_closures.sql para habilitar los cierres guardados.",
      });
    }
    if (e.code === "23505") {
      return res.status(409).json({ error: "Este mes ya tiene un cierre generado." });
    }
    console.error(e);
    return res.status(500).json({ error: "No se pudo guardar el cierre del mes" });
  }
});

/**
 * GET /closures — Listado de cierres guardados.
 * - Secretaria: solo ve sus propios cierres diarios (filter_registrar = su usuario).
 * - Owner: ve todos.
 * Filtros: ?type=daily|monthly, ?from=YYYY-MM-DD, ?to=YYYY-MM-DD, ?registrar=USER, ?limit=N
 */
router.get("/closures", async (req, res) => {
  try {
    if (!(await cashClosuresTableExists())) {
      return res.json({ items: [] });
    }
    const isSecretary = req.adminCtx?.role === "secretary";
    const typeRaw = String(req.query.type || "").trim().toLowerCase();
    const type = ["daily", "monthly"].includes(typeRaw) ? typeRaw : null;
    const fromRaw = String(req.query.from || "").trim();
    const toRaw = String(req.query.to || "").trim();
    const registrarRaw = String(req.query.registrar || "").trim();
    const limRaw = parseInt(String(req.query.limit || "60"), 10);
    const limit = Number.isFinite(limRaw) ? Math.min(200, Math.max(1, limRaw)) : 60;

    const conds = [];
    const params = [];
    let pi = 1;
    if (type) {
      conds.push(`closure_type = $${pi}`);
      params.push(type);
      pi++;
    }
    if (fromRaw) {
      conds.push(`period >= $${pi}`);
      params.push(fromRaw);
      pi++;
    }
    if (toRaw) {
      conds.push(`period <= $${pi}`);
      params.push(toRaw);
      pi++;
    }
    if (isSecretary) {
      // La secretaria solo ve sus cierres diarios.
      conds.push(`closure_type = 'daily'`);
      conds.push(`LOWER(COALESCE(filter_registrar,'')) = LOWER($${pi})`);
      params.push(String(req.adminCtx?.username || "").trim());
      pi++;
    } else if (registrarRaw) {
      conds.push(`LOWER(COALESCE(filter_registrar,'')) = LOWER($${pi})`);
      params.push(normalizeAdminBody(registrarRaw));
      pi++;
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    params.push(limit);
    const r = await pool.query(
      `SELECT id, closure_type, period, filter_registrar, generated_by_username, generated_by_role,
              closure_year, consecutive_number, total_cents, movements_count,
              affiliation_cents, monthly_cents, cash_cents, consignment_cents, created_at
       FROM cash_closures
       ${where}
       ORDER BY created_at DESC
       LIMIT $${pi}::int`,
      params
    );
    const items = r.rows.map((row) => ({
      id: row.id,
      closureType: row.closure_type,
      period: row.period,
      filterRegistrar: row.filter_registrar,
      generatedByUsername: row.generated_by_username,
      generatedByRole: row.generated_by_role,
      closureYear: row.closure_year,
      consecutiveNumber: row.consecutive_number,
      totalPesos: Math.round(Number(row.total_cents) / 100),
      movementsCount: row.movements_count,
      affiliationPesos: Math.round(Number(row.affiliation_cents) / 100),
      monthlyPesos: Math.round(Number(row.monthly_cents) / 100),
      cashPesos: Math.round(Number(row.cash_cents) / 100),
      consignmentPesos: Math.round(Number(row.consignment_cents) / 100),
      createdAt: row.created_at,
    }));
    return res.json({ items });
  } catch (e) {
    if (e.code === "42P01") return res.json({ items: [] });
    console.error(e);
    return res.status(500).json({ error: "Error al listar cierres" });
  }
});

/**
 * GET /closures/:id — Detalle completo (snapshot) de un cierre guardado.
 * Se usa para volver a mostrar el cierre en pantalla y para imprimir/PDF.
 * - Secretaria: solo puede ver sus propios cierres.
 * - Owner: puede ver cualquiera.
 */
router.get("/closures/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    return res.status(400).json({ error: "ID de cierre inválido" });
  }
  try {
    if (!(await cashClosuresTableExists())) {
      return res.status(404).json({ error: "Cierre no encontrado" });
    }
    const r = await pool.query(
      `SELECT id, closure_type, period, filter_registrar, generated_by_username, generated_by_role,
              closure_year, consecutive_number, snapshot, created_at
       FROM cash_closures WHERE id = $1::uuid LIMIT 1`,
      [id]
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ error: "Cierre no encontrado" });
    }
    const row = r.rows[0];
    const isSecretary = req.adminCtx?.role === "secretary";
    if (isSecretary) {
      const myUser = String(req.adminCtx?.username || "").trim().toLowerCase();
      const filtUser = String(row.filter_registrar || "").trim().toLowerCase();
      if (row.closure_type !== "daily" || filtUser !== myUser) {
        return res.status(403).json({ error: "Solo puedes consultar tus propios cierres." });
      }
    }
    return res.json({
      id: row.id,
      closureType: row.closure_type,
      period: row.period,
      filterRegistrar: row.filter_registrar,
      generatedByUsername: row.generated_by_username,
      generatedByRole: row.generated_by_role,
      closureYear: row.closure_year,
      consecutiveNumber: row.consecutive_number,
      createdAt: row.created_at,
      snapshot: row.snapshot,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error al cargar cierre" });
  }
});

export default router;
