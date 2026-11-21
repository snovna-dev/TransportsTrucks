import { normalizePdfText } from "./section-parser";

/**
 * El sistema solo acepta manifiestos de carga: son los que traen la
 * información del viaje y de los pagos. Otros documentos del viaje (remesas,
 * órdenes de cargue, facturas...) se rechazan antes de guardarse.
 *
 * Un PDF se considera manifiesto si dice "MANIFIESTO" y trae al menos tres de
 * los conceptos de pago que tienen todos los formatos (valor total,
 * retención, neto a pagar, anticipo, saldo).
 */

const PAYMENT_MARKERS = ["VALOR TOTAL", "RETENCION", "NETO A PAGAR", "ANTICIPO", "SALDO"];
const MIN_PAYMENT_MARKERS = 3;

export type ManifestCheck = { ok: true } | { ok: false; reason: string };

export const ONLY_MANIFESTS_MESSAGE = "Solo se pueden cargar manifiestos de carga.";

function normalize(text: string) {
  return normalizePdfText(text).replace(/\s+/g, " ");
}

/** `text`: texto de la página 1 del PDF. */
export function checkManifestDocument(text: string): ManifestCheck {
  const normalized = normalize(text);
  const paymentMarkers = PAYMENT_MARKERS.filter((marker) => normalized.includes(marker)).length;

  if (normalized.includes("MANIFIESTO") && paymentMarkers >= MIN_PAYMENT_MARKERS) return { ok: true };

  if (normalized.includes("ORDEN DE CARGUE") && normalized.includes("ID ORDEN CARGA")) {
    return { ok: false, reason: `El PDF es una orden de cargue, no un manifiesto. ${ONLY_MANIFESTS_MESSAGE}` };
  }
  if (normalized.includes("REMESA") && normalized.includes("DESCRIPCION DE LA CARGA")) {
    return { ok: false, reason: `El PDF es una remesa, no un manifiesto. ${ONLY_MANIFESTS_MESSAGE}` };
  }
  return {
    ok: false,
    reason: `El PDF no parece un manifiesto: no se encontraron los valores del viaje y los pagos. ${ONLY_MANIFESTS_MESSAGE}`,
  };
}

export class NotAManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotAManifestError";
  }
}
