/**
 * Minimal RFC 4180-style CSV reader.
 *
 * Written in-house (rather than pulling in a dependency) so that the exact
 * behaviour — quoted fields, escaped `""` quotes, embedded commas and newlines,
 * delimiter detection, BOM handling and encoding sanity checks — is covered by
 * unit tests and can be reasoned about when a bank exports something unusual.
 *
 * It deliberately does NOT evaluate anything in the file: cells are plain
 * strings and are never treated as formulas or code.
 */

export type Delimiter = ',' | ';' | '\t' | '|';

export interface ParsedCsv {
  delimiter: Delimiter;
  hasBom: boolean;
  rows: string[][];
  /** Non-fatal problems worth surfacing to the user. */
  warnings: string[];
  /** Fatal structural problems, e.g. a NUL byte indicating a binary file. */
  fatal?: string;
}

const CANDIDATE_DELIMITERS: readonly Delimiter[] = [',', ';', '\t', '|'];

/** Counts a delimiter in the first line, ignoring text inside quotes. */
function countDelimiter(line: string, delimiter: Delimiter): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && char === delimiter) count += 1;
  }
  return count;
}

export function detectDelimiter(text: string): Delimiter {
  const firstLine = text.split(/\r\n|\r|\n/, 1)[0] ?? '';
  let best: Delimiter = ',';
  let bestCount = 0;
  for (const candidate of CANDIDATE_DELIMITERS) {
    const count = countDelimiter(firstLine, candidate);
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

export function parseCsv(text: string, delimiter?: Delimiter): ParsedCsv {
  const warnings: string[] = [];
  let input = text;
  let hasBom = false;

  if (input.charCodeAt(0) === 0xfeff) {
    hasBom = true;
    input = input.slice(1);
  }

  // A NUL byte means this is almost certainly not a text CSV file.
  if (input.includes('\u0000')) {
    return {
      delimiter: delimiter ?? ',',
      hasBom,
      rows: [],
      warnings,
      fatal: 'The file contains binary data (NUL bytes) and cannot be read as CSV.',
    };
  }

  if (input.includes('\uFFFD')) {
    warnings.push(
      'Some characters could not be decoded (they appear as "�"). The file may not be UTF-8; re-export it as UTF-8 if text looks wrong.',
    );
  }

  const delim = delimiter ?? detectDelimiter(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let unterminated = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  let i = 0;
  while (i < input.length) {
    const char = input[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      if (field.length === 0) {
        inQuotes = true;
      } else {
        // A quote inside an unquoted field is treated literally.
        field += char;
      }
      i += 1;
      continue;
    }
    if (char === delim) {
      pushField();
      i += 1;
      continue;
    }
    if (char === '\r') {
      pushRow();
      i += input[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (char === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  if (inQuotes) {
    unterminated = true;
  }
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  if (unterminated) {
    warnings.push('A quoted field was not closed before the end of the file; it was closed automatically.');
  }

  // Drop trailing blank lines produced by a final newline.
  while (rows.length > 0) {
    const last = rows[rows.length - 1]!;
    if (last.length === 1 && last[0]!.trim() === '') rows.pop();
    else break;
  }

  return { delimiter: delim, hasBom, rows, warnings };
}

/** Removes a leading UTF-8 BOM from a header cell, if present. */
export function cleanHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').trim();
}

/** Escapes a value for safe inclusion in a generated CSV report. */
export function escapeCsvField(value: string, delimiter = ','): string {
  const needsQuotes =
    value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r');
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

export function toCsv(rows: readonly (readonly string[])[], delimiter = ','): string {
  return rows.map((row) => row.map((cell) => escapeCsvField(cell, delimiter)).join(delimiter)).join('\r\n');
}
