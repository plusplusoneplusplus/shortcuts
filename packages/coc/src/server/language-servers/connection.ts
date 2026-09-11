/**
 * Transport-neutral JSON-RPC connection to a language server.
 *
 * The connection owns request correlation, cancellation, timeouts, and
 * client-side handling of server-initiated requests. It takes a readable and a
 * writable stream, so the same class serves a spawned stdio process today and a
 * container relay later without changing its browser-facing behavior.
 */

import type { Readable, Writable } from 'stream';
import {
    JSON_RPC_ERROR_CODES,
    LspMessageReader,
    encodeMessage,
    isNotification,
    isRequest,
    isResponse,
} from './jsonrpc';
import type { JsonRpcErrorBody, JsonRpcId, JsonRpcMessage, LspFramingError } from './jsonrpc';

/** Why a pending request settled without a server result. */
export type LanguageServerRequestFailure = 'timeout' | 'cancelled' | 'closed' | 'server-error' | 'write-failed';

export class LanguageServerRequestError extends Error {
    readonly failure: LanguageServerRequestFailure;
    readonly method: string;
    readonly code?: number;
    readonly data?: unknown;

    constructor(failure: LanguageServerRequestFailure, method: string, message: string, body?: JsonRpcErrorBody) {
        super(message);
        this.name = 'LanguageServerRequestError';
        this.failure = failure;
        this.method = method;
        this.code = body?.code;
        this.data = body?.data;
    }
}

/** Handles a request the server sends to the client. */
export type ServerRequestHandler = (params: unknown) => unknown | Promise<unknown>;

/** Handles a notification the server sends to the client. */
export type ServerNotificationHandler = (params: unknown) => void;

export interface LanguageServerConnectionOptions {
    /** Bytes arriving from the server, typically the child process stdout. */
    input: Readable;
    /** Bytes going to the server, typically the child process stdin. */
    output: Writable;
    /** Rejects a request that gets no reply. Defaults to 30 seconds. */
    requestTimeoutMs?: number;
    /** Refuse frames larger than this. Defaults to the reader's own limit. */
    maxMessageBytes?: number;
    /** Reports framing problems and unroutable messages; never throws. */
    onError?: (error: Error) => void;
}

export interface SendRequestOptions {
    /** Aborting sends `$/cancelRequest` and rejects with a `cancelled` failure. */
    signal?: AbortSignal;
    /** Overrides the connection-wide timeout for one call. */
    timeoutMs?: number;
    /** False for lifecycle requests that must remain bounded during server work. */
    suspendable?: boolean;
}

