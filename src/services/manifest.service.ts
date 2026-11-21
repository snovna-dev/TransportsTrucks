import type { ExtractionServiceResult } from "./extraction.service";
import { prisma } from "../lib/prisma";
import {
    ExtractionReviewStatus,
    ManifestJobStatus,
    ManifestStatus,
} from "../generated/prisma/enums";
import type { PrismaClient } from "../generated/prisma/client";
import type { ExtractedField, ManifestExtraction } from "../types/manifest-extraction";
import { linkDocumentsForManifest } from "./supporting-document.service";

export interface PersistManifestInput {
    extractionResult: Pick<
        ExtractionServiceResult,
        "extraction" | "rawText" | "overallConfidence" | "action" | "blockingReviewFields"
    >;
    pdfFileName?: string | null;
    pdfFileUrl?: string | null;
    pdfFileHash?: string | null;
    /** Si viene, el job queda COMPLETED y enlazado al manifiesto en la misma transacción. */
    jobId?: bigint | null;
    /** true cuando los datos ya pasaron por la revisión manual. */
    reviewed?: boolean;
}

export interface PersistManifestResult {
    manifestId: bigint;
    manifestNumber: string;
    authorizationNumber: string | null;
    status: ManifestStatus;
    reviewStatus: ExtractionReviewStatus;
    created: boolean;
    overallConfidence: number;
}

type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export class ManifestValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ManifestValidationError";
    }
}

function requiredValue<T>(field: ExtractedField<T>, path: string): T {
    if (field.value === null || field.value === undefined || field.value === "") {
        throw new ManifestValidationError(`Campo obligatorio no extraído: ${path}`);
    }

    return field.value;
}

function toUtcDate(value: string, path: string): Date {
    const date = new Date(`${value}T00:00:00.000Z`);

    if (Number.isNaN(date.getTime())) {
        throw new ManifestValidationError(`Fecha inválida en ${path}: ${value}`);
    }

    return date;
}

function optionalDate(field: ExtractedField<string>, path: string): Date | null {
    return field.value ? toUtcDate(field.value, path) : null;
}

/** Copia al `update` solo los valores presentes para no borrar datos ya conocidos. */
function presentValues<T extends Record<string, unknown>>(data: T): Partial<T> {
    return Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== null && value !== undefined),
    ) as Partial<T>;
}

async function upsertCompany(tx: TransactionClient, extraction: ManifestExtraction["company"]) {
    const nit = requiredValue(extraction.nit, "company.nit");
    const name = requiredValue(extraction.name, "company.name");
    const contact = {
        address: extraction.address.value,
        phone: extraction.phone.value,
        city: extraction.city.value,
    };

    return tx.company.upsert({
        where: { nit },
        create: { nit, name, ...contact },
        update: { name, ...presentValues(contact), updatedAt: new Date() },
    });
}

async function upsertDriver(tx: TransactionClient, extraction: ManifestExtraction["driver"]) {
    const identificationNumber = requiredValue(
        extraction.identificationNumber,
        "driver.identificationNumber",
    );
    const fullName = requiredValue(extraction.fullName, "driver.fullName");
    const details = {
        licenseCategory: extraction.licenseCategory.value,
        address: extraction.address.value,
        phone: extraction.phone.value,
        city: extraction.city.value,
    };

    return tx.driver.upsert({
        where: { identificationNumber },
        create: { identificationNumber, fullName, ...details },
        update: { fullName, ...presentValues(details), updatedAt: new Date() },
    });
}

type HolderExtraction = ManifestExtraction["manifestHolder"];

function holderData(extraction: HolderExtraction) {
    const identificationNumber = extraction.identificationNumber.value;
    const fullName = extraction.fullName.value;
    if (!identificationNumber || !fullName) return null;
    return {
        identificationNumber,
        fullName,
        contact: {
            address: extraction.address.value,
            phone: extraction.phone.value,
            city: extraction.city.value,
        },
    };
}

/** El titular del manifiesto es opcional: si falta su identificación o nombre, no se enlaza. */
async function upsertManifestHolder(tx: TransactionClient, extraction: HolderExtraction) {
    const data = holderData(extraction);
    if (!data) return null;
    return tx.manifestHolder.upsert({
        where: { identificationNumber: data.identificationNumber },
        create: { identificationNumber: data.identificationNumber, fullName: data.fullName, ...data.contact },
        update: { fullName: data.fullName, ...presentValues(data.contact), updatedAt: new Date() },
    });
}

async function upsertVehicleHolder(tx: TransactionClient, extraction: ManifestExtraction["vehicleHolder"]) {
    const data = holderData(extraction);
    if (!data) return null;
    return tx.vehicleHolder.upsert({
        where: { identificationNumber: data.identificationNumber },
        create: { identificationNumber: data.identificationNumber, fullName: data.fullName, ...data.contact },
        update: { fullName: data.fullName, ...presentValues(data.contact), updatedAt: new Date() },
    });
}

