import { errorResponse, jsonResponse, parseId, type IdRouteContext } from "../../../../lib/api";
import { getReviewData } from "../../../../services/review.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/manifest-jobs/[id]: estado, extracción y campos a revisar. */
export async function GET(_request: Request, context: IdRouteContext) {
  const id = parseId((await context.params).id);
  if (!id) return errorResponse("Id inválido.", 400);

  const data = await getReviewData(id);
  if (!data) return errorResponse("El job no existe.", 404);

  const { extractedJson: _omit, ...job } = data.job;
  return jsonResponse({
    success: true,
    job,
    extraction: data.stored?.extraction ?? null,
    evaluation: data.evaluation,
  });
}
