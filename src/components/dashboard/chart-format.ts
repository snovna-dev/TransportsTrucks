const money = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

export type ValueKind = "money" | "count" | "kg";

export function formatValue(value: number, kind: ValueKind) {
  if (kind === "money") return money.format(value);
  if (kind === "kg") return `${integer.format(value)} kg`;
  return integer.format(value);
}

/** Etiquetas cortas para ejes: $3,1 M · $850 mil · 12. */
export function formatCompact(value: number, kind: ValueKind) {
  const prefix = kind === "money" ? "$" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${prefix}${(value / 1_000_000_000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} mil M`;
  if (abs >= 1_000_000) return `${prefix}${(value / 1_000_000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} M`;
  if (abs >= 10_000) return `${prefix}${(value / 1_000).toLocaleString("es-CO", { maximumFractionDigits: 0 })} mil`;
  return `${prefix}${integer.format(value)}`;
}

/** Máximo "redondo" del eje y sus marcas (4 divisiones). */
export function niceScale(max: number, divisions = 4) {
  if (max <= 0) return { top: divisions, ticks: Array.from({ length: divisions + 1 }, (_, i) => i) };
  const raw = max / divisions;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const top = step * divisions;
  return { top, ticks: Array.from({ length: divisions + 1 }, (_, i) => i * step) };
}
