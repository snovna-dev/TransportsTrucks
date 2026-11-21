import Link from "next/link";
import {
  getSupportingDocumentValue,
  SUPPORTING_DOCUMENT_SECTIONS,
  type SupportingDocumentData,
} from "../../lib/manifiestos_parser/supporting-document-parser";
import { formatNumber } from "../../lib/format";
import { documentTypeLabel, linkStatusText } from "./SupportingDocumentList";
import { SupportingDocumentLinkForm } from "./SupportingDocumentLinkForm";

const NUMERIC_PATHS = new Set(["vehicle.capacity", "cargo.quantity", "cargo.weight"]);

export interface SupportingDocumentViewProps {
  document: {
    id: bigint;
    documentType: string;
    documentNumber: string;
    manifestNumber: string | null;
    manifestId: bigint | null;
    linkMethod: string | null;
    manifest: { id: bigint; manifestNumber: string } | null;
  } | null;
  data: SupportingDocumentData | null;
}

/** Datos extraídos de una remesa u orden de cargue y su vínculo con el manifiesto. */
export function SupportingDocumentView({ document, data }: SupportingDocumentViewProps) {
  return (
    <div className="space-y-4">
      {document ? (
        <section className="rounded-md border p-4">
          <h2 className="mb-1 text-sm font-semibold">
            {documentTypeLabel(document.documentType)} {document.documentNumber}
          </h2>
          {document.manifest ? (
            <p className="mb-3 text-sm text-emerald-800">
              {linkStatusText(document)}:{" "}
              <Link className="text-blue-700 underline" href={`/manifests/${document.manifest.id}`}>
                manifiesto {document.manifest.manifestNumber}
              </Link>
            </p>
          ) : (
            <p className="mb-3 text-sm text-amber-800">
              {linkStatusText(document)}.{" "}
              {document.manifestNumber
                ? "Se vinculará solo cuando cargue ese manifiesto."
                : "Se vinculará solo cuando cargue un manifiesto con la misma placa, conductor y fecha, o indíquelo aquí."}
            </p>
          )}
          <SupportingDocumentLinkForm
            documentId={document.id.toString()}
            currentNumber={document.manifest?.manifestNumber ?? document.manifestNumber}
          />
        </section>
      ) : (
        <p className="rounded border p-3 text-sm">
          El documento no se pudo guardar. Revise el mensaje de error y vuelva a procesarlo.
        </p>
      )}

      {data &&
        SUPPORTING_DOCUMENT_SECTIONS.map((section) => {
          const rows = section.fields
            .map(([path, label]) => [label, getSupportingDocumentValue(data, path), path] as const)
            .filter(([, value]) => value !== null && value !== "");
          if (rows.length === 0) return null;
          return (
            <section key={section.title} className="rounded-md border">
              <h3 className="border-b bg-slate-50 px-4 py-2 text-sm font-semibold">{section.title}</h3>
              <dl className="grid grid-cols-[minmax(120px,35%)_1fr] gap-x-4 gap-y-1.5 px-4 py-3 text-sm">
                {rows.map(([label, value, path]) => (
                  <div key={path} className="contents">
                    <dt className="text-slate-500">{label}</dt>
                    <dd>{NUMERIC_PATHS.has(path) && typeof value === "number" ? formatNumber(value) : value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })}
    </div>
  );
}
