import type { ManifestJobStatus } from "../generated/prisma/enums";

export interface CreateManifestJobInput {
  originalFileName: string;
  fileHash: string;
}

export interface CreateManifestJobResult {
  id: bigint;
  created: boolean;
  status: ManifestJobStatus;
  driveFileId: string | null;
  driveFileUrl: string | null;
}
