import { estimateDataUrlBytes } from '../../features/chat/utils/screenshotAttachment';

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
    captureId?: string;
    page: { url: string; title: string; viewport: { width: number; height: number; devicePixelRatio: number } };
    element?: { selector: string | null; shadowHosts: (string | null)[]; tag: string; id: string;
        classes: string[]; text: string; outerHTML: string };
}
export interface BrowserAnnotationImage {
    dataUrl: string;
    width: number;
    height: number;
}
export type BrowserAnnotationDeliveryEvent = Exclude<BrowserAnnotationEvent, BrowserAnnotationSelection>
    | (BrowserAnnotationSelection & { image?: BrowserAnnotationImage });
export type BrowserAnnotationExitReason = 'escape' | 'navigation' | 'removed' | 'overflow' | 'stop';
export type BrowserAnnotationEvent = BrowserAnnotationSelection
    | { type: 'comment'; id: string; number: number; comment: string; selection: BrowserAnnotationSelection }
    | { type: 'delete'; id: string }
    | { type: 'exit'; reason: BrowserAnnotationExitReason };
export type BrowserAnnotationNotification = BrowserAnnotationIdentity & (
    | { type: 'events'; events: BrowserAnnotationDeliveryEvent[] }
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
    private capture?: { id: string; image: BrowserAnnotationImage };

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

    /** Only the current unsaved selection is retained; saved chips own their PNG. */
    retainCapture(id: string | undefined, image: BrowserAnnotationImage | undefined): void {
        this.capture = undefined;
        if (!image || this.phase === 'stopped') return;
        if (!id || !/^[1-9][0-9]{0,15}$/.test(id) || !Number.isSafeInteger(Number(id))
            || !image.dataUrl.startsWith('data:image/png;base64,') || image.dataUrl.length > 28_000_000
            || estimateDataUrlBytes(image.dataUrl) > 20 * 1024 * 1024
            || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height)
            || image.width <= 0 || image.height <= 0 || image.width * image.height > 16 * 1024 * 1024) {
            throw new Error('Invalid browser annotation screenshot. Exit annotation mode and retry.');
        }
        this.capture = { id, image };
    }

    takeCapture(id: string): BrowserAnnotationImage {
        if (!this.capture || this.capture.id !== id) {
            throw new Error('Browser annotation screenshot is unavailable. Select the target again.');
        }
        const image = this.capture.image;
        this.capture = undefined;
        return image;
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
        this.capture = undefined;
        this.off?.();
        this.off = undefined;
    }
}
