/**
 * Shared Notes-API mock fixtures for E2E tests.
 *
 * Provides an in-memory notes store and a Playwright `page.route` layer that
 * serves the notes read/write endpoints from mocked data — no real note files
 * on disk. This is the mock-data tier: it mirrors the request/response shapes of
 * the notes handlers
 * (packages/coc/src/server/notes/notes-read-handler.ts and notes-write-handler.ts)
 * and the coc-client contracts (packages/coc-client/src/contracts/notes.ts).
 *
 * Create a FRESH store per test (see `createNotesStore`) so specs stay
 * parallel-safe — never share a module-global mutable store.
 *
 * Routing strategy: the mock intercepts the documented notes routes
 * (tree, content GET/PUT, page POST, path PATCH/DELETE, order PUT, search GET,
 * image POST/GET) from mocked data, and serves hermetic defaults for the
 * auxiliary GETs the Notes page fires on load (roots, git status, comments).
 * Every other `/notes/**` request is passed through to the real server via
 * `route.continue()`.
 */

import type { Page } from '@playwright/test';

// ── Contract shapes (mirror coc-client contracts/notes.ts) ───────────────────

export type NoteNodeType = 'notebook' | 'section' | 'page';

export interface NoteTreeNode {
    name: string;
    path: string;
    type: NoteNodeType;
    children?: NoteTreeNode[];
    lastModifiedAt?: string;
}

export interface NoteSearchMatch {
    line: number;
    text: string;
}

export interface NoteSearchResult {
    path: string;
    matches: NoteSearchMatch[];
}

/** Which documented notes route a recorded request hit. */
export type NotesRouteKey =
    | 'tree'
    | 'content-get'
    | 'content-put'
    | 'page-post'
    | 'path-patch'
    | 'path-delete'
    | 'order-put'
    | 'search'
    | 'image-post'
    | 'image-get';

/** A single intercepted documented request, captured for assertions. */
export interface RecordedNotesRequest {
    key: NotesRouteKey;
    method: string;
    url: string;
    query: Record<string, string>;
    /** Parsed JSON body for POST/PUT/PATCH; `null` for GET/DELETE. */
    body: unknown;
}

/** An injected fault served instead of the normal response for one route. */
export interface NotesFault {
    status: number;
    /** JSON body to return. Omit for an empty object. */
    body?: unknown;
    /** When true, the fault is cleared after it is served once. */
    once?: boolean;
}

export interface NotesStoreSeed {
    /** Initial tree returned by GET notes/tree. */
    tree: NoteTreeNode[];
    /** Map of note path -> markdown for GET notes/content. Missing paths 404. */
    content?: Record<string, string>;
    /** Absolute notes root path echoed in tree/content responses. */
    notesRoot?: string;
    /** System folder names (protected in the sidebar). Defaults to []. */
    systemFolders?: string[];
    /** Hits returned by GET notes/search. Defaults to []. */
    searchResults?: NoteSearchResult[];
    /** Base mtime for content responses; increments on each save. */
    mtime?: number;
}

const DEFAULT_MTIME = 1_700_000_000_000;
const DEFAULT_NOTES_ROOT = '/mock/notes';

/** Deterministic attachment path returned by the mocked image upload (POST). */
export const MOCK_UPLOADED_PDF_PATH = '.attachments/uploaded.pdf';

/** A tiny but valid PDF served by the mocked image GET route. */
const MOCK_PDF_BYTES = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
    'utf-8',
);

// ── Tree helpers ─────────────────────────────────────────────────────────────

function cloneTree(nodes: NoteTreeNode[]): NoteTreeNode[] {
    return nodes.map((n) => ({
        ...n,
        children: n.children ? cloneTree(n.children) : undefined,
    }));
}

/** Forward-slash dirname (`''` when the path has no parent). */
function parentOf(notePath: string): string {
    const idx = notePath.lastIndexOf('/');
    return idx === -1 ? '' : notePath.slice(0, idx);
}

