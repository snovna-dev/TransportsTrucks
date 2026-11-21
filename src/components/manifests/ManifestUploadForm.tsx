"use client";

import Link from "next/link";
import { useState } from "react";
import { ManifestStatus } from "./ManifestStatus";

interface UploadResponse {
  success: boolean;
  duplicate?: boolean;
  jobId?: string;
  status?: string;
  manifestId?: string | null;
  blockingFields?: number;
  message?: string;
  error?: string;
  notManifest?: boolean;
}

export function ManifestUploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UploadResponse | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file) {
      setResult({ success: false, error: "Seleccione un PDF." });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch("/api/manifests/upload", { method: "POST", body });
      const data = (await response.json().catch(() => ({
        success: false,
        error: response.status === 413 ? "El archivo es demasiado grande." : `Error del servidor (${response.status}).`,
      }))) as UploadResponse;
      setResult(data);
    } catch {
      setResult({ success: false, error: "No fue posible comunicarse con el servidor." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="manifest-pdf" className="block text-sm font-medium">
          Manifiesto PDF
        </label>
        <input
          id="manifest-pdf"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          disabled={loading}
          className="mt-2 block w-full rounded border p-2 text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={loading || !file}
        className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
      >
        {loading ? "Procesando el PDF..." : "Cargar manifiesto"}
      </button>

      {result && (
        <div className={`space-y-2 rounded-md border p-4 text-sm ${result.success ? "" : "border-red-300 bg-red-50 text-red-800"}`}>
          {result.success ? (
            <>
              <div className="flex items-center gap-2">
                Estado: {result.status && <ManifestStatus status={result.status} />}
              </div>
              {result.message && (
                <p>
                  {result.message}{" "}
                  {result.duplicate && result.jobId && (
                    <Link
                      className="text-blue-700 underline"
                      href={result.manifestId ? `/manifests/${result.manifestId}` : `/manifests/review/${result.jobId}`}
                    >
                      Ver
                    </Link>
                  )}
                </p>
              )}
              {result.status === "COMPLETED" && result.manifestId && (
                <p>
                  Manifiesto guardado.{" "}
                  <Link className="text-blue-700 underline" href={`/manifests/${result.manifestId}`}>
                    Ver manifiesto
                  </Link>
                </p>
              )}
              {result.status === "REVIEW_REQUIRED" && result.jobId && (
                <p>
                  {result.blockingFields ? `${result.blockingFields} campo(s) necesitan revisión. ` : ""}
                  <Link className="text-blue-700 underline" href={`/manifests/review/${result.jobId}`}>
                    Revisar ahora
                  </Link>
                </p>
              )}
              {result.status === "QUEUED" && <p>El PDF quedó en cola para procesarse.</p>}
            </>
          ) : (
            <>
              <p>{result.error}</p>
              {result.jobId && !result.notManifest && (
                <p>
                  Puede reintentar desde{" "}
                  <Link className="underline" href="/manifests">
                    la lista de manifiestos
                  </Link>
                  .
                </p>
              )}
            </>
          )}
        </div>
      )}
    </form>
  );
}
