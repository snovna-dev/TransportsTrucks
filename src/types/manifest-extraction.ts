export type ConfidenceSource = "PDF_TEXT";

export interface ExtractedField<T> {
  value: T | null;
  confidence: number;
  source: ConfidenceSource;
  section: ManifestSection;
  matchedLabel: string | null;
}

export type ManifestSection =
  | "HEADER"
  | "MANIFEST_INFORMATION"
  | "VEHICLE_AND_DRIVER"
  | "DRIVER"
  | "VEHICLE_HOLDER"
  | "CARGO_INFORMATION"
  | "CARGO"
  | "SENDER"
  | "RECIPIENT"
  | "PAYMENT"
  | "RECOMMENDATIONS";

export interface CompanyExtraction {
  nit: ExtractedField<string>;
  name: ExtractedField<string>;
  address: ExtractedField<string>;
  phone: ExtractedField<string>;
  city: ExtractedField<string>;
}

export interface ManifestExtractionData {
  manifestNumber: ExtractedField<string>;
  authorizationNumber: ExtractedField<string>;
  issueDate: ExtractedField<string>;
  manifestType: ExtractedField<string>;
  origin: ExtractedField<string>;
  intermediateCity: ExtractedField<string>;
  destination: ExtractedField<string>;
  policyOwnerName: ExtractedField<string>;
  totalTripValue: ExtractedField<number>;
  withholdingTax: ExtractedField<number>;
  icaWithholding: ExtractedField<number>;
  netValueToPay: ExtractedField<number>;
  advanceValue: ExtractedField<number>;
  balanceToPay: ExtractedField<number>;
  paymentLocation: ExtractedField<string>;
  paymentDate: ExtractedField<string>;
  loadingPaidBy: ExtractedField<string>;
  unloadingPaidBy: ExtractedField<string>;
  agreedValueInWords: ExtractedField<string>;
  recommendations: ExtractedField<string>;
}

export interface ManifestHolderExtraction {
  identificationNumber: ExtractedField<string>;
  fullName: ExtractedField<string>;
  address: ExtractedField<string>;
  phone: ExtractedField<string>;
  city: ExtractedField<string>;
}

export interface DriverExtraction {
  identificationNumber: ExtractedField<string>;
  fullName: ExtractedField<string>;
  licenseCategory: ExtractedField<string>;
  address: ExtractedField<string>;
  phone: ExtractedField<string>;
  city: ExtractedField<string>;
}

export interface VehicleHolderExtraction {
  identificationNumber: ExtractedField<string>;
  fullName: ExtractedField<string>;
  address: ExtractedField<string>;
  phone: ExtractedField<string>;
  city: ExtractedField<string>;
}

export interface VehicleExtraction {
  plate: ExtractedField<string>;
  brand: ExtractedField<string>;
  semiTrailerPlate: ExtractedField<string>;
  configuration: ExtractedField<string>;
  emptyWeight: ExtractedField<number>;
  soatPolicyNumber: ExtractedField<string>;
  soatInsuranceCompany: ExtractedField<string>;
  soatExpirationDate: ExtractedField<string>;
}

export interface PersonOrCompanyExtraction {
  identificationNumber: ExtractedField<string>;
  name: ExtractedField<string>;
}

export interface CargoExtraction {
  remittanceNumber: ExtractedField<string>;
  measurementUnit: ExtractedField<string>;
  quantity: ExtractedField<number>;
  nature: ExtractedField<string>;
  packaging: ExtractedField<string>;
  productCode: ExtractedField<string>;
  transportedProduct: ExtractedField<string>;
}

export interface ManifestExtraction {
  company: CompanyExtraction;
  manifest: ManifestExtractionData;
  manifestHolder: ManifestHolderExtraction;
  driver: DriverExtraction;
  vehicleHolder: VehicleHolderExtraction;
  vehicle: VehicleExtraction;
  cargoOwner: PersonOrCompanyExtraction;
  sender: PersonOrCompanyExtraction;
  recipient: PersonOrCompanyExtraction;
  cargo: CargoExtraction;
}