function baseNameOf(notePath: string): string {
    const idx = notePath.lastIndexOf('/');
    return idx === -1 ? notePath : notePath.slice(idx + 1);
}

function findNode(nodes: NoteTreeNode[], notePath: string): NoteTreeNode | null {
    for (const node of nodes) {
        if (node.path === notePath) return node;
        if (node.children) {
            const found = findNode(node.children, notePath);
            if (found) return found;
        }
    }
    return null;
}

function removeFromTree(nodes: NoteTreeNode[], notePath: string): NoteTreeNode[] {
    return nodes
        .filter((n) => n.path !== notePath)
        .map((n) => (n.children ? { ...n, children: removeFromTree(n.children, notePath) } : n));
}

/** Rewrite a node's path (and its descendants') from one prefix to another. */
function reprefixPaths(node: NoteTreeNode, oldPrefix: string, newPrefix: string): void {
    node.path = newPrefix + node.path.slice(oldPrefix.length);
    if (node.children) {
        for (const child of node.children) reprefixPaths(child, oldPrefix, newPrefix);
    }
}

// ── The in-memory store ──────────────────────────────────────────────────────

export class NotesStore {
    tree: NoteTreeNode[];
    content: Map<string, string>;
    notesRoot: string;
    systemFolders: string[];
    searchResults: NoteSearchResult[];
    mtime: number;

    /** Every intercepted documented request, in arrival order. */
    readonly requests: RecordedNotesRequest[] = [];

    private readonly faults = new Map<NotesRouteKey, NotesFault>();
    private readonly delays = new Map<NotesRouteKey, number>();

    constructor(seed: NotesStoreSeed) {
        this.tree = cloneTree(seed.tree);
        this.content = new Map(Object.entries(seed.content ?? {}));
        this.notesRoot = seed.notesRoot ?? DEFAULT_NOTES_ROOT;
        this.systemFolders = seed.systemFolders ?? [];
        this.searchResults = seed.searchResults ?? [];
        this.mtime = seed.mtime ?? DEFAULT_MTIME;
    }

    // ── Fault / delay injection (for error and loading-state coverage) ───────

    /** Serve `fault` for the next matching request(s) on `key`. */
    failRoute(key: NotesRouteKey, fault: NotesFault): void {
        this.faults.set(key, fault);
    }

    clearFault(key: NotesRouteKey): void {
        this.faults.delete(key);
    }

    /** Delay the response for `key` by `ms` (for loading-state coverage). */
    delayRoute(key: NotesRouteKey, ms: number): void {
        this.delays.set(key, ms);
    }

    clearDelay(key: NotesRouteKey): void {
        this.delays.delete(key);
    }

    /** Internal: read (and consume, when `once`) the fault for a route. */
    takeFault(key: NotesRouteKey): NotesFault | undefined {
        const fault = this.faults.get(key);
        if (fault?.once) this.faults.delete(key);
        return fault;
    }

    /** Internal: current artificial delay (ms) for a route. */
    getDelay(key: NotesRouteKey): number {
        return this.delays.get(key) ?? 0;
    }

    // ── Request query helpers ────────────────────────────────────────────────

    requestsFor(key: NotesRouteKey): RecordedNotesRequest[] {
        return this.requests.filter((r) => r.key === key);
    }

    lastRequest(key: NotesRouteKey): RecordedNotesRequest | undefined {
        const matching = this.requestsFor(key);
        return matching[matching.length - 1];
    }

    // ── Tree mutations (mirror what the write handlers do on disk) ───────────

    insertNode(parentPath: string, node: NoteTreeNode): void {
        if (parentPath === '') {
            this.tree.push(node);
            return;
        }
        const parent = findNode(this.tree, parentPath);
        if (parent) {
            parent.children = parent.children ?? [];
            parent.children.push(node);
        } else {
            this.tree.push(node);
        }
    }

