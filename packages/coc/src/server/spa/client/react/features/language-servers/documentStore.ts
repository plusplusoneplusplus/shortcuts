/**
 * Authoritative browser-side document buffers for language support (AC-02).
 *
 * This layer sits directly on `languageServerClient.ts`. The transport below it
 * knows about sockets, attachments and request ids; this module knows about
 * text, versions and the `didOpen`/`didChange`/`didSave`/`didClose` ordering the
 * LSP requires. Monaco sits above it and never talks to the transport directly.
 *
 * The rules that shape the design:
 *   - One buffer and one version sequence per open document in a concrete
 *     clone, no matter how many views show it. Two views of the same clone's
 *     file in the Explorer and the right panel share this record; same-id
 *     clones on different hosts do not.
 *   - Versions only ever increase, including across a reconnect. A server that
 *     sees a replayed `didOpen` gets a version higher than anything it saw on
 *     the previous connection, so a late reply from the old session can always
 *     be told apart by version.
 *   - Replay is complete text, never a queued incremental edit. `onAttached`
 *     fires whenever the attachment is new (first attach, socket drop, config
 *     change, host-side detach), and each time we send the whole current
 *     buffer. A crash restart keeps the attachment, so the second replay cue is
 *     the session state's `generation`: the host counts its handshakes, and a
 *     number we have not opened on means the server behind this document is a
 *     fresh process that knows nothing about it.
 *   - A dirty buffer is never overwritten by disk. `setDiskText` is how a
 *     file-watcher or a refresh hands us new bytes; it is refused while the
 *     user has unsaved edits, and the caller decides what to do about it.
 *
 * Isolation between browser windows is not enforced here — it comes from the
 * editing-session id in the transport's socket URL, which keys the host's
 * sessions. See `editingSession.ts`.
 */

import {
    getLanguageServerClient,
    LanguageServerClient,
    type LanguageServerAttachedInfo,
    type LanguageServerAttachment,
    type LanguageServerRequestOptions,
    type LanguageServerSessionStateView,
    type LanguageServerUnavailableInfo,
} from './languageServerClient';

// ============================================================================
// LSP shapes this layer needs
// ============================================================================

export interface LspPosition {
    /** Zero-based, unlike Monaco. */
    line: number;
    character: number;
}

export interface LspRange {
    start: LspPosition;
    end: LspPosition;
}

export interface LspDiagnostic {
    range: LspRange;
    severity?: number;
    code?: string | number;
    source?: string;
    message: string;
    [key: string]: unknown;
}

/**
 * One edit in LSP coordinates. Omit `range` for a whole-document replacement;
 * that is also what we fall back to when the server only supports full sync.
 */
export interface DocumentContentChange {
    range?: LspRange;
    rangeLength?: number;
    text: string;
}

/** 0 none, 1 full, 2 incremental — the LSP `TextDocumentSyncKind` values. */
export type DocumentSyncKind = 0 | 1 | 2;

export interface DocumentSyncOptions {
    change: DocumentSyncKind;
    /** Server asked for the text on save. */
    includeTextOnSave: boolean;
    openClose: boolean;
}

const DEFAULT_SYNC: DocumentSyncOptions = { change: 1, includeTextOnSave: false, openClose: true };

/**
 * Reads the negotiated synchronization mode out of the server's advertised
 * capabilities. Both the shorthand number form and the options-object form are
 * in the wild, so both are handled; anything unrecognizable falls back to full
 * sync, which every server that syncs at all accepts.
 */
export function readSyncOptions(state: LanguageServerSessionStateView | null | undefined): DocumentSyncOptions {
    const capabilities = state?.capabilities as Record<string, unknown> | undefined;
    const sync = capabilities?.textDocumentSync;
    if (typeof sync === 'number') {
        return {
            change: normalizeSyncKind(sync),
            includeTextOnSave: false,
            openClose: sync !== 0,
        };
    }
    if (sync && typeof sync === 'object') {
        const options = sync as { change?: unknown; openClose?: unknown; save?: unknown };
        const save = options.save;
        return {
            change: normalizeSyncKind(options.change),
            includeTextOnSave:
                typeof save === 'object' && save !== null
                    ? (save as { includeText?: unknown }).includeText === true
                    : false,
            openClose: options.openClose !== false,
        };
    }
    return DEFAULT_SYNC;
}

