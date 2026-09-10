/**
 * Browser half of the language-server transport.
 *
 * Speaks the `/ws/language-server` message shape defined by the host bridge
 * (`packages/coc/src/server/language-servers/ws-bridge.ts`). One client owns one
 * socket for one (workspace, editing session) pair and multiplexes every open
 * document over it.
 *
 * What lives here and what does not:
 *   - Here: socket lifecycle, reconnect with backoff, attach bookkeeping,
 *     request/response correlation, cancellation, notification fan-out.
 *   - Not here: document buffers, versions, Monaco, or anything TypeScript.
 *     The document layer sits on top and uses `onAttached` as its replay hook.
 *
 * Reconnect is the interesting part. A dropped socket, a server-side session
 * replacement (config change, eviction, crash) or a workspace removal all
 * surface the same way: the attachment is re-attached and `onAttached` fires
 * again. The document layer must then resend the complete current buffer,
 * because the host's copy is gone. For that reason notifications sent while an
 * attachment is not live are DROPPED rather than queued — replaying a stale
 * incremental edit on top of a fresh replay would corrupt the server's copy.
 */

import { getWsPath } from '../../utils/config';
import { cloneWsUrlForWorkspace } from '../../repos/cloneRegistry';
import { getEditingSessionId } from './editingSession';

// ============================================================================
// Wire protocol (mirror of the server's ws-bridge types)
// ============================================================================

/** Subset of the host's session state the browser reads. */
export interface LanguageServerSessionStateView {
    status: 'disabled' | 'unavailable' | 'starting' | 'ready' | 'reconnecting' | 'failed';
    definitionId: string;
    displayName: string;
    detail?: string;
    serverName?: string;
    serverVersion?: string;
    restarts?: number;
    /**
     * Counts the host session's successful handshakes. A change means the
     * server behind this document is new and knows nothing, so the document
     * layer replays its buffer. Absent from a host that predates the field.
     */
    generation?: number;
    [key: string]: unknown;
}

export interface LanguageServerAttachedInfo {
    attachmentId: string;
    sessionKey: string;
    documentUri: string;
    languageId: string;
    definitionId: string;
    displayName: string;
    state: LanguageServerSessionStateView;
}

export interface LanguageServerUnavailableInfo {
    reason: string;
    detail: string;
}

type ServerMessage =
    | { type: 'lsp-welcome'; clientId: string; workspaceId: string; editingSessionId: string }
    | ({ type: 'lsp-attached'; requestId: string } & LanguageServerAttachedInfo)
    | ({ type: 'lsp-unavailable'; requestId: string } & LanguageServerUnavailableInfo)
    | { type: 'lsp-response'; attachmentId: string; id: string; result?: unknown; error?: { code: string; message: string } }
    | { type: 'lsp-notification'; sessionKey: string; method: string; params?: unknown }
    | { type: 'lsp-status'; sessionKey: string; state: LanguageServerSessionStateView }
    | { type: 'lsp-detached'; attachmentId: string; reason: string }
    | { type: 'lsp-error'; message: string }
    | { type: 'pong' };

// ============================================================================
// Public surface
// ============================================================================

export type LanguageServerConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed';

export class LanguageServerClientError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'LanguageServerClientError';
        this.code = code;
    }
}

export interface LanguageServerRequestOptions {
    signal?: AbortSignal;
    /** How long to wait for the attachment to go live before failing. */
    attachTimeoutMs?: number;
}

/** One document's live handle on the transport. */
export interface LanguageServerAttachment {
    readonly path: string;
    /** Live attachment details, or `null` while attaching or unavailable. */
    getInfo(): LanguageServerAttachedInfo | null;
    /** Why the host refused this document, if it did. */
    getUnavailable(): LanguageServerUnavailableInfo | null;
    /** Fires on every successful attach, including re-attach after a drop. */
    onAttached(listener: (info: LanguageServerAttachedInfo) => void): () => void;
    /** Fires when the host drops the attachment; a re-attach follows. */
    onDetached(listener: (reason: string) => void): () => void;
    onUnavailable(listener: (info: LanguageServerUnavailableInfo) => void): () => void;
    /** Session-wide server notifications (diagnostics, log messages, progress). */
    onNotification(listener: (method: string, params: unknown) => void): () => void;
    onStatus(listener: (state: LanguageServerSessionStateView) => void): () => void;
    sendRequest<T = unknown>(method: string, params?: unknown, options?: LanguageServerRequestOptions): Promise<T>;
    /** Dropped when the attachment is not live; the next attach replays instead. */
    sendNotification(method: string, params?: unknown): void;
    /** Releases this view. The host session is freed when the last view goes. */
    release(): void;
}

