import { createHash } from "node:crypto";
import { errorResponse, jsonResponse } from "../../../../lib/api";
import { savePdf } from "../../../../lib/storage";
import { publishManifestJob } from "../../../../lib/pubsub";
import {
  createManifestJob,
  getProcessingMode,
  markManifestJobError,
  markManifestJobQueued,
  updateManifestJobStorage,
} from "../../../../services/manifest-job.service";
import { processManifestJob } from "../../../../services/processing.service";
import { extractPdfText, PdfExtractionError } from "../../../../lib/manifiestos_parser/pdf";
import { checkManifestDocument } from "../../../../lib/manifiestos_parser/document-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// En Netlify el tiempo máximo real lo define la plataforma (10 s por defecto, hasta 26 s).
export const maxDuration = 26;

/**
 * Netlify limita el cuerpo de una petición a ~6 MB (≈4.5 MB de archivo tras
 * la codificación). Por eso el límite por defecto es 4 MB.
 */
function maxFileSize() {
  const megabytes = Number(process.env.MAX_UPLOAD_MB ?? 4);
  return (Number.isFinite(megabytes) && megabytes > 0 ? megabytes : 4) * 1024 * 1024;
}

function isPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

export async function POST(request: Request) {
  let jobId: bigint | null = null;

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return errorResponse("Debe seleccionar un archivo PDF.", 400);
    }
    if (file.size === 0) {
      return errorResponse("El archivo está vacío.", 400);
    }
    const limit = maxFileSize();
    if (file.size > limit) {
      return errorResponse(`El PDF supera el límite de ${Math.round(limit / 1024 / 1024)} MB.`, 413);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!isPdf(buffer)) {
      return errorResponse("El archivo no tiene una firma PDF válida.", 400);
    }

    // Solo se aceptan manifiestos: una remesa, una orden de cargue u otro
    // documento se rechaza aquí, sin guardar el archivo ni crear el cargue.
    try {
      const pdf = await extractPdfText(buffer);
      const check = checkManifestDocument(pdf.text);
      if (!check.ok) return errorResponse(check.reason, 422, { notManifest: true });
    } catch (error) {
      if (error instanceof PdfExtractionError) return errorResponse(error.message, 422);
      throw error;
    }

    const fileHash = createHash("sha256").update(buffer).digest("hex");
    const job = await createManifestJob({
      originalFileName: file.name,
      fileHash,
      fileSize: file.size,
    });
    jobId = job.id;

    // El hash es la barrera de idempotencia: el mismo PDF no se procesa dos veces.
    if (!job.created) {
      return jsonResponse({
        success: true,
        duplicate: true,
        jobId: job.id,
        status: job.status,
        manifestId: job.manifestId,
        message: "Este PDF ya había sido cargado anteriormente.",
      });
    }

    try {
      // Si un intento anterior ya guardó el archivo, se reutiliza.
      if (!job.storageProvider) {
        const stored = await savePdf({ jobId: job.id, fileName: file.name, fileHash, buffer });
        await updateManifestJobStorage(job.id, stored);
      }
      await markManifestJobQueued(job.id);
    } catch (error) {
      await markManifestJobError(
        job.id,
        error instanceof Error ? error.message : "Error desconocido al guardar el PDF.",
      );
      throw error;
    }

    if (getProcessingMode() === "pubsub") {
      try {
        const messageId = await publishManifestJob(job.id);
        return jsonResponse(
          { success: true, duplicate: false, jobId: job.id, status: "QUEUED", messageId },
          { status: 202 },
        );
      } catch (error) {
        await markManifestJobError(
          job.id,
          error instanceof Error ? error.message : "No fue posible publicar en Pub/Sub.",
        );
        throw error;
      }
    }

    // Modo por defecto: con ~8 manifiestos al mes se procesa en la misma petición.
    const result = await processManifestJob(job.id);

    return jsonResponse(
      {
        success: result.status !== "ERROR",
        duplicate: false,
        jobId: job.id,
        status: result.status,
        manifestId: result.manifestId,
        overallConfidence: result.overallConfidence,
        blockingFields: result.blockingFields,
        error: result.error,
      },
      { status: result.status === "ERROR" ? 500 : 201 },
    );
  } catch (error) {
    console.error("POST /api/manifests/upload", error);
    return errorResponse(
      error instanceof Error ? error.message : "No fue posible cargar el PDF.",
      500,
      { jobId: jobId?.toString() ?? null },
    );
  }
}
