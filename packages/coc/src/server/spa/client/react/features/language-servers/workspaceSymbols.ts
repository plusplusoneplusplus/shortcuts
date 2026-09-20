/**
 * Go To All's answer lane: `workspace/symbol` fanned out over every attached
 * language server and merged as the answers land.
 *
 * The shape of the problem is what dictates the shape of this module. A repo
 * with `coc-symbols` and `rust-analyzer` enabled has one server that answers a
 * palette keystroke in milliseconds off a SQLite index and one that may take
 * seconds to warm. Waiting for both before rendering would make the fast one
 * useless, so nothing here ever awaits the whole fan-out before emitting: each
 * server's result is merged into the running list and pushed to the caller the
 * moment it arrives.
 *
 * What it deliberately does not do:
 *   - It does not rank files and symbols into one list. They are different
 *     questions with different scorers; the palette keeps them in two modes.
 *   - It does not re-score. `coc-symbols` already returns the match indices its
 *     ranking used; a server that returns none is appended below the scored
 *     ones rather than given a guessed score.
 *   - It does not fail. A server that times out, dies, or has never heard of
 *     `workspace/symbol` is "no answer", and only *every* target failing turns
 *     into a failure the palette shows.
 */

import { parseBrowserDocumentUri } from './documentStore';
import type { LanguageServerAttachment, LanguageServerAttachedInfo } from './languageServerClient';

/** One row in the palette. Flat, because that is what the list renders. */
export interface WorkspaceSymbolResult {
    name: string;
    containerName?: string;
    /** LSP `SymbolKind`. */
    kind: number;
    /** Workspace-relative path of the file the symbol lives in. */
    path: string;
    /** One-based, ready for the editor. */
    line: number;
    col: number;
    /** Which server answered, for debugging and for the kind glyph fallback. */
    definitionId: string;
    /** UTF-16 offsets into `name` the server's own scorer matched. */
    indices?: number[];
    /** Set only in repo-group scope. */
    workspaceId?: string;
    repoName?: string;
}

/** How a fan-out ended, reusing `searchRepoGroupFiles`'s vocabulary verbatim. */
export type WorkspaceSymbolStatus = 'complete' | 'partial' | 'failed' | 'no-searchable-members';

export interface WorkspaceSymbolTarget {
    /** A workspace-scoped attachment, from `LanguageServerClient.attachWorkspace`. */
    attachment: LanguageServerAttachment;
    /** Present in group scope; stamped onto every result for the repo badge. */
    workspaceId?: string;
    repoName?: string;
}

export interface WorkspaceSymbolQuery {
    targets: readonly WorkspaceSymbolTarget[];
    query: string;
    signal?: AbortSignal;
    /**
     * Called once per server that answered, with the merged list so far.
     * `pending` counts the servers still outstanding, which is what separates
     * "streaming" from "done" in the palette.
     */
    onResults?: (results: WorkspaceSymbolResult[], pending: number) => void;
    /** Upper bound on rendered rows; matches the palette's own limit. */
    limit?: number;
}

export interface WorkspaceSymbolOutcome {
    results: WorkspaceSymbolResult[];
    status: WorkspaceSymbolStatus;
}

const DEFAULT_LIMIT = 50;

/**
 * Members queried at once in a repo group. Each one holds language-server
 * sessions on its host for as long as the palette is open, so this is a bound
 * on sessions as much as on sockets.
 */
export const MAX_CONCURRENT_MEMBERS = 6;

/** True when this server advertises `workspace/symbol`. */
export function supportsWorkspaceSymbols(info: LanguageServerAttachedInfo): boolean {
    const capabilities = info.state?.capabilities;
    if (!capabilities || typeof capabilities !== 'object') {
        // No handshake yet. Asking and being told "unknown method" is cheap;
        // skipping the only server that can answer is not.
        return true;
    }
    const value = (capabilities as Record<string, unknown>).workspaceSymbolProvider;
    return value === true || (typeof value === 'object' && value !== null);
}

/**
 * Query every server on every target, merging progressively.
 *
 * Resolves once every target has settled. Callers that render as results
 * arrive should use `onResults` and treat the returned value as the final
 * state rather than the only one.
 */
