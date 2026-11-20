import { google } from "googleapis";
import { Readable } from "node:stream";
import { DRIVE_SCOPES, getAuthorizedOAuthClient, isOAuthConfigured } from "./google-oauth";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}.`);
  }
  return value;
}

/**
 * Prioridad: OAuth con la cuenta personal (refresh token). Si no está
 * configurado, se usa la cuenta de servicio, que solo funciona con una unidad
 * compartida porque las cuentas de servicio no tienen cuota propia en Drive.
 */
function getDriveClient() {
  if (isOAuthConfigured()) {
    return google.drive({ version: "v3", auth: getAuthorizedOAuthClient() });
  }

  const clientEmail = getRequiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = getRequiredEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n");

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
    scopes: DRIVE_SCOPES,
  });

  return google.drive({ version: "v3", auth });
}

export interface UploadedDriveFile {
  id: string;
  webViewLink: string | null;
}

export async function uploadPdfToDrive(input: {
  fileName: string;
  buffer: Buffer;
}): Promise<UploadedDriveFile> {
  const folderId = getRequiredEnv("GOOGLE_DRIVE_FOLDER_ID");
  const drive = getDriveClient();

  const response = await drive.files.create({
    requestBody: {
      name: input.fileName,
      parents: [folderId],
      mimeType: "application/pdf",
    },
    media: {
      mimeType: "application/pdf",
      body: Readable.from(input.buffer),
    },
    fields: "id,webViewLink",
    supportsAllDrives: true,
  });

  const id = response.data.id;
  if (!id) {
    throw new Error("Google Drive no devolvió el ID del archivo.");
  }

  return {
    id,
    webViewLink: response.data.webViewLink ?? null,
  };
}

export async function downloadPdfFromDrive(fileId: string): Promise<Buffer> {
  const drive = getDriveClient();
  const response = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  return Buffer.from(response.data as ArrayBuffer);
}
