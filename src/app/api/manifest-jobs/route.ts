import { jsonResponse } from "../../../lib/api";
import { ManifestJobStatus } from "../../../generated/prisma/enums";
import { listManifestJobs } from "../../../services/manifest-job.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/manifest-jobs?status=REVIEW_REQUIRED,ERROR */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const valid = new Set(Object.values(ManifestJobStatus) as string[]);
  const statuses = (url.searchParams.get("status") ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value) => valid.has(value)) as ManifestJobStatus[];

  const jobs = await listManifestJobs({ statuses });
  return jsonResponse({ success: true, jobs });
}
