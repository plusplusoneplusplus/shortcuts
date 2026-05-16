/**
 * Unified-diff parser shared by the redesigned PR detail page.
 *
 * The CoC server exposes a single REST endpoint for a PR diff:
 *
 *   GET /api/repos/:repoId/pull-requests/:prId/diff   →   text/plain
 *
 * The body is a standard `git diff --unified` payload.  This module
 * extracts the per-file change list (path, status, +/- counts, hunks,
 * line-numbered lines) so the React UI can show real file changes
 * without inventing a separate API for the queue rail or files tab.
 *
 * The parser intentionally stays small and defensive — it handles the
 * subset of unified-diff features that GitHub/ADO emit (added files,
 * deleted files, renames, binary files, no-newline-at-eof) and skips
 * everything it does not recognize instead of throwing.
 */

export type DiffLineKind = 'add' | 'del' | 'ctx' | 'hunk';

export interface DiffLine {
    kind: DiffLineKind;
    text: string;
    /** 1-based line number on the OLD side (undefined for `add` rows). */
    oldLineNo?: number;
    /** 1-based line number on the NEW side (undefined for `del` rows). */
    newLineNo?: number;
}

export type DiffFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface ParsedDiffFile {
    /** Path on the NEW side (or OLD side for deletes). Always defined. */
    path: string;
    /** Path on the OLD side, present for renames and deletes. */
    oldPath?: string;
    status: DiffFileStatus;
    additions: number;
    deletions: number;
    /** True when the diff body indicates this is a binary file. */
    isBinary: boolean;
    /** Ordered diff lines (context, additions, deletions, hunk headers). */
    lines: DiffLine[];
}

export interface ParsedDiff {
    files: ParsedDiffFile[];
    totalAdditions: number;
    totalDeletions: number;
    fileCount: number;
}

const EMPTY: ParsedDiff = { files: [], totalAdditions: 0, totalDeletions: 0, fileCount: 0 };

/**
 * Parse a unified-diff payload. Returns an empty result when the input
 * is empty, whitespace-only, or has no `diff --git` headers.
 */
export function parseUnifiedDiff(input: string | null | undefined): ParsedDiff {
    if (!input || !input.trim()) return { ...EMPTY };

    const lines = input.split(/\r?\n/);
    const files: ParsedDiffFile[] = [];
    let current: ParsedDiffFile | null = null;
    let oldLineNo = 0;
    let newLineNo = 0;
    let inHunk = false;

    const finalize = () => {
        if (current) {
            if (current.oldPath && current.oldPath === current.path) {
                current.oldPath = undefined;
            }
            files.push(current);
        }
        current = null;
        inHunk = false;
        oldLineNo = 0;
        newLineNo = 0;
    };

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];

        if (raw.startsWith('diff --git ')) {
            finalize();
            const paths = parseDiffHeaderPaths(raw);
            current = {
                path: paths.newPath ?? paths.oldPath ?? '(unknown)',
                oldPath: paths.oldPath !== paths.newPath ? paths.oldPath : undefined,
                status: 'modified',
                additions: 0,
                deletions: 0,
                isBinary: false,
                lines: [],
            };
            continue;
        }

        if (!current) continue;

        if (raw.startsWith('new file mode')) { current.status = 'added'; continue; }
        if (raw.startsWith('deleted file mode')) { current.status = 'deleted'; continue; }
        if (raw.startsWith('rename from ')) {
            current.oldPath = raw.slice('rename from '.length).trim();
            current.status = 'renamed';
            continue;
        }
        if (raw.startsWith('rename to ')) {
            current.path = raw.slice('rename to '.length).trim();
            current.status = 'renamed';
            continue;
        }
        if (raw.startsWith('copy from ') || raw.startsWith('copy to ') || raw.startsWith('similarity index ') ||
            raw.startsWith('dissimilarity index ') || raw.startsWith('index ')) {
            continue;
        }
        if (raw.startsWith('Binary files') || raw.startsWith('GIT binary patch')) {
            current.isBinary = true;
            continue;
        }
        if (raw.startsWith('--- ')) {
            const stripped = stripDiffPathPrefix(raw.slice('--- '.length).trim());
            if (stripped === '/dev/null') current.status = 'added';
            else if (!current.oldPath && stripped) current.oldPath = stripped;
            continue;
        }
        if (raw.startsWith('+++ ')) {
            const stripped = stripDiffPathPrefix(raw.slice('+++ '.length).trim());
            if (stripped === '/dev/null') current.status = 'deleted';
            else if (stripped) current.path = stripped;
            continue;
        }
        if (raw.startsWith('@@')) {
            const header = parseHunkHeader(raw);
            if (!header) continue;
            oldLineNo = header.oldStart;
            newLineNo = header.newStart;
            inHunk = true;
            current.lines.push({ kind: 'hunk', text: raw });
            continue;
        }
        if (!inHunk) continue;
        if (raw.startsWith('\\ ')) continue; // e.g. "\ No newline at end of file"

        if (raw.startsWith('+')) {
            current.additions += 1;
            current.lines.push({ kind: 'add', text: raw.slice(1), newLineNo });
            newLineNo += 1;
        } else if (raw.startsWith('-')) {
            current.deletions += 1;
            current.lines.push({ kind: 'del', text: raw.slice(1), oldLineNo });
            oldLineNo += 1;
        } else {
            // A context line begins with a single space; an empty hunk row
            // (often produced by trailing newlines) is also treated as
            // context to preserve alignment.
            const text = raw.startsWith(' ') ? raw.slice(1) : raw;
            current.lines.push({ kind: 'ctx', text, oldLineNo, newLineNo });
            oldLineNo += 1;
            newLineNo += 1;
        }
    }

    finalize();

    const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
    const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);
    return { files, totalAdditions, totalDeletions, fileCount: files.length };
}

interface HeaderPaths { oldPath?: string; newPath?: string; }

/**
 * Extract the two file paths from a `diff --git a/foo b/foo` header.
 * Falls back to whitespace splitting when paths are unquoted.
 */
function parseDiffHeaderPaths(line: string): HeaderPaths {
    const body = line.slice('diff --git '.length);
    // Path tokens may be quoted (when they contain spaces) or bare.
    const tokens: string[] = [];
    let i = 0;
    while (i < body.length && tokens.length < 2) {
        while (i < body.length && body[i] === ' ') i++;
        if (i >= body.length) break;
        if (body[i] === '"') {
            const end = body.indexOf('"', i + 1);
            if (end === -1) { tokens.push(body.slice(i + 1)); break; }
            tokens.push(body.slice(i + 1, end));
            i = end + 1;
        } else {
            const end = body.indexOf(' ', i);
            if (end === -1) { tokens.push(body.slice(i)); break; }
            tokens.push(body.slice(i, end));
            i = end + 1;
        }
    }
    return { oldPath: stripDiffPathPrefix(tokens[0]), newPath: stripDiffPathPrefix(tokens[1]) };
}

/** Strip the `a/` or `b/` prefix that git adds to diff paths. */
function stripDiffPathPrefix(token: string | undefined): string | undefined {
    if (!token) return undefined;
    if (token === '/dev/null') return token;
    if (token.startsWith('a/') || token.startsWith('b/')) return token.slice(2);
    return token;
}

interface HunkHeader { oldStart: number; newStart: number; }

/** Parse the `@@ -10,3 +12,4 @@` portion of a hunk header. */
function parseHunkHeader(line: string): HunkHeader | null {
    const match = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);
    if (!match) return null;
    return { oldStart: Number(match[1]) || 1, newStart: Number(match[2]) || 1 };
}
