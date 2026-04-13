# Despliegue en Hostinger (sitio + API Node)

## 1. Base de datos (Neon / PostgreSQL)

1. Ejecuta en el SQL editor **todas** las migraciones de `backend/db/` que aún no hayas aplicado, en orden lógico (schema, comisiones, pagos, contratos, foto, **migrate_password_reset.sql**, etc.).
2. Anota la cadena de conexión como `DATABASE_URL`.

## 2. API Node (VPS Hostinger o servicio tipo Render)

Hostinger “Hosting web” compartido **no** ejecuta Node de forma persistente de forma sencilla; lo habitual es:

- **VPS Hostinger** (Node + PM2), o  
- **otro host** solo para la API (Render, Railway, Fly.io) y el dominio apunta el front a Hostinger.

### Variables de entorno (`.env` en el servidor de la API)

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | Conexión PostgreSQL |
| `JWT_SECRET` | Mínimo 32 caracteres aleatorios |
| `PORT` | Ej. `3001` |
| `CORS_ORIGIN` | `https://funerariavirgenmaria.com` (o tu dominio; separa varios con coma) |
| `APP_PUBLIC_URL` | URL pública del **sitio** donde está `index.html`, ej. `https://funerariavirgenmaria.com` (para el enlace de “olvidé contraseña”) |
| **Correo (recuperación)** | |
| `SMTP_HOST` | Servidor SMTP (Hostinger email, Gmail app password, SendGrid, etc.) |
| `SMTP_PORT` | Normalmente `587` (TLS) o `465` (SSL) |
| `SMTP_SECURE` | `true` solo si usas puerto 465 |
| `SMTP_USER` / `SMTP_PASS` | Credenciales SMTP |
| `SMTP_FROM` | Remitente visible, ej. `noreply@funerariavirgenmaria.com` |

Si **no** configuras SMTP, el servidor registrará el enlace de recuperación en la **consola** (útil en desarrollo; en producción configura correo).

### Arranque

```bash
cd backend
npm install
npm start
```

Con PM2: `pm2 start src/index.js --name funeraria-api`

## 3. Sitio estático (Hostinger — `public_html`)

1. Sube **`index.html`**, CSS/JS si los tienes sueltos, imágenes (`firma-responsable.png`, etc.).
2. **Antes** de cargar la app, define la URL de tu API. En el `<head>` de `index.html` ya existe un script; añade **antes** de React:

```html
<script>window.FVM_API_BASE = "https://TU-DOMINIO-API.com/api";</script>
```

Usa la URL real donde responde la API (terminada en `/api`).

3. SSL: activa certificado gratis en Hostinger para `https://`.

## 4. Probar recuperación de contraseña

1. `POST /api/auth/forgot-password` con `{"email":"..."}` debe responder siempre el mismo mensaje genérico.
2. El correo debe contener un enlace del tipo:  
   `https://funerariavirgenmaria.com/?reset=1&token=...`
3. Tras establecer contraseña nueva, el usuario inicia sesión con correo/cédula como siempre.

## 5. Checklist rápido

- [ ] Migración `migrate_password_reset.sql` ejecutada  
- [ ] `APP_PUBLIC_URL` = dominio del front  
- [ ] `CORS_ORIGIN` incluye el dominio del front  
- [ ] `FVM_API_BASE` en `index.html` apunta a la API en producción  
- [ ] SMTP configurado para correos reales  
