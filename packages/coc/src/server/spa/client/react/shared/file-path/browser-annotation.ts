/** Mirrors the desktop annotation bridge. Website metadata is untrusted context. */
export interface BrowserAnnotationIdentity {
    viewId: string;
    sessionKey: string;
    requestId: string;
}
export interface BrowserAnnotationSelection {
    type: 'selection';
    kind: 'element' | 'area';
    rect: { x: number; y: number; width: number; height: number };
    tag?: string;
    immediate: boolean;
    page: { url: string; title: string; viewport: { width: number; height: number; devicePixelRatio: number } };
    element?: { selector: string | null; shadowHosts: (string | null)[]; tag: string; id: string;
        classes: string[]; text: string; outerHTML: string };
}
export type BrowserAnnotationExitReason = 'escape' | 'navigation' | 'removed' | 'overflow' | 'stop';
export type BrowserAnnotationEvent = BrowserAnnotationSelection
    | { type: 'comment'; id: string; number: number; comment: string; selection: BrowserAnnotationSelection }
    | { type: 'delete'; id: string }
    | { type: 'exit'; reason: BrowserAnnotationExitReason };
export type BrowserAnnotationNotification = BrowserAnnotationIdentity & (
    | { type: 'events'; events: BrowserAnnotationEvent[] }
    | { type: 'ended'; reason: BrowserAnnotationExitReason | 'unavailable' | 'failed'; error?: string }
);
export interface DesktopBrowserAnnotation {
    supported: boolean;
    start(identity: BrowserAnnotationIdentity): Promise<boolean>;
    stop(identity: BrowserAnnotationIdentity): Promise<void>;
    remove(identity: BrowserAnnotationIdentity, id: string): Promise<void>;
    setEnabled(sessionKey: string, enabled: boolean): Promise<void>;
    onEvent(callback: (event: BrowserAnnotationNotification) => void): () => void;
}

/** One mode entry only. Create a new instance after exit, navigation or retry. */
export class BrowserAnnotationSession {
    readonly identity: Readonly<BrowserAnnotationIdentity>;
    private phase: 'new' | 'starting' | 'active' | 'stopped' = 'new';
    private off?: () => void;
    private startup?: Promise<boolean>;
    private stopping?: Promise<void>;

    constructor(private readonly bridge: DesktopBrowserAnnotation, viewId: string, sessionKey: string,
        private readonly notify: (event: BrowserAnnotationNotification) => void) {
        this.identity = Object.freeze({ viewId, sessionKey, requestId: crypto.randomUUID() });
    }

    start(): Promise<boolean> {
        if (this.phase === 'stopped') return Promise.resolve(false);
        if (this.startup) return this.startup;
        if (!this.bridge.supported) { this.revoke(); return Promise.resolve(false); }
        this.phase = 'starting';
        // Defer invocation so reentrant callers also share the same startup promise.
        this.startup = Promise.resolve().then(async () => {
            try {
                if (this.phase === 'stopped') return false;
                this.off = this.bridge.onEvent(event => {
                    if (this.phase === 'stopped' || event.viewId !== this.identity.viewId
                        || event.sessionKey !== this.identity.sessionKey || event.requestId !== this.identity.requestId) return;
                    if (event.type === 'ended') this.revoke();
                    this.notify(event);
                });
                const active = await this.bridge.start(this.identity);
                if (!active || this.isStopped()) { this.revoke(); return false; }
                this.phase = 'active';
                return true;
            } catch (error) {
                this.revoke();
                throw error;
            }
        });
        return this.startup;
    }

    /** Chips retain this session's identity; removing one after navigation must not touch a replacement. */
    remove(id: string): Promise<void> {
        if (this.phase !== 'active') return Promise.resolve();
        return this.bridge.remove(this.identity, id);
    }

    /** Revoke UI delivery before waiting for native cleanup; failures remain observable. */
    stop(): Promise<void> {
        if (this.stopping) return this.stopping;
        const requested = this.phase === 'starting' || this.phase === 'active';
        this.revoke();
        this.stopping = requested
            ? Promise.resolve().then(() => this.bridge.stop(this.identity)) : Promise.resolve();
        return this.stopping;
    }

    private isStopped(): boolean { return this.phase === 'stopped'; }

    private revoke(): void {
        this.phase = 'stopped';
        this.off?.();
        this.off = undefined;
    }
}
