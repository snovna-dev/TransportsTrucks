import { readFile } from "node:fs/promises";
import { extractTextItems, type StructuredTextItem } from "unpdf";

export interface PdfLayoutTextItem extends StructuredTextItem {}

export interface PdfExtractionResult {
  text: string;
  layoutText: string;
  pageCount: number;
  hasText: boolean;
  items: PdfLayoutTextItem[][];
}

export class PdfExtractionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "PdfExtractionError";

    if (options?.cause) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

const Y_TOLERANCE = 2.0;
const COLUMN_GAP = 8;

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
}

interface LineGroup {
  y: number;
  items: PdfLayoutTextItem[];
}

function groupItemsIntoLines(items: PdfLayoutTextItem[]): LineGroup[] {
  const ordered = items
    .filter((item) => item.str.trim().length > 0)
    .slice()
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const groups: LineGroup[] = [];

  for (const item of ordered) {
    const current = groups[groups.length - 1];

    if (current && Math.abs(current.y - item.y) <= Y_TOLERANCE) {
      current.items.push(item);
      current.y =
        current.items.reduce((sum, value) => sum + value.y, 0) /
        current.items.length;
      continue;
    }

    groups.push({ y: item.y, items: [item] });
  }

  return groups;
}

function buildLayoutLine(items: PdfLayoutTextItem[]): string {
  const ordered = items.slice().sort((a, b) => a.x - b.x);
  let output = "";
  let previousEnd = 0;

  ordered.forEach((item, index) => {
    if (index === 0) {
      output = item.str.trim();
      previousEnd = item.x + item.width;
      return;
    }

    const gap = item.x - previousEnd;
    output += gap >= COLUMN_GAP ? "    " : " ";
    output += item.str.trim();
    previousEnd = item.x + item.width;
  });

  return output.trimEnd();
}

function buildPageLayout(items: PdfLayoutTextItem[]): string {
  return groupItemsIntoLines(items)
    .map((group) => buildLayoutLine(group.items))
    .filter(Boolean)
    .join("\n");
}

function buildDocumentLayout(itemsByPage: PdfLayoutTextItem[][]): string {
  return normalizeExtractedText(
    itemsByPage.map((pageItems) => buildPageLayout(pageItems)).join("\n\n"),
  );
}

/**
 * Extracts text from a digital PDF and reconstructs the page using the X/Y
 * coordinates returned by PDF.js. The resulting `text` keeps column gaps so
 * table-oriented parsers can distinguish fields safely.
 */
export async function extractPdfText(
  input: Buffer | Uint8Array,
): Promise<PdfExtractionResult> {
  if (!input || input.byteLength === 0) {
    throw new PdfExtractionError("El archivo PDF está vacío.");
  }

  try {
    const data = new Uint8Array(input);
    const result = await extractTextItems(data);
    const layoutText = buildDocumentLayout(result.items);

    if (!layoutText) {
      throw new PdfExtractionError(
        "No se encontró texto extraíble en el PDF. El archivo podría estar escaneado o protegido.",
      );
    }

    return {
      text: layoutText,
      layoutText,
      pageCount: result.totalPages,
      hasText: true,
      items: result.items,
    };
  } catch (error) {
    if (error instanceof PdfExtractionError) {
      throw error;
    }

    throw new PdfExtractionError(
      "No fue posible extraer el texto del PDF.",
      { cause: error },
    );
  }
}

export async function extractPdfTextFromFile(
  filePath: string,
): Promise<PdfExtractionResult> {
  const buffer = await readFile(filePath);
  return extractPdfText(buffer);
}
