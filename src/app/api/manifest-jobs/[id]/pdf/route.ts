import { errorResponse, parseId, type IdRouteContext } from "../../../../../lib/api";
import { prisma } from "../../../../../lib/prisma";
import { readPdf } from "../../../../../lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/manifest-jobs/[id]/pdf: sirve el PDF original sin exponer enlaces públicos de Drive. */
export async function GET(_request: Request, context: IdRouteContext) {
  const id = parseId((await context.params).id);
  if (!id) return errorResponse("Id inválido.", 400);

  const job = await prisma.manifestJob.findUnique({
    where: { id },
    select: { id: true, originalFileName: true, storageProvider: true, storageKey: true, driveFileId: true },
  });
  if (!job) return errorResponse("El job no existe.", 404);

  try {
    const pdf = await readPdf(job);
    const fileName = encodeURIComponent(job.originalFileName);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename*=UTF-8''${fileName}`,
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "No fue posible leer el PDF.", 404);
  }
}
