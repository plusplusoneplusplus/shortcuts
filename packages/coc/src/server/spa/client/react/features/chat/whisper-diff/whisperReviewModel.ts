/**
 * whisperReviewModel — adapts a chat's captured file changes to the shared
 * review navigator (`ReviewFiles`) and the Monaco diff viewer.
 *
 * The changes come from replayed tool calls (`useWhisperDiffState`), not from
 * Git, so each file carries exactly what the agent's calls recorded:
 *
 *  - `whole` — the change is one complete new file (a single all-added hunk of
 *    a new-file diff), so both sides are known in full: an empty original and
 *    the created text. Only these files open in Monaco.
 *  - `patch` — the calls carried only the edited snippets. The reconstructed
 *    patch is all there is; it renders in the classic viewer and is never
 *    expanded into made-up full files.
 *  - `deleted` / `unavailable` — no diff body was captured.
 */
import type { ReviewFile } from '../../git/diff/ReviewFiles';
import { getSourceCanvasDisplayPath } from '../source-canvas/resolve';
import type { FileEdit } from '../conversation/tool-calls/toolGroupUtils';
import type { WhisperDiffState } from './useWhisperDiffState';

export type WhisperReviewContent =
    | { kind: 'whole'; diff: string; original: string; modified: string }
    | { kind: 'patch'; diff: string }
    | { kind: 'deleted' }
    | { kind: 'unavailable' };

export interface WhisperReviewEntry {
    /** Navigator row; `path` is the `/`-separated workspace-relative display path. */
    file: ReviewFile;
    /** The captured path as the tool calls recorded it. */
    sourcePath: string;
    content: WhisperReviewContent;
    /** Content-derived identity for synthetic Monaco model URIs. */
    modelIdentity: string;
}

/** FNV-1a, 32-bit: a short, stable content key. */
function hash32(input: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
}

/**
 * The created text when `diff` is one complete new file, else null. A new-file
 * diff with a single hunk whose every body line is an addition holds the whole
 * file; anything else (edits, several operations, no-newline markers) is a
 * partial patch.
 */
export function wholeNewFileText(diff: string): string | null {
    const lines = diff.split('\n');
    const start = lines.findIndex(line => line.startsWith('@@'));
    if (start < 0 || !lines.slice(0, start).includes('--- /dev/null')) return null;
    const body = lines.slice(start + 1);
    if (body.some(line => !line.startsWith('+'))) return null;
    return body.map(line => line.slice(1)).join('\n');
}

function displayPath(path: string, workspaceRootPath?: string | null): string {
    return getSourceCanvasDisplayPath(path, workspaceRootPath).replace(/\\/g, '/').replace(/^\/+/, '');
}

function statusOf(file: FileEdit): string {
    return file.isDeleted ? 'D' : file.isCreate ? 'A' : 'M';
}

/** One navigator entry per captured file, in the state's file order. */
export function buildWhisperReviewEntries(
    state: WhisperDiffState,
    workspaceRootPath?: string | null,
): WhisperReviewEntry[] {
    const sections = new Map(state.view.sections.map(section => [section.file.path, section.diff]));
    return state.files.map(file => {
        const diff = sections.get(file.path);
        const whole = diff === undefined ? null : wholeNewFileText(diff);
        const content: WhisperReviewContent = file.isDeleted ? { kind: 'deleted' }
            : diff === undefined ? { kind: 'unavailable' }
                : whole !== null ? { kind: 'whole', diff, original: '', modified: whole }
                    : { kind: 'patch', diff };
        return {
            file: {
                path: displayPath(file.path, workspaceRootPath),
                status: statusOf(file),
                additions: file.netInsertions ?? file.insertions,
                deletions: file.netDeletions ?? file.deletions,
            },
            sourcePath: file.path,
            content,
            modelIdentity: `chat-change-${hash32(diff ?? '')}`,
        };
    });
}

/** Identity of one captured change set, for keying transient review state. */
export function whisperReviewContentKey(entries: readonly WhisperReviewEntry[]): string {
    return hash32(entries.map(entry => `${entry.sourcePath}\u0000${entry.file.status}\u0000${entry.modelIdentity}`).join('\n'));
}
