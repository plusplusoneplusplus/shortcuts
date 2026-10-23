/**
 * diffDefinitionRoute — where a go-to-definition that started in a diff lands.
 *
 * Three destinations, in order of preference:
 *
 *   - the same file: stay in this diff and reveal the line on the side the
 *     jump started from;
 *   - another file this review changed: switch the review to that file's diff
 *     and reveal the line on the same side;
 *   - anything else: open the current version of the file at the line.
 *
 * A target in another workspace is never routed (multi-repo safety). Pure, so
 * the decision is testable without an editor or a host.
 */

import type { LanguageNavigationTarget } from '../../language-servers/editorNavigation';
import type { DiffEditorSide } from './diffCoords';

/** One-based position on one diff side. */
export interface DiffRevealPosition {
    side: DiffEditorSide;
    line: number;
    column: number;
}

export type DiffDefinitionRoute =
    | ({ kind: 'same-file' } & DiffRevealPosition)
    | ({ kind: 'review-file'; path: string } & DiffRevealPosition)
    | { kind: 'explorer'; path: string; line: number; column: number; symbolCandidate?: true };

export interface ResolveDiffDefinitionRouteInput {
    /** The diff's own workspace. */
    workspaceId: string;
    /** Repo-relative path of the file the diff shows. */
    filePath: string;
    /** Repo-relative paths this review changed. */
    reviewFiles: readonly string[];
    target: LanguageNavigationTarget;
    /** Side the jump started from; a full-language jump is always the modified side. */
    side?: DiffEditorSide;
}

function normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\.?\/+/, '');
}

/** The route for `target`, or null when it must be declined. */
export function resolveDiffDefinitionRoute(input: ResolveDiffDefinitionRouteInput): DiffDefinitionRoute | null {
    const { workspaceId, filePath, reviewFiles, target } = input;
    if (target.workspaceId !== workspaceId) return null;
    const path = normalizePath(target.path);
    if (!path) return null;
    const side = input.side ?? 'modified';
    const position = { side, line: target.line, column: target.column };
    if (path === normalizePath(filePath)) return { kind: 'same-file', ...position };
    const reviewPath = reviewFiles.find(file => normalizePath(file) === path);
    if (reviewPath !== undefined) return { kind: 'review-file', path: reviewPath, ...position };
    return {
        kind: 'explorer',
        path,
        line: target.line,
        column: target.column,
        ...(target.symbolCandidate ? { symbolCandidate: true as const } : {}),
    };
}
