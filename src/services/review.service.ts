import { prisma } from "../lib/prisma";
import { ManifestJobStatus } from "../generated/prisma/enums";
import { FIELD_DEFINITIONS, getFieldDefinition, type FieldDefinition } from "../lib/manifest-fields";
import {
    evaluateExtraction,
    getExtractedField,
    setExtractedField,
} from "./extraction.service";
import { ManifestValidationError, persistManifest } from "./manifest.service";
import { manifestPdfUrl } from "./processing.service";
import { parseStoredExtraction, toStoredExtraction, type StoredExtraction } from "./stored-extraction";
import type { ManifestExtraction } from "../types/manifest-extraction";

export type ReviewValues = Record<string, string | number | null>;

export class ReviewError extends Error {
    constructor(
        message: string,
        public readonly status: number = 400,
        public readonly details?: unknown,
    ) {
        super(message);
        this.name = "ReviewError";
    }
}

function normalizeValue(definition: FieldDefinition, raw: string | number | null): string | number | null {
    if (raw === null || raw === undefined) return null;
    const text = String(raw).trim();
    if (text === "") return null;

    if (definition.kind === "number") {
        const value = typeof raw === "number" ? raw : Number(text.replace(/\s+/g, ""));
        if (!Number.isFinite(value)) {
            throw new ReviewError(`"${definition.label}" debe ser un número.`);
        }
        return value;
    }

    if (definition.kind === "date") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(new Date(`${text}T00:00:00Z`).getTime())) {
            throw new ReviewError(`"${definition.label}" debe tener el formato AAAA-MM-DD.`);
        }
        return text;
    }

    return text;
}

async function loadReviewableJob(jobId: bigint) {
    const job = await prisma.manifestJob.findUnique({
        where: { id: jobId },
        select: {
            id: true,
            status: true,
            rawText: true,
            extractedJson: true,
            originalFileName: true,
            fileHash: true,
        },
    });

    if (!job) throw new ReviewError("El job no existe.", 404);
    if (job.status !== ManifestJobStatus.REVIEW_REQUIRED) {
        throw new ReviewError(`El job está en estado ${job.status}; solo se revisan jobs en REVIEW_REQUIRED.`, 409);
    }

    const stored = parseStoredExtraction(job.extractedJson);
    if (!stored) throw new ReviewError("El job no tiene una extracción válida para revisar.", 409);

    return { job, stored };
}

/**
 * Aplica las correcciones del usuario sobre la extracción. Cada valor que
 * cambia queda marcado como fuente USER con confianza 1 y se audita.
 */
function applyValues(extraction: ManifestExtraction, values: ReviewValues) {
    const corrections: Array<{
        fieldPath: string;
        originalValue: unknown;
        correctedValue: unknown;
        originalConfidence: number;
    }> = [];

    for (const [path, raw] of Object.entries(values)) {
        const definition = getFieldDefinition(path);
        const current = getExtractedField(extraction, path);
        if (!definition || !current) throw new ReviewError(`Campo desconocido: ${path}`);

        const value = normalizeValue(definition, raw);
        if (value === current.value) continue;

        corrections.push({
            fieldPath: path,
            originalValue: current.value,
            correctedValue: value,
            originalConfidence: current.confidence,
        });
        setExtractedField(extraction, path, {
            ...current,
            value,
            confidence: 1,
            source: "USER",
        });
    }

    return corrections;
}

async function saveCorrections(
    jobId: bigint,
    stored: StoredExtraction,
    corrections: ReturnType<typeof applyValues>,
) {
    const { extraction } = stored;
    const evaluation = evaluateExtraction(extraction);
    await prisma.$transaction([
        prisma.manifestJob.update({
            where: { id: jobId },
            data: {
                extractedJson: toStoredExtraction(stored) as object,
                overallConfidence: evaluation.overallConfidence,
                updatedAt: new Date(),
            },
        }),
        prisma.manifestFieldCorrection.createMany({
            data: corrections.map((correction) => ({
                jobId,
                fieldPath: correction.fieldPath,
                originalValue: correction.originalValue as never,
                correctedValue: correction.correctedValue as never,
                originalConfidence: correction.originalConfidence,
                source: "USER",
            })),
        }),
    ]);
    return evaluation;
}

/** PATCH: guarda un borrador de la revisión (sin crear el Manifest). */
export async function saveReview(jobId: bigint, values: ReviewValues) {
    const { stored } = await loadReviewableJob(jobId);
    const corrections = applyValues(stored.extraction, values);
    const evaluation = await saveCorrections(jobId, stored, corrections);
    return { corrections: corrections.length, evaluation };
}

/**
 * POST complete: aplica las últimas correcciones, da por confirmados los
 * campos marcados que el usuario dejó igual y guarda el Manifest definitivo
 * (sobrescribiendo el existente si el número ya estaba registrado).
 */
export async function completeReview(jobId: bigint, values: ReviewValues = {}) {
    const { job, stored } = await loadReviewableJob(jobId);
    const extraction = stored.extraction;
    const corrections = applyValues(extraction, values);

    const missing = FIELD_DEFINITIONS.filter((definition) => {
        if (definition.requirement !== "MUST_HAVE") return false;
        const field = getExtractedField(extraction, definition.path);
        return !field || field.value === null || field.value === "";
    });

    if (missing.length > 0) {
        await saveCorrections(jobId, stored, corrections);
        throw new ReviewError(
            `Faltan campos obligatorios: ${missing.map((field) => `${field.group} · ${field.label}`).join(", ")}.`,
            422,
            { missing: missing.map((field) => field.path) },
        );
    }

    // Lo que el usuario vio en la revisión y no cambió queda confirmado.
    for (const field of evaluateExtraction(extraction).reviewFields) {
        const current = getExtractedField(extraction, field.path);
        if (current) setExtractedField(extraction, field.path, { ...current, confidence: 1, source: "USER" });
    }

    const evaluation = await saveCorrections(jobId, stored, corrections);

    try {
        const persisted = await persistManifest({
            extractionResult: {
                extraction,
                rawText: job.rawText ?? "",
                overallConfidence: evaluation.overallConfidence,
                action: evaluation.action,
                blockingReviewFields: evaluation.blockingReviewFields,
            },
            pdfFileName: job.originalFileName,
            pdfFileHash: job.fileHash,
            pdfFileUrl: manifestPdfUrl(jobId),
            jobId,
            reviewed: true,
        });
        return { manifestId: persisted.manifestId, created: persisted.created, corrections: corrections.length };
    } catch (error) {
        if (error instanceof ManifestValidationError) {
            await prisma.manifestJob.update({
                where: { id: jobId },
                data: { errorMessage: error.message, updatedAt: new Date() },
            });
            throw new ReviewError(error.message, 422);
        }
        throw error;
    }
}

/** Datos para la pantalla de revisión. */
export async function getReviewData(jobId: bigint) {
    const job = await prisma.manifestJob.findUnique({
        where: { id: jobId },
        select: {
            id: true,
            status: true,
            originalFileName: true,
            overallConfidence: true,
            errorMessage: true,
            extractedJson: true,
            createdAt: true,
            manifestId: true,
            corrections: { orderBy: { createdAt: "asc" } },
        },
    });
    if (!job) return null;

    const stored = parseStoredExtraction(job.extractedJson);
    const evaluation = stored ? evaluateExtraction(stored.extraction) : null;
    return { job, stored, evaluation };
}
