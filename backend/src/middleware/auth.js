import jwt from "jsonwebtoken";

function bearerToken(req) {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7).trim();
  return null;
}

/** Afiliado autenticado (JWT con `sub` = id de usuario). */
export function requireAuth(req, res, next) {
  const token = bearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "No autorizado" });
  }
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ error: "Servidor sin JWT_SECRET" });
    }
    req.user = jwt.verify(token, secret);
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
}

function userRoleNorm(u) {
  const r = u?.role != null ? String(u.role).toLowerCase() : "";
  return r;
}

/**
 * Solo cuentas marcadas como administrador en el propio JWT de afiliado.
 * (Hoy el JWT estándar solo incluye `sub`; reservado por si en el futuro se añade `role`.)
 */
export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "No autorizado" });
  }
  const ok =
    req.user.isAdmin === true ||
    userRoleNorm(req.user) === "admin" ||
    userRoleNorm(req.user) === "owner";
  if (ok) {
    return next();
  }
  return res.status(403).json({ error: "Acceso denegado: área exclusiva del administrador principal" });
}

/**
 * Administrador principal o personal de secretaría (mismo JWT de afiliado con `role`).
 */
export function requireStaff(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "No autorizado" });
  }
  const r = userRoleNorm(req.user);
  const ok =
    req.user.isAdmin === true ||
    r === "admin" ||
    r === "owner" ||
    r === "secretary" ||
    r === "secretaria";
  if (ok) {
    return next();
  }
  return res.status(403).json({ error: "Acceso denegado: solo personal autorizado" });
}
