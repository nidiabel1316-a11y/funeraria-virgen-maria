-- Garantiza que no puedan existir dos usuarios con el mismo documento (cédula).
-- En instalaciones nuevas, `schema.sql` ya define `doc_number ... UNIQUE`.
-- Si tu base fue creada sin esa restricción, ejecuta este script una vez en Neon.

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_doc_number_unique ON users (doc_number);
