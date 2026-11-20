import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../prisma";
import { downloadPdfFromDrive, uploadPdfToDrive } from "../google-drive";

/**
 * Almacenamiento intercambiable del PDF original.
 *
 * - "db" (por defecto): el PDF se guarda en ManifestJob.pdf_data. Funciona en
 *   Netlify sin configurar nada más y alcanza de sobra para ~8 PDF al mes.
 * - "local": carpeta en disco (STORAGE_LOCAL_DIR). Útil en desarrollo; no
 *   sirve en Netlify porque su disco es efímero.
 * - "drive": Google Drive (OAuth con la cuenta personal o cuenta de servicio).
 */
export type StorageProviderName = "db" | "local" | "drive";

export interface StoredPdf {
  provider: StorageProviderName;
  key: string | null;
  url: string | null;
  /** Solo para "db": bytes que se guardan en el job. */
  data?: Buffer;
  /** Solo para "drive". */
  driveFileId?: string;
}

export interface StoredPdfReference {
  id: bigint;
  storageProvider: string | null;
  storageKey: string | null;
  driveFileId: string | null;
}

export function getStorageProvider(): StorageProviderName {
  const value = (process.env.STORAGE_PROVIDER ?? "db").toLowerCase();
  if (value === "db" || value === "local" || value === "drive") return value;
  throw new Error(`STORAGE_PROVIDER inválido: ${value}. Use db, local o drive.`);
}

function localDir() {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.STORAGE_LOCAL_DIR ?? "storage/manifests");
}

function safeFileName(name: string) {
  return name.replace(/[^\w.\- ]+/g, "_").slice(-150);
}

export async function savePdf(input: {
  jobId: bigint;
  fileName: string;
  fileHash: string;
  buffer: Buffer;
}): Promise<StoredPdf> {
  const provider = getStorageProvider();

  if (provider === "db") {
    return { provider, key: null, url: null, data: input.buffer };
  }

  if (provider === "local") {
    const key = `${input.jobId}-${input.fileHash.slice(0, 12)}-${safeFileName(input.fileName)}`;
    await mkdir(localDir(), { recursive: true });
    await writeFile(path.join(localDir(), key), input.buffer);
    return { provider, key, url: null };
  }

  const driveFile = await uploadPdfToDrive({ fileName: input.fileName, buffer: input.buffer });
  return { provider, key: driveFile.id, url: driveFile.webViewLink, driveFileId: driveFile.id };
}

export async function readPdf(job: StoredPdfReference): Promise<Buffer> {
  const provider = (job.storageProvider ?? (job.driveFileId ? "drive" : "db")) as StorageProviderName;

  if (provider === "db") {
    const row = await prisma.manifestJob.findUnique({
      where: { id: job.id },
      select: { pdfData: true },
    });
    if (!row?.pdfData) throw new Error("El PDF no está guardado en la base de datos.");
    return Buffer.from(row.pdfData);
  }

  if (provider === "local") {
    if (!job.storageKey) throw new Error("El job no tiene ruta local del PDF.");
    return readFile(path.join(localDir(), path.basename(job.storageKey)));
  }

  const fileId = job.storageKey ?? job.driveFileId;
  if (!fileId) throw new Error("El job no tiene archivo en Google Drive.");
  return downloadPdfFromDrive(fileId);
}
