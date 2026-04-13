-- Foto de perfil visible en el árbol MLM "Mi red" (URL o data:image/...;base64,...)
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;

COMMENT ON COLUMN users.profile_photo_url IS 'URL o data URL de la foto del afiliado; la ven los patrocinadores en la red';
