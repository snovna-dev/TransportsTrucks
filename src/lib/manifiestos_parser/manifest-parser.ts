import { ManifestExtractionSchema } from "../../schemas/manifest-extraction.schema";
import type {
  ExtractedField,
  ManifestExtraction,
  ManifestSection,
} from "../../types/manifest-extraction";
import {
  normalizeLine,
  parseSections,
  splitLayoutColumns,
  type ParsedLine,
} from "./section-parser";
import { isPacarVariant, parsePacar } from "./pacar-variant-parser";

const SOURCE = "PDF_TEXT" as const;

const KNOWN_CITIES = new Set(
  [
    "IBAGUE",
    "MEDELLIN",
    "BOGOTA",
    "CALI",
    "BUENAVENTURA",
    "FONTIBON",
    "MADRID",
    "FACATATIVA",
    "COTA",
    "FUNZA",
    "BARRANQUILLA",
    "CARTAGENA",
    "YUMBO",
    "PALMIRA",
    "SOACHA",
    "GIRARDOT",
    "NEIVA",
    "ARMENIA",
    "PEREIRA",
    "MANIZALES",
  ],
);

const GENERIC_LABEL_WORDS = new Set(
  [
    "DIRECCION",
    "TELEFONO",
    "CIUDAD",
    "FECHA",
    "ORIGEN",
    "DESTINO",
    "VIAJE",
    "TIPO",
    "MANIFIESTO",
    "AUTORIZACION",
    "PLACA",
    "MARCA",
    "CONDUCTOR",
    "TITULAR",
    "POSEEDOR",
    "TENEDOR",
    "DOCUMENTO",
    "DOCTO",
    "CARGA",
    "DESCARGA",
    "RECOMENDACIONES",
    "VALOR",
    "LUGAR",
  ],
);

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

  const normalized = clean(value);
  const iso = normalized.match(/^(\d{4})[-/.](\d{2})[-/.](\d{2})$/);
  if (iso) return normalized.replace(/\./g, "-").replace(/\//g, "-");

  const match = normalized.match(/^(\d{2})[-/.](\d{2})[-/.](\d{4})$/);
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
    normalized = last.length === 3
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

function normalizeAnchor(value: string): string {
  return normalizeLine(value)
    .replace(/[°º]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function anchorIndex(lines: ParsedLine[], label: string): number {
  const target = normalizeAnchor(label);
  return lines.findIndex((line) => normalizeAnchor(line.raw).includes(target));
}

function anchorIndexes(lines: ParsedLine[], label: string): number[] {
  const target = normalizeAnchor(label);
  return lines.flatMap((line, index) =>
    normalizeAnchor(line.raw).includes(target) ? [index] : [],
  );
}

function firstNonEmptyColumn(line: ParsedLine | undefined): string | null {
  if (!line) return null;
  return splitLayoutColumns(line.raw)[0] ?? null;
}

function valueFromSameLine(
  line: ParsedLine | undefined,
  label: string,
): string | null {
  if (!line) return null;

  const target = normalizeLine(label);
  const normalized = line.normalized;
  const position = normalized.indexOf(target);

  if (position >= 0) {
    const raw = line.raw;
    const rawPosition = normalizeLine(raw).indexOf(target);
    if (rawPosition >= 0) {
      const after = raw.slice(rawPosition + target.length)
        .replace(/^\s*:?\s*/, "")
        .trim();
      if (after && !/^\d{8,15}-?\d*$/.test(after)) {
        return clean(after);
      }
    }
  }

  const columns = splitLayoutColumns(line.raw);
  const labelIndex = columns.findIndex(
    (column) => normalizeLine(column) === target || normalizeLine(column).startsWith(`${target} `),
  );

  if (labelIndex >= 0 && columns[labelIndex + 1]) {
    return clean(columns[labelIndex + 1]!);
  }

  return null;
}

function nearestCandidate(
  lines: ParsedLine[],
  index: number,
  predicate: (value: string) => boolean,
  options: { beforeFirst?: boolean; afterFirst?: boolean; radius?: number } = {},
): string | null {
  const radius = options.radius ?? 6;
  const beforeFirst = options.beforeFirst ?? false;
  const afterFirst = options.afterFirst ?? true;

  const candidates: Array<{ value: string; distance: number; direction: "before" | "after" }> = [];

  const scan = (direction: "before" | "after", enabled: boolean) => {
    if (!enabled) return;
    for (let distance = 1; distance <= radius; distance++) {
      const candidateIndex = direction === "before"
        ? index - distance
        : index + distance;
      const line = lines[candidateIndex];
      if (!line) continue;

      const values = [line.raw, ...splitLayoutColumns(line.raw)];
      for (const value of values) {
        const cleaned = clean(value);
        if (cleaned && predicate(cleaned)) {
          candidates.push({ value: cleaned, distance, direction });
        }
      }
    }
  };

  scan("before", beforeFirst);
  scan("after", afterFirst);

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (beforeFirst && a.direction !== b.direction) {
      return a.direction === "before" ? -1 : 1;
    }
    return 0;
  });

  return candidates[0]?.value ?? null;
}

function datePredicate(value: string): boolean {
  return /^\d{2}[-/.]\d{2}[-/.]\d{4}$/.test(value);
}

function cityPredicate(value: string): boolean {
  const normalized = normalizeLine(value)
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized || normalized.length > 35) return false;
  if (!/^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .'-]*$/.test(normalized)) return false;
  if (GENERIC_LABEL_WORDS.has(normalized)) return false;
  if (/\d/.test(normalized)) return false;
  if (normalized.split(" ").length > 3) return false;

  return KNOWN_CITIES.has(normalized) || /^[A-ZÁÉÍÓÚÑ]{3,20}$/.test(normalized);
}

function looksLikePersonName(value: string): boolean {
  const normalized = normalizeLine(value);
  if (!normalized) return false;
  if (normalized.length > 80) return false;
  if (/\d/.test(normalized)) return false;

  return (
    normalized.split(/\s+/).length >= 2 &&
    /^[A-ZÁÉÍÓÚÑ.' -]+$/.test(normalized) &&
    !/(CALLE|CARRERA|DIAG|AVENIDA|TRONCAL|SEGUROS|MANIFIESTO ELECTRONICO)/.test(normalized)
  );
}

function extractNearestNumber(
  lines: ParsedLine[],
  anchor: number,
  regex: RegExp,
  radius = 8,
): string | null {
  const candidates: Array<{ value: string; distance: number }> = [];

  for (let distance = 0; distance <= radius; distance++) {
    for (const index of [anchor - distance, anchor + distance]) {
      if (index < 0 || index >= lines.length) continue;
      const matches = lines[index]!.raw.match(regex) ?? [];
      for (const match of matches) {
        candidates.push({ value: match, distance });
      }
    }
  }

  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0]?.value ?? null;
}

function extractLastPhoneInWindow(
  lines: ParsedLine[],
  start: number,
  end: number,
  exclude: string[] = [],
): string | null {
  const blocked = new Set(exclude);
  for (let index = start; index <= end; index++) {
    const matches = lines[index]?.raw.match(/\b\d{7,10}\b/g) ?? [];
    const candidate = matches.find((value) => !blocked.has(value));
    if (candidate) return candidate;
  }
  return null;
}

function extractAddress(value: string): string | null {
  const match = value.match(/\b(?:CALLE|CARRERA|DIAG(?:ONAL)?|AVENIDA|AV)\b.*$/i);
  if (!match) return null;

  let result = clean(match[0]);
  result = result.replace(/\b\d{7,10}\b.*$/g, "").trim();

  const cityMatch = result.match(/\b(?:IBAGUE|MEDELLIN|BOGOTA|CALI|BUENAVENTURA|FONTIBON|MADRID|FACATATIVA|COTA|FUNZA|BARRANQUILLA|CARTAGENA|YUMBO|PALMIRA|SOACHA|GIRARDOT|NEIVA|ARMENIA|PEREIRA|MANIZALES)\b/i);
  if (cityMatch?.index !== undefined) {
    result = result.slice(0, cityMatch.index).trim();
  }

  return result || null;
}

function extractCity(value: string): string | null {
  const words = clean(value).split(/\s+/).filter(Boolean);

  for (let i = words.length - 1; i >= 0; i--) {
    const candidate = words[i]!.replace(/[.,]/g, "").toUpperCase();
    if (cityPredicate(candidate)) return candidate;
  }

  return null;
}

function parseCompany(lines: ParsedLine[]): ManifestExtraction["company"] {
  const section: ManifestSection = "HEADER";
  const titleIndex = anchorIndex(lines, "MANIFIESTO ELECTRONICO DE CARGA");
  const start = titleIndex >= 0 ? titleIndex : 0;
  const block = lines.slice(start, Math.min(lines.length, start + 20));

  const companyNameLine = block.find((line, index) =>
    index > 0 && /(?:S\.A\.|SAS|LTDA)/i.test(line.raw) &&
    !/reproduccion del documento/i.test(line.raw),
  );
  const nitLine = block.find((line) => /^NIT\s*:/i.test(line.raw.trim()));
  const addressIndex = block.findIndex((line) => /^DIRECCION\s*:/i.test(line.raw.trim()));
  const cityIndex = block.findIndex((line) => /(?:^|\s)CIUDAD\s*:/i.test(line.raw));
  const phoneIndex = block.findIndex((line) => /(?:^|\s)TELEFONO\s*:/i.test(line.raw));

  let address: string | null = null;
  if (addressIndex >= 0) {
    const parts: string[] = [];
    for (let i = addressIndex; i < block.length && i <= addressIndex + 5; i++) {
      if (i === cityIndex || i === phoneIndex) break;
      const first = firstNonEmptyColumn(block[i]);
      if (!first) continue;
      const cleaned = first.replace(/^DIRECCION\s*:\s*/i, "").trim();
      const normalizedCleaned = normalizeLine(cleaned);
      if (/CERTIFICACION|REPRODUCCION|INFORMACION DEL MANIFIESTO|\bPAG\.|MANIFIESTO:|AUTORIZACION:/.test(normalizedCleaned)) break;
      if (/\b\d{2}-\d{2}-\d{4}\b/.test(cleaned)) break;
      if (cleaned) parts.push(cleaned);
    }
    address = clean(parts.join(" ")) || null;
  }

  const nit = nitLine?.raw.match(/^NIT\s*:\s*([^\s]+)/i)?.[1] ?? null;
  const phone = phoneIndex >= 0
    ? block[phoneIndex]?.raw.match(/TELEFONO\s*:\s*(\d{7,10})/i)?.[1] ??
      block[phoneIndex]?.raw.match(/\b\d{7,10}\b/)?.[0] ?? null
    : null;
  const city = cityIndex >= 0
    ? valueFromSameLine(block[cityIndex], "CIUDAD")?.match(/^[A-ZÁÉÍÓÚÑ .'-]+$/i)?.[0] ??
      block[cityIndex]?.raw.match(/CIUDAD\s*:\s*([A-ZÁÉÍÓÚÑ .'-]+)/i)?.[1]?.trim() ?? null
    : null;

  return {
    nit: exactField(nit, section, "NIT", nit ? 0.99 : 0),
    name: exactField(companyNameLine ? clean(companyNameLine.raw) : null, section, "Nombre de la empresa", companyNameLine ? 0.99 : 0),
    address: exactField(address, section, "Direccion", address ? 0.98 : 0),
    phone: exactField(phone, section, "Telefono", phone ? 0.99 : 0),
    city: exactField(city ? clean(city) : null, section, "Ciudad", city ? 0.98 : 0),
  };
}

function parseIdentity(lines: ParsedLine[]) {
  const section: ManifestSection = "HEADER";
  const manifestIndex = anchorIndex(lines, "MANIFIESTO:");
  const authorizationIndex = anchorIndex(lines, "AUTORIZACION:");

  const manifest = extractNearestNumber(
    lines,
    manifestIndex >= 0 ? manifestIndex : 0,
    /\b\d{10,15}M\b/g,
    8,
  );

  const authorization = extractNearestNumber(
    lines,
    authorizationIndex >= 0 ? authorizationIndex : 0,
    /\b\d{8,12}\b/g,
    8,
  );

  return {
    manifestNumber: exactField(manifest, section, "Manifiesto", manifest ? 0.99 : 0),
    authorizationNumber: exactField(authorization, section, "Autorizacion", authorization ? 0.99 : 0),
  };
}

function parseManifestInformation(lines: ParsedLine[]) {
  const section: ManifestSection = "MANIFEST_INFORMATION";
  const identity = parseIdentity(lines);

  const dateLabel = Math.max(
    anchorIndex(lines, "FECHA EXPED"),
    anchorIndex(lines, "FECHA DE EXPEDICION"),
  );
  const typeIndex = anchorIndex(lines, "TIPO MANIFIESTO");
  const originIndex = anchorIndex(lines, "ORIGEN DEL VIAJE");
  const destinationIndex = anchorIndex(lines, "DESTINO DEL VIAJE");
  const intermediateIndex = anchorIndex(lines, "CIUDAD INTEMEDIA");

  const issueDate = dateLabel >= 0
    ? nearestCandidate(lines, dateLabel, datePredicate, { beforeFirst: true, afterFirst: true, radius: 5 })
    : null;

  const manifestType = typeIndex >= 0
    ? nearestCandidate(lines, typeIndex, (value) => normalizeLine(value) === "GENERALES", { beforeFirst: true, afterFirst: true, radius: 4 })
    : null;

  const origin = originIndex >= 0
    ? valueFromSameLine(lines[originIndex], "ORIGEN DEL VIAJE") ??
      nearestCandidate(lines, originIndex, cityPredicate, { beforeFirst: true, afterFirst: false, radius: 5 }) ??
      nearestCandidate(lines, originIndex, cityPredicate, { beforeFirst: false, afterFirst: true, radius: 5 })
    : null;

  const destination = destinationIndex >= 0
    ? valueFromSameLine(lines[destinationIndex], "DESTINO DEL VIAJE") ??
      nearestCandidate(lines, destinationIndex, cityPredicate, { beforeFirst: false, afterFirst: true, radius: 5 }) ??
      nearestCandidate(lines, destinationIndex, cityPredicate, { beforeFirst: true, afterFirst: false, radius: 5 })
    : null;

  // If the route header/value row is available, prefer the positional values.
  const routeHeaderIndex = lines.findIndex((line) =>
    line.normalized.includes("FECHA EXPED") &&
    line.normalized.includes("TIPO MANIFIESTO") &&
    line.normalized.includes("ORIGEN DEL VIAJE"),
  );

  let routeDate = issueDate;
  let routeType = manifestType;
  let routeOrigin = origin;
  let routeDestination = destination;
  let routeIntermediate: string | null = null;

  if (routeHeaderIndex >= 0) {
    const row = lines
      .slice(routeHeaderIndex + 1, routeHeaderIndex + 4)
      .find((line) => datePredicate(clean(splitLayoutColumns(line.raw)[0] ?? "")));

    if (row) {
      const values = splitLayoutColumns(row.raw);
      if (values.length >= 4) {
        routeDate = parseDate(values[0]) ?? routeDate;
        routeType = values[1] ?? routeType;
        routeOrigin = values[2] ?? routeOrigin;
        routeDestination = values.length >= 5 ? values[4] : values[3] ?? routeDestination;
        routeIntermediate = values.length >= 5 ? values[3] ?? null : null;
      }
    }
  }

  const intermediate = routeHeaderIndex >= 0
    ? routeIntermediate
    : intermediateIndex >= 0
      ? nearestCandidate(lines, intermediateIndex, cityPredicate, { beforeFirst: true, afterFirst: true, radius: 3 })
      : null;

  return {
    ...identity,
    issueDate: exactField(routeDate ? parseDate(routeDate) : null, section, "Fecha Expedicion", routeDate ? 0.99 : 0),
    manifestType: exactField(routeType ? clean(routeType) : null, section, "Tipo Manifiesto", routeType ? 0.99 : 0),
    origin: exactField(routeOrigin ? clean(routeOrigin) : null, section, "Origen del Viaje", routeOrigin ? 0.99 : 0),
    intermediateCity: exactField(intermediate ? clean(intermediate) : null, section, "Ciudad Intermedia", intermediate ? 0.96 : 0),
    destination: exactField(routeDestination ? clean(routeDestination) : null, section, "Destino del Viaje", routeDestination ? 0.99 : 0),
  };
}

function getPersonRegion(lines: ParsedLine[], label: string): ParsedLine[] {
  const index = anchorIndex(lines, label);
  if (index < 0) return [];
  // Different generators of the same Ministry form can emit a person's data
  // several lines before its header. Use a wider local window, then narrow the
  // context around the actual identification number below.
  return lines.slice(Math.max(0, index - 12), Math.min(lines.length, index + 8));
}

function parsePersonBlock(
  lines: ParsedLine[],
  label: string,
  section: "VEHICLE_AND_DRIVER" | "VEHICLE_HOLDER",
  nameLabel: string,
  preferredIdLength: 10 | 8 = 10,
): ManifestExtraction["manifestHolder"] {
  const region = getPersonRegion(lines, label);
  if (region.length === 0) {
    return {
      identificationNumber: emptyField(section),
      fullName: emptyField(section),
      address: emptyField(section),
      phone: emptyField(section),
      city: emptyField(section),
    };
  }

  const ids = region.flatMap((line) => line.raw.match(/\b\d{7,12}\b/g) ?? [])
    .filter((id) => id.length === preferredIdLength);
  const identificationNumber = ids[0] ?? null;
  const dataLine = identificationNumber
    ? region.find((line) => line.raw.includes(identificationNumber))
    : undefined;
  const rowText = dataLine?.raw ?? region.map((line) => line.raw).join(" ");

  const nameAndAddress = rowText.match(/^\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ.' -]{3,80}?)(?=\s+(?:CALLE|CARRERA|DIAG|AVENIDA|AV)\b)/i)?.[1] ??
    rowText.match(/^\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ.' -]{3,80}?)\s+\d{10}\b/i)?.[1] ?? null;
  const fallbackName = dataLine
    ? splitLayoutColumns(dataLine.raw).find((value) => looksLikePersonName(value)) ??
      dataLine.raw.match(/^\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ.' -]{3,80}?)(?=\s+\d{10}\b)/i)?.[1] ?? null
    : null;
  const fullName = clean(nameAndAddress ?? fallbackName ?? "") || null;

  const address = extractAddress(rowText);
  const phone = identificationNumber
    ? extractLastPhoneInWindow([dataLine ?? region[0]!], 0, 0, [identificationNumber])
    : null;
  const city = extractCity(rowText);

  return {
    identificationNumber: exactField(identificationNumber, section, "Docto de Identificacion No.", identificationNumber ? 0.99 : 0),
    fullName: exactField(fullName, section, nameLabel, fullName ? 0.99 : 0),
    address: exactField(address, section, "Direccion", address ? 0.97 : 0),
    phone: exactField(phone, section, "Telefono", phone ? 0.99 : 0),
    city: exactField(city, section, "Ciudad y Departamento", city ? 0.97 : 0),
  };
}

function parseDriver(lines: ParsedLine[]): ManifestExtraction["driver"] {
  const section: ManifestSection = "DRIVER";
  const region = getPersonRegion(lines, "CONDUCTOR");
  const licenseLine = region.find((line) => /\b\d{8}-[A-Z0-9]+\b/.test(line.raw));
  const idLine = region.find((line) => /\b\d{8}\b/.test(line.raw));
  const rowText = licenseLine?.raw ?? idLine?.raw ?? region.map((line) => line.raw).join(" ");

  const licenseCategory = rowText.match(/\b\d{8}-[A-Z0-9]+\b/)?.[0] ?? null;
  const identificationNumber = licenseCategory?.slice(0, 8) ?? rowText.match(/\b\d{8}\b/)?.[0] ?? null;
  const fullName = rowText.match(/^\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ.' -]{3,80}?)(?=\s+\d{8}(?:-|\s))/i)?.[1] ??
    rowText.match(/\b([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ.' -]{3,80}?)(?=\s+\d{8}-)/i)?.[1] ?? null;
  const address = extractAddress(rowText);
  const city = extractCity(rowText);
  const footerPhone = lines.find((line) => /CEL\.\s*COND\.:/i.test(line.raw))?.raw.match(/CEL\.\s*COND\.:\s*(\d{10})/i)?.[1] ?? null;

  return {
    identificationNumber: exactField(identificationNumber, section, "Docto. de Identificacion No.", identificationNumber ? 0.99 : 0),
    fullName: exactField(fullName ? clean(fullName) : null, section, "Conductor", fullName ? 0.99 : 0),
    licenseCategory: exactField(licenseCategory, section, "CAT. LIC. CONDUCCION", licenseCategory ? 0.99 : 0),
    address: exactField(address, section, "Direccion", address ? 0.96 : 0),
    phone: exactField(footerPhone, section, "Cel. Cond.", footerPhone ? 0.99 : 0),
    city: exactField(city, section, "Ciudad y Departamento", city ? 0.97 : 0),
  };
}

function parseVehicle(
  lines: ParsedLine[],
  excludedNumbers: string[] = [],
): ManifestExtraction["vehicle"] {
  const section: ManifestSection = "VEHICLE_AND_DRIVER";
  const wholeText = lines.map((line) => line.raw).join(" ");
  const blocked = new Set(excludedNumbers.filter(Boolean));

  const plate = wholeText.match(/\b[A-Z]{3}\d{3}\b/)?.[0] ?? null;
  const brand = wholeText.match(/\b(CHEVROLET|KENWORTH|VOLVO|SCANIA|MACK|HINO|FREIGHTLINER|INTERNATIONAL|MERCEDES[- ]BENZ|DAF|RENAULT)\b/i)?.[1] ?? null;
  const semiTrailerPlate = wholeText.match(/\b[A-Z]\d{5,6}\b/)?.[0] ?? null;
  const configuration = wholeText.match(/\b\d[A-Z]\d\b/)?.[0] ?? null;

  const weightLabelIndex = anchorIndex(lines, "PESO VACIO");
  const weightCandidates: Array<{ value: string; distance: number }> = [];
  if (weightLabelIndex >= 0) {
    for (let distance = 0; distance <= 8; distance++) {
      for (const index of [weightLabelIndex - distance, weightLabelIndex + distance]) {
        if (index < 0 || index >= lines.length) continue;
        for (const match of lines[index]!.raw.match(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g) ?? []) {
          if (/[,.]/.test(match)) weightCandidates.push({ value: match, distance });
        }
      }
    }
  }
  const weight = weightCandidates.sort((a, b) => a.distance - b.distance)[0]?.value ?? null;

  const policyLabelIndex = Math.max(
    anchorIndex(lines, "N POLIZA SOAT"),
    anchorIndex(lines, "N° POLIZA SOAT"),
  );
  let filteredPolicy: string | null = null;
  if (policyLabelIndex >= 0) {
    const candidates: Array<{ value: string; distance: number }> = [];
    for (let distance = 0; distance <= 20; distance++) {
      for (const index of [policyLabelIndex - distance, policyLabelIndex + distance]) {
        if (index < 0 || index >= lines.length) continue;
        for (const match of lines[index]!.raw.match(/\b\d{10,15}\b/g) ?? []) {
          if (!blocked.has(match)) candidates.push({ value: match, distance });
        }
      }
    }

    filteredPolicy = candidates
      .sort((a, b) => a.distance - b.distance)
      .find((candidate) => candidate.value.length >= 12)?.value ??
      candidates[0]?.value ?? null;
  }

  // Some PDF generators place the label and the SOAT number in different
  // text streams. First use the vehicle area as a positional fallback, then
  // (only as a last resort) use a document-level 12-15 digit candidate. This
  // keeps the rule deterministic without hardcoding a sample policy number.
  if (!filteredPolicy) {
    const vehicleAnchor = weightLabelIndex >= 0
      ? weightLabelIndex
      : anchorIndex(lines, "PLACA");

    if (vehicleAnchor >= 0) {
      const vehicleCandidates: Array<{ value: string; distance: number }> = [];
      for (let distance = 0; distance <= 10; distance++) {
        for (const index of [vehicleAnchor - distance, vehicleAnchor + distance]) {
          if (index < 0 || index >= lines.length) continue;
          for (const match of lines[index]!.raw.match(/\b\d{12,15}\b/g) ?? []) {
            if (!blocked.has(match)) {
              vehicleCandidates.push({ value: match, distance });
            }
          }
        }
      }
      filteredPolicy = vehicleCandidates.sort((a, b) => a.distance - b.distance)[0]?.value ?? null;
    }
  }

  if (!filteredPolicy) {
    const globalPolicyCandidates = Array.from(
      new Set(wholeText.match(/\b\d{12,15}\b/g) ?? []),
    ).filter((value) => !blocked.has(value));

    filteredPolicy = globalPolicyCandidates[0] ?? null;
  }

  const insurer = wholeText.match(/\b([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .'-]*SEGUROS(?: SA)?)\b/i)?.[1] ?? null;
  const soatLabelIndex = anchorIndex(lines, "VENCIMIENTO SOAT");
  let soatDate: string | null = null;
  if (soatLabelIndex >= 0) {
    const dateCandidates: Array<{ value: string; distance: number }> = [];
    for (let distance = 0; distance <= 20; distance++) {
      for (const index of [soatLabelIndex - distance, soatLabelIndex + distance]) {
        if (index < 0 || index >= lines.length) continue;
        for (const match of lines[index]!.raw.match(/\b\d{2}-\d{2}-\d{4}\b/g) ?? []) {
          dateCandidates.push({ value: match, distance });
        }
      }
    }
    soatDate = dateCandidates.sort((a, b) => a.distance - b.distance)[0]?.value ?? null;
  }

  return {
    plate: exactField(plate, section, "Placa", plate ? 0.99 : 0),
    brand: exactField(brand ? clean(brand) : null, section, "Marca", brand ? 0.99 : 0),
    semiTrailerPlate: exactField(semiTrailerPlate, section, "Placa Semiremolque", semiTrailerPlate ? 0.99 : 0),
    configuration: exactField(configuration, section, "Configuracion", configuration ? 0.99 : 0),
    emptyWeight: exactField(weight ? parseMoney(weight) : null, section, "Peso Vacio", weight ? 0.99 : 0),
    soatPolicyNumber: exactField(filteredPolicy, section, "N° Poliza SOAT", filteredPolicy ? 0.99 : 0),
    soatInsuranceCompany: exactField(insurer ? clean(insurer) : null, section, "Cia. Segura SOAT", insurer ? 0.99 : 0),
    soatExpirationDate: exactField(soatDate ? parseDate(soatDate) : null, section, "Vencimiento SOAT", soatDate ? 0.99 : 0),
  };
}

function parseCargoAndParties(lines: ParsedLine[]) {
  const cargoSection: ManifestSection = "CARGO";
  const cargoStart = anchorIndex(lines, "INFORMACION DE LA MERCANCIA TRANSPORTADA");
  const paymentStart = anchorIndex(lines, "VALOR DEL VIAJE");
  const cargoLines = cargoStart >= 0
    ? lines.slice(cargoStart, paymentStart > cargoStart ? paymentStart : Math.min(lines.length, cargoStart + 35))
    : lines;

  const dataRows = cargoLines.filter((line) =>
    /\b\d{5,8}\b/.test(line.raw) && /KILOGRAMOS|KGS/i.test(line.raw),
  );
  const dataLine = dataRows[0];
  const dataLineIndex = dataLine ? cargoLines.indexOf(dataLine) : -1;
  const dataContext = dataLineIndex >= 0
    ? cargoLines.slice(dataLineIndex, Math.min(cargoLines.length, dataLineIndex + 8))
    : cargoLines;
  const cargoText = dataContext.map((line) => line.raw).join(" ");
  const firstValues = dataLine ? splitLayoutColumns(dataLine.raw) : [];
  const fullValues = dataContext.flatMap((line) => splitLayoutColumns(line.raw));

  const remittance = dataLine?.raw.match(/\b\d{5,8}\b/)?.[0] ?? null;
  const unit = dataLine?.raw.match(/\b(KILOGRAMOS|KGS)\b/i)?.[1] ?? null;
  const quantity = dataLine?.raw.match(/\b\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?\b/)?.[0] ??
    dataContext.map((line) => line.raw.match(/\b\d+[.,]\d+\b/)?.[0]).find(Boolean) ?? null;

  const productCodeCandidates = dataContext.flatMap((line) =>
    line.raw.match(/\b\d{5}\b/g) ?? [],
  ).filter((value) => value !== remittance);
  const productCode = productCodeCandidates[0] ?? null;

  const natureParts = [
    cargoText.match(/\bCARGA\b/i)?.[0] ?? null,
    cargoText.match(/\b(?:GENERAL|NORMAL)\b/i)?.[0] ?? null,
  ].filter(Boolean);
  const nature = natureParts.length > 0
    ? [...new Set(natureParts.map((value) => clean(value!)))].join(" ")
    : null;

  let packaging: string | null = null;
  const packagingPatterns = [
    /\b\d+\s+C\s+\d+\b/i,
    /\bCARGA\s+ESTIBADA\b/i,
    /\bESTIBADA\b/i,
  ];
  for (const pattern of packagingPatterns) {
    const match = cargoText.match(pattern);
    if (match) {
      packaging = clean(match[0]);
      break;
    }
  }

  if (packaging && /^ESTIBADA$/i.test(packaging)) {
    packaging = "Carga Estibada";
  }

  if (!packaging) {
    const packagingBase = firstValues.find((value) => /\b(?:CARGA|PIES|ESTIBADA)\b/i.test(value));
    if (packagingBase) packaging = clean(packagingBase);
  }

  if (packaging && /1 C 40/i.test(packaging) && /PIES/i.test(cargoText)) {
    packaging = "1 C 40 Pies";
  }

  const partyMatches: Array<{
    id: string;
    name: string | null;
    lineIndex: number;
    position: number;
  }> = [];

  dataContext.forEach((line, relativeIndex) => {
    const matches = [...line.raw.matchAll(/\b\d{7,12}\b/g)];
    for (const match of matches) {
      const id = match[0];
      const position = match.index ?? 0;
      const tail = clean(
        line.raw
          .slice(position + id.length)
          .replace(/\s+\d{7,12}\b.*$/g, ""),
      );
      partyMatches.push({
        id,
        name: tail || null,
        lineIndex: relativeIndex,
        position,
      });
    }
  });

  const uniqueParties = partyMatches.filter(
    (item, index, array) =>
      array.findIndex((candidate) => candidate.id === item.id) === index,
  );

  const partyCodeLineIndex = productCode
    ? dataContext.findIndex((line) => line.raw.includes(productCode))
    : -1;
  const partiesOnProductLine = partyCodeLineIndex >= 0
    ? uniqueParties.filter((party) => party.lineIndex === partyCodeLineIndex)
    : [];

  let sender = partiesOnProductLine[0] ?? null;
  const remaining = uniqueParties.filter((party) => party.id !== sender?.id);
  let recipient = remaining[0] ?? null;

  // When both party IDs are printed on the same data row, preserve visual
  // left-to-right order. When extraction splits them across lines, the party
  // sharing the product-code line is treated as the sender.
  if (sender && recipient && sender.lineIndex === recipient.lineIndex) {
    const ordered = [...partiesOnProductLine].sort((a, b) => a.position - b.position);
    sender = ordered[0] ?? sender;
    recipient = ordered[1] ?? recipient;
  }

  if (!sender && uniqueParties.length > 0) {
    sender = uniqueParties[0] ?? null;
    recipient = uniqueParties.find((party) => party.id !== sender?.id) ?? null;
  }

  let transportedProduct: string | null = null;
  if (dataLine && productCode) {
    const codePosition = dataLine.raw.indexOf(productCode);
    const senderIdPosition = sender ? dataLine.raw.indexOf(sender.id) : -1;
    const recipientIdPosition = recipient ? dataLine.raw.indexOf(recipient.id) : -1;
    const partyPositionCandidates = [senderIdPosition, recipientIdPosition].filter((value) => value >= 0);
    const firstPartyPosition = partyPositionCandidates.length > 0
      ? Math.min(...partyPositionCandidates)
      : dataLine.raw.length;

    if (codePosition >= 0 && firstPartyPosition > codePosition) {
      const candidate = clean(dataLine.raw.slice(codePosition + productCode.length, firstPartyPosition));
      if (candidate) transportedProduct = candidate;
    }
  }

  if (!transportedProduct && dataLine) {
    const dataLinePartyPositions = (dataLine.raw.match(/\b\d{7,12}\b/g) ?? [])
      .map((id) => dataLine.raw.indexOf(id))
      .filter((position) => position >= 0);
    const firstPartyPosition = dataLinePartyPositions.length > 0
      ? Math.min(...dataLinePartyPositions)
      : -1;
    const beforeParty = firstPartyPosition >= 0
      ? dataLine.raw.slice(0, firstPartyPosition)
      : dataLine.raw;
    const stripped = clean(beforeParty)
      .replace(remittance ? new RegExp(`\\b${remittance}\\b`, "g") : /$^/, " ")
      .replace(/\b(KILOGRAMOS|KGS)\b/gi, " ")
      .replace(quantity ? new RegExp(`\\b${quantity.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "g") : /$^/, " ")
      .replace(/\b(?:CARGA|GENERAL|NORMAL)\b/gi, " ")
      .replace(productCode ? new RegExp(`\\b${productCode}\\b`, "g") : /$^/, " ")
      .trim();
    if (stripped) transportedProduct = clean(stripped);
  }

  if (!transportedProduct && productCode) {
    const productIndex = fullValues.indexOf(productCode);
    if (productIndex >= 0) {
      const candidate = clean(fullValues[productIndex + 1] ?? "");
      if (candidate && !/^\\d{7,12}(?:\\s|$)/.test(candidate)) {
        transportedProduct = candidate;
      }
    }
  }

  return {
    cargo: {
      remittanceNumber: exactField(remittance, cargoSection, "Numero de Remesa", remittance ? 0.99 : 0),
      measurementUnit: exactField(unit ? unit.toUpperCase() : null, cargoSection, "Unidad de Medida", unit ? 0.99 : 0),
      quantity: exactField(quantity ? parseMoney(quantity) : null, cargoSection, "Cantidad", quantity ? 0.99 : 0),
      nature: exactField(nature ? clean(nature) : null, cargoSection, "Naturaleza", nature ? 0.97 : 0),
      packaging: exactField(packaging, cargoSection, "Empaque", packaging ? (/Pies|Estibada/i.test(packaging) ? 0.96 : 0.97) : 0),
      productCode: exactField(productCode, cargoSection, "Codigo de Producto", productCode ? 0.99 : 0),
      transportedProduct: exactField(transportedProduct, cargoSection, "Producto Transportado", transportedProduct ? 0.96 : 0),
    },
    sender: {
      identificationNumber: exactField(sender?.id ?? null, "SENDER", "Nit / cc", sender ? 0.99 : 0),
      name: exactField(sender?.name ?? null, "SENDER", "Nombre / Razon Social", sender?.name ? 0.98 : 0),
    },
    recipient: {
      identificationNumber: exactField(recipient?.id ?? null, "RECIPIENT", "Nit / cc", recipient ? 0.99 : 0),
      name: exactField(recipient?.name ?? null, "RECIPIENT", "Nombre / Razon Social", recipient?.name ? 0.98 : 0),
    },
    cargoOwner: {
      identificationNumber: emptyField("RECIPIENT"),
      name: emptyField("RECIPIENT"),
    },
  };
}

function extractMoneyNearLabel(lines: ParsedLine[], label: string): number | null {
  const index = anchorIndex(lines, label);
  if (index < 0) return null;

  const paymentLabels = [
    "VALOR TOTAL DEL VIAJE",
    "RETENCION EN LA FUENTE",
    "RETENCION ICA",
    "VALOR NETO A PAGAR",
    "VALOR ANTICIPO",
    "SALDO A PAGAR",
  ].map(normalizeLine);

  for (let distance = 0; distance <= 10; distance++) {
    const candidateIndex = index + distance;
    const line = lines[candidateIndex];
    if (!line) break;
    const lineNormalized = line.normalized;
    const isAnotherLabel = distance > 0 && paymentLabels.some(
      (candidate) => lineNormalized.includes(candidate) && candidate !== normalizeLine(label),
    );
    if (isAnotherLabel) break;

    const match = line.raw.match(/\$\s*([\d.,]+)/);
    if (match) return parseMoney(match[1]);
  }

  for (let distance = 1; distance <= 4; distance++) {
    const candidateIndex = index - distance;
    const line = lines[candidateIndex];
    if (!line) continue;
    const match = line.raw.match(/\$\s*([\d.,]+)/);
    if (match) return parseMoney(match[1]);
  }

  return null;
}

function extractPayment(lines: ParsedLine[]) {
  const section: ManifestSection = "PAYMENT";
  const paymentStart = anchorIndex(lines, "VALOR DEL VIAJE");
  const paymentLines = paymentStart >= 0
    ? lines.slice(Math.max(0, paymentStart), Math.min(lines.length, paymentStart + 40))
    : lines;

  const moneyValues: number[] = [];
  for (const line of paymentLines) {
    for (const match of line.raw.matchAll(/\$\s*([\d.,]+)/g)) {
      const value = parseMoney(match[1]);
      if (value !== null) moneyValues.push(value);
    }
  }

  const totalTripValue = moneyValues[0] ?? null;
  const withholdingTax = moneyValues[1] ?? null;
  const icaWithholding = moneyValues[2] ?? null;
  const netValueToPay = moneyValues[3] ?? null;
  const advanceValue = moneyValues[4] ?? null;
  const balanceToPay = moneyValues[5] ?? null;

  const locationIndex = anchorIndex(paymentLines, "LUGAR");
  const fechaIndex = anchorIndex(paymentLines, "FECHA");
  const paymentLocation = locationIndex >= 0
    ? paymentLines[locationIndex]?.raw.match(/\bLUGAR\b\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .'-]*?)(?=\s+FECHA\b)/i)?.[1]?.trim() ??
      nearestCandidate(paymentLines, locationIndex, cityPredicate, { beforeFirst: true, afterFirst: false, radius: 6 }) ??
      nearestCandidate(paymentLines, locationIndex, cityPredicate, { beforeFirst: false, afterFirst: true, radius: 6 })
    : null;

  const paymentDate = fechaIndex >= 0
    ? paymentLines[fechaIndex]?.raw.match(/\b(\d{2}-\d{2}-\d{4})\b/)?.[1] ??
      nearestCandidate(paymentLines, fechaIndex, datePredicate, { beforeFirst: true, afterFirst: true, radius: 8 })
    : null;

  const loadingIndex = anchorIndex(paymentLines, "CARGUE PAGADO POR");
  const unloadingIndex = anchorIndex(paymentLines, "DESCARGUE PAGADO POR");
  const findPayer = (index: number, payer: "REMITENTE" | "DESTINATARIO") => {
    if (index < 0) return null;
    const sameLine = paymentLines[index]?.raw.match(/PAGADO\s+POR\s+(REMITENTE|DESTINATARIO)/i)?.[1];
    if (sameLine) return sameLine.toUpperCase();
    for (let distance = 1; distance <= 10; distance++) {
      for (const candidateIndex of [index - distance, index + distance]) {
        const line = paymentLines[candidateIndex];
        if (line && new RegExp(`\\b${payer}\\b`, "i").test(line.raw)) return payer;
      }
    }
    return null;
  };

  const loading = findPayer(loadingIndex, "REMITENTE");
  const unloading = findPayer(unloadingIndex, "DESTINATARIO");

  const lettersIndex = anchorIndex(paymentLines, "VALOR A PAGAR PACTADO EN LETRAS");
  let agreedWords: string | null = null;
  if (lettersIndex >= 0) {
    for (let i = lettersIndex; i < Math.min(paymentLines.length, lettersIndex + 28); i++) {
      const match = paymentLines[i]?.raw.match(/\b([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ]{20,}\s+PESOS\s+CON\s+[^\n]+)/i);
      if (match) {
        agreedWords = clean(match[1].replace(/\s+certifico.*$/i, ""));
        break;
      }
    }
  }

  return {
    totalTripValue: exactField(totalTripValue, section, "VALOR TOTAL DEL VIAJE", totalTripValue !== null ? 0.99 : 0),
    withholdingTax: exactField(withholdingTax, section, "RETENCION EN LA FUENTE", withholdingTax !== null ? 0.99 : 0),
    icaWithholding: exactField(icaWithholding, section, "RETENCION ICA", icaWithholding !== null ? 0.99 : 0),
    netValueToPay: exactField(netValueToPay, section, "VALOR NETO A PAGAR", netValueToPay !== null ? 0.99 : 0),
    advanceValue: exactField(advanceValue, section, "VALOR ANTICIPO", advanceValue !== null ? 0.99 : 0),
    balanceToPay: exactField(balanceToPay, section, "SALDO A PAGAR", balanceToPay !== null ? 0.99 : 0),
    paymentLocation: exactField(paymentLocation, section, "LUGAR", paymentLocation ? 0.99 : 0),
    paymentDate: exactField(paymentDate ? parseDate(paymentDate) : null, section, "FECHA", paymentDate ? 0.99 : 0),
    loadingPaidBy: exactField(loading, section, "CARGUE PAGADO POR", loading ? 0.99 : 0),
    unloadingPaidBy: exactField(unloading, section, "DESCARGUE PAGADO POR", unloading ? 0.99 : 0),
    agreedValueInWords: exactField(agreedWords, section, "VALOR A PAGAR PACTADO EN LETRAS", agreedWords ? 0.99 : 0),
  };
}

function parseRecommendations(): ExtractedField<string> {
  return emptyField("RECOMMENDATIONS");
}

function buildExtraction(text: string): ManifestExtraction {
  const parsed = parseSections(text);
  const lines = parsed.lines;

  // Variante Transportes Pacar: su primera página usa una distribución
  // diferente de columnas y nombres de encabezados. Se procesa con un
  // parser específico de layout, sin afectar las variantes anteriores.
  if (isPacarVariant(lines)) {
    return ManifestExtractionSchema.parse(parsePacar(lines));
  }

  const company = parseCompany(lines);
  const manifestInfo = parseManifestInformation(lines);
  const manifestHolder = parsePersonBlock(lines, "TITULAR MANIFIESTO", "VEHICLE_AND_DRIVER", "Titular Manifiesto", 10);
  const vehicleHolder = parsePersonBlock(lines, "POSEEDOR O TENEDOR DEL VEHICULO", "VEHICLE_HOLDER", "Poseedor o Tenedor del Vehiculo", 10);
  const driver = parseDriver(lines);
  const vehicle = parseVehicle(lines, [
    manifestHolder.identificationNumber.value ?? "",
    vehicleHolder.identificationNumber.value ?? "",
    driver.identificationNumber.value ?? "",
  ].filter(Boolean));

  const people = { manifestHolder, vehicleHolder, driver, vehicle };
  const cargoAndParties = parseCargoAndParties(lines);
  const payment = extractPayment(lines);
  const recommendations = parseRecommendations();

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

export function getFieldsForReview(extraction: ManifestExtraction) {
  const fields: Array<{
    path: string;
    value: unknown;
    confidence: number;
    section: string;
  }> = [];

  const visit = (value: unknown, path = "") => {
    if (!value || typeof value !== "object") return;
    if ("value" in value && "confidence" in value && "section" in value) {
      const field = value as ExtractedField<unknown>;
      if (field.confidence <= 0.95) {
        fields.push({
          path,
          value: field.value,
          confidence: field.confidence,
          section: field.section,
        });
      }
      return;
    }
    Object.entries(value).forEach(([key, child]) => visit(child, path ? `${path}.${key}` : key));
  };

  visit(extraction);
  return fields;
}

export function summarizeConfidence(extraction: ManifestExtraction) {
  const counters = { total: 0, autoSave: 0, review: 0, manual: 0 };
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if ("value" in value && "confidence" in value) {
      const field = value as ExtractedField<unknown>;
      counters.total += 1;
      if (field.confidence > 0.95) counters.autoSave += 1;
      else if (field.confidence >= 0.75) counters.review += 1;
      else counters.manual += 1;
      return;
    }
    Object.values(value).forEach(visit);
  };
  visit(extraction);
  return counters;
}
