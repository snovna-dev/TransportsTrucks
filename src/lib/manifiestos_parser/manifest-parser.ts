import { ManifestExtractionSchema } from "../../schemas/manifest-extraction.schema";
import type {
  ExtractedField,
  ManifestExtraction,
  ManifestSection,
} from "../../types/manifest-extraction";
import {
  findLine,
  normalizeLine,
  parseSections,
  splitLayoutColumns,
  type ParsedLine,
} from "./section-parser";

const SOURCE = "PDF_TEXT" as const;

function emptyField<T>(section: ManifestSection): ExtractedField<T> {
  return {
    value: null,
    confidence: 0,
    source: SOURCE,
    section,
    matchedLabel: null,
  };
}

function field<T>(
  value: T | null,
  section: ManifestSection,
  confidence: number,
  matchedLabel: string,
): ExtractedField<T> {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim().length === 0)
  ) {
    return emptyField(section);
  }

  return {
    value,
    confidence: Math.max(0, Math.min(1, confidence)),
    source: SOURCE,
    section,
    matchedLabel,
  };
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseDate(value: string | null | undefined): string | null {
  if (!value) return null;

  const match = clean(value).match(/^(\d{2})[-/.](\d{2})[-/.](\d{4})$/);
  if (!match) return null;

  return `${match[3]}-${match[2]}-${match[1]}`;
}

