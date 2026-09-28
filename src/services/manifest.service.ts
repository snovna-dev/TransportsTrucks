import type { ExtractionAction, ExtractionServiceResult } from "./extraction.service";
import { prisma } from "../lib/prisma";
import { ExtractionReviewStatus, ManifestStatus } from "../generated/prisma/enums";
import type { PrismaClient } from "../generated/prisma/client";
import type { ExtractedField, ManifestExtraction } from "../types/manifest-extraction";

export interface PersistManifestInput {
    extractionResult: ExtractionServiceResult;
    pdfFileName?: string | null;
    pdfFileUrl?: string | null;
    pdfFileHash?: string | null;
}

export interface PersistManifestResult {
    manifestId: bigint;
    manifestNumber: string;
    authorizationNumber: string;
    status: ManifestStatus;
    reviewStatus: ExtractionReviewStatus;
    created: boolean;
    overallConfidence: number;
}

type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

function requiredValue<T>(field: ExtractedField<T>, path: string): T {
    if (field.value === null || field.value === undefined) {
        throw new Error(`Campo obligatorio no extraído: ${path}`);
    }

    return field.value;
}

function toUtcDate(value: string, path: string): Date {
    const date = new Date(`${value}T00:00:00.000Z`);

    if (Number.isNaN(date.getTime())) {
        throw new Error(`Fecha inválida en ${path}: ${value}`);
    }

    return date;
}

function optionalDate(field: ExtractedField<string>): Date | undefined {
    return field.value ? toUtcDate(field.value, field.matchedLabel ?? "fecha") : undefined;
}

function mapManifestStatus(action: ExtractionAction): ManifestStatus {
    return action === "AUTO_SAVE"
        ? ManifestStatus.COMPLETED
        : ManifestStatus.REVIEW_REQUIRED;
}

function mapReviewStatus(action: ExtractionAction): ExtractionReviewStatus {
    return action === "AUTO_SAVE"
        ? ExtractionReviewStatus.APPROVED
        : ExtractionReviewStatus.PENDING;
}

async function upsertCompany(
    tx: TransactionClient,
    extraction: ManifestExtraction["company"],
) {
    const nit = requiredValue(extraction.nit, "company.nit");
    const name = requiredValue(extraction.name, "company.name");

    return tx.company.upsert({
        where: { nit },
        create: {
        nit,
        name,
        address: extraction.address.value,
        phone: extraction.phone.value,
        city: extraction.city.value,
        },
        update: {
        name,
        ...(extraction.address.value !== null && { address: extraction.address.value }),
        ...(extraction.phone.value !== null && { phone: extraction.phone.value }),
        ...(extraction.city.value !== null && { city: extraction.city.value }),
        updatedAt: new Date(),
        },
    });
}

async function upsertDriver(
    tx: TransactionClient,
    extraction: ManifestExtraction["driver"],
) {
    const identificationNumber = requiredValue(
        extraction.identificationNumber,
        "driver.identificationNumber",
    );
    const fullName = requiredValue(extraction.fullName, "driver.fullName");

    return tx.driver.upsert({
        where: { identificationNumber },
        create: {
        identificationNumber,
        fullName,
        licenseCategory: extraction.licenseCategory.value,
        address: extraction.address.value,
        phone: extraction.phone.value,
        city: extraction.city.value,
        },
        update: {
        fullName,
        ...(extraction.licenseCategory.value !== null && {
            licenseCategory: extraction.licenseCategory.value,
        }),
        ...(extraction.address.value !== null && { address: extraction.address.value }),
        ...(extraction.phone.value !== null && { phone: extraction.phone.value }),
        ...(extraction.city.value !== null && { city: extraction.city.value }),
        updatedAt: new Date(),
        },
    });
}

