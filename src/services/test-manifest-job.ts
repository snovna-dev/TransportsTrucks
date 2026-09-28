import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { prisma } from "../lib/prisma";
import { createManifestJob } from "./manifest-job.service";

async function main() {
  const pdfPath = process.argv[2];

  if (!pdfPath) {
    console.error(
      'Uso: npm run test:manifest-job -- "C:\\ruta\\archivo.pdf"',
    );
    process.exit(1);
  }

  try {
    const pdf = await readFile(pdfPath);
    const hash = createHash("sha256").update(pdf).digest("hex");
    const originalFileName = pdfPath.split(/[\\/]/).pop() ?? "manifesto.pdf";

    console.log("========================================");
    console.log("PRUEBA DE MANIFEST JOB");
    console.log("========================================");
    console.log(`Archivo: ${originalFileName}`);
    console.log(`SHA-256: ${hash}`);
    console.log();

    const first = await createManifestJob({
      originalFileName,
      fileHash: hash,
    });

    console.log("=== PRIMER INTENTO ===");
    console.log(`ID: ${first.id.toString()}`);
    console.log(`Creado: ${first.created}`);
    console.log(`Estado: ${first.status}`);
    console.log();

    const second = await createManifestJob({
      originalFileName,
      fileHash: hash,
    });

    console.log("=== SEGUNDO INTENTO ===");
    console.log(`ID: ${second.id.toString()}`);
    console.log(`Creado: ${second.created}`);
    console.log(`Estado: ${second.status}`);

    console.log();
    console.log(
      `Idempotencia: ${first.id === second.id ? "OK" : "ERROR"}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main();
