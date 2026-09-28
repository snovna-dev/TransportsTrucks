import { extractManifestFromPdfFile } from "../../services/extraction.service";

interface VariantExpectation {
  label: string;
  path: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`VALIDACIÓN FALLIDA: ${message}`);
  }
}

async function testVariant({ label, path }: VariantExpectation) {
  console.log();
  console.log(`=== ${label} ===`);
  console.log(`Archivo: ${path}`);

  const result = await extractManifestFromPdfFile(path);
  const { extraction } = result;

  console.log(`Manifesto: ${extraction.manifest.manifestNumber.value}`);
  console.log(`Autorización: ${extraction.manifest.authorizationNumber.value}`);
  console.log(`Fecha: ${extraction.manifest.issueDate.value}`);
  console.log(`Placa: ${extraction.vehicle.plate.value}`);
  console.log(`Póliza SOAT: ${extraction.vehicle.soatPolicyNumber.value}`);
  console.log(`Remesa: ${extraction.cargo.remittanceNumber.value}`);
  console.log(`Remitente: ${extraction.sender.identificationNumber.value}`);
  console.log(`Destinatario: ${extraction.recipient.identificationNumber.value}`);
  console.log(`Confianza: ${result.overallConfidence.toFixed(2)}`);
  console.log(`Acción: ${result.action}`);

  assert(
    /^\d{10,15}M$/.test(extraction.manifest.manifestNumber.value ?? ""),
    "el número de manifiesto no tiene el formato esperado",
  );
  assert(
    /^\d{8,12}$/.test(extraction.manifest.authorizationNumber.value ?? ""),
    "el número de autorización no fue extraído",
  );
  assert(
    extraction.manifest.issueDate.value !== null,
    "la fecha del manifiesto no fue extraída",
  );
  assert(
    extraction.vehicle.plate.value !== null,
    "la placa no fue extraída",
  );
  assert(
    extraction.vehicle.soatPolicyNumber.value !== null,
    "la póliza SOAT no fue extraída",
  );
  assert(
    extraction.driver.identificationNumber.value !== null,
    "el documento del conductor no fue extraído",
  );
  assert(
    extraction.cargo.remittanceNumber.value !== null,
    "la remesa no fue extraída",
  );
  assert(
    extraction.sender.identificationNumber.value !== null &&
      extraction.recipient.identificationNumber.value !== null,
    "los identificadores de remitente/destinatario no fueron extraídos",
  );
  assert(
    result.blockingReviewFields.length === 0,
    `hay campos bloqueantes: ${result.blockingReviewFields.map((field) => field.path).join(", ")}`,
  );
  assert(
    result.action === "AUTO_SAVE",
    `el documento terminó en ${result.action} en lugar de AUTO_SAVE`,
  );

  console.log("Resultado: OK");
}

async function main() {
  const paths = process.argv.slice(2);

  if (paths.length < 2) {
    console.error(
      'Uso: npm run test:parser:variants -- "C:\\ruta\\manifiesto1.pdf" "C:\\ruta\\manifiesto2.pdf"',
    );
    process.exit(1);
  }

  console.log("========================================");
  console.log("PRUEBA DE VARIANTES DEL PARSER");
  console.log("========================================");

  await testVariant({ label: "VARIANTE 1", path: paths[0]! });
  await testVariant({ label: "VARIANTE 2", path: paths[1]! });

  console.log();
  console.log("========================================");
  console.log("TODAS LAS VARIANTES: OK");
  console.log("========================================");
}

main().catch((error) => {
  console.error();
  console.error("=== ERROR ===");
  console.error(error);
  process.exit(1);
});
