/**
 * diffDefinitionLocate — where a definition sits in the version a diff shows.
 *
 * Definition providers answer in current-code coordinates (the working copy
 * the language server and symbol index read). A diff side is a snapshot: a
 * commit, the index, a parent. A matching path or an in-range line number is
 * no proof that the coordinate applies to it, so a reveal inside the review is
 * allowed only with evidence tied to the snapshot:
 *
 *   - the snapshot text equals the current text, so every coordinate holds; or
 *   - the current definition line appears exactly once, verbatim, in the
 *     snapshot, so the definition merely moved.
 *
 * Anything else (missing, edited or repeated line) is unreliable; the caller
 * opens current source instead, labeled as such.
 */

import type { GitFileDiffContentResponse } from '@plusplusoneplusplus/coc-client';
import type { DiffEditorSide } from './diffCoords';

export interface SnapshotLocation {
    line: number;
    column: number;
}

function splitLines(text: string): string[] {
    return text.split(/\r?\n/);
}

/** `line`/`column` (one-based, current code) located in `snapshot`, or null when unreliable. */
export function locateDefinitionInSnapshot(snapshot: string, current: string, line: number, column: number): SnapshotLocation | null {
    const currentLines = splitLines(current);
    if (line < 1 || line > currentLines.length) return null;
    if (snapshot === current) return { line, column };
    const definitionLine = currentLines[line - 1];
    if (definitionLine.trim() === '') return null;
    let found = -1;
    const snapshotLines = splitLines(snapshot);
    for (let index = 0; index < snapshotLines.length; index++) {
        if (snapshotLines[index] !== definitionLine) continue;
        if (found >= 0) return null;
        found = index;
    }
    return found < 0 ? null : { line: found + 1, column };
}

/** The text one diff side shows, or null when that side has no readable text. */
export function snapshotText(content: GitFileDiffContentResponse, side: DiffEditorSide): string | null {
    if (content.binary || content.tooLarge) return null;
    const version = side === 'original' ? content.base : content.head;
    return version.exists === false ? null : version.content;
}
