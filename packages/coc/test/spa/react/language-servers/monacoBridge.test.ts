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
