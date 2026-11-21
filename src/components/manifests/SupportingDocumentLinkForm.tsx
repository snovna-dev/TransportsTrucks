"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SupportingDocumentLinkForm({
  documentId,
  currentNumber,
}: {
  documentId: string;
  currentNumber: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentNumber ?? "");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/supporting-documents/${documentId}/link`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manifestNumber: value }),
      });
      const data = (await response.json()) as { success: boolean; manifestFound?: boolean; error?: string };
      if (!data.success) {
        setMessage({ ok: false, text: data.error ?? "No fue posible vincular." });
      } else if (!value.trim()) {
        setMessage({ ok: true, text: "Se quitó el vínculo." });
      } else if (data.manifestFound) {
        setMessage({ ok: true, text: "Documento vinculado." });
      } else {
        setMessage({
          ok: true,
          text: "Ese manifiesto aún no está cargado. El documento se vinculará solo cuando lo cargue.",
        });
      }
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "No fue posible comunicarse con el servidor." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor="link-manifest" className="block text-sm font-medium">
        Número de manifiesto
      </label>
      <div className="flex gap-2">
        <input
          id="link-manifest"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Ej. 597813"
          className="w-48 rounded border px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {loading ? "Guardando..." : "Vincular"}
        </button>
      </div>
      {message && <p className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-700"}`}>{message.text}</p>}
    </form>
  );
}
