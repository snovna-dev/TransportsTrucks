import Link from "next/link";
import { formatDate } from "../../lib/format";
import { SUPPORTING_DOCUMENT_LABELS } from "../../lib/manifiestos_parser/supporting-document-parser";
import { LINK_METHOD_LABELS, type LinkMethod } from "../../services/supporting-document.service";

export interface SupportingDocumentRow {
  id: bigint;
  jobId: bigint;
  documentType: string;
  documentNumber: string;
  manifestNumber: string | null;
  manifestId: bigint | null;
  linkMethod: string | null;
  issueDate: Date | null;
  origin?: string | null;
  destination?: string | null;
  vehiclePlate: string | null;
  driverName?: string | null;
  job?: { originalFileName: string } | null;
}

export function documentTypeLabel(type: string) {
  return SUPPORTING_DOCUMENT_LABELS[type as keyof typeof SUPPORTING_DOCUMENT_LABELS] ?? "Manifiesto";
}

export function linkStatusText(row: Pick<SupportingDocumentRow, "manifestId" | "manifestNumber" | "linkMethod">) {
  if (row.manifestId) {
    const method = LINK_METHOD_LABELS[row.linkMethod as LinkMethod];
    return method ? `Vinculado ${method}` : "Vinculado";
  }
  if (row.manifestNumber) return `Esperando el manifiesto ${row.manifestNumber}`;
  return "Sin vincular";
}

export function SupportingDocumentList({
  rows,
  showManifest = false,
  emptyText,
}: {
  rows: SupportingDocumentRow[];
  showManifest?: boolean;
  emptyText?: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-4 text-center text-sm text-slate-500">
        {emptyText ?? "No hay documentos soporte."}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="min-w-full divide-y text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Documento</th>
            <th className="px-3 py-2">Fecha</th>
            <th className="px-3 py-2">Placa</th>
            <th className="px-3 py-2">Ruta</th>
            <th className="px-3 py-2">{showManifest ? "Manifiesto" : "Vínculo"}</th>
            <th className="px-3 py-2">Acción</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.id.toString()} className="align-top hover:bg-slate-50">
              <td className="px-3 py-2 whitespace-nowrap">
                <span className="font-medium">{documentTypeLabel(row.documentType)}</span> {row.documentNumber}
                {row.job?.originalFileName && (
                  <div className="text-xs text-slate-500">{row.job.originalFileName}</div>
                )}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{formatDate(row.issueDate)}</td>
              <td className="px-3 py-2">{row.vehiclePlate ?? "—"}</td>
              <td className="px-3 py-2">
                {row.origin || row.destination ? `${row.origin ?? "—"} → ${row.destination ?? "—"}` : "—"}
              </td>
              <td className="px-3 py-2">
                {showManifest && row.manifestId ? (
                  <Link href={`/manifests/${row.manifestId}`} className="text-blue-700 hover:underline">
                    {row.manifestNumber}
                  </Link>
                ) : (
                  <span className={row.manifestId ? "text-emerald-700" : "text-amber-700"}>{linkStatusText(row)}</span>
                )}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Link href={`/manifests/review/${row.jobId}`} className="text-blue-700 hover:underline">
                  {row.manifestId ? "Ver datos" : "Ver y vincular"}
                </Link>
                {" · "}
                <a href={`/api/manifest-jobs/${row.jobId}/pdf`} target="_blank" className="text-blue-700 hover:underline">
                  PDF
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
