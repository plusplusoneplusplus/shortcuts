/**
 * contentReplaceRequest — the pure half of the Search view's replace actions
 * (goal §2.2): turning matches into the request body `POST
 * /api/repos/:id/search/replace` takes, and turning its answer back into a
 * sentence.
 *
 * Kept React-free and in its own module so the shape of the request — the part
 * that decides what gets written to disk — is unit-testable without a DOM.
 *
 * The endpoint never re-searches: it rewrites exactly the spans listed here, so
 * "nothing outside the current result set is ever written" holds by
 * construction as long as the caller passes matches it is showing. Each target
 * echoes the line's text **as the search returned it**; that echo is the whole
 * staleness check, and a file whose line has changed since is skipped rather
 * than overwritten.
 */

import type {
    ExplorerContentMatch,
    ExplorerContentReplaceFile,
    ExplorerContentReplaceResponse,
} from '@plusplusoneplusplus/coc-client';

/**
 * Group matches into per-file target lists, preserving the order the search
 * returned them in. A multi-line query's pieces need no special handling — each
 * piece is still one line with its own columns, which is exactly what a target
 * is — but the replace row disables itself for such a query anyway.
 */
export function buildReplaceFiles(
    matches: readonly ExplorerContentMatch[],
): ExplorerContentReplaceFile[] {
    const byPath = new Map<string, ExplorerContentReplaceFile>();
    for (const match of matches) {
        let file = byPath.get(match.path);
        if (!file) {
            file = { path: match.path, targets: [] };
            byPath.set(match.path, file);
        }
        file.targets.push({
            line: match.line,
            text: match.text,
            startColumn: match.startColumn,
            endColumn: match.endColumn,
        });
    }
    return [...byPath.values()];
}

/** Total spans across a request body — what the confirmation counts. */
export function countReplaceTargets(files: readonly ExplorerContentReplaceFile[]): number {
    return files.reduce((total, file) => total + file.targets.length, 0);
}

/** `1 match` / `2 matches` — the plural is given, not guessed with an `s`. */
function plural(count: number, one: string, many: string): string {
    return `${count} ${count === 1 ? one : many}`;
}

/**
 * The confirmation shown before anything is written. A single file is named
 * outright — that is the case where the user can actually check the answer —
 * and a wider replace reports how many files it spans.
 */
export function replaceConfirmMessage(files: readonly ExplorerContentReplaceFile[]): string {
    const matches = countReplaceTargets(files);
    const where = files.length === 1 ? files[0].path : plural(files.length, 'file', 'files');
    return `Replace ${plural(matches, 'match', 'matches')} in ${where}? This writes to disk and cannot be undone.`;
}

/**
 * Report what the server actually did. Every skipped file is named with its
 * reason: a file that changed under the search is a silent no-op otherwise, and
 * §2.2 requires it be reported rather than hidden.
 */
export function describeReplaceResult(response: ExplorerContentReplaceResponse): string {
    const head = `Replaced ${plural(response.replacedMatches, 'match', 'matches')} in ${plural(response.replacedFiles, 'file', 'files')}.`;
    if (response.skipped.length === 0) return head;
    const detail = response.skipped
        .map(skip => `${skip.path} (${skip.message})`)
        .join(', ');
    return `${head} Skipped ${plural(response.skipped.length, 'file', 'files')}: ${detail}`;
}
