/**
 * Monaco ⇄ LSP conversions.
 *
 * These are pure functions, but they are the one place in the feature where an
 * off-by-one or a re-sorted change list silently corrupts the server's copy of
 * the buffer, so each rule gets its own case.
 */

import { describe, it, expect } from 'vitest';
import {
    LANGUAGE_MARKER_OWNER,
    MONACO_MARKER_SEVERITY,
    toContentChanges,
    toLspPosition,
    toLspRange,
    toMarkerData,
    toMarkerSeverity,
    toMarkers,
    toMonacoPosition,
    toMonacoRange,
} from '../../../../src/server/spa/client/react/features/language-servers/monacoBridge';
import type { LspDiagnostic } from '../../../../src/server/spa/client/react/features/language-servers/documentStore';

function monacoRange(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number) {
    return { startLineNumber, startColumn, endLineNumber, endColumn };
}

describe('position conversion', () => {
    it('shifts both axes by one in each direction', () => {
        expect(toLspPosition({ lineNumber: 1, column: 1 })).toEqual({ line: 0, character: 0 });
        expect(toMonacoPosition({ line: 0, character: 0 })).toEqual({ lineNumber: 1, column: 1 });
        expect(toLspPosition({ lineNumber: 12, column: 7 })).toEqual({ line: 11, character: 6 });
        expect(toMonacoPosition({ line: 11, character: 6 })).toEqual({ lineNumber: 12, column: 7 });
    });

    it('round-trips a range', () => {
        const range = monacoRange(3, 5, 4, 2);
        expect(toMonacoRange(toLspRange(range))).toEqual(range);
    });

    it('keeps astral-plane offsets, because both sides count UTF-16 units', () => {
        // '𝑥' is one code point but two UTF-16 units, so the character after it
        // is Monaco column 3 and LSP character 2. A code-point count would say 1.
        const text = '𝑥y';
        const columnAfter = text.length + 1;
        expect(columnAfter).toBe(4);
        expect(toLspPosition({ lineNumber: 1, column: columnAfter })).toEqual({ line: 0, character: 3 });
    });
});

describe('toContentChanges', () => {
    it('converts each change and preserves Monaco order', () => {
        // Monaco reports a multi-cursor edit sorted by descending position, and
        // that is exactly the order LSP has to apply them in: the later edit
        // cannot shift the offsets of the earlier one.
        const changes = [
            { range: monacoRange(5, 1, 5, 4), rangeLength: 3, text: 'zzz' },
            { range: monacoRange(2, 2, 2, 2), rangeLength: 0, text: 'a' },
        ];
        expect(toContentChanges(changes)).toEqual([
            { range: { start: { line: 4, character: 0 }, end: { line: 4, character: 3 } }, rangeLength: 3, text: 'zzz' },
            { range: { start: { line: 1, character: 1 }, end: { line: 1, character: 1 } }, rangeLength: 0, text: 'a' },
        ]);
    });

    it('drops a change with no range instead of guessing one', () => {
        const changes = [
            { range: undefined as never, rangeLength: 0, text: 'whole file' },
            { range: monacoRange(1, 1, 1, 1), rangeLength: 0, text: 'x' },
        ];
        expect(toContentChanges(changes)).toHaveLength(1);
    });

    it('returns an empty list for an empty event', () => {
        expect(toContentChanges([])).toEqual([]);
    });
});

describe('diagnostics as markers', () => {
    function diagnosticAt(overrides: Partial<LspDiagnostic> = {}): LspDiagnostic {
        return {
            range: { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } },
            message: 'Cannot find name "foo".',
            ...overrides,
        };
    }

    it('maps every LSP severity, defaulting an absent one to error', () => {
        expect(toMarkerSeverity(1)).toBe(MONACO_MARKER_SEVERITY.error);
        expect(toMarkerSeverity(2)).toBe(MONACO_MARKER_SEVERITY.warning);
        expect(toMarkerSeverity(3)).toBe(MONACO_MARKER_SEVERITY.info);
        expect(toMarkerSeverity(4)).toBe(MONACO_MARKER_SEVERITY.hint);
        expect(toMarkerSeverity(undefined)).toBe(MONACO_MARKER_SEVERITY.error);
    });

    it('places the marker on the one-based range', () => {
        expect(toMarkerData(diagnosticAt())).toMatchObject({
            startLineNumber: 3,
            startColumn: 5,
            endLineNumber: 3,
            endColumn: 10,
            message: 'Cannot find name "foo".',
        });
    });

    it('normalizes a numeric code and a code object to a string', () => {
        expect(toMarkerData(diagnosticAt({ code: 2304 })).code).toBe('2304');
        expect(toMarkerData(diagnosticAt({ code: 'no-undef' })).code).toBe('no-undef');
        expect(toMarkerData(diagnosticAt({ code: { value: 2304, target: 'https://example.test' } })).code).toBe('2304');
        expect(toMarkerData(diagnosticAt()).code).toBeUndefined();
    });

    it('carries the source through and converts a whole list', () => {
        const markers = toMarkers([diagnosticAt({ source: 'ts', severity: 2 }), diagnosticAt()]);
        expect(markers).toHaveLength(2);
        expect(markers[0].source).toBe('ts');
        expect(markers[0].severity).toBe(MONACO_MARKER_SEVERITY.warning);
    });

    it('publishes under one owner so clearing never touches another feature', () => {
        expect(LANGUAGE_MARKER_OWNER).toBe('coc-language-server');
    });
});

