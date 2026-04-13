import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn("ADVERTENCIA: DATABASE_URL no está definida.");
}

export const pool = new Pool({
  connectionString,
  ssl: connectionString?.includes("neon.tech") || process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
});
