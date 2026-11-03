import { randomUUID } from 'node:crypto';
import { buildBrowserAnnotationExpression, type BrowserAnnotationCommand, type BrowserAnnotationEvent, type BrowserAnnotationResult, type BrowserAnnotationSelection } from './browser-annotation-dom';
import type { BrowserHostedView, BrowserCdpEventListener, BrowserAnnotationImage } from './browser-host-contract';
import { validateBrowserUrl } from './browser-view-policy';

export const BROWSER_ANNOTATION_WORLD = 'coc-browser-annotation';
export const BROWSER_ANNOTATION_POLL_MS = 100;
export type BrowserAnnotationEndReason = Extract<BrowserAnnotationEvent, { type: 'exit' }>['reason'] | 'unavailable' | 'failed';

export interface BrowserAnnotationTabSink {
    events(events: BrowserAnnotationEvent[]): void;
    ended(reason: BrowserAnnotationEndReason, error?: unknown): void;
}

type AnnotationView = Pick<BrowserHostedView, 'cdp' | 'onCdpEvent' | 'waitForCdpEvents' | 'waitForControlReady' | 'captureAnnotation'>;

/**
 * Main-only transport for one admitted URL guest and one document. The caller must resolve
 * exact ownership and settle human takeover before start; hide/close/setting changes call stop.
 * A stopped instance cannot restart. It never installs scripts on future documents.
 */
export class BrowserAnnotationTab {
    private readonly session = randomUUID();
    private readonly readiness = new AbortController();
    private readonly cdp: BrowserHostedView['cdp'];
    private contextId?: number;
    private frameId?: string;
    private closed = false;
    private off?: () => void;
    private timer?: ReturnType<typeof setInterval>;
    private starting?: Promise<boolean>;
    private polling?: Promise<void>;
    private stopping?: Promise<void>;
    private tail: Promise<unknown> = Promise.resolve();

    constructor(private readonly view: AnnotationView, private readonly sink: BrowserAnnotationTabSink,
        private readonly pollMs = BROWSER_ANNOTATION_POLL_MS,
        private readonly isAppUrl: (url: string) => boolean = () => false) {
        this.cdp = view.cdp?.bind(view);
    }

    /** True only after the isolated document confirms installation; false if revoked while starting. */
    start(): Promise<boolean> {
        if (this.closed) return Promise.resolve(false);
        if (this.starting) return this.starting;
        this.starting = this.enqueue(async () => {
            if (!this.cdp || !this.view.onCdpEvent) throw new Error('This view cannot run browser annotation.');
            await this.view.waitForControlReady?.(this.readiness.signal);
            if (this.closed) return false;
            this.off = this.view.onCdpEvent(this.onEvent);
            await this.view.waitForCdpEvents?.();
            if (this.closed) return false;
            await this.cdp('Page.enable');
            if (this.closed) return false;
            const tree = await this.cdp('Page.getFrameTree') as {
                frameTree?: { frame?: { id?: unknown; url?: unknown; mimeType?: unknown } };
            } | undefined;
            if (this.closed) return false;
            const frame = tree?.frameTree?.frame;
            const frameId = frame?.id;
            if (typeof frameId !== 'string' || !frameId) throw new Error('Annotation page has no main frame.');
            // Engine-owned document facts, never renderer toolbar hints or website DOM metadata.
            if (typeof frame?.url !== 'string' || !validateBrowserUrl(frame.url).ok
                || typeof frame.mimeType !== 'string' || !frame.mimeType.trim()
                || /^application\/(?:pdf|x-google-chrome-pdf)(?:\s*;|$)/i.test(frame.mimeType.trim())
                || /\.pdf$/i.test(new URL(frame.url).pathname) || this.isAppUrl(frame.url)) {
                throw new Error('Browser annotation is unavailable for PDFs, previews or the CoC app.');
            }
            this.frameId = frameId;
            const world = await this.cdp('Page.createIsolatedWorld', { frameId, worldName: BROWSER_ANNOTATION_WORLD }) as { executionContextId?: unknown } | undefined;
            // Retain the context even when revoked: a delayed installation must be cleaned up there only.
            if (!Number.isSafeInteger(world?.executionContextId)) throw new Error('Annotation isolated world is unavailable.');
            this.contextId = world!.executionContextId as number;
            if (this.closed) return false;
            const result = await this.evaluate('start');
            if (this.closed) return false;
            if (!result.active) throw new Error('Annotation overlay did not start.');
            this.deliver(result);
            if (this.closed) return false;
            this.timer = setInterval(() => { void this.poll(); }, this.pollMs);
            this.timer.unref?.();
            return true;
        }).catch(async error => {
            if (this.closed) return false;
            this.revoke('failed', error);
            await this.cleanup().catch(() => {});
            throw error;
        });
        return this.starting;
    }

