/**
 * Workspace-scoped WebSocket bridge between the browser editor and the host's
 * language servers, served at `/ws/language-server`.
 *
 * One socket belongs to exactly one workspace and one browser editing session,
 * both taken from the upgrade URL and validated before any process is touched.
 * The socket then attaches documents; each attachment acquires a session from
 * {@link LanguageServerManager} and relays LSP requests and notifications for
 * that document.
 *
 * The bridge stays language-neutral. It knows about JSON-RPC methods, document
 * URIs, and session lifecycle, and nothing about TypeScript. The browser-facing
 * message shape is the transport contract a container relay will implement, so
 * the editor client does not change when the server moves off this host.
 */

import * as http from 'http';
import * as crypto from 'crypto';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import { getServerLogger } from '../logging/server-logger';
import type { LanguageServerManager, LanguageServerHandle, LanguageServerUnavailableReason } from './manager';
import type { LanguageServerSessionState } from './session';
import { LanguageServerRequestError } from './connection';
import { browserDocumentUri, resolveWorkspaceDocument, toBrowserUri, toServerUri, translateUris } from './uri-mapping';
import type { UriMappingFailure } from './uri-mapping';

/** Exported so a teardown test can identify this interval among all timers. */
export const HEARTBEAT_INTERVAL_MS = 60_000;

/** Server notifications forwarded to the browser. Anything else is dropped. */
const FORWARDED_NOTIFICATIONS = [
    'textDocument/publishDiagnostics',
    'window/showMessage',
    'window/logMessage',
    '$/progress',
];

/** Minimal workspace lookup; `ProcessStore` satisfies it. */
export interface WorkspaceLookup {
    getWorkspaces(): Promise<{ id: string; rootPath: string }[]>;
}

// ============================================================================
// Wire protocol
// ============================================================================

export type LanguageServerClientMessage =
    | { type: 'lsp-attach'; requestId: string; path: string }
    | { type: 'lsp-detach'; attachmentId: string }
    | { type: 'lsp-request'; attachmentId: string; id: string; method: string; params?: unknown }
    | { type: 'lsp-cancel'; attachmentId: string; id: string }
    | { type: 'lsp-notify'; attachmentId: string; method: string; params?: unknown }
    | { type: 'lsp-restart'; attachmentId: string }
    | { type: 'ping' };

export type LanguageServerServerMessage =
    | { type: 'lsp-welcome'; clientId: string; workspaceId: string; editingSessionId: string }
    | {
          type: 'lsp-attached';
          requestId: string;
          attachmentId: string;
          sessionKey: string;
          documentUri: string;
          languageId: string;
          definitionId: string;
          displayName: string;
          state: LanguageServerSessionState;
      }
    | { type: 'lsp-unavailable'; requestId: string; reason: LanguageServerUnavailableReason | 'invalid-path'; detail: string }
    | { type: 'lsp-response'; attachmentId: string; id: string; result?: unknown; error?: { code: string; message: string } }
    | { type: 'lsp-notification'; sessionKey: string; method: string; params?: unknown }
    | { type: 'lsp-status'; sessionKey: string; state: LanguageServerSessionState }
    | { type: 'lsp-detached'; attachmentId: string; reason: string }
    | { type: 'lsp-error'; message: string }
    | { type: 'pong' };

// ============================================================================
// Internal state
// ============================================================================

interface Attachment {
    id: string;
    handle: LanguageServerHandle;
    relativePath: string;
    documentUri: string;
    /** In-flight requests, so a cancel or a socket close can abort them. */
    pending: Map<string, AbortController>;
}

interface SessionSubscription {
    key: string;
    attachments: Set<string>;
    dispose: () => void;
}

interface BridgeClient {
    id: string;
    socket: WebSocket;
    workspaceId: string;
    workspaceRoot: string;
    editingSessionId: string;
    attachments: Map<string, Attachment>;
    subscriptions: Map<string, SessionSubscription>;
}

