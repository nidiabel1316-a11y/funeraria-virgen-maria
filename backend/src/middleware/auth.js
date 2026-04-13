import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  const h = req.headers.authorization;
  const token = h?.startsWith("Bearer ") ? h.slice(7) : null;
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
