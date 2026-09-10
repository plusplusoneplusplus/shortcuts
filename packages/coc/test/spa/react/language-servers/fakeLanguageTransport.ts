/**
 * A fake language-server transport for the browser-side suites.
 *
 * `FakeClient` implements the slice of `LanguageServerClient` that the document
 * store uses, so every test above the transport (the store itself, and the
 * React hooks on top of it) runs the real code against a socket-free host whose
 * attach, detach, crash and diagnostics timing the test controls directly.
 */

import {
    browserDocumentUri,
    type LspDiagnostic,
} from '../../../../src/server/spa/client/react/features/language-servers/documentStore';
import type {
    LanguageServerAttachedInfo,
    LanguageServerAttachment,
    LanguageServerClient,
    LanguageServerSessionStateView,
    LanguageServerUnavailableInfo,
} from '../../../../src/server/spa/client/react/features/language-servers/languageServerClient';

export interface SentNotification {
    method: string;
    params: Record<string, unknown>;
}

export interface SentRequest {
    method: string;
    params: unknown;
    /** The provider layer's cancellation signal, when it passed one. */
    signal?: AbortSignal;
}

/** A scripted answer. Throw to make the request fail. */
export type RequestResponder = (params: unknown, signal?: AbortSignal) => unknown;


/** One host attachment, shared by every view of the same path. */
export class FakeAttachment {
    readonly notifications: SentNotification[] = [];
    readonly requests: SentRequest[] = [];
    /** Every `restart()` the layers above asked for. */
    restarts = 0;
    private readonly responders = new Map<string, RequestResponder>();
    refCount = 0;
    released = false;

    info: LanguageServerAttachedInfo | null = null;
    unavailable: LanguageServerUnavailableInfo | null = null;

    private readonly attached = new Set<(info: LanguageServerAttachedInfo) => void>();
    private readonly detached = new Set<(reason: string) => void>();
    private readonly unavailableListeners = new Set<(info: LanguageServerUnavailableInfo) => void>();
    private readonly notificationListeners = new Set<(method: string, params: unknown) => void>();
    private readonly statusListeners = new Set<(state: LanguageServerSessionStateView) => void>();

    constructor(readonly path: string) {}

    handle(): LanguageServerAttachment {
        this.refCount += 1;
        const self = this;
        let live = true;
        return {
            path: this.path,
            getInfo: () => self.info,
            getUnavailable: () => self.unavailable,
            onAttached: (listener) => add(self.attached, listener),
            onDetached: (listener) => add(self.detached, listener),
            onUnavailable: (listener) => add(self.unavailableListeners, listener),
            onNotification: (listener) => add(self.notificationListeners, listener),
            onStatus: (listener) => add(self.statusListeners, listener),
            sendRequest: async <T,>(method: string, params?: unknown, options?: { signal?: AbortSignal }) => {
                self.requests.push({ method, params, signal: options?.signal });
                const responder = self.responders.get(method);
                if (!responder) {
                    return undefined as T;
                }
                return (await responder(params, options?.signal)) as T;
            },
            sendNotification: (method: string, params?: unknown) => {
                if (!self.info) {
                    return; // The real client drops notifications while detached.
                }
                self.notifications.push({ method, params: (params ?? {}) as Record<string, unknown> });
            },
            restart: () => {
                self.restarts += 1;
            },
            release: () => {
                if (!live) {
                    return;
                }
                live = false;
                self.refCount -= 1;
                if (self.refCount === 0) {
                    self.released = true;
                }
            },
        };
    }

    /** Scripts the answer to one request method. */
    respond(method: string, responder: RequestResponder): void {
        this.responders.set(method, responder);
    }

    lastRequest(method: string): SentRequest | undefined {
        return [...this.requests].reverse().find((entry) => entry.method === method);
    }

    /** The host reports a live session; this is the replay signal. */
    attach(overrides: Partial<LanguageServerAttachedInfo> = {}): void {
        const info: LanguageServerAttachedInfo = {
            attachmentId: `att-${this.path}`,
            sessionKey: 'session-key',
            documentUri: browserDocumentUri('ws-1', this.path),
            languageId: 'typescript',
            definitionId: 'typescript',
            displayName: 'TypeScript',
            state: readyState(),
            ...overrides,
        };
        this.info = info;
        this.unavailable = null;
        for (const listener of [...this.attached]) {
            listener(info);
        }
    }

    detach(reason = 'config-changed'): void {
        this.info = null;
        for (const listener of [...this.detached]) {
            listener(reason);
        }
    }

    reportUnavailable(reason: string, detail: string): void {
        this.info = null;
        this.unavailable = { reason, detail };
        for (const listener of [...this.unavailableListeners]) {
            listener(this.unavailable);
        }
    }

    notify(method: string, params: unknown): void {
        for (const listener of [...this.notificationListeners]) {
            listener(method, params);
        }
    }

    status(state: LanguageServerSessionStateView): void {
        for (const listener of [...this.statusListeners]) {
            listener(state);
        }
    }

    methods(): string[] {
        return this.notifications.map((entry) => entry.method);
    }

    lastOf(method: string): Record<string, unknown> | undefined {
        return [...this.notifications].reverse().find((entry) => entry.method === method)?.params;
    }
}

export class FakeClient {
    readonly attachments = new Map<string, FakeAttachment>();

    attach(path: string): LanguageServerAttachment {
        let attachment = this.attachments.get(path);
        if (!attachment) {
            attachment = new FakeAttachment(path);
            this.attachments.set(path, attachment);
        }
        return attachment.handle();
    }

    get(path: string): FakeAttachment {
        const attachment = this.attachments.get(path);
        if (!attachment) {
            throw new Error(`No attachment for ${path}`);
        }
        return attachment;
    }

    asClient(): LanguageServerClient {
        return this as unknown as LanguageServerClient;
    }
}

export function add<T>(set: Set<T>, listener: T): () => void {
    set.add(listener);
    return () => {
        set.delete(listener);
    };
}

/**
 * `generation` mirrors the host's handshake counter, which the store uses to
 * decide whether the process behind a live attachment is a new one.
 */
export function readyState(
    capabilities: Record<string, unknown> = { textDocumentSync: 1 },
    generation = 1,
): LanguageServerSessionStateView {
    return {
        status: 'ready',
        definitionId: 'typescript',
        displayName: 'TypeScript',
        capabilities,
        generation,
    };
}

export function diagnostic(message: string): LspDiagnostic {
    return { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message };
}
