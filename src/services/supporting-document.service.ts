import { prisma } from "../lib/prisma";
import { DocumentType, ManifestJobStatus } from "../generated/prisma/enums";
import type { Prisma } from "../generated/prisma/client";
import {
  missingSupportingFields,
  SUPPORTING_DOCUMENT_LABELS,
  type SupportingDocumentData,
  type SupportingDocumentType,
} from "../lib/manifiestos_parser/supporting-document-parser";

/**
 * Remesas y órdenes de cargue: se guardan en `supporting_documents` y se
 * vinculan al manifiesto del viaje con estas reglas, en orden:
 *
 * 1. MANIFEST_NUMBER: el documento trae el número de manifiesto (la remesa: "No. Mfto").
 * 2. REMITTANCE_NUMBER: el número de la remesa coincide con la remesa del manifiesto.
 * 3. TRIP_MATCH: misma placa, mismo conductor y fecha cercana. Para una orden
 *    de cargue se usa primero la remesa del mismo viaje (que sí trae el número
 *    de manifiesto) y, si no hay, se busca un único manifiesto que coincida.
 * 4. MANUAL: el usuario escribe el número de manifiesto.
 *
 * Si el manifiesto aún no se ha cargado, el documento queda pendiente y se
 * vincula solo cuando llegue (ver linkDocumentsForManifest).
 */

export type LinkMethod = "MANIFEST_NUMBER" | "REMITTANCE_NUMBER" | "TRIP_MATCH" | "MANUAL";

export const LINK_METHOD_LABELS: Record<LinkMethod, string> = {
  MANIFEST_NUMBER: "por número de manifiesto",
  REMITTANCE_NUMBER: "por número de remesa",
  TRIP_MATCH: "por placa, conductor y fecha",
  MANUAL: "manualmente",
};

/** Días alrededor de la fecha del documento en que se busca el manifiesto. */
const DAYS_BEFORE = 1;
const DAYS_AFTER = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface StoredSupportingDocument {
  version: 1;
  kind: "SUPPORTING_DOCUMENT";
  documentType: SupportingDocumentType;
  pageCount: number;
  document: SupportingDocumentData;
}

export function parseStoredSupportingDocument(value: unknown): StoredSupportingDocument | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.kind !== "SUPPORTING_DOCUMENT" || !record.document) return null;
  return record as unknown as StoredSupportingDocument;
}

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function documentLabel(type: SupportingDocumentType) {
  return SUPPORTING_DOCUMENT_LABELS[type].toLowerCase();
}

export class SupportingDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupportingDocumentError";
  }
}

/**
 * Guarda los datos extraídos de una remesa u orden de cargue, deja el job
 * COMPLETED e intenta vincularlo a su manifiesto.
 */
export async function saveSupportingDocument(input: {
  jobId: bigint;
  data: SupportingDocumentData;
  rawText: string;
  pageCount: number;
}) {
  const { jobId, data } = input;
  const missing = missingSupportingFields(data);
  const now = new Date();

  const stored: StoredSupportingDocument = {
    version: 1,
    kind: "SUPPORTING_DOCUMENT",
    documentType: data.documentType,
    pageCount: input.pageCount,
    document: data,
  };
  const json = JSON.parse(JSON.stringify(stored)) as Prisma.InputJsonValue;

  // Sin número no hay forma de identificar ni vincular el documento.
  if (!data.documentNumber) {
    await prisma.manifestJob.update({
      where: { id: jobId },
      data: {
        documentType: data.documentType,
        rawText: input.rawText,
        extractedJson: json,
        updatedAt: now,
      },
    });
    throw new SupportingDocumentError(
      `Se reconoció una ${documentLabel(data.documentType)}, pero no se pudo leer: ${missing.join(", ")}.`,
    );
  }

  const fields = {
    documentType: data.documentType as DocumentType,
    documentNumber: data.documentNumber,
    companyNit: data.company.nit,
    companyName: data.company.name,
    issueDate: toDate(data.issueDate),
    origin: data.origin,
    destination: data.destination,
    vehiclePlate: data.vehicle.plate,
    driverIdentification: data.driver.identificationNumber,
    driverName: data.driver.name,
    data: json,
  };

  const document = await prisma.$transaction(async (tx) => {
    await tx.manifestJob.update({
      where: { id: jobId },
      data: {
        documentType: data.documentType,
        rawText: input.rawText,
        extractedJson: json,
        overallConfidence: null,
        status: ManifestJobStatus.COMPLETED,
        errorMessage: missing.length ? `Datos no encontrados en el PDF: ${missing.join(", ")}.` : null,
        completedAt: now,
        updatedAt: now,
      },
    });

    const existing = await tx.supportingDocument.findUnique({ where: { jobId }, select: { linkMethod: true } });
    // Al reprocesar se conserva un vínculo manual; los automáticos se recalculan.
    const keepManual = existing?.linkMethod === "MANUAL";

    return tx.supportingDocument.upsert({
      where: { jobId },
      create: { jobId, ...fields, manifestNumber: data.manifestNumber, createdAt: now },
      update: {
        ...fields,
        ...(keepManual ? {} : { manifestNumber: data.manifestNumber, manifestId: null, linkMethod: null }),
        updatedAt: now,
      },
      select: { id: true },
    });
  });

  const link = await linkSupportingDocument(document.id);
  await linkTripSiblings(document.id);
  return { supportingDocumentId: document.id, ...link };
}

