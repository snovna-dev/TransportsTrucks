import { ManifestJobStatus } from "../../../generated/prisma/enums";
import { listManifestJobs } from "../../../services/manifest-job.service";
import { ManifestJobTable } from "../../../components/manifests/ManifestJobTable";

export const dynamic = "force-dynamic";

export default async function ReviewListPage() {
  const jobs = await listManifestJobs({
    statuses: [ManifestJobStatus.REVIEW_REQUIRED, ManifestJobStatus.ERROR],
  });

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="mb-1 text-xl font-semibold">Manifiestos por revisar</h1>
      <p className="mb-4 text-sm text-slate-600">
        PDF cuya extracción no fue confiable o que fallaron al procesarse.
      </p>
      <ManifestJobTable rows={jobs} emptyText="No hay manifiestos pendientes de revisión." />
    </main>
  );
}
