import { ManifestExtractionSchema } from "../schemas/manifest-extraction.schema";
import type { ManifestExtraction } from "../types/manifest-extraction";

/** Formato de ManifestJob.extractedJson. */
export interface StoredExtraction {
  version: 1;
  pageCount: number;
  extraction: ManifestExtraction;
}

export function toStoredExtraction(input: {
  extraction: ManifestExtraction;
  pageCount: number;
}): StoredExtraction {
  return JSON.parse(
    JSON.stringify({ version: 1, pageCount: input.pageCount, extraction: input.extraction }),
  );
}

export function parseStoredExtraction(value: unknown): StoredExtraction | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  // Compatibilidad: versiones anteriores guardaban la extracción directamente.
  const raw = "extraction" in record ? record.extraction : record;
  const parsed = ManifestExtractionSchema.safeParse(raw);
  if (!parsed.success) return null;
  return {
    version: 1,
    pageCount: typeof record.pageCount === "number" ? record.pageCount : 0,
    extraction: parsed.data,
  };
}
