import { extractPdfText, type PdfExtractionResult } from "../lib/manifiestos_parser/pdf";
import {
  parseManifestDocument,
  summarizeConfidence,
  type ManifestVariant,
} from "../lib/manifiestos_parser/manifest-parser";
import {
  getConfidenceAction,
  ManifestExtractionSchema,
} from "../schemas/manifest-extraction.schema";
import {
  FIELD_CONFIDENCE_OK,
  FIELD_DEFINITIONS,
  getFieldLabel,
  type FieldRequirement,
} from "../lib/manifest-fields";
import type {
  ExtractedField,
  ManifestExtraction,
} from "../types/manifest-extraction";

export type ExtractionAction =
  | "AUTO_SAVE"
  | "SAVE_FOR_REVIEW"
  | "MANUAL_REVIEW";

export interface ExtractionReviewField {
  path: string;
  label: string;
  value: unknown;
  confidence: number;
  section: string;
  requirement: FieldRequirement;
  reason: "MISSING" | "LOW_CONFIDENCE";
  /** true = impide guardar automáticamente; debe revisarse. */
  required: boolean;
}

export interface ExtractionEvaluation {
  overallConfidence: number;
  action: ExtractionAction;
  summary: ReturnType<typeof summarizeConfidence>;
  reviewFields: ExtractionReviewField[];
  blockingReviewFields: ExtractionReviewField[];
}

export interface ExtractionServiceResult extends ExtractionEvaluation {
  extraction: ManifestExtraction;
  /** Texto de todas las páginas (lo que se guarda en ManifestJob.rawText). */
  rawText: string;
  pageCount: number;
  hasText: boolean;
  /** Formato de PDF detectado (OPL, RNDC_B, PACAR, TANQUES o DESCONOCIDO). */
  variant: ManifestVariant;
}

/** Campos sin los cuales no se puede guardar el Manifest. */
export function getRequiredExtractionFields() {
  return FIELD_DEFINITIONS.filter((field) => field.requirement === "MUST_HAVE").map(
    (field) => field.path,
  );
}

export function getExtractedField(
  extraction: ManifestExtraction,
  path: string,
): ExtractedField<unknown> | undefined {
  const [group, key] = path.split(".");
  const container = (extraction as unknown as Record<string, Record<string, ExtractedField<unknown>>>)[group];
  return container?.[key];
}

export function setExtractedField(
  extraction: ManifestExtraction,
  path: string,
  field: ExtractedField<unknown>,
) {
  const [group, key] = path.split(".");
  const container = (extraction as unknown as Record<string, Record<string, ExtractedField<unknown>>>)[group];
  if (!container || !(key in container)) {
    throw new Error(`Campo desconocido: ${path}`);
  }
  container[key] = field;
}

function isBlocking(requirement: FieldRequirement, field: ExtractedField<unknown>) {
  if (field.confidence > FIELD_CONFIDENCE_OK) return false;
  if (requirement === "MUST_HAVE" || requirement === "EXPECTED") return true;
  if (requirement === "OPTIONAL_CHECKED") return field.value !== null;
  return false;
}

/**
 * Calcula la confianza global y los campos a revisar.
 *
 * - La confianza global es la mínima entre los campos obligatorios/esperados
 *   y los opcionales verificables que sí vinieron en el PDF.
 * - Un campo opcional ausente (p. ej. semirremolque o SOAT en algunas
 *   variantes) no bloquea el guardado.
 */
export function evaluateExtraction(extraction: ManifestExtraction): ExtractionEvaluation {
  const reviewFields: ExtractionReviewField[] = [];
  const confidences: number[] = [];

  for (const definition of FIELD_DEFINITIONS) {
    const field = getExtractedField(extraction, definition.path);
    if (!field) continue;

    const counts =
      definition.requirement === "MUST_HAVE" ||
      definition.requirement === "EXPECTED" ||
      (definition.requirement === "OPTIONAL_CHECKED" && field.value !== null);
    if (counts) confidences.push(field.confidence);

    if (field.confidence > FIELD_CONFIDENCE_OK) continue;

    const blocking = isBlocking(definition.requirement, field);
    // Los opcionales ausentes no aportan nada a la revisión.
    if (!blocking && field.value === null) continue;

    reviewFields.push({
      path: definition.path,
      label: getFieldLabel(definition.path),
      value: field.value,
      confidence: field.confidence,
      section: field.section,
      requirement: definition.requirement,
      reason: field.value === null ? "MISSING" : "LOW_CONFIDENCE",
      required: blocking,
    });
  }

  const overallConfidence = confidences.length ? Math.min(...confidences) : 0;

  return {
    overallConfidence,
    action: getConfidenceAction(overallConfidence),
    summary: summarizeConfidence(extraction),
    reviewFields,
    blockingReviewFields: reviewFields.filter((field) => field.required),
  };
}

export function validateExtraction(
  extraction: ManifestExtraction,
): ManifestExtraction {
  return ManifestExtractionSchema.parse(extraction);
}

const AUTHORIZATION_PATTERN =
  /AUTORIZACI[OÓ]N\s*(?:N[O°º]\.?|#)?\s*:?\s*([0-9][0-9 ]{4,}[0-9])/i;

/**
 * Algunas variantes (p. ej. Pacar) traen la autorización fuera de la página 1.
 * Si el parser no la encontró, se busca en las demás páginas. Nunca se inventa:
 * si aparece, se marca con confianza 0.9 para que el usuario la confirme.
 */
function completeFromOtherPages(extraction: ManifestExtraction, pageTexts: string[]) {
  const authorization = extraction.manifest.authorizationNumber;
  if (authorization.value !== null) return;

  for (const [index, text] of pageTexts.entries()) {
    if (index === 0) continue;
    const match = AUTHORIZATION_PATTERN.exec(text);
    if (match) {
      extraction.manifest.authorizationNumber = {
        value: match[1].replace(/\s+/g, ""),
        confidence: 0.9,
        source: "PDF_TEXT",
        section: authorization.section,
        matchedLabel: `Autorización (página ${index + 1})`,
      };
      return;
    }
  }
}

export async function extractManifestFromPdf(
  input: Buffer | Uint8Array,
): Promise<ExtractionServiceResult> {
  return extractManifestFromPdfData(await extractPdfText(input));
}

/** Igual que extractManifestFromPdf, pero con el texto del PDF ya extraído. */
export function extractManifestFromPdfData(pdf: PdfExtractionResult): ExtractionServiceResult {
  let extraction: ManifestExtraction;
  let variant: ManifestVariant;
  try {
    const parsed = parseManifestDocument({ text: pdf.text, firstPageItems: pdf.items[0] });
    extraction = validateExtraction(parsed.extraction);
    variant = parsed.variant;
  } catch (error) {
    throw new Error("No fue posible validar la extracción del manifiesto.", {
      cause: error,
    });
  }

  completeFromOtherPages(extraction, pdf.pageTexts);

  return {
    extraction,
    rawText: pdf.fullText,
    pageCount: pdf.pageCount,
    hasText: pdf.hasText,
    variant,
    ...evaluateExtraction(extraction),
  };
}

export async function extractManifestFromPdfFile(
  filePath: string,
): Promise<ExtractionServiceResult> {
  const { readFile } = await import("node:fs/promises");
  const buffer = await readFile(filePath);
  return extractManifestFromPdf(buffer);
}

