import type { StructuredTextItem } from "unpdf";
import { cellText, findLabel, readTable, toGridItems, type GridItem } from "./layout-grid";
import { parseFlexibleDate, parseQuantityValue } from "./template-parsers";

/**
 * Documentos soporte del viaje (no son manifiestos):
 *
 * - REMITTANCE: "Remesa" de OPL CARGA SAS. Trae el número de remesa, el número
 *   de manifiesto (No. Mfto), remitente/destinatario, poseedor y carga.
 * - LOADING_ORDER: "Orden de cargue" de OPL CARGA SAS. No trae el número de
 *   manifiesto, pero sí todos los datos del conductor y del vehículo (marca,
 *   motor, chasis, tráiler, capacidad).
 *
 * Se leen por coordenadas, ubicando cada dato por su etiqueta, igual que los
 * parsers de manifiestos. Un dato que no aparece queda en null; nunca se inventa.
 */

export type SupportingDocumentType = "REMITTANCE" | "LOADING_ORDER";

export const SUPPORTING_DOCUMENT_LABELS: Record<SupportingDocumentType, string> = {
  REMITTANCE: "Remesa",
  LOADING_ORDER: "Orden de cargue",
};

type Text = string | null;

export interface SupportingDocumentData {
  documentType: SupportingDocumentType;
  /** No. Remesa o ID Orden Carga. */
  documentNumber: Text;
  /** Número de manifiesto al que pertenece (solo lo trae la remesa). */
  manifestNumber: Text;
  authorizationNumber: Text;
  /** Fecha del documento en formato YYYY-MM-DD. */
  issueDate: Text;
  origin: Text;
  destination: Text;
  company: { name: Text; nit: Text; agency: Text; address: Text; phone: Text };
  sender: { name: Text; address: Text; phone: Text; city: Text };
  recipient: { name: Text; address: Text; phone: Text; city: Text };
  vehicle: {
    plate: Text;
    brand: Text;
    model: Text;
    color: Text;
    engineNumber: Text;
    chassisNumber: Text;
    trailerPlate: Text;
    trailerBrand: Text;
    capacity: number | null;
  };
  vehicleHolder: {
    name: Text;
    identificationNumber: Text;
    address: Text;
    phone: Text;
    mobile: Text;
    city: Text;
  };
  driver: { name: Text; identificationNumber: Text; address: Text; phone: Text; mobile: Text };
  cargo: {
    packaging: Text;
    nature: Text;
    measurementUnit: Text;
    quantity: number | null;
    weight: number | null;
    product: Text;
    unCode: Text;
    orderNumber: Text;
  };
  issuedBy: { user: Text; date: Text; time: Text };
}