export interface SocketLike {
    readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    onopen: ((event: unknown) => void) | null;
    onmessage: ((event: { data: unknown }) => void) | null;
    onclose: ((event: unknown) => void) | null;
    onerror: ((event: unknown) => void) | null;
}

export interface LanguageServerClientOptions {
    workspaceId: string;
    editingSessionId?: string;
    /** Injected in tests; defaults to a real `WebSocket` at the owning host. */
    createSocket?: (url: string) => SocketLike;
    reconnectDelayMs?: number;
    maxReconnectDelayMs?: number;
    pingIntervalMs?: number;
    /** Default wait for an attachment to go live inside `sendRequest`. */
    attachTimeoutMs?: number;
}

const OPEN = 1;

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    generation: number;
    cleanup: () => void;
}

interface AttachWaiter {
    resolve: () => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout> | null;
}

interface AttachmentRecord {
    localId: string;
    path: string;
    refCount: number;
    released: boolean;
    attachRequestId: string | null;
    info: LanguageServerAttachedInfo | null;
    unavailable: LanguageServerUnavailableInfo | null;
    pending: Set<string>;
    waiters: Set<AttachWaiter>;
    attachedListeners: Set<(info: LanguageServerAttachedInfo) => void>;
    detachedListeners: Set<(reason: string) => void>;
    unavailableListeners: Set<(info: LanguageServerUnavailableInfo) => void>;
    notificationListeners: Set<(method: string, params: unknown) => void>;
    statusListeners: Set<(state: LanguageServerSessionStateView) => void>;
}

/**
 * One socket per (workspace, editing session). Created lazily on the first
 * `attach` and torn down when the last attachment is released.
 */
export class LanguageServerClient {
    readonly workspaceId: string;
    readonly editingSessionId: string;

    private readonly createSocket: (url: string) => SocketLike;
    private readonly reconnectDelayMs: number;
    private readonly maxReconnectDelayMs: number;
    private readonly pingIntervalMs: number;
    private readonly attachTimeoutMs: number;

    private socket: SocketLike | null = null;
    private status: LanguageServerConnectionStatus = 'idle';
    private generation = 0;
    private requestCounter = 0;
    private localCounter = 0;
    private reconnectDelay: number;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private pingTimer: ReturnType<typeof setInterval> | null = null;
    private disposed = false;

    private readonly attachments = new Map<string, AttachmentRecord>();
    private readonly byAttachmentId = new Map<string, AttachmentRecord>();
    private readonly byAttachRequest = new Map<string, AttachmentRecord>();
    private readonly pendingRequests = new Map<string, PendingRequest>();
    private readonly connectionListeners = new Set<(status: LanguageServerConnectionStatus) => void>();

    constructor(options: LanguageServerClientOptions) {
        this.workspaceId = options.workspaceId;
        this.editingSessionId = options.editingSessionId ?? getEditingSessionId();
        this.createSocket = options.createSocket ?? defaultCreateSocket;
        this.reconnectDelayMs = options.reconnectDelayMs ?? 1000;
        this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30_000;
        this.pingIntervalMs = options.pingIntervalMs ?? 30_000;
        this.attachTimeoutMs = options.attachTimeoutMs ?? 10_000;
        this.reconnectDelay = this.reconnectDelayMs;
    }

    getStatus(): LanguageServerConnectionStatus {
        return this.status;
    }

    onConnectionStatus(listener: (status: LanguageServerConnectionStatus) => void): () => void {
        this.connectionListeners.add(listener);
        return () => {
            this.connectionListeners.delete(listener);
        };
    }

    /** Number of live document attachments; drives the idle teardown. */
    get attachmentCount(): number {
        return this.attachments.size;
    }

