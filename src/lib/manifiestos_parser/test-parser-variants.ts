import { extractPdfTextFromFile } from "./pdf";
import { parseManifestText, summarizeConfidence } from "./manifest-parser";

const files = process.argv.slice(2);

if (files.length < 1) {
  console.error(
    'Uso: npm run test:parser:variants -- "C:\\ruta\\manifiesto1.pdf" "C:\\ruta\\manifiesto2.pdf" ...',
  );
  process.exit(1);
}

let allOk = true;

for (const [index, file] of files.entries()) {
  console.log();
  console.log(`=== VARIANTE ${index + 1} ===`);
  console.log(`Archivo: ${file}`);

  try {
    const pdf = await extractPdfTextFromFile(file);
    const extraction = parseManifestText(pdf.text);
    const summary = summarizeConfidence(extraction);

    console.log(`Páginas PDF: ${pdf.pageCount}`);
    console.log("Páginas usadas por parser: 1");
    console.log(`Manifesto: ${extraction.manifest.manifestNumber.value ?? "N/A"}`);
    console.log(`Autorización: ${extraction.manifest.authorizationNumber.value ?? "N/A"}`);
    console.log(`Placa: ${extraction.vehicle.plate.value ?? "N/A"}`);
    console.log(`Remesa: ${extraction.cargo.remittanceNumber.value ?? "N/A"}`);
    console.log(`Remitente: ${extraction.sender.identificationNumber.value ?? "N/A"}`);
    console.log(`Destinatario: ${extraction.recipient.identificationNumber.value ?? "N/A"}`);
    console.log(`Confianza campos >95%: ${summary.autoSave}/${summary.total}`);

    const critical = [
      ["manifest.manifestNumber", extraction.manifest.manifestNumber.value],
      ["manifest.authorizationNumber", extraction.manifest.authorizationNumber.value],
      ["manifest.issueDate", extraction.manifest.issueDate.value],
      ["vehicle.plate", extraction.vehicle.plate.value],
      ["vehicle.soatPolicyNumber", extraction.vehicle.soatPolicyNumber.value],
      ["cargo.remittanceNumber", extraction.cargo.remittanceNumber.value],
      ["sender.identificationNumber", extraction.sender.identificationNumber.value],
      ["recipient.identificationNumber", extraction.recipient.identificationNumber.value],
    ];

    const missing = critical.filter(([, value]) => value === null).map(([path]) => path);
    if (missing.length) {
      console.log(`Campos críticos faltantes: ${missing.join(", ")}`);
      console.log("Resultado: REVIEW_REQUIRED");
      allOk = false;
    } else {
      console.log("Resultado: OK");
    }
  } catch (error) {
    allOk = false;
    console.error("Resultado: ERROR");
    console.error(error);
  }
}

console.log();
console.log("========================================");
console.log(allOk ? "TODAS LAS VARIANTES: OK" : "HAY VARIANTES QUE REQUIEREN REVISIÓN");
console.log("========================================");

process.exit(allOk ? 0 : 1);