/** Etiquetas para mostrar los datos extraídos, agrupados por sección. */
export const SUPPORTING_DOCUMENT_SECTIONS: Array<{ title: string; fields: Array<[path: string, label: string]> }> = [
  {
    title: "Documento",
    fields: [
      ["documentNumber", "Número"],
      ["manifestNumber", "Manifiesto"],
      ["authorizationNumber", "Autorización"],
      ["issueDate", "Fecha"],
      ["origin", "Origen"],
      ["destination", "Destino"],
    ],
  },
  {
    title: "Empresa transportadora",
    fields: [
      ["company.name", "Nombre"],
      ["company.nit", "NIT"],
      ["company.agency", "Agencia"],
      ["company.address", "Dirección"],
      ["company.phone", "Teléfono"],
    ],
  },
  {
    title: "Conductor",
    fields: [
      ["driver.name", "Nombre"],
      ["driver.identificationNumber", "Cédula"],
      ["driver.address", "Dirección"],
      ["driver.phone", "Teléfono"],
      ["driver.mobile", "Celular"],
    ],
  },
  {
    title: "Vehículo",
    fields: [
      ["vehicle.plate", "Placa"],
      ["vehicle.brand", "Marca"],
      ["vehicle.model", "Modelo"],
      ["vehicle.color", "Color"],
      ["vehicle.engineNumber", "Motor"],
      ["vehicle.chassisNumber", "Chasis"],
      ["vehicle.trailerPlate", "Tráiler"],
      ["vehicle.trailerBrand", "Marca tráiler"],
      ["vehicle.capacity", "Capacidad"],
    ],
  },
  {
    title: "Poseedor / propietario",
    fields: [
      ["vehicleHolder.name", "Nombre"],
      ["vehicleHolder.identificationNumber", "Identificación"],
      ["vehicleHolder.address", "Dirección"],
      ["vehicleHolder.city", "Ciudad"],
      ["vehicleHolder.phone", "Teléfono"],
      ["vehicleHolder.mobile", "Celular"],
    ],
  },
  {
    title: "Remitente",
    fields: [
      ["sender.name", "Nombre"],
      ["sender.address", "Dirección"],
      ["sender.city", "Ciudad"],
      ["sender.phone", "Teléfono"],
    ],
  },
  {
    title: "Destinatario",
    fields: [
      ["recipient.name", "Nombre"],
      ["recipient.address", "Dirección"],
      ["recipient.city", "Ciudad"],
      ["recipient.phone", "Teléfono"],
    ],
  },
  {
    title: "Carga",
    fields: [
      ["cargo.packaging", "Empaque"],
      ["cargo.nature", "Naturaleza"],
      ["cargo.measurementUnit", "Unidad de medida"],
      ["cargo.quantity", "Cantidad"],
      ["cargo.weight", "Peso"],
      ["cargo.product", "Producto / contenido"],
      ["cargo.unCode", "Código UN"],
      ["cargo.orderNumber", "N. pedido"],
    ],
  },
  {
    title: "Generado por",
    fields: [
      ["issuedBy.user", "Usuario"],
      ["issuedBy.date", "Fecha"],
      ["issuedBy.time", "Hora"],
    ],
  },
];

export function getSupportingDocumentValue(data: SupportingDocumentData, path: string): string | number | null {
  let current: unknown = data;
  for (const key of path.split(".")) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" || typeof current === "number" ? current : null;
}

// =====================================================================
// Utilidades de lectura
// =====================================================================

/**
 * Estos PDF dibujan algunos textos de forma progresiva: "KR", "KR 152",
 * "KR 152 21"... en la misma posición. Se conserva solo el más largo.
 */
function dedupeProgressiveItems(items: GridItem[]): GridItem[] {
  const result: GridItem[] = [];
  for (const item of items) {
    const sameSpot = result.findIndex(
      (other) =>
        Math.abs(other.y - item.y) <= 0.6 &&
        Math.abs(other.x - item.x) <= 0.6 &&
        (other.norm.startsWith(item.norm) || item.norm.startsWith(other.norm)),
    );
    if (sameSpot === -1) {
      result.push(item);
    } else if (item.x2 > result[sameSpot]!.x2) {
      result[sameSpot] = item;
    }
  }
  return result;
}

function clean(value: string | null | undefined): Text {
  const result = value?.replace(/\s+/g, " ").trim();
  if (!result || /^NULL$/i.test(result)) return null;
  return result;
}

function digits(value: Text): Text {
  const result = value?.replace(/[^\d-]/g, "");
  return result ? result : null;
}

const isLabelText = (item: GridItem) => /:$/.test(item.text);

interface Region {
  top?: number;
  bottom?: number;
  minX?: number;
  maxX?: number;
}

function inRegion(item: GridItem, region: Region) {
  return (
    (region.top === undefined || item.y < region.top) &&
    (region.bottom === undefined || item.y > region.bottom) &&
    (region.minX === undefined || item.x >= region.minX) &&
    (region.maxX === undefined || item.x < region.maxX)
  );
}

class DocumentReader {
  constructor(private readonly items: GridItem[]) {}

  find(pattern: RegExp, region: Region = {}) {
    return this.items.find((item) => pattern.test(item.norm) && inRegion(item, region));
  }

