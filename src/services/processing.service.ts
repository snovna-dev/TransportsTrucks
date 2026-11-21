import { prisma } from "../lib/prisma";
import { readPdf } from "../lib/storage";
import { ManifestJobStatus } from "../generated/prisma/enums";
import { extractPdfText } from "../lib/manifiestos_parser/pdf";
import { checkManifestDocument } from "../lib/manifiestos_parser/document-check";
import { extractManifestFromPdfData, type ExtractionAction } from "./extraction.service";
import { ManifestValidationError, persistManifest } from "./manifest.service";
import { markManifestJobError, STALE_PROCESSING_MS } from "./manifest-job.service";
import { toStoredExtraction } from "./stored-extraction";

export interface ProcessManifestJobResult {
    jobId: bigint;
    status: ManifestJobStatus;
    manifestId: bigint | null;
    overallConfidence: number | null;
    action: ExtractionAction | null;
    blockingFields: number;
    /** true si el job no se procesó porque ya estaba en otro estado (idempotencia). */
    skipped: boolean;
    error?: string;
}

export function manifestPdfUrl(jobId: bigint) {
    return `/api/manifest-jobs/${jobId}/pdf`;
}

/**
 * Procesa un job de punta a punta: lee el PDF del almacenamiento, extrae los
 * datos y, según la confianza, guarda el Manifest (COMPLETED) o deja el job en
 * REVIEW_REQUIRED con rawText / extractedJson / overallConfidence.
 *
 * Es idempotente: reclama el job de forma atómica, así que dos llamadas
 * simultáneas (p. ej. un reintento de Pub/Sub) no lo procesan dos veces.
 */
export async function processManifestJob(
    jobId: bigint,
    options: { force?: boolean } = {},
): Promise<ProcessManifestJobResult> {
    const now = new Date();
    const claimable: ManifestJobStatus[] = [
        ManifestJobStatus.UPLOADED,
        ManifestJobStatus.QUEUED,
        ManifestJobStatus.ERROR,
    ];
    if (options.force) claimable.push(ManifestJobStatus.REVIEW_REQUIRED);

    const claim = await prisma.manifestJob.updateMany({
        where: {
            id: jobId,
            OR: [
                { status: { in: claimable } },
                {
                    status: ManifestJobStatus.PROCESSING,
                    startedAt: { lt: new Date(now.getTime() - STALE_PROCESSING_MS) },
                },
            ],
        },
        data: {
            status: ManifestJobStatus.PROCESSING,
            attempts: { increment: 1 },
            startedAt: now,
            completedAt: null,
            errorMessage: null,
            updatedAt: now,
        },
    });

    const job = await prisma.manifestJob.findUnique({
        where: { id: jobId },
        select: {
            id: true,
            status: true,
            manifestId: true,
            overallConfidence: true,
            originalFileName: true,
            fileHash: true,
            storageProvider: true,
            storageKey: true,
            driveFileId: true,
        },
    });

    if (!job) throw new Error(`No existe el job ${jobId}.`);

    if (claim.count === 0) {
        return {
            jobId,
            status: job.status,
            manifestId: job.manifestId,
            overallConfidence: job.overallConfidence ? Number(job.overallConfidence) : null,
            action: null,
            blockingFields: 0,
            skipped: true,
        };
    }

    let action: ExtractionAction | null = null;
    let overallConfidence: number | null = null;

    try {
        const pdf = await extractPdfText(await readPdf(job));

        // Solo se aceptan manifiestos (remesas, órdenes de cargue, etc. se rechazan).
        const check = checkManifestDocument(pdf.text);
        if (!check.ok) throw new Error(check.reason);

        const result = extractManifestFromPdfData(pdf);
        action = result.action;
        overallConfidence = result.overallConfidence;

        await prisma.manifestJob.update({
            where: { id: jobId },
            data: {
                rawText: result.rawText,
                extractedJson: toStoredExtraction(result) as object,
                overallConfidence: result.overallConfidence,
                updatedAt: new Date(),
            },
        });

        if (result.blockingReviewFields.length > 0) {
            await markReviewRequired(jobId, null);
            return {
                jobId,
                status: ManifestJobStatus.REVIEW_REQUIRED,
                manifestId: null,
                overallConfidence,
                action,
                blockingFields: result.blockingReviewFields.length,
                skipped: false,
            };
        }

        const persisted = await persistManifest({
            extractionResult: result,
            pdfFileName: job.originalFileName,
            pdfFileHash: job.fileHash,
            pdfFileUrl: manifestPdfUrl(jobId),
            jobId,
        });

        return {
            jobId,
            status: ManifestJobStatus.COMPLETED,
            manifestId: persisted.manifestId,
            overallConfidence,
            action,
            blockingFields: 0,
            skipped: false,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Error desconocido al procesar el PDF.";
        console.error(`processManifestJob(${jobId})`, error);

        // Si la extracción salió pero no se pudo guardar por una validación de
        // negocio (p. ej. conflicto de unicidad), el usuario lo resuelve en la revisión.
        if (error instanceof ManifestValidationError && action !== null) {
            await markReviewRequired(jobId, message);
            return {
                jobId,
                status: ManifestJobStatus.REVIEW_REQUIRED,
                manifestId: null,
                overallConfidence,
                action,
                blockingFields: 0,
                skipped: false,
                error: message,
            };
        }

        await markManifestJobError(jobId, message);
        return {
            jobId,
            status: ManifestJobStatus.ERROR,
            manifestId: null,
            overallConfidence,
            action,
            blockingFields: 0,
            skipped: false,
            error: message,
        };
    }
}

async function markReviewRequired(jobId: bigint, errorMessage: string | null) {
    await prisma.manifestJob.update({
        where: { id: jobId },
        data: {
            status: ManifestJobStatus.REVIEW_REQUIRED,
            errorMessage,
            completedAt: null,
            updatedAt: new Date(),
        },
    });
}
