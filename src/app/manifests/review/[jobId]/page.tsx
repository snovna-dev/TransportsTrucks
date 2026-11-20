import Link from "next/link";
import { notFound } from "next/navigation";
import { parseId } from "../../../../lib/api";
import { MANIFEST_VARIANT_LABELS } from "../../../../lib/manifiestos_parser/manifest-parser";
import { FIELD_DEFINITIONS } from "../../../../lib/manifest-fields";
import { formatDateTime, formatJson, formatPercent } from "../../../../lib/format";
import { getExtractedField } from "../../../../services/extraction.service";
import { getReviewData } from "../../../../services/review.service";
import { ManifestReview, type ReviewFieldView } from "../../../../components/manifests/ManifestReview";
import { ManifestStatus } from "../../../../components/manifests/ManifestStatus";
import { ReprocessButton } from "../../../../components/manifests/ReprocessButton";

export const dynamic = "force-dynamic";

export default async function ReviewJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const id = parseId((await params).jobId);
  if (!id) notFound();

  const data = await getReviewData(id);
  if (!data) notFound();
  const { job, stored, evaluation } = data;

  const flags = new Map(
    (evaluation?.reviewFields ?? []).map((field) => [field.path, field.required ? "blocking" : "warning"] as const),
  );

  const fields: ReviewFieldView[] = stored
    ? FIELD_DEFINITIONS.flatMap((definition) => {
        const field = getExtractedField(stored.extraction, definition.path);
        if (!field) return [];
        return [
          {
            path: definition.path,
            label: definition.label,
            group: definition.group,
            kind: definition.kind,
            requirement: definition.requirement,
            value: field.value as string | number | null,
            confidence: field.confidence,
            source: field.source,
            matchedLabel: field.matchedLabel,
            flag: flags.get(definition.path) ?? null,
          },
        ];
      })
    : [];

  return (
    <main className="mx-auto max-w-[1600px] px-6 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/manifests/review" className="text-sm text-blue-700 hover:underline">
          ← Volver
        </Link>
        <h1 className="text-xl font-semibold">Revisión: {job.originalFileName}</h1>
        <ManifestStatus status={job.status} />
        <span className="text-sm text-slate-500">Confianza global {formatPercent(job.overallConfidence)}</span>
        {stored?.variant && (
          <span className="text-sm text-slate-500">
            · {MANIFEST_VARIANT_LABELS[stored.variant as keyof typeof MANIFEST_VARIANT_LABELS] ?? stored.variant}
          </span>
        )}
        <span className="ml-auto">
          <ReprocessButton jobId={job.id.toString()} force label="Volver a extraer del PDF" />
        </span>
      </div>

      {job.errorMessage && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{job.errorMessage}</p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-[80vh] overflow-hidden rounded-md border lg:sticky lg:top-4">
          <iframe src={`/api/manifest-jobs/${job.id}/pdf`} title="PDF del manifiesto" className="h-full w-full" />
        </div>

        <div>
          {job.status === "COMPLETED" && job.manifestId ? (
            <p className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm">
              Este cargue ya fue aprobado.{" "}
              <Link className="text-blue-700 underline" href={`/manifests/${job.manifestId}`}>
                Ver manifiesto
              </Link>
            </p>
          ) : job.status !== "REVIEW_REQUIRED" ? (
            <p className="rounded border p-3 text-sm">Este cargue no está pendiente de revisión.</p>
          ) : !stored ? (
            <p className="rounded border p-3 text-sm">No hay datos extraídos. Use “Volver a extraer del PDF”.</p>
          ) : (
            <ManifestReview jobId={job.id.toString()} fields={fields} />
          )}

          {job.corrections.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-2 text-sm font-semibold">Historial de correcciones</h2>
              <ul className="space-y-1 text-xs text-slate-600">
                {job.corrections.map((correction) => (
                  <li key={correction.id.toString()}>
                    {formatDateTime(correction.createdAt)} · <code>{correction.fieldPath}</code>:{" "}
                    {formatJson(correction.originalValue)} → <strong>{formatJson(correction.correctedValue)}</strong>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
