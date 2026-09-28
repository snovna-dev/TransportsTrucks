import { extractManifestFromPdfFile } from "./extraction.service";

async function main() {
  const pdfPath = process.argv[2];

  if (!pdfPath) {
    console.error('Uso: npm run test:extraction -- "C:\\ruta\\archivo.pdf"');
    process.exit(1);
  }

  try {
    const result = await extractManifestFromPdfFile(pdfPath);

    console.log("========================================");
    console.log("PRUEBA DEL EXTRACTION SERVICE");
    console.log("========================================");
    console.log(`Páginas: ${result.pageCount}`);
    console.log(`Texto extraíble: ${result.hasText}`);
    console.log(`Confianza global: ${(result.overallConfidence * 100).toFixed(2)}%`);
    console.log(`Acción: ${result.action}`);
    console.log();

    console.log("=== RESUMEN ===");
    console.log(`Campos: ${result.summary.total}`);
    console.log(`Auto-save: ${result.summary.autoSave}`);
    console.log(`Revisión: ${result.summary.review}`);
    console.log(`Manual: ${result.summary.manual}`);
    console.log();

    console.log("=== CAMPOS BLOQUEANTES ===");
    if (result.blockingReviewFields.length === 0) {
      console.log("Ninguno");
    } else {
      result.blockingReviewFields.forEach((field) => {
        console.log(
          `${field.path}: value=${JSON.stringify(field.value)} ` +
            `confidence=${field.confidence} required=${field.required}`,
        );
      });
    }
    console.log();

    console.log("=== CAMPOS NO BLOQUEANTES CON REVISIÓN ===");
    const optional = result.reviewFields.filter((field) => !field.required);

    if (optional.length === 0) {
      console.log("Ninguno");
    } else {
      optional.forEach((field) => {
        console.log(
          `${field.path}: value=${JSON.stringify(field.value)} ` +
            `confidence=${field.confidence}`,
        );
      });
    }
  } catch (error) {
    console.error("=== ERROR ===");
    console.error(error);
    process.exit(1);
  }
}

main();
