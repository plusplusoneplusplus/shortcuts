/**
 * Pure conversions between Monaco's editor vocabulary and the LSP vocabulary
 * used by `documentStore.ts` (AC-02, AC-03).
 *
 * Nothing here imports Monaco at runtime — only its types — so the whole layer
 * is testable without a real editor and without the Monaco bundle. The two
 * coordinate systems differ in exactly one way that matters, and it is easy to
 * get wrong in both directions:
 *
 *   - Monaco positions are one-based (line 1, column 1 is the first character).
 *   - LSP positions are zero-based, and under the default `utf-16` position
 *     encoding a character offset counts UTF-16 code units — which is what a
 *     Monaco column counts too. So the conversion is a pure ±1 on both axes and
 *     stays correct for astral-plane characters, where a naive code-point count
 *     would drift.
 *
 * If a server ever negotiates `utf-8` or `utf-32` position encoding, this is
 * the module that has to learn about it; nothing above it does arithmetic on
 * positions.
 */

import type { editor as monacoEditor, IRange } from 'monaco-editor';
import type { DocumentContentChange, LspDiagnostic, LspPosition, LspRange } from './documentStore';

/** Monaco's one-based position, structurally typed so tests need no Monaco. */
export interface MonacoPosition {
    lineNumber: number;
    column: number;
}

/** Monaco's one-based range, structurally typed for the same reason. */
export interface MonacoRange {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
}

/**
 * Monaco's marker severities. Mirrored as literals rather than imported so this
 * module stays free of a runtime Monaco dependency; the values are part of
 * Monaco's public API and are stable.
 */
export const MONACO_MARKER_SEVERITY = {
    hint: 1,
    info: 2,
    warning: 4,
    error: 8,
} as const;

/** Owner string for every marker this feature publishes. */
export const LANGUAGE_MARKER_OWNER = 'coc-language-server';

export function toLspPosition(position: MonacoPosition): LspPosition {
    return { line: position.lineNumber - 1, character: position.column - 1 };
}

export function toMonacoPosition(position: LspPosition): MonacoPosition {
    return { lineNumber: position.line + 1, column: position.character + 1 };
}

export function toLspRange(range: MonacoRange): LspRange {
    return {
        start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
        end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
    };
}

export function toMonacoRange(range: LspRange): MonacoRange {
    return {
        startLineNumber: range.start.line + 1,
        startColumn: range.start.character + 1,
        endLineNumber: range.end.line + 1,
        endColumn: range.end.character + 1,
    };
}

/**
 * Translates one Monaco content-change event into LSP content changes.
 *
 * Monaco reports the changes of a single event sorted by descending position,
 * and every range is expressed against the document as it was *before* the
 * whole event. LSP applies incremental changes one after another, each against
 * the document produced by the previous one. Those two models agree only
 * because of the descending order: applying a later edit first cannot move the
 * offsets of an earlier one. So the order Monaco hands us is exactly the order
 * LSP needs, and re-sorting it would corrupt the server's copy.
 *
 * A change whose range is missing is dropped rather than guessed at; the store
 * falls back to a full-text change whenever any change lacks a range.
 */
export function toContentChanges(
    changes: readonly { range: IRange; rangeLength: number; text: string }[],
): DocumentContentChange[] {
    const result: DocumentContentChange[] = [];
    for (const change of changes) {
        if (!change.range) {
            continue;
        }
        result.push({
            range: toLspRange(change.range),
            rangeLength: change.rangeLength,
            text: change.text,
        });
    }
    return result;
}

/** LSP severity (1 error … 4 hint) to Monaco's, defaulting to error like VS Code. */
export function toMarkerSeverity(severity: number | undefined): number {
    switch (severity) {
        case 2:
            return MONACO_MARKER_SEVERITY.warning;
        case 3:
            return MONACO_MARKER_SEVERITY.info;
        case 4:
            return MONACO_MARKER_SEVERITY.hint;
        default:
            return MONACO_MARKER_SEVERITY.error;
    }
}

/**
 * One LSP diagnostic as a Monaco marker.
 *
 * `code` is normalized to a string because a server may send a number and
 * Monaco renders the value verbatim. A code object (`{ value, target }`) keeps
 * only its value: the target is a documentation link, and we do not open
 * arbitrary URLs from a language server.
 */
export function toMarkerData(diagnostic: LspDiagnostic): monacoEditor.IMarkerData {
    const range = toMonacoRange(diagnostic.range);
    return {
        severity: toMarkerSeverity(diagnostic.severity) as monacoEditor.IMarkerData['severity'],
        message: diagnostic.message,
        source: diagnostic.source,
        code: normalizeCode(diagnostic.code),
        ...range,
    };
}

export function toMarkers(diagnostics: readonly LspDiagnostic[]): monacoEditor.IMarkerData[] {
    return diagnostics.map(toMarkerData);
}

function normalizeCode(code: unknown): string | undefined {
    if (typeof code === 'string') {
        return code;
    }
    if (typeof code === 'number') {
        return String(code);
    }
    if (code && typeof code === 'object') {
        const value = (code as { value?: unknown }).value;
        if (typeof value === 'string' || typeof value === 'number') {
            return String(value);
        }
    }
    return undefined;
}
