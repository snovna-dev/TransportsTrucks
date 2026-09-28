import { extractManifestFromPdf } from "./extraction.service";
import { persistManifest } from "./manifest.service";

export interface ProcessManifestInput {
    fileName: string;
    fileHash?: string | null;
    pdf: Buffer;
}

export interface ProcessManifestResult {
    manifestId: bigint | null;
    status: "COMPLETED" | "REVIEW_REQUIRED" | "ERROR";
    action: string;
    overallConfidence: number;
    reviewRequired: boolean;
}

export async function processManifest(
    input: ProcessManifestInput,
): Promise<ProcessManifestResult> {
    try {
        console.log("=== INICIANDO PROCESAMIENTO ===");

        const extractionResult = await extractManifestFromPdf(input.pdf);

        console.log(
        `Confianza global: ${extractionResult.overallConfidence.toFixed(2)}`,
        );
        console.log(`Acción: ${extractionResult.action}`);
        console.log(
        `Campos bloqueantes: ${extractionResult.blockingReviewFields.length}`,
        );

        if (extractionResult.blockingReviewFields.length > 0) {
        return {
            manifestId: null,
            status: "REVIEW_REQUIRED",
            action: extractionResult.action,
            overallConfidence: extractionResult.overallConfidence,
            reviewRequired: true,
        };
        }

        /*
        * IMPORTANTE:
        * manifest.service.ts espera `extractionResult`,
        * no `extraction`.
        */
        const persisted = await persistManifest({
        extractionResult,
        pdfFileName: input.fileName,
        pdfFileHash: input.fileHash ?? null,
        });

        return {
        manifestId: persisted.manifestId,
        status:
            persisted.status === "COMPLETED"
            ? "COMPLETED"
            : "REVIEW_REQUIRED",
        action: extractionResult.action,
        overallConfidence: persisted.overallConfidence,
        reviewRequired: persisted.reviewStatus !== "APPROVED",
        };
    } catch (error) {
        console.error("Error procesando manifiesto:", error);

        return {
        manifestId: null,
        status: "ERROR",
        action: "ERROR",
        overallConfidence: 0,
        reviewRequired: true,
        };
    }
}