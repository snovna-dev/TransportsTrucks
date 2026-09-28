# TransportsTrucks - Paso 7: cargue asíncrono del PDF

Este paso convierte el cargue en el punto de entrada real del pipeline.

## Flujo

```text
Usuario
  ↓
POST /api/manifests/upload
  ↓
SHA-256
  ↓
ManifestJob (idempotencia)
  ↓
Google Drive
  ↓
ManifestJob = QUEUED
  ↓
Pub/Sub { jobId }
```

Todavía no crea `Manifest`. La creación del manifiesto definitivo queda para el worker después de la extracción y revisión.

## 1. Dependencias

Ya deben existir en el proyecto:

- `googleapis`
- `@google-cloud/pubsub`
- `@prisma/client` / Prisma 7
- `next`

No usar `pdf-parse`; el parser validado usa `unpdf`.

## 2. Prisma

Se agregó:

- `ManifestJobStatus`
- relación `Manifest.jobs`
- `ManifestJob`
- `rawText`, `extractedJson`, `overallConfidence` dentro de `ManifestJob` para permitir revisión antes de crear el `Manifest` definitivo.

Con Clever Cloud, usar:

```powershell
npx prisma db push
npx prisma generate
```

No ejecutar `prisma migrate dev` contra la base de datos si el usuario no tiene permisos para crear la shadow database.

## 3. Variables de entorno

Completar `.env.local` con:

```env
DATABASE_URL="..."
GOOGLE_CLOUD_PROJECT_ID="..."
PUBSUB_MANIFEST_TOPIC="manifest-processing"
GOOGLE_DRIVE_FOLDER_ID="..."
GOOGLE_SERVICE_ACCOUNT_EMAIL="..."
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

La carpeta de Drive debe estar compartida con la cuenta de servicio que realiza el upload.

## 4. Endpoint

```http
POST /api/manifests/upload
Content-Type: multipart/form-data
```

Campo requerido:

```text
file = archivo PDF
```

Valida:

- existencia del archivo
- tamaño máximo de 20 MB
- firma `%PDF-`
- SHA-256 para idempotencia

## 5. Respuestas

Nuevo archivo:

```json
{
  "success": true,
  "duplicate": false,
  "jobId": "1",
  "status": "QUEUED",
  "driveFileId": "...",
  "messageId": "..."
}
```

Archivo repetido por el mismo SHA-256:

```json
{
  "success": true,
  "duplicate": true,
  "jobId": "1",
  "status": "QUEUED"
}
```

## 6. Componente visual

`ManifestUploadForm.tsx` es un ejemplo mínimo para conectarlo a `src/app/manifests/upload/page.tsx`.

## 7. Importante para REVIEW_REQUIRED

Cuando el worker encuentre, por ejemplo, la variante 3 sin autorización, no debe intentar insertar un `Manifest` incompleto.

Debe guardar temporalmente la extracción en `ManifestJob.extractedJson` / `rawText` / `overallConfidence` y dejar el job en `REVIEW_REQUIRED`.

Luego la pantalla de revisión permitirá completar `authorizationNumber` y cualquier otro campo faltante. Solo después se ejecuta la persistencia definitiva de `Manifest`, `Cargo` y entidades relacionadas.
