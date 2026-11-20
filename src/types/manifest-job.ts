import type { ManifestJobStatus } from "../generated/prisma/enums";

export interface CreateManifestJobInput {
  originalFileName: string;
  fileHash: string;
  fileSize?: number;
}

export interface CreateManifestJobResult {
  id: bigint;
  created: boolean;
  status: ManifestJobStatus;
  storageProvider: string | null;
  driveFileId: string | null;
  driveFileUrl: string | null;
  manifestId: bigint | null;
}
