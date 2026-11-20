import type {
  ExtractedField,
  ManifestExtraction,
  ManifestSection,
} from "../../types/manifest-extraction";
import {
  cellText,
  findLabel,
  groupRows,
  readTable,
  valueBelow,
  valueRight,
  type GridItem,
  type TableCells,
} from "./layout-grid";

/**
 * Parsers por coordenadas para los formatos tabulares del RNDC:
 *
 * - "OPL": formato de OPL CARGA SAS (valores alineados a la izquierda de cada
 *   encabezado, remitente/destinatario en celdas de 3 renglones).
 * - "RNDC_B": formato usado por QUICK HELP S.A.S y TRANSPORTES PACAR S.A.S
 *   (valores centrados bajo el encabezado, fecha tipo 2024/ago/02).
 *
 * No dependen de valores concretos (placas, nombres): ubican cada dato por su
 * etiqueta y su posición, así que sirven para cualquier manifiesto con el mismo formato.
 */

const SOURCE = "PDF_TEXT" as const;
const HIGH = 0.99;
const DOUBTFUL = 0.8;

type Validator<T> = (value: T) => boolean;

function emptyField<T>(section: ManifestSection): ExtractedField<T> {
  return { value: null, confidence: 0, source: SOURCE, section, matchedLabel: null };
}

function field<T>(
  value: T | null | undefined,
  section: ManifestSection,
  label: string,
  validate?: Validator<T>,
): ExtractedField<T> {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    return emptyField(section);
  }
  const confidence = validate && !validate(value) ? DOUBTFUL : HIGH;
  return { value, confidence, source: SOURCE, section, matchedLabel: label };
}

// ---------- Validadores ----------
const isPlate: Validator<string> = (v) => /^[A-Z]{3}\d{3}$/.test(v);
const isTrailerPlate: Validator<string> = (v) => /^[A-Z]{1,2}\d{4,5}$/.test(v);
const isId: Validator<string> = (v) => /^\d{5,12}(-\d)?$/.test(v);
const isNit: Validator<string> = (v) => /^\d{6,12}(-?\d)?$/.test(v);
const isDigits: Validator<string> = (v) => /^\d{5,15}$/.test(v);
const isNumber: Validator<number> = (v) => Number.isFinite(v) && v >= 0;

