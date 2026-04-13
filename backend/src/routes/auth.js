import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { countDirectReferrals, countNetworkDownline } from "../networkCounts.js";
import { computeAvailableBalanceCents } from "../ledgerBalance.js";
import {
  paymentFlagsFromCoverageRow as paymentFlagsFromRow,
  initialAffiliationCoverageEndYmd,
  storedCoverageToEndYmd,
  addMonthsToYmd,
} from "../monthlyCoverage.js";

const router = Router();
const BCRYPT_ROUNDS = 11;
const JWT_EXPIRES = "30d";

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." },
});

/** PostgreSQL: columna inexistente (migración pendiente) */
const PG_UNDEFINED_COLUMN = "42703";

/**
 * Si `profile_photo_url` aún no existe en DB, las consultas con esa columna fallan.
 * Reintentamos sin la columna para que login / dashboard / red sigan funcionando.
 */
let profilePhotoColumnReady = true;

async function queryWithProfilePhotoFallback(queryWithPhoto, queryWithoutPhoto, params) {
  /** Si antes falló la columna, reintentamos por si ya aplicaste migrate_profile_photo.sql sin reiniciar. */
  if (!profilePhotoColumnReady) {
    try {
      const r = await pool.query(queryWithPhoto, params);
      profilePhotoColumnReady = true;
      console.info("[auth] Columna profile_photo_url disponible (migración detectada).");
      return r;
    } catch (e) {
      if (e?.code === PG_UNDEFINED_COLUMN) {
        return pool.query(queryWithoutPhoto, params);
      }
      throw e;
    }
  }
  try {
    return await pool.query(queryWithPhoto, params);
  } catch (e) {
    if (e?.code === PG_UNDEFINED_COLUMN) {
      profilePhotoColumnReady = false;
      console.warn(
        "[auth] Falta columna profile_photo_url. Ejecuta backend/db/migrate_profile_photo.sql — la app sigue sin fotos."
      );
      return pool.query(queryWithoutPhoto, params);
    }
    throw e;
  }
}

const SQL_ME_WITH_PHOTO = `SELECT id, doc_number, doc_type, email, full_name, plan_id, referral_code,
            birth_date, address, city, department, phone, whatsapp,
            beneficiaries, pets,
            balance_cents, network_size, direct_count, commission_cents,
            affiliation_paid_at, monthly_paid_through, signup_commissions_applied, contract_issue_date,
            created_at, profile_photo_url
     FROM users WHERE id = $1::uuid`;

const SQL_ME_WITH_PHOTO_BANK = `SELECT id, doc_number, doc_type, email, full_name, plan_id, referral_code,
            birth_date, address, city, department, phone, whatsapp,
            beneficiaries, pets,
            balance_cents, network_size, direct_count, commission_cents,
            affiliation_paid_at, monthly_paid_through, signup_commissions_applied, contract_issue_date,
            created_at, profile_photo_url, bank_details
     FROM users WHERE id = $1::uuid`;

const SQL_ME_NO_PHOTO = `SELECT id, doc_number, doc_type, email, full_name, plan_id, referral_code,
            birth_date, address, city, department, phone, whatsapp,
            beneficiaries, pets,
            balance_cents, network_size, direct_count, commission_cents,
            affiliation_paid_at, monthly_paid_through, signup_commissions_applied, contract_issue_date,
            created_at
     FROM users WHERE id = $1::uuid`;

const SQL_ME_NO_PHOTO_BANK = `SELECT id, doc_number, doc_type, email, full_name, plan_id, referral_code,
            birth_date, address, city, department, phone, whatsapp,
            beneficiaries, pets,
            balance_cents, network_size, direct_count, commission_cents,
            affiliation_paid_at, monthly_paid_through, signup_commissions_applied, contract_issue_date,
            created_at, bank_details
     FROM users WHERE id = $1::uuid`;