interface PendingRequest {
    method: string;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer?: NodeJS.Timeout;
    timeoutMs: number;
    remainingTimeoutMs: number;
    timeoutStartedAt?: number;
    suspendable: boolean;
    detachSignal?: () => void;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export class LanguageServerConnection {
    private readonly input: Readable;
    private readonly output: Writable;
    private readonly requestTimeoutMs: number;
    private readonly onError?: (error: Error) => void;
    private readonly reader: LspMessageReader;
    private readonly pending = new Map<JsonRpcId, PendingRequest>();
    private readonly requestHandlers = new Map<string, ServerRequestHandler>();
    private readonly notificationHandlers = new Map<string, Set<ServerNotificationHandler>>();
    private nextRequestId = 1;
    private closed = false;
    private requestTimeoutsSuspended = false;

    constructor(options: LanguageServerConnectionOptions) {
        this.input = options.input;
        this.output = options.output;
        this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        this.onError = options.onError;
        this.reader = new LspMessageReader({
            onMessage: (message) => this.handleMessage(message),
            onError: (error: LspFramingError) => this.report(error),
            maxMessageBytes: options.maxMessageBytes,
        });
        this.input.on('data', this.handleData);
        this.input.on('end', this.handleEnd);
        this.input.on('close', this.handleEnd);
        this.input.on('error', this.handleStreamError);
    }

    /** True once the connection stopped accepting traffic. */
    get isClosed(): boolean {
        return this.closed;
    }

    /** Number of requests awaiting a reply. Used by tests and status reporting. */
    get pendingRequestCount(): number {
        return this.pending.size;
    }

    /**
     * Pauses normal request deadlines while the server reports long-running
     * background work. Abort signals and explicitly non-suspendable lifecycle
     * requests remain active.
     */
    setRequestTimeoutsSuspended(suspended: boolean): void {
        if (this.requestTimeoutsSuspended === suspended) {
            return;
        }
        this.requestTimeoutsSuspended = suspended;
        for (const [id, entry] of this.pending) {
            if (!entry.suspendable || entry.timeoutMs <= 0) {
                continue;
            }
            if (suspended) {
                this.pauseTimeout(entry);
            } else {
                this.armTimeout(id, entry);
            }
        }
    }

    /** Sends a request and resolves with the server's result. */
    sendRequest<T = unknown>(method: string, params?: unknown, options: SendRequestOptions = {}): Promise<T> {
        if (this.closed) {
            return Promise.reject(
                new LanguageServerRequestError('closed', method, `Connection is closed; ${method} was not sent`),
            );
        }
        if (options.signal?.aborted) {
            return Promise.reject(new LanguageServerRequestError('cancelled', method, `${method} was cancelled`));
        }
        const id = this.nextRequestId++;
        return new Promise<T>((resolve, reject) => {
            const entry: PendingRequest = {
                method,
                resolve: resolve as (value: unknown) => void,
                reject,
                timeoutMs: options.timeoutMs ?? this.requestTimeoutMs,
                remainingTimeoutMs: options.timeoutMs ?? this.requestTimeoutMs,
                suspendable: options.suspendable !== false,
            };
            if (!this.requestTimeoutsSuspended || !entry.suspendable) {
                this.armTimeout(id, entry);
            }
            if (options.signal) {
                const signal = options.signal;
                const onAbort = () => {
                    this.settle(id, () =>
                        reject(new LanguageServerRequestError('cancelled', method, `${method} was cancelled`)),
                    );
                    this.cancelRequest(id);
                };
                signal.addEventListener('abort', onAbort, { once: true });
                entry.detachSignal = () => signal.removeEventListener('abort', onAbort);
            }
            this.pending.set(id, entry);
            if (!this.write({ jsonrpc: '2.0', id, method, params })) {
                this.settle(id, () =>
                    reject(new LanguageServerRequestError('write-failed', method, `${method} could not be written`)),
                );
            }
        });
    }

    /** Sends a notification. Returns false when the write failed. */
    sendNotification(method: string, params?: unknown): boolean {
        if (this.closed) {
            return false;
        }
        return this.write({ jsonrpc: '2.0', method, params });
    }

    /**
     * Asks the server to abandon a request. Sent for supersedes and timeouts;
     * the pending entry is already settled by the caller.
     */
    cancelRequest(id: JsonRpcId): void {
        if (this.closed) {
            return;
        }
        this.write({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id } });
    }

    /** Registers the single handler for a server-to-client request method. */
    onRequest(method: string, handler: ServerRequestHandler): () => void {
        this.requestHandlers.set(method, handler);
        return () => {
            if (this.requestHandlers.get(method) === handler) {
                this.requestHandlers.delete(method);
            }
        };
    }

    /** Subscribes to a server notification method. */
    onNotification(method: string, handler: ServerNotificationHandler): () => void {
        let handlers = this.notificationHandlers.get(method);
        if (!handlers) {
            handlers = new Set();
            this.notificationHandlers.set(method, handlers);
        }
        handlers.add(handler);
        return () => {
            handlers?.delete(handler);
        };
    }

