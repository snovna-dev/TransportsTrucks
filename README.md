# TransportsTrucks

Carga de PDF de manifiestos electrónicos de carga (RNDC), extracción automática, revisión manual de los campos dudosos y consulta.

## Flujo

```text
/manifests/upload ──► POST /api/manifests/upload
                        │  valida PDF (≤ MAX_UPLOAD_MB), SHA-256, ManifestJob (idempotencia)
                        │  guarda el PDF (STORAGE_PROVIDER: db | local | drive)
                        ▼
                  processManifestJob(jobId)      ← en la misma petición (PROCESSING_MODE=sync)
                        │                          o vía Pub/Sub → /api/manifest-jobs/worker
                        ├─ confianza alta ──► Manifest + Cargo + entidades (COMPLETED)
                        └─ campos dudosos ──► ManifestJob.REVIEW_REQUIRED
                                               (rawText, extractedJson, overallConfidence)
                                                     │
                       /manifests/review/[jobId] ◄───┘  PDF a la izquierda, datos a la derecha
                        │  PATCH /api/manifest-jobs/[id]/review   (borrador + auditoría)
                        └─ POST  /api/manifest-jobs/[id]/complete (crea o sobrescribe el Manifest)
```

## Pantallas

| Ruta | Qué hace |
|---|---|
| `/manifests/upload` | Cargar un PDF; muestra el resultado y enlaza a la revisión o al manifiesto. |
| `/manifests` | Cargues pendientes o con error (con botón Reprocesar) y listado de manifiestos con búsqueda. |
| `/manifests/[id]` | Detalle del manifiesto, PDF original, correcciones manuales y cargues. |
| `/manifests/review` | Cargues en `REVIEW_REQUIRED` o `ERROR`. |
| `/manifests/review/[jobId]` | Revisión en dos paneles. Se resaltan los campos dudosos; los demás se pueden editar con “Ver y editar todos los campos”. |

## API

| Método y ruta | Uso |
|---|---|
| `POST /api/manifests/upload` | Cargue (`multipart/form-data`, campo `file`). |
| `GET /api/manifest-jobs?status=REVIEW_REQUIRED,ERROR` | Lista de jobs. |
| `GET /api/manifest-jobs/[id]` | Job, extracción y campos a revisar. |
| `PATCH /api/manifest-jobs/[id]/review` | `{ "values": { "manifest.authorizationNumber": "123" } }` guarda correcciones. |
| `POST /api/manifest-jobs/[id]/complete` | Aplica `values` (opcional), confirma lo demás y guarda el Manifest. |
| `POST /api/manifest-jobs/[id]/process` | Reprocesa (`?force=1` vuelve a extraer un job en revisión). |
| `GET /api/manifest-jobs/[id]/pdf` | PDF original (sin enlaces públicos de Drive). |
| `POST /api/manifest-jobs/worker?token=…` | Push de Pub/Sub (solo con `PROCESSING_MODE=pubsub`). |
| `GET /api/google/drive/authorize` | Obtiene el refresh token de Drive (solo con `GOOGLE_OAUTH_SETUP_ENABLED=true`). |

## Formatos de PDF soportados

El formato se detecta automáticamente (`parseManifestDocument` en `src/lib/manifiestos_parser/manifest-parser.ts`) y se muestra en la pantalla de revisión.

| Formato | Empresas probadas | Cómo se lee |
|---|---|---|
| `TANQUES` | Tanques del Nordeste S.A. | Parser de texto original (`manifest-parser.ts`). |
| `OPL` | OPL Carga SAS | Por coordenadas (`template-parsers.ts`): valores alineados a la izquierda de cada encabezado. |
| `RNDC_B` | Quick Help S.A.S (y el mismo formato de Transportes Pacar) | Por coordenadas: valores centrados bajo el encabezado, fechas tipo `2024/ago/02`. |
| `PACAR` | Transportes Pacar S.A.S | Parser Pacar original combinado con el lector `RNDC_B`. |
| `DESCONOCIDO` | Cualquier otro | Parser general, con todos los campos limitados a 90 % de confianza para que siempre pase por revisión. |

