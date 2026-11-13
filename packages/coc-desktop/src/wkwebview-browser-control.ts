import { BrowserHostError } from './browser-host-contract';
import type {
    BrowserControl, BrowserControlEvaluation, BrowserControlEvent, BrowserControlEventListener, BrowserControlFrameInfo, BrowserControlViewport,
} from './browser-control-engine';

/** Sends one per-view helper op; replies carry the op's `result`. */
export type WkWebViewControlRequest = (op: string, payload: Record<string, unknown>) => Promise<unknown>;

/** The top-level frame id. Child frames are not tracked yet; they are reported as unavailable. */
export const WKWEBVIEW_MAIN_FRAME = 'main';
/** Helper-only world for layout metrics, so page scripts cannot spoof the viewport. */
const CONTROL_WORLD = 'coc-control';
const STALE = 'coc-stale-context';
const PAGE = 'page';

/**
 * A per-world document token. Content worlds get fresh globals on every document, so a token
 * set in a world identifies that world's current document. Non-configurable, so pages cannot replace it.
 */
const TOKEN = `(() => { const key = Symbol.for('coc.document');
if (!Object.prototype.hasOwnProperty.call(globalThis, key)) Object.defineProperty(globalThis, key, { value: Math.random().toString(36).slice(2) + Date.now().toString(36) });
return globalThis[key]; })()`;
const DOCUMENT = `({ token: ${TOKEN}, url: location.href, origin: location.origin })`;

interface Context { id: number; world: string; token: string }
interface Document { token: string; url: string; origin: string; main: number }

function frameInfo(document: Document): BrowserControlFrameInfo {
    return { id: WKWEBVIEW_MAIN_FRAME, loaderId: document.token, url: document.url, origin: document.origin === 'null' ? 'opaque' : document.origin };
}

function unknownFrame(frameId: string): void {
    if (frameId !== WKWEBVIEW_MAIN_FRAME) throw new Error('No frame for given id found');
}

/**
 * `BrowserControl` for a WKWebView view, over the helper's `input`, content-world `evaluate`
 * and `screenshot` ops. Context ids are main-owned handles for (world, document) pairs; a call on
 * a context whose document is gone fails like a destroyed CDP context.
 */
export class WkWebViewBrowserControl implements BrowserControl {
    private readonly listeners = new Set<BrowserControlEventListener>();
    private readonly contexts = new Map<number, Context>();
    private document?: Document;
    private sequence = 0;
    private frameEvents = false;
    private contextEvents = false;
    private loading = false;
    private syncing?: Promise<Document>;
    private closed?: 'detached' | 'crashed';

    constructor(private readonly request: WkWebViewControlRequest) {}

    private emit(event: BrowserControlEvent): void {
        for (const listener of [...this.listeners]) listener(event);
    }

    private async evaluateIn(world: string, expression: string): Promise<BrowserControlEvaluation> {
        if (this.closed) throw new BrowserHostError('not-found', 'Browser tab is closed.');
        try {
            const result = await this.request('evaluate', { expression, world }) as { value?: unknown } | undefined;
            return { value: result?.value ?? null };
        } catch (error) {
            if (!(error instanceof BrowserHostError) || (error.reason as string) !== 'evaluation-failed') throw error;
            if (error.message.includes(STALE)) throw new Error('Cannot find context with specified id');
            return { exception: error.message };
        }
    }

    /** Reads the top-level document and reports a document change as navigation plus context events. */
    private sync(): Promise<Document> {
        const run = (this.syncing ?? Promise.resolve()).catch(() => undefined).then(async () => {
            const reply = await this.evaluateIn(PAGE, DOCUMENT);
            const value = reply.exception === undefined ? reply.value as Partial<Document> | null : undefined;
            if (!value || typeof value.token !== 'string' || typeof value.url !== 'string' || typeof value.origin !== 'string') {
                throw new Error('Browser frame tree unavailable');
            }
            const previous = this.document;
            if (previous?.token === value.token) {
                if (previous.url !== value.url) {
                    previous.url = value.url;
                    if (this.frameEvents) this.emit({ type: 'frame-same-document', frameId: WKWEBVIEW_MAIN_FRAME });
                }
                return previous;
            }
            const document: Document = { token: value.token, url: value.url, origin: value.origin, main: ++this.sequence };
            this.document = document;
            for (const context of [...this.contexts.values()]) {
                this.contexts.delete(context.id);
                if (this.contextEvents && previous) this.emit({ type: 'context-destroyed', context: context.id });
            }
            this.contexts.set(document.main, { id: document.main, world: PAGE, token: document.token });
            if (this.frameEvents && previous) this.emit({ type: 'frame-navigated', frame: frameInfo(document) });
            if (this.contextEvents) this.created(document);
            return document;
        });
        this.syncing = run;
        return run;
    }

    private created(document: Document): void {
        this.emit({ type: 'context-created', context: document.main, frameId: WKWEBVIEW_MAIN_FRAME, origin: document.origin, isDefault: true });
    }

    /** Called by the host for every helper state change of this view. */
    stateChanged(state: { loading: boolean; errorCode?: string }): void {
        if (this.closed) return;
        if (state.errorCode === 'runtime-crashed') { this.close('crashed'); return; }
        if (this.frameEvents && state.loading !== this.loading) {
            this.emit({ type: state.loading ? 'frame-loading' : 'frame-stopped-loading', frameId: WKWEBVIEW_MAIN_FRAME });
        }
        this.loading = state.loading;
        if (this.frameEvents || this.contextEvents) void this.sync().catch(() => undefined);
    }