    /**
     * Stops the connection and rejects everything still in flight, so a result
     * from a dead session can never resolve a caller.
     */
    dispose(reason = 'Connection disposed'): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.input.off('data', this.handleData);
        this.input.off('end', this.handleEnd);
        this.input.off('close', this.handleEnd);
        this.input.off('error', this.handleStreamError);
        this.reader.reset();
        this.requestHandlers.clear();
        this.notificationHandlers.clear();
        const pending = [...this.pending.entries()];
        this.pending.clear();
        for (const [, entry] of pending) {
            this.clearEntry(entry);
            entry.reject(new LanguageServerRequestError('closed', entry.method, reason));
        }
    }

    private readonly handleData = (chunk: Buffer | string): void => {
        if (this.closed) {
            return;
        }
        this.reader.append(chunk);
    };

    private readonly handleEnd = (): void => {
        this.dispose('Language server closed the connection');
    };

    private readonly handleStreamError = (error: Error): void => {
        this.report(error);
        this.dispose(`Language server stream failed: ${error.message}`);
    };

    private handleMessage(message: JsonRpcMessage): void {
        if (isResponse(message)) {
            this.handleResponse(message.id, message.result, message.error);
            return;
        }
        if (isRequest(message)) {
            void this.handleServerRequest(message.id, message.method, message.params);
            return;
        }
        if (isNotification(message)) {
            const handlers = this.notificationHandlers.get(message.method);
            if (!handlers) {
                return;
            }
            for (const handler of [...handlers]) {
                try {
                    handler(message.params);
                } catch (error) {
                    this.report(error instanceof Error ? error : new Error(String(error)));
                }
            }
            return;
        }
        this.report(new Error(`Unroutable message: ${JSON.stringify(message)}`));
    }

    private handleResponse(id: JsonRpcId | null, result: unknown, error?: JsonRpcErrorBody): void {
        if (id === null) {
            this.report(new Error(`Response without an id: ${error?.message ?? 'no error body'}`));
            return;
        }
        const entry = this.pending.get(id);
        if (!entry) {
            // A late reply to a cancelled or timed-out request. Dropping it is
            // the point: the caller has already been settled.
            return;
        }
        this.pending.delete(id);
        this.clearEntry(entry);
        if (error) {
            entry.reject(
                new LanguageServerRequestError('server-error', entry.method, error.message ?? 'Language server error', error),
            );
            return;
        }
        entry.resolve(result);
    }

    private async handleServerRequest(id: JsonRpcId, method: string, params: unknown): Promise<void> {
        const handler = this.requestHandlers.get(method);
        if (!handler) {
            this.write({
                jsonrpc: '2.0',
                id,
                error: { code: JSON_RPC_ERROR_CODES.methodNotFound, message: `Unhandled request: ${method}` },
            });
            return;
        }
        try {
            const result = await handler(params);
            this.write({ jsonrpc: '2.0', id, result: result ?? null });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.write({
                jsonrpc: '2.0',
                id,
                error: { code: JSON_RPC_ERROR_CODES.internalError, message },
            });
        }
    }

    /** Removes a pending entry and runs `settled` only if it was still there. */
    private settle(id: JsonRpcId, settled: () => void): void {
        const entry = this.pending.get(id);
        if (!entry) {
            return;
        }
        this.pending.delete(id);
        this.clearEntry(entry);
        settled();
    }

    private clearEntry(entry: PendingRequest): void {
        if (entry.timer) {
            clearTimeout(entry.timer);
        }
        entry.detachSignal?.();
    }

    private pauseTimeout(entry: PendingRequest): void {
        if (!entry.timer || entry.timeoutStartedAt === undefined) {
            return;
        }
        clearTimeout(entry.timer);
        entry.timer = undefined;
        entry.remainingTimeoutMs = Math.max(0, entry.remainingTimeoutMs - (Date.now() - entry.timeoutStartedAt));
        entry.timeoutStartedAt = undefined;
    }

    private armTimeout(id: JsonRpcId, entry: PendingRequest): void {
        if (entry.timer || entry.timeoutMs <= 0) {
            return;
        }
        const delayMs = entry.remainingTimeoutMs;
        entry.timeoutStartedAt = Date.now();
        entry.timer = setTimeout(() => {
            this.settle(id, () =>
                entry.reject(
                    new LanguageServerRequestError(
                        'timeout',
                        entry.method,
                        `${entry.method} timed out after ${entry.timeoutMs}ms`,
                    ),
                ),
            );
            this.cancelRequest(id);
        }, delayMs);
        entry.timer.unref?.();
    }

    private write(message: unknown): boolean {
        try {
            this.output.write(encodeMessage(message));
            return true;
        } catch (error) {
            this.report(error instanceof Error ? error : new Error(String(error)));
            return false;
        }
    }

    private report(error: Error): void {
        if (this.onError) {
            this.onError(error);
        }
    }
}
