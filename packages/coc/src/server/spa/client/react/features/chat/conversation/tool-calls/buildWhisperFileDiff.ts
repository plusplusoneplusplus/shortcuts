/**
 * buildWhisperFileDiff — reconstructs a per-file unified diff string from the
 * file-edit tool calls captured inside a single Whisper collapsed group.
 *
 * This is the primary diff source for the transient whisper diff panel: the
 * tool-call data already summarized by the whisper group (the same `edit` /
 * `create` / `apply_patch` calls counted by `computeWhisperSummary`) is replayed
 * into a unified diff for one clicked file. Commit/worktree diff is a fallback
 * only — handled by the caller when this returns `null`.
 *
 * Behaviour:
 *  - Replays every matching operation for `targetPath` in the order the calls
 *    appear (chronological / group order), each as its own hunk so multiple
 *    edits to the same file are clearly separated.
 *  - `edit` (old → new string) and `create` (full file text) produce a
 *    synthesized unified hunk via the shared line-diff.
 *  - `apply_patch` reuses the captured patch body for the file (which already
 *    carries `@@` anchors and +/- lines).
 *  - Codex-style structured changes (`{ path, kind }` with no line content) are
 *    not reconstructable here, so they contribute nothing; if a file has only
 *    such changes, this returns `null` and the caller falls back to a commit
 *    diff.
 *
 * Returns the unified diff string, or `null` when no reconstructable edit for
 * `targetPath` exists in the group.
 */
import { computeLineDiff } from '../../../../../diff/diff-utils';
import { getApplyPatchText } from '../../../../utils/applyPatchParser';
import { normalizeToolName } from './toolNormalization';

/** Minimal shape this reconstruction needs from a captured tool call. */
export interface WhisperDiffToolCall {
    toolName: string;
    args?: unknown;
}

/** One reconstructed hunk: an optional `@@` header plus prefixed body lines. */
interface FileHunk {
    header?: string;
    body: string[];
    /** True when this operation created the file from nothing. */
    isCreate: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Pull the file path out of an `edit`/`create` tool call's args. */
function editPath(args: unknown): string {
    if (!isRecord(args)) return '';
    const candidate = args.path ?? args.filePath ?? args.file_path;
    return typeof candidate === 'string' ? candidate : '';
}

/** Normalize a path for matching (forward slashes, trimmed). */
function normalizePath(p: string): string {
    return p.replace(/\\/g, '/').trim();
}

/** Build prefixed unified-diff body lines for an `old → new` text change. */
function editBodyLines(oldText: string, newText: string): string[] {
    const diff = computeLineDiff(oldText, newText);
    if (diff) {
        return diff.map(d =>
            (d.type === 'added' ? '+' : d.type === 'removed' ? '-' : ' ') + d.content,
        );
    }
    // Very large change: skip LCS minimization, show old removed + new added.
    const removed = oldText === '' ? [] : oldText.split('\n').map(l => '-' + l);
    const added = newText === '' ? [] : newText.split('\n').map(l => '+' + l);
    return [...removed, ...added];
}

/** Count of lines a non-empty string occupies (0 for empty). */
function lineCount(text: string): number {
    return text === '' ? 0 : text.split('\n').length;
}

/**
 * Extract the unified-diff body for `targetPath` from an apply_patch patch.
 * Returns the captured lines (keeping internal `@@` anchors) for the first
 * matching file section, or `null` when the patch has no section for the file.
 */
function patchHunkForFile(patchText: string, targetPath: string): FileHunk | null {
    const target = normalizePath(targetPath);
    const lines = patchText.split(/\r?\n/);
    let capturing = false;
    let isCreate = false;
    const body: string[] = [];

    for (const line of lines) {
        const sectionMatch =
            line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
        if (sectionMatch) {
            if (capturing) break; // next file section ends ours
            const kind = sectionMatch[1];
            const path = normalizePath(sectionMatch[2]);
            if (path === target) {
                capturing = true;
                isCreate = kind === 'Add';
            }
            continue;
        }
        if (!capturing) continue;
        // `*** Move to:` / `*** End of File` / any other sentinel ends the body.
        if (line.startsWith('***')) {
            if (line.startsWith('*** Move to:')) continue;
            break;
        }
        // Drop git-style `---`/`+++` file headers; keep `@@` anchors as
        // hunk separators within the file.
        if (/^(\+\+\+|---)\s/.test(line)) continue;
        body.push(line);
    }

    if (!capturing) return null;
    return { header: undefined, body, isCreate };
}

/**
 * Collect, in call order, every reconstructable hunk that touches `targetPath`.
 */
function collectHunks(toolCalls: WhisperDiffToolCall[], targetPath: string): FileHunk[] {
    const target = normalizePath(targetPath);
    const hunks: FileHunk[] = [];

    for (const call of toolCalls) {
        const toolName = normalizeToolName(call.toolName);
        if (toolName === 'edit' && isRecord(call.args)) {
            if (normalizePath(editPath(call.args)) !== target) continue;
            const oldArg = call.args.old_str ?? call.args.old_string;
            const newArg = call.args.new_str ?? call.args.new_string;
            const oldText = typeof oldArg === 'string' ? oldArg : '';
            const newText = typeof newArg === 'string' ? newArg : '';
            const body = editBodyLines(oldText, newText);
            hunks.push({
                header: `@@ -1,${lineCount(oldText)} +1,${lineCount(newText)} @@`,
                body,
                isCreate: false,
            });
        } else if (toolName === 'create' && isRecord(call.args)) {
            if (normalizePath(editPath(call.args)) !== target) continue;
            const fileText = typeof call.args.file_text === 'string' ? call.args.file_text : '';
            const body = fileText === '' ? [] : fileText.split('\n').map(l => '+' + l);
            hunks.push({
                header: `@@ -0,0 +1,${lineCount(fileText)} @@`,
                body,
                isCreate: true,
            });
        } else if (toolName === 'apply_patch') {
            const patchText = getApplyPatchText(call.args);
            if (!patchText) continue; // Codex structured changes carry no line content
            const hunk = patchHunkForFile(patchText, targetPath);
            if (hunk) hunks.push(hunk);
        }
    }

    return hunks;
}

export function buildWhisperFileDiff(
    toolCalls: WhisperDiffToolCall[],
    targetPath: string,
): string | null {
    if (!targetPath) return null;
    const hunks = collectHunks(toolCalls, targetPath);
    if (hunks.length === 0) return null;

    const path = normalizePath(targetPath);
    const onlyCreates = hunks.every(h => h.isCreate);

    const out: string[] = [`diff --git a/${path} b/${path}`];
    if (onlyCreates) {
        out.push('new file mode 100644');
        out.push('--- /dev/null');
    } else {
        out.push(`--- a/${path}`);
    }
    out.push(`+++ b/${path}`);

    for (const hunk of hunks) {
        if (hunk.header) out.push(hunk.header);
        out.push(...hunk.body);
    }

    return out.join('\n');
}
