# Cambios recientes (Funeraria Virgen María)

## 2025-03 — Estabilidad API + «Mi red» + fotos

- **Backend**
  - Límite JSON subido a **8 MB** (`backend/src/index.js`) para poder enviar fotos en base64 sin error `413 Payload Too Large`.
  - Si la columna **`profile_photo_url`** no existe en la base de datos, **`GET /auth/me`** y **`GET /auth/network`** ya **no rompen** la app: se usan consultas sin esa columna y `profilePhotoUrl` queda en `null`.
  - Tras ejecutar `backend/db/migrate_profile_photo.sql`, el servidor **vuelve a detectar la columna** sin obligarte a reiniciar (en la siguiente petición que la use).
- **Frontend (`index.html`)**
  - Árbol «Mi red» con estilo **proVision** y uso de **foto de perfil** cuando exista.
  - Panel Inicio: bloque para subir/quitar foto.
  - **Landing:** la sección «Incentivos MLM» usa `<FvmD3Tree data={fvmDemoTreeData()} … />` (no existe el componente `Tree`; un `<Tree/>` suelto rompía la página en blanco).

## Panel + Referidos + foto (UX)

- **Sidebar** más ancha (≈236px), textos e iconos de menú más grandes (13–16px).
- **Cabecera** con título y datos de usuario más legibles; botón visible **«📷 Subir foto»** además del clic en el avatar.
- **Pestaña Referidos:** además del enlace y redes, lista **tabla N1–N3** con nombres (misma API que «Mi red»).
- **Pagos:** texto aclarando que cada afiliado debe **registrar inscripción** en su cuenta para generar comisiones a la red.

## Sincronización balance / árbol / foto perfil

- **Balance y comisión** en el panel salen de la **suma real** de `commission_lines` (mismo criterio que el historial), evitando cifras distintas con tabla vacía.
- **Árbol «Mi red»:** ya no se colapsan los hijos al cargar: se ven **los 3 niveles** sin tener que desplegar nodo a nodo (el afiliado de Nidia bajo Guillermo aparece si está en la API).
- **Foto de perfil:** se sube con **clic en el círculo del header** (junto al nombre); se quitó el bloque duplicado del inicio. Visible en header y en el árbol del patrocinador.
- **Texto en «Mi red»:** aclara que la genealogía MLM **no** incluye beneficiarios/mascotas del contrato (solo el contrato/PDF).
- SQL opcional: `backend/db/recalc_balance_from_commission_lines.sql` para alinear `users` con sumas de `commission_lines` (solo filas con movimientos).

## Registro + red + comisiones (patrocinador)

- **Plan Elite:** cupo **1 mascota** (`mp: 1`) como Premium/Platinum, para que el paso **Mascotas** y el resumen muestren **Benef. + Mascotas** en todos los planes.
- **GET `/auth/network`:** cada nodo incluye `affiliationPaid`, `monthlyPaidThrough`, `receivesCommission`, `mora`, `moraReason` (según inscripción y mensualidad vs mes actual).
- **«Mi red»:** tabla **Pagos y elegibilidad de comisión** (quién paga inscripción, hasta qué mes va la mensual, si recibe comisión N1–N3).
- **Comisiones por inscripción:** al acreditar N1–N3, se **omite** al upline que esté en mora (sin inscripción o mensualidad &lt; mes calendario). Datos antiguos **sin** `monthly_paid_through` siguen pudiendo recibir (compatibilidad).
- **POST `/auth/payment/affiliation`:** al registrar la inscripción, se rellena `monthly_paid_through` con el **mes actual** si aún estaba vacío (primera cuota implícita).

Para ver solo el código de la red: busca en `index.html` `fvmBuildHierarchyFromNetwork`, `FvmD3Tree`, `NetworkTree` y la sección **Foto en «Mi red»** en el tab inicio.
