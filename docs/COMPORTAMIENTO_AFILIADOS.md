# Comportamiento del sistema para afiliados

Estas reglas están **fijadas en código y base de datos** para que los nuevos registros no vuelvan a mostrar datos cruzados ni inconsistencias.

## Identidad y sesión

- El JWT identifica al usuario por **ID único (UUID)** en el campo `sub`.
- `/auth/me` devuelve solo la fila cuyo `id` coincide con el token; si no coincide, la sesión se invalida.

## Una cédula / documento = una cuenta

- Al **registrar** (`POST /auth/register`), el sistema comprueba que **no exista** otro usuario con el mismo `doc_number` (solo dígitos, normalizado).
- El correo también debe ser **único** por cuenta.
- En base de datos, `doc_number` tiene restricción **UNIQUE** (y opcionalmente el índice `ensure_unique_doc_number.sql` en bases antiguas).
- Si alguien intenta repetir documento o correo, la API responde **409** con un mensaje claro.

## Red y comisiones

- Al registrarse con código de patrocinio válido, se actualizan **directos** y **tamaño de red** de los uplines.
- Las **comisiones por inscripción** (N1, N2, N3) se acreditan cuando el afiliado confirma el **pago de inscripción** (`POST /auth/payment/affiliation`), no solo al darse de alta.

## Despliegue

Ejecutar en Neon las migraciones indicadas en `backend/README.md` (incluidas `migrate_commission_lines.sql`, `migrate_payment_affiliation.sql`, etc.).
