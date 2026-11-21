import { prisma } from "../lib/prisma";
import { ManifestJobStatus } from "../generated/prisma/enums";
import type { StoredPdf } from "../lib/storage";
import type {
  CreateManifestJobInput,
  CreateManifestJobResult,
} from "../types/manifest-job";

/** Un job PROCESSING sin avance en este tiempo se considera abandonado. */
export const STALE_PROCESSING_MS = 5 * 60 * 1000;

const jobSummarySelect = {
  id: true,
  status: true,
  storageProvider: true,
  driveFileId: true,
  driveFileUrl: true,
  manifestId: true,
  startedAt: true,
} as const;

type JobSummary = {
  id: bigint;
  status: ManifestJobStatus;
  storageProvider: string | null;
  driveFileId: string | null;
  driveFileUrl: string | null;
  manifestId: bigint | null;
  startedAt: Date | null;
};

export function getProcessingMode(): "sync" | "pubsub" {
  return process.env.PROCESSING_MODE === "pubsub" ? "pubsub" : "sync";
}

/**
 * ¿Se puede volver a intentar el cargue de un job existente?
 * - UPLOADED / ERROR: siempre.
 * - QUEUED: solo en modo síncrono (nadie más lo va a procesar).
 * - PROCESSING: solo si quedó abandonado (p. ej. la función se cortó).
 */
function isRetryable(job: JobSummary): boolean {
  switch (job.status) {
    case ManifestJobStatus.UPLOADED:
    case ManifestJobStatus.ERROR:
      return true;
    case ManifestJobStatus.QUEUED:
      return getProcessingMode() === "sync";
    case ManifestJobStatus.PROCESSING:
      return !job.startedAt || Date.now() - job.startedAt.getTime() > STALE_PROCESSING_MS;
    default:
      return false;
  }
}

function toResult(job: JobSummary, created: boolean): CreateManifestJobResult {
  return {
    id: job.id,
    created,
    status: job.status,
    storageProvider: job.storageProvider,
    driveFileId: job.driveFileId,
    driveFileUrl: job.driveFileUrl,
    manifestId: job.manifestId,
  };
}

async function resolveExisting(existing: JobSummary): Promise<CreateManifestJobResult> {
  if (!isRetryable(existing)) return toResult(existing, false);

  const retriedJob = await prisma.manifestJob.update({
    where: { id: existing.id },
    data: {
      status: ManifestJobStatus.UPLOADED,
      errorMessage: null,
      completedAt: null,
      updatedAt: new Date(),
    },
    select: jobSummarySelect,
  });

  return toResult(retriedJob, true);
}

export async function createManifestJob(
  input: CreateManifestJobInput,
): Promise<CreateManifestJobResult> {
  const existing = await prisma.manifestJob.findUnique({
    where: { fileHash: input.fileHash },
    select: jobSummarySelect,
  });

  if (existing) return resolveExisting(existing);

  try {
    const job = await prisma.manifestJob.create({
      data: {
        originalFileName: input.originalFileName,
        fileHash: input.fileHash,
        fileSize: input.fileSize ?? null,
        status: ManifestJobStatus.UPLOADED,
      },
      select: jobSummarySelect,
    });

    return toResult(job, true);
  } catch (error) {
    // Si dos cargas llegan al mismo tiempo, la restricción UNIQUE de fileHash
    // garantiza que solo una cree el job. Recuperamos el existente.
    const existingAfterRace = await prisma.manifestJob.findUnique({
      where: { fileHash: input.fileHash },
      select: jobSummarySelect,
    });

    if (existingAfterRace) return resolveExisting(existingAfterRace);

    throw error;
  }
}

export async function updateManifestJobStorage(jobId: bigint, stored: StoredPdf) {
  return prisma.manifestJob.update({
    where: { id: jobId },
    data: {
      storageProvider: stored.provider,
      storageKey: stored.key,
      pdfData: stored.data ? new Uint8Array(stored.data) : undefined,
      ...(stored.driveFileId
        ? { driveFileId: stored.driveFileId, driveFileUrl: stored.url }
        : {}),
      updatedAt: new Date(),
    },
    select: { id: true },
  });
}

export async function markManifestJobQueued(jobId: bigint) {
  return prisma.manifestJob.update({
    where: { id: jobId },
    data: {
      status: ManifestJobStatus.QUEUED,
      updatedAt: new Date(),
    },
    select: { id: true },
  });
}

export async function markManifestJobError(
  jobId: bigint,
  errorMessage: string,
) {
  return prisma.manifestJob.update({
    where: { id: jobId },
    data: {
      status: ManifestJobStatus.ERROR,
      errorMessage: errorMessage.slice(0, 2000),
      completedAt: new Date(),
      updatedAt: new Date(),
    },
    select: { id: true },
  });
}

/** Campos del job para listados y detalle. Nunca incluye pdfData. */
export const manifestJobPublicSelect = {
  id: true,
  originalFileName: true,
  fileHash: true,
  fileSize: true,
  storageProvider: true,
  storageKey: true,
  driveFileId: true,
  driveFileUrl: true,
  overallConfidence: true,
  manifestId: true,
  documentType: true,
  status: true,
  attempts: true,
  errorMessage: true,
  createdAt: true,
  updatedAt: true,
  startedAt: true,
  completedAt: true,
  reviewedAt: true,
} as const;

export async function listManifestJobs(input: {
  statuses?: ManifestJobStatus[];
  take?: number;
} = {}) {
  return prisma.manifestJob.findMany({
    where: input.statuses?.length ? { status: { in: input.statuses } } : undefined,
    orderBy: { createdAt: "desc" },
    take: input.take ?? 100,
    select: {
      ...manifestJobPublicSelect,
      manifest: { select: { id: true, manifestNumber: true } },
      supportingDocument: { select: supportingDocumentSummarySelect },
    },
  });
}

const supportingDocumentSummarySelect = {
  id: true,
  documentType: true,
  documentNumber: true,
  manifestId: true,
  manifestNumber: true,
  linkMethod: true,
} as const;

export async function getManifestJob(jobId: bigint) {
  return prisma.manifestJob.findUnique({
    where: { id: jobId },
    select: {
      ...manifestJobPublicSelect,
      rawText: true,
      extractedJson: true,
      manifest: { select: { id: true, manifestNumber: true } },
      supportingDocument: { select: supportingDocumentSummarySelect },
      corrections: { orderBy: { createdAt: "asc" } },
    },
  });
}
