import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { prisma } from "../lib/prisma";
import { savePdf } from "../lib/storage";
import {
    createManifestJob,
    markManifestJobQueued,
    updateManifestJobStorage,
} from "./manifest-job.service";
import { processManifestJob } from "./processing.service";

/**
 * Prueba de punta a punta sin pasar por HTTP: crea (o reutiliza) el job del
 * PDF, lo guarda en el almacenamiento configurado y ejecuta processManifestJob.
 * Uso: npm run test:processing -- "C:\ruta\archivo.pdf"
 */
async function main() {
    const pdfPath = process.argv[2];

    if (!pdfPath) {
        console.error('Uso: npm run test:processing -- "C:\\ruta\\archivo.pdf"');
        process.exit(1);
    }

    try {
        const buffer = await readFile(pdfPath);
        const fileName = pdfPath.split(/[\\/]/).pop() ?? "manifiesto.pdf";
        const fileHash = createHash("sha256").update(buffer).digest("hex");

        const job = await createManifestJob({ originalFileName: fileName, fileHash, fileSize: buffer.length });
        console.log(`Job ${job.id} (nuevo/reintento: ${job.created}, estado: ${job.status})`);

        if (job.created) {
            if (!job.storageProvider) {
                await updateManifestJobStorage(job.id, await savePdf({ jobId: job.id, fileName, fileHash, buffer }));
            }
            await markManifestJobQueued(job.id);
        }

        const result = await processManifestJob(job.id, { force: !job.created });

        console.log("=== RESULTADO ===");
        console.log(`Estado: ${result.status}${result.skipped ? " (sin cambios)" : ""}`);
        console.log(`Manifest ID: ${result.manifestId ?? "N/A"}`);
        console.log(`Acción: ${result.action ?? "N/A"}`);
        console.log(`Confianza: ${result.overallConfidence?.toFixed(2) ?? "N/A"}`);
        console.log(`Campos bloqueantes: ${result.blockingFields}`);
        if (result.error) console.log(`Error: ${result.error}`);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
