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

export function detectSectionFromLine(line: string): ManifestSection | null {
  const normalized = normalizeLine(line);
  const sections = Object.keys(
    MANIFEST_SECTION_ALIASES,
  ) as ManifestSection[];

  for (const section of sections) {
    if (
      MANIFEST_SECTION_ALIASES[section].some(
        (alias) => normalizeLine(alias) === normalized,
      )
    ) {
      return section;
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
