import {
  DIAGRAM_SCHEMA_VERSION,
  type Diagram,
  DiagramSchema,
  duplicateDiagram,
  parseDiagram,
} from '@nivik/ir';
import type { FidelityReport } from '@nivik/renderer-core';
import { exportDocument, importDocument } from '@nivik/renderer-excalidraw';

/** File formats a diagram can travel in without a live canvas (spec 06 §4). */
export const DIAGRAM_FILE_FORMATS = ['nivik', 'excalidraw'] as const;
export type DiagramFileFormat = (typeof DIAGRAM_FILE_FORMATS)[number];

export const NIVIK_EXTENSION = '.nivik.json';
export const EXCALIDRAW_EXTENSION = '.excalidraw';
/** What the file picker accepts; `.json` is sniffed. */
export const IMPORT_ACCEPT = '.json,.excalidraw,application/json';

export type DiagramFileErrorCode = 'E_UNKNOWN_FORMAT' | 'E_INVALID_NIVIK' | 'E_INVALID_EXCALIDRAW';

export class DiagramFileError extends Error {
  readonly code: DiagramFileErrorCode;
  constructor(code: DiagramFileErrorCode, message: string) {
    super(message);
    this.name = 'DiagramFileError';
    this.code = code;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * By extension first, then by content for a bare `.json`: a Nivik document declares its schema,
 * an Excalidraw scene declares `type: 'excalidraw'`.
 */
export function detectFormat(filename: string, text?: string): DiagramFileFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(NIVIK_EXTENSION)) return 'nivik';
  if (lower.endsWith(EXCALIDRAW_EXTENSION)) return 'excalidraw';
  if (text === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.schema === DIAGRAM_SCHEMA_VERSION) return 'nivik';
  if (parsed.type === 'excalidraw' && Array.isArray(parsed.elements)) return 'excalidraw';
  return null;
}

/** A safe file stem: keeps letters in any script, folds whitespace to `-`, drops path characters. */
export function fileSlug(name: string, fallback = 'diagram'): string {
  const slug = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

/** The whole document, validated, pretty-printed (spec 06 §4: `renderer.state` included). */
export function serializeNivik(diagram: Diagram): string {
  return JSON.stringify(DiagramSchema.parse(diagram), null, 2);
}

/**
 * A `.nivik.json` as a brand-new diagram: validated by `parseDiagram` (older element types are
 * downgraded there), then re-identified so it never collides with a diagram already on this device.
 */
export function parseNivik(text: string, opts: { now?: number } = {}): Diagram {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new DiagramFileError(
      'E_INVALID_NIVIK',
      `Not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    return duplicateDiagram(parseDiagram(json), { now: opts.now ?? Date.now() });
  } catch (error) {
    throw new DiagramFileError(
      'E_INVALID_NIVIK',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export interface ExportedDiagramFile {
  blob: Blob;
  filename: string;
  /** `null` for the lossless native format. */
  fidelity: FidelityReport | null;
}

export async function exportDiagramFile(
  diagram: Diagram,
  format: DiagramFileFormat,
): Promise<ExportedDiagramFile> {
  const stem = fileSlug(diagram.name);
  if (format === 'nivik') {
    return {
      blob: new Blob([serializeNivik(diagram)], { type: 'application/json' }),
      filename: `${stem}${NIVIK_EXTENSION}`,
      fidelity: null,
    };
  }
  const result = await exportDocument(diagram);
  return {
    blob: result.blob,
    filename: `${stem}${EXCALIDRAW_EXTENSION}`,
    fidelity: result.fidelity,
  };
}

export interface ImportedDiagramFile {
  diagram: Diagram;
  format: DiagramFileFormat;
  fidelity: FidelityReport | null;
}

/** Anything with a name and text — a `File`, or a test double. */
export interface FileLike {
  name: string;
  text(): Promise<string>;
}

const stemOf = (filename: string) =>
  filename.replace(/\.nivik\.json$/i, '').replace(/\.(excalidraw|json)$/i, '');

export async function importDiagramFile(
  file: FileLike,
  opts: { now?: number } = {},
): Promise<ImportedDiagramFile> {
  const text = await file.text();
  const format = detectFormat(file.name, text);
  if (format === null) {
    throw new DiagramFileError(
      'E_UNKNOWN_FORMAT',
      `"${file.name}" is neither a Nivik document nor an Excalidraw scene`,
    );
  }
  if (format === 'nivik') {
    return { diagram: parseNivik(text, opts), format, fidelity: null };
  }
  try {
    const result = await importDocument(text, { name: stemOf(file.name) || 'Imported diagram' });
    return { diagram: result.diagram, format, fidelity: result.fidelity };
  } catch (error) {
    throw new DiagramFileError(
      'E_INVALID_EXCALIDRAW',
      error instanceof Error ? error.message : String(error),
    );
  }
}