/** Reintenta sin columnas opcionales (profile_photo_url, bank_details) si falta migración. */
async function queryMeUser(userId) {
  const attempts = [SQL_ME_WITH_PHOTO_BANK, SQL_ME_WITH_PHOTO, SQL_ME_NO_PHOTO_BANK, SQL_ME_NO_PHOTO];
  let lastErr;
  for (const sql of attempts) {
    try {
      return await pool.query(sql, [userId]);
    } catch (e) {
      if (e?.code === PG_UNDEFINED_COLUMN) {
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error("queryMeUser");
}

/** Afiliados visibles en vista MLM / referidos (solo 3 niveles bajo ti). */
async function getMlmThreeLevelCount(client, userId) {
  const fetchIds = async (sponsorIds) => {
    if (!sponsorIds?.length) return [];
    const q = await client.query(`SELECT id FROM users WHERE sponsor_id = ANY($1::uuid[])`, [sponsorIds]);
    return q.rows.map((row) => row.id);
  };
  const l1 = await fetchIds([userId]);
  const l2 = await fetchIds(l1);
  const l3 = await fetchIds(l2);
  return l1.length + l2.length + l3.length;
}

const SQL_NET_ROOT_WITH = `SELECT full_name, referral_code, plan_id, profile_photo_url, affiliation_paid_at, monthly_paid_through FROM users WHERE id = $1`;
const SQL_NET_ROOT_NO = `SELECT full_name, referral_code, plan_id, affiliation_paid_at, monthly_paid_through FROM users WHERE id = $1`;

const SQL_NET_LEVEL_WITH = `SELECT id, sponsor_id, doc_number, full_name, email, plan_id, referral_code, created_at, profile_photo_url, affiliation_paid_at, monthly_paid_through
         FROM users WHERE sponsor_id = ANY($1::uuid[]) ORDER BY created_at`;
const SQL_NET_LEVEL_NO = `SELECT id, sponsor_id, doc_number, full_name, email, plan_id, referral_code, created_at, affiliation_paid_at, monthly_paid_through
         FROM users WHERE sponsor_id = ANY($1::uuid[]) ORDER BY created_at`;

/** Cuota mensual referencial del plan (COP) — base para comisión de afiliación */
const PLAN_BASE_PESOS = { elite: 100000, premium: 250000, platinum: 500000 };
/** Límites por plan (beneficiarios / mascotas) — alineados con frontend PLANS */
const PLAN_LIMITS = {
  elite: { mb: 4, mp: 1 },
  premium: { mb: 8, mp: 1 },
  platinum: { mb: 10, mp: 4 },
};
/** 10% del plan del nuevo afiliado para cada nivel (N1, N2, N3) */
const COMMISSION_PCTS = [0.1, 0.1, 0.1];

/** Cupos de expansión por nivel (presentación MLM) */
const NETWORK_WIDTH = { n1: 8, n2: 64, n3: 512 };

function normalizeDoc(doc) {
  return String(doc || "").replace(/\D/g, "");
}

function parseReferralInput(raw) {
  if (!raw || !String(raw).trim()) return null;
  const s = String(raw).trim();
  const fromUrl = s.match(/ref\/([A-Za-z0-9\-]+)/i);
  if (fromUrl) {
    const c = fromUrl[1].toUpperCase();
    return c.startsWith("FVM-") ? c : `FVM-${c}`;
  }
  const code = s.toUpperCase();
  if (code.startsWith("FVM-")) return code.replace(/\s/g, "");
  return `FVM-${code.replace(/^FVM-?/i, "").replace(/\s/g, "")}`;
}

function newReferralCode() {
  const hex = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `FVM-${hex.slice(0, 6)}`;
}

async function findSponsorId(client, referralCode) {
  const code = parseReferralInput(referralCode);
  if (!code || !code.startsWith("FVM-")) return null;
  const r = await client.query(
    "SELECT id FROM users WHERE UPPER(referral_code) = $1",
    [code]
  );
  return r.rows[0]?.id ?? null;
}

function planBaseCents(planId) {
  const pesos = PLAN_BASE_PESOS[planId] ?? 100000;
  return Math.floor(pesos * 100);
}

function sanitizeBankDetailsIn(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  const keys = ["bankName", "accountType", "accountNumber", "holderName", "idDoc", "notes"];
  for (const k of keys) {
    const v = raw[k];
    if (v == null) continue;
    const s = String(v).trim().slice(0, 200);
    if (s) out[k] = s;
  }
  return out;
}

function normalizeBankDetailsOut(raw) {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const pick = (k) => {
    const v = o[k];
    if (v == null) return "";
    return String(v).slice(0, 200);
  };
  return {
    bankName: pick("bankName"),
    accountType: pick("accountType"),
    accountNumber: pick("accountNumber"),
    holderName: pick("holderName"),
    idDoc: pick("idDoc"),
    notes: pick("notes"),
  };
}

function currentPeriodMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Patrocinador directo +1 directo y +1 red; cada antepasado +1 red */
async function incrementNetworkForNewMember(client, sponsorId) {
  if (!sponsorId) return;
  await client.query(
    `UPDATE users SET direct_count = direct_count + 1, network_size = network_size + 1, updated_at = NOW()
     WHERE id = $1`,
    [sponsorId]
  );
  let parentId = sponsorId;
  for (;;) {
    const r = await client.query(`SELECT sponsor_id FROM users WHERE id = $1`, [parentId]);
    const sid = r.rows[0]?.sponsor_id;
    if (!sid) break;
    await client.query(
      `UPDATE users SET network_size = network_size + 1, updated_at = NOW() WHERE id = $1`,
      [sid]
    );
    parentId = sid;
  }
}

async function getCommissionUplines(client, directSponsorId) {
  const recipients = [];
  let current = directSponsorId;
  for (let i = 0; i < 3 && current; i++) {
    recipients.push(current);
    const r = await client.query(`SELECT sponsor_id FROM users WHERE id = $1`, [current]);
    current = r.rows[0]?.sponsor_id ?? null;
  }
  return recipients;
}

async function distributeSignupCommissions(client, newUserId, planId, directSponsorId, periodMonth) {
  if (!directSponsorId) return;
  const baseCents = planBaseCents(planId);
  const uplines = await getCommissionUplines(client, directSponsorId);
  for (let i = 0; i < uplines.length; i++) {
    const recipientId = uplines[i];
    const pr = await client.query(
      `SELECT affiliation_paid_at, monthly_paid_through FROM users WHERE id = $1`,
      [recipientId]
    );
    const flags = paymentFlagsFromRow(pr.rows[0]);
    if (!flags.receivesCommission) continue;
    const pct = COMMISSION_PCTS[i];
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

/** Acredita comisiones por el alta del usuario (una sola vez). */
async function applySignupCommissionsOnce(client, newUserId) {
  const r = await client.query(
    `SELECT plan_id, sponsor_id, signup_commissions_applied FROM users WHERE id = $1 FOR UPDATE`,
    [newUserId]
  );
  const row = r.rows[0];
  if (!row || row.signup_commissions_applied || !row.sponsor_id) return { applied: false };
  const periodMonth = currentPeriodMonth();
  await distributeSignupCommissions(client, newUserId, row.plan_id, row.sponsor_id, periodMonth);
  await client.query(`UPDATE users SET signup_commissions_applied = true, updated_at = NOW() WHERE id = $1`, [
    newUserId,
  ]);
  return { applied: true };
}

function signToken(userId) {
  return jwt.sign({ sub: String(userId) }, process.env.JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

router.post("/register", async (req, res) => {
  const body = req.body || {};
  const doc = normalizeDoc(body.doc);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const fullName = String(body.fullName || "").trim();
  const planId = String(body.planId || "").trim();

  if (!doc || doc.length < 6) {
    return res.status(400).json({ error: "Documento inválido" });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Correo inválido" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "La contraseña debe tener mínimo 8 caracteres" });
  }
  if (fullName.length < 3) {
    return res.status(400).json({ error: "Nombre inválido" });
  }
  if (!["elite", "premium", "platinum"].includes(planId)) {
    return res.status(400).json({ error: "Plan inválido" });
  }

  const beneficiaries = Array.isArray(body.beneficiaries) ? body.beneficiaries : [];
  const pets = Array.isArray(body.pets) ? body.pets : [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const dupDoc = await client.query("SELECT id FROM users WHERE doc_number = $1", [doc]);
    if (dupDoc.rows.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error:
          "Ya existe un afiliado registrado con esta cédula o documento. No se permiten duplicados.",
      });
    }
    const dupEmail = await client.query("SELECT id FROM users WHERE LOWER(email) = $1", [email]);
    if (dupEmail.rows.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Ya existe una cuenta con este correo electrónico. Usa otro correo o inicia sesión.",
      });
    }

    let sponsorId = null;
    if (body.referralCode) {
      sponsorId = await findSponsorId(client, body.referralCode);
    }

    let referralCode = newReferralCode();
    for (let i = 0; i < 5; i++) {
      const chk = await client.query(
        "SELECT 1 FROM users WHERE referral_code = $1",
        [referralCode]
      );
      if (!chk.rows.length) break;
      referralCode = newReferralCode();
    }

    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const birthDate = body.birthDate ? new Date(body.birthDate) : null;
    const bd = Number.isNaN(birthDate?.getTime()) ? null : birthDate;

    const ins = await client.query(
      `INSERT INTO users (
        doc_number, doc_type, email, password_hash, full_name, birth_date,
        address, city, department, phone, whatsapp, plan_id, referral_code,
        sponsor_id, beneficiaries, pets
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb)
      RETURNING id`,
      [
        doc,
        String(body.docType || "CC").slice(0, 8),
        email,
        password_hash,
        fullName,
        bd,
        body.address || null,
        body.city || null,
        body.department || null,
        body.phone ? String(body.phone).replace(/\D/g, "") : null,
        body.whatsapp ? String(body.whatsapp).replace(/\D/g, "") : null,
        planId,
        referralCode,
        sponsorId,
        JSON.stringify(beneficiaries),
        JSON.stringify(pets),
      ]
    );

    const userId = ins.rows[0].id;

    await incrementNetworkForNewMember(client, sponsorId);
    /* Comisiones N1–N3 se acreditan cuando el afiliado confirma pago de inscripción (POST /payment/affiliation) */

    await client.query("COMMIT");

    const token = signToken(userId);
    return res.status(201).json({ token, userId });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    if (e.code === "23505") {
      return res.status(409).json({
        error:
          "Esa cédula o correo ya está registrado. Cada documento solo puede usarse una vez.",
      });
    }
    if (e.code === "42P01") {
      return res.status(500).json({
        error:
          "Falta ejecutar la migración SQL commission_lines en la base de datos. Ver backend/db/migrate_commission_lines.sql",
      });
    }
    return res.status(500).json({ error: "Error al registrar. Intenta de nuevo." });
  } finally {
    client.release();
  }
});

router.post("/login", async (req, res) => {
  const identifier = String(req.body?.identifier || "").trim();
  const password = String(req.body?.password || "");
  if (!identifier || !password) {
    return res.status(400).json({ error: "Correo/cédula y contraseña son obligatorios" });
  }

  const clean = normalizeDoc(identifier);
  const isEmail = identifier.includes("@");

  let q;
  if (isEmail) {
    q = await pool.query(
      "SELECT id, password_hash FROM users WHERE LOWER(email) = $1",
      [identifier.toLowerCase()]
    );
  } else {
    q = await pool.query(
      "SELECT id, password_hash FROM users WHERE doc_number = $1",
      [clean || identifier.replace(/\D/g, "")]
    );
  }

  const row = q.rows[0];
  if (!row) {
    return res.status(401).json({ error: "Correo/cédula o contraseña incorrectos" });
  }

  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) {
    return res.status(401).json({ error: "Correo/cédula o contraseña incorrectos" });
  }

  const token = signToken(String(row.id));
  return res.json({ token });
});

router.get("/me", requireAuth, async (req, res) => {
  const userId = String(req.user.sub || "");
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(userId)) {
    return res.status(401).json({ error: "Token inválido" });
  }
  const r = await queryMeUser(userId);
  const u = r.rows[0];
  if (!u) {
    return res.status(404).json({ error: "Usuario no encontrado" });
  }
  const dbId = String(u.id);
  if (dbId !== userId) {
    console.error("[me] JWT id !== fila DB", userId, dbId);
    return res.status(403).json({ error: "Sesión inconsistente" });
  }

  let beneficiaries = [];
  let pets = [];
  try {
    beneficiaries = Array.isArray(u.beneficiaries) ? u.beneficiaries : JSON.parse(u.beneficiaries || "[]");
  } catch {
    beneficiaries = [];
  }
  try {
    pets = Array.isArray(u.pets) ? u.pets : JSON.parse(u.pets || "[]");
  } catch {
    pets = [];
  }

  const contractIssue =
    u.contract_issue_date instanceof Date
      ? u.contract_issue_date.toISOString().slice(0, 10)
      : u.contract_issue_date
        ? String(u.contract_issue_date).slice(0, 10)
        : u.created_at
          ? new Date(u.created_at).toISOString().slice(0, 10)
          : null;

  const [directCount, networkSize, mlmThreeLevelCount] = await Promise.all([
    countDirectReferrals(pool, dbId),
    countNetworkDownline(pool, dbId),
    getMlmThreeLevelCount(pool, dbId),
  ]);

  /** Comisión = líneas no anuladas (mora/cierre). Saldo = eso − desembolsos pagados. */
  let commissionPesos = Math.round(Number(u.commission_cents ?? 0) / 100);
  let balancePesos = Math.round(Number(u.balance_cents ?? 0) / 100);
  try {
    let cs;
    try {
      cs = await pool.query(
        `SELECT COALESCE(SUM(amount_cents),0)::bigint AS t FROM commission_lines
         WHERE recipient_id = $1::uuid AND (forfeited_at IS NULL)`,
        [dbId]
      );
    } catch (e2) {
      if (e2.code !== "42703") throw e2;
      cs = await pool.query(
        `SELECT COALESCE(SUM(amount_cents),0)::bigint AS t FROM commission_lines WHERE recipient_id = $1::uuid`,
        [dbId]
      );
    }
    const fromLines = Math.round(Number(cs.rows[0].t) / 100);
    commissionPesos = fromLines;
    const avail = await computeAvailableBalanceCents(pool, dbId);
    balancePesos = Math.round(Number(avail) / 100);
  } catch (e) {
    if (e.code !== "42P01") throw e;
  }

  return res.json({
    id: dbId,
    docNumber: u.doc_number,
    docType: u.doc_type || "CC",
    email: u.email,
    fullName: u.full_name,
    planId: u.plan_id,
    refCode: u.referral_code,
    birthDate: u.birth_date
      ? u.birth_date instanceof Date
        ? u.birth_date.toISOString().slice(0, 10)
        : String(u.birth_date).slice(0, 10)
      : null,
    address: u.address || "",
    city: u.city || "",
    department: u.department || "",
    phone: u.phone || "",
    whatsapp: u.whatsapp || "",
    beneficiaries,
    pets,
    balance: balancePesos,
    networkSize,
    directCount,
    commission: commissionPesos,
    affiliationPaid: Boolean(u.affiliation_paid_at),
    affiliationPaidAt: u.affiliation_paid_at
      ? (u.affiliation_paid_at instanceof Date ? u.affiliation_paid_at.toISOString() : String(u.affiliation_paid_at))
      : null,
    monthlyPaidThrough: u.monthly_paid_through || null,
    signupCommissionsApplied: Boolean(u.signup_commissions_applied),
    contractIssueDate: contractIssue,
    profilePhotoUrl: u.profile_photo_url ?? null,
    mlmThreeLevelCount,
    bankDetails: normalizeBankDetailsOut(u.bank_details),
  });
});

/** Avisos de Academia publicados por el administrador (visible en el panel del afiliado). */
router.get("/academy-broadcasts", requireAuth, async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, title, body, course_name, start_date, created_at
       FROM academy_broadcasts WHERE active = true ORDER BY created_at DESC LIMIT 50`
    );
    return res.json({ broadcasts: r.rows });
  } catch (e) {
    console.error(e);
    if (e.code === "42P01") {
      return res.json({ broadcasts: [] });
    }
    return res.status(500).json({ error: "No se pudieron cargar los avisos" });
  }
});

/** Actualiza foto de perfil y/o datos bancarios para consignación de comisiones. */
router.put("/profile", requireAuth, async (req, res) => {
  const userId = req.user.sub;
  const body = req.body || {};
  const hasPhoto = Object.prototype.hasOwnProperty.call(body, "profilePhotoUrl");
  const hasBank = Object.prototype.hasOwnProperty.call(body, "bankDetails");
  if (!hasPhoto && !hasBank) {
    return res.status(400).json({ error: "Envía profilePhotoUrl y/o bankDetails" });
  }

  let photoVal = null;
  if (hasPhoto) {
    const raw = body.profilePhotoUrl;
    photoVal = raw == null || raw === "" ? null : String(raw).trim();
    if (photoVal) {
      if (photoVal.length > 900000) {
        return res.status(400).json({ error: "Imagen demasiado grande. Reduce tamaño o calidad." });
      }
      const ok =
        photoVal.startsWith("data:image/") ||
        photoVal.startsWith("https://") ||
        photoVal.startsWith("http://");
      if (!ok) {
        return res.status(400).json({
          error: "La foto debe ser una imagen (data:image/...) o una URL http(s).",
        });
      }
    }
  }

  const bankObj = hasBank ? sanitizeBankDetailsIn(body.bankDetails) : null;

  const sets = [];
  const vals = [];
  let p = 1;
  if (hasPhoto) {
    sets.push(`profile_photo_url = $${p++}`);
    vals.push(photoVal);
  }
  if (hasBank) {
    sets.push(`bank_details = $${p++}::jsonb`);
    vals.push(JSON.stringify(bankObj));
  }
  vals.push(userId);

  try {
    await pool.query(
      `UPDATE users SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${p}::uuid`,
      vals
    );
  } catch (e) {
    if (e.code === PG_UNDEFINED_COLUMN) {
      if (hasBank && String(e.message || "").includes("bank_details")) {
        return res.status(503).json({
          error: "Falta la columna bank_details. Ejecuta en Neon: backend/db/migrate_bank_details.sql",
        });
      }
      if (hasPhoto) {
        profilePhotoColumnReady = false;
        return res.status(503).json({
          error:
            "Falta la columna en la base de datos. Ejecuta en Neon: backend/db/migrate_profile_photo.sql",
        });
      }
    }
    throw e;
  }
  return res.json({ ok: true });
});

/** Red solo hacia abajo (3 niveles). No se expone la línea ascendente. Incluye "root" = tú como patrocinador. */
router.get("/network", requireAuth, async (req, res) => {
  const userId = req.user.sub;
  try {
    const meRow = await queryWithProfilePhotoFallback(SQL_NET_ROOT_WITH, SQL_NET_ROOT_NO, [userId]);
    if (!meRow.rows.length) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    const r0 = meRow.rows[0];
    const rootPay = paymentFlagsFromRow(r0);
    const root = {
      id: userId,
      fullName: r0.full_name,
      refCode: r0.referral_code,
      planId: r0.plan_id,
      profilePhotoUrl: profilePhotoColumnReady ? r0.profile_photo_url || null : null,
      affiliationPaid: rootPay.affiliationPaid,
      monthlyPaidThrough: rootPay.monthlyPaidThrough,
      receivesCommission: rootPay.receivesCommission,
      mora: rootPay.mora,
      moraReason: rootPay.moraReason,
    };

    const fetchBySponsors = async (sponsorIds) => {
      if (!sponsorIds?.length) return [];
      const q = await queryWithProfilePhotoFallback(SQL_NET_LEVEL_WITH, SQL_NET_LEVEL_NO, [sponsorIds]);
      return q.rows.map((r) => {
        const pf = paymentFlagsFromRow(r);
        return {
          id: r.id,
          sponsorId: r.sponsor_id,
          fullName: r.full_name,
          email: r.email,
          planId: r.plan_id,
          refCode: r.referral_code,
          docNumber: r.doc_number,
          createdAt: r.created_at,
          profilePhotoUrl: profilePhotoColumnReady ? r.profile_photo_url || null : null,
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
      capacity: NETWORK_WIDTH,
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

/** Historial de comisiones por mes (N1/N2/N3) */
router.get("/commissions", requireAuth, async (req, res) => {
  const userId = req.user.sub;
  try {
    let r;
    try {
      r = await pool.query(
        `SELECT period_month,
        COALESCE(SUM(CASE WHEN level = 1 THEN amount_cents ELSE 0 END), 0)::bigint AS n1,
        COALESCE(SUM(CASE WHEN level = 2 THEN amount_cents ELSE 0 END), 0)::bigint AS n2,
        COALESCE(SUM(CASE WHEN level = 3 THEN amount_cents ELSE 0 END), 0)::bigint AS n3,
        COALESCE(SUM(amount_cents), 0)::bigint AS total
       FROM commission_lines
       WHERE recipient_id = $1::uuid AND (forfeited_at IS NULL)
       GROUP BY period_month
       ORDER BY period_month DESC
       LIMIT 48`,
        [userId]
      );
    } catch (e) {
      if (e.code !== "42703") throw e;
      r = await pool.query(
        `SELECT period_month,
        COALESCE(SUM(CASE WHEN level = 1 THEN amount_cents ELSE 0 END), 0)::bigint AS n1,
        COALESCE(SUM(CASE WHEN level = 2 THEN amount_cents ELSE 0 END), 0)::bigint AS n2,
        COALESCE(SUM(CASE WHEN level = 3 THEN amount_cents ELSE 0 END), 0)::bigint AS n3,
        COALESCE(SUM(amount_cents), 0)::bigint AS total
       FROM commission_lines
       WHERE recipient_id = $1::uuid
       GROUP BY period_month
       ORDER BY period_month DESC
       LIMIT 48`,
        [userId]
      );
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
    console.error(e);
    if (e.code === "42P01") {
      return res.json({ months: [] });
    }
    return res.status(500).json({ error: "Error al cargar comisiones" });
  }
});

/** Solicitud de cambio de contrato (beneficiarios/mascotas); solo el administrador puede aprobarla. */
router.post("/contract-change-request", requireAuth, async (req, res) => {
  const userId = req.user.sub;
  const body = req.body || {};
  const proposedBeneficiaries = Array.isArray(body.proposedBeneficiaries) ? body.proposedBeneficiaries : [];
  const proposedPets = Array.isArray(body.proposedPets) ? body.proposedPets : [];
  const note = body.note != null ? String(body.note).slice(0, 2000) : null;
  try {
    const ur = await pool.query("SELECT plan_id FROM users WHERE id = $1::uuid", [userId]);
    const planId = ur.rows[0]?.plan_id || "elite";
    const lim = PLAN_LIMITS[planId] || PLAN_LIMITS.elite;
    if (proposedBeneficiaries.length > lim.mb) {
      return res.status(400).json({ error: `Tu plan permite máximo ${lim.mb} beneficiarios.` });
    }
    if (proposedPets.length > lim.mp) {
      return res.status(400).json({ error: `Tu plan permite máximo ${lim.mp} mascota(s).` });
    }
    const ins = await pool.query(
      `INSERT INTO contract_change_requests (user_id, proposed_beneficiaries, proposed_pets, note)
       VALUES ($1::uuid, $2::jsonb, $3::jsonb, $4)
       RETURNING id, created_at`,
      [userId, JSON.stringify(proposedBeneficiaries), JSON.stringify(proposedPets), note]
    );
    return res.json({
      ok: true,
      id: ins.rows[0].id,
      createdAt: ins.rows[0].created_at,
    });
  } catch (e) {
    console.error(e);
    if (e.code === "42P01") {
      return res.status(503).json({
        error: "Ejecuta en la base de datos: backend/db/migrate_admin_reports_contracts.sql",
      });
    }
    return res.status(500).json({ error: "No se pudo registrar la solicitud" });
  }
});

/**
 * Confirma pago de inscripción/afiliación (simulado o verificado externamente).
 * Acredita comisiones N1–N3 a la red del patrocinador una sola vez.
 */
router.post("/payment/affiliation", requireAuth, async (req, res) => {
  const userId = req.user.sub;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `SELECT affiliation_paid_at, sponsor_id, plan_id, signup_commissions_applied
       FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    const u = r.rows[0];
    if (!u) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    if (u.affiliation_paid_at) {
      const repair = await applySignupCommissionsOnce(client, userId);
      await client.query("COMMIT");
      return res.json({
        ok: true,
        alreadyPaid: true,
        commissionsApplied: repair.applied,
      });
    }

    await client.query(
      `UPDATE users SET affiliation_paid_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [userId]
    );
    const ar = await client.query(
      `SELECT affiliation_paid_at, monthly_paid_through FROM users WHERE id = $1`,
      [userId]
    );
    const row0 = ar.rows[0];
    const mptRaw = row0?.monthly_paid_through;
    if (mptRaw == null || String(mptRaw).trim() === "") {
      const initEnd = initialAffiliationCoverageEndYmd(row0.affiliation_paid_at);
      await client.query(`UPDATE users SET monthly_paid_through = $2 WHERE id = $1`, [userId, initEnd]);
    }
    const out = await applySignupCommissionsOnce(client, userId);
    await client.query("COMMIT");
    return res.json({ ok: true, alreadyPaid: false, commissionsApplied: out.applied });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    if (e.code === "42703") {
      return res.status(500).json({
        error: "Ejecuta en la base de datos: backend/db/migrate_payment_affiliation.sql",
      });
    }
    return res.status(500).json({ error: "No se pudo registrar el pago" });
  } finally {
    client.release();
  }
});

/** Registra un periodo de cuota mensual cubierto (tras pago verificado). */
router.post("/payment/monthly", requireAuth, async (req, res) => {
  const userId = req.user.sub;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `SELECT affiliation_paid_at, monthly_paid_through FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    const u = r.rows[0];
    if (!u) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    if (!u.affiliation_paid_at) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Primero debe completar el pago de afiliación/inscripción." });
    }
    let endYmd = storedCoverageToEndYmd(u.monthly_paid_through, u.affiliation_paid_at);
    if (!endYmd) {
      endYmd = initialAffiliationCoverageEndYmd(u.affiliation_paid_at);
    }
    const paidThrough = addMonthsToYmd(endYmd, 1);
    await client.query(
      `UPDATE users SET monthly_paid_through = $1, updated_at = NOW() WHERE id = $2`,
      [paidThrough, userId]
    );
    await client.query("COMMIT");
    return res.json({ ok: true, monthlyPaidThrough: paidThrough });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    if (e.code === "42703") {
      return res.status(500).json({
        error: "Ejecuta en la base de datos: backend/db/migrate_payment_affiliation.sql",
      });
    }
    return res.status(500).json({ error: "No se pudo registrar la mensualidad" });
  } finally {
    client.release();
  }
});

