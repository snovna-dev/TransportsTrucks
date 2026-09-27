# Parser de manifiestos - Paso 3

Esta versión corrige la primera calibración del parser usando extracción posicional del PDF.

## Cambios principales

- `pdf.ts` utiliza `unpdf.extractTextItems()` y reconstruye las líneas a partir de X/Y.
- `section-parser.ts` solo reconoce encabezados reales; los labels de campos ya no son secciones.
- `manifest-field-aliases.ts` separa encabezados de sección y aliases de campos.
- `manifest-parser.ts` parsea las tablas usando columnas reconstruidas y patrones específicos.
- Los valores monetarios `12,500` y `875,258` se interpretan como miles, no decimales.
- Remesa, código de producto, remitente y destinatario se separan por patrón de columna.
- `RECOMENDACIONES` y `DUEÑO POLIZA` permanecen sin valor cuando el PDF no permite identificar un dato fiable; no se inventan datos.

## Archivos

```text
src/
├── lib/
│   └── manifiestos_parser/
│       ├── pdf.ts
│       ├── section-parser.ts
│       ├── manifest-field-aliases.ts
│       ├── manifest-parser.ts
│       └── test-pdf.ts
├── schemas/
│   └── manifest-extraction.schema.ts
└── types/
    └── manifest-extraction.ts
```

## Prueba

```powershell
npm run test:pdf -- "C:\ruta\SON325 MANIFIESTOO.pdf"
```

Esta prueba no escribe en PostgreSQL. Solo valida extracción, parsing y Zod.
