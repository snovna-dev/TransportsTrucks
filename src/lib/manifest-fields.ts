/**
 * Catálogo de campos del manifiesto: etiquetas en español, tipo de dato y
 * reglas de obligatoriedad. Lo usan la extracción, la revisión y la interfaz.
 */

export type FieldKind = "string" | "number" | "date";

export type FieldRequirement =
  /** Sin este valor no se puede guardar el Manifest (identidad o restricciones NOT NULL). */
  | "MUST_HAVE"
  /** Se espera en el PDF; si falta o tiene baja confianza, el manifiesto pasa a revisión, pero se puede guardar vacío. */
  | "EXPECTED"
  /** Puede no existir en algunas variantes (semirremolque, SOAT...). Solo se revisa si viene con baja confianza. */
  | "OPTIONAL_CHECKED"
  /** Informativo: nunca bloquea. */
  | "OPTIONAL";

export interface FieldDefinition {
  path: string;
  label: string;
  group: string;
  kind: FieldKind;
  requirement: FieldRequirement;
}

const F = (
  path: string,
  label: string,
  requirement: FieldRequirement = "OPTIONAL",
  kind: FieldKind = "string",
): Omit<FieldDefinition, "group"> => ({ path, label, requirement, kind });

const GROUPS: Array<{ group: string; fields: Array<Omit<FieldDefinition, "group">> }> = [
  {
    group: "Empresa de transporte",
    fields: [
      F("company.nit", "NIT", "MUST_HAVE"),
      F("company.name", "Razón social", "MUST_HAVE"),
      F("company.address", "Dirección"),
      F("company.phone", "Teléfono"),
      F("company.city", "Ciudad"),
    ],
  },
  {
    group: "Manifiesto",
    fields: [
      F("manifest.manifestNumber", "Número de manifiesto", "MUST_HAVE"),
      F("manifest.authorizationNumber", "Número de autorización", "EXPECTED"),
      F("manifest.issueDate", "Fecha de expedición", "MUST_HAVE", "date"),
      F("manifest.manifestType", "Tipo de manifiesto", "EXPECTED"),
      F("manifest.origin", "Origen", "EXPECTED"),
      F("manifest.intermediateCity", "Ciudad intermedia"),
      F("manifest.destination", "Destino", "EXPECTED"),
      F("manifest.policyOwnerName", "Tomador de la póliza"),
    ],
  },
  {
    group: "Valores y pago",
    fields: [
      F("manifest.totalTripValue", "Valor total del viaje", "OPTIONAL", "number"),
      F("manifest.withholdingTax", "Retención en la fuente", "OPTIONAL", "number"),
      F("manifest.icaWithholding", "Retención ICA", "OPTIONAL", "number"),
      F("manifest.netValueToPay", "Valor neto a pagar", "OPTIONAL", "number"),
      F("manifest.advanceValue", "Valor anticipo", "OPTIONAL", "number"),
      F("manifest.balanceToPay", "Saldo a pagar", "OPTIONAL", "number"),
      F("manifest.paymentLocation", "Lugar de pago"),
      F("manifest.paymentDate", "Fecha de pago", "OPTIONAL", "date"),
      F("manifest.loadingPaidBy", "Cargue pagado por"),
      F("manifest.unloadingPaidBy", "Descargue pagado por"),
      F("manifest.agreedValueInWords", "Valor pactado en letras"),
      F("manifest.recommendations", "Recomendaciones"),
    ],
  },
  {
    group: "Titular del manifiesto",
    fields: [
      F("manifestHolder.identificationNumber", "Identificación", "EXPECTED"),
      F("manifestHolder.fullName", "Nombre", "EXPECTED"),
      F("manifestHolder.address", "Dirección"),
      F("manifestHolder.phone", "Teléfono"),
      F("manifestHolder.city", "Ciudad"),
    ],
  },
  {
    group: "Conductor",
    fields: [
      F("driver.identificationNumber", "Identificación", "MUST_HAVE"),
      F("driver.fullName", "Nombre", "MUST_HAVE"),
      F("driver.licenseCategory", "Categoría de licencia", "OPTIONAL_CHECKED"),
      F("driver.address", "Dirección"),
      F("driver.phone", "Teléfono"),
      F("driver.city", "Ciudad"),
    ],
  },
  {
    group: "Vehículo",
    fields: [
      F("vehicle.plate", "Placa", "MUST_HAVE"),
      F("vehicle.brand", "Marca", "OPTIONAL_CHECKED"),
      F("vehicle.semiTrailerPlate", "Placa semirremolque", "OPTIONAL_CHECKED"),
      F("vehicle.configuration", "Configuración", "OPTIONAL_CHECKED"),
      F("vehicle.emptyWeight", "Peso vacío", "OPTIONAL_CHECKED", "number"),
      F("vehicle.soatPolicyNumber", "Póliza SOAT", "OPTIONAL_CHECKED"),
      F("vehicle.soatInsuranceCompany", "Aseguradora SOAT", "OPTIONAL_CHECKED"),
      F("vehicle.soatExpirationDate", "Vencimiento SOAT", "OPTIONAL_CHECKED", "date"),
    ],
  },
  {
    group: "Tenedor del vehículo",
    fields: [
      F("vehicleHolder.identificationNumber", "Identificación", "EXPECTED"),
      F("vehicleHolder.fullName", "Nombre", "EXPECTED"),
      F("vehicleHolder.address", "Dirección"),
      F("vehicleHolder.phone", "Teléfono"),
      F("vehicleHolder.city", "Ciudad"),
    ],
  },
  {
    group: "Remitente, destinatario y propietario",
    fields: [
      F("sender.identificationNumber", "Remitente: identificación", "EXPECTED"),
      F("sender.name", "Remitente: nombre", "EXPECTED"),
      F("recipient.identificationNumber", "Destinatario: identificación", "EXPECTED"),
      F("recipient.name", "Destinatario: nombre", "EXPECTED"),
      F("cargoOwner.identificationNumber", "Propietario carga: identificación"),
      F("cargoOwner.name", "Propietario carga: nombre"),
    ],
  },
  {
    group: "Carga",
    fields: [
      F("cargo.remittanceNumber", "Número de remesa", "MUST_HAVE"),
      F("cargo.measurementUnit", "Unidad de medida", "EXPECTED"),
      F("cargo.quantity", "Cantidad", "EXPECTED", "number"),
      F("cargo.nature", "Naturaleza", "EXPECTED"),
      F("cargo.packaging", "Empaque", "EXPECTED"),
      F("cargo.productCode", "Código de producto", "EXPECTED"),
      F("cargo.transportedProduct", "Producto transportado", "EXPECTED"),
    ],
  },
];

export const FIELD_DEFINITIONS: FieldDefinition[] = GROUPS.flatMap(({ group, fields }) =>
  fields.map((field) => ({ ...field, group })),
);

export const FIELD_GROUPS = GROUPS.map(({ group }) => group);

const BY_PATH = new Map(FIELD_DEFINITIONS.map((field) => [field.path, field]));

export function getFieldDefinition(path: string): FieldDefinition | undefined {
  return BY_PATH.get(path);
}

export function getFieldLabel(path: string): string {
  const definition = BY_PATH.get(path);
  return definition ? `${definition.group} · ${definition.label}` : path;
}

/** Umbral por encima del cual un campo se considera confiable. */
export const FIELD_CONFIDENCE_OK = 0.95;