/**
 * Solo la placa es obligatoria. Semirremolque, SOAT, marca, etc. no existen en
 * todas las variantes del PDF; si faltan, se conservan los valores previos.
 */
async function upsertVehicle(tx: TransactionClient, extraction: ManifestExtraction["vehicle"]) {
    const plate = requiredValue(extraction.plate, "vehicle.plate");
    const data = {
        brand: extraction.brand.value,
        semiTrailerPlate: extraction.semiTrailerPlate.value,
        configuration: extraction.configuration.value,
        emptyWeight: extraction.emptyWeight.value,
        soatPolicyNumber: extraction.soatPolicyNumber.value,
        soatInsuranceCompany: extraction.soatInsuranceCompany.value,
        soatExpirationDate: optionalDate(extraction.soatExpirationDate, "vehicle.soatExpirationDate"),
    };

    return tx.vehicle.upsert({
        where: { plate },
        create: { plate, ...data },
        update: { ...presentValues(data), updatedAt: new Date() },
    });
}

/** Remitente, destinatario y propietario: opcionales; sin identificación se busca por nombre. */
async function upsertPersonOrCompany(
    tx: TransactionClient,
    extraction: ManifestExtraction["sender"],
) {
    const identificationNumber = extraction.identificationNumber.value;
    const name = extraction.name.value;

    if (identificationNumber) {
        return tx.personOrCompany.upsert({
            where: { identificationNumber },
            create: { identificationNumber, name: name ?? identificationNumber },
            update: { ...(name ? { name } : {}), updatedAt: new Date() },
        });
    }

    if (!name) return null;

    const existing = await tx.personOrCompany.findFirst({
        where: { identificationNumber: null, name },
    });
    return existing ?? tx.personOrCompany.create({ data: { name } });
}

async function findExistingManifest(
    tx: TransactionClient,
    manifestNumber: string,
    authorizationNumber: string | null,
) {
    const [byManifest, byAuthorization] = await Promise.all([
        tx.manifest.findUnique({ where: { manifestNumber } }),
        authorizationNumber
            ? tx.manifest.findUnique({ where: { authorizationNumber } })
            : Promise.resolve(null),
    ]);

    if (byManifest && byAuthorization && byManifest.id !== byAuthorization.id) {
        throw new ManifestValidationError(
            `Conflicto de unicidad: el manifiesto ${manifestNumber} y la autorización ${authorizationNumber} pertenecen a registros diferentes.`,
        );
    }

    return byManifest ?? byAuthorization ?? null;
}

/**
 * Guarda (o sobrescribe, si ya existe el mismo número de manifiesto o de
 * autorización) el Manifest con su carga y entidades relacionadas.
 */