    removeNode(notePath: string): void {
        this.tree = removeFromTree(this.tree, notePath);
    }

    renameNode(oldPath: string, newPath: string): void {
        const node = findNode(this.tree, oldPath);
        if (!node) return;
        reprefixPaths(node, oldPath, newPath);
        node.name = baseNameOf(newPath);
        // Move content for the renamed page (and any descendant pages).
        for (const [key, value] of [...this.content.entries()]) {
            if (key === oldPath || key.startsWith(oldPath + '/')) {
                this.content.delete(key);
                this.content.set(newPath + key.slice(oldPath.length), value);
            }
        }
    }
}

/** Create a fresh per-test notes store from a plain seed object. */
export function createNotesStore(seed: NotesStoreSeed): NotesStore {
    return new NotesStore(seed);
}

// ── The Playwright route layer ───────────────────────────────────────────────

/**
 * Install the mocked notes API on `page`. Intercepts the documented notes
 * routes from `store`, serves hermetic defaults for the auxiliary GETs the
 * Notes page fires (roots, git status, comments), and passes everything else on
 * `/notes/**` through to the real server.
 */
export async function mockNotesApi(page: Page, store: NotesStore): Promise<void> {
    await page.route('**/api/workspaces/*/notes/**', async (route) => {
        const request = route.request();
        const method = request.method();
        const parsed = new URL(request.url());
        const notesIdx = parsed.pathname.indexOf('/notes');
        const suffix = parsed.pathname.slice(notesIdx + '/notes'.length); // '/tree', '/content', ...
        const query = Object.fromEntries(parsed.searchParams.entries());

        const respondJson = (status: number, body: unknown) =>
            route.fulfill({
                status,
                contentType: 'application/json',
                body: JSON.stringify(body),
            });

        let jsonBody: unknown = null;
        try {
            jsonBody = request.postData() ? request.postDataJSON() : null;
        } catch {
            jsonBody = null;
        }

        const key = resolveRouteKey(method, suffix);
        if (key === null) {
            return handleAuxiliary(route, method, suffix, respondJson);
        }

        const delay = store.getDelay(key);
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

        store.requests.push({ key, method, url: request.url(), query, body: jsonBody });

        const fault = store.takeFault(key);
        if (fault) return respondJson(fault.status, fault.body ?? {});

        switch (key) {
            case 'tree':
                return respondJson(200, {
                    tree: store.tree,
                    notesRoot: store.notesRoot,
                    rootId: 'default',
                    systemFolders: store.systemFolders,
                });

            case 'content-get': {
                const notePath = query.path ?? '';
                if (!notePath) return respondJson(400, { error: 'Missing required query parameter: path' });
                if (!store.content.has(notePath)) return respondJson(404, { error: 'File not found' });
                return respondJson(200, {
                    content: store.content.get(notePath),
                    path: notePath,
                    mtime: store.mtime,
                });
            }

            case 'content-put': {
                const body = (jsonBody ?? {}) as { path?: string; content?: string };
                if (!body.path || typeof body.content !== 'string') {
                    return respondJson(400, { error: 'Missing required field: path/content' });
                }
                store.content.set(body.path, body.content);
                store.mtime += 1;
                return respondJson(200, { path: body.path, updated: true, mtime: store.mtime });
            }

            case 'page-post': {
                const body = (jsonBody ?? {}) as { path?: string; type?: NoteNodeType };
                if (!body.path || !body.type) {
                    return respondJson(400, { error: 'Missing required field: path/type' });
                }
                const effectivePath =
                    body.type === 'page' && !body.path.endsWith('.md') ? `${body.path}.md` : body.path;
                const node: NoteTreeNode = {
                    name: baseNameOf(effectivePath),
                    path: effectivePath,
                    type: body.type,
                    ...(body.type === 'page' ? {} : { children: [] }),
                };
                store.insertNode(parentOf(effectivePath), node);
                if (body.type === 'page') store.content.set(effectivePath, '');
                return respondJson(201, { path: effectivePath, type: body.type });
            }

            case 'path-patch': {
                const body = (jsonBody ?? {}) as { oldPath?: string; newPath?: string };
                if (!body.oldPath || !body.newPath) {
                    return respondJson(400, { error: 'Missing required field: oldPath/newPath' });
                }
                const isFile = store.content.has(body.oldPath) || body.oldPath.endsWith('.md');
                const effectiveNew =
                    isFile && !body.newPath.endsWith('.md') ? `${body.newPath}.md` : body.newPath;
                store.renameNode(body.oldPath, effectiveNew);
                return respondJson(200, {
                    oldPath: body.oldPath,
                    newPath: effectiveNew,
                    bindingsMoved: 0,
                });
            }

            case 'path-delete': {
                const notePath = query.path ?? '';
                if (!notePath) return respondJson(400, { error: 'Missing required query parameter: path' });
                store.removeNode(notePath);
                store.content.delete(notePath);
                return route.fulfill({ status: 204, body: '' });
            }

            case 'order-put': {
                const body = (jsonBody ?? {}) as { parentPath?: string; order?: string[] };
                return respondJson(200, { parentPath: body.parentPath ?? '', order: body.order ?? [] });
            }

            case 'search': {
                const q = query.q ?? '';
                if (!q) return respondJson(400, { error: 'Missing required query parameter: q' });
                return respondJson(200, { results: store.searchResults, truncated: false });
            }

            case 'image-post':
                // Deterministic path so specs can assert the inserted node's URL.
                return respondJson(201, { path: MOCK_UPLOADED_PDF_PATH, rootId: 'default' });

            case 'image-get':
                // Serve a tiny valid PDF for any requested attachment path so the
                // inline <iframe> resolves without a real file on disk.
                return route.fulfill({
                    status: 200,
                    contentType: 'application/pdf',
                    body: MOCK_PDF_BYTES,
                });
        }
    });
}