    /** Coalesce polls; every command stays serialized with installation and teardown. */
    poll(): Promise<void> {
        if (this.closed || !this.timer) return Promise.resolve();
        if (this.polling) return this.polling;
        this.polling = this.enqueue(async () => {
            if (this.closed) return;
            const result = await this.evaluate('drain');
            if (!this.closed) this.deliver(result);
        }).catch(error => {
            if (!this.closed) {
                this.revoke('failed', error);
                void this.cleanup().catch(() => {});
            }
        }).finally(() => { this.polling = undefined; });
        return this.polling;
    }

    /** Remove a saved pin only in this active document; return deletion events through the normal sink. */
    remove(id: string): Promise<void> {
        if (!isValidBrowserAnnotationId(id)) return Promise.reject(new TypeError('Invalid browser annotation pin'));
        if (this.closed || !this.timer) return Promise.resolve();
        return this.enqueue(async () => {
            if (this.closed) return;
            const result = await this.evaluate('remove', id);
            if (!this.closed) this.deliver(result);
        }).catch(error => {
            if (!this.closed) {
                this.revoke('failed', error);
                void this.cleanup().catch(() => {});
            }
            throw error;
        });
    }

    /** Capture a freshly selected draft in this document only; never recapture saved comments on edit. */
    captureSelection(selection: BrowserAnnotationSelection): Promise<BrowserAnnotationImage> {
        return this.enqueue(async () => {
            if (this.closed || !this.timer) throw new Error('Annotation document is no longer active.');
            if (!this.view.captureAnnotation) throw new Error('This browser host cannot capture annotation images.');
            let image: BrowserAnnotationImage | undefined;
            let failure: unknown;
            let failed = false;
            try {
                const hidden = await this.evaluateCommand({ action: 'capture', session: this.session, selection, hidden: true });
                if (this.closed || !hidden.active || !hidden.capture) throw new Error('Annotation selection is stale.');
                image = await this.view.captureAnnotation(selection.rect, selection.page.viewport);
            } catch (error) { failed = true; failure = error; }
            // Always restore the original generation, including failed or revoked native captures.
            try {
                const restored = await this.evaluateCommand({ action: 'capture', session: this.session, selection, hidden: false });
                if ((this.closed || !restored.active || !restored.capture) && !failed) {
                    failed = true; failure = new Error('Annotation selection is stale.');
                }
            } catch (error) {
                if (!failed) { failed = true; failure = error; }
                if (!this.closed) {
                    this.revoke('failed', error);
                    void this.cleanup().catch(() => {});
                }
            }
            if (failed) throw failure;
            return image!;
        });
    }

    /** Revokes delivery synchronously; the returned promise includes removal after any in-flight call. */
    stop(reason: BrowserAnnotationEndReason = 'stop'): Promise<void> {
        this.revoke(reason);
        return this.cleanup();
    }

    private revoke(reason: BrowserAnnotationEndReason, error?: unknown): void {
        if (this.closed) return;
        this.closed = true;
        this.readiness.abort();
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        this.off?.();
        this.off = undefined;
        this.sink.ended(reason, error);
    }