function normalizeSyncKind(value: unknown): DocumentSyncKind {
    return value === 0 || value === 1 || value === 2 ? value : 1;
}

// ============================================================================
// Public surface
// ============================================================================

export type LanguageDocumentStatus =
    /** No host session yet, or the previous one went away. */
    | 'detached'
    /** Attached and synchronized; language requests are meaningful. */
    | 'ready'
    /** The host refused language support for this document. */
    | 'unavailable';

export interface LanguageDocumentSnapshot {
    uri: string;
    path: string;
    version: number;
    text: string;
    dirty: boolean;
    status: LanguageDocumentStatus;
    languageId: string | null;
    displayName: string | null;
    unavailable: LanguageServerUnavailableInfo | null;
    state: LanguageServerSessionStateView | null;
}

/**
 * One view's handle on a shared document. Every mutating call goes through the
 * shared record, so two handles on the same file cannot diverge.
 */
export interface LanguageDocumentView {
    readonly path: string;
    readonly uri: string;
    getText(): string;
    getVersion(): number;
    isDirty(): boolean;
    getStatus(): LanguageDocumentStatus;
    getSnapshot(): LanguageDocumentSnapshot;
    getDiagnostics(): LspDiagnostic[];
    /** Language support is available and the buffer is synchronized. */
    isReady(): boolean;

    /** Records an edit and forwards it, incrementally when the server allows. */
    update(text: string, changes?: DocumentContentChange[]): void;
    /** Call after the disk write succeeded — never before. */
    markSaved(text?: string): void;
    /**
     * New bytes from disk. Refused (returns false) while the buffer is dirty,
     * so an external change can never discard the user's unsaved work.
     */
    setDiskText(text: string): boolean;

    /** Sends an LSP request for this document once it is attached. */
    sendRequest<T = unknown>(method: string, params?: unknown, options?: LanguageServerRequestOptions): Promise<T>;
    /** `{ textDocument: { uri }, position }` with the URI filled in. */
    documentParams<T extends Record<string, unknown>>(params?: T): T & { textDocument: { uri: string } };

    onDiagnostics(listener: (diagnostics: LspDiagnostic[]) => void): () => void;
    onText(listener: (text: string, version: number) => void): () => void;
    onStatus(listener: (snapshot: LanguageDocumentSnapshot) => void): () => void;
    /** Fires after each replay, i.e. whenever a fresh host session is ready. */
    onSynchronized(listener: (info: LanguageServerAttachedInfo) => void): () => void;

    /**
     * The user's retry, handed straight to the transport. The buffer is not
     * touched: whatever comes back gets the current text replayed into it, so
     * unsaved work survives a restart the same way it survives a crash.
     */
    restart(): void;

    /** Releases this view. The document closes when the last view goes. */
    close(): void;
}

export interface OpenDocumentOptions {
    path: string;
    /** The buffer's current content, including unsaved edits. */
    text: string;
    /**
     * Monaco's language id for this file. Only used when the host cannot tell
     * us the LSP language id, which happens when language support is off.
     */
    fallbackLanguageId?: string;
    /** Opening an already-dirty buffer, e.g. restoring a tab. */
    dirty?: boolean;
}

export interface LanguageDocumentStoreOptions {
    workspaceId: string;
    /** Concrete clone identity for transport routing; `null` pins page origin. */
    routingRef?: string | null;
    /** Injected in tests; defaults to the cached per-clone client. */
    client?: LanguageServerClient;
}