  /**
   * Valor de una etiqueta "Etiqueta:": el texto a su derecha en la misma
   * línea (hasta la siguiente etiqueta) y, si el valor se parte en varios
   * renglones, los renglones que siguen justo debajo con la misma sangría.
   * También acepta el valor en el mismo elemento ("NIT: 900068426-1").
   */
  value(pattern: RegExp, region: Region = {}, options: { multiline?: boolean } = {}): Text {
    const label = this.items.find(
      (item) => inRegion(item, region) && pattern.test(item.norm.replace(/:.*$/, ":")),
    );
    if (!label) return null;

    const inline = label.text.match(/^[^:]+:\s*(.+)$/);
    if (inline) return clean(inline[1]);

    const sameLine = this.items
      .filter((item) => item !== label && Math.abs(item.y - label.y) <= 2 && item.x >= label.x2 - 2)
      .sort((a, b) => a.x - b.x);
    const nextLabel = sameLine.find(isLabelText);
    const values = sameLine.filter((item) => !isLabelText(item) && (!nextLabel || item.x < nextLabel.x));
    if (values.length === 0) return null;

    const parts = values.map((item) => item.text);
    if (options.multiline !== false) {
      const left = values[0]!.x;
      const right = nextLabel ? nextLabel.x : Number.POSITIVE_INFINITY;
      let lineY = label.y;
      for (;;) {
        const next = this.items
          .filter(
            (item) =>
              lineY - item.y >= 6 &&
              lineY - item.y <= 9.5 &&
              Math.abs(item.x - left) <= 6 &&
              item.x < right &&
              !isLabelText(item),
          )
          .sort((a, b) => b.y - a.y)[0];
        if (!next) break;
        parts.push(next.text);
        lineY = next.y;
      }
    }
    return clean(parts.join(" "));
  }

  /** Nombre de la empresa: el texto justo encima del NIT del encabezado. */
  companyName(nitLabel: GridItem | undefined): Text {
    if (!nitLabel) return null;
    const above = this.items
      .filter((item) => item.y - nitLabel.y > 1.5 && item.y - nitLabel.y <= 20 && Math.abs(item.x - nitLabel.x) <= 3)
      .sort((a, b) => a.y - b.y)[0];
    return clean(above?.text);
  }

  footer() {
    const user = this.items.find((item) => /^NOMBRE DE USUARIO:/.test(item.norm));
    if (!user) return { user: null, date: null, time: null };
    const sameLine = this.items.filter((item) => Math.abs(item.y - user.y) <= 2);
    const after = (prefix: RegExp) => {
      const found = sameLine.find((item) => prefix.test(item.norm));
      return clean(found?.text.replace(/^[^:]+:\s*/, ""));
    };
    return {
      user: clean(user.text.replace(/^[^:]+:\s*/, "")),
      date: after(/^FECHA:/),
      time: after(/^HORA:/),
    };
  }

  get all() {
    return this.items;
  }
}

function prepare(firstPageItems: StructuredTextItem[]) {
  return new DocumentReader(dedupeProgressiveItems(toGridItems(firstPageItems)));
}

// =====================================================================
// Detección
// =====================================================================

export function detectSupportingDocument(firstPageItems: StructuredTextItem[] | undefined): SupportingDocumentType | null {
  if (!firstPageItems?.length) return null;
  const items = toGridItems(firstPageItems);
  // Un manifiesto OPL también trae "Número Remesa": se descarta primero.
  if (findLabel(items, /^INFO\.REMITENTE$/) || findLabel(items, /^MANIFIESTO ELECTRONICO/)) return null;

  if (findLabel(items, /^ORDEN DE CARGUE$/) && findLabel(items, /^ID ORDEN CARGA:/)) return "LOADING_ORDER";
  if (findLabel(items, /^NO\. REMESA:/) && findLabel(items, /^DESCRIPCION DE LA CARGA$/)) return "REMITTANCE";
  return null;
}

// =====================================================================
// Encabezado común (empresa, fecha, origen y destino)
// =====================================================================