    private cleanup(): Promise<void> {
        return this.stopping ??= this.enqueue(async () => {
            // Never create another world to stop: context ids belong to exactly one document.
            if (this.contextId !== undefined) await this.evaluate('stop');
        });
    }

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.tail.then(operation);
        this.tail = result.catch(() => {});
        return result;
    }

    private evaluate(action: 'start' | 'drain' | 'stop' | 'remove', id?: string): Promise<BrowserAnnotationResult> {
        return this.evaluateCommand(action === 'remove'
            ? { action, session: this.session, id: id! } : { action, session: this.session });
    }

    private async evaluateCommand(command: BrowserAnnotationCommand): Promise<BrowserAnnotationResult> {
        const reply = await this.cdp!('Runtime.evaluate', {
            expression: buildBrowserAnnotationExpression(command),
            contextId: this.contextId, returnByValue: true, awaitPromise: true,
        }) as { result?: { value?: unknown }; exceptionDetails?: unknown } | undefined;
        if (reply?.exceptionDetails) throw new Error('Annotation script failed in the page.');
        return parseAnnotationResult(reply?.result?.value);
    }

    private deliver(result: BrowserAnnotationResult): void {
        if (result.events.length) this.sink.events(result.events);
        if (!result.active && !this.closed) {
            const exit = result.events.find(event => event.type === 'exit');
            this.revoke(exit?.type === 'exit' ? exit.reason : 'unavailable');
            void this.cleanup().catch(() => {});
        }
    }

    private readonly onEvent: BrowserCdpEventListener = (method, params, sessionId) => {
        if (sessionId || this.closed) return;
        const frame = params.frame as { id?: unknown; parentId?: unknown } | undefined;
        const navigation = (method === 'Page.frameNavigated' && frame && !frame.parentId)
            || ((method === 'Page.frameStartedLoading' || method === 'Page.navigatedWithinDocument' || method === 'Page.frameDetached')
                && (!this.frameId || params.frameId === this.frameId));
        const gone = method === 'Runtime.executionContextsCleared' || method === 'Inspector.detached' || method === 'Target.targetCrashed'
            || (method === 'Runtime.executionContextDestroyed' && this.contextId !== undefined && params.executionContextId === this.contextId);
        if (navigation || gone) void this.stop(navigation ? 'navigation' : 'unavailable').catch(() => {});
    };
}

/** Validate the bounded isolated-world envelope before passing website metadata to a consumer. */
function parseAnnotationResult(value: unknown): BrowserAnnotationResult {
    const result = value as BrowserAnnotationResult | undefined;
    const invalid = () => { throw new Error('Annotation script returned an invalid report.'); };
    if (!result || typeof result.active !== 'boolean' || !Array.isArray(result.events) || result.events.length > 33) return invalid();
    if (result.capture !== undefined && typeof result.capture !== 'boolean') return invalid();
    // The DOM primitive bounds individual fields; this also bounds aggregate transport data.
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 1_048_576) return invalid();
    for (const event of result.events) {
        if (!event || typeof event !== 'object') return invalid();
        if (event.type === 'exit') {
            if (!['escape', 'navigation', 'removed', 'overflow', 'stop'].includes(event.reason)) return invalid();
        } else if (event.type === 'delete') {
            if (!isValidBrowserAnnotationId(event.id)) return invalid();
        } else if (event.type === 'selection' || event.type === 'comment') {
            if (event.type === 'comment' && (!isValidBrowserAnnotationId(event.id) || !Number.isInteger(event.number) || event.number < 1 || event.number > 100
                || typeof event.comment !== 'string' || !event.comment.trim()
                || event.comment.length > 8000 || event.selection?.type !== 'selection')) return invalid();
            const selection = event.type === 'comment' ? event.selection : event;
            const { rect, page, element } = selection;
            if (!['element', 'area'].includes(selection.kind) || typeof selection.immediate !== 'boolean'
                || !rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
                || rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0
                || !page || typeof page.url !== 'string' || typeof page.title !== 'string'
                || !page.viewport || ![page.viewport.width, page.viewport.height, page.viewport.devicePixelRatio].every(number => Number.isFinite(number) && number > 0)
                || rect.x + rect.width > page.viewport.width || rect.y + rect.height > page.viewport.height) return invalid();
            if (selection.kind === 'element' && (!element || !(element.selector === null || typeof element.selector === 'string')
                || !Array.isArray(element.shadowHosts) || !element.shadowHosts.every(selector => selector === null || typeof selector === 'string')
                || !Array.isArray(element.classes) || !element.classes.every(name => typeof name === 'string')
                || ![element.tag, element.id, element.text, element.outerHTML].every(text => typeof text === 'string'))) return invalid();
        } else return invalid();
    }
    return result!;
}

/** Pin IDs are canonical positive decimal safe integers, scoped to a mode generation. */
export function isValidBrowserAnnotationId(id: unknown): id is string {
    return typeof id === 'string' && /^[1-9][0-9]{0,15}$/.test(id) && Number.isSafeInteger(Number(id));
}