interface DocumentRecord {
    path: string;
    uri: string;
    text: string;
    version: number;
    dirty: boolean;
    refCount: number;
    closed: boolean;
    /** True once `didOpen` went out on the current connection. */
    opened: boolean;
    /**
     * Host handshake count the current `didOpen` was sent on, or null when the
     * server has not handshaken yet. Compared against every status update to
     * decide whether a replay is due.
     */
    openedGeneration: number | null;
    sync: DocumentSyncOptions;
    attachment: LanguageServerAttachment;
    info: LanguageServerAttachedInfo | null;
    unavailable: LanguageServerUnavailableInfo | null;
    state: LanguageServerSessionStateView | null;
    languageId: string | null;
    fallbackLanguageId: string | null;
    diagnostics: LspDiagnostic[];
    subscriptions: Array<() => void>;
    diagnosticListeners: Set<(diagnostics: LspDiagnostic[]) => void>;
    textListeners: Set<(text: string, version: number) => void>;
    statusListeners: Set<(snapshot: LanguageDocumentSnapshot) => void>;
    synchronizedListeners: Set<(info: LanguageServerAttachedInfo) => void>;
}

/**
 * Every open document for one workspace in one browser tab. The store owns the
 * buffers; the transport client underneath owns the socket.
 */
export class LanguageDocumentStore {
    readonly workspaceId: string;
    readonly routingRef: string | null;

    private readonly client: LanguageServerClient;
    private readonly documents = new Map<string, DocumentRecord>();
    private disposed = false;

    constructor(options: LanguageDocumentStoreOptions) {
        this.workspaceId = options.workspaceId;
        this.routingRef = options.routingRef === undefined ? options.workspaceId : options.routingRef;
        this.client = options.client
            ?? getLanguageServerClient(options.workspaceId, undefined, this.routingRef);
    }

    /** Number of open documents; a view count would be higher. */
    get documentCount(): number {
        return this.documents.size;
    }

    /**
     * Opens `path`, or attaches another view to the document already open at
     * that path. The first caller's `text` wins: a second view joins the
     * authoritative buffer rather than resetting it to whatever it read from
     * disk, which is what keeps an unsaved edit visible in both views.
     */
    open(options: OpenDocumentOptions): LanguageDocumentView {
        if (this.disposed) {
            throw new Error('LanguageDocumentStore has been disposed');
        }
        const path = normalizePath(options.path);
        let record = this.documents.get(path);
        if (!record) {
            record = this.createRecord(path, options);
            this.documents.set(path, record);
        }
        record.refCount += 1;
        return this.createView(record);
    }

    /** The open document at `path`, if any. Does not take a reference. */
    peek(path: string): LanguageDocumentSnapshot | null {
        const record = this.documents.get(normalizePath(path));
        return record ? snapshotOf(record) : null;
    }

    /** Closes every document and drops the transport attachments. */
    dispose(): void {
        this.disposed = true;
        for (const [, record] of [...this.documents]) {
            this.teardown(record);
        }
        this.documents.clear();
    }

    // ========================================================================
    // Record lifecycle
    // ========================================================================