async function upsertManifestHolder(
    tx: TransactionClient,
    extraction: ManifestExtraction["manifestHolder"],
) {
    const identificationNumber = requiredValue(
        extraction.identificationNumber,
        "manifestHolder.identificationNumber",
    );
    const fullName = requiredValue(extraction.fullName, "manifestHolder.fullName");

    return tx.manifestHolder.upsert({
        where: { identificationNumber },
        create: {
        identificationNumber,
        fullName,
        address: extraction.address.value,
        phone: extraction.phone.value,
        city: extraction.city.value,
        },
        update: {
        fullName,
        ...(extraction.address.value !== null && { address: extraction.address.value }),
        ...(extraction.phone.value !== null && { phone: extraction.phone.value }),
        ...(extraction.city.value !== null && { city: extraction.city.value }),
        updatedAt: new Date(),
        },
    });
}

async function upsertVehicleHolder(
    tx: TransactionClient,
    extraction: ManifestExtraction["vehicleHolder"],
) {
    const identificationNumber = requiredValue(
        extraction.identificationNumber,
        "vehicleHolder.identificationNumber",
    );
    const fullName = requiredValue(extraction.fullName, "vehicleHolder.fullName");

    return tx.vehicleHolder.upsert({
        where: { identificationNumber },
        create: {
        identificationNumber,
        fullName,
        address: extraction.address.value,
        phone: extraction.phone.value,
        city: extraction.city.value,
        },
        update: {
        fullName,
        ...(extraction.address.value !== null && { address: extraction.address.value }),
        ...(extraction.phone.value !== null && { phone: extraction.phone.value }),
        ...(extraction.city.value !== null && { city: extraction.city.value }),
        updatedAt: new Date(),
        },
    });
}

async function upsertVehicle(
    tx: TransactionClient,
    extraction: ManifestExtraction["vehicle"],
) {
    const plate = requiredValue(extraction.plate, "vehicle.plate");
    const brand = requiredValue(extraction.brand, "vehicle.brand");
    const semiTrailerPlate = requiredValue(
        extraction.semiTrailerPlate,
        "vehicle.semiTrailerPlate",
    );
    const configuration = requiredValue(
        extraction.configuration,
        "vehicle.configuration",
    );
    const emptyWeight = requiredValue(extraction.emptyWeight, "vehicle.emptyWeight");
    const soatPolicyNumber = requiredValue(
        extraction.soatPolicyNumber,
        "vehicle.soatPolicyNumber",
    );
    const soatInsuranceCompany = requiredValue(
        extraction.soatInsuranceCompany,
        "vehicle.soatInsuranceCompany",
    );
    const soatExpirationDate = requiredValue(
        extraction.soatExpirationDate,
        "vehicle.soatExpirationDate",
    );

    const data = {
        brand,
        semiTrailerPlate,
        configuration,
        emptyWeight,
        soatPolicyNumber,
        soatInsuranceCompany,
        soatExpirationDate: toUtcDate(
        soatExpirationDate,
        "vehicle.soatExpirationDate",
        ),
    };

    return tx.vehicle.upsert({
        where: { plate },
        create: {
        plate,
        ...data,
        },
        update: {
        ...data,
        updatedAt: new Date(),
        },
    });
}

async function upsertPersonOrCompany(
    tx: TransactionClient,
    extraction: ManifestExtraction["sender"],
    path: string,
) {
    const identificationNumber = requiredValue(
        extraction.identificationNumber,
        `${path}.identificationNumber`,
    );
    const name = requiredValue(extraction.name, `${path}.name`);

    return tx.personOrCompany.upsert({
        where: { identificationNumber },
        create: {
        identificationNumber,
        name,
        },
        update: {
        name,
        updatedAt: new Date(),
        },
    });
}

async function findExistingManifest(
    tx: TransactionClient,
    manifestNumber: string,
    authorizationNumber: string,
) {
    const [byManifest, byAuthorization] = await Promise.all([
        tx.manifest.findUnique({ where: { manifestNumber } }),
        tx.manifest.findUnique({ where: { authorizationNumber } }),
    ]);

    if (byManifest && byAuthorization && byManifest.id !== byAuthorization.id) {
        throw new Error(
        `Conflicto de unicidad: el manifiesto ${manifestNumber} y la autorización ${authorizationNumber} pertenecen a registros diferentes.`,
        );
    }

    return byManifest ?? byAuthorization ?? null;
}

