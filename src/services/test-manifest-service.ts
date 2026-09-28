import { readFile } from "node:fs/promises";

import { extractManifestFromPdf } from "./extraction.service";
import { persistManifest } from "./manifest.service";
import { prisma } from "../lib/prisma";

async function main() {
  const pdfPath = process.argv[2];

  if (!pdfPath) {
    console.error(
      'Uso: npm run test:manifest-service -- "C:\\ruta\\archivo.pdf"',
    );
    process.exit(1);
  }

  console.log("========================================");
  console.log("PRUEBA DE PERSISTENCIA DEL MANIFIESTO");
  console.log("========================================");
  console.log(`Archivo: ${pdfPath}`);
  console.log();

  try {
    const buffer = await readFile(pdfPath);
    const extractionResult = await extractManifestFromPdf(buffer);

    console.log("=== EXTRACCIÓN ===");
    console.log(`Confianza global: ${extractionResult.overallConfidence.toFixed(2)}`);
    console.log(`Acción: ${extractionResult.action}`);
    console.log(`Campos bloqueantes: ${extractionResult.blockingReviewFields.length}`);
    console.log();

    if (extractionResult.blockingReviewFields.length > 0) {
      console.error("La extracción no puede persistirse porque tiene campos obligatorios pendientes.");
      process.exit(1);
    }

    const result = await persistManifest({
      extractionResult,
      pdfFileName: pdfPath.split(/[/\\]/).pop() ?? null,
    });

    console.log("=== PERSISTENCIA ===");
    console.log(`ID: ${result.manifestId.toString()}`);
    console.log(`Manifiesto: ${result.manifestNumber}`);
    console.log(`Autorización: ${result.authorizationNumber}`);
    console.log(`Creado: ${result.created}`);
    console.log(`Estado: ${result.status}`);
    console.log(`Revisión: ${result.reviewStatus}`);
    console.log(`Confianza: ${result.overallConfidence.toFixed(2)}`);
    console.log();
    console.log("Persistencia completada correctamente.");
  } catch (error) {
    console.error("=== ERROR ===");

    if (error instanceof Error) {
      console.error(error.message);
      if (error.cause) console.error("Causa:", error.cause);
    } else {
      console.error(error);
    }

    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