    private createRecord(path: string, options: OpenDocumentOptions): DocumentRecord {
        const attachment = this.client.attach(path);
        const record: DocumentRecord = {
            path,
            uri: browserDocumentUri(this.workspaceId, path),
            text: options.text,
            version: 0,
            dirty: options.dirty === true,
            refCount: 0,
            closed: false,
            opened: false,
            openedGeneration: null,
            sync: DEFAULT_SYNC,
            attachment,
            info: null,
            unavailable: attachment.getUnavailable(),
            state: null,
            languageId: null,
            fallbackLanguageId: options.fallbackLanguageId ?? null,
            diagnostics: [],
            subscriptions: [],
            diagnosticListeners: new Set(),
            textListeners: new Set(),
            statusListeners: new Set(),
            synchronizedListeners: new Set(),
        };

        record.subscriptions.push(
            attachment.onAttached((info) => {
                this.handleAttached(record, info);
            }),
            attachment.onDetached(() => {
                // The host's copy is gone. Drop the derived state but keep the
                // buffer: the user's unsaved text is the whole point.
                record.opened = false;
                record.openedGeneration = null;
                record.info = null;
                this.setDiagnostics(record, []);
                this.emitStatus(record);
            }),
            attachment.onUnavailable((info) => {
                record.opened = false;
                record.openedGeneration = null;
                record.info = null;
                record.unavailable = info;
                this.setDiagnostics(record, []);
                this.emitStatus(record);
            }),
            attachment.onNotification((method, params) => {
                this.handleNotification(record, method, params);
            }),
            attachment.onStatus((state) => {
                record.state = state;
                if (this.shouldReplay(record, state)) {
                    // A restart, a crash recovery or a lazily started server:
                    // the attachment is the same but the process behind it has
                    // never seen this document.
                    this.replay(record, state);
                    return;
                }
                this.emitStatus(record);
            }),
        );

        // An attachment can already be live when a second document opens on a
        // session that is up, so do not wait for the next `onAttached`.
        const existing = attachment.getInfo();
        if (existing) {
            this.handleAttached(record, existing);
        }
        return record;
    }

    /** A new attachment: the host session behind it has never seen this file. */
    private handleAttached(record: DocumentRecord, info: LanguageServerAttachedInfo): void {
        record.info = info;
        record.unavailable = null;
        record.state = info.state;
        record.languageId = info.languageId;
        this.replay(record, info.state);
    }

    /**
     * Sends the whole current buffer, so a server that knows nothing about this
     * document ends up holding exactly what the user is looking at. Always full
     * text at a higher version than anything the previous process saw, which is
     * what lets a late reply from that process be told apart.
     */
    private replay(record: DocumentRecord, state: LanguageServerSessionStateView | null): void {
        const info = record.info;
        if (!info) {
            return;
        }
        record.sync = readSyncOptions(state);
        record.opened = false;
        record.openedGeneration = readyGeneration(state);
        this.setDiagnostics(record, []);

        if (record.sync.openClose) {
            record.version += 1;
            record.attachment.sendNotification('textDocument/didOpen', {
                textDocument: {
                    uri: record.uri,
                    languageId: info.languageId || record.fallbackLanguageId || 'plaintext',
                    version: record.version,
                    text: record.text,
                },
            });
        }
        record.opened = true;
        this.emitStatus(record);
        for (const listener of [...record.synchronizedListeners]) {
            listener(info);
        }
    }

    /**
     * True when the status update names a host handshake this document has not
     * opened on. That covers the lazily started server, whose first handshake
     * happens after the attachment exists, and the crash restart, which leaves
     * the attachment in place while replacing the process behind it.
     */
    private shouldReplay(record: DocumentRecord, state: LanguageServerSessionStateView): boolean {
        if (record.closed || !record.info) {
            return false;
        }
        const generation = readyGeneration(state);
        return generation !== null && generation !== record.openedGeneration;
    }

    private handleNotification(record: DocumentRecord, method: string, params: unknown): void {
        if (method !== 'textDocument/publishDiagnostics') {
            return;
        }
        const payload = params as { uri?: unknown; version?: unknown; diagnostics?: unknown } | undefined;
        if (!payload || payload.uri !== record.uri) {
            // Diagnostics are session-wide; another document's results arrive
            // here too and belong to that document's record.
            return;
        }
        if (typeof payload.version === 'number' && payload.version < record.version) {
            // Results for text the user has already replaced.
            return;
        }
        this.setDiagnostics(record, Array.isArray(payload.diagnostics) ? (payload.diagnostics as LspDiagnostic[]) : []);
    }

    private setDiagnostics(record: DocumentRecord, diagnostics: LspDiagnostic[]): void {
        if (record.diagnostics.length === 0 && diagnostics.length === 0) {
            return;
        }
        record.diagnostics = diagnostics;
        for (const listener of [...record.diagnosticListeners]) {
            listener(diagnostics);
        }
    }

