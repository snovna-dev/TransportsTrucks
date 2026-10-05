import { prisma } from "../lib/prisma";
import { ManifestJobStatus } from "../generated/prisma/enums";
import type {
  CreateManifestJobInput,
  CreateManifestJobResult,
} from "../types/manifest-job";

export async function createManifestJob(
  input: CreateManifestJobInput,
): Promise<CreateManifestJobResult> {
  const existing = await prisma.manifestJob.findUnique({
    where: { fileHash: input.fileHash },
    select: {
      id: true,
      status: true,
      driveFileId: true,
      driveFileUrl: true,
    },
  });

  if (existing) {
    // Un job que todavía no llegó a QUEUED puede reintentarse.
    // Esto permite recuperar cargas que fallaron en Drive o Pub/Sub.
    const retryable =
      existing.status === ManifestJobStatus.UPLOADED ||
      existing.status === ManifestJobStatus.ERROR;

    if (!retryable) {
      return {
        id: existing.id,
        created: false,
        status: existing.status,
        driveFileId: existing.driveFileId,
        driveFileUrl: existing.driveFileUrl,
      };
    }

    const retriedJob = await prisma.manifestJob.update({
      where: { id: existing.id },
      data: {
        status: ManifestJobStatus.UPLOADED,
        errorMessage: null,
        completedAt: null,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        status: true,
        driveFileId: true,
        driveFileUrl: true,
      },
    });

    return {
      id: retriedJob.id,
      created: true,
      status: retriedJob.status,
      driveFileId: retriedJob.driveFileId,
      driveFileUrl: retriedJob.driveFileUrl,
    };
  }

  try {
    const job = await prisma.manifestJob.create({
      data: {
        originalFileName: input.originalFileName,
        fileHash: input.fileHash,
        status: ManifestJobStatus.UPLOADED,
      },
      select: {
        id: true,
        status: true,
        driveFileId: true,
        driveFileUrl: true,
      },
    });

    return {
      id: job.id,
      created: true,
      status: job.status,
      driveFileId: job.driveFileId,
      driveFileUrl: job.driveFileUrl,
    };
  } catch (error) {
    // Si dos cargas llegan al mismo tiempo, la restricción UNIQUE de fileHash
    // garantiza que solo una cree el job. Recuperamos el existente.
    const existingAfterRace = await prisma.manifestJob.findUnique({
      where: { fileHash: input.fileHash },
      select: {
        id: true,
        status: true,
        driveFileId: true,
        driveFileUrl: true,
      },
    });

    if (existingAfterRace) {
      const retryable =
        existingAfterRace.status === ManifestJobStatus.UPLOADED ||
        existingAfterRace.status === ManifestJobStatus.ERROR;

      if (!retryable) {
        return {
          id: existingAfterRace.id,
          created: false,
          status: existingAfterRace.status,
          driveFileId: existingAfterRace.driveFileId,
          driveFileUrl: existingAfterRace.driveFileUrl,
        };
      }

      const retriedJob = await prisma.manifestJob.update({
        where: { id: existingAfterRace.id },
        data: {
          status: ManifestJobStatus.UPLOADED,
          errorMessage: null,
          completedAt: null,
          updatedAt: new Date(),
        },
        select: {
          id: true,
          status: true,
          driveFileId: true,
          driveFileUrl: true,
        },
      });

      return {
        id: retriedJob.id,
        created: true,
        status: retriedJob.status,
        driveFileId: retriedJob.driveFileId,
        driveFileUrl: retriedJob.driveFileUrl,
      };
    }

    throw error;
  }
}

export async function updateManifestJobStorage(
  jobId: bigint,
  input: { driveFileId: string; driveFileUrl?: string | null },
) {
  return prisma.manifestJob.update({
    where: { id: jobId },
    data: {
      driveFileId: input.driveFileId,
      driveFileUrl: input.driveFileUrl ?? null,
      updatedAt: new Date(),
    },
  });
}

export async function markManifestJobQueued(jobId: bigint) {
  return prisma.manifestJob.update({
    where: { id: jobId },
    data: {
      status: ManifestJobStatus.QUEUED,
      updatedAt: new Date(),
    },
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
      errorMessage,
      completedAt: new Date(),
      updatedAt: new Date(),
    },
  });
}
