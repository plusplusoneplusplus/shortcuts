import type { WebContents } from 'electron';
import { BROWSER_FRAME_CDP_EVENTS, BrowserHostError, validBrowserCdpSession, type BrowserCdpEventListener } from './browser-host-contract';

/** One adopted URL guest's debugger; never used by SPA contents or file previews. */
export class ElectronBrowserCdp {
    private closed = false;
    private attached = false;
    private readonly pending = new Map<(error: Error) => void, string | undefined>();
    private readonly listeners = new Set<BrowserCdpEventListener>();
    private readonly sessions = new Map<string, string | undefined>();
    private eventError?: Error;
    private readonly debuggerApi: WebContents['debugger'];

    constructor(private readonly contents: WebContents) {
        this.debuggerApi = contents.debugger;
        contents.on('destroyed', this.destroyed);
        contents.on('render-process-gone', this.crashed);
        this.debuggerApi.on('detach', this.detached);
    }

    private readonly destroyed = () => this.dispose();
    private readonly crashed = () => {
        this.clearEvents();
        this.rejectPending(new BrowserHostError('runtime-crashed', 'Browser page crashed during CDP command.'));
    };
    private readonly detached = (_event: unknown, reason: string) => {
        this.attached = false;
        this.clearEvents();
        this.rejectPending(new Error(`Browser debugger detached: ${reason}`));
    };

    private rejectPending(error: Error): void {
        for (const reject of [...this.pending.keys()]) { reject(error); }
    }

    private clearEvents(): void {
        this.debuggerApi.removeListener('message', this.message);
        this.listeners.clear();
        this.sessions.clear();
        this.eventError = undefined;
    }

    onEvent(listener: BrowserCdpEventListener): () => void {
        if (this.closed || this.contents.isDestroyed()) { throw new BrowserHostError('not-found', 'Browser tab is closed.'); }
        if (!this.listeners.size) {
            this.eventError = undefined;
            this.debuggerApi.on('message', this.message);
        }
        const registration: BrowserCdpEventListener = (...args) => listener(...args);
        this.listeners.add(registration);
        let disposed = false;
        return () => {
            if (disposed) { return; }
            disposed = true;
            this.listeners.delete(registration);
            if (!this.listeners.size) { this.clearEvents(); }
        };
    }

    private readonly message = (_event: unknown, method: string, params: Record<string, unknown>, sessionId?: string) => {
        if (this.closed || this.eventError || !this.listeners.size
            || !(BROWSER_FRAME_CDP_EVENTS as readonly string[]).includes(method)) { return; }
        sessionId = sessionId || undefined;
        if (sessionId && !this.sessions.has(sessionId)) { return; }
        if (!params || typeof params !== 'object' || Array.isArray(params)
            || Buffer.byteLength(JSON.stringify(params), 'utf8') > 900_000) {
            this.eventError = new BrowserHostError('invalid', 'Browser CDP event exceeds the transport limit or is invalid.');
            this.rejectPending(this.eventError);
            return;
        }
        if (method === 'Target.attachedToTarget') {
            const target = params.targetInfo as Record<string, unknown> | undefined;
            if (!validBrowserCdpSession(params.sessionId) || target?.type !== 'iframe') { return; }
            if (params.sessionId === sessionId || this.sessions.has(params.sessionId)) { return; }
            if (this.sessions.size >= 256 && !this.sessions.has(params.sessionId)) {
                this.eventError = new BrowserHostError('invalid', 'Browser CDP session limit exceeded.');
                this.rejectPending(this.eventError);
                return;
            }
            this.sessions.set(params.sessionId, sessionId);
        } else if (method === 'Target.detachedFromTarget' && typeof params.sessionId === 'string') {
            const removed = new Set([params.sessionId]);
            for (const [id, parent] of this.sessions) { if (parent && removed.has(parent)) { removed.add(id); } }
            for (const id of removed) { this.sessions.delete(id); }
            for (const [fail, id] of this.pending) {
                if (id && removed.has(id)) { fail(new BrowserHostError('not-found', 'Browser frame session detached during CDP command.')); }
            }
        }
        for (const listener of [...this.listeners]) { listener(method, params, sessionId); }
    };

    async send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
        if (this.closed || this.contents.isDestroyed()) {
            throw new BrowserHostError('not-found', 'Browser tab is closed.');
        }
        if (this.eventError) { throw this.eventError; }
        if (sessionId !== undefined && (!validBrowserCdpSession(sessionId) || !this.sessions.has(sessionId))) {
            throw new BrowserHostError('invalid', 'Browser frame session does not belong to this view.');
        }
        if (Buffer.byteLength(JSON.stringify({ method, params, sessionId }), 'utf8') > 1_048_576) {
            throw new BrowserHostError('invalid', 'Browser CDP command exceeds the transport limit.');
        }
        const debuggerApi = this.debuggerApi;
        if (!debuggerApi.isAttached()) {
            debuggerApi.attach('1.3');
            this.attached = true;
        }
        return new Promise((resolve, reject) => {
            const finish = (error?: unknown, result?: unknown) => {
                if (!this.pending.delete(fail)) { return; }
                clearTimeout(timer);
                if (error !== undefined) { reject(error); } else { resolve(result); }
            };
            const fail = (error: Error) => finish(error);
            const timer = setTimeout(() => fail(new Error('Browser CDP command timed out after 60s.')), 60_000);
            this.pending.set(fail, sessionId);
            try {
                const result = sessionId === undefined ? debuggerApi.sendCommand(method, params) : debuggerApi.sendCommand(method, params, sessionId);
                result.then(result => finish(undefined, result), error => finish(error));
            } catch (error) { finish(error); }
        });
    }

    dispose(): void {
        if (this.closed) { return; }
        this.closed = true;
        this.clearEvents();
        this.rejectPending(new BrowserHostError('not-found', 'Browser tab closed during CDP command.'));
        this.contents.removeListener('destroyed', this.destroyed);
        this.contents.removeListener('render-process-gone', this.crashed);
        this.debuggerApi.removeListener('detach', this.detached);
        if (this.attached && !this.contents.isDestroyed() && this.debuggerApi.isAttached()) {
            this.debuggerApi.detach();
        }
        this.attached = false;
    }
}