    private emitStatus(record: DocumentRecord): void {
        const snapshot = snapshotOf(record);
        for (const listener of [...record.statusListeners]) {
            listener(snapshot);
        }
    }

    // ========================================================================
    // Buffer mutations
    // ========================================================================

    private update(record: DocumentRecord, text: string, changes?: DocumentContentChange[]): void {
        if (record.closed || text === record.text) {
            return;
        }
        record.text = text;
        record.dirty = true;
        record.version += 1;
        if (record.opened && record.sync.change !== 0) {
            record.attachment.sendNotification('textDocument/didChange', {
                textDocument: { uri: record.uri, version: record.version },
                contentChanges: this.contentChangesFor(record, text, changes),
            });
        }
        for (const listener of [...record.textListeners]) {
            listener(text, record.version);
        }
    }

    private contentChangesFor(
        record: DocumentRecord,
        text: string,
        changes?: DocumentContentChange[],
    ): DocumentContentChange[] {
        if (record.sync.change === 2 && changes && changes.length > 0 && changes.every((change) => change.range)) {
            return changes;
        }
        return [{ text }];
    }

    private markSaved(record: DocumentRecord, text?: string): void {
        if (record.closed) {
            return;
        }
        if (typeof text === 'string' && text !== record.text) {
            // A formatter or the writer changed the bytes on the way to disk.
            this.update(record, text);
        }
        record.dirty = false;
        if (record.opened) {
            record.attachment.sendNotification('textDocument/didSave', {
                textDocument: { uri: record.uri },
                ...(record.sync.includeTextOnSave ? { text: record.text } : {}),
            });
        }
        this.emitStatus(record);
    }

    private setDiskText(record: DocumentRecord, text: string): boolean {
        if (record.closed || record.dirty) {
            return false;
        }
        if (text === record.text) {
            return true;
        }
        this.update(record, text);
        record.dirty = false;
        this.emitStatus(record);
        return true;
    }

    // ========================================================================
    // Views
    // ========================================================================

    private createView(record: DocumentRecord): LanguageDocumentView {
        let live = true;
        const store = this;
        return {
            path: record.path,
            uri: record.uri,
            getText: () => record.text,
            getVersion: () => record.version,
            isDirty: () => record.dirty,
            getStatus: () => statusOf(record),
            getSnapshot: () => snapshotOf(record),
            getDiagnostics: () => record.diagnostics,
            isReady: () => statusOf(record) === 'ready',
            update: (text, changes) => {
                store.update(record, text, changes);
            },
            markSaved: (text) => {
                store.markSaved(record, text);
            },
            setDiskText: (text) => store.setDiskText(record, text),
            sendRequest: <T>(method: string, params?: unknown, options?: LanguageServerRequestOptions) =>
                record.attachment.sendRequest<T>(method, params, options),
            documentParams: <T extends Record<string, unknown>>(params?: T) =>
                ({ ...(params ?? ({} as T)), textDocument: { uri: record.uri } }) as T & {
                    textDocument: { uri: string };
                },
            onDiagnostics: (listener) => subscribe(record.diagnosticListeners, listener),
            onText: (listener) => subscribe(record.textListeners, listener),
            onStatus: (listener) => subscribe(record.statusListeners, listener),
            onSynchronized: (listener) => subscribe(record.synchronizedListeners, listener),
            restart: () => {
                if (record.closed) {
                    return;
                }
                record.attachment.restart();
            },
            close: () => {
                if (!live) {
                    return;
                }
                live = false;
                store.releaseView(record);
            },
        };
    }

    private releaseView(record: DocumentRecord): void {
        record.refCount -= 1;
        if (record.refCount > 0) {
            return;
        }
        this.documents.delete(record.path);
        this.teardown(record);
    }