Los lectores por coordenadas (`layout-grid.ts`) ubican cada dato por su etiqueta y su posición en la página, así que no dependen de placas, nombres ni números concretos. Si un valor no tiene la forma esperada (placa `ABC123`, NIT numérico, etc.), queda con 80 % de confianza y se pide revisión.

Para probar uno o varios PDF sin base de datos:

```powershell
npm run test:parser:variants -- "manifiesto 1.pdf" "manifiesto 2.pdf" "manifiesto 3.pdf"
```

## Solo manifiestos

El cargue acepta únicamente manifiestos de carga, que son los que traen la información del viaje y de los pagos. Antes de guardar el archivo se revisa que el PDF diga "MANIFIESTO" y traiga al menos tres conceptos de pago (valor total, retención, neto a pagar, anticipo, saldo); si no, se rechaza con un mensaje (`checkManifestDocument` en `src/lib/manifiestos_parser/document-check.ts`). Las remesas y órdenes de cargue se reconocen y se rechazan con un mensaje específico.

## Reglas de campos

Definidas en `src/lib/manifest-fields.ts`:

- **MUST_HAVE** (NIT y razón social de la empresa, número y fecha del manifiesto, conductor, placa, remesa): sin ellos no se guarda.
- **EXPECTED** (autorización, origen, destino, titulares, remitente, destinatario, datos de carga): si faltan o son dudosos, el manifiesto va a revisión, pero se pueden dejar vacíos.
- **OPTIONAL_CHECKED** (semirremolque, SOAT, marca, configuración, peso vacío, licencia): solo se revisan si vienen con baja confianza; si no existen en la variante, no bloquean.
- La autorización se busca también en las páginas 2 en adelante (variante Pacar). Si aparece allí, queda marcada para que la confirme.
- Reenviar un manifiesto con el mismo número **sobrescribe** el existente. Una autorización ausente no borra la ya registrada.
- Cada corrección queda en `manifest_field_corrections` (campo, valor original, valor corregido, confianza original, fecha, fuente `USER`).

## Puesta en marcha

```powershell
copy .env.example .env.local     # y completar DATABASE_URL
npm install
npx prisma db push               # aplica los cambios del schema (ver abajo)
npx prisma generate
npm run dev                      # http://localhost:3000/manifests
```

Cambios de schema de este paso (todos compatibles con datos existentes):

- `manifests.authorization_number` pasa a ser opcional (sigue siendo único).
- `manifest_jobs`: nuevas columnas `storage_provider`, `storage_key`, `file_size`, `pdf_data`, `reviewed_at`.
- Nueva tabla `manifest_field_corrections`.

Con Clever Cloud se usa `prisma db push` (no `migrate dev`, que necesita la shadow database).

## Scripts

```powershell
npm run typecheck
npm run test:parser:variants -- "ruta\a.pdf" "ruta\b.pdf"
npm run test:extraction -- "ruta\a.pdf"
npm run test:processing -- "ruta\a.pdf"   # crea el job y lo procesa contra la BD de .env.local
```

## Netlify

- El cuerpo de una petición está limitado a ~6 MB, por eso `MAX_UPLOAD_MB=4`.
- Las funciones tienen 10 s por defecto (configurable hasta 26 s); procesar un PDF digital tarda 1 a 3 s.
- Con `STORAGE_PROVIDER=db` no hace falta Google para funcionar. Para Drive: crear credenciales OAuth (aplicación web) en Google Cloud, configurar las variables `GOOGLE_OAUTH_*`, visitar `/api/google/drive/authorize` con `GOOGLE_OAUTH_SETUP_ENABLED=true`, copiar el refresh token y poner `STORAGE_PROVIDER=drive`.

## Pendiente (decisiones abiertas)

- Remesas 1:N (`Remittance`) para manifiestos multiparada: hoy `Cargo` sigue siendo 1:1.
- `ManifestProcessing` sigue siendo 1:1 con `Manifest` (último procesamiento); el historial de intentos vive en `ManifestJob.attempts` y en las correcciones.
