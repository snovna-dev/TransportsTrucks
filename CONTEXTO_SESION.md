# TransportsTrucks — Contexto de sesión

**Fecha:** 20 de noviembre de 2026
**Ruta del proyecto:** `C:\Users\TI-DEV\Documents\git_no\TransportsTrucks` (antes en `C:\Users\TI-DEV\Downloads\TransportsTrucks`)
**Repositorio:** `github.com/snovna-dev/TransportsTrucks` — rama `main`, último commit `01a631d fix: reintento de cargue de archivo`
**Documento de referencia:** `TransportsTrucks_Resumen_Proyecto_Arquitectura.docx` (estado del proyecto y decisiones de arquitectura, fases 1–16)

> Nota: en la nueva ruta, `git status` muestra casi todos los archivos como modificados, pero comparando con `--ignore-cr-at-eol` no hay diferencias reales: solo cambiaron los finales de línea (CRLF de Windows).

---

## 1. Qué es el proyecto

Aplicación web para cargar PDFs de **manifiestos electrónicos de carga** (Colombia, RNDC), extraer sus datos automáticamente y guardarlos estructurados en PostgreSQL, con revisión manual cuando la extracción no es confiable.

- Usuario: **una sola persona, una sola empresa**. **Sin login ni roles.**
- Volumen: unos **7–8 manifiestos al mes**.
- Los PDF son digitales (con texto extraíble); no se usa OCR.

### Stack
| Componente | Tecnología |
|---|---|
| Web / API | Next.js 16.3.4 (App Router), React 19, TypeScript 5.9 |
| BD | PostgreSQL en Clever Cloud, Prisma 7.10 con `@prisma/adapter-pg` (cliente generado en `src/generated/prisma`) |
| PDF | `unpdf` (se descartó `pdf-parse`) |
| Validación | Zod 4 |
| Almacenamiento PDF | Google Drive (pendiente de pasar a OAuth con cuenta personal) |
| Cola | Google Cloud Pub/Sub (pendiente) |
| Worker | Cloud Run según el documento (pendiente; ver decisión abierta) |
| Despliegue web | **Netlify** (confirmado por el usuario) |
| Estilos | Tailwind 4 instalado, pero sin configurar |

Con Clever Cloud se usa `npx prisma db push` + `npx prisma generate` (no `migrate dev`, porque no hay permisos para la shadow database).

---

## 2. Estructura actual

```
prisma/schema.prisma
prisma.config.ts
src/
  app/
    layout.tsx                         ✔ html/body
    manifests/upload/page.tsx          ✔ pantalla de cargue
    manifests/page.tsx                 ✘ VACÍO
    manifests/[id]/page.tsx            ✘ VACÍO
    api/manifests/upload/route.ts      ✔ endpoint de cargue
  components/manifests/
    ManifestUploadForm.tsx             ✔
    ManifestReview.tsx / ManifestStatus.tsx / ManifestTable.tsx / ManifestUpload.tsx  ✘ VACÍOS
  lib/
    prisma.ts                          cliente Prisma (singleton)
    google-drive.ts                    subida con CUENTA DE SERVICIO (falla: sin cuota)
    pubsub.ts                          publica { jobId }
    manifiestos_parser/
      pdf.ts                           extracción con unpdf + reconstrucción de layout por X/Y; SOLO página 1
      section-parser.ts                normalización y detección de secciones
      manifest-field-aliases.ts        diccionario de alias de etiquetas
      manifest-parser.ts               parser general (Tanques del Nordeste) + delega a Pacar
      pacar-variant-parser.ts          parser de Transportes Pacar S.A.S.
      test-pdf.ts / test-parser-variants.ts
  schemas/manifest-extraction.schema.ts   esquema Zod canónico + umbrales de confianza
  services/
    extraction.service.ts              PDF → extracción + confianza + campos de revisión
    manifest.service.ts                persistManifest(): upserts en transacción
    manifest-job.service.ts            create/retry de ManifestJob, storage, QUEUED, ERROR
    processing.service.ts              FLUJO VIEJO: recibe Buffer y persiste Manifest directo
    test-*.ts                          scripts de prueba (npm run test:*)
  types/manifest-extraction.ts, manifest-job.ts
.env.example                           ✘ VACÍO
```

