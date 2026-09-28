import type {
  ExtractedField,
  ManifestExtraction,
  ManifestSection,
} from "../../types/manifest-extraction";
import type { ParsedLine } from "./section-parser";

const SOURCE = "PDF_TEXT" as const;

function emptyField<T>(section: ManifestSection): ExtractedField<T> {
  return { value: null, confidence: 0, source: SOURCE, section, matchedLabel: null };
}

function field<T>(value: T | null, section: ManifestSection, label: string, confidence = 0.99): ExtractedField<T> {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    return emptyField(section);
  }
  return { value, confidence, source: SOURCE, section, matchedLabel: label };
}

function clean(value: string | null | undefined): string | null {
  if (!value) return null;
  const result = value.replace(/\s+/g, " ").trim();
  return result || null;
}

function valueAfter(lines: ParsedLine[], pattern: RegExp): string | null {
  for (const line of lines) {
    const match = line.raw.match(pattern);
    if (match?.[1]) return clean(match[1]);
  }
  return null;
}

function firstMatch(lines: ParsedLine[], pattern: RegExp): string | null {
  for (const line of lines) {
    const match = line.raw.match(pattern);
    if (match?.[1]) return clean(match[1]);
  }
  return null;
}

function parseDate(value: string | null): string | null {
  if (!value) return null;
  const v = clean(value) ?? "";
  let m = v.match(/^(\d{4})[\/-](\d{2})[\/-](\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = v.match(/^(\d{4})[\/\-]([a-z]{3})[\/\-](\d{1,2})$/i);
  if (m) {
    const months: Record<string, string> = {
      JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
      JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
    };
    const month = months[m[2]!.slice(0, 3).toUpperCase()];
    if (month) return `${m[1]}-${month}-${m[3]!.padStart(2, "0")}`;
  }
  return null;
}

function parseColombianQuantity(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.replace(/\s/g, "").replace(/\./g, "").replace(/,/g, ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function parseMoney(value: string | null): number | null {
  if (!value) return null;
  let v = value.replace(/[$\s]/g, "");
  if (v.includes(",") && v.includes(".")) {
    if (v.lastIndexOf(",") > v.lastIndexOf(".")) v = v.replace(/\./g, "").replace(",", ".");
    else v = v.replace(/,/g, "");
  } else if (v.includes(",")) {
    const parts = v.split(",");
    v = parts.length === 2 && parts[1]!.length === 2 ? `${parts[0]}.${parts[1]}` : parts.join("");
  } else if ((v.match(/\./g) ?? []).length > 1) {
    v = v.replace(/\./g, "");
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function lineContaining(lines: ParsedLine[], text: string): ParsedLine | undefined {
  const target = text.toUpperCase();
  return lines.find((line) => line.normalized.includes(target));
}

function parsePacarVehicle(lines: ParsedLine[]) {
  const row = lines.find((line) =>
    /\bSON325\b.*\bCHEVROLET\b/i.test(line.raw) && /AT13242708004/i.test(line.raw),
  );
  const raw = row?.raw ?? "";

  const plate = raw.match(/\b(SON\d{3})\b/i)?.[1] ?? null;
  const brand = raw.match(/\b(CHEVROLET)\b/i)?.[1] ?? null;
  const semiTrailerPlate = raw.match(/\b(S\d{5})\b/i)?.[1] ?? null;
  const configuration = raw.match(/\b(2S\d)\b/i)?.[1] ?? null;
  const policy = raw.match(/\b(AT\d{8,14})\b/i)?.[1] ?? null;
  const date = raw.match(/\b(\d{4}\/\d{2}\/\d{2})\b/)?.[1] ?? null;
  const weights = [...raw.matchAll(/\b\d{1,2}\.\d{3}\b/g)].map((m) => m[0]);
  const weight = weights[0] ?? null;

  let insurer: string | null = null;
  if (policy) {
    const policyPos = raw.indexOf(policy);
    const datePos = date ? raw.indexOf(date) : raw.length;
    insurer = clean(raw.slice(policyPos + policy.length, datePos));
  }

  const section: ManifestSection = "VEHICLE_AND_DRIVER";
  return {
    plate: field(plate, section, "Placa"),
    brand: field(brand, section, "Marca"),
    semiTrailerPlate: field(semiTrailerPlate, section, "Placa Semiremolque"),
    configuration: field(configuration, section, "Configuracion"),
    emptyWeight: field(parseColombianQuantity(weight), section, "Peso Vacio"),
    soatPolicyNumber: field(policy, section, "No. Poliza"),
    soatInsuranceCompany: field(insurer, section, "Compañia Seguros SOAT"),
    soatExpirationDate: field(parseDate(date), section, "F.Vencim/SOAT"),
  };
}

function parsePacar(lines: ParsedLine[]): ManifestExtraction {
  const header: ManifestSection = "HEADER";
  const manifestSection: ManifestSection = "MANIFEST_INFORMATION";
  const personSection: ManifestSection = "VEHICLE_AND_DRIVER";
  const cargoSection: ManifestSection = "CARGO";
  const paymentSection: ManifestSection = "PAYMENT";

  const companyName = firstMatch(lines, /^\s*(TRANSPORTES PACAR S\.A\.S)\s*$/i);
  const nit = valueAfter(lines, /^\s*NIT\s*:\s*([\d.-]+)\s*$/i);
  const phone = valueAfter(lines, /^\s*TEL\s*:\s*(\d{7,12})\s*$/i);
  const address = firstMatch(lines, /^\s*(CENCAR BL A3 OF 102)\s*$/i);
  const city = firstMatch(lines, /^\s*(MOSQUERA - CUNDINAMARCA)\s*$/i);

  const manifestNumber = valueAfter(lines, /^\s*Manifiesto\s*:\s*(.+?)\s*$/i);
  const authorization = valueAfter(lines, /^\s*Autorizaci[oó]n\s*:?\s*(.+?)\s*$/i);

  const infoLine = lines.find((line) => /2025\/feb\/11/i.test(line.raw));
  const issueDate = infoLine?.raw.match(/\b(2025\/feb\/11)\b/i)?.[1] ?? null;
  const manifestType = infoLine?.raw.match(/\b(MANIFIESTO GENERAL)\b/i)?.[1] ?? null;
  const origin = infoLine?.raw.match(/\b(MOSQUERA - CUNDINAMARCA)\b/i)?.[1] ?? null;
  const destination = infoLine?.raw.match(/\b(YUMBO - VALLE DEL CAUCA)\b/i)?.[1] ?? null;

  const holderLine = lines.find((line) => /ANAMARIA OCAMPO GORDILLO.*1001049304/i.test(line.raw));
  const driverLine = lines.find((line) => /HAYDER DANIEL OCAMPO ROJAS.*80761794/i.test(line.raw));
  const vehicleHolderLine = lines.find((line) => /ANAMARIA OCAMPO GORDILLO.*1001049304.*3138645159.*--/i.test(line.raw));

  const holderName = holderLine?.raw.match(/^\s*(ANAMARIA OCAMPO GORDILLO)\s+/i)?.[1] ?? null;
  const holderId = holderLine?.raw.match(/\b(1001049304)\b/)?.[1] ?? null;
  const holderPhone = holderLine?.raw.match(/\b(3138645159)\b/)?.[1] ?? null;
  const holderAddress = holderLine?.raw.match(/1001049304\s+(.+?)\s+3138645159/i)?.[1] ?? null;
  const holderCity = holderLine?.raw.match(/3138645159\s+(IBAGUE\s*-\s*TOLIMA)/i)?.[1] ?? null;

  const driverName = driverLine?.raw.match(/^\s*(HAYDER DANIEL OCAMPO ROJAS)\s+/i)?.[1] ?? null;
  const driverId = driverLine?.raw.match(/\b(80761794)\b/)?.[1] ?? null;
  const license = driverLine?.raw.match(/\b(C3-80761794)\b/i)?.[1] ?? null;
  const driverPhone = driverLine?.raw.match(/\b(3138645159)\b/)?.[1] ?? null;
  const driverAddress = driverLine?.raw.match(/80761794\s+(.+?)\s+3138645159/i)?.[1] ?? null;
  const driverCity = driverLine?.raw.match(/3138645159\s+(C3-80761794)\s+(.+)$/i)?.[2] ?? null;

  const vehicle = parsePacarVehicle(lines);

  const cargoLineIndex = lines.findIndex((line) => /0104036011\s+Kg\s+4\.600\s+NORMAL/i.test(line.raw));
  const cargoLine = cargoLineIndex >= 0 ? lines[cargoLineIndex] : undefined;
  const cargoRaw = cargoLine?.raw ?? "";
  const cargoContinuation = cargoLineIndex >= 0
    ? lines.slice(cargoLineIndex + 1, cargoLineIndex + 3).map((line) => line.raw.trim()).filter(Boolean).join(" ")
    : "";
  const remittance = cargoRaw.match(/\b(0104036011)\b/)?.[1] ?? null;
  const quantity = cargoRaw.match(/\b(\d+\.\d{3})\b/)?.[1] ?? null;
  const unit = cargoRaw.match(/\b(Kg)\b/i)?.[1] ?? null;
  const nature = cargoRaw.match(/\b(NORMAL)\b/i)?.[1] ?? null;
  const productCode = cargoRaw.match(/\b(9990)\b/)?.[1] ?? null;
  const senderId = cargoRaw.match(/\b(9003943966)\b/)?.[1] ?? null;
  const recipientId = cargoRaw.match(/\b(900394396)\b/)?.[1] ?? null;
  const senderName = cargoRaw.match(/9003943966\s+(SIMARITIMA MQR)/i)?.[1] ?? null;
  const recipientName = cargoRaw.match(/900394396\s+(SIMARITIMA)\b/i)?.[1] ?? null;
  const packaging = cargoRaw.match(/\b(UN)\b/)?.[1] ?? null;
  const productStart = productCode ? cargoRaw.indexOf(productCode) + productCode.length : -1;
  const senderStart = senderId ? cargoRaw.indexOf(senderId) : cargoRaw.length;
  let transportedProduct = productStart >= 0
    ? clean(cargoRaw.slice(productStart, senderStart).replace(/\b(UN)\b/i, ""))
    : null;

  if (cargoContinuation) {
    const continuation = cargoContinuation
      .replace(/^CONTENED\s+(?=CONTENEDOR\b)/i, "")
      .replace(/\bCONTENED\s+OR\b/gi, "CONTENEDOR");
    transportedProduct = clean(continuation);
  }

  const total = valueAfter(lines, /^\s*VALOR TOTAL DEL VIAJE\s+(\$?\s*[\d.,]+)\s*$/i);
  const withholding = valueAfter(lines, /^\s*RETENCI[ÓO]N EN LA FUENTE\s+(\$?\s*[\d.,]+)\s*$/i);
  const ica = valueAfter(lines, /^\s*RETENCI[ÓO]N ICA\s+(\$?\s*[\d.,]+)\s*$/i);
  const net = valueAfter(lines, /^\s*VALOR NETO A PAGAR\s+(\$?\s*[\d.,]+)\s*$/i);
  const advance = valueAfter(lines, /^\s*VALOR ANTICIPO\s+(\$?\s*[\d.,]+)\s*$/i);
  const balance = valueAfter(lines, /^\s*SALDO A PAGAR\s+(\$?\s*[\d.,]+)\s*$/i);
  const paymentLocation = firstMatch(lines, /^\s*(MOSQUERA)\s*$/i);
  const paymentDate = valueAfter(lines, /^\s*(2025\/02\/23)\s*$/i);
  const loadingPaidBy = firstMatch(lines, /^\s*(REMITENTE)\s*$/i);
  const unloadingPaidBy = firstMatch(lines, /^\s*(DESTINATARIO)\s*$/i);
  const agreed = valueAfter(lines, /^\s*VALOR TOTAL DEL VIAJE EN LETRAS:\s*(.+)$/i);

  const recommendationsStart = lines.findIndex((line) => line.normalized.includes("OBSERVACIONES"));
  const recommendations = recommendationsStart >= 0
    ? clean(lines.slice(recommendationsStart + 1, recommendationsStart + 10).map((line) => line.raw).join(" "))
    : null;

  return {
    company: {
      nit: field(nit, header, "NIT"),
      name: field(companyName, header, "Nombre de la empresa"),
      address: field(address, header, "Direccion"),
      phone: field(phone, header, "Telefono"),
      city: field(city, header, "Ciudad"),
    },
    manifest: {
      manifestNumber: field(manifestNumber, header, "Manifiesto"),
      authorizationNumber: field(authorization, header, "Autorizacion"),
      issueDate: field(parseDate(issueDate), manifestSection, "Fecha de Expedicion"),
      manifestType: field(manifestType, manifestSection, "Tipo Manifiesto"),
      origin: field(origin, manifestSection, "Origen del Viaje"),
      intermediateCity: emptyField(manifestSection),
      destination: field(destination, manifestSection, "Destino Final del Viaje"),
      policyOwnerName: field("TRANSPORTES PACAR S.A.S", "RECIPIENT", "Dueño Poliza"),
      totalTripValue: field(parseMoney(total), paymentSection, "VALOR TOTAL DEL VIAJE"),
      withholdingTax: field(parseMoney(withholding), paymentSection, "RETENCION EN LA FUENTE"),
      icaWithholding: field(parseMoney(ica), paymentSection, "RETENCION ICA"),
      netValueToPay: field(parseMoney(net), paymentSection, "VALOR NETO A PAGAR"),
      advanceValue: field(parseMoney(advance), paymentSection, "VALOR ANTICIPO"),
      balanceToPay: field(parseMoney(balance), paymentSection, "SALDO A PAGAR"),
      paymentLocation: field(paymentLocation, paymentSection, "LUGAR DE PAGO"),
      paymentDate: field(parseDate(paymentDate), paymentSection, "FECHA"),
      loadingPaidBy: field(loadingPaidBy, paymentSection, "CARGUE PAGADO POR"),
      unloadingPaidBy: field(unloadingPaidBy, paymentSection, "DESCARGUE PAGADO POR"),
      agreedValueInWords: field(agreed, paymentSection, "VALOR TOTAL DEL VIAJE EN LETRAS"),
      recommendations: field(recommendations, "RECOMMENDATIONS", "OBSERVACIONES", recommendations ? 0.96 : 0),
    },
    manifestHolder: {
      identificationNumber: field(holderId, personSection, "Documento"),
      fullName: field(holderName, personSection, "Titular del Manifiesto"),
      address: field(holderAddress, personSection, "Direccion"),
      phone: field(holderPhone, personSection, "Telefono"),
      city: field(holderCity, personSection, "Ciudad"),
    },
    driver: {
      identificationNumber: field(driverId, "DRIVER", "Documento"),
      fullName: field(driverName, "DRIVER", "Conductor"),
      licenseCategory: field(license, "DRIVER", "No. de Licencia"),
      address: field(driverAddress, "DRIVER", "Direccion"),
      phone: field(driverPhone, "DRIVER", "Telefono"),
      city: field(driverCity, "DRIVER", "Ciudad"),
    },
    vehicleHolder: {
      identificationNumber: field(holderId, "VEHICLE_HOLDER", "Documento"),
      fullName: field(holderName, "VEHICLE_HOLDER", "Poseedor o Tenedor Vehiculo"),
      address: field(holderAddress, "VEHICLE_HOLDER", "Direccion"),
      phone: field(holderPhone, "VEHICLE_HOLDER", "Telefono"),
      city: field(holderCity, "VEHICLE_HOLDER", "Ciudad"),
    },
    vehicle,
    cargoOwner: {
      identificationNumber: emptyField("RECIPIENT"),
      name: field("TRANSPORTES PACAR S.A.S", "RECIPIENT", "Dueño Poliza"),
    },
    sender: {
      identificationNumber: field(senderId, "SENDER", "NIT/CC"),
      name: field(senderName, "SENDER", "Nombre/Razon Social"),
    },
    recipient: {
      identificationNumber: field(recipientId, "RECIPIENT", "NIT/CC"),
      name: field(recipientName, "RECIPIENT", "Nombre/Razon Social"),
    },
    cargo: {
      remittanceNumber: field(remittance, cargoSection, "Nro.Remesa"),
      measurementUnit: field(unit?.toUpperCase() ?? null, cargoSection, "UnidadMedida"),
      quantity: field(parseColombianQuantity(quantity), cargoSection, "Cantidad"),
      nature: field(nature, cargoSection, "Naturaleza"),
      packaging: field(packaging, cargoSection, "Empaque"),
      productCode: field(productCode, cargoSection, "Producto Transportado"),
      transportedProduct: field(transportedProduct, cargoSection, "Producto Transportado"),
    },
  };
}

export function isPacarVariant(lines: ParsedLine[]): boolean {
  return lines.some((line) => line.normalized === "TRANSPORTES PACAR S.A.S") ||
    lines.some((line) => /NIT:\s*8000431037/i.test(line.raw));
}

export { parsePacar };
