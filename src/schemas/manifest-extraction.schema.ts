import { z } from "zod";

export const ManifestSectionSchema = z.enum([
  "HEADER",
  "MANIFEST_INFORMATION",
  "VEHICLE_AND_DRIVER",
  "DRIVER",
  "VEHICLE_HOLDER",
  "CARGO_INFORMATION",
  "CARGO",
  "SENDER",
  "RECIPIENT",
  "PAYMENT",
  "RECOMMENDATIONS",
]);

export const ConfidenceSourceSchema = z.literal("PDF_TEXT");
export const confidenceSchema = z.number().min(0).max(1);

export const extractedFieldSchema = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    value: valueSchema.nullable(),
    confidence: confidenceSchema,
    source: ConfidenceSourceSchema,
    section: ManifestSectionSchema,
    matchedLabel: z.string().nullable(),
  });

export const stringFieldSchema = extractedFieldSchema(z.string());
export const numberFieldSchema = extractedFieldSchema(z.number());

export const CompanyExtractionSchema = z.object({
  nit: stringFieldSchema,
  name: stringFieldSchema,
  address: stringFieldSchema,
  phone: stringFieldSchema,
  city: stringFieldSchema,
});

export const ManifestExtractionDataSchema = z.object({
  manifestNumber: stringFieldSchema,
  authorizationNumber: stringFieldSchema,
  issueDate: stringFieldSchema,
  manifestType: stringFieldSchema,
  origin: stringFieldSchema,
  intermediateCity: stringFieldSchema,
  destination: stringFieldSchema,
  policyOwnerName: stringFieldSchema,
  totalTripValue: numberFieldSchema,
  withholdingTax: numberFieldSchema,
  icaWithholding: numberFieldSchema,
  netValueToPay: numberFieldSchema,
  advanceValue: numberFieldSchema,
  balanceToPay: numberFieldSchema,
  paymentLocation: stringFieldSchema,
  paymentDate: stringFieldSchema,
  loadingPaidBy: stringFieldSchema,
  unloadingPaidBy: stringFieldSchema,
  agreedValueInWords: stringFieldSchema,
  recommendations: stringFieldSchema,
});

export const ManifestHolderExtractionSchema = z.object({
  identificationNumber: stringFieldSchema,
  fullName: stringFieldSchema,
  address: stringFieldSchema,
  phone: stringFieldSchema,
  city: stringFieldSchema,
});

export const DriverExtractionSchema = z.object({
  identificationNumber: stringFieldSchema,
  fullName: stringFieldSchema,
  licenseCategory: stringFieldSchema,
  address: stringFieldSchema,
  phone: stringFieldSchema,
  city: stringFieldSchema,
});

export const VehicleHolderExtractionSchema = z.object({
  identificationNumber: stringFieldSchema,
  fullName: stringFieldSchema,
  address: stringFieldSchema,
  phone: stringFieldSchema,
  city: stringFieldSchema,
});

export const VehicleExtractionSchema = z.object({
  plate: stringFieldSchema,
  brand: stringFieldSchema,
  semiTrailerPlate: stringFieldSchema,
  configuration: stringFieldSchema,
  emptyWeight: numberFieldSchema,
  soatPolicyNumber: stringFieldSchema,
  soatInsuranceCompany: stringFieldSchema,
  soatExpirationDate: stringFieldSchema,
});

export const PersonOrCompanyExtractionSchema = z.object({
  identificationNumber: stringFieldSchema,
  name: stringFieldSchema,
});

export const CargoExtractionSchema = z.object({
  remittanceNumber: stringFieldSchema,
  measurementUnit: stringFieldSchema,
  quantity: numberFieldSchema,
  nature: stringFieldSchema,
  packaging: stringFieldSchema,
  productCode: stringFieldSchema,
  transportedProduct: stringFieldSchema,
});

export const ManifestExtractionSchema = z.object({
  company: CompanyExtractionSchema,
  manifest: ManifestExtractionDataSchema,
  manifestHolder: ManifestHolderExtractionSchema,
  driver: DriverExtractionSchema,
  vehicleHolder: VehicleHolderExtractionSchema,
  vehicle: VehicleExtractionSchema,
  cargoOwner: PersonOrCompanyExtractionSchema,
  sender: PersonOrCompanyExtractionSchema,
  recipient: PersonOrCompanyExtractionSchema,
  cargo: CargoExtractionSchema,
});

export type ManifestExtraction = z.infer<typeof ManifestExtractionSchema>;

export const CONFIDENCE_THRESHOLDS = {
  AUTO_APPROVE: 0.95,
  REVIEW_REQUIRED: 0.75,
} as const;

export function getConfidenceAction(confidence: number) {
  if (confidence > CONFIDENCE_THRESHOLDS.AUTO_APPROVE) {
    return "AUTO_SAVE" as const;
  }
  if (confidence >= CONFIDENCE_THRESHOLDS.REVIEW_REQUIRED) {
    return "SAVE_FOR_REVIEW" as const;
  }
  return "MANUAL_REVIEW" as const;
}