### Modelos Prisma
`Company`, `Driver`, `VehicleHolder`, `ManifestHolder`, `Vehicle`, `PersonOrCompany` (remitente / destinatario / propietario de la carga), `Manifest`, `Cargo` (1:1 con Manifest), `ManifestProcessing` (1:1 con Manifest), `ManifestJob`.
Enums: `ManifestStatus`, `ManifestJobStatus` (UPLOADED, QUEUED, PROCESSING, COMPLETED, REVIEW_REQUIRED, ERROR), `ExtractionReviewStatus`.

`Manifest.manifestNumber` y `Manifest.authorizationNumber` son **obligatorios y únicos**.

---

## 3. Flujo implementado hoy

1. `POST /api/manifests/upload` (multipart, campo `file`): valida que exista, que no esté vacío, ≤ 20 MB y con firma `%PDF-`.
2. Calcula SHA-256 → `createManifestJob` (idempotencia por `fileHash` único).
   - Si el job existente está en UPLOADED o ERROR → se permite reintento.
   - Si está en QUEUED, PROCESSING, COMPLETED o REVIEW_REQUIRED → devuelve `duplicate: true`.
3. Sube a Drive (reutiliza `driveFileId` si ya existía) → `QUEUED` → publica `{ jobId }` en Pub/Sub.
4. **Nadie consume el mensaje todavía (no hay worker).**

### Extracción y confianza
- Cada campo es `{ value, confidence, source: "PDF_TEXT", section, matchedLabel }`.
- La confianza global es la **mínima entre los campos obligatorios** (`REQUIRED_FIELDS` en `extraction.service.ts`).
- Más de 0.95 → `AUTO_SAVE`; entre 0.75 y 0.95 → `SAVE_FOR_REVIEW`; menos de 0.75 → `MANUAL_REVIEW`. Cualquier campo obligatorio marcado como bloqueante → REVIEW_REQUIRED.

### Variantes probadas (3)
| PDF | Manifiesto | Autorización | Remesa | Resultado |
|---|---|---|---|---|
| SON325 MANIFIESTOO.pdf | 2600987201699M | 114286760 | 086149 | OK (55/62 campos con más de 95 %) |
| MANI SON 325.pdf | 2500987192647M | 99558688 | 075211 | OK (55/62) |
| MANIFIESTO DANIEL.pdf (Pacar, 2 páginas) | 0104036004 - 0 | no aparece en la página 1 | 0104036011 | REVIEW_REQUIRED (50/62) |

Regla: **no inventar la autorización** si no aparece.

---

## 4. Problemas y brechas detectadas

1. **No existe el worker** que consume Pub/Sub.
2. `processing.service.ts` sigue el flujo viejo: no usa `ManifestJob` y, cuando el resultado es REVIEW_REQUIRED, no guarda `rawText`, `extractedJson` ni `overallConfidence` en el job.
3. `ManifestProcessing` es 1:1 con `Manifest`; el documento quiere que sea un historial de intentos ligado a `ManifestJob` (1:N).
4. `Cargo` es 1:1 con `Manifest`; el documento recomienda pasar a `Remittance` 1:N (manifiestos multiparada o de ida y regreso, según la Resolución 20263040016075 de MinTransporte).
5. `upsertVehicle` exige `semiTrailerPlate`, SOAT, etc. **El usuario confirma que en algunas variantes esos datos no existen**, así que hay que volverlos opcionales. Lo mismo puede pasar con `authorizationNumber` (obligatorio y único en la BD).
6. **Los archivos OAuth que menciona el documento (Fase 9) no están en el repo:** `src/lib/google-oauth.ts`, `src/app/api/google/drive/authorize/route.ts`, `src/app/api/google/drive/callback/route.ts`, `scripts/setup-google-drive.ts`.
7. **Google no está configurado todavía** (ni la cuenta, ni OAuth, ni el topic o la suscripción de Pub/Sub, ni Cloud Run).
8. Hay componentes y páginas vacíos (listado, detalle, revisión, estado, tabla) y `.env.example` está vacío.
9. Tailwind está instalado, pero faltan `globals.css`, la configuración de PostCSS y `next.config`. El `tsconfig` incluye solo `src/**/*.ts`, así que los `.tsx` no se revisan con TypeScript.
10. `pubsub.ts` lanza un error al importarse si falta `GOOGLE_CLOUD_PROJECT_ID`.
11. **Netlify:** las funciones (AWS Lambda) tienen un límite de **6 MB por petición** y un tiempo de ejecución de unos 10 s, extensible a unos 26 s. El límite actual de 20 MB del cargue no es viable allí.

