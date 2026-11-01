/**
 * whisperReviewModel — adapts a chat's captured file changes to the shared
 * review navigator (`ReviewFiles`) and the Monaco diff viewer.
 *
 * The changes come from replayed tool calls (`useWhisperDiffState`), not from
 * Git, so each file carries exactly what the agent's calls recorded:
 *
 *  - `whole` — the change is one complete new file (a single all-added hunk of
 *    a new-file diff), so both sides are known in full: an empty original and
 *    the created text.
 *  - `patch` — the calls carried only the edited snippets. Its Monaco sides
 *    (`buildSnippetSides`) hold just those snippets, one block per captured
 *    hunk, and are never expanded into made-up full files.
 *  - `deleted` / `unavailable` — no diff body was captured.
 */
import type { ReviewFile } from '../../git/diff/ReviewFiles';
import { getSourceCanvasDisplayPath } from '../source-canvas/resolve';
import type { FileEdit } from '../conversation/tool-calls/toolGroupUtils';
import type { WhisperFileHunk } from '../conversation/tool-calls/buildWhisperFileDiff';
import type { DiffLineLabels } from '../../git/diff/monacoDiffOptions';
import type { WhisperDiffState } from './useWhisperDiffState';

/** The captured snippets as two editor sides; see `buildSnippetSides`. */
export interface WhisperSnippetSides {
    original: string;
    modified: string;
    lineLabels: DiffLineLabels;
}

export type WhisperReviewContent =
    | { kind: 'whole'; diff: string; original: string; modified: string }
    | ({ kind: 'patch'; diff: string } & WhisperSnippetSides)
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

/** Gap row before a snippet whose position in the file was not captured. */
export const SNIPPET_GAP = '\u22EF';

const ANCHOR_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * The captured snippets as an original and a modified text for Monaco.
 *
 * Each block — a replayed operation, split again at every `@@` anchor the
 * agent wrote — starts with one row on both sides: the anchor itself, or
 * `SNIPPET_GAP` when the position is unknown. Blocks never merge, so disjoint
 * hunks stay apart and Monaco aligns on those shared rows.
 *
 * Line labels are the file's line numbers only where a captured
 * `@@ -a,b +c,d @@` anchor gives them; synthesized headers (edits, creates,
 * unanchored patch bodies) and the separator rows get blank labels.
 */
export function buildSnippetSides(hunks: readonly WhisperFileHunk[]): WhisperSnippetSides {
    const original: string[] = [];
    const modified: string[] = [];
    const labels: { original: string[]; modified: string[] } = { original: [], modified: [] };
    let oldLine: number | null = null;
    let newLine: number | null = null;
    const separator = (text: string) => {
        const anchor = ANCHOR_RE.exec(text);
        oldLine = anchor ? Number(anchor[1]) : null;
        newLine = anchor ? Number(anchor[2]) : null;
        original.push(text);
        modified.push(text);
        labels.original.push('');
        labels.modified.push('');
    };
    const push = (side: 'original' | 'modified', text: string) => {
        const line = side === 'original' ? oldLine : newLine;
        (side === 'original' ? original : modified).push(text);
        labels[side].push(line === null ? '' : String(line));
        if (side === 'original' && oldLine !== null) oldLine++;
        if (side === 'modified' && newLine !== null) newLine++;
    };
    for (const hunk of hunks) {
        let open = false;
        for (const line of hunk.body) {
            if (line.startsWith('@@')) {
                separator(line);
                open = true;
                continue;
            }
            if (line.startsWith('\\')) continue;
            if (!open) {
                separator(SNIPPET_GAP);
                open = true;
            }
            if (line.startsWith('-')) push('original', line.slice(1));
            else if (line.startsWith('+')) push('modified', line.slice(1));
            else {
                // Context (`' '`-prefixed, or a bare blank line in a patch).
                const text = line.startsWith(' ') ? line.slice(1) : line;
                push('original', text);
                push('modified', text);
            }
        }
    }
    return { original: original.join('\n'), modified: modified.join('\n'), lineLabels: labels };
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
    const sections = new Map(state.view.sections.map(section => [section.file.path, section]));
    return state.files.map(file => {
        const section = sections.get(file.path);
        const whole = section ? wholeNewFileText(section.diff) : null;
        const content: WhisperReviewContent = file.isDeleted ? { kind: 'deleted' }
            : !section ? { kind: 'unavailable' }
                : whole !== null ? { kind: 'whole', diff: section.diff, original: '', modified: whole }
                    : { kind: 'patch', diff: section.diff, ...buildSnippetSides(section.hunks) };
        return {
            file: {
                path: displayPath(file.path, workspaceRootPath),
                status: statusOf(file),
                additions: file.netInsertions ?? file.insertions,
                deletions: file.netDeletions ?? file.deletions,
            },
            sourcePath: file.path,
            content,
            modelIdentity: `chat-change-${hash32(section?.diff ?? '')}`,
        };
    });
}

/** Identity of one captured change set, for keying transient review state. */
export function whisperReviewContentKey(entries: readonly WhisperReviewEntry[]): string {
    return hash32(entries.map(entry => `${entry.sourcePath}\u0000${entry.file.status}\u0000${entry.modelIdentity}`).join('\n'));
}
