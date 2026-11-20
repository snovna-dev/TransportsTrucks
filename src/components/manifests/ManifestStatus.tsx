const LABELS: Record<string, { label: string; className: string }> = {
  UPLOADED: { label: "Cargado", className: "bg-slate-100 text-slate-700" },
  QUEUED: { label: "En cola", className: "bg-slate-100 text-slate-700" },
  PROCESSING: { label: "Procesando", className: "bg-blue-100 text-blue-800" },
  REVIEW_REQUIRED: { label: "Requiere revisión", className: "bg-amber-100 text-amber-800" },
  COMPLETED: { label: "Completado", className: "bg-emerald-100 text-emerald-800" },
  ERROR: { label: "Error", className: "bg-red-100 text-red-800" },
};

export function statusLabel(status: string) {
  return LABELS[status]?.label ?? status;
}

/** Insignia de estado para ManifestJob y Manifest (comparten los mismos valores). */
export function ManifestStatus({ status }: { status: string }) {
  const config = LABELS[status] ?? { label: status, className: "bg-slate-100 text-slate-700" };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}