// ---------- Conversión de valores ----------
const MONTHS: Record<string, number> = {
  ENE: 1, JAN: 1, FEB: 2, MAR: 3, ABR: 4, APR: 4, MAY: 5, JUN: 6, JUL: 7,
  AGO: 8, AUG: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12, DEC: 12,
};

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Acepta 2026-02-07, 2025/05/15, 2024/ago/02, 07-02-2026 y 7/2/2026 (día/mes/año). */
export function parseFlexibleDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  let m = v.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = v.match(/(\d{4})[/-]([A-Za-zÁÉÍÓÚáéíóú]{3})[A-Za-z]*[/-](\d{1,2})/);
  if (m) {
    const month = MONTHS[m[2]!.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")];
    return month ? isoDate(Number(m[1]), month, Number(m[3])) : null;
  }
  m = v.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return isoDate(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

/** Valores en pesos: "$ 3.130.000,00", "1.800.002,00", "$1,250,000". */
export function parseMoneyValue(value: string | null | undefined): number | null {
  if (!value) return null;
  let v = value.replace(/[$\s]/g, "");
  if (!/^[\d.,]+$/.test(v)) return null;
  if (v.includes(",") && v.includes(".")) {
    v = v.lastIndexOf(",") > v.lastIndexOf(".") ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
  } else if (v.includes(",")) {
    const parts = v.split(",");
    v = parts.length === 2 && parts[1]!.length === 2 ? `${parts[0]}.${parts[1]}` : parts.join("");
  } else if ((v.match(/\./g) ?? []).length > 1 || /\.\d{3}$/.test(v)) {
    v = v.replace(/\./g, "");
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Cantidades y pesos con punto de miles: "32.000" → 32000, "12000" → 12000, "4.600" → 4600. */
export function parseQuantityValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.replace(/\s/g, "").match(/[\d.,]+/);
  if (!match) return null;
  let v = match[0];
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(v)) v = v.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(v)) v = v.replace(/,/g, "");
  else v = v.replace(",", ".");
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clean(value: string | null | undefined): string | null {
  const result = value?.replace(/\s+/g, " ").trim();
  return result ? result : null;
}

function firstNumber(value: string | null): string | null {
  return value?.match(/\d{5,15}(-\d)?/)?.[0] ?? null;
}

const MONEY = /^\$?\s*[\d.,]+$/;

function valueAbove(items: GridItem[], label: GridItem | undefined, maxDy = 16): GridItem | undefined {
  if (!label) return undefined;
  return items
    .filter((item) => item.y - label.y > 1.5 && item.y - label.y <= maxDy && item.x < label.x2 && item.x2 > label.x)
    .sort((a, b) => a.y - b.y)[0];
}

function inlineOrRight(
  items: GridItem[],
  labelPattern: RegExp,
  inlinePattern: RegExp,
  options: { maxDy?: number; pattern?: RegExp; belowY?: number } = {},
): string | null {
  const label = findLabel(items, labelPattern, { belowY: options.belowY });
  if (!label) {
    const inline = items.find((item) => inlinePattern.test(item.norm) && (options.belowY === undefined || item.y < options.belowY));
    const match = inline?.text.match(/:\s*(.+)$/);
    return clean(match?.[1]);
  }
  return clean(valueRight(items, label, { maxDy: options.maxDy, pattern: options.pattern })?.text);
}

// ---------- Bloque de valores (común a ambos formatos) ----------
function readPayment(items: GridItem[]) {
  const heading = findLabel(items, /^(VALOR DEL VIAJE|VALORES)$/);
  const belowY = heading ? heading.y + 1 : undefined;
  const money = (pattern: RegExp) => {
    const label = findLabel(items, pattern, { belowY });
    return parseMoneyValue(valueRight(items, label, { pattern: MONEY })?.text);
  };
  const below = (pattern: RegExp, valuePattern?: RegExp) =>
    clean(valueBelow(items, findLabel(items, pattern, { belowY }), { pattern: valuePattern })?.text);
  // "Remitente", "Destinatario", "Empresa de transporte"...: texto corto, sin párrafos legales.
  const PAID_BY = /^[A-Za-zÁÉÍÓÚÑáéíóúñ. ]{3,40}$/;

  const dateLabel = findLabel(items, /^FECHA:?$/, { belowY });
  const dateItem =
    valueRight(items, dateLabel, { pattern: /\d{4}[/-]/ }) ??
    valueBelow(items, dateLabel);

  const wordsLabel = findLabel(items, /^VALOR (A PAGAR PACTADO|TOTAL DEL VIAJE) EN LETRAS:?$/);
  const words = clean(valueRight(items, wordsLabel, { maxDy: 3, maxDx: 400 })?.text);

  const observations = findLabel(items, /^(OBSERVACIONES|RECOMENDACIONES)$/, { belowY });
  const notes = observations
    ? clean(
        items
          .filter(
            (item) =>
              // El título suele ir centrado: el texto empieza hasta 100 pt a su izquierda.
              item.x >= observations.x - 100 &&
              item.y < observations.y - 1 &&
              item.y > observations.y - 50 &&
              item.text.length <= 150 &&
              !/:$/.test(item.text) &&
              !/^[\s,.]*$/.test(item.text) &&
              !/^\$?\s*[\d.,/ -]+$/.test(item.text),
          )
          .map((item) => item.text)
          .join(" "),
      )
    : null;

  const section: ManifestSection = "PAYMENT";
  return {
    totalTripValue: field(money(/^VALOR TOTAL (DEL )?VIAJE$/), section, "Valor total del viaje", isNumber),
    withholdingTax: field(money(/^RETENCION EN LA FUENTE$/), section, "Retención en la fuente", isNumber),
    icaWithholding: field(money(/^RETENCION ICA$/), section, "Retención ICA", isNumber),
    netValueToPay: field(money(/^VALOR NETO A PAGAR$/), section, "Valor neto a pagar", isNumber),
    advanceValue: field(money(/^VALOR ANTICIPO$/), section, "Valor anticipo", isNumber),
    balanceToPay: field(money(/^SALDO A PAGAR$/), section, "Saldo a pagar", isNumber),
    paymentLocation: field(below(/^LUGAR:?$/), section, "Lugar"),
    paymentDate: field(parseFlexibleDate(dateItem?.text), section, "Fecha"),
    loadingPaidBy: field(below(/^CARGUE PAGADO POR:?$/, PAID_BY), section, "Cargue pagado por"),
    unloadingPaidBy: field(below(/^DESCARGUE PAGADO POR:?$/, PAID_BY), section, "Descargue pagado por"),
    agreedValueInWords: field(words, section, "Valor en letras"),
    recommendations: field(notes, "RECOMMENDATIONS" as ManifestSection, "Observaciones"),
  };
}

type PersonCells = TableCells<"name" | "id" | "address" | "phone" | "city" | "license">;

const TRAILING_PHONES = /\s+(\d{7,10}(?:\s*(?:\/|--?)\s*\d{7,10})*)$/;

function person(cells: PersonCells, section: ManifestSection) {
  let address = clean(cellText(cells.address));
  let phone = clean(cellText(cells.phone));
  // Algunos PDF unen dirección y teléfono en un solo bloque de texto.
  const trailing = !phone && address ? address.match(TRAILING_PHONES) : null;
  if (trailing) {
    phone = trailing[1]!;
    address = clean(address!.slice(0, trailing.index));
  }
  return {
    identificationNumber: field(firstNumber(cellText(cells.id)), section, "No. Identificación", isId),
    fullName: field(clean(cellText(cells.name)), section, "Nombre"),
    address: field(address, section, "Dirección"),
    phone: field(phone, section, "Teléfono"),
    city: field(clean(cellText(cells.city)), section, "Ciudad"),
  };
}

function finish(input: {
  company: ManifestExtraction["company"];
  manifest: Omit<ManifestExtraction["manifest"], keyof ReturnType<typeof readPayment>>;
  payment: ReturnType<typeof readPayment>;
  holder: PersonCells;
  driver: PersonCells;
  vehicleHolder: PersonCells;
  vehicle: ManifestExtraction["vehicle"];
  sender: { id: string | null; name: string | null };
  recipient: { id: string | null; name: string | null };
  cargo: ManifestExtraction["cargo"];
}): ManifestExtraction {
  const holder = person(input.holder, "VEHICLE_AND_DRIVER");
  const driver = person(input.driver, "DRIVER");
  return {
    company: input.company,
    manifest: { ...input.manifest, ...input.payment },
    manifestHolder: holder,
    driver: {
      identificationNumber: driver.identificationNumber,
      fullName: driver.fullName,
      licenseCategory: field(clean(cellText(input.driver.license)), "DRIVER", "Licencia"),
      address: driver.address,
      phone: driver.phone,
      city: driver.city,
    },
    vehicleHolder: person(input.vehicleHolder, "VEHICLE_HOLDER"),
    vehicle: input.vehicle,
    cargoOwner: {
      identificationNumber: emptyField("RECIPIENT"),
      name: emptyField("RECIPIENT"),
    },
    sender: {
      identificationNumber: field(input.sender.id, "SENDER", "NIT/CC remitente", isNit),
      name: field(input.sender.name, "SENDER", "Nombre remitente"),
    },
    recipient: {
      identificationNumber: field(input.recipient.id, "RECIPIENT", "NIT/CC destinatario", isNit),
      name: field(input.recipient.name, "RECIPIENT", "Nombre destinatario"),
    },
    cargo: input.cargo,
  };
}

function readCompany(items: GridItem[]) {
  const nitLabel = items.find((item) => /^NIT\s*:/.test(item.norm));
  const nit = clean(nitLabel?.text.replace(/^NIT\s*:\s*/i, "").replace(/\./g, ""));
  const name = clean(valueAbove(items, nitLabel)?.text);
  const phoneItem = items.find((item) => /^(TEL|TELEFONO)\s*:\s*\d/.test(item.norm));
  const phone = clean(phoneItem?.text.replace(/^[^:]*:\s*/, ""));
  return { nitLabel, nit, name, phone, phoneItem };
}

// =====================================================================
// Formato OPL CARGA
// =====================================================================

export function isOplTemplate(items: GridItem[]): boolean {
  return Boolean(findLabel(items, /^INFO\.REMITENTE$/) && findLabel(items, /^NUMERO REMESA$/));
}

export function parseOplTemplate(items: GridItem[]): ManifestExtraction {
  const company = readCompany(items);
  const address = clean(valueRight(items, findLabel(items, /^DIRECCION:$/))?.text);

  const manifestNumber = inlineOrRight(items, /^MANIFIESTO:$/, /^MANIFIESTO:\s*\S/);
  const authorization = inlineOrRight(items, /^AUTORIZACION:$/, /^AUTORIZACION:\s*\S/, { pattern: /^\d+$/ });

  const info = readTable(
    items,
    findLabel(items, /^FECHA EXPEDICION/),
    [
      { key: "date", pattern: /^FECHA EXPEDICION/ },
      { key: "type", pattern: /^TIPO MANIFIESTO$/ },
      { key: "origin", pattern: /^ORIGEN/ },
      { key: "intermediate", pattern: /^CIUDAD INTERMEDIA/ },
      { key: "destination", pattern: /^DESTINO/ },
    ],
    { align: "left", depth: 12 },
  );

  const personColumns = [
    { key: "id" as const, pattern: /^NO\. IDENTIFICACION$/ },
    { key: "license" as const, pattern: /^CAT\. LIC/ },
    { key: "address" as const, pattern: /^DIRECCION$/ },
    { key: "phone" as const, pattern: /^TELEFONO/ },
    { key: "city" as const, pattern: /^CIUDAD/ },
  ];
  const holder = readTable(items, findLabel(items, /^TITULAR MANIFIESTO$/), [{ key: "name", pattern: /^TITULAR MANIFIESTO$/ }, ...personColumns], { align: "left", depth: 12 });
  const driver = readTable(items, findLabel(items, /^CONDUCTOR$/), [{ key: "name", pattern: /^CONDUCTOR$/ }, ...personColumns], { align: "left", depth: 12 });
  const vehicleHolder = readTable(items, findLabel(items, /^POSEEDOR O TENEDOR/), [{ key: "name", pattern: /^POSEEDOR O TENEDOR/ }, ...personColumns], { align: "left", depth: 12 });

  const vehicle = readTable(
    items,
    findLabel(items, /^PLACA$/),
    [
      { key: "plate", pattern: /^PLACA$/ },
      { key: "brand", pattern: /^MARCA$/ },
      { key: "semi", pattern: /^PLACA SEMI/ },
      { key: "config", pattern: /^CONFIGURACION$/ },
      { key: "empty", pattern: /^PESO VACIO$/ },
      { key: "trailerWeight", pattern: /^PESO V\. REMOLQUE$/ },
      { key: "policy", pattern: /^POLIZA SOAT$/ },
      { key: "insurer", pattern: /^CIA\. SEGURA/ },
      { key: "expiration", pattern: /^VCTO\. SOAT$/ },
    ],
    { align: "left", depth: 12 },
  );

  const cargoAnchor = findLabel(items, /^NUMERO REMESA$/);
  const paymentHeading = findLabel(items, /^VALOR DEL VIAJE$/);
  const cargo = readTable(
    items,
    cargoAnchor,
    [
      { key: "remittance", pattern: /^NUMERO REMESA$/ },
      { key: "unit", pattern: /^UNIDAD-MEDIDA$/ },
      { key: "quantity", pattern: /^CANTIDAD/ },
      { key: "nature", pattern: /^NATURALEZA$/ },
      { key: "packaging", pattern: /^EMPAQUE$/ },
      { key: "code", pattern: /^CODIGO PRODUCTO$/ },
      { key: "description", pattern: /^DESCRIPCION PRODUCTO$/ },
      { key: "sender", pattern: /^NIT \/ CC$/ },
      { key: "recipient", pattern: /^NIT \/ CC$/ },
      { key: "owner", pattern: /^DUENO POLIZA$/ },
    ],
    {
      align: "left",
      depth: cargoAnchor && paymentHeading ? cargoAnchor.y - paymentHeading.y - 2 : 50,
      ignore: [/^NOMBRE \/ RAZON SOCIAL$/, /^DIRECCION$/],
    },
  );
  // Remitente y destinatario: renglón 1 = NIT/CC, renglón 2 = nombre, renglón 3 = dirección.
  const senderRows = cargo.sender ? groupRows(cargo.sender) : [];
  const recipientRows = cargo.recipient ? groupRows(cargo.recipient) : [];

  return finish({
    company: {
      nit: field(company.nit, "HEADER", "NIT", isNit),
      name: field(company.name, "HEADER", "Empresa"),
      address: field(address, "HEADER", "Dirección"),
      phone: field(company.phone, "HEADER", "Teléfono"),
      city: emptyField("HEADER"),
    },
    manifest: {
      manifestNumber: field(manifestNumber, "HEADER", "Manifiesto", isDigits),
      authorizationNumber: field(authorization, "HEADER", "Autorización", isDigits),
      issueDate: field(parseFlexibleDate(cellText(info.date)), "MANIFEST_INFORMATION", "Fecha Expedición"),
      manifestType: field(clean(cellText(info.type)), "MANIFEST_INFORMATION", "Tipo Manifiesto"),
      origin: field(clean(cellText(info.origin)), "MANIFEST_INFORMATION", "Origen Viaje"),
      intermediateCity: field(clean(cellText(info.intermediate)), "MANIFEST_INFORMATION", "Ciudad intermedia"),
      destination: field(clean(cellText(info.destination)), "MANIFEST_INFORMATION", "Destino Viaje"),
      policyOwnerName: field(clean(cellText(cargo.owner)), "RECIPIENT", "Dueño Póliza"),
    },
    payment: readPayment(items),
    holder,
    driver,
    vehicleHolder,
    vehicle: readVehicle(vehicle),
    sender: { id: firstNumber(senderRows[0] ?? null), name: clean(senderRows[1]) },
    recipient: { id: firstNumber(recipientRows[0] ?? null), name: clean(recipientRows[1]) },
    cargo: {
      remittanceNumber: field(clean(cellText(cargo.remittance)), "CARGO", "Número Remesa", isDigits),
      measurementUnit: field(clean(cellText(cargo.unit))?.toUpperCase(), "CARGO", "Unidad-Medida"),
      quantity: field(parseQuantityValue(cellText(cargo.quantity)), "CARGO", "Cantidad a Cargar", isNumber),
      nature: field(clean(cellText(cargo.nature)), "CARGO", "Naturaleza"),
      packaging: field(clean(cellText(cargo.packaging)), "CARGO", "Empaque"),
      productCode: field(clean(cellText(cargo.code)), "CARGO", "Código Producto"),
      transportedProduct: field(clean(cellText(cargo.description)), "CARGO", "Descripción producto"),
    },
  });
}

type VehicleCells = TableCells<"plate" | "brand" | "semi" | "config" | "empty" | "trailerWeight" | "policy" | "insurer" | "expiration">;

function readVehicle(cells: VehicleCells): ManifestExtraction["vehicle"] {
  const section: ManifestSection = "VEHICLE_AND_DRIVER";
  return {
    plate: field(clean(cellText(cells.plate))?.toUpperCase(), section, "Placa", isPlate),
    brand: field(clean(cellText(cells.brand)), section, "Marca"),
    semiTrailerPlate: field(clean(cellText(cells.semi))?.toUpperCase(), section, "Placa Semirremolque", isTrailerPlate),
    configuration: field(clean(cellText(cells.config)), section, "Configuración"),
    emptyWeight: field(parseQuantityValue(cellText(cells.empty)), section, "Peso Vacío", isNumber),
    soatPolicyNumber: field(clean(cellText(cells.policy)), section, "Póliza SOAT"),
    soatInsuranceCompany: field(clean(cellText(cells.insurer)), section, "Aseguradora SOAT"),
    soatExpirationDate: field(parseFlexibleDate(cellText(cells.expiration)), section, "Vencimiento SOAT"),
  };
}

// =====================================================================
// Formato RNDC "B" (QUICK HELP S.A.S, TRANSPORTES PACAR S.A.S, ...)
// =====================================================================

export function isRndcBTemplate(items: GridItem[]): boolean {
  return Boolean(findLabel(items, /^NRO\.REMESA$/) && findLabel(items, /^F\.VENCIM\/SOAT$/));
}

export function parseRndcBTemplate(items: GridItem[]): ManifestExtraction {
  const company = readCompany(items);
  const address = clean(valueBelow(items, company.nitLabel, { maxDy: 22, requireOverlap: true })?.text);
  const city = clean(valueBelow(items, company.phoneItem, { maxDy: 22, requireOverlap: true })?.text);

  const manifestNumber = inlineOrRight(items, /^MANIFIESTO:?$/, /^MANIFIESTO:\s*\S/, { maxDy: 6 });
  const authorization = inlineOrRight(items, /^AUTORIZACION:?$/, /^AUTORIZACION:?\s*\d/, { maxDy: 6, pattern: /^\d+$/ });

  const info = readTable(
    items,
    findLabel(items, /^FECHA DE EXPEDICION$/),
    [
      { key: "date", pattern: /^FECHA DE EXPEDICION$/ },
      { key: "type", pattern: /^TIPO MANIFIESTO$/ },
      { key: "origin", pattern: /^ORIGEN DEL VIAJE$/ },
      { key: "intermediate", pattern: /^CIUDAD INTERMEDIA/ },
      { key: "destination", pattern: /^DESTINO( FINAL)? DEL VIAJE$/ },
    ],
    { align: "overlap", depth: 12 },
  );

  const personColumns = [
    { key: "id" as const, pattern: /^DOCUMENTO$/ },
    { key: "address" as const, pattern: /^DIRECCION$/ },
    { key: "phone" as const, pattern: /^TELEFONO$/ },
    { key: "license" as const, pattern: /^NO\. DE LICENCIA$/ },
    { key: "city" as const, pattern: /^CIUDAD$/ },
  ];
  const holder = readTable(items, findLabel(items, /^TITULAR DEL MANIFIESTO$/), [{ key: "name", pattern: /^TITULAR DEL MANIFIESTO$/ }, ...personColumns], { align: "overlap", depth: 12 });
  const driver = readTable(items, findLabel(items, /^CONDUCTOR$/), [{ key: "name", pattern: /^CONDUCTOR$/ }, ...personColumns], { align: "overlap", depth: 12 });
  const vehicleHolder = readTable(items, findLabel(items, /^POSEEDOR O TENEDOR/), [{ key: "name", pattern: /^POSEEDOR O TENEDOR/ }, ...personColumns], { align: "overlap", depth: 12 });

  const vehicle = readTable(
    items,
    findLabel(items, /^PLACA$/),
    [
      { key: "plate", pattern: /^PLACA$/ },
      { key: "brand", pattern: /^MARCA$/ },
      { key: "semi", pattern: /^PLACA SEMI/ },
      { key: "config", pattern: /^CONFIGURACION$/ },
      { key: "empty", pattern: /^PESO VACIO$/ },
      { key: "trailerWeight", pattern: /^PESO ?VACIO ?REMOLQU/ },
      { key: "policy", pattern: /^NO\. POLIZA$/ },
      { key: "insurer", pattern: /SEGUROS SOAT$/ },
      { key: "expiration", pattern: /^F\.VENCIM/ },
    ],
    { align: "overlap", depth: 12 },
  );

  const cargoAnchor = findLabel(items, /^NRO\.REMESA$/);
  const paymentHeading = findLabel(items, /^VALORES$/);
  const cargo = readTable(
    items,
    cargoAnchor,
    [
      { key: "remittance", pattern: /^NRO\.REMESA$/ },
      { key: "unit", pattern: /^UNIDAD ?MEDIDA$/ },
      { key: "quantity", pattern: /^CANTIDAD$/ },
      { key: "nature", pattern: /^NATURALEZA$/ },
      { key: "product", pattern: /^EMPAQUE/ },
      { key: "senderId", pattern: /^NIT\/CC$/ },
      { key: "senderName", pattern: /^NOMBRE\/RAZON SOCIAL$/ },
      { key: "recipientId", pattern: /^NIT\/CC$/ },
      { key: "recipientName", pattern: /^NOMBRE\/RAZON SOCIAL$/ },
      { key: "owner", pattern: /^DUENO POLIZA$/ },
    ],
    {
      align: "overlap",
      depth: cargoAnchor && paymentHeading ? cargoAnchor.y - paymentHeading.y - 2 : 40,
      extraHeaders: items.filter((item) => /^DUENO POLIZA$/.test(item.norm)),
    },
  );

  // "Empaque - Producto Transportado": renglón 1 = empaque + código, siguientes = descripción.
  const productRows = cargo.product ? groupRows(cargo.product) : [];
  const firstRow = productRows[0]?.match(/^(.*?)\s*(\d{3,})\s*(.*)$/);
  const packaging = clean(firstRow ? firstRow[1] : productRows[0]);
  const productCode = firstRow ? firstRow[2]! : null;
  const description = clean(
    [firstRow?.[3] ?? "", ...productRows.slice(1)]
      .join(" ")
      .replace(/\bCONTENED\s+OR\b/gi, "CONTENEDOR")
      .replace(/^CONTENED\s+(?=CONTENEDOR\b)/i, ""),
  );

  return finish({
    company: {
      nit: field(company.nit, "HEADER", "NIT", isNit),
      name: field(company.name, "HEADER", "Empresa"),
      address: field(address, "HEADER", "Dirección"),
      phone: field(company.phone, "HEADER", "Teléfono"),
      city: field(city, "HEADER", "Ciudad"),
    },
    manifest: {
      manifestNumber: field(manifestNumber, "HEADER", "Manifiesto"),
      authorizationNumber: field(authorization, "HEADER", "Autorización", isDigits),
      issueDate: field(parseFlexibleDate(cellText(info.date)), "MANIFEST_INFORMATION", "Fecha de expedición"),
      manifestType: field(clean(cellText(info.type)), "MANIFEST_INFORMATION", "Tipo manifiesto"),
      origin: field(clean(cellText(info.origin)), "MANIFEST_INFORMATION", "Origen del viaje"),
      intermediateCity: field(clean(cellText(info.intermediate)), "MANIFEST_INFORMATION", "Ciudad intermedia"),
      destination: field(clean(cellText(info.destination)), "MANIFEST_INFORMATION", "Destino final del viaje"),
      policyOwnerName: field(clean(cellText(cargo.owner)), "RECIPIENT", "Dueño Póliza"),
    },
    payment: readPayment(items),
    holder,
    driver,
    vehicleHolder,
    vehicle: readVehicle(vehicle),
    sender: { id: firstNumber(cellText(cargo.senderId)), name: clean(cellText(cargo.senderName)) },
    recipient: { id: firstNumber(cellText(cargo.recipientId)), name: clean(cellText(cargo.recipientName)) },
    cargo: {
      remittanceNumber: field(clean(cellText(cargo.remittance)), "CARGO", "Nro.Remesa", isDigits),
      measurementUnit: field(clean(cellText(cargo.unit))?.toUpperCase(), "CARGO", "Unidad de medida"),
      quantity: field(parseQuantityValue(cellText(cargo.quantity)), "CARGO", "Cantidad", isNumber),
      nature: field(clean(cellText(cargo.nature)), "CARGO", "Naturaleza"),
      packaging: field(packaging, "CARGO", "Empaque"),
      productCode: field(productCode, "CARGO", "Código de producto"),
      transportedProduct: field(description, "CARGO", "Producto transportado"),
    },
  });
}