    /** The view closed or its web content process ended; control calls fail from now on. */
    close(reason: 'detached' | 'crashed'): void {
        if (this.closed) return;
        this.closed = reason;
        if (reason === 'crashed') this.emit({ type: 'crashed' });
        this.emit({ type: 'detached', reason });
        this.listeners.clear();
    }

    private input(input: Record<string, unknown>): Promise<void> {
        if (this.closed) return Promise.reject(new BrowserHostError('not-found', 'Browser tab is closed.'));
        return this.request('input', { input }).then(() => undefined);
    }

    async mouse({ type, x, y, clickCount, deltaX, deltaY }: Parameters<BrowserControl['mouse']>[0]): Promise<void> {
        await this.input({ kind: 'mouse', type, x, y, ...defined({ clickCount, deltaX, deltaY }) });
    }

    async key({ type, key, code, modifiers, text, unmodifiedText, commands }: Parameters<BrowserControl['key']>[0]): Promise<void> {
        await this.input({ kind: 'key', type, ...defined({ key, code, modifiers, text, unmodifiedText, commands }) });
    }

    async insertText(text: string): Promise<void> {
        await this.input({ kind: 'text', text });
    }

    async evaluate(expression: string, options: Parameters<BrowserControl['evaluate']>[1] = {}): Promise<BrowserControlEvaluation> {
        if (options.target !== undefined) throw new Error('No target with given id found');
        if (options.context === undefined) return this.evaluateIn(PAGE, expression);
        const context = this.contexts.get(options.context);
        if (!context) throw new Error('Cannot find context with specified id');
        // Checked in the same call, so a navigation between check and run cannot redirect it.
        return this.evaluateIn(context.world, `(() => { if (${TOKEN} !== ${JSON.stringify(context.token)}) throw new Error(${JSON.stringify(STALE)}); })();
(0, eval)(${JSON.stringify(expression)})`);
    }

    async callOnFrameOwner(frameId: string): Promise<BrowserControlEvaluation | undefined> {
        unknownFrame(frameId);
        // The top-level frame has no owner element.
        return undefined;
    }

    async createIsolatedWorld(frameId: string, worldName: string, target?: string): Promise<number> {
        unknownFrame(frameId);
        if (target !== undefined) throw new Error('No target with given id found');
        const document = await this.sync();
        const reply = await this.evaluateIn(worldName, TOKEN);
        if (reply.exception !== undefined || typeof reply.value !== 'string' || this.document !== document) throw new Error('Isolated world is unavailable.');
        const id = ++this.sequence;
        this.contexts.set(id, { id, world: worldName, token: reply.value });
        // The page world token proves the isolated world token belongs to the same document.
        if ((await this.sync()) !== document) throw new Error('Isolated world is unavailable.');
        return id;
    }

    async addDocumentStartScript(): Promise<string> {
        throw new Error('unsupported-runtime: WKWebView document-start scripts are not available yet');
    }

    async removeDocumentStartScript(): Promise<void> {
        throw new Error('unsupported-runtime: WKWebView document-start scripts are not available yet');
    }

    async frameTree(target?: string) {
        if (target !== undefined) throw new Error('No target with given id found');
        return { frame: frameInfo(await this.sync()) };
    }

    async enableFrameEvents(target?: string): Promise<void> {
        if (target !== undefined) throw new Error('No target with given id found');
        this.frameEvents = true;
    }

    async disableFrameEvents(): Promise<void> { this.frameEvents = false; }

    async enableContextEvents(target?: string): Promise<void> {
        if (target !== undefined) throw new Error('No target with given id found');
        if (this.contextEvents) return;
        const known = !!this.document;
        this.contextEvents = true;
        const document = await this.sync();
        // A first sync already reported it.
        if (known) this.created(document);
    }

    async disableContextEvents(): Promise<void> { this.contextEvents = false; }

    /** Child frames are not separate targets on WKWebView. */
    async setChildFrameAttach(): Promise<void> {}

    async detachTarget(): Promise<void> {}

    async layoutMetrics(): Promise<BrowserControlViewport> {
        const reply = await this.evaluateIn(CONTROL_WORLD, `(() => { const view = window.visualViewport;
return view ? { clientWidth: view.width, clientHeight: view.height, pageX: view.pageLeft, pageY: view.pageTop }
    : { clientWidth: document.documentElement.clientWidth, clientHeight: document.documentElement.clientHeight, pageX: scrollX, pageY: scrollY }; })()`);
        const viewport = reply.exception === undefined ? reply.value as BrowserControlViewport | null : undefined;
        if (!viewport || ![viewport.clientWidth, viewport.clientHeight, viewport.pageX, viewport.pageY].every(Number.isFinite)) throw new Error('Browser viewport unavailable');
        return viewport;
    }

    async screenshot({ format, quality, clip }: Parameters<BrowserControl['screenshot']>[0]): Promise<string> {
        // CDP clips are page coordinates; the helper captures viewport coordinates.
        const { pageX, pageY } = await this.layoutMetrics();
        const result = await this.request('screenshot', {
            rect: { x: clip.x - pageX, y: clip.y - pageY, width: clip.width, height: clip.height }, scale: clip.scale, format, ...defined({ quality }),
        }) as { data?: unknown } | undefined;
        if (typeof result?.data !== 'string' || !result.data) throw new Error('Browser screenshot returned no image');
        return result.data;
    }

    /** The helper reports the panel as key to WebKit only; it never takes keyboard focus. */
    async setFocusEmulation(enabled: boolean): Promise<void> {
        if (this.closed) throw new BrowserHostError('not-found', 'Browser tab is closed.');
        await this.request('focus-emulation', { enabled });
    }

    onEvent(listener: BrowserControlEventListener): () => void {
        if (this.closed) throw new Error('Browser frame debugger unavailable');
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
}

function defined(value: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