async function persistManifestRecord(
    input: PersistManifestInput,
): Promise<PersistManifestResult> {
    const { extractionResult } = input;
    const extraction = extractionResult.extraction;
    const now = new Date();

    const manifestNumber = requiredValue(
        extraction.manifest.manifestNumber,
        "manifest.manifestNumber",
    );
    const authorizationNumber = extraction.manifest.authorizationNumber.value || null;
    const issueDate = requiredValue(extraction.manifest.issueDate, "manifest.issueDate");
    const remittanceNumber = requiredValue(
        extraction.cargo.remittanceNumber,
        "cargo.remittanceNumber",
    );

    if (!input.reviewed && extractionResult.blockingReviewFields.length > 0) {
        throw new ManifestValidationError(
            `La extracción tiene ${extractionResult.blockingReviewFields.length} campo(s) obligatorio(s) pendientes de revisión.`,
        );
    }

    const manifestStatus = ManifestStatus.COMPLETED;
    const reviewStatus = input.reviewed
        ? ExtractionReviewStatus.APPROVED
        : extractionResult.action === "AUTO_SAVE"
          ? ExtractionReviewStatus.APPROVED
          : ExtractionReviewStatus.PENDING;

    return prisma.$transaction(async (tx) => {
        const company = await upsertCompany(tx, extraction.company);
        const manifestHolder = await upsertManifestHolder(tx, extraction.manifestHolder);
        const driver = await upsertDriver(tx, extraction.driver);
        const vehicleHolder = await upsertVehicleHolder(tx, extraction.vehicleHolder);
        const vehicle = await upsertVehicle(tx, extraction.vehicle);
        const sender = await upsertPersonOrCompany(tx, extraction.sender);
        const recipient = await upsertPersonOrCompany(tx, extraction.recipient);
        const cargoOwner = await upsertPersonOrCompany(tx, extraction.cargoOwner);

        const existingManifest = await findExistingManifest(tx, manifestNumber, authorizationNumber);

        const manifestData = {
            companyId: company.id,
            manifestNumber,
            // Al sobrescribir, una autorización ausente no borra la que ya estaba registrada.
            authorizationNumber: authorizationNumber ?? existingManifest?.authorizationNumber ?? null,
            issueDate: toUtcDate(issueDate, "manifest.issueDate"),
            manifestType: extraction.manifest.manifestType.value,
            origin: extraction.manifest.origin.value,
            intermediateCity: extraction.manifest.intermediateCity.value,
            destination: extraction.manifest.destination.value,
            driverId: driver.id,
            vehicleId: vehicle.id,
            vehicleHolderId: vehicleHolder?.id ?? null,
            manifestHolderId: manifestHolder?.id ?? null,
            cargoOwnerId: cargoOwner?.id ?? null,
            senderId: sender?.id ?? null,
            recipientId: recipient?.id ?? null,
            policyOwnerName: extraction.manifest.policyOwnerName.value,
            totalTripValue: extraction.manifest.totalTripValue.value,
            withholdingTax: extraction.manifest.withholdingTax.value,
            icaWithholding: extraction.manifest.icaWithholding.value,
            netValueToPay: extraction.manifest.netValueToPay.value,
            advanceValue: extraction.manifest.advanceValue.value,
            balanceToPay: extraction.manifest.balanceToPay.value,
            paymentLocation: extraction.manifest.paymentLocation.value,
            paymentDate: optionalDate(extraction.manifest.paymentDate, "manifest.paymentDate"),
            loadingPaidBy: extraction.manifest.loadingPaidBy.value,
            unloadingPaidBy: extraction.manifest.unloadingPaidBy.value,
            agreedValueInWords: extraction.manifest.agreedValueInWords.value,
            recommendations: extraction.manifest.recommendations.value,
            pdfFileName: input.pdfFileName ?? undefined,
            pdfFileUrl: input.pdfFileUrl ?? undefined,
            pdfFileHash: input.pdfFileHash ?? undefined,
            status: manifestStatus,
            updatedAt: now,
        };

        const manifest = existingManifest
            ? await tx.manifest.update({
                  where: { id: existingManifest.id },
                  data: manifestData,
              })
            : await tx.manifest.create({
                  data: { ...manifestData, createdAt: now },
              });

        const cargoData = {
            remittanceNumber,
            measurementUnit: extraction.cargo.measurementUnit.value,
            quantity: extraction.cargo.quantity.value,
            nature: extraction.cargo.nature.value,
            packaging: extraction.cargo.packaging.value,
            productCode: extraction.cargo.productCode.value,
            transportedProduct: extraction.cargo.transportedProduct.value,
            updatedAt: now,
        };

        await tx.cargo.upsert({
            where: { manifestId: manifest.id },
            create: { manifestId: manifest.id, ...cargoData, createdAt: now },
            update: cargoData,
        });

        const extractedJson = JSON.parse(JSON.stringify(extraction));

        await tx.manifestProcessing.upsert({
            where: { manifestId: manifest.id },
            create: {
                manifestId: manifest.id,
                reviewStatus,
                rawText: extractionResult.rawText,
                extractedJson,
                overallConfidence: extractionResult.overallConfidence,
                processingError: null,
                attempts: 1,
                startedAt: now,
                completedAt: now,
                createdAt: now,
            },
            update: {
                reviewStatus,
                rawText: extractionResult.rawText,
                extractedJson,
                overallConfidence: extractionResult.overallConfidence,
                processingError: null,
                attempts: { increment: 1 },
                startedAt: now,
                completedAt: now,
                updatedAt: now,
            },
        });

        if (input.jobId) {
            await tx.manifestJob.update({
                where: { id: input.jobId },
                data: {
                    manifestId: manifest.id,
                    status: ManifestJobStatus.COMPLETED,
                    errorMessage: null,
                    completedAt: now,
                    updatedAt: now,
                    ...(input.reviewed ? { reviewedAt: now } : {}),
                },
            });
            await tx.manifestFieldCorrection.updateMany({
                where: { jobId: input.jobId, manifestId: null },
                data: { manifestId: manifest.id },
            });
        }

        return {
            manifestId: manifest.id,
            manifestNumber: manifest.manifestNumber,
            authorizationNumber: manifest.authorizationNumber,
            status: manifest.status,
            reviewStatus,
            created: !existingManifest,
            overallConfidence: extractionResult.overallConfidence,
        };
    });
}

/**
 * Guarda el manifiesto y, ya confirmado, vincula las remesas y órdenes de
 * cargue que se habían cargado antes y le pertenecen. La vinculación es un
 * complemento: si falla, el manifiesto igual queda guardado.
 */
export async function persistManifest(input: PersistManifestInput): Promise<PersistManifestResult> {
    const result = await persistManifestRecord(input);
    try {
        await linkDocumentsForManifest(result.manifestId);
    } catch (error) {
        console.error(`linkDocumentsForManifest(${result.manifestId})`, error);
    }
    return result;
}