function readHeader(reader: DocumentReader) {
  const nitItem = reader.find(/^NIT:/);
  const dateLabel = reader.find(/^FECHA:$/);
  const top = nitItem ? nitItem.y + 30 : undefined;
  const headerBottom = dateLabel ? dateLabel.y + 2 : undefined;
  const companyRegion: Region = { top, bottom: headerBottom, maxX: 420 };
  const rightRegion: Region = { top, bottom: headerBottom, minX: 420 };
  const tripRegion: Region = dateLabel ? { top: dateLabel.y + 2, bottom: dateLabel.y - 2 } : {};

  return {
    company: {
      name: reader.companyName(nitItem),
      nit: clean(nitItem?.text.replace(/^[^:]+:\s*/, "")),
      agency: reader.value(/^AGENCIA:$/, rightRegion, { multiline: false }),
      address: reader.value(/^DIRECCION:$/, companyRegion),
      phone: digits(reader.value(/^TELEFONO:$/, companyRegion, { multiline: false })),
    },
    rightRegion,
    issueDate: parseFlexibleDate(reader.value(/^FECHA:$/, tripRegion, { multiline: false })),
    origin: reader.value(/^ORIGEN:$/, tripRegion, { multiline: false }),
    destination: reader.value(/^DESTINO:$/, tripRegion, { multiline: false }),
    dateY: dateLabel?.y,
  };
}

function emptyData(documentType: SupportingDocumentType): SupportingDocumentData {
  return {
    documentType,
    documentNumber: null,
    manifestNumber: null,
    authorizationNumber: null,
    issueDate: null,
    origin: null,
    destination: null,
    company: { name: null, nit: null, agency: null, address: null, phone: null },
    sender: { name: null, address: null, phone: null, city: null },
    recipient: { name: null, address: null, phone: null, city: null },
    vehicle: {
      plate: null,
      brand: null,
      model: null,
      color: null,
      engineNumber: null,
      chassisNumber: null,
      trailerPlate: null,
      trailerBrand: null,
      capacity: null,
    },
    vehicleHolder: { name: null, identificationNumber: null, address: null, phone: null, mobile: null, city: null },
    driver: { name: null, identificationNumber: null, address: null, phone: null, mobile: null },
    cargo: {
      packaging: null,
      nature: null,
      measurementUnit: null,
      quantity: null,
      weight: null,
      product: null,
      unCode: null,
      orderNumber: null,
    },
    issuedBy: { user: null, date: null, time: null },
  };
}

// =====================================================================
// Remesa
// =====================================================================