---

## 5. Respuestas del usuario (confirmadas)

| Tema | Respuesta |
|---|---|
| Despliegue web | Netlify |
| Usuarios | Una persona, una empresa |
| Login / roles | No |
| Variantes PDF | 3 por ahora |
| Campos faltantes (semirremolque, autorización, etc.) | Sí puede pasar; en algunas variantes no existen |
| Pantalla de revisión | Corregir **solo los campos de baja confianza** |
| Reenvío de un manifiesto existente | **Sobrescribir** el existente |
| Google Cloud / Drive | Aún no configurado |

---

## 6. Decisiones del documento de arquitectura

- Worker: Cloud Run con suscripción **push** de Pub/Sub, OIDC, reclamo atómico del job, idempotente, con dead-letter. Carpeta `worker/` en el mismo repo, reutilizando parser y servicios.
- `processing.service` se conserva y pasa a `processManifestJob(jobId)`.
- `ManifestJob` = estado actual; `ManifestProcessing` = historial de intentos (attempt_number, status, confidence, parser_version, error, snapshot).
- `Manifest` 1:N `Remittance` (cada remesa con su remitente, destinatario y propietario).
- Revisión: dos paneles (PDF y datos), mostrar todo, resaltar lo dudoso, auditar las correcciones (original, corregido, fecha, campo, fuente USER).
- Rutas propuestas: `/manifests/review`, `/manifests/review/[jobId]`, `/manifests`, `/manifests/[id]`. API: `GET /api/manifest-jobs`, `GET /api/manifest-jobs/[id]`, `PATCH /api/manifest-jobs/[id]/review`, `POST /api/manifest-jobs/[id]/complete`.
- Drive: OAuth 2.0 con la cuenta personal (refresh token), scope `drive.file`. Variables: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_OAUTH_REFRESH_TOKEN`, `GOOGLE_DRIVE_FOLDER_ID`.
- PDF original: servirlo por un endpoint controlado, no por un enlace público de Drive.

---

## 7. Conflictos abiertos (pendientes de decisión del usuario)

1. **Sobrescribir o bloquear:** el usuario quiere sobrescribir; el documento dice no sobrescribir y marcar posible duplicado. → Definir.
2. **Revisión:** el usuario quiere corregir solo los campos de baja confianza; el documento dice mostrar todos y permitir editar cualquiera. Propuesta: mostrar todo, exigir solo los marcados y dejar los demás editables.
3. **Auditoría sin login:** guardar original, corregido, campo, fecha y fuente USER, sin usuario.
4. **Tamaño de los PDF en Netlify:** confirmar el tamaño típico. Si es menor de 4–5 MB, bajar el límite; si no, subir directo desde el navegador a Drive.
5. **Worker:** Cloud Run + Pub/Sub (documento) o algo más simple: procesar en la misma petición o con una tarea en segundo plano de Netlify, dado el volumen bajo y que Google no está configurado.
6. **Autorización en el PDF de DANIEL:** ¿está en la página 2 o no existe? ¿El usuario la escribe en la revisión o se permite guardar el manifiesto sin ella (volverla opcional)? ¿Qué otros campos pueden faltar?
7. **Remesas 1:N:** ¿se cambia ya? ¿Hay algún PDF multiparada de ejemplo?
8. **Material de prueba:** copiar los 3 PDF a `samples/` y tener un `.env.local` con `DATABASE_URL`.
9. **Orden de trabajo propuesto** (sin depender de Google): modelo de remesas y campos opcionales → `processing.service` basado en `ManifestJob` → revisión → consulta → almacenamiento intercambiable → Drive OAuth → worker.

---

## 8. Comandos útiles

```powershell
npm run dev
npx prisma db push
npx prisma generate
npm run test:parser:variants -- "ruta\SON325 MANIFIESTOO.pdf" "ruta\MANI SON 325.pdf" "ruta\MANIFIESTO DANIEL.pdf"
npm run test:extraction
npm run test:manifest-job
```
