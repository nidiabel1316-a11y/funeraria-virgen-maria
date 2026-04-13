import "dotenv/config";
import express from "express";

if (!process.env.DATABASE_URL) {
  console.warn("ADVERTENCIA: falta DATABASE_URL en .env");
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.warn("ADVERTENCIA: JWT_SECRET debe tener al menos 32 caracteres");
}
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import extrasRoutes from "./routes/extras.js";

const app = express();
const PORT = Number(process.env.PORT) || 3001;

/** Orígenes permitidos (coma). Se recorta espacios y barra final para evitar fallos CORS por typo */
const corsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

if (corsOrigins.length) {
  console.log("CORS permitidos:", corsOrigins.join(", "));
}

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(
  cors({
    origin: corsOrigins.length
      ? corsOrigins
      : true,
    credentials: true,
    optionsSuccessStatus: 204,
  })
);
/** Fotos en base64 (data URL) pueden superar 1 MB; margen para JSON */
app.use(express.json({ limit: "8mb" }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", limiter);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "funeraria-api", ts: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", extrasRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: "No encontrado" });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Error interno" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API escuchando en http://0.0.0.0:${PORT}`);
});
