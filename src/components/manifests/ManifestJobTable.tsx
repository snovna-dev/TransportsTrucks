import Link from "next/link";
import { formatDateTime, formatPercent } from "../../lib/format";
import { ManifestStatus } from "./ManifestStatus";
import { ReprocessButton } from "./ReprocessButton";

export interface ManifestJobRow {
  id: bigint;
  originalFileName: string;
  status: string;
  overallConfidence: { toString(): string } | null;
  attempts: number;
  errorMessage: string | null;
  createdAt: Date;
  manifest: { id: bigint; manifestNumber: string } | null;
}

export function ManifestJobTable({ rows, emptyText }: { rows: ManifestJobRow[]; emptyText?: string }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-slate-500">
        {emptyText ?? "No hay cargues pendientes."}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="min-w-full divide-y text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Archivo</th>
            <th className="px-3 py-2">Cargado</th>
            <th className="px-3 py-2">Confianza</th>
            <th className="px-3 py-2">Estado</th>
            <th className="px-3 py-2">Acción</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.id.toString()} className="align-top hover:bg-slate-50">
              <td className="px-3 py-2">
                <a href={`/api/manifest-jobs/${row.id}/pdf`} target="_blank" className="text-blue-700 hover:underline">
                  {row.originalFileName}
                </a>
                {row.errorMessage && <div className="mt-1 max-w-md text-xs text-red-700">{row.errorMessage}</div>}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(row.createdAt)}</td>
              <td className="px-3 py-2">{formatPercent(row.overallConfidence)}</td>
              <td className="px-3 py-2">
                <ManifestStatus status={row.status} />
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {row.status === "REVIEW_REQUIRED" && (
                  <Link href={`/manifests/review/${row.id}`} className="font-medium text-blue-700 hover:underline">
                    Revisar
                  </Link>
                )}
                {row.status === "COMPLETED" && row.manifest && (
                  <Link href={`/manifests/${row.manifest.id}`} className="text-blue-700 hover:underline">
                    Ver {row.manifest.manifestNumber}
                  </Link>
                )}
                {(row.status === "ERROR" || row.status === "QUEUED" || row.status === "UPLOADED") && (
                  <ReprocessButton jobId={row.id.toString()} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
