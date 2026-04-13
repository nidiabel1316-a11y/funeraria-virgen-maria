/**
 * Rutas públicas: Academia (preinscripción), Bolsa de empleo (empresas / candidatos).
 */
import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { pool } from "../db.js";

const router = Router();
const BCRYPT_ROUNDS = 11;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const JOB_JWT = "30d";

const academyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  message: { error: "Demasiadas solicitudes. Intenta más tarde." },
});

function signJobEmployer(id) {
  return jwt.sign({ typ: "job_emp", sub: id }, JWT_SECRET, { expiresIn: JOB_JWT });
}
function signJobSeeker(id) {
  return jwt.sign({ typ: "job_seek", sub: id }, JWT_SECRET, { expiresIn: JOB_JWT });
}

function requireJobEmployer(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Sesión requerida" });
  try {
    const d = jwt.verify(token, JWT_SECRET);
    if (d.typ !== "job_emp") return res.status(403).json({ error: "Acceso denegado" });
    req.jobEmployerId = d.sub;
    next();
  } catch {
    return res.status(401).json({ error: "Sesión inválida" });
  }
}

function requireJobSeeker(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Sesión requerida" });
  try {
    const d = jwt.verify(token, JWT_SECRET);
    if (d.typ !== "job_seek") return res.status(403).json({ error: "Acceso denegado" });
    req.jobSeekerId = d.sub;
    next();
  } catch {
    return res.status(401).json({ error: "Sesión inválida" });
  }
}

/** Preinscripción pública a cursos (opcional: usuario logueado envía token en body no — use optional header) */
router.post("/public/academy/register", academyLimiter, async (req, res) => {
  const body = req.body || {};
  const fullName = String(body.fullName || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim().slice(0, 40);
  const courseInterest = String(body.courseInterest || "").trim().slice(0, 500);
  const notes = String(body.notes || "").trim().slice(0, 2000);
  let affiliateUserId = null;
  const affTok = body.affiliateToken;
  if (affTok && typeof affTok === "string") {
    try {
      const p = jwt.verify(affTok, JWT_SECRET);
      if (p?.sub) affiliateUserId = p.sub;
    } catch {
      /* ignorar token inválido */
    }
  }
  if (fullName.length < 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Nombre y correo válidos requeridos" });
  }
  try {
    const ins = await pool.query(
      `INSERT INTO academy_registrations (affiliate_user_id, full_name, email, phone, course_interest, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [affiliateUserId, fullName, email, phone || null, courseInterest || null, notes || null]
    );
    return res.json({ ok: true, id: ins.rows[0].id, createdAt: ins.rows[0].created_at });
  } catch (e) {
    console.error(e);
    if (e.code === "42P01") {
      return res.status(503).json({ error: "Ejecuta migrate_academy_jobs.sql en la base de datos" });
    }
    return res.status(500).json({ error: "No se pudo registrar la solicitud" });
  }
});

/** Ofertas visibles (público) */
router.get("/jobs/listings", async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT j.id, j.title, j.description, j.city, j.modality, j.salary_hint, j.created_at,
              e.company_name
       FROM job_listings j
       JOIN job_employers e ON e.id = j.employer_id
       WHERE j.is_active = true
       ORDER BY j.created_at DESC
       LIMIT 200`
    );
    return res.json({ listings: r.rows });
  } catch (e) {
    console.error(e);
    if (e.code === "42P01") return res.json({ listings: [] });
    return res.status(500).json({ error: "Error al cargar ofertas" });
  }
});

router.post("/jobs/employer/register", async (req, res) => {
  const companyName = String(req.body?.companyName || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const phone = String(req.body?.phone || "").trim().slice(0, 40);
  if (companyName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
    return res.status(400).json({ error: "Datos inválidos (contraseña mín. 8 caracteres)" });
  }
  try {
    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const ins = await pool.query(
      `INSERT INTO job_employers (company_name, email, password_hash, phone) VALUES ($1, $2, $3, $4) RETURNING id`,
      [companyName, email, password_hash, phone || null]
    );
    const token = signJobEmployer(ins.rows[0].id);
    return res.json({ ok: true, token });
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ error: "Ese correo ya está registrado" });
    if (e.code === "42P01") return res.status(503).json({ error: "Ejecuta migrate_academy_jobs.sql" });
    console.error(e);
    return res.status(500).json({ error: "No se pudo registrar" });
  }
});

