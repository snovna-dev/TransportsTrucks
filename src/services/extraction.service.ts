import { extractPdfText } from "../lib/manifiestos_parser/pdf";
import {
  getFieldsForReview,
  parseManifestText,
  summarizeConfidence,
} from "../lib/manifiestos_parser/manifest-parser";
import {
  getConfidenceAction,
  ManifestExtractionSchema,
} from "../schemas/manifest-extraction.schema";
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
  value: unknown;
  confidence: number;
  section: string;
  required: boolean;
}

export interface ExtractionServiceResult {
  extraction: ManifestExtraction;
  rawText: string;
  pageCount: number;
  hasText: boolean;
  overallConfidence: number;
  action: ExtractionAction;
  summary: ReturnType<typeof summarizeConfidence>;
  reviewFields: ExtractionReviewField[];
  blockingReviewFields: ExtractionReviewField[];
}

/**
 * Fields that are needed to identify and persist a manifest safely.
 * Missing optional information (for example intermediate city or phone)
 * does not block automatic persistence.
 */
const REQUIRED_FIELDS = new Set([
  "company.nit",
  "company.name",
  "manifest.manifestNumber",
  "manifest.authorizationNumber",
  "manifest.issueDate",
  "manifest.manifestType",
  "manifest.origin",
  "manifest.destination",
  "manifestHolder.identificationNumber",
  "manifestHolder.fullName",
  "driver.identificationNumber",
  "driver.fullName",
  "driver.licenseCategory",
  "vehicle.plate",
  "vehicle.brand",
  "vehicle.semiTrailerPlate",
  "vehicle.configuration",
  "vehicle.emptyWeight",
  "vehicle.soatPolicyNumber",
  "vehicle.soatInsuranceCompany",
  "vehicle.soatExpirationDate",
  "vehicleHolder.identificationNumber",
  "vehicleHolder.fullName",
  "sender.identificationNumber",
  "sender.name",
  "recipient.identificationNumber",
  "recipient.name",
  "cargo.remittanceNumber",
  "cargo.measurementUnit",
  "cargo.quantity",
  "cargo.nature",
  "cargo.packaging",
  "cargo.productCode",
  "cargo.transportedProduct",
]);

function collectFields(
  value: unknown,
  path = "",
  result: Array<{ path: string; field: ExtractedField<unknown> }> = [],
) {
  if (!value || typeof value !== "object") return result;

  if (
    "value" in value &&
    "confidence" in value &&
    "section" in value
  ) {
    result.push({
      path,
      field: value as ExtractedField<unknown>,
    });
    return result;
  }

  Object.entries(value).forEach(([key, child]) => {
    collectFields(child, path ? `${path}.${key}` : key, result);
  });

  return result;
}

function calculateOverallConfidence(extraction: ManifestExtraction): number {
  const fields = collectFields(extraction);
  const required = fields.filter(({ path }) => REQUIRED_FIELDS.has(path));

  if (required.length === 0) return 0;

  return Math.min(...required.map(({ field }) => field.confidence));
}

function toReviewFields(extraction: ManifestExtraction): ExtractionReviewField[] {
  return getFieldsForReview(extraction).map((field) => ({
    ...field,
    required: REQUIRED_FIELDS.has(field.path),
  }));
}

export function getRequiredExtractionFields() {
  return [...REQUIRED_FIELDS];
}

export function validateExtraction(
  extraction: ManifestExtraction,
): ManifestExtraction {
  return ManifestExtractionSchema.parse(extraction);
}

export async function extractManifestFromPdf(
  input: Buffer | Uint8Array,
): Promise<ExtractionServiceResult> {
  const pdf = await extractPdfText(input);

  try {
    const extraction = validateExtraction(parseManifestText(pdf.text));
    const overallConfidence = calculateOverallConfidence(extraction);
    const action = getConfidenceAction(overallConfidence);
    const summary = summarizeConfidence(extraction);
    const reviewFields = toReviewFields(extraction);
    const blockingReviewFields = reviewFields.filter(
      (field) => field.required,
    );

    return {
      extraction,
      rawText: pdf.text,
      pageCount: pdf.pageCount,
      hasText: pdf.hasText,
      overallConfidence,
      action,
      summary,
      reviewFields,
      blockingReviewFields,
    };
  } catch (error) {
    throw new Error("No fue posible validar la extracción del manifiesto.", {
      cause: error,
    });
  }
}

export async function extractManifestFromPdfFile(
  filePath: string,
): Promise<ExtractionServiceResult> {
  const { readFile } = await import("node:fs/promises");
  const buffer = await readFile(filePath);
  return extractManifestFromPdf(buffer);
}
