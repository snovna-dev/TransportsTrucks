import {
  extractPdfTextFromFile,
} from "./pdf";
import {
  getFieldsForReview,
  parseManifestText,
  summarizeConfidence,
} from "./manifest-parser";
import { parseSections } from "./section-parser";

async function main() {
  const pdfPath = process.argv[2];

  if (!pdfPath) {
    console.error('Uso: npm run test:pdf -- "C:\\ruta\\archivo.pdf"');
    process.exit(1);
  }

  console.log("========================================");
  console.log("PRUEBA DEL PIPELINE DEL PARSER");
  console.log("========================================");
  console.log(`Archivo: ${pdfPath}`);
  console.log();

  try {
    const extraction = await extractPdfTextFromFile(pdfPath);

    console.log("=== INFORMACIÓN DEL PDF ===");
    console.log(`Páginas: ${extraction.pageCount}`);
    console.log(`Tiene texto: ${extraction.hasText}`);
    console.log();

    console.log("=== SECCIONES DETECTADAS ===");
    const sections = parseSections(extraction.layoutText).sections;

    if (sections.length === 0) {
      console.log("No se detectaron secciones.");
    } else {
      sections.forEach((section) => {
        console.log(
          `${section.section}: líneas ${section.startLine}-${section.endLine}`,
        );
      });
    }

    console.log();
    console.log("=== TEXTO DE LAYOUT ===");
    console.log("----------------------------------------");
    console.log(extraction.layoutText);
    console.log("----------------------------------------");
    console.log();

    console.log("=== JSON DEL MANIFIESTO ===");
    const manifest = parseManifestText(extraction.layoutText);
    console.log(JSON.stringify(manifest, null, 2));
    console.log();

    console.log("=== RESUMEN DE CONFIANZA ===");
    const summary = summarizeConfidence(manifest);
    console.log(`Campos: ${summary.total}`);
    console.log(`AUTO_SAVE (> 0.95): ${summary.autoSave}`);
    console.log(`SAVE_FOR_REVIEW (0.75 - 0.95): ${summary.review}`);
    console.log(`MANUAL_REVIEW (< 0.75 / null): ${summary.manual}`);
    console.log();

    const review = getFieldsForReview(manifest);
    console.log("=== CAMPOS CON REVISIÓN ===");

    if (review.length === 0) {
      console.log("Ninguno.");
    } else {
      review.forEach((field) => {
        console.log(
          `${field.path}: value=${JSON.stringify(field.value)} confidence=${field.confidence} section=${field.section}`,
        );
      });
    }
  } catch (error) {
    console.error();
    console.error("=== ERROR ===");

    if (error instanceof Error) {
      console.error(error.name);
      console.error(error.message);
      if ("cause" in error && error.cause) {
        console.error("Causa:", error.cause);
      }
    } else {
      console.error(error);
    }

    process.exit(1);
  }
}

main();
