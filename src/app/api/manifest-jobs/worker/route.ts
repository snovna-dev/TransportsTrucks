import { timingSafeEqual } from "node:crypto";
import { errorResponse, jsonResponse } from "../../../../lib/api";
import { processManifestJob } from "../../../../services/processing.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 26;

function authorized(request: Request) {
  const secret = process.env.WORKER_SECRET;
  if (!secret) return false;
  const url = new URL(request.url);
  const provided =
    url.searchParams.get("token") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/manifest-jobs/worker?token=WORKER_SECRET
 *
 * Endpoint para una suscripción push de Pub/Sub (PROCESSING_MODE=pubsub).
 * Acepta el sobre de Pub/Sub ({ message: { data: base64 } }) o { jobId }.
 * Responde 2xx también cuando el job ya estaba procesado, para que Pub/Sub
 * no reintente.
 */
export async function POST(request: Request) {
  if (!authorized(request)) return errorResponse("No autorizado.", 401);

  const body = (await request.json().catch(() => null)) as
    | { jobId?: string; message?: { data?: string } }
    | null;

  let jobId = body?.jobId;
  if (!jobId && body?.message?.data) {
    try {
      jobId = JSON.parse(Buffer.from(body.message.data, "base64").toString("utf8")).jobId;
    } catch {
      return errorResponse("Mensaje de Pub/Sub inválido.", 400);
    }
  }
  if (!jobId || !/^\d+$/.test(String(jobId))) return errorResponse("Falta jobId.", 400);

  const result = await processManifestJob(BigInt(jobId));
  // Un ERROR ya quedó registrado en el job; devolver 200 evita reintentos infinitos.
  return jsonResponse({ success: result.status !== "ERROR", ...result });
}
