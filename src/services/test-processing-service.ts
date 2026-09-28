import { readFile } from "node:fs/promises";
import { processManifest } from "./processing.service";

async function main() {
    const pdfPath = process.argv[2];

    if (!pdfPath) {
        console.error(
        'Uso: npm run test:processing -- "C:\\ruta\\archivo.pdf"',
        );
        process.exit(1);
    }

    console.log("========================================");
    console.log("PRUEBA DEL PROCESSING SERVICE");
    console.log("========================================");
    console.log(`Archivo: ${pdfPath}`);
    console.log();

    try {
        const pdf = await readFile(pdfPath);

        const result = await processManifest({
        fileName: pdfPath.split(/[\\/]/).pop() ?? "manifesto.pdf",
        pdf,
        });

        console.log("=== RESULTADO ===");
        console.log(`ID: ${result.manifestId ?? "N/A"}`);
        console.log(`Estado: ${result.status}`);
        console.log(`Acción: ${result.action}`);
        console.log(
        `Confianza: ${result.overallConfidence.toFixed(2)}`,
        );
        console.log(
        `Requiere revisión: ${result.reviewRequired}`,
        );
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

main();