function parseMoney(value: string | null | undefined): number | null {
  if (!value) return null;

  let normalized = clean(value)
    .replace(/\$/g, "")
    .replace(/\s/g, "");

  if (!normalized) return null;

  if (normalized.includes(",") && normalized.includes(".")) {
    if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
      normalized = normalized.replace(/\./g, "").replace(/,/g, ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if ((normalized.match(/\./g) ?? []).length > 1) {
    normalized = normalized.replace(/\./g, "");
  } else if ((normalized.match(/,/g) ?? []).length > 1) {
    normalized = normalized.replace(/,/g, "");
  } else if (normalized.includes(",")) {
    const parts = normalized.split(",");
    const last = parts[parts.length - 1] ?? "";

    // Currency in the source PDF uses comma as thousands separator
    // (`12,500`, `875,258`). Treat a one-comma value with a 3-digit
    // final group as thousands; otherwise allow comma decimals.
    normalized =
      last.length === 3
        ? parts.join("")
        : `${parts.slice(0, -1).join("")}.${last}`;
  }

  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

function exactField<T>(
  value: T | null,
  section: ManifestSection,
  label: string,
  confidence = 0.99,
): ExtractedField<T> {
  return field(value, section, confidence, label);
}


function looksLikePersonName(value: string): boolean {
  const normalized = normalizeLine(value);
  if (!normalized) return false;

  return (
    normalized.split(/\s+/).length >= 2 &&
    /^[A-ZÑ.' -]+$/.test(normalized) &&
    !/(CALLE|CARRERA|DIAG|AVENIDA|IBAGUE|MEDELLIN|BOGOTA|CALI|BUENAVENTURA)/.test(normalized)
  );
}

function emptyPerson(section: "SENDER" | "RECIPIENT") {
  return {
    identificationNumber: emptyField<string>(section),
    name: emptyField<string>(section),
  };
}

function lineIndexAfter(
  lines: ParsedLine[],
  predicate: (line: ParsedLine) => boolean,
): number {
  return lines.findIndex(predicate);
}

function findLineContaining(
  lines: ParsedLine[],
  phrase: string,
  start = 0,
): ParsedLine | undefined {
  const target = normalizeLine(phrase);
  return lines
    .slice(start)
    .find((line) => line.normalized.includes(target));
}

function linesAfter(
  lines: ParsedLine[],
  start: number,
  count: number,
): ParsedLine[] {
  return lines.slice(start + 1, start + 1 + count);
}

function parseCompany(lines: ParsedLine[]): ManifestExtraction["company"] {
  const section: ManifestSection = "HEADER";
  const titleIndex = lineIndexAfter(
    lines,
    (line) => line.normalized === "MANIFIESTO ELECTRONICO DE CARGA",
  );

  const start = titleIndex >= 0 ? titleIndex : 0;
  const block = lines.slice(start, Math.min(lines.length, start + 14));

  const companyNameLine = block.find((line, index) => {
    if (index < 1) return false;
    return /(?:S\.A\.|SAS|LTDA)/i.test(line.raw);
  });

  const nitLine = block.find((line) => /^NIT\s*:/i.test(line.raw.trim()));
  const addressLineIndex = block.findIndex((line) => /^DIRECCION\s*:/i.test(line.raw.trim()));
  const cityLine = block.find((line) =>
    splitLayoutColumns(line.raw).some((value) => /^CIUDAD\s*:/i.test(value)),
  );
  const phoneLine = block.find((line) =>
    splitLayoutColumns(line.raw).some((value) => /^TELEFONO\s*:/i.test(value)),
  );

  const getColumnValue = (line: ParsedLine | undefined, label: RegExp): string | null => {
    if (!line) return null;
    const column = splitLayoutColumns(line.raw).find((value) => label.test(value));
    if (!column) return null;
    return column.replace(label, "").replace(/^:/, "").trim() || null;
  };

  let address: string | null = null;
  if (addressLineIndex >= 0) {
    const firstColumn = splitLayoutColumns(block[addressLineIndex].raw)[0] ?? "";
    const first = firstColumn.replace(/^DIRECCION\s*:\s*/i, "").trim();
    const continuation = block
      .slice(addressLineIndex + 1, addressLineIndex + 5)
      .find((line) => /^BLOQUE\b/i.test(line.raw.trim()));
    address = clean([first, continuation?.raw.trim()].filter(Boolean).join(" ")) || null;
  }

  const nit = nitLine?.raw.trim().match(/^NIT\s*:\s*([^\s]+)/i)?.[1] ?? null;
  const city = getColumnValue(cityLine, /^CIUDAD\s*:/i);
  const phone = getColumnValue(phoneLine, /^TELEFONO\s*:/i);

  return {
    nit: exactField(nit, section, "NIT", nit ? 0.99 : 0),
    name: exactField(
      companyNameLine ? clean(companyNameLine.raw) : null,
      section,
      "Nombre de la empresa",
      companyNameLine ? 0.99 : 0,
    ),
    address: exactField(address, section, "Direccion", address ? 0.98 : 0),
    phone: exactField(phone, section, "Telefono", phone ? 0.99 : 0),
    city: exactField(city, section, "Ciudad", city ? 0.98 : 0),
  };
}

function parseIdentity(lines: ParsedLine[]) {
  const section: ManifestSection = "HEADER";
  const manifestIndex = lines.findIndex((line) => /MANIFIESTO\s*:/i.test(line.raw));
  const authorizationIndex = lines.findIndex((line) => /AUTORIZACION\s*:/i.test(line.raw));

  const directValue = (index: number, label: RegExp): string | null => {
    if (index < 0) return null;
    const current = lines[index].raw.match(new RegExp(label.source + "\\s*:?[\\s]*([A-Z0-9-]+)", label.flags));
    return current?.[1] ?? null;
  };

  const manifest = manifestIndex >= 0
    ? directValue(manifestIndex, /MANIFIESTO/i)
    : null;

  let authorization = authorizationIndex >= 0
    ? directValue(authorizationIndex, /AUTORIZACION/i)
    : null;

  // In this PDF the authorization label and value can be placed on adjacent
  // visual lines. Search the small header neighborhood for an isolated ID.
  if (!authorization && authorizationIndex >= 0) {
    const nearby = lines.slice(Math.max(0, authorizationIndex - 2), authorizationIndex + 3);
    const candidates = nearby.flatMap((line) => line.raw.match(/\b\d{8,12}\b/g) ?? []);
    authorization = candidates[candidates.length - 1] ?? null;
  }

  return {
    manifestNumber: exactField(manifest, section, "Manifiesto", manifest ? 0.99 : 0),
    authorizationNumber: exactField(
      authorization,
      section,
      "Autorizacion",
      authorization ? 0.99 : 0,
    ),
  };
}

function parseManifestInformation(lines: ParsedLine[]): Pick<
  ManifestExtraction["manifest"],
  "manifestNumber" | "authorizationNumber" | "issueDate" | "manifestType" | "origin" | "intermediateCity" | "destination"
> {
  const section: ManifestSection = "MANIFEST_INFORMATION";
  const identity = parseIdentity(lines);

  const headerIndex = lineIndexAfter(
    lines,
    (line) =>
      line.normalized.includes("FECHA EXPED") &&
      line.normalized.includes("TIPO MANIFIESTO") &&
      line.normalized.includes("ORIGEN DEL VIAJE"),
  );

  const row = headerIndex >= 0 ? lines[headerIndex + 1] : undefined;
  const values = row ? splitLayoutColumns(row.raw) : [];

  const issueDate = parseDate(values[0]);
  const manifestType = values[1] ?? null;
  const origin = values[2] ?? null;
  const destination = values[3] ?? null;

  return {
    ...identity,
    issueDate: exactField(issueDate, section, "Fecha Exped (Dia/mes/Año)", issueDate ? 0.99 : 0),
    manifestType: exactField(manifestType, section, "Tipo Manifiesto", manifestType ? 0.99 : 0),
    origin: exactField(origin, section, "Origen del Viaje", origin ? 0.99 : 0),
    intermediateCity: emptyField(section),
    destination: exactField(destination, section, "Destino del Viaje", destination ? 0.99 : 0),
  };
}

function parseHeaderPersonRow(
  row: ParsedLine | undefined,
  section: "VEHICLE_AND_DRIVER" | "VEHICLE_HOLDER",
  nameLabel: string,
): ManifestExtraction["manifestHolder"] {
  if (!row) {
    return {
      identificationNumber: emptyField(section),
      fullName: emptyField(section),
      address: emptyField(section),
      phone: emptyField(section),
      city: emptyField(section),
    };
  }

  const values = splitLayoutColumns(row.raw);
  const identification = values.find((value) => /^\d{7,12}$/.test(clean(value))) ?? null;
  const city = values.find((value) => /^(IBAGUE|MEDELLIN|BOGOTA|CALI|BUENAVENTURA|BARRANQUILLA)$/i.test(clean(value))) ?? null;
  const address = values.find((value) => /\b(CALLE|CARRERA|DIAG|AVENIDA)\b/i.test(value)) ?? null;
  const name = values.find((value) => looksLikePersonName(value)) ?? null;

  return {
    identificationNumber: exactField(
      identification,
      section,
      "Docto de Identificacion No.",
      identification ? 0.99 : 0,
    ),
    fullName: exactField(name, section, nameLabel, name ? 0.99 : 0),
    address: exactField(address ? clean(address) : null, section, "Direccion", address ? 0.97 : 0),
    phone: emptyField(section),
    city: exactField(city ? clean(city) : null, section, "Ciudad y Departamento", city ? 0.97 : 0),
  };
}

function parseVehicleAndPeople(lines: ParsedLine[]) {
  const vehicleSection: ManifestSection = "VEHICLE_AND_DRIVER";
  const driverSection: ManifestSection = "DRIVER";
  const holderSection: ManifestSection = "VEHICLE_HOLDER";

  const vehicleHeaderIndex = lineIndexAfter(
    lines,
    (line) =>
      line.normalized.includes("PLACA") &&
      line.normalized.includes("MARCA") &&
      line.normalized.includes("PESO VACIO"),
  );

  const vehicleRows = vehicleHeaderIndex >= 0 ? lines.slice(vehicleHeaderIndex + 1, vehicleHeaderIndex + 3) : [];
  const vehicleText = vehicleRows.map((line) => line.raw).join(" ");

  const plate = vehicleText.match(/\b[A-Z]{3}\d{3}\b/)?.[0] ?? null;
  const semiTrailerPlate = vehicleText.match(/\b[A-Z]\d{5}\b/)?.[0] ?? null;
  const configuration = vehicleText.match(/\b\d[A-Z]\d\b/)?.[0] ?? null;
  const weight = vehicleText.match(/\b(\d[\d,.]*)\s+KGS?\b/i)?.[1] ?? null;
  const policy = vehicleText.match(/\b\d{10,15}\b/)?.[0] ?? null;
  const insurer = vehicleText.match(/\b[A-Z][A-Z ]*SEGUROS(?: SA)?\b/i)?.[0] ?? null;
  const soatDate = vehicleText.match(/\b\d{2}-\d{2}-\d{4}\b/)?.[0] ?? null;
  const brand = vehicleText.match(/\b(CHEVROLET|KENWORTH|VOLVO|SCANIA|MACK|HINO|FREIGHTLINER|INTERNATIONAL)\b/i)?.[1] ?? null;

  const holderTitleIndex = lineIndexAfter(lines, (line) => line.normalized.includes("TITULAR MANIFIESTO"));
  const driverTitleIndex = lineIndexAfter(lines, (line) => line.normalized.startsWith("CONDUCTOR") && line.normalized.includes("DOCTO"));
  const vehicleHolderTitleIndex = lineIndexAfter(lines, (line) => line.normalized.includes("POSEEDOR O TENEDOR DEL VEHICULO"));

  const holderRow = holderTitleIndex >= 0 ? lines[holderTitleIndex + 1] : undefined;
  const driverRows = driverTitleIndex >= 0 ? lines.slice(driverTitleIndex + 1, driverTitleIndex + 3) : [];
  const vehicleHolderRow = vehicleHolderTitleIndex >= 0 ? lines[vehicleHolderTitleIndex + 1] : undefined;

  const manifestHolder = parseHeaderPersonRow(holderRow, "VEHICLE_AND_DRIVER", "Titular Manifiesto");
  const vehicleHolder = parseHeaderPersonRow(vehicleHolderRow, holderSection, "Poseedor o Tenedor del Vehiculo");

  const driverText = driverRows.map((line) => line.raw).join(" ");
  const driverIdentification = driverText.match(/\b\d{7,12}\b(?!-)/)?.[0] ?? null;
  const licenseCategory = driverText.match(/\b\d{7,12}-[A-Z0-9]+\b/)?.[0] ?? null;
  const driverCity = driverText.match(/\b(IBAGUE|MEDELLIN|BOGOTA|CALI|BUENAVENTURA|BARRANQUILLA)\b/i)?.[1] ?? null;
  const driverAddress = driverText.match(/\b((?:CALLE|CARRERA|DIAG|AVENIDA)\s+.*?)(?=\s+\b(?:IBAGUE|MEDELLIN|BOGOTA|CALI|BUENAVENTURA|BARRANQUILLA)\b|$)/i)?.[1] ?? null;
  const driverName = driverText.match(/\b([A-ZÑ]+(?:\s+[A-ZÑ]+){2,5})\s+\d{7,12}\b/i)?.[1] ?? null;

  const driver = {
    identificationNumber: exactField(driverIdentification, driverSection, "Docto. de Identificacion No.", driverIdentification ? 0.99 : 0),
    fullName: exactField(driverName ? clean(driverName) : null, driverSection, "Conductor", driverName ? 0.99 : 0),
    licenseCategory: exactField(licenseCategory, driverSection, "CAT. LIC. CONDUCCION", licenseCategory ? 0.99 : 0),
    address: exactField(driverAddress ? clean(driverAddress) : null, driverSection, "Direccion", driverAddress ? 0.96 : 0),
    phone: emptyField(driverSection),
    city: exactField(driverCity ? clean(driverCity) : null, driverSection, "Ciudad y Departamento", driverCity ? 0.97 : 0),
  } satisfies ManifestExtraction["driver"];

  const footerPhone = lines.find((line) => /Cel\.\s*Cond\.\s*:/i.test(line.raw))?.raw.match(/Cel\.\s*Cond\.\s*:\s*(\d{10})/i)?.[1] ?? null;
  if (footerPhone) {
    driver.phone = exactField(footerPhone, driverSection, "Cel. Cond.", 0.99);
  }

  return {
    vehicle: {
      plate: exactField(plate, vehicleSection, "Placa", plate ? 0.99 : 0),
      brand: exactField(brand ? clean(brand) : null, vehicleSection, "Marca", brand ? 0.99 : 0),
      semiTrailerPlate: exactField(semiTrailerPlate, vehicleSection, "Placa Semiremolque", semiTrailerPlate ? 0.99 : 0),
      configuration: exactField(configuration, vehicleSection, "Configuracion", configuration ? 0.99 : 0),
      emptyWeight: exactField(weight ? parseMoney(weight) : null, vehicleSection, "Peso Vacio", weight ? 0.99 : 0),
      soatPolicyNumber: exactField(policy, vehicleSection, "N° Poliza SOAT", policy ? 0.99 : 0),
      soatInsuranceCompany: exactField(insurer ? clean(insurer) : null, vehicleSection, "Cia. Segura SOAT", insurer ? 0.99 : 0),
      soatExpirationDate: exactField(soatDate ? parseDate(soatDate) : null, vehicleSection, "Vencimiento SOAT", soatDate ? 0.99 : 0),
    },
    manifestHolder,
    driver,
    vehicleHolder,
  };
}

function parsePartyCell(value: string | null): { id: string | null; name: string | null } {
  if (!value) return { id: null, name: null };
  const match = clean(value).match(/^(\d{7,12})\s+(.+)$/);
  if (!match) return { id: null, name: clean(value) || null };
  return { id: match[1], name: match[2].trim() || null };
}

function parseCargoAndParties(lines: ParsedLine[]) {
  const cargoSection: ManifestSection = "CARGO";
  const cargoHeaderIndex = lineIndexAfter(
    lines,
    (line) => line.normalized === "INFORMACION DE LA MERCANCIA TRANSPORTADA",
  );

  const cargoRows = cargoHeaderIndex >= 0
    ? lines.slice(cargoHeaderIndex + 1, cargoHeaderIndex + 9)
    : [];

  const dataRow = cargoRows.find(
    (line) => /\b\d{5,8}\b/.test(line.raw) && /KILOGRAMOS|KGS/i.test(line.raw),
  );

  const nextCargoLine = dataRow
    ? lines[dataRow.index + 1]
    : undefined;
  const values = dataRow ? splitLayoutColumns(dataRow.raw) : [];

  const remittance = values.find((value) => /^\d{5,8}$/.test(clean(value))) ?? null;
  const unit = values.find((value) => /^(KILOGRAMOS|KGS)$/i.test(clean(value))) ?? null;
  const quantityValue = values.find((value) => /^\d+[.,]\d+$/.test(clean(value))) ?? null;
  const productCode = values.find((value) => /^\d{4,8}$/.test(clean(value)) && clean(value) !== remittance) ?? null;

  const natureBase = values.find((value) => /^CARGA$/i.test(clean(value))) ?? null;
  const natureContinuation = nextCargoLine && /^GENERAL\b/i.test(nextCargoLine.raw.trim()) ? "GENERAL" : null;
  const nature = [natureBase, natureContinuation].filter(Boolean).join(" ") || null;

  const packagingBase = values.find((value) => /^\d+\s+C\s+\d+$/i.test(clean(value))) ?? null;
  const packagingWords = nextCargoLine && /\bPIES\b/i.test(nextCargoLine.raw) ? "Pies" : null;
  const packaging = packagingBase
    ? `${clean(packagingBase)}${packagingWords ? ` ${packagingWords}` : ""}`
    : null;

  const productStart = productCode ? values.indexOf(productCode) + 1 : -1;
  const partyStart = productStart >= 0
    ? values.findIndex((value, index) => index >= productStart && /^\d{7,12}\s+.+$/.test(clean(value)))
    : -1;
  const partyStart2 = partyStart >= 0
    ? values.findIndex((value, index) => index > partyStart && /^\d{7,12}\s+.+$/.test(clean(value)))
    : -1;

  const senderCell = partyStart >= 0 ? parsePartyCell(values[partyStart]) : { id: null, name: null };
  const recipientCell = partyStart2 >= 0 ? parsePartyCell(values[partyStart2]) : { id: null, name: null };

  const productTokens = productStart > 0
    ? values.slice(productStart, partyStart >= 0 ? partyStart : values.length)
    : [];
  const transportedProduct = productTokens.join(" ") || null;

  return {
    cargo: {
      remittanceNumber: exactField(remittance, cargoSection, "Numero de Remesa", remittance ? 0.99 : 0),
      measurementUnit: exactField(unit ? clean(unit).toUpperCase() : null, cargoSection, "Unidad de Medida", unit ? 0.99 : 0),
      quantity: exactField(quantityValue ? parseMoney(quantityValue) : null, cargoSection, "Cantidad", quantityValue ? 0.99 : 0),
      nature: exactField(nature, cargoSection, "Naturaleza", nature ? 0.99 : 0),
      packaging: exactField(packaging ? clean(packaging) : null, cargoSection, "Empaque", packaging ? 0.96 : 0),
      productCode: exactField(productCode, cargoSection, "Codigo de Producto", productCode ? 0.99 : 0),
      transportedProduct: exactField(transportedProduct, cargoSection, "Producto Transportado", transportedProduct ? 0.99 : 0),
    },
    sender: {
      identificationNumber: exactField(senderCell.id, "SENDER", "Nit / cc", senderCell.id ? 0.99 : 0),
      name: exactField(senderCell.name, "SENDER", "Nombre / Razon Social", senderCell.name ? 0.98 : 0),
    },
    recipient: {
      identificationNumber: exactField(recipientCell.id, "RECIPIENT", "Nit / cc", recipientCell.id ? 0.99 : 0),
      name: exactField(recipientCell.name, "RECIPIENT", "Nombre / Razon Social", recipientCell.name ? 0.98 : 0),
    },
    cargoOwner: emptyPerson("RECIPIENT"),
  };
}

function extractMoneyNearLabel(lines: ParsedLine[], label: RegExp): number | null {
  const index = lines.findIndex((line) => label.test(line.raw));
  if (index < 0) return null;

  const candidateIndexes = [index, index - 1, index + 1, index - 2, index + 2];
  for (const candidateIndex of candidateIndexes) {
    const line = lines[candidateIndex];
    if (!line) continue;
    const match = line.raw.match(/\$\s*([\d.,]+)/);
    if (match) return parseMoney(match[1]);
  }

  return null;
}

function columnValueAfterLabel(
  line: ParsedLine | undefined,
  label: RegExp,
  lines: ParsedLine[],
  lineIndex: number,
): string | null {
  if (!line) return null;

  const columns = splitLayoutColumns(line.raw);
  const index = columns.findIndex((column) => label.test(column));
  if (index >= 0 && columns[index + 1]) {
    return clean(columns[index + 1]);
  }

  const after = line.raw.replace(label, "").trim();
  if (after) return clean(after);

  return lines[lineIndex + 1]?.raw.trim() || null;
}

function extractPayment(lines: ParsedLine[]) {
  const section: ManifestSection = "PAYMENT";

  const totalIndex = lines.findIndex((line) => /VALOR\s+TOTAL\s+DEL\s+VIAJE/i.test(line.raw));
  const totalLine = totalIndex >= 0 ? lines[totalIndex] : undefined;
  const totalColumns = totalLine ? splitLayoutColumns(totalLine.raw) : [];

  const fechaIndex = totalColumns.findIndex((value) => /^FECHA$/i.test(clean(value)));
  const location = fechaIndex > 0
    ? totalColumns.slice(2, fechaIndex).find((value) => /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .'-]+$/i.test(value)) ?? null
    : null;

  const dateMatch = lines
    .slice(Math.max(0, totalIndex), Math.min(lines.length, totalIndex + 3))
    .flatMap((line) => line.raw.match(/\b\d{2}-\d{2}-\d{4}\b/g) ?? [])[0] ?? null;

  const loadingIndex = lines.findIndex((line) => /CARGUE\s+PAGADO\s+POR/i.test(line.raw));
  const unloadingIndex = lines.findIndex((line) => /DESCARGUE\s+PAGADO\s+POR/i.test(line.raw));
  const lettersIndex = lines.findIndex((line) => /VALOR\s+A\s+PAGAR\s+PACTADO\s+EN\s+LETRAS/i.test(line.raw));

  const loadingLine = loadingIndex >= 0 ? lines[loadingIndex] : undefined;
  const unloadingLine = unloadingIndex >= 0 ? lines[unloadingIndex] : undefined;
  const lettersLine = lettersIndex >= 0 ? lines[lettersIndex] : undefined;

  const loading = columnValueAfterLabel(loadingLine, /CARGUE\s+PAGADO\s+POR/i, lines, loadingIndex);
  const unloading = columnValueAfterLabel(unloadingLine, /DESCARGUE\s+PAGADO\s+POR/i, lines, unloadingIndex);

  let agreedWords: string | null = null;
  if (lettersLine) {
    const columns = splitLayoutColumns(lettersLine.raw);
    const index = columns.findIndex((column) => /VALOR\s+A\s+PAGAR\s+PACTADO\s+EN\s+LETRAS/i.test(column));
    agreedWords = index >= 0 ? columns[index + 1] ?? null : null;
  }

  return {
    totalTripValue: exactField(extractMoneyNearLabel(lines, /VALOR\s+TOTAL\s+DEL\s+VIAJE/i), section, "VALOR TOTAL DEL VIAJE", 0.99),
    withholdingTax: exactField(extractMoneyNearLabel(lines, /RETENCION\s+EN\s+LA\s+FUENTE/i), section, "RETENCION EN LA FUENTE", 0.99),
    icaWithholding: exactField(extractMoneyNearLabel(lines, /RETENCION\s+ICA/i), section, "RETENCION ICA", 0.99),
    netValueToPay: exactField(extractMoneyNearLabel(lines, /VALOR\s+NETO\s+A\s+PAGAR/i), section, "VALOR NETO A PAGAR", 0.99),
    advanceValue: exactField(extractMoneyNearLabel(lines, /VALOR\s+ANTICIPO/i), section, "VALOR ANTICIPO", 0.99),
    balanceToPay: exactField(extractMoneyNearLabel(lines, /SALDO\s+A\s+PAGAR/i), section, "SALDO A PAGAR", 0.99),
    paymentLocation: exactField(location, section, "LUGAR", location ? 0.99 : 0),
    paymentDate: exactField(dateMatch ? parseDate(dateMatch) : null, section, "FECHA", dateMatch ? 0.99 : 0),
    loadingPaidBy: exactField(loading, section, "CARGUE PAGADO POR", loading ? 0.99 : 0),
    unloadingPaidBy: exactField(unloading, section, "DESCARGUE PAGADO POR", unloading ? 0.99 : 0),
    agreedValueInWords: exactField(agreedWords ? clean(agreedWords) : null, section, "VALOR A PAGAR PACTADO EN LETRAS", agreedWords ? 0.99 : 0),
  };
}

function parseRecommendations(lines: ParsedLine[]): ExtractedField<string> {
  const section: ManifestSection = "RECOMMENDATIONS";
  // The actual PDF mixes this right-hand block with the payment block. We do
  // not guess its value from unrelated payment lines. It will be extracted in
  // a later region-aware pass if needed.
  return emptyField(section);
}

function buildExtraction(text: string): ManifestExtraction {
  const parsed = parseSections(text);
  const lines = parsed.lines;

  const company = parseCompany(lines);
  const manifestInfo = parseManifestInformation(lines);
  const people = parseVehicleAndPeople(lines);
  const cargoAndParties = parseCargoAndParties(lines);
  const payment = extractPayment(lines);
  const recommendations = parseRecommendations(lines);

  const extraction: ManifestExtraction = {
    company,
    manifest: {
      ...manifestInfo,
      ...payment,
      recommendations,
      policyOwnerName: emptyField("RECIPIENT"),
    },
    manifestHolder: people.manifestHolder,
    driver: people.driver,
    vehicleHolder: people.vehicleHolder,
    vehicle: people.vehicle,
    cargoOwner: cargoAndParties.cargoOwner,
    sender: cargoAndParties.sender,
    recipient: cargoAndParties.recipient,
    cargo: cargoAndParties.cargo,
  };

  return ManifestExtractionSchema.parse(extraction);
}

export function parseManifestText(text: string): ManifestExtraction {
  return buildExtraction(text);
}

export function tryParseManifestText(text: string) {
  try {
    const data = parseManifestText(text);
    return {
      success: true as const,
      data,
      errors: [],
    };
  } catch (error) {
    return {
      success: false as const,
      data: null,
      errors: [
        error instanceof Error
          ? error.message
          : "Error de validacion del manifiesto",
      ],
    };
  }
}

export function summarizeConfidence(extraction: ManifestExtraction) {
  const fields: Array<ExtractedField<unknown>> = [];

  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (
      "confidence" in value &&
      typeof (value as { confidence?: unknown }).confidence === "number"
    ) {
      fields.push(value as ExtractedField<unknown>);
      return;
    }

    Object.values(value).forEach(visit);
  };

  visit(extraction);

  const autoSave = fields.filter((field) => field.confidence > 0.95).length;
  const review = fields.filter(
    (field) => field.confidence >= 0.75 && field.confidence <= 0.95,
  ).length;
  const manual = fields.filter((field) => field.confidence < 0.75).length;

  return {
    total: fields.length,
    autoSave,
    review,
    manual,
  };
}

export function getFieldsForReview(extraction: ManifestExtraction) {
  const result: Array<{
    path: string;
    value: unknown;
    confidence: number;
    section: ManifestSection;
  }> = [];

  const visit = (value: unknown, path: string) => {
    if (!value || typeof value !== "object") return;

    if (
      "confidence" in value &&
      "value" in value &&
      "section" in value
    ) {
      const fieldValue = value as ExtractedField<unknown>;
      if (fieldValue.confidence <= 0.95) {
        result.push({
          path,
          value: fieldValue.value,
          confidence: fieldValue.confidence,
          section: fieldValue.section,
        });
      }
      return;
    }

    Object.entries(value).forEach(([key, child]) =>
      visit(child, path ? `${path}.${key}` : key),
    );
  };

  visit(extraction, "");
  return result;
}