describe('CRLF documents', () => {
    /**
     * A line terminator belongs to no line: Monaco's columns and LSP's
     * characters both index a line's own text, so a `\r\n` document has to
     * convert with nothing here noticing the `\r`. The risk is not the ±1 —
     * it is a conversion that treats `\r` as a character of the next line, or
     * rewrites the `\r\n` an editor inserted when the user pressed Enter.
     */
    const CRLF = 'const a = 1;\r\nconst b = 2;\r\nconst c = 3;\r\n';

    /** Byte offset of an LSP position, the way a server resolves one. */
    function lspOffset(text: string, position: { line: number; character: number }): number {
        let start = 0;
        for (let line = 0; line < position.line; line += 1) {
            const next = text.indexOf('\n', start);
            if (next < 0) {
                return text.length;
            }
            start = next + 1;
        }
        let end = start;
        while (end < text.length && text[end] !== '\r' && text[end] !== '\n') {
            end += 1;
        }
        return Math.min(start + position.character, end);
    }

    /**
     * Applies the converted changes the way a language server does — in the
     * given order, each against the text the previous one produced. If the
     * conversion were wrong, the result would not be the buffer Monaco holds.
     */
    function applyLspChanges(text: string, changes: ReturnType<typeof toContentChanges>): string {
        let result = text;
        for (const change of changes) {
            const start = lspOffset(result, change.range!.start);
            const end = lspOffset(result, change.range!.end);
            result = result.slice(0, start) + change.text + result.slice(end);
        }
        return result;
    }

    it('keeps the terminator out of the character offsets', () => {
        // Column 13 is the end of `const a = 1;`, which is 12 characters long.
        // The `\r` sits past it and belongs to no column.
        expect(toLspPosition({ lineNumber: 1, column: 13 })).toEqual({ line: 0, character: 12 });
        expect(lspOffset(CRLF, { line: 0, character: 12 })).toBe(12);
        expect(lspOffset(CRLF, { line: 1, character: 0 })).toBe(14);
        expect(CRLF.slice(12, 14)).toBe('\r\n');
    });

    it('converts a delete that joins two CRLF lines', () => {
        // Cursor at the end of line 1, Delete pressed: Monaco removes the two
        // units of the terminator with one range spanning the line break.
        const changes = toContentChanges([
            { range: monacoRange(1, 13, 2, 1), rangeLength: 2, text: '' },
        ]);
        expect(changes).toEqual([
            {
                range: { start: { line: 0, character: 12 }, end: { line: 1, character: 0 } },
                rangeLength: 2,
                text: '',
            },
        ]);
        expect(applyLspChanges(CRLF, changes)).toBe('const a = 1;const b = 2;\r\nconst c = 3;\r\n');
    });

    it('forwards an inserted CRLF terminator verbatim', () => {
        // Enter pressed mid-line in a CRLF model: Monaco inserts the model's
        // own EOL, and normalizing it to `\n` here would desynchronize every
        // offset the server computes from that point on.
        const changes = toContentChanges([
            { range: monacoRange(2, 7, 2, 7), rangeLength: 0, text: '\r\n' },
        ]);
        expect(changes[0].text).toBe('\r\n');
        expect(applyLspChanges(CRLF, changes)).toBe('const a = 1;\r\nconst \r\nb = 2;\r\nconst c = 3;\r\n');
    });

    it('applies a multi-cursor CRLF edit in the order Monaco reported it', () => {
        const changes = toContentChanges([
            { range: monacoRange(3, 7, 3, 8), rangeLength: 1, text: 'z' },
            { range: monacoRange(1, 7, 1, 8), rangeLength: 1, text: 'x' },
        ]);
        expect(applyLspChanges(CRLF, changes)).toBe('const x = 1;\r\nconst b = 2;\r\nconst z = 3;\r\n');
    });

    it('places a marker on the CRLF line the server named', () => {
        const lines = CRLF.split('\r\n');
        const character = lines[2].indexOf('c = 3');
        const marker = toMarkerData({
            range: { start: { line: 2, character }, end: { line: 2, character: character + 1 } },
            message: 'Unused declaration.',
        });
        expect(marker.startLineNumber).toBe(3);
        expect(marker.startColumn).toBe(character + 1);
        // The column indexes the line's own text, so it still names the symbol
        // the server flagged rather than sliding by one terminator per line.
        expect(lines[2][marker.startColumn - 1]).toBe('c');
    });
});
