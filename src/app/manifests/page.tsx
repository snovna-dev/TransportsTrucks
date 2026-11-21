import Link from "next/link";
import { prisma } from "../../lib/prisma";
import { ManifestJobStatus } from "../../generated/prisma/enums";
import { listManifestJobs } from "../../services/manifest-job.service";
import { ManifestTable } from "../../components/manifests/ManifestTable";
import { ManifestJobTable } from "../../components/manifests/ManifestJobTable";

export const dynamic = "force-dynamic";

export default async function ManifestsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = (await searchParams).q?.trim() ?? "";

  const [manifests, pendingJobs] = await Promise.all([
    prisma.manifest.findMany({
      where: q
        ? {
            OR: [
              { manifestNumber: { contains: q, mode: "insensitive" } },
              { authorizationNumber: { contains: q, mode: "insensitive" } },
              { vehicle: { plate: { contains: q, mode: "insensitive" } } },
              { driver: { fullName: { contains: q, mode: "insensitive" } } },
              { origin: { contains: q, mode: "insensitive" } },
              { destination: { contains: q, mode: "insensitive" } },
            ],
          }
        : undefined,
      orderBy: [{ issueDate: "desc" }, { id: "desc" }],
      take: 200,
      select: {
        id: true,
        manifestNumber: true,
        authorizationNumber: true,
        issueDate: true,
        origin: true,
        destination: true,
        status: true,
        totalTripValue: true,
        vehicle: { select: { plate: true } },
        driver: { select: { fullName: true } },
      },
    }),
    listManifestJobs({
      statuses: [
        ManifestJobStatus.UPLOADED,
        ManifestJobStatus.QUEUED,
        ManifestJobStatus.PROCESSING,
        ManifestJobStatus.REVIEW_REQUIRED,
        ManifestJobStatus.ERROR,
      ],
    }),
  ]);

  return (
    <main className="mx-auto max-w-7xl space-y-10 px-6 py-8">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Cargues pendientes</h1>
          <Link href="/manifests/upload" className="text-sm text-blue-700 hover:underline">
            Cargar otro PDF
          </Link>
        </div>
        <ManifestJobTable rows={pendingJobs} emptyText="No hay cargues pendientes ni con error." />
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Manifiestos ({manifests.length})</h2>
          <form className="flex gap-2">
            <input
              name="q"
              defaultValue={q}
              placeholder="Número, autorización, placa, conductor, ciudad"
              className="w-80 rounded border px-3 py-1.5 text-sm"
            />
            <button className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50">Buscar</button>
          </form>
        </div>
        <ManifestTable rows={manifests} />
      </section>
    </main>
  );
}
