import { describe, expect, it } from 'vitest';

import { cleanHeader, detectDelimiter, escapeCsvField, parseCsv, toCsv } from './csv.ts';

describe('detectDelimiter', () => {
  it('detects commas, semicolons, tabs and pipes', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('a|b|c')).toBe('|');
    expect(detectDelimiter('single')).toBe(',');
  });

  it('ignores delimiters inside quoted headers', () => {
    expect(detectDelimiter('"a,b";c;d')).toBe(';');
  });
});

describe('parseCsv', () => {
  it('parses plain rows and strips a trailing empty line', () => {
    const result = parseCsv('a,b\n1,2\n');
    expect(result.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    const result = parseCsv('date,description,amount\n2026-01-01,"Coffee, large",12.50\n');
    expect(result.rows[1]).toEqual(['2026-01-01', 'Coffee, large', '12.50']);
  });

  it('handles escaped quotes', () => {
    const result = parseCsv('a\n"He said ""hi"""\n');
    expect(result.rows[1]).toEqual(['He said "hi"']);
  });

  it('handles newlines inside quoted fields', () => {
    const result = parseCsv('a,b\n"line one\nline two",2\n');
    expect(result.rows[1]).toEqual(['line one\nline two', '2']);
  });

  it('handles CRLF and CR line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n').rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a,b\r1,2').rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a UTF-8 BOM and reports it', () => {
    const result = parseCsv('\uFEFFa,b\n1,2');
    expect(result.hasBom).toBe(true);
    expect(result.rows[0]).toEqual(['a', 'b']);
  });

  it('warns about an unterminated quote but still parses', () => {
    const result = parseCsv('a,b\n"unterminated,2\n');
    expect(result.warnings.join(' ')).toMatch(/not closed/i);
    expect(result.rows[1]?.[0]).toBe('unterminated,2\n');
  });

  it('rejects binary content with a fatal error', () => {
    const result = parseCsv('a\u0000b');
    expect(result.fatal).toBeDefined();
    expect(result.rows).toEqual([]);
  });

  it('flags replacement characters as a possible encoding problem', () => {
    const result = parseCsv('a,b\n\uFFFD,2');
    expect(result.warnings.join(' ')).toMatch(/decoded/i);
  });

  it('does not evaluate cells as formulas — values stay strings', () => {
    const result = parseCsv('a\n=1+1\n');
    expect(result.rows[1]).toEqual(['=1+1']);
  });
});

describe('CSV output helpers', () => {
  it('escapes fields that contain delimiters, quotes or newlines', () => {
    expect(escapeCsvField('plain')).toBe('plain');
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('line\nbreak')).toBe('"line\nbreak"');
  });

  it('round-trips through toCsv/parseCsv', () => {
    const rows = [
      ['a', 'b'],
      ['comma, here', 'quote "here"'],
    ];
    const csv = toCsv(rows);
    expect(parseCsv(csv).rows).toEqual(rows);
  });

  it('cleans header whitespace and BOM', () => {
    expect(cleanHeader('  Date  ')).toBe('Date');
    expect(cleanHeader('\uFEFFAmount')).toBe('Amount');
  });
});
