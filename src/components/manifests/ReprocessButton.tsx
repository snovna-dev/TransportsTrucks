"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReprocessButton({ jobId, force = false, label }: { jobId: string; force?: boolean; label?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reprocess() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/manifest-jobs/${jobId}/process${force ? "?force=1" : ""}`, { method: "POST" });
      const data = (await response.json()) as { success: boolean; status?: string; error?: string };
      if (!data.success) setError(data.error ?? "No fue posible reprocesar.");
      if (data.status === "REVIEW_REQUIRED" && !force) {
        router.push(`/manifests/review/${jobId}`);
        return;
      }
      router.refresh();
    } catch {
      setError("No fue posible comunicarse con el servidor.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={reprocess}
        disabled={loading}
        className="rounded border px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50"
      >
        {loading ? "Procesando..." : (label ?? "Reprocesar")}
      </button>
      {error && <span className="mt-1 text-xs text-red-700">{error}</span>}
    </span>
  );
}