type DocumentForLink = {
  id: bigint;
  documentType: DocumentType;
  documentNumber: string;
  manifestNumber: string | null;
  manifestId: bigint | null;
  linkMethod: string | null;
  issueDate: Date | null;
  vehiclePlate: string | null;
  driverIdentification: string | null;
};

// En SQL, NOT (link_method = 'MANUAL') descarta los NULL: se incluyen aparte.
const NOT_MANUAL: Prisma.SupportingDocumentWhereInput = {
  OR: [{ linkMethod: null }, { linkMethod: { not: "MANUAL" } }],
};

const linkSelect = {
  id: true,
  documentType: true,
  documentNumber: true,
  manifestNumber: true,
  manifestId: true,
  linkMethod: true,
  issueDate: true,
  vehiclePlate: true,
  driverIdentification: true,
} as const;

async function findManifestForDocument(
  doc: DocumentForLink,
): Promise<{ manifestId: bigint | null; manifestNumber: string | null; method: LinkMethod | null }> {
  const none = { manifestId: null, manifestNumber: null, method: null };

  if (doc.documentType === DocumentType.REMITTANCE) {
    if (doc.manifestNumber) {
      const manifest = await prisma.manifest.findUnique({
        where: { manifestNumber: doc.manifestNumber },
        select: { id: true },
      });
      if (manifest) return { manifestId: manifest.id, manifestNumber: doc.manifestNumber, method: "MANIFEST_NUMBER" };
    }

    const manifests = await prisma.manifest.findMany({
      where: {
        cargo: { remittanceNumber: doc.documentNumber },
        ...(doc.vehiclePlate ? { vehicle: { plate: doc.vehiclePlate } } : {}),
      },
      select: { id: true, manifestNumber: true },
      take: 2,
    });
    if (manifests.length === 1) {
      return { manifestId: manifests[0]!.id, manifestNumber: manifests[0]!.manifestNumber, method: "REMITTANCE_NUMBER" };
    }

    // La remesa trae un número de manifiesto que todavía no se ha cargado:
    // se espera a ese manifiesto en lugar de adivinar otro.
    if (doc.manifestNumber) return { manifestId: null, manifestNumber: doc.manifestNumber, method: null };
  }

  if (!doc.vehiclePlate || !doc.issueDate) return none;

  // La orden de cargue no trae el número de manifiesto: se toma de la remesa del mismo viaje.
  if (doc.documentType !== DocumentType.REMITTANCE) {
    const sibling = await prisma.supportingDocument.findFirst({
      where: {
        id: { not: doc.id },
        documentType: DocumentType.REMITTANCE,
        manifestNumber: { not: null },
        vehiclePlate: doc.vehiclePlate,
        issueDate: doc.issueDate,
        ...(doc.driverIdentification ? { driverIdentification: doc.driverIdentification } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: { manifestNumber: true, manifestId: true },
    });
    if (sibling?.manifestNumber) {
      const manifestId =
        sibling.manifestId ??
        (await prisma.manifest.findUnique({ where: { manifestNumber: sibling.manifestNumber }, select: { id: true } }))?.id ??
        null;
      return { manifestId, manifestNumber: sibling.manifestNumber, method: manifestId ? "TRIP_MATCH" : null };
    }
  }

  const candidates = await prisma.manifest.findMany({
    where: {
      vehicle: { plate: doc.vehiclePlate },
      issueDate: {
        gte: new Date(doc.issueDate.getTime() - DAYS_BEFORE * DAY_MS),
        lte: new Date(doc.issueDate.getTime() + DAYS_AFTER * DAY_MS),
      },
      ...(doc.driverIdentification ? { driver: { identificationNumber: doc.driverIdentification } } : {}),
    },
    select: { id: true, manifestNumber: true },
    take: 2,
  });
  // Con dos o más candidatos no se adivina: lo vincula el usuario.
  if (candidates.length === 1) {
    return { manifestId: candidates[0]!.id, manifestNumber: candidates[0]!.manifestNumber, method: "TRIP_MATCH" };
  }
  return none;
}

/** Intenta vincular un documento soporte a su manifiesto. No toca los vínculos manuales. */
export async function linkSupportingDocument(id: bigint) {
  const doc = await prisma.supportingDocument.findUnique({ where: { id }, select: linkSelect });
  if (!doc) throw new SupportingDocumentError(`No existe el documento soporte ${id}.`);
  if (doc.manifestId || doc.linkMethod === "MANUAL") {
    return { manifestId: doc.manifestId, manifestNumber: doc.manifestNumber, method: doc.linkMethod as LinkMethod | null };
  }

  const found = await findManifestForDocument(doc);
  if (found.manifestId !== doc.manifestId || found.manifestNumber !== doc.manifestNumber) {
    await prisma.supportingDocument.update({
      where: { id },
      data: {
        manifestId: found.manifestId,
        manifestNumber: found.manifestNumber,
        linkMethod: found.method,
        updatedAt: new Date(),
      },
    });
  }
  return found;
}

/** Tras guardar o vincular una remesa, reintenta con las órdenes del mismo viaje. */
async function linkTripSiblings(id: bigint) {
  const doc = await prisma.supportingDocument.findUnique({ where: { id }, select: linkSelect });
  if (!doc?.vehiclePlate || !doc.issueDate) return;
  const siblings = await prisma.supportingDocument.findMany({
    where: {
      id: { not: id },
      manifestId: null,
      vehiclePlate: doc.vehiclePlate,
      issueDate: doc.issueDate,
      ...NOT_MANUAL,
    },
    select: { id: true },
  });
  for (const sibling of siblings) await linkSupportingDocument(sibling.id);
}

/** Al guardar un manifiesto, vincula los documentos soporte que estaban esperando. */
export async function linkDocumentsForManifest(manifestId: bigint) {
  const manifest = await prisma.manifest.findUnique({
    where: { id: manifestId },
    select: {
      manifestNumber: true,
      issueDate: true,
      cargo: { select: { remittanceNumber: true } },
      vehicle: { select: { plate: true } },
    },
  });
  if (!manifest) return 0;

  const or: Prisma.SupportingDocumentWhereInput[] = [{ manifestNumber: manifest.manifestNumber }];
  if (manifest.cargo?.remittanceNumber) {
    or.push({ documentType: DocumentType.REMITTANCE, documentNumber: manifest.cargo.remittanceNumber });
  }
  if (manifest.vehicle?.plate) {
    or.push({
      vehiclePlate: manifest.vehicle.plate,
      issueDate: {
        gte: new Date(manifest.issueDate.getTime() - DAYS_AFTER * DAY_MS),
        lte: new Date(manifest.issueDate.getTime() + DAYS_BEFORE * DAY_MS),
      },
    });
  }

  const pending = await prisma.supportingDocument.findMany({
    where: { manifestId: null, AND: [NOT_MANUAL, { OR: or }] },
    orderBy: { createdAt: "asc" },
    select: { id: true, documentType: true },
  });
  // Primero las remesas: las órdenes de cargue heredan su número de manifiesto.
  const ordered = [
    ...pending.filter((doc) => doc.documentType === DocumentType.REMITTANCE),
    ...pending.filter((doc) => doc.documentType !== DocumentType.REMITTANCE),
  ];

  let linked = 0;
  for (const doc of ordered) {
    const result = await linkSupportingDocument(doc.id);
    if (result.manifestId === manifestId) linked += 1;
  }
  return linked;
}

/**
 * Vínculo manual: el usuario indica el número de manifiesto. Si ese
 * manifiesto aún no existe, el número queda guardado y el documento se
 * vincula cuando se cargue. Con un número vacío se quita el vínculo.
 */
export async function setSupportingDocumentManifest(id: bigint, manifestNumber: string | null) {
  const number = manifestNumber?.trim() || null;
  const manifest = number
    ? await prisma.manifest.findUnique({ where: { manifestNumber: number }, select: { id: true, manifestNumber: true } })
    : null;

  const updated = await prisma.supportingDocument.update({
    where: { id },
    data: {
      manifestNumber: number,
      manifestId: manifest?.id ?? null,
      linkMethod: number ? "MANUAL" : null,
      updatedAt: new Date(),
    },
    select: { id: true, manifestId: true, manifestNumber: true, linkMethod: true },
  });
  if (manifest) await linkTripSiblings(id);
  return { ...updated, manifestFound: Boolean(manifest) };
}

export async function listSupportingDocuments(input: { unlinkedOnly?: boolean; take?: number } = {}) {
  return prisma.supportingDocument.findMany({
    where: input.unlinkedOnly ? { manifestId: null } : undefined,
    orderBy: [{ issueDate: "desc" }, { id: "desc" }],
    take: input.take ?? 100,
    select: {
      id: true,
      jobId: true,
      documentType: true,
      documentNumber: true,
      manifestNumber: true,
      manifestId: true,
      linkMethod: true,
      issueDate: true,
      origin: true,
      destination: true,
      vehiclePlate: true,
      driverName: true,
      companyName: true,
      job: { select: { originalFileName: true } },
    },
  });
}