export function parseRemittance(firstPageItems: StructuredTextItem[]): SupportingDocumentData {
  const reader = prepare(firstPageItems);
  const header = readHeader(reader);
  const data = emptyData("REMITTANCE");

  data.company = header.company;
  data.issueDate = header.issueDate;
  data.origin = header.origin;
  data.destination = header.destination;
  data.documentNumber = digits(reader.value(/^NO\. REMESA:$/, header.rightRegion, { multiline: false }));
  data.manifestNumber = digits(reader.value(/^NO\. MFTO:$/, header.rightRegion, { multiline: false }));
  data.authorizationNumber = digits(reader.value(/^AUTORIZACION:$/, header.rightRegion, { multiline: false }));

  const partiesTop = header.dateY;
  const holderHeader = reader.find(/^PLACA$/);
  const partiesBottom = holderHeader?.y;
  const left: Region = { top: partiesTop, bottom: partiesBottom, maxX: 340 };
  const right: Region = { top: partiesTop, bottom: partiesBottom, minX: 340 };

  data.sender = {
    name: reader.value(/^REMITENTE:$/, left),
    address: reader.value(/^DIRECCION ORIGEN:$/, left),
    phone: digits(reader.value(/^TELEFONO:$/, left, { multiline: false })),
    city: data.origin,
  };
  data.recipient = {
    name: reader.value(/^DESTINATARIO:$/, right),
    address: reader.value(/^DIRECCION DESTINO:$/, right),
    phone: digits(reader.value(/^TELEFONO:$/, right, { multiline: false })),
    city: data.destination,
  };

  // Tabla del poseedor: los valores pueden partirse en dos renglones (p. ej. "SON32" + "5").
  const holder = readTable(
    reader.all,
    holderHeader,
    [
      { key: "plate", pattern: /^PLACA$/ },
      { key: "id", pattern: /^CED\.?$/ },
      { key: "name", pattern: /^NOM\. POSEEDOR/ },
      { key: "address", pattern: /^DIR\. POSEEDOR/ },
      { key: "phone", pattern: /^TELEFONO$/ },
      { key: "city", pattern: /^CIU\. DIR\. POSEEDOR/ },
    ],
    { align: "overlap", depth: 36, ignore: [/^POSEEDOR$/, /^PROPIETARIO$/, /^CONDUCTOR:/] },
  );
  const joined = (cell: GridItem[] | undefined) => clean(cell?.map((item) => item.text).join(""));

  data.vehicle.plate = joined(holder.plate)?.toUpperCase() ?? null;
  data.vehicleHolder = {
    name: clean(cellText(holder.name)),
    identificationNumber: digits(joined(holder.id)),
    address: clean(cellText(holder.address)),
    phone: digits(joined(holder.phone)),
    mobile: null,
    city: clean(cellText(holder.city)),
  };

  data.driver.name = reader.value(/^CONDUCTOR:$/, {}, { multiline: false });
  data.driver.identificationNumber = digits(reader.value(/^CEDULA:$/, {}, { multiline: false }));

  const cargo = readTable(
    reader.all,
    reader.find(/^EMPAQUE$/),
    [
      { key: "packaging", pattern: /^EMPAQUE$/ },
      { key: "nature", pattern: /^NATURALEZA$/ },
      { key: "unit", pattern: /^UNIDAD MEDIDA$/ },
      { key: "quantity", pattern: /^CANTIDAD A CARGAR$/ },
      { key: "weight", pattern: /^PESO A CARGAR$/ },
      { key: "content", pattern: /^CONTENIDO$/ },
      { key: "unCode", pattern: /^CODIGO UN$/ },
      { key: "order", pattern: /^N\. PEDIDO$/ },
    ],
    { align: "overlap", depth: 28, ignore: [/^OBSERVACIONES/] },
  );
  data.cargo = {
    packaging: clean(cellText(cargo.packaging)),
    nature: clean(cellText(cargo.nature)),
    measurementUnit: clean(cellText(cargo.unit)),
    quantity: parseQuantityValue(cellText(cargo.quantity)),
    weight: parseQuantityValue(cellText(cargo.weight)),
    product: clean(cellText(cargo.content)),
    unCode: clean(cellText(cargo.unCode)),
    orderNumber: clean(cellText(cargo.order)),
  };

  data.issuedBy = reader.footer();
  return data;
}

// =====================================================================
// Orden de cargue
// =====================================================================

