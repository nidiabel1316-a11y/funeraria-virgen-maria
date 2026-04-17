# API Funeraria Virgen María

Backend Node.js (Express) con PostgreSQL (Neon), JWT y contraseñas con bcrypt.

## Requisitos

- Node.js 18+
- Cuenta [Neon](https://neon.tech) (base de datos)
- Opcional: [Render](https://render.com) para alojar la API

## Configuración local

1. Copia variables de entorno:

   ```bash
   copy .env.example .env
   ```

2. En Neon, crea un proyecto, copia la **connection string** y pégala en `DATABASE_URL` dentro de `.env`.

3. En el **SQL Editor** de Neon, ejecuta el contenido de `db/schema.sql` completo. Si la tabla `users` ya existe pero da error "column password_hash does not exist", ejecuta en su lugar `db/migrate_add_auth.sql`.

4. **Red y comisiones (obligatorio para registro con comisiones):** ejecuta también `db/migrate_commission_lines.sql` (crea la tabla `commission_lines`). Si ya tienes afiliados sin contadores actualizados, puedes correr `db/recalc_network.sql` una vez.

5. **Pagos y fecha de contrato:** ejecuta `db/migrate_payment_affiliation.sql` (columnas `affiliation_paid_at`, `monthly_paid_through`, `signup_commissions_applied`, `contract_issue_date`). Sin esto, el registro y `/auth/me` pueden fallar si el código espera esas columnas.

6. **Pagos en efectivo desde admin (obligatorio si usarás caja):** ejecuta `db/migrate_admin_cash_payments.sql` para habilitar trazabilidad de pagos en efectivo y que esos ingresos aparezcan en reportes/balance admin.

7. **Desembolsos de comisiones y reportes admin:** ejecuta `db/migrate_admin_reports_contracts.sql` en Neon (tabla `disbursement_payouts`, solicitudes de cambio de contrato, auditoría, columnas `forfeited_at` / `forfeiture_reason` en `commission_lines`). Sin esto, al usar «Autorizar desembolso» en Comisiones el API responde **503** pidiendo esa migración.

8. **Roles del panel admin y auditoría de acciones:** ejecuta `db/migrate_admin_roles_audit.sql`. Crea cuentas con contraseña bcrypt desde la carpeta `backend`: `npm run create-admin-user -- <usuario> <clave> owner` (administrador total) o `... secretary` (solo dashboard, listado de asociados y pagos en efectivo). **Secretaría por .env:** define `ADMIN_SECRETARY_USER` y `ADMIN_SECRETARY_PASSWORD` (ambos obligatorios para activar ese login); entra siempre como **secretary**. Si en Render creaste por error `DMIN_SECRETARY_PASSWORD`, `DMIN_SECRETARY_USER` o `ADMIN_SECRETARY_PASSWOR` (sin la D final), el backend también los lee como alias. El respaldo `admin` / `admin123` sigue siendo **secretaría** para desarrollo. El par `ADMIN_USER` / `ADMIN_PASSWORD` es **propietario** (`owner`). También puedes crear usuario en BD: `npm run create-admin-user -- <usuario> <clave> secretary`. El propietario ve en el panel la sección **Auditoría** (quién hizo qué, cuándo, IP; en pagos/desembolsos el JSON incluye `referralCode` del afiliado).

9. **Cobertura mensual por fecha (YYYY-MM-DD):** si la base ya existía con `monthly_paid_through` en `VARCHAR(7)`, ejecuta una vez `db/migrate_monthly_paid_through_ymd.sql` en Neon para guardar vencimientos completos sin truncar. Instalaciones nuevas que usen las migraciones actualizadas ya crean `VARCHAR(10)`.

10. **Normalizar históricos legacy (recomendado):** si ya tenías datos con `monthly_paid_through` en `YYYY-MM`, ejecuta `db/migrate_normalize_legacy_monthly_anchor.sql` para convertirlos al patrón anclado por día de afiliación (evita que historial/reporte muestre "fin de mes calendario").

11. **Poner todos los saldos y métricas en cero** (balance, red, directos, comisiones y líneas de comisión) antes de producción o tras pruebas: ejecuta `db/reset_metricas_ceros.sql` en Neon. Los **nuevos** registros ya nacen en 0 por defecto.

12. **Documento único (cédula):** en `schema.sql`, `doc_number` es `UNIQUE`. Si una base antigua se creó sin esa restricción, ejecuta una vez `db/ensure_unique_doc_number.sql`. El registro rechaza duplicados con **409** y mensaje explícito.

13. Genera un `JWT_SECRET` largo y aleatorio (mínimo 32 caracteres).

14. Instala dependencias e inicia:

   ```bash
   npm install
   npm run dev
   ```

15. Prueba: `http://localhost:3001/api/health`

## Variables de entorno (producción)

| Variable        | Descripción |
|----------------|-------------|
| `DATABASE_URL` | Cadena de conexión de Neon (con `sslmode=require`) |
| `JWT_SECRET`   | Secreto para firmar tokens |
| `CORS_ORIGIN`  | Orígenes permitidos separados por coma, p. ej. `https://funerariavirgenmaria.com` |
| `PORT`         | Puerto (Render lo inyecta automáticamente) |

## Despliegue en Render

1. Nuevo **Web Service** desde el repositorio Git.
2. **Root Directory**: `backend` (si el repo contiene la carpeta del proyecto).
3. **Build**: `npm install` · **Start**: `npm start`
4. Añade en **Environment** las variables anteriores (copia `DATABASE_URL` y `JWT_SECRET` desde Neon y un generador seguro).

## Frontend (Hostinger)

En `index.html`, antes del script de Babel, ajusta la URL de la API:

```html
<script>window.FVM_API_BASE="https://TU-SERVICIO.onrender.com/api";</script>
```

Sustituye `TU-SERVICIO` por el subdominio que te asigne Render. Vuelve a subir `index.html` a `public_html`.

### Firma del responsable (contrato PDF / impresión)

- Coloca junto a `index.html` (en Hostinger, `public_html`) el archivo de firma escaneada:
  - **Recomendado:** `firma-responsable.png` (fondo transparente o blanco, ancho ~400–800 px, firma oscura).
- Por defecto la app intenta `firma-responsable.png` y, si no existe, usa `firma-responsable.svg`.
- Opcional: antes de cargar Babel, fuerza la ruta o URL:
  ```html
  <script>window.FVM_FIRMA_SRC="https://tudominio.com/assets/firma-responsable.png";</script>
  ```
- Al **Imprimir / Guardar como PDF**, la firma aparece encima de la línea “El responsable de la funeraria” junto al NIT.

## Endpoints

- `GET /api/health` — estado del servicio
- `POST /api/auth/register` — alta de afiliado (tras el flujo de afiliación). **No permite** repetir la misma cédula/documento ni el mismo correo (**409** si ya existen).
- `POST /api/auth/login` — inicio de sesión (cédula o correo + contraseña)
- `GET /api/auth/me` — perfil del afiliado (balance, red, comisiones) y **datos para el contrato**: documento, tipo doc., correo, dirección, ciudad, departamento, teléfonos, fecha de nacimiento, `beneficiaries` y `pets` (JSON guardado en registro). El panel «Contrato» del afiliado usa esta respuesta.
- `GET /api/auth/network` — patrocinador + referidos niveles 1–3 (token)
- `GET /api/auth/commissions` — historial mensual N1/N2/N3 (token)
- `POST /api/auth/payment/affiliation` — confirma pago de inscripción; entonces se acreditan comisiones N1–N3 (una sola vez por afiliado)
- `POST /api/auth/payment/monthly` — registra un mes de mensualidad cubierto (`monthly_paid_through`)
- `PUT /api/auth/password` — cambio de contraseña
- `GET /api/admin/payments/cash?limit=80` — listado de pagos en efectivo registrados por admin
- `POST /api/admin/payments/cash` — registra pago en efectivo por cédula (`paymentType: affiliation|monthly`) y deja trazabilidad para reportes admin

Al **registrar** un afiliado con código de referido válido, el backend actualiza `direct_count` y `network_size` de los patrocinadores. Las **comisiones** (líneas en `commission_lines`, **10% del plan del nuevo afiliado en cada nivel N1, N2 y N3**) se acreditan cuando el **nuevo afiliado** confirma el pago de inscripción vía `POST /payment/affiliation` (no en el alta sola). La vista de red usa cupos **8 → 64 → 512** (presentación MLM).

**Admin** (token `X-Admin-Token`): `PATCH /api/admin/affiliates/:id/contract-date` con body `{ "contractIssueDate": "YYYY-MM-DD" }` para corregir la fecha del contrato (no cambia al reimprimir desde el navegador).

Para dejar solo un usuario de prueba (p. ej. Guillermo) y vaciar el resto: `db/prueba_solo_guillermo.sql` (revisa el email/nombre en el script).

Los datos de afiliados quedan en PostgreSQL; ya no dependen solo del navegador.
