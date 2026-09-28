import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createManifestJob, markManifestJobError, markManifestJobQueued, updateManifestJobStorage } from "../../../../services/manifest-job.service";
import { uploadPdfToDrive } from "../../../../lib/google-drive";
import { publishManifestJob } from "../../../../lib/pubsub";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

function isPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

export async function POST(request: Request) {
  let jobId: bigint | null = null;

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "Debe seleccionar un archivo PDF." },
        { status: 400 },
      );
    }

    if (file.size === 0) {
      return NextResponse.json(
        { success: false, error: "El archivo está vacío." },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: "El PDF supera el límite de 20 MB." },
        { status: 413 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    if (!isPdf(buffer)) {
      return NextResponse.json(
        { success: false, error: "El archivo no tiene una firma PDF válida." },
        { status: 400 },
      );
    }

    const fileHash = createHash("sha256").update(buffer).digest("hex");
    const job = await createManifestJob({
      originalFileName: file.name,
      fileHash,
    });

    jobId = job.id;

    // El hash es la barrera de idempotencia: si ya existe, no volvemos a subir
    // el archivo ni publicamos otro mensaje para el mismo documento.
    if (!job.created) {
      return NextResponse.json(
        {
          success: true,
          duplicate: true,
          jobId: job.id.toString(),
          status: job.status,
          message: "El PDF ya había sido cargado anteriormente.",
        },
        { status: 200 },
      );
    }

    try {
      const driveFile = await uploadPdfToDrive({
        fileName: file.name,
        buffer,
      });

      await updateManifestJobStorage(job.id, {
        driveFileId: driveFile.id,
        driveFileUrl: driveFile.webViewLink,
      });

      await markManifestJobQueued(job.id);
      const messageId = await publishManifestJob(job.id);

      return NextResponse.json(
        {
          success: true,
          duplicate: false,
          jobId: job.id.toString(),
          status: "QUEUED",
          driveFileId: driveFile.id,
          messageId,
        },
        { status: 201 },
      );
    } catch (error) {
      await markManifestJobError(
        job.id,
        error instanceof Error ? error.message : "Error desconocido durante el cargue.",
      );
      throw error;
    }
  } catch (error) {
    console.error("POST /api/manifests/upload", error);

    return NextResponse.json(
      {
        success: false,
        jobId: jobId?.toString() ?? null,
        error: error instanceof Error ? error.message : "No fue posible cargar el PDF.",
      },
      { status: 500 },
    );
  }
}