export async function persistManifest(
    input: PersistManifestInput,
): Promise<PersistManifestResult> {
    const { extractionResult } = input;
    const extraction = extractionResult.extraction;
    const now = new Date();

    const manifestNumber = requiredValue(
        extraction.manifest.manifestNumber,
        "manifest.manifestNumber",
    );
    const authorizationNumber = requiredValue(
        extraction.manifest.authorizationNumber,
        "manifest.authorizationNumber",
    );
    const issueDate = requiredValue(extraction.manifest.issueDate, "manifest.issueDate");

    if (extractionResult.blockingReviewFields.length > 0) {
        throw new Error(
        `La extracción tiene ${extractionResult.blockingReviewFields.length} campo(s) obligatorio(s) pendientes de revisión.`,
        );
    }

    const manifestStatus = mapManifestStatus(extractionResult.action);
    const reviewStatus = mapReviewStatus(extractionResult.action);

    return prisma.$transaction(async (tx) => {
        const company = await upsertCompany(tx, extraction.company);
        const manifestHolder = await upsertManifestHolder(tx, extraction.manifestHolder);
        const driver = await upsertDriver(tx, extraction.driver);
        const vehicleHolder = await upsertVehicleHolder(tx, extraction.vehicleHolder);
        const vehicle = await upsertVehicle(tx, extraction.vehicle);
        const sender = await upsertPersonOrCompany(tx, extraction.sender, "sender");
        const recipient = await upsertPersonOrCompany(
        tx,
        extraction.recipient,
        "recipient",
        );

        let cargoOwnerId: bigint | null = null;

        if (
        extraction.cargoOwner.identificationNumber.value !== null &&
        extraction.cargoOwner.name.value !== null
        ) {
        const cargoOwner = await upsertPersonOrCompany(
            tx,
            extraction.cargoOwner,
            "cargoOwner",
        );
        cargoOwnerId = cargoOwner.id;
        }

        const existingManifest = await findExistingManifest(
        tx,
        manifestNumber,
        authorizationNumber,
        );

        const manifestData = {
        companyId: company.id,
        manifestNumber,
        authorizationNumber,
        issueDate: toUtcDate(issueDate, "manifest.issueDate"),
        manifestType: extraction.manifest.manifestType.value,
        origin: extraction.manifest.origin.value,
        intermediateCity: extraction.manifest.intermediateCity.value,
        destination: extraction.manifest.destination.value,
        driverId: driver.id,
        vehicleId: vehicle.id,
        vehicleHolderId: vehicleHolder.id,
        manifestHolderId: manifestHolder.id,
        cargoOwnerId,
        senderId: sender.id,
        recipientId: recipient.id,
        policyOwnerName: extraction.manifest.policyOwnerName.value,
        totalTripValue: extraction.manifest.totalTripValue.value,
        withholdingTax: extraction.manifest.withholdingTax.value,
        icaWithholding: extraction.manifest.icaWithholding.value,
        netValueToPay: extraction.manifest.netValueToPay.value,
        advanceValue: extraction.manifest.advanceValue.value,
        balanceToPay: extraction.manifest.balanceToPay.value,
        paymentLocation: extraction.manifest.paymentLocation.value,
        paymentDate: optionalDate(extraction.manifest.paymentDate),
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
            data: {
                ...manifestData,
                createdAt: now,
            },
            });

        const cargoRemittanceNumber = requiredValue(
        extraction.cargo.remittanceNumber,
        "cargo.remittanceNumber",
        );

        const cargoData = {
        remittanceNumber: cargoRemittanceNumber,
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
        create: {
            manifestId: manifest.id,
            ...cargoData,
            createdAt: now,
        },
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
            attempts: {
            increment: 1,
            },
            startedAt: now,
            completedAt: now,
            updatedAt: now,
        },
        });

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