export async function queryWorkspaceSymbols(
    options: WorkspaceSymbolQuery,
): Promise<WorkspaceSymbolOutcome> {
    const limit = options.limit ?? DEFAULT_LIMIT;
    const query = options.query.trim();
    if (!query || options.targets.length === 0) {
        return { results: [], status: options.targets.length === 0 ? 'no-searchable-members' : 'complete' };
    }

    const requests = options.targets.flatMap((target) =>
        target.attachment.getInfos()
            .filter(supportsWorkspaceSymbols)
            .map((info) => ({ target, info })));
    if (requests.length === 0) {
        return { results: [], status: 'no-searchable-members' };
    }

    const merged = new Map<string, WorkspaceSymbolResult>();
    /** Rank a row held inside its own server's answer, by result identity. */
    const order = new Map<string, number>();
    let pending = requests.length;
    let answered = 0;
    let failed = 0;

    await Promise.all(requests.map(async ({ target, info }) => {
        let rows: WorkspaceSymbolResult[] | null = null;
        try {
            const raw = await target.attachment.sendRequestTo(
                info.definitionId,
                'workspace/symbol',
                { query },
                { signal: options.signal },
            );
            rows = normalizeSymbols(raw, info.definitionId, target);
        } catch {
            // A timeout, a dead session or an unsupported method are all
            // "no answer" — never a thrown error out of the palette.
            rows = null;
        }
        pending -= 1;
        if (rows === null) {
            failed += 1;
        } else {
            answered += 1;
            rows.forEach((row, index) => {
                const key = resultKey(row);
                // First server to name a location owns the row; a later one
                // re-ranking it would move the selection under an Enter press.
                if (merged.has(key)) return;
                merged.set(key, row);
                order.set(key, index);
            });
        }
        if (options.signal?.aborted) return;
        options.onResults?.(rank(merged, order, limit), pending);
    }));

    return {
        results: rank(merged, order, limit),
        status: failed === 0 ? 'complete' : answered === 0 ? 'failed' : 'partial',
    };
}

/**
 * Stable order across merges.
 *
 * Each server ranked its own answer, and those scores are not comparable
 * across servers — so what carries across is a row's *position within the
 * answer it came from*. Rows a server scored (they carry match indices) sort
 * above rows nobody scored, and a late merge therefore folds in below the hits
 * already on screen instead of shuffling them.
 */
function rank(
    merged: Map<string, WorkspaceSymbolResult>,
    order: Map<string, number>,
    limit: number,
): WorkspaceSymbolResult[] {
    return [...merged.entries()]
        .sort(([keyA, a], [keyB, b]) => {
            const scored = Number(b.indices !== undefined) - Number(a.indices !== undefined);
            if (scored !== 0) return scored;
            const position = (order.get(keyA) ?? 0) - (order.get(keyB) ?? 0);
            if (position !== 0) return position;
            if (a.name !== b.name) return a.name < b.name ? -1 : 1;
            if (a.path !== b.path) return a.path < b.path ? -1 : 1;
            return a.line - b.line;
        })
        .map(([, result]) => result)
        .slice(0, limit);
}

/** Identity of a result, for dedupe across servers answering the same repo. */
function resultKey(result: WorkspaceSymbolResult): string {
    return `${result.workspaceId ?? ''}:${result.path}:${result.line}:${result.name}`;
}

/** LSP `SymbolInformation[]` (or `WorkspaceSymbol[]`) to palette rows. */
export function normalizeSymbols(
    raw: unknown,
    definitionId: string,
    target: Pick<WorkspaceSymbolTarget, 'workspaceId' | 'repoName'> = {},
): WorkspaceSymbolResult[] {
    if (!Array.isArray(raw)) return [];
    const rows: WorkspaceSymbolResult[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const symbol = entry as Record<string, unknown>;
        const name = typeof symbol.name === 'string' ? symbol.name : '';
        const location = symbol.location as { uri?: unknown; range?: unknown } | undefined;
        const uri = typeof location?.uri === 'string' ? location.uri : undefined;
        const document = uri ? parseBrowserDocumentUri(uri) : null;
        if (!name || !document) continue;
        const start = (location?.range as { start?: { line?: unknown; character?: unknown } } | undefined)?.start;
        rows.push({
            name,
            containerName: typeof symbol.containerName === 'string' && symbol.containerName
                ? symbol.containerName
                : undefined,
            kind: typeof symbol.kind === 'number' ? symbol.kind : 0,
            path: document.path,
            line: toOneBased(start?.line),
            col: toOneBased(start?.character),
            definitionId,
            indices: readMatchIndices(symbol.cocMatchIndices),
            ...(target.workspaceId ? { workspaceId: target.workspaceId } : {}),
            ...(target.repoName ? { repoName: target.repoName } : {}),
        });
    }
    return rows;
}

/** LSP positions are zero-based; the editor and the palette are not. */
function toOneBased(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value + 1 : 1;
}

/**
 * The scorer's own match offsets, read opportunistically: an LSP server that
 * has never heard of the extension field simply contributes no highlight.
 */
function readMatchIndices(value: unknown): number[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const indices = value.filter(
        (entry): entry is number => typeof entry === 'number' && Number.isInteger(entry) && entry >= 0,
    );
    return indices.length > 0 ? indices : undefined;
}
