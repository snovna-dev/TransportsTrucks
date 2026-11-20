import { errorResponse, jsonResponse, parseId, type IdRouteContext } from "../../../../../lib/api";
import { completeReview, ReviewError, type ReviewValues } from "../../../../../services/review.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/manifest-jobs/[id]/complete  { values?: {...} } → crea o sobrescribe el Manifest. */
export async function POST(request: Request, context: IdRouteContext) {
  const id = parseId((await context.params).id);
  if (!id) return errorResponse("Id inválido.", 400);

  try {
    const body = (await request.json().catch(() => ({}))) as { values?: ReviewValues };
    const result = await completeReview(id, body.values ?? {});
    return jsonResponse({ success: true, ...result });
  } catch (error) {
    if (error instanceof ReviewError) return errorResponse(error.message, error.status, { details: error.details });
    console.error("POST complete", error);
    return errorResponse(error instanceof Error ? error.message : "No fue posible completar la revisión.");
  }
}