// ============================================================================
// Bridge
// ============================================================================

export class LanguageServerWebSocketServer {
    private readonly wss: WebSocketServer;
    private readonly clients = new Map<string, BridgeClient>();
    private readonly workspaces: WorkspaceLookup;
    private readonly manager: LanguageServerManager;
    private readonly unsubscribeClosed: () => void;
    /** In-flight user-initiated restarts, keyed by session. */
    private readonly restarting = new Map<string, Promise<void>>();
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    constructor(workspaces: WorkspaceLookup, manager: LanguageServerManager) {
        this.wss = new WebSocketServer({ noServer: true });
        this.workspaces = workspaces;
        this.manager = manager;
        this.unsubscribeClosed = manager.onSessionClosed((event) => {
            this.onSessionClosed(event.key, event.reason);
        });
    }

    get clientCount(): number {
        return this.clients.size;
    }

    handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
            void this.onConnection(ws, req);
        });
    }

    /** Drops every socket. The manager owns the processes and is not disposed here. */
    closeAll(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        this.unsubscribeClosed();
        for (const [, client] of this.clients) {
            this.cleanupClient(client);
            try { client.socket.close(1001, 'Server shutting down'); } catch { /* ignore */ }
        }
        this.clients.clear();
        try { this.wss.close(); } catch { /* ignore */ }
    }

    // ========================================================================
    // Connection lifecycle
    // ========================================================================

    private async onConnection(ws: WebSocket, req: http.IncomingMessage): Promise<void> {
        (ws as unknown as { isAlive: boolean }).isAlive = true;

        let workspaceId = '';
        let editingSessionId = '';
        try {
            const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
            workspaceId = url.searchParams.get('workspaceId') ?? '';
            editingSessionId = url.searchParams.get('editingSessionId') ?? '';
        } catch {
            // Leaves both empty; rejected below.
        }

        if (!workspaceId || !editingSessionId) {
            this.send(ws, { type: 'lsp-error', message: 'Missing workspaceId or editingSessionId parameter' });
            ws.close(4001, 'Missing parameters');
            return;
        }

        let workspaceRoot: string;
        try {
            const workspaces = await this.workspaces.getWorkspaces();
            const workspace = workspaces.find((entry) => entry.id === workspaceId);
            if (!workspace) {
                if (ws.readyState !== WebSocket.OPEN) { return; }
                this.send(ws, { type: 'lsp-error', message: 'Unknown workspace' });
                ws.close(4001, 'Unknown workspace');
                return;
            }
            workspaceRoot = workspace.rootPath;
        } catch {
            if (ws.readyState !== WebSocket.OPEN) { return; }
            this.send(ws, { type: 'lsp-error', message: 'Failed to validate workspace' });
            ws.close(4002, 'Failed to validate workspace');
            return;
        }

        if (ws.readyState !== WebSocket.OPEN) { return; }

        const client: BridgeClient = {
            id: crypto.randomUUID(),
            socket: ws,
            workspaceId,
            workspaceRoot,
            editingSessionId,
            attachments: new Map(),
            subscriptions: new Map(),
        };
        this.clients.set(client.id, client);
        getServerLogger().info({ clientId: client.id, workspaceId }, 'Language-server WebSocket connected');

        ws.on('pong', () => { (ws as unknown as { isAlive: boolean }).isAlive = true; });
        ws.on('message', (raw: Buffer | string) => {
            const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
            let message: LanguageServerClientMessage;
            try {
                message = JSON.parse(text);
            } catch {
                return;
            }
            void this.handleClientMessage(client, message);
        });
        ws.on('close', () => { this.dropClient(client); });
        ws.on('error', (err) => {
            getServerLogger().warn({ clientId: client.id, err }, 'Language-server WebSocket error');
            this.dropClient(client);
        });

        this.send(ws, { type: 'lsp-welcome', clientId: client.id, workspaceId, editingSessionId });

        if (!this.heartbeatTimer) {
            this.startHeartbeat();
        }
    }

    // ========================================================================
    // Client messages
    // ========================================================================

    private async handleClientMessage(client: BridgeClient, message: LanguageServerClientMessage): Promise<void> {
        switch (message?.type) {
            case 'ping':
                this.send(client.socket, { type: 'pong' });
                return;
            case 'lsp-attach':
                this.attachDocument(client, message);
                return;
            case 'lsp-detach':
                this.detachDocument(client, message.attachmentId, 'client-request');
                return;
            case 'lsp-cancel': {
                const attachment = client.attachments.get(message.attachmentId);
                attachment?.pending.get(message.id)?.abort();
                return;
            }
            case 'lsp-request':
                await this.forwardRequest(client, message);
                return;
            case 'lsp-notify':
                this.forwardNotification(client, message);
                return;
            case 'lsp-restart':
                await this.restartSession(client, message.attachmentId);
                return;
            default:
                return;
        }
    }

    private attachDocument(client: BridgeClient, message: { requestId: string; path: string }): void {
        const requestId = String(message.requestId ?? '');
        const resolved = resolveWorkspaceDocument(client.workspaceRoot, String(message.path ?? ''));
        if (!resolved.ok) {
            this.send(client.socket, {
                type: 'lsp-unavailable',
                requestId,
                reason: 'invalid-path',
                detail: describeMappingFailure(resolved.reason),
            });
            return;
        }

        const result = this.manager.acquire({
            workspaceId: client.workspaceId,
            workspaceRoot: client.workspaceRoot,
            editingSessionId: client.editingSessionId,
            relativePath: resolved.relativePath,
        });
        if (!result.ok) {
            this.send(client.socket, {
                type: 'lsp-unavailable',
                requestId,
                reason: result.reason,
                detail: result.detail,
            });
            return;
        }

        const attachment: Attachment = {
            id: crypto.randomUUID(),
            handle: result.handle,
            relativePath: resolved.relativePath,
            documentUri: browserDocumentUri(client.workspaceId, resolved.relativePath),
            pending: new Map(),
        };
        client.attachments.set(attachment.id, attachment);
        this.subscribe(client, attachment);

        this.send(client.socket, {
            type: 'lsp-attached',
            requestId,
            attachmentId: attachment.id,
            sessionKey: result.handle.key,
            documentUri: attachment.documentUri,
            languageId: result.handle.languageId,
            definitionId: result.handle.definition.id,
            displayName: result.handle.definition.displayName,
            state: result.handle.session.getState(),
        });

        // Opening an eligible file is what starts the server (lazy startup).
        // Without this the first `didOpen` would be dropped, because a
        // notification needs a live connection and only a request starts one.
        // `lsp-attached` goes out first so the browser is not made to wait for
        // a spawn and a handshake; the client replays its buffer when the
        // session reports a new ready generation.
        this.startSession(client, attachment);
    }

    /**
     * Brings the session up behind a fresh attachment. Success reaches the
     * browser through the session's own ready handler; a failure has no such
     * handler, so the state is pushed here instead of leaving the document
     * sitting silently on a server that will never answer.
     */
    private startSession(client: BridgeClient, attachment: Attachment): void {
        const session = attachment.handle.session;
        void session.start().catch(() => {
            if (!client.attachments.has(attachment.id)) {
                return;
            }
            this.send(client.socket, {
                type: 'lsp-status',
                sessionKey: attachment.handle.key,
                state: session.getState(),
            });
        });
    }

    private detachDocument(client: BridgeClient, attachmentId: string, reason: string): void {
        const attachment = client.attachments.get(attachmentId);
        if (!attachment) {
            return;
        }
        client.attachments.delete(attachmentId);
        for (const [, controller] of attachment.pending) {
            controller.abort();
        }
        attachment.pending.clear();
        this.unsubscribe(client, attachment);
        attachment.handle.release();
        this.send(client.socket, { type: 'lsp-detached', attachmentId, reason });
    }

    private async forwardRequest(
        client: BridgeClient,
        message: { attachmentId: string; id: string; method: string; params?: unknown },
    ): Promise<void> {
        const attachment = client.attachments.get(message.attachmentId);
        if (!attachment) {
            this.send(client.socket, {
                type: 'lsp-response',
                attachmentId: message.attachmentId,
                id: message.id,
                error: { code: 'unknown-attachment', message: 'This document is not attached.' },
            });
            return;
        }
        const params = this.toServerParams(client, message.params);
        if (!params.ok) {
            this.send(client.socket, {
                type: 'lsp-response',
                attachmentId: attachment.id,
                id: message.id,
                error: { code: 'forbidden-uri', message: `Refused a document URI outside this workspace: ${params.uri}` },
            });
            return;
        }

        const controller = new AbortController();
        attachment.pending.set(message.id, controller);
        try {
            const raw = await attachment.handle.session.sendRequest(message.method, params.value, {
                signal: controller.signal,
            });
            const result = translateUris(raw, (uri) => toBrowserUri(uri, client.workspaceId, client.workspaceRoot));
            this.send(client.socket, {
                type: 'lsp-response',
                attachmentId: attachment.id,
                id: message.id,
                result: result.ok ? result.value : raw,
            });
        } catch (err) {
            this.send(client.socket, {
                type: 'lsp-response',
                attachmentId: attachment.id,
                id: message.id,
                error: {
                    code: err instanceof LanguageServerRequestError ? err.failure : 'failed',
                    message: err instanceof Error ? err.message : 'Language-server request failed',
                },
            });
            this.send(client.socket, {
                type: 'lsp-status',
                sessionKey: attachment.handle.key,
                state: attachment.handle.session.getState(),
            });
        } finally {
            attachment.pending.delete(message.id);
        }
    }

    private forwardNotification(
        client: BridgeClient,
        message: { attachmentId: string; method: string; params?: unknown },
    ): void {
        const attachment = client.attachments.get(message.attachmentId);
        if (!attachment) {
            return;
        }
        const params = this.toServerParams(client, message.params);
        if (!params.ok) {
            this.send(client.socket, {
                type: 'lsp-error',
                message: `Refused a document URI outside this workspace: ${params.uri}`,
            });
            return;
        }
        attachment.handle.session.sendNotification(message.method, params.value);
    }

    /**
     * Restarts the server behind one document, on the user's say-so, without
     * restarting CoC. The attachment survives it: the same session object comes
     * back with a new process and a new handshake generation, which is the
     * browser's cue to replay its buffer.
     *
     * Restarts are coalesced per session, because one session serves every
     * document of a project root and two panes pressing retry must not stop and
     * start the process twice. Nothing is sent back from here — the session's
     * own state transitions carry `starting`, `ready` and any failure to every
     * socket watching it.
     */
    private restartSession(client: BridgeClient, attachmentId: string): Promise<void> {
        const attachment = client.attachments.get(String(attachmentId ?? ''));
        if (!attachment) {
            return Promise.resolve();
        }
        const key = attachment.handle.key;
        const existing = this.restarting.get(key);
        if (existing) {
            return existing;
        }
        const session = attachment.handle.session;
        const running = session
            .restart()
            .catch((err) => {
                getServerLogger().warn({ sessionKey: key, err }, 'Language-server restart failed');
            })
            .finally(() => {
                this.restarting.delete(key);
            });
        this.restarting.set(key, running);
        return running;
    }

    /** Inbound translation, which doubles as the per-workspace access check. */
    private toServerParams(
        client: BridgeClient,
        params: unknown,
    ): { ok: true; value: unknown } | { ok: false; uri: string } {
        return translateUris(params, (uri) => {
            const mapped = toServerUri(uri, client.workspaceId, client.workspaceRoot);
            return mapped.ok ? mapped.uri : undefined;
        });
    }

    // ========================================================================
    // Server-originated traffic
    // ========================================================================

    private subscribe(client: BridgeClient, attachment: Attachment): void {
        const key = attachment.handle.key;
        const existing = client.subscriptions.get(key);
        if (existing) {
            existing.attachments.add(attachment.id);
            return;
        }
        const session = attachment.handle.session;
        const disposers: (() => void)[] = [];
        for (const method of FORWARDED_NOTIFICATIONS) {
            disposers.push(
                session.onNotification(method, (params) => {
                    const translated = translateUris(params, (uri) =>
                        toBrowserUri(uri, client.workspaceId, client.workspaceRoot),
                    );
                    this.send(client.socket, {
                        type: 'lsp-notification',
                        sessionKey: key,
                        method,
                        params: translated.ok ? translated.value : params,
                    });
                }),
            );
        }
        // Every transition, not just the handshake: a status display is only
        // honest if `starting`, `reconnecting` and `failed` reach it too. The
        // `ready` transition fires here as well, and it carries the new
        // handshake generation the document layer replays on.
        disposers.push(
            session.onStateChange((state) => {
                this.send(client.socket, { type: 'lsp-status', sessionKey: key, state });
            }),
        );
        client.subscriptions.set(key, {
            key,
            attachments: new Set([attachment.id]),
            dispose: () => {
                for (const dispose of disposers) {
                    dispose();
                }
            },
        });
    }

    private unsubscribe(client: BridgeClient, attachment: Attachment): void {
        const subscription = client.subscriptions.get(attachment.handle.key);
        if (!subscription) {
            return;
        }
        subscription.attachments.delete(attachment.id);
        if (subscription.attachments.size === 0) {
            subscription.dispose();
            client.subscriptions.delete(subscription.key);
        }
    }

    /**
     * The manager closed a session out from under its documents. Every
     * attachment on that session is detached with the manager's reason, which is
     * the client's cue to re-attach and replay its buffers.
     */
    private onSessionClosed(sessionKey: string, reason: string): void {
        for (const [, client] of this.clients) {
            for (const [, attachment] of [...client.attachments]) {
                if (attachment.handle.key === sessionKey) {
                    this.detachDocument(client, attachment.id, reason);
                }
            }
        }
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    private dropClient(client: BridgeClient): void {
        if (!this.clients.has(client.id)) {
            return;
        }
        this.cleanupClient(client);
        this.clients.delete(client.id);
    }

    /** Releases every handle this socket held, without touching the socket. */
    private cleanupClient(client: BridgeClient): void {
        for (const [, attachment] of client.attachments) {
            for (const [, controller] of attachment.pending) {
                controller.abort();
            }
            attachment.pending.clear();
            attachment.handle.release();
        }
        client.attachments.clear();
        for (const [, subscription] of client.subscriptions) {
            subscription.dispose();
        }
        client.subscriptions.clear();
    }

    private send(ws: WebSocket, message: LanguageServerServerMessage): void {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }

    private startHeartbeat(): void {
        this.heartbeatTimer = setInterval(() => {
            for (const [, client] of [...this.clients]) {
                const socket = client.socket as unknown as { isAlive: boolean };
                if (!socket.isAlive) {
                    this.dropClient(client);
                    try { client.socket.terminate(); } catch { /* ignore */ }
                    continue;
                }
                socket.isAlive = false;
                try { client.socket.ping(); } catch { /* ignore */ }
            }
        }, HEARTBEAT_INTERVAL_MS);
        this.heartbeatTimer.unref?.();
    }
}

function describeMappingFailure(reason: UriMappingFailure): string {
    switch (reason) {
        case 'empty-path':
            return 'A document path is required.';
        case 'absolute-path':
            return 'Document paths must be workspace-relative.';
        case 'escapes-workspace':
            return 'That path is outside the workspace.';
        case 'foreign-workspace':
            return 'That document belongs to a different workspace.';
        default:
            return 'That document URI is not supported.';
    }
}
