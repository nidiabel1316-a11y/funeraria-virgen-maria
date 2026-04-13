# Guía muy simple (sin saber programar)

## ¿Qué es Neon?

**Neon** es solo el **lugar en internet** donde está guardada tu **base de datos** (nombres de afiliados, contraseñas encriptadas, planes, etc.).  
No es Hostinger. Hostinger es donde pones la **página web** (`index.html`).

- **Neon** = caja de datos (PostgreSQL).
- **Hostinger** = la web que ven los usuarios.

Tu programa necesita **las dos cosas**: la web llama a un **servidor** (API) y ese servidor lee/escribe en **Neon**.

---

## ¿Qué son los archivos `.sql` de la carpeta `backend/db`?

Son **instrucciones** para crear tablas o añadir columnas. No tienes que “recordar” cuáles subiste: puedes **comprobarlo** en Neon (abajo).

**No hace falta volver a ejecutar *todo* desde cero** si la base ya funciona y ya tienes usuarios. Solo se añaden las cosas que falten.

---

## Cómo saber qué ya tienes en Neon (sin adivinar)

1. Entra a **https://console.neon.tech** (tu cuenta).
2. Abre tu proyecto → **SQL Editor**.
3. Pega esto y pulsa **Run**:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

Verás una **lista de tablas**. Por ejemplo, si aparece `users`, ya tienes la tabla principal.

Para ver si ya existe la tabla de “olvidé contraseña”:

```sql
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'password_reset_tokens'
);
```

- Si sale **true** → esa migración **ya está**; no hace falta repetirla.
- Si sale **false** → falta ejecutar el archivo `migrate_password_reset.sql` (una sola vez).

---

## ¿Debo ejecutar otra vez todos los SQL?

**No** como rutina. Motivos:

- Algunos scripts son para **arreglar datos** o **pruebas** (solo si alguien de soporte te lo indica).
- `schema.sql` crea tablas base: si **ya tienes** `users` y datos reales, normalmente **no** vuelvas a crear todo desde cero (riesgo de conflicto). Las **migraciones** suelen ser más seguras porque dicen “si no existe, añádelo”.

**Regla simple:**

1. Si la app **ya registra afiliados y hace login**, tu base **ya está creada**.
2. Solo ejecuta en Neon el SQL de **nuevas funciones** que añadamos (por ejemplo `migrate_password_reset.sql` si la consulta de arriba dio `false`).
3. Si no estás seguro, usa las consultas de comprobación y pregunta con una captura de la lista de tablas.

---

## Archivos de `backend/db` — qué es cada cosa (resumen)

| Archivo | Para qué sirve | ¿Lo ejecuto yo solo? |
|--------|----------------|----------------------|
| `schema.sql` | Base inicial (tabla `users`, etc.) | Solo si **empezaras** una base vacía nueva. Si ya tienes usuarios, **no** lo repitas sin saber qué haces. |
| `migrate_add_auth.sql` | Columnas de login si faltaban | Solo si alguien te dijo que faltaban columnas. |
| `migrate_commission_lines.sql` | Comisiones | Si no tienes tabla `commission_lines`, hace falta. |
| `migrate_payment_affiliation.sql` | Pagos inscripción/mensual | Si la app pide esa migración en un error, ejecútala. |
| `migrate_bank_details.sql` | Datos bancarios | Igual: si falta, una vez. |
| `migrate_admin_reports_contracts.sql` | Panel admin + solicitudes de contrato | Si falta, una vez. |
| `migrate_profile_photo.sql` | Foto de perfil | `ALTER` seguro con IF NOT EXISTS. |
| `migrate_password_reset.sql` | “Olvidé contraseña” | Solo si la tabla `password_reset_tokens` no existe. |
| `migrate_academy_jobs.sql` | Academia (preinscripciones, avisos) + bolsa de empleo (empresas, candidatos, ofertas) | Una vez si no existen esas tablas (`academy_registrations`, `job_listings`, etc.). |
| `recalc_network.sql` / `recalc_balance_*.sql` | Recalcular números en datos viejos | Solo si te lo indica soporte. |
| `diagnostic_downline.sql`, `prueba_solo_guillermo.sql`, `corregir_*.sql`, `poner_ceros_*.sql`, `reset_*.sql` | Diagnóstico o arreglos puntuales | **No** sin indicación. |
| `recrear_tabla.sql` | Peligroso si no sabes qué borra | **No** sin copia de seguridad y ayuda. |

---

## Hostinger (muy resumido)

1. **Subir la web:** File Manager → `public_html` → sube `index.html` e imágenes.
2. La **API (Node)** no va en el hosting web barato típico; hace falta **VPS** u otro servicio. Si no quieres complicarte, contrata ayuda o usa un servicio que “suba solo” la API desde GitHub (Render, etc.) — en `HOSTINGER.md` está más detallado.

**Lo mínimo que debes tener claro:**

- En Neon: base de datos con las tablas necesarias (comprobar con el SQL de arriba).
- En la web: la línea que apunta a tu API (`FVM_API_BASE`) — alguien técnico puede ponerla por ti.

---

## Si solo quieres una frase

> **Neon** = donde están los datos. **No** vuelvas a ejecutar todo el SQL “por si acaso”. **Mira** qué tablas tienes; solo ejecuta el archivo nuevo que falte (por ejemplo recuperación de contraseña si esa tabla no existe).

Si me envías (copiando y pegando) el resultado de la consulta `SELECT table_name...` de Neon, te digo **exactamente** qué archivo `.sql` te falta ejecutar y cuál no.