    /** `didClose` first, then the transport reference — that order matters. */
    private teardown(record: DocumentRecord): void {
        if (record.closed) {
            return;
        }
        record.closed = true;
        if (record.opened && record.sync.openClose) {
            record.attachment.sendNotification('textDocument/didClose', {
                textDocument: { uri: record.uri },
            });
        }
        record.opened = false;
        for (const unsubscribe of record.subscriptions) {
            unsubscribe();
        }
        record.subscriptions = [];
        record.attachment.release();
        record.diagnosticListeners.clear();
        record.textListeners.clear();
        record.statusListeners.clear();
        record.synchronizedListeners.clear();
    }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * The host's handshake counter, but only once the session actually reports
 * `ready` — a `starting` state carries the previous process's number, and
 * replaying into a server that is not up would drop the buffer again.
 */
function readyGeneration(state: LanguageServerSessionStateView | null | undefined): number | null {
    if (!state || state.status !== 'ready' || typeof state.generation !== 'number') {
        return null;
    }
    return state.generation;
}

function statusOf(record: DocumentRecord): LanguageDocumentStatus {
    if (record.info && record.opened) {
        return 'ready';
    }
    return record.unavailable ? 'unavailable' : 'detached';
}

function snapshotOf(record: DocumentRecord): LanguageDocumentSnapshot {
    return {
        uri: record.uri,
        path: record.path,
        version: record.version,
        text: record.text,
        dirty: record.dirty,
        status: statusOf(record),
        languageId: record.languageId ?? record.fallbackLanguageId,
        displayName: record.info?.displayName ?? null,
        unavailable: record.unavailable,
        state: record.state,
    };
}

function subscribe<T>(set: Set<T>, listener: T): () => void {
    set.add(listener);
    return () => {
        set.delete(listener);
    };
}

function normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * Mirror of the host's `browserDocumentUri`. Keep the two in step: the bridge
 * refuses any URI it cannot map back into the workspace.
 */
export function browserDocumentUri(workspaceId: string, relativePath: string): string {
    const segments = normalizePath(relativePath)
        .split('/')
        .filter((segment) => segment.length > 0)
        .map((segment) => encodeURIComponent(segment));
    return `coc-file://${encodeURIComponent(workspaceId)}/${segments.join('/')}`;
}

/**
 * The inverse of `browserDocumentUri`, for a URI that came back from a language
 * server (a definition or reference target). Returns `null` for anything that is
 * not a live repo document in this scheme — a `file:` dependency, another
 * scheme, an empty workspace or path, or percent-encoding that will not decode.
 * That refusal is what keeps navigation inside the workspace.
 */
export function parseBrowserDocumentUri(uri: string): { workspaceId: string; path: string } | null {
    const match = /^coc-file:\/\/([^/?#]+)\/([^?#]*)/.exec(uri);
    if (!match) return null;
    try {
        const workspaceId = decodeURIComponent(match[1]);
        const path = match[2]
            .split('/')
            .filter((segment) => segment.length > 0)
            .map((segment) => decodeURIComponent(segment))
            .join('/');
        if (workspaceId === '' || path === '') return null;
        return { workspaceId, path };
    } catch {
        return null;
    }
}

// ============================================================================
// Per-clone cache
// ============================================================================

const stores = new Map<string, LanguageDocumentStore>();

/** One store per concrete clone in this tab, matching the transport's own cache. */
export function getLanguageDocumentStore(
    workspaceId: string,
    routingRef?: string | null,
): LanguageDocumentStore {
    const resolvedRoutingRef = routingRef === undefined ? workspaceId : routingRef;
    const key = `${workspaceId}\u0000${resolvedRoutingRef ?? '<local>'}`;
    let store = stores.get(key);
    if (!store) {
        store = new LanguageDocumentStore({ workspaceId, routingRef: resolvedRoutingRef });
        stores.set(key, store);
    }
    return store;
}

export function resetLanguageDocumentStoresForTests(): void {
    for (const [, store] of stores) {
        store.dispose();
    }
    stores.clear();
}