/** Map (method, `/notes` suffix) to a documented route key, or null. */
function resolveRouteKey(method: string, suffix: string): NotesRouteKey | null {
    if (suffix === '/tree' && method === 'GET') return 'tree';
    if (suffix === '/content' && method === 'GET') return 'content-get';
    if (suffix === '/content' && method === 'PUT') return 'content-put';
    if (suffix === '/page' && method === 'POST') return 'page-post';
    if (suffix === '/path' && method === 'PATCH') return 'path-patch';
    if (suffix === '/path' && method === 'DELETE') return 'path-delete';
    if (suffix === '/order' && method === 'PUT') return 'order-put';
    if (suffix === '/search' && method === 'GET') return 'search';
    if (suffix === '/image' && method === 'POST') return 'image-post';
    if (suffix === '/image' && method === 'GET') return 'image-get';
    return null;
}

/**
 * Serve hermetic defaults for the auxiliary notes GETs the page fires on load,
 * so the mock does not depend on the real server's (empty) notes directory.
 * Anything else falls through to the real server.
 */
function handleAuxiliary(
    route: import('@playwright/test').Route,
    method: string,
    suffix: string,
    respondJson: (status: number, body: unknown) => Promise<void>,
): Promise<void> {
    if (method === 'GET' && suffix === '/roots') {
        return respondJson(200, {
            roots: [{ rootId: 'default', label: 'Notes', isDefault: true }],
            maxAdditionalRoots: 5,
        });
    }
    if (method === 'GET' && suffix === '/git/status') {
        return respondJson(200, {
            initialized: false,
            branch: '',
            clean: true,
            staged: [],
            unstaged: [],
            untracked: [],
            totalChanges: 0,
        });
    }
    if (method === 'GET' && suffix === '/comments') {
        return respondJson(200, { threads: {} });
    }
    return route.continue();
}