    /**
     * Attach one view of `path`. Views of the same path share one host
     * attachment, so the host holds a single session reference per document.
     */
    attach(path: string): LanguageServerAttachment {
        if (this.disposed) {
            throw new Error('LanguageServerClient has been disposed');
        }
        const normalized = normalizePath(path);
        let record = this.findByPath(normalized);
        if (!record) {
            record = {
                localId: `doc-${++this.localCounter}`,
                path: normalized,
                refCount: 0,
                released: false,
                attachRequestId: null,
                info: null,
                unavailable: null,
                pending: new Set(),
                waiters: new Set(),
                attachedListeners: new Set(),
                detachedListeners: new Set(),
                unavailableListeners: new Set(),
                notificationListeners: new Set(),
                statusListeners: new Set(),
            };
            this.attachments.set(record.localId, record);
            this.connect();
            if (this.status === 'open') {
                this.sendAttach(record);
            }
        }
        record.refCount += 1;
        return this.createHandle(record);
    }

    /** Drops every attachment and the socket. The client is unusable after. */
    dispose(): void {
        this.disposed = true;
        for (const [, record] of this.attachments) {
            record.released = true;
            this.failWaiters(record, new LanguageServerClientError('released', 'Language client disposed'));
        }
        this.attachments.clear();
        this.byAttachmentId.clear();
        this.byAttachRequest.clear();
        this.closeSocket('disposed');
        this.connectionListeners.clear();
    }

    // ========================================================================
    // Socket lifecycle
    // ========================================================================

    private connect(): void {
        if (this.disposed || this.socket || this.status === 'connecting') {
            return;
        }
        this.clearReconnectTimer();
        const path = `${getWsPath()}/language-server`
            + `?workspaceId=${encodeURIComponent(this.workspaceId)}`
            + `&editingSessionId=${encodeURIComponent(this.editingSessionId)}`;
        const url = cloneWsUrlForWorkspace(path, this.workspaceId);
        this.setStatus('connecting');

        let socket: SocketLike;
        try {
            socket = this.createSocket(url);
        } catch {
            this.setStatus('closed');
            this.scheduleReconnect();
            return;
        }
        this.socket = socket;

        socket.onopen = () => {
            if (this.socket !== socket) {
                return;
            }
            this.generation += 1;
            this.reconnectDelay = this.reconnectDelayMs;
            this.setStatus('open');
            for (const [, record] of this.attachments) {
                this.sendAttach(record);
            }
            this.startPing(socket);
        };
        socket.onmessage = (event) => {
            if (this.socket !== socket) {
                return;
            }
            let message: ServerMessage;
            try {
                message = JSON.parse(String(event.data));
            } catch {
                return;
            }
            this.handleMessage(message);
        };
        socket.onclose = () => {
            if (this.socket !== socket) {
                return;
            }
            this.socket = null;
            this.stopPing();
            this.onDisconnected();
        };
        socket.onerror = () => {
            /* onclose does the work */
        };
    }

