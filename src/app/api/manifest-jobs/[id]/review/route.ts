import { errorResponse, jsonResponse, parseId, type IdRouteContext } from "../../../../../lib/api";
import { ReviewError, saveReview, type ReviewValues } from "../../../../../services/review.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/manifest-jobs/[id]/review  { values: { "manifest.authorizationNumber": "123" } } */
export async function PATCH(request: Request, context: IdRouteContext) {
  const id = parseId((await context.params).id);
  if (!id) return errorResponse("Id inválido.", 400);

  try {
    const body = (await request.json().catch(() => ({}))) as { values?: ReviewValues };
    const result = await saveReview(id, body.values ?? {});
    return jsonResponse({ success: true, ...result });
  } catch (error) {
    if (error instanceof ReviewError) return errorResponse(error.message, error.status, { details: error.details });
    console.error("PATCH review", error);
    return errorResponse(error instanceof Error ? error.message : "No fue posible guardar la revisión.");
  }
}
