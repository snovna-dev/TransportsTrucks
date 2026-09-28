"use client";

import { useState } from "react";

interface UploadResponse {
  success: boolean;
  duplicate?: boolean;
  jobId?: string;
  status?: string;
  message?: string;
  error?: string;
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

      const response = await fetch("/api/manifests/upload", {
        method: "POST",
        body,
      });

      const data = (await response.json()) as UploadResponse;
      setResult(data);
    } catch {
      setResult({
        success: false,
        error: "No fue posible comunicarse con el servidor.",
      });
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
          className="mt-2 block w-full"
        />
      </div>

      <button
        type="submit"
        disabled={loading || !file}
        className="rounded-md border px-4 py-2 disabled:opacity-50"
      >
        {loading ? "Cargando..." : "Cargar manifiesto"}
      </button>

      {result && (
        <div className="rounded-md border p-3 text-sm">
          {result.success ? (
            <>
              <p>Estado: {result.status}</p>
              <p>Job: {result.jobId}</p>
              {result.message && <p>{result.message}</p>}
            </>
          ) : (
            <p>{result.error}</p>
          )}
        </div>
      )}
    </form>
  );
}
