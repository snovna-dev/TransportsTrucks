import { errorResponse, jsonResponse, parseId, type IdRouteContext } from "../../../../../lib/api";
import { processManifestJob } from "../../../../../services/processing.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 26;

/**
 * POST /api/manifest-jobs/[id]/process: reprocesa un job (ERROR, QUEUED o,
 * con ?force=1, uno en REVIEW_REQUIRED para volver a extraer desde el PDF).
 */
export async function POST(request: Request, context: IdRouteContext) {
  const id = parseId((await context.params).id);
  if (!id) return errorResponse("Id inválido.", 400);

  try {
    const force = new URL(request.url).searchParams.get("force") === "1";
    const result = await processManifestJob(id, { force });
    return jsonResponse({ success: result.status !== "ERROR", ...result });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "No fue posible procesar el job.");
  }
}