router.post("/jobs/employer/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  try {
    const r = await pool.query("SELECT id, password_hash FROM job_employers WHERE email = $1", [email]);
    const row = r.rows[0];
    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
      return res.status(401).json({ error: "Correo o contraseña incorrectos" });
    }
    return res.json({ ok: true, token: signJobEmployer(row.id) });
  } catch (e) {
    if (e.code === "42P01") return res.status(503).json({ error: "Ejecuta migrate_academy_jobs.sql" });
    return res.status(500).json({ error: "Error de acceso" });
  }
});

router.post("/jobs/seeker/register", async (req, res) => {
  const fullName = String(req.body?.fullName || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const phone = String(req.body?.phone || "").trim().slice(0, 40);
  const skills = String(req.body?.skills || "").trim().slice(0, 1000);
  if (fullName.length < 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
    return res.status(400).json({ error: "Datos inválidos" });
  }
  try {
    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const ins = await pool.query(
      `INSERT INTO job_seekers (full_name, email, password_hash, phone, skills) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [fullName, email, password_hash, phone || null, skills || null]
    );
    return res.json({ ok: true, token: signJobSeeker(ins.rows[0].id) });
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ error: "Ese correo ya está registrado" });
    if (e.code === "42P01") return res.status(503).json({ error: "Ejecuta migrate_academy_jobs.sql" });
    console.error(e);
    return res.status(500).json({ error: "No se pudo registrar" });
  }
});

router.post("/jobs/seeker/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  try {
    const r = await pool.query("SELECT id, password_hash FROM job_seekers WHERE email = $1", [email]);
    const row = r.rows[0];
    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
      return res.status(401).json({ error: "Correo o contraseña incorrectos" });
    }
    return res.json({ ok: true, token: signJobSeeker(row.id) });
  } catch (e) {
    if (e.code === "42P01") return res.status(503).json({ error: "Ejecuta migrate_academy_jobs.sql" });
    return res.status(500).json({ error: "Error de acceso" });
  }
});

router.post("/jobs/employer/listings", requireJobEmployer, async (req, res) => {
  const title = String(req.body?.title || "").trim();
  const description = String(req.body?.description || "").trim().slice(0, 8000);
  const city = String(req.body?.city || "").trim().slice(0, 120);
  const modality = String(req.body?.modality || "").trim().slice(0, 80);
  const salaryHint = String(req.body?.salaryHint || "").trim().slice(0, 120);
  if (title.length < 3) return res.status(400).json({ error: "Título requerido" });
  try {
    const ins = await pool.query(
      `INSERT INTO job_listings (employer_id, title, description, city, modality, salary_hint)
       VALUES ($1::uuid, $2, $3, $4, $5, $6) RETURNING id, created_at`,
      [req.jobEmployerId, title, description || null, city || null, modality || null, salaryHint || null]
    );
    return res.json({ ok: true, listing: ins.rows[0] });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "No se pudo publicar" });
  }
});

router.get("/jobs/employer/listings", requireJobEmployer, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, title, description, city, modality, salary_hint, is_active, created_at
       FROM job_listings WHERE employer_id = $1::uuid ORDER BY created_at DESC`,
      [req.jobEmployerId]
    );
    return res.json({ listings: r.rows });
  } catch (e) {
    return res.status(500).json({ error: "Error" });
  }
});

router.patch("/jobs/employer/listings/:id", requireJobEmployer, async (req, res) => {
  const id = req.params.id;
  if (typeof req.body?.isActive !== "boolean") {
    return res.status(400).json({ error: "isActive (true/false) requerido" });
  }
  try {
    const u = await pool.query(
      `UPDATE job_listings SET is_active = $3
       WHERE id = $1::uuid AND employer_id = $2::uuid
       RETURNING id`,
      [id, req.jobEmployerId, req.body.isActive]
    );
    if (!u.rows.length) return res.status(404).json({ error: "Oferta no encontrada" });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "Error" });
  }
});

export default router;
