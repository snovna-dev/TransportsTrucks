import { errorResponse, jsonResponse, parseId, type IdRouteContext } from "../../../../../lib/api";
import { setSupportingDocumentManifest } from "../../../../../services/supporting-document.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/supporting-documents/[id]/link  { manifestNumber: "597813" }
 * Vincula a mano una remesa u orden de cargue. Con manifestNumber vacío se quita el vínculo.
 */
export async function PUT(request: Request, context: IdRouteContext) {
  const id = parseId((await context.params).id);
  if (!id) return errorResponse("Id inválido.", 400);

  try {
    const body = (await request.json().catch(() => ({}))) as { manifestNumber?: string | null };
    const manifestNumber = typeof body.manifestNumber === "string" ? body.manifestNumber : null;
    if (manifestNumber && manifestNumber.trim().length > 50) {
      return errorResponse("El número de manifiesto es demasiado largo.", 400);
    }
    const result = await setSupportingDocumentManifest(id, manifestNumber);
    return jsonResponse({ success: true, ...result });
  } catch (error) {
    console.error("PUT supporting document link", error);
    return errorResponse(error instanceof Error ? error.message : "No fue posible vincular el documento.");
  }
}