    private onDisconnected(): void {
        this.setStatus('closed');
        // A dropped socket invalidates every host-side attachment id and every
        // in-flight request: the ids belonged to that connection alone.
        this.byAttachmentId.clear();
        this.byAttachRequest.clear();
        for (const [, record] of this.attachments) {
            const wasAttached = record.info !== null;
            record.info = null;
            record.attachRequestId = null;
            record.pending.clear();
            if (wasAttached) {
                emit(record.detachedListeners, 'connection-lost');
            }
        }
        this.rejectAllPending(new LanguageServerClientError('disconnected', 'Language-server connection lost'));
        if (!this.disposed && this.attachments.size > 0) {
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect(): void {
        if (this.disposed || this.reconnectTimer || this.attachments.size === 0) {
            return;
        }
        const delay = this.reconnectDelay;
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelayMs);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    private startPing(socket: SocketLike): void {
        this.stopPing();
        this.pingTimer = setInterval(() => {
            if (socket.readyState === OPEN) {
                socket.send(JSON.stringify({ type: 'ping' }));
            }
        }, this.pingIntervalMs);
    }

    private stopPing(): void {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
    }

    private closeSocket(reason: string): void {
        this.clearReconnectTimer();
        this.stopPing();
        const socket = this.socket;
        this.socket = null;
        this.byAttachmentId.clear();
        this.byAttachRequest.clear();
        this.rejectAllPending(
            new LanguageServerClientError('disconnected', `Language-server connection closed: ${reason}`),
        );
        if (socket) {
            try {
                socket.close(1000, reason);
            } catch {
                /* already gone */
            }
        }
        this.setStatus(this.disposed ? 'closed' : 'idle');
    }

    private setStatus(status: LanguageServerConnectionStatus): void {
        if (this.status === status) {
            return;
        }
        this.status = status;
        for (const listener of [...this.connectionListeners]) {
            listener(status);
        }
    }

    // ========================================================================
    // Messages
    // ========================================================================

    private handleMessage(message: ServerMessage): void {
        switch (message?.type) {
            case 'lsp-attached': {
                const record = this.byAttachRequest.get(message.requestId);
                this.byAttachRequest.delete(message.requestId);
                if (!record || record.released) {
                    // The view went away while the attach was in flight; do not
                    // leak the host's session reference.
                    this.send({ type: 'lsp-detach', attachmentId: message.attachmentId });
                    return;
                }
                const info: LanguageServerAttachedInfo = {
                    attachmentId: message.attachmentId,
                    sessionKey: message.sessionKey,
                    documentUri: message.documentUri,
                    languageId: message.languageId,
                    definitionId: message.definitionId,
                    displayName: message.displayName,
                    state: message.state,
                };
                record.info = info;
                record.unavailable = null;
                record.attachRequestId = null;
                this.byAttachmentId.set(info.attachmentId, record);
                this.resolveWaiters(record);
                emit(record.attachedListeners, info);
                return;
            }
            case 'lsp-unavailable': {
                const record = this.byAttachRequest.get(message.requestId);
                this.byAttachRequest.delete(message.requestId);
                if (!record) {
                    return;
                }
                const info: LanguageServerUnavailableInfo = { reason: message.reason, detail: message.detail };
                record.unavailable = info;
                record.info = null;
                record.attachRequestId = null;
                // Not a transport failure: retrying would spin. Settle waiters
                // so callers surface "language support unavailable" instead of
                // hanging until the attach timeout.
                this.failWaiters(record, new LanguageServerClientError(message.reason, message.detail));
                emit(record.unavailableListeners, info);
                return;
            }
            case 'lsp-response': {
                const pending = this.pendingRequests.get(message.id);
                if (!pending) {
                    return;
                }
                this.pendingRequests.delete(message.id);
                pending.cleanup();
                this.byAttachmentId.get(message.attachmentId)?.pending.delete(message.id);
                if (message.error) {
                    pending.reject(new LanguageServerClientError(message.error.code, message.error.message));
                } else {
                    pending.resolve(message.result);
                }
                return;
            }
            case 'lsp-notification': {
                for (const record of this.recordsForSession(message.sessionKey)) {
                    for (const listener of [...record.notificationListeners]) {
                        listener(message.method, message.params);
                    }
                }
                return;
            }
            case 'lsp-status': {
                for (const record of this.recordsForSession(message.sessionKey)) {
                    if (record.info) {
                        record.info = { ...record.info, state: message.state };
                    }
                    emit(record.statusListeners, message.state);
                }
                return;
            }
            case 'lsp-detached': {
                const record = this.byAttachmentId.get(message.attachmentId);
                if (!record) {
                    return;
                }
                this.byAttachmentId.delete(message.attachmentId);
                record.info = null;
                for (const id of record.pending) {
                    const pending = this.pendingRequests.get(id);
                    if (pending) {
                        this.pendingRequests.delete(id);
                        pending.cleanup();
                        pending.reject(
                            new LanguageServerClientError('disconnected', `Attachment detached: ${message.reason}`),
                        );
                    }
                }
                record.pending.clear();
                emit(record.detachedListeners, message.reason);
                if (!record.released && message.reason !== 'client-request') {
                    // The host replaced or lost the session. Re-attach so the
                    // document layer gets a fresh `onAttached` and replays.
                    this.sendAttach(record);
                }
                return;
            }
            default:
                return;
        }
    }

    private recordsForSession(sessionKey: string): AttachmentRecord[] {
        const matches: AttachmentRecord[] = [];
        for (const [, record] of this.attachments) {
            if (record.info?.sessionKey === sessionKey) {
                matches.push(record);
            }
        }
        return matches;
    }

    private sendAttach(record: AttachmentRecord): void {
        if (record.released || this.status !== 'open') {
            return;
        }
        const requestId = `attach-${this.generation}-${++this.requestCounter}`;
        record.attachRequestId = requestId;
        record.info = null;
        this.byAttachRequest.set(requestId, record);
        this.send({ type: 'lsp-attach', requestId, path: record.path });
    }

    private send(message: unknown): boolean {
        if (!this.socket || this.socket.readyState !== OPEN) {
            return false;
        }
        this.socket.send(JSON.stringify(message));
        return true;
    }

    private rejectAllPending(error: Error): void {
        for (const [, pending] of this.pendingRequests) {
            pending.cleanup();
            pending.reject(error);
        }
        this.pendingRequests.clear();
    }

    // ========================================================================
    // Attachment handle
    // ========================================================================

    private createHandle(record: AttachmentRecord): LanguageServerAttachment {
        let live = true;
        const client = this;
        return {
            path: record.path,
            getInfo: () => record.info,
            getUnavailable: () => record.unavailable,
            onAttached: (listener) => subscribe(record.attachedListeners, listener),
            onDetached: (listener) => subscribe(record.detachedListeners, listener),
            onUnavailable: (listener) => subscribe(record.unavailableListeners, listener),
            onNotification: (listener) => subscribe(record.notificationListeners, listener),
            onStatus: (listener) => subscribe(record.statusListeners, listener),
            sendRequest: <T>(method: string, params?: unknown, options?: LanguageServerRequestOptions) =>
                client.request(record, method, params, options) as Promise<T>,
            sendNotification: (method: string, params?: unknown) => {
                if (!record.info) {
                    return;
                }
                client.send({ type: 'lsp-notify', attachmentId: record.info.attachmentId, method, params });
            },
            release: () => {
                if (!live) {
                    return;
                }
                live = false;
                client.releaseRecord(record);
            },
        };
    }

    private releaseRecord(record: AttachmentRecord): void {
        record.refCount -= 1;
        if (record.refCount > 0) {
            return;
        }
        record.released = true;
        this.attachments.delete(record.localId);
        if (record.attachRequestId) {
            this.byAttachRequest.delete(record.attachRequestId);
            record.attachRequestId = null;
        }
        if (record.info) {
            this.byAttachmentId.delete(record.info.attachmentId);
            this.send({ type: 'lsp-detach', attachmentId: record.info.attachmentId });
            record.info = null;
        }
        this.failWaiters(record, new LanguageServerClientError('released', 'Document was closed'));
        for (const id of record.pending) {
            const pending = this.pendingRequests.get(id);
            if (pending) {
                this.pendingRequests.delete(id);
                pending.cleanup();
                pending.reject(new LanguageServerClientError('released', 'Document was closed'));
            }
        }
        record.pending.clear();
        if (this.attachments.size === 0) {
            this.closeSocket('no attached documents');
        }
    }

    private async request(
        record: AttachmentRecord,
        method: string,
        params: unknown,
        options?: LanguageServerRequestOptions,
    ): Promise<unknown> {
        if (record.released) {
            throw new LanguageServerClientError('released', 'Document was closed');
        }
        if (options?.signal?.aborted) {
            throw new LanguageServerClientError('cancelled', 'Request cancelled');
        }
        if (!record.info && record.unavailable && !record.attachRequestId) {
            // The host already refused this document. Waiting would only burn
            // the attach timeout before reporting the same thing.
            throw new LanguageServerClientError(record.unavailable.reason, record.unavailable.detail);
        }
        if (!record.info) {
            await this.waitForAttachment(record, options?.attachTimeoutMs ?? this.attachTimeoutMs, options?.signal);
        }
        const info = record.info;
        if (!info) {
            throw new LanguageServerClientError('not-attached', 'Language support is not attached to this document');
        }

        const id = `req-${this.generation}-${++this.requestCounter}`;
        const generation = this.generation;
        return new Promise((resolve, reject) => {
            const onAbort = () => {
                const pending = this.pendingRequests.get(id);
                if (!pending) {
                    return;
                }
                this.pendingRequests.delete(id);
                record.pending.delete(id);
                pending.cleanup();
                // Superseded queries must stop costing the host CPU.
                this.send({ type: 'lsp-cancel', attachmentId: info.attachmentId, id });
                reject(new LanguageServerClientError('cancelled', 'Request cancelled'));
            };
            const cleanup = () => {
                options?.signal?.removeEventListener('abort', onAbort);
            };
            options?.signal?.addEventListener('abort', onAbort);

            this.pendingRequests.set(id, { resolve, reject, generation, cleanup });
            record.pending.add(id);
            const sent = this.send({ type: 'lsp-request', attachmentId: info.attachmentId, id, method, params });
            if (!sent) {
                this.pendingRequests.delete(id);
                record.pending.delete(id);
                cleanup();
                reject(new LanguageServerClientError('disconnected', 'Language-server connection is not open'));
            }
        });
    }

    private waitForAttachment(record: AttachmentRecord, timeoutMs: number, signal?: AbortSignal): Promise<void> {
        return new Promise((resolve, reject) => {
            const finish = () => {
                record.waiters.delete(waiter);
                if (waiter.timer) {
                    clearTimeout(waiter.timer);
                    waiter.timer = null;
                }
                signal?.removeEventListener('abort', onAbort);
            };
            const waiter: AttachWaiter = {
                resolve: () => {
                    finish();
                    resolve();
                },
                reject: (err: Error) => {
                    finish();
                    reject(err);
                },
                timer: null,
            };
            const onAbort = () => waiter.reject(new LanguageServerClientError('cancelled', 'Request cancelled'));
            waiter.timer = setTimeout(() => {
                waiter.reject(
                    new LanguageServerClientError('timeout', 'Timed out waiting for the language server to attach'),
                );
            }, timeoutMs);
            record.waiters.add(waiter);
            signal?.addEventListener('abort', onAbort);
            if (record.info) {
                waiter.resolve();
            }
        });
    }

    private resolveWaiters(record: AttachmentRecord): void {
        for (const waiter of [...record.waiters]) {
            waiter.resolve();
        }
    }

    private failWaiters(record: AttachmentRecord, error: Error): void {
        for (const waiter of [...record.waiters]) {
            waiter.reject(error);
        }
    }

    private findByPath(path: string): AttachmentRecord | undefined {
        for (const [, record] of this.attachments) {
            if (record.path === path) {
                return record;
            }
        }
        return undefined;
    }
}

// ============================================================================
// Helpers and registry
// ============================================================================

function subscribe<T>(set: Set<T>, listener: T): () => void {
    set.add(listener);
    return () => {
        set.delete(listener);
    };
}

function emit<T>(listeners: Set<(value: T) => void>, value: T): void {
    for (const listener of [...listeners]) {
        listener(value);
    }
}

/** The bridge wants a workspace-relative POSIX path with no leading slash. */
function normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function defaultCreateSocket(url: string): SocketLike {
    return new WebSocket(url) as unknown as SocketLike;
}

const clientsByKey = new Map<string, LanguageServerClient>();

/**
 * One client per (workspace, editing session). Keying on the workspace is what
 * routes every document to its owning host, so a repo group's panel keeps
 * asking the right server after its dock target changes (AC-04).
 */
export function getLanguageServerClient(workspaceId: string, editingSessionId?: string): LanguageServerClient {
    const sessionId = editingSessionId ?? getEditingSessionId();
    const key = `${workspaceId} ${sessionId}`;
    let client = clientsByKey.get(key);
    if (!client) {
        client = new LanguageServerClient({ workspaceId, editingSessionId: sessionId });
        clientsByKey.set(key, client);
    }
    return client;
}

/** Test-only: drop every cached client. */
export function resetLanguageServerClientsForTests(): void {
    for (const [, client] of clientsByKey) {
        client.dispose();
    }
    clientsByKey.clear();
}
