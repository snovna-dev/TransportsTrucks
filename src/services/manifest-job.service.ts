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
    },
  });

  if (existing) {
    return {
      id: existing.id,
      created: false,
      status: existing.status,
    };
  }

  try {
    const job = await prisma.manifestJob.create({
      data: {
        originalFileName: input.originalFileName,
        fileHash: input.fileHash,
        status: ManifestJobStatus.UPLOADED,
      },
    });

    return {
      id: job.id,
      created: true,
      status: job.status,
    };
  } catch (error) {
    // Si dos cargas llegan al mismo tiempo, la restricción UNIQUE de fileHash
    // garantiza que solo una cree el job. Recuperamos el existente.
    const existingAfterRace = await prisma.manifestJob.findUnique({
      where: { fileHash: input.fileHash },
      select: { id: true, status: true },
    });

    if (existingAfterRace) {
      return {
        id: existingAfterRace.id,
        created: false,
        status: existingAfterRace.status,
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
