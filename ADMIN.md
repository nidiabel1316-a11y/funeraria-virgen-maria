# Panel de administración

## Cómo entrar (desde la web)

1. Abre la página principal (`index.html`).
2. En la barra superior, junto a **Mi Cuenta**, haz clic en **Admin** (texto pequeño).
3. Ingresa **usuario** y **contraseña** configurados en el servidor.

## Credenciales por defecto (solo desarrollo local)

Si no defines variables de entorno, el backend usa:

| Campo        | Valor por defecto |
|-------------|-------------------|
| **Usuario** | `admin`           |
| **Contraseña** | `admin123`     |

**En producción:** crea en `backend/.env` (o en tu hosting):

```env
ADMIN_USER=tu_usuario_seguro
ADMIN_PASSWORD=tu_clave_larga_y_unica
```

Reinicia el servidor Node después de cambiar el `.env`.

## Requisitos técnicos

- El backend debe estar en marcha (`npm run dev` en `backend/`, puerto **3001** por defecto).
- El navegador debe poder llamar a la API: en local, `index.html` usa `http://127.0.0.1:3001/api` (ver `FVM_API_BASE` al inicio de `index.html`).

## Qué hace el panel (UI tipo dashboard)

- **Dashboard:** métricas (`GET /admin/stats`), distribución por plan, accesos rápidos.
- **Asociados:** listado (`GET /admin/affiliates`), búsqueda, botón **Ver red** → árbol MLM (`GET /admin/affiliates/:id/network`), mismo formato que la red del afiliado.
- **Comisiones:** histórico global por mes (`GET /admin/commissions/summary`), detalle por asociado y mes (`GET /admin/commissions/by-affiliate?month=YYYY-MM` y opcional `&all=1`), modal de **desembolso** (`POST /admin/disbursements/authorize`, `POST /admin/disbursements/:id/mark-paid`) solo si el afiliado está al día.
- **Reportes:** KPIs, **listados** de mora y sin inscripción (`GET /admin/reports/summary` incluye `moraList` y `sinInscripcionList`), **descarga CSV** mensual (`GET /admin/reports/data/monthly?month=YYYY-MM`) y balance **anual** (`GET /admin/reports/data/annual?year=YYYY`), **cierre de mes** (`POST /admin/commissions/close-month`). Migración: `backend/db/migrate_admin_reports_contracts.sql`.
- **Asociados:** al pulsar **Ver red + contrato** se carga el árbol y la **ficha contractual** (`GET /admin/affiliates/:id`: beneficiarios con enfermedad, mascotas con edad, auditoría).
- **Contratos:** solicitudes de cambio (`GET /admin/contract-requests`), aprobar / rechazar (`POST /admin/contract-requests/:id/approve|reject`). El afiliado crea solicitudes con `POST /auth/contract-change-request` (JWT).
- **Red Global / Config:** enlaces y notas (config Hostinger: `window.FVM_API_BASE`).

La columna **Red** en la tabla admin es el valor **en BD** (`network_size`). El panel del afiliado usa recálculo en vivo.

## SQL de ayuda

Ver `backend/db/diagnostic_downline.sql` para contar cuántos hay debajo de un UUID (reemplaza el UUID de ejemplo por el del patrocinador).
