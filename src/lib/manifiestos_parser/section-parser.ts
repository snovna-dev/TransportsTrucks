import { MANIFEST_SECTION_ALIASES } from "./manifest-field-aliases";
import type { ManifestSection } from "../../types/manifest-extraction";

export interface ParsedLine {
  index: number;
  raw: string;
  normalized: string;
}

export interface ParsedSection {
  section: ManifestSection;
  startLine: number;
  endLine: number;
  lines: ParsedLine[];
  rawText: string;
}

export interface ParsedSections {
  lines: ParsedLine[];
  sections: ParsedSection[];
}

export function normalizePdfText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[‐‑‒–—−]/g, "-")
    .toUpperCase();
}

export function normalizeLine(value: string): string {
  return normalizePdfText(value).replace(/\s+/g, " ").trim();
}

export function sameText(value: string, expected: string): boolean {
  return normalizeLine(value) === normalizeLine(expected);
}

const SECTION_ENTRIES = Object.entries(MANIFEST_SECTION_ALIASES) as Array<
  [ManifestSection, readonly string[]]
>;

/**
 * Section detection is intentionally tolerant of extra text on the same line.
 * Some PDFs emit a heading together with adjacent table labels/values.
 */
export function detectSectionFromLine(line: string): ManifestSection | null {
  const normalized = normalizeLine(line);

  for (const [section, aliases] of SECTION_ENTRIES) {
    if (aliases.some((alias) => normalized === normalizeLine(alias))) {
      return section;
    }
  }

  // Avoid detecting arbitrary field labels as sections. Only a real section
  // alias can trigger this fallback and it must be a reasonably large part of
  // the line.
  for (const [section, aliases] of SECTION_ENTRIES) {
    for (const alias of aliases) {
      const aliasNormalized = normalizeLine(alias);
      if (!normalized.includes(aliasNormalized)) continue;

      const remainingLength = normalized.length - aliasNormalized.length;
      if (remainingLength <= 50) {
        return section;
      }
    }
  }

  return null;
}

export function parseSections(text: string): ParsedSections {
  const lines: ParsedLine[] = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((raw) => ({ raw, normalized: normalizeLine(raw) }))
    .filter((line) => line.normalized.length > 0)
    .map((line, index) => ({ ...line, index }));

  const starts = lines.flatMap((line) => {
    const section = detectSectionFromLine(line.raw);
    return section ? [{ section, line }] : [];
  });

  const sections: ParsedSection[] = starts.map((current, index) => {
    const next = starts[index + 1];
    const startPosition = current.line.index;
    const nextPosition = next ? next.line.index : lines.length;
    const sectionLines = lines.slice(startPosition, nextPosition);

    return {
      section: current.section,
      startLine: current.line.index,
      endLine: next ? next.line.index - 1 : lines.length - 1,
      lines: sectionLines,
      rawText: sectionLines.map((line) => line.raw).join("\n"),
    };
  });

  return { lines, sections };
}

export function getSection(
  parsed: ParsedSections,
  section: ManifestSection,
): ParsedSection | undefined {
  return parsed.sections.find((item) => item.section === section);
}

/**
 * Splits a reconstructed layout line where >= 2 spaces mean a column gap.
 */
export function splitLayoutColumns(line: string): string[] {
  return line
    .trim()
    .split(/\s{2,}/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function findLine(
  lines: ParsedLine[],
  predicate: (line: ParsedLine) => boolean,
): ParsedLine | undefined {
  return lines.find(predicate);
}

export function findLineIndex(
  lines: ParsedLine[],
  predicate: (line: ParsedLine) => boolean,
): number {
  return lines.findIndex(predicate);
}

export function nextLine(
  lines: ParsedLine[],
  sourceIndex: number,
  offset = 1,
): ParsedLine | undefined {
  return lines[sourceIndex + offset];
}

export function locateAlias(
  line: string,
  aliases: readonly string[],
): { alias: string; start: number; end: number } | null {
  const normalizedLine = normalizePdfText(line);

  const ordered = [...aliases].sort(
    (a, b) => normalizePdfText(b).length - normalizePdfText(a).length,
  );

  for (const alias of ordered) {
    const normalizedAlias = normalizePdfText(alias);
    const start = normalizedLine.indexOf(normalizedAlias);

    if (start >= 0) {
      return {
        alias,
        start,
        end: start + normalizedAlias.length,
      };
    }
  }

  return null;
}
