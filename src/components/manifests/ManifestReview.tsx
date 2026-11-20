"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export interface ReviewFieldView {
  path: string;
  label: string;
  group: string;
  kind: "string" | "number" | "date";
  requirement: "MUST_HAVE" | "EXPECTED" | "OPTIONAL_CHECKED" | "OPTIONAL";
  value: string | number | null;
  confidence: number;
  source: "PDF_TEXT" | "USER";
  matchedLabel: string | null;
  /** blocking = hay que revisarlo; warning = baja confianza pero no bloquea. */
  flag: "blocking" | "warning" | null;
}

interface ApiResult {
  success: boolean;
  error?: string;
  manifestId?: string;
  corrections?: number;
}

const toInput = (value: string | number | null) => (value === null || value === undefined ? "" : String(value));

export function ManifestReview({ jobId, fields }: { jobId: string; fields: ReviewFieldView[] }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.path, toInput(field.value)])),
  );
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState<"save" | "complete" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const flagged = fields.filter((field) => field.flag !== null);
  const groups = useMemo(() => {
    const map = new Map<string, ReviewFieldView[]>();
    for (const field of fields) {
      if (!map.has(field.group)) map.set(field.group, []);
      map.get(field.group)!.push(field);
    }
    return [...map.entries()];
  }, [fields]);

  const changedValues = () =>
    Object.fromEntries(
      fields
        .filter((field) => values[field.path] !== toInput(field.value))
        .map((field) => [field.path, values[field.path] === "" ? null : values[field.path]]),
    );

  async function send(kind: "save" | "complete") {
    setBusy(kind);
    setMessage(null);
    try {
      const response = await fetch(`/api/manifest-jobs/${jobId}/${kind === "save" ? "review" : "complete"}`, {
        method: kind === "save" ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: changedValues() }),
      });
      const data = (await response.json()) as ApiResult;
      if (!data.success) {
        setMessage({ ok: false, text: data.error ?? "No fue posible guardar." });
        return;
      }
      if (kind === "complete" && data.manifestId) {
        router.push(`/manifests/${data.manifestId}`);
        return;
      }
      setMessage({ ok: true, text: `Borrador guardado (${data.corrections ?? 0} corrección(es)).` });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "No fue posible comunicarse con el servidor." });
    } finally {
      setBusy(null);
    }
  }

  const renderField = (field: ReviewFieldView, withGroup = false) => {
    const border =
      field.flag === "blocking"
        ? "border-amber-400 bg-amber-50"
        : field.flag === "warning"
          ? "border-yellow-300 bg-yellow-50"
          : "border-slate-300";
    const changed = values[field.path] !== toInput(field.value);
    return (
      <label key={field.path} className="block">
        <span className="flex items-center justify-between gap-2 text-xs text-slate-600">
          <span>
            {withGroup && <span className="text-slate-400">{field.group} · </span>}
            {field.label}
            {field.requirement === "MUST_HAVE" && <span className="text-red-600"> *</span>}
          </span>
          <span className="text-[11px]">
            {field.source === "USER" ? "Corregido" : `${Math.round(field.confidence * 100)} %`}
            {changed && " · modificado"}
          </span>
        </span>
        <input
          type={field.kind === "date" ? "date" : field.kind === "number" ? "number" : "text"}
          step={field.kind === "number" ? "any" : undefined}
          value={values[field.path]}
          onChange={(event) => setValues((current) => ({ ...current, [field.path]: event.target.value }))}
          className={`mt-1 w-full rounded border px-2 py-1.5 text-sm ${border}`}
          placeholder={field.value === null ? "No encontrado en el PDF" : undefined}
        />
      </label>
    );
  };

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-1 text-base font-semibold">Campos a revisar ({flagged.length})</h2>
        <p className="mb-3 text-xs text-slate-500">
          Corrija los valores dudosos. Los que deje igual se darán por confirmados al aprobar. Los campos con * son
          obligatorios; los demás pueden quedar vacíos si no existen en el PDF.
        </p>
        {flagged.length === 0 ? (
          <p className="text-sm text-slate-500">No hay campos marcados.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">{flagged.map((field) => renderField(field, true))}</div>
        )}
      </section>

      <section>
        <button type="button" onClick={() => setShowAll((value) => !value)} className="text-sm text-blue-700 hover:underline">
          {showAll ? "Ocultar el resto de campos" : "Ver y editar todos los campos"}
        </button>
        {showAll && (
          <div className="mt-3 space-y-5">
            {groups.map(([group, groupFields]) => (
              <fieldset key={group} className="rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">{group}</legend>
                <div className="grid gap-3 sm:grid-cols-2">{groupFields.map((field) => renderField(field))}</div>
              </fieldset>
            ))}
          </div>
        )}
      </section>

      {message && (
        <p className={`rounded border p-3 text-sm ${message.ok ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50 text-red-800"}`}>
          {message.text}
        </p>
      )}

      <div className="sticky bottom-0 flex flex-wrap gap-3 border-t bg-white py-3">
        <button
          type="button"
          onClick={() => send("save")}
          disabled={busy !== null}
          className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === "save" ? "Guardando..." : "Guardar borrador"}
        </button>
        <button
          type="button"
          onClick={() => send("complete")}
          disabled={busy !== null}
          className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {busy === "complete" ? "Guardando manifiesto..." : "Aprobar y guardar manifiesto"}
        </button>
      </div>
    </div>
  );
}
