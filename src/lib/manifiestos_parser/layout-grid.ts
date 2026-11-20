import type { StructuredTextItem } from "unpdf";
import { normalizeLine } from "./section-parser";

/**
 * Utilidades para leer formatos tabulares usando las coordenadas X/Y que
 * entrega PDF.js. En PDF.js el eje Y crece hacia arriba: un valor "debajo"
 * de un encabezado tiene una Y menor.
 */
export interface GridItem {
  text: string;
  norm: string;
  x: number;
  x2: number;
  y: number;
}

export function toGridItems(items: StructuredTextItem[]): GridItem[] {
  return items
    .filter((item) => item.str.trim().length > 0)
    .map((item) => ({
      text: item.str.replace(/\s+/g, " ").trim(),
      norm: normalizeLine(item.str),
      x: item.x,
      x2: item.x + item.width,
      y: item.y,
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
}

/** Primer elemento (de arriba hacia abajo) cuyo texto normalizado cumple el patrón. */
export function findLabel(
  items: GridItem[],
  pattern: RegExp,
  options: { belowY?: number; aboveY?: number } = {},
): GridItem | undefined {
  return items.find(
    (item) =>
      pattern.test(item.norm) &&
      (options.belowY === undefined || item.y < options.belowY) &&
      (options.aboveY === undefined || item.y > options.aboveY),
  );
}

/** Valor a la derecha de una etiqueta, en la misma línea (tolerancia dy). */
export function valueRight(
  items: GridItem[],
  label: GridItem | undefined,
  options: { maxDy?: number; maxDx?: number; pattern?: RegExp } = {},
): GridItem | undefined {
  if (!label) return undefined;
  const maxDy = options.maxDy ?? 3;
  const maxDx = options.maxDx ?? 250;
  return items
    .filter(
      (item) =>
        item !== label &&
        Math.abs(item.y - label.y) <= maxDy &&
        item.x >= label.x2 - 2 &&
        item.x - label.x2 <= maxDx &&
        (!options.pattern || options.pattern.test(item.text)),
    )
    .sort((a, b) => a.x - b.x)[0];
}

/** Valor debajo de una etiqueta (el más cercano en Y), dentro de una franja horizontal. */
export function valueBelow(
  items: GridItem[],
  label: GridItem | undefined,
  options: { maxDy?: number; left?: number; right?: number; requireOverlap?: boolean; pattern?: RegExp } = {},
): GridItem | undefined {
  if (!label) return undefined;
  const maxDy = options.maxDy ?? 14;
  const left = label.x - (options.left ?? 20);
  const right = label.x2 + (options.right ?? 60);
  return items
    .filter((item) => {
      if (item === label) return false;
      const dy = label.y - item.y;
      if (dy < 1.5 || dy > maxDy) return false;
      if (options.pattern && !options.pattern.test(item.text)) return false;
      if (options.requireOverlap) return item.x < label.x2 && item.x2 > label.x;
      return item.x >= left && item.x <= right;
    })
    .sort((a, b) => b.y - a.y || a.x - b.x)[0];
}

export interface ColumnSpec<K extends string> {
  key: K;
  pattern: RegExp;
}

export interface TableOptions {
  /** "left": los valores empiezan en la X del encabezado. "overlap": valores centrados. */
  align: "left" | "overlap";
  /** Profundidad máxima (en puntos) debajo del encabezado donde se buscan valores. */
  depth: number;
  /** Etiquetas secundarias que aparecen entre los valores y deben ignorarse. */
  ignore?: RegExp[];
  /** Encabezados adicionales en otra fila (p. ej. "Dueño Poliza"). */
  extraHeaders?: GridItem[];
}

export type TableCells<K extends string> = Partial<Record<K, GridItem[]>>;

/**
 * Lee una tabla cuyo encabezado está en una sola fila. `anchor` es el primer
 * encabezado (normalmente único, p. ej. "Conductor"); los demás se buscan en
 * la misma fila. Cada valor debajo se asigna a una columna.
 */
export function readTable<K extends string>(
  items: GridItem[],
  anchor: GridItem | undefined,
  columns: ColumnSpec<K>[],
  options: TableOptions,
): TableCells<K> {
  if (!anchor) return {};

  const rowItems = items
    .filter((item) => Math.abs(item.y - anchor.y) <= 3)
    .sort((a, b) => a.x - b.x);

  const used = new Set<GridItem>();
  const headers: Array<{ key: K; item: GridItem }> = [];
  for (const column of columns) {
    const match =
      (column.pattern.test(anchor.norm) && !used.has(anchor) ? anchor : undefined) ??
      rowItems.find((item) => !used.has(item) && column.pattern.test(item.norm)) ??
      options.extraHeaders?.find((item) => !used.has(item) && column.pattern.test(item.norm));
    if (!match) continue;
    used.add(match);
    headers.push({ key: column.key, item: match });
  }
  headers.sort((a, b) => a.item.x - b.item.x);
  if (headers.length === 0) return {};

  const headerY = Math.min(...headers.map((header) => header.item.y));
  const values = items.filter(
    (item) =>
      !used.has(item) &&
      item.y < headerY - 1.5 &&
      item.y >= headerY - options.depth &&
      !(options.ignore ?? []).some((pattern) => pattern.test(item.norm)),
  );

  const cells: TableCells<K> = {};
  for (const value of values) {
    const header = pickColumn(headers, value, options.align);
    if (!header) continue;
    (cells[header.key] ??= []).push(value);
  }
  for (const key of Object.keys(cells) as K[]) {
    cells[key]!.sort((a, b) => b.y - a.y || a.x - b.x);
  }
  return cells;
}

function pickColumn<K extends string>(
  headers: Array<{ key: K; item: GridItem }>,
  value: GridItem,
  align: TableOptions["align"],
) {
  if (align === "left") {
    for (let index = headers.length - 1; index >= 0; index -= 1) {
      if (value.x >= headers[index]!.item.x - 3) return headers[index];
    }
    return undefined;
  }

  let best: { key: K; item: GridItem } | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const header of headers) {
    const overlap = Math.min(value.x2, header.item.x2) - Math.max(value.x, header.item.x);
    // Con solape el puntaje es negativo (mejor); sin solape es la distancia.
    const score = -overlap;
    if (score < bestScore) {
      bestScore = score;
      best = header;
    }
  }
  // Un valor muy alejado de cualquier columna no se asigna.
  return bestScore > 40 ? undefined : best;
}

export function cellText(cell: GridItem[] | undefined, line?: number): string | null {
  if (!cell || cell.length === 0) return null;
  if (line !== undefined) {
    const rows = groupRows(cell);
    return rows[line] ?? null;
  }
  return cell.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim() || null;
}

/** Agrupa los elementos de una celda por renglón (útil cuando una celda tiene varias líneas). */
export function groupRows(cell: GridItem[]): string[] {
  const rows: Array<{ y: number; parts: GridItem[] }> = [];
  for (const item of [...cell].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= 3);
    if (row) row.parts.push(item);
    else rows.push({ y: item.y, parts: [item] });
  }
  return rows.map((row) =>
    row.parts
      .sort((a, b) => a.x - b.x)
      .map((part) => part.text)
      .join(" ")
      .trim(),
  );
}