router.put("/password", requireAuth, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = String(req.body?.newPassword || "");
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "La nueva contraseña debe tener mínimo 8 caracteres" });
  }

  const userId = req.user.sub;
  const r = await pool.query("SELECT password_hash FROM users WHERE id = $1", [userId]);
  const row = r.rows[0];
  if (!row) {
    return res.status(404).json({ error: "Usuario no encontrado" });
  }

  const ok = await bcrypt.compare(currentPassword, row.password_hash);
  if (!ok) {
    return res.status(400).json({ error: "Contraseña actual incorrecta" });
  }

  const password_hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await pool.query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2", [
    password_hash,
    userId,
  ]);

  return res.json({ ok: true });
});

/** Solicitud de enlace por correo (no revela si el email existe) */
router.post("/forgot-password", forgotPasswordLimiter, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Indica un correo electrónico válido" });
  }
  const generic = {
    ok: true,
    message: "Si el correo está registrado, recibirás un enlace para restablecer la contraseña.",
  };
  try {
    const u = await pool.query("SELECT id FROM users WHERE LOWER(email) = $1", [email]);
    if (!u.rows.length) {
      return res.json(generic);
    }
    const userId = u.rows[0].id;
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1::uuid", [userId]);
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1::uuid, $2, $3)`,
      [userId, token, expiresAt]
    );
    const base = (process.env.APP_PUBLIC_URL || "https://funerariavirgenmaria.com").replace(/\/$/, "");
    const resetUrl = `${base}/?reset=1&token=${encodeURIComponent(token)}`;
    const { sendPasswordResetEmail } = await import("../mail.js");
    await sendPasswordResetEmail(email, resetUrl);
    return res.json(generic);
  } catch (e) {
    console.error(e);
    if (e.code === "42P01") {
      return res.status(503).json({
        error: "Ejecuta en la base de datos: backend/db/migrate_password_reset.sql",
      });
    }
    return res.status(500).json({ error: "No se pudo enviar el correo. Intenta más tarde." });
  }
});

/** Restablecer contraseña con token del correo */
router.post("/reset-password", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  const newPassword = String(req.body?.newPassword || "");
  if (!token || newPassword.length < 8) {
    return res.status(400).json({ error: "Enlace inválido o contraseña demasiado corta (mín. 8 caracteres)" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `SELECT user_id, expires_at FROM password_reset_tokens WHERE token = $1 FOR UPDATE`,
      [token]
    );
    if (!r.rows.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Enlace inválido o ya utilizado" });
    }
    const { user_id: userId, expires_at: exp } = r.rows[0];
    if (new Date(exp) < new Date()) {
      await client.query("DELETE FROM password_reset_tokens WHERE token = $1", [token]);
      await client.query("COMMIT");
      return res.status(400).json({ error: "El enlace expiró. Solicita uno nuevo desde «Olvidé mi contraseña»." });
    }
    const password_hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await client.query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2::uuid", [
      password_hash,
      userId,
    ]);
    await client.query("DELETE FROM password_reset_tokens WHERE user_id = $1::uuid", [userId]);
    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      /* noop */
    }
    console.error(e);
    if (e.code === "42P01") {
      return res.status(503).json({ error: "Ejecuta migrate_password_reset.sql en la base de datos" });
    }
    return res.status(500).json({ error: "No se pudo cambiar la contraseña" });
  } finally {
    client.release();
  }
});

export default router;