export function parseLoadingOrder(firstPageItems: StructuredTextItem[]): SupportingDocumentData {
  const reader = prepare(firstPageItems);
  const header = readHeader(reader);
  const data = emptyData("LOADING_ORDER");

  data.company = header.company;
  data.issueDate = header.issueDate;
  data.origin = header.origin;
  data.destination = header.destination;
  data.documentNumber = digits(reader.value(/^ID ORDEN CARGA:$/, header.rightRegion, { multiline: false }));

  const driverTitle = reader.find(/^DATOS DEL CONDUCTOR$/);
  const vehicleTitle = reader.find(/^DATOS DEL VEHICULO$/);
  const partiesTitle = reader.find(/^DATOS DEL REMITENTE$/);
  const cargoTitle = reader.find(/^DATOS DE LA MERCANCIA$/);

  const driverRegion: Region = { top: driverTitle?.y, bottom: vehicleTitle?.y };
  data.driver = {
    name: reader.value(/^NOMBRE:$/, driverRegion),
    identificationNumber: digits(reader.value(/^CC:$/, driverRegion, { multiline: false })),
    address: reader.value(/^DIRECCION:$/, driverRegion),
    phone: digits(reader.value(/^TELEFONO:$/, driverRegion, { multiline: false })),
    mobile: digits(reader.value(/^CELULAR:$/, driverRegion, { multiline: false })),
  };

  const vehicleRegion: Region = { top: vehicleTitle?.y, bottom: partiesTitle?.y };
  const single = (pattern: RegExp) => reader.value(pattern, vehicleRegion, { multiline: false });
  data.vehicleHolder = {
    name: reader.value(/^POSEEDOR:$/, vehicleRegion),
    identificationNumber: digits(single(/^CC:$/)),
    address: reader.value(/^DIRECCION:$/, vehicleRegion),
    phone: digits(single(/^TELEFONO:$/)),
    mobile: digits(single(/^CELULAR:$/)),
    city: null,
  };
  data.vehicle = {
    plate: single(/^PLACA:$/)?.replace(/\s+/g, "").toUpperCase() ?? null,
    brand: single(/^MARCA:$/),
    model: single(/^MODELO:$/),
    color: single(/^COLOR:$/),
    engineNumber: single(/^MOTOR:$/),
    chassisNumber: single(/^CHASIS:$/),
    trailerPlate: single(/^TRAILER:$/)?.replace(/\s+/g, "").toUpperCase() ?? null,
    trailerBrand: single(/^MARCA TRAILER:$/),
    capacity: parseQuantityValue(single(/^CAPACIDAD:$/)),
  };

  // Remitente a la izquierda, destinatario a la derecha (desde "DATOS DESTINATARIO").
  const recipientTitle = reader.find(/^DATOS DESTINATARIO$/);
  const split = recipientTitle ? recipientTitle.x - 75 : 290;
  const partiesRegion = { top: partiesTitle?.y, bottom: cargoTitle?.y };
  const left: Region = { ...partiesRegion, maxX: split };
  const right: Region = { ...partiesRegion, minX: split };
  for (const [target, region] of [
    [data.sender, left],
    [data.recipient, right],
  ] as const) {
    target.name = reader.value(/^NOMBRE:$/, region);
    target.address = reader.value(/^DIRECCION:$/, region);
    target.phone = digits(reader.value(/^TELEFONO:$/, region, { multiline: false }));
    target.city = reader.value(/^CIUDAD:$/, region, { multiline: false });
  }

  const cargo = readTable(
    reader.all,
    reader.find(/^CANTIDAD A CARGAR$/, { top: cargoTitle?.y }),
    [
      { key: "quantity", pattern: /^CANTIDAD A CARGAR$/ },
      { key: "weight", pattern: /^PESO A CARGAR$/ },
      { key: "unit", pattern: /^UNIDAD MEDIDA$/ },
      { key: "packaging", pattern: /^EMPAQUE$/ },
      { key: "product", pattern: /^PRODUCTO TRANSPORTADO$/ },
      { key: "unCode", pattern: /^CODIGO UN$/ },
    ],
    { align: "overlap", depth: 28, ignore: [/^OBSERVACIONES/, /^FIRMA DEL CONDUCTOR/] },
  );
  data.cargo = {
    packaging: clean(cellText(cargo.packaging)),
    nature: null,
    measurementUnit: clean(cellText(cargo.unit)),
    quantity: parseQuantityValue(cellText(cargo.quantity)),
    weight: parseQuantityValue(cellText(cargo.weight)),
    product: clean(cellText(cargo.product)),
    unCode: clean(cellText(cargo.unCode)),
    orderNumber: null,
  };

  data.issuedBy = reader.footer();
  return data;
}

export function parseSupportingDocument(
  documentType: SupportingDocumentType,
  firstPageItems: StructuredTextItem[],
): SupportingDocumentData {
  return documentType === "REMITTANCE" ? parseRemittance(firstPageItems) : parseLoadingOrder(firstPageItems);
}

/** Campos sin los cuales el documento no se puede guardar ni vincular. */
export function missingSupportingFields(data: SupportingDocumentData): string[] {
  const missing: string[] = [];
  if (!data.documentNumber) missing.push(data.documentType === "REMITTANCE" ? "No. Remesa" : "ID Orden Carga");
  if (!data.issueDate) missing.push("Fecha");
  if (!data.vehicle.plate) missing.push("Placa");
  return missing;
}
