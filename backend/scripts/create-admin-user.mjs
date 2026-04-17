/**
 * Crea o actualiza un usuario del panel admin en la base (bcrypt).
 * Uso: node scripts/create-admin-user.mjs <usuario> <contraseña> <owner|secretary>
 * Requiere DATABASE_URL en .env (desde carpeta backend).
 */
import "dotenv/config";
import bcrypt from "bcrypt";
import pg from "pg";

const [, , username, password, roleIn] = process.argv;
const role = String(roleIn || "owner").toLowerCase() === "secretary" ? "secretary" : "owner";

if (!username || !password || username.length < 2 || password.length < 8) {
  console.error("Uso: node scripts/create-admin-user.mjs <usuario> <contraseña> <owner|secretary>");
  console.error("  usuario: mín. 2 caracteres; contraseña: mín. 8.");
  process.exit(1);
}

const cs = process.env.DATABASE_URL;
if (!cs) {
  console.error("Falta DATABASE_URL en .env");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: cs,
  ssl: cs.includes("neon.tech") ? { rejectUnauthorized: false } : false,
});

const hash = await bcrypt.hash(password, 10);
const un = String(username).trim().toLowerCase();
const client = await pool.connect();
try {
  await client.query(
    `INSERT INTO admin_accounts (username, password_hash, role, updated_at)
     VALUES ($1, $2, $3::varchar, NOW())
     ON CONFLICT (username) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       is_active = TRUE,
       updated_at = NOW()`,
    [un, hash, role]
  );
  console.log("OK: usuario admin", un, "rol", role);
} catch (e) {
  if (e.code === "42P01") {
    console.error("Ejecuta primero en Neon: db/migrate_admin_roles_audit.sql");
  } else {
    console.error(e.message);
  }
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
