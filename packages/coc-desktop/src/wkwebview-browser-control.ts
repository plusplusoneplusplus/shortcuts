import { BrowserHostError } from './browser-host-contract';
import type {
    BrowserControl, BrowserControlEvaluation, BrowserControlEvent, BrowserControlEventListener, BrowserControlFrameInfo, BrowserControlFrameTree,
    BrowserControlViewport,
} from './browser-control-engine';

/** Sends one per-view helper op; replies carry the op's `result`. */
export type WkWebViewControlRequest = (op: string, payload: Record<string, unknown>) => Promise<unknown>;

/** The top-level frame id; child frame ids come from the helper's frame tracker. */
export const WKWEBVIEW_MAIN_FRAME = 'main';
/** Helper-only world for layout metrics, so page scripts cannot spoof the viewport. */
const CONTROL_WORLD = 'coc-control';
/** The helper's frame-tracking world: its per-document token and frame owner elements live there. */
const FRAME_WORLD = 'coc-frames';
const FRAME_TOKEN = `globalThis[Symbol.for('coc.frame')]?.token ?? null`;
const MAX_FRAMES = 256;
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

interface Context { id: number; world: string; token: string; frame: string }
interface Document { token: string; url: string; origin: string; main: number }
/** A child frame's current document; replaced (never mutated) when the frame commits a new one. */
interface ChildFrame { id: string; parentId: string; owner: number; token: string; url: string; origin: string; name: string }

/** A `frame-navigated` event or `frames` entry from the helper. */
export interface WkWebViewFrameMessage { frameId?: unknown; parentFrameId?: unknown; owner?: unknown; token?: unknown; url?: unknown; origin?: unknown; name?: unknown }

function opaque(origin: string): string {
    return origin === 'null' ? 'opaque' : origin;
}

function frameInfo(document: Document): BrowserControlFrameInfo {
    return { id: WKWEBVIEW_MAIN_FRAME, loaderId: document.token, url: document.url, origin: opaque(document.origin) };
}

function childInfo(frame: ChildFrame): BrowserControlFrameInfo {
    return { id: frame.id, parentId: frame.parentId, loaderId: frame.token, url: frame.url, origin: opaque(frame.origin), name: frame.name };
}

function childFrame(message: WkWebViewFrameMessage): ChildFrame | undefined {
    const { frameId, parentFrameId, owner, token, url, origin, name } = message;
    if (typeof frameId !== 'string' || frameId === WKWEBVIEW_MAIN_FRAME || frameId.length > 512 || typeof parentFrameId !== 'string'
        || typeof owner !== 'number' || !Number.isSafeInteger(owner) || owner <= 0 || typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)
        || typeof url !== 'string' || typeof origin !== 'string') return undefined;
    return { id: frameId, parentId: parentFrameId, owner, token, url: url.slice(0, 8192), origin: origin.slice(0, 256), name: typeof name === 'string' ? name.slice(0, 1024) : '' };
}

function unavailable(): Error {
    return new Error('Isolated world is unavailable.');
}

type HeldFrameEvent = [event: 'frame-navigated' | 'frame-detached', message: WkWebViewFrameMessage];

/**
 * `BrowserControl` for a WKWebView view, over the helper's `input`, content-world `evaluate`
 * and `screenshot` ops. Context ids are main-owned handles for (world, document) pairs; a call on
 * a context whose document is gone fails like a destroyed CDP context.
 */
export class WkWebViewBrowserControl implements BrowserControl {
    private readonly listeners = new Set<BrowserControlEventListener>();
    private readonly contexts = new Map<number, Context>();
    private readonly children = new Map<string, ChildFrame>();
    private mainFrameToken?: string;
    private document?: Document;
    private sequence = 0;
    private frameEvents = false;
    private contextEvents = false;
    private loading = false;
    private syncing?: Promise<Document>;
    /** Frame events that arrived while a new top-level document was being synced. */
    private heldFrameEvents?: HeldFrameEvent[];
    private closed?: 'detached' | 'crashed';

    constructor(private readonly request: WkWebViewControlRequest) {}

    private emit(event: BrowserControlEvent): void {
        for (const listener of [...this.listeners]) listener(event);
    }

    /** `then` post-processes the expression's value; `guard` runs first in the same call. Both are helper-side, so no page `eval` is involved. */
    private async evaluateIn(world: string, expression: string, frame = WKWEBVIEW_MAIN_FRAME, extra: { then?: string; guard?: string } = {}): Promise<BrowserControlEvaluation> {
        if (this.closed) throw new BrowserHostError('not-found', 'Browser tab is closed.');
        try {
            const result = await this.request('evaluate', { expression, world, ...(frame === WKWEBVIEW_MAIN_FRAME ? {} : { frame }), ...defined(extra) }) as { value?: unknown } | undefined;
            return { value: result?.value ?? null };
        } catch (error) {
            // The frame's owner element is gone, and with it every context in the frame.
            if (error instanceof BrowserHostError && error.reason === 'invalid' && error.message.startsWith('No frame')) {
                throw new Error('Cannot find context with specified id');
            }
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
            // Child frames retire through the helper's own frame-detached events.
            this.retireContexts(WKWEBVIEW_MAIN_FRAME, !!previous);
            this.contexts.set(document.main, { id: document.main, world: PAGE, token: document.token, frame: WKWEBVIEW_MAIN_FRAME });
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

    private retireContexts(frameId: string, report = true): void {
        for (const context of [...this.contexts.values()]) {
            if (context.frame !== frameId) continue;
            this.contexts.delete(context.id);
            if (this.contextEvents && report) this.emit({ type: 'context-destroyed', context: context.id });
        }
    }

    /** Called by the host for the helper's `frame-navigated` and `frame-detached` events of this view. */
    frameEvent(event: 'frame-navigated' | 'frame-detached', message: WkWebViewFrameMessage): void {
        if (this.closed) return;
        if (this.heldFrameEvents) {
            this.heldFrameEvents.push([event, message]);
            return;
        }
        if (event === 'frame-detached') {
            if (typeof message.frameId === 'string') this.detach(message.frameId);
            return;
        }
        if (message.frameId === WKWEBVIEW_MAIN_FRAME) {
            if (typeof message.token !== 'string' || message.token === this.mainFrameToken) return;
            const previous = this.mainFrameToken;
            this.mainFrameToken = message.token;
            // CDP reports a top-level navigation before the new document's child frames, and the
            // frame registry retires all children on it; hold child events until it is reported.
            if (previous === undefined || !(this.frameEvents || this.contextEvents)) return;
            const held: HeldFrameEvent[] = [];
            this.heldFrameEvents = held;
            void this.sync().catch(() => undefined).then(() => {
                if (this.heldFrameEvents !== held) return;
                this.heldFrameEvents = undefined;
                for (const [index, [heldEvent, heldMessage]] of held.entries()) {
                    this.frameEvent(heldEvent, heldMessage);
                    // A held top-level navigation starts holding again; keep the rest in order.
                    const holding = this.heldFrameEvents as HeldFrameEvent[] | undefined;
                    if (holding) {
                        holding.push(...held.slice(index + 1));
                        return;
                    }
                }
            });
            return;
        }
        const frame = childFrame(message);
        if (frame) this.navigated(frame);
    }

    private navigated(frame: ChildFrame): void {
        const previous = this.children.get(frame.id);
        if (previous?.token === frame.token) return;
        if (!previous && this.children.size >= MAX_FRAMES) return;
        if (previous) this.retireContexts(frame.id);
        this.children.set(frame.id, frame);
        if (this.frameEvents) {
            if (!previous) this.emit({ type: 'frame-attached', frameId: frame.id, parentFrameId: frame.parentId });
            this.emit({ type: 'frame-navigated', frame: childInfo(frame) });
        }
        if (this.contextEvents) void this.defaultContext(frame).catch(() => undefined);
    }

    private detach(frameId: string): void {
        if (!this.children.has(frameId)) return;
        for (const child of [...this.children.values()]) if (child.parentId === frameId) this.detach(child.id);
        this.children.delete(frameId);
        this.retireContexts(frameId);
        if (this.frameEvents) this.emit({ type: 'frame-detached', frameId, swapped: false });
    }

    /** Establishes and reports a child document's page-world context. */
    private async defaultContext(frame: ChildFrame): Promise<void> {
        const context = await this.childContext(frame, PAGE);
        if (this.contextEvents && this.contexts.has(context)) {
            this.emit({ type: 'context-created', context, frameId: frame.id, origin: frame.origin, isDefault: true });
        }
    }

    /**
     * A context for one world of a child frame's current document. The frame world's token proves
     * the world token was read from the document main knows, not from a later one.
     */
    private async childContext(frame: ChildFrame, world: string): Promise<number> {
        const reply = await this.evaluateIn(world, TOKEN, frame.id);
        if (reply.exception !== undefined || typeof reply.value !== 'string') throw unavailable();
        const check = await this.evaluateIn(FRAME_WORLD, FRAME_TOKEN, frame.id);
        if (check.exception !== undefined || check.value !== frame.token || this.children.get(frame.id) !== frame) throw unavailable();
        const id = ++this.sequence;
        this.contexts.set(id, { id, world, token: reply.value, frame: frame.id });
        return id;
    }

    /** Reconciles with the helper's frame snapshot; earlier events are already applied, as replies follow them in order. */
    private async snapshot(): Promise<void> {
        const reply = await this.request('frames', {}) as { frames?: unknown } | undefined;
        if (!Array.isArray(reply?.frames)) throw new Error('Browser frame tree unavailable');
        const current = new Set<string>();
        for (const message of reply.frames.slice(0, MAX_FRAMES + 1) as WkWebViewFrameMessage[]) {
            if (message?.frameId === WKWEBVIEW_MAIN_FRAME) {
                if (typeof message.token === 'string') this.mainFrameToken = message.token;
                continue;
            }
            const frame = childFrame(message ?? {});
            if (!frame) continue;
            current.add(frame.id);
            this.navigated(frame);
        }
        for (const id of [...this.children.keys()]) if (!current.has(id)) this.detach(id);
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
        // The page world's CSP may refuse `eval`, so user source and the context check go to the helper apart.
        const [script, then] = options.source === undefined ? [expression, undefined] : [options.source, expression];
        if (options.context === undefined) return this.evaluateIn(PAGE, script, WKWEBVIEW_MAIN_FRAME, { then });
        const context = this.contexts.get(options.context);
        if (!context) throw new Error('Cannot find context with specified id');
        // Checked in the same call, so a navigation between check and run cannot redirect it.
        return this.evaluateIn(context.world, script, context.frame,
            { then, guard: `if (${TOKEN} !== ${JSON.stringify(context.token)}) throw new Error(${JSON.stringify(STALE)});` });
    }

    private child(frameId: string): ChildFrame | undefined {
        if (frameId === WKWEBVIEW_MAIN_FRAME) return undefined;
        const frame = this.children.get(frameId);
        if (!frame) throw new Error('No frame for given id found');
        return frame;
    }

    async callOnFrameOwner(frameId: string, parent: { context?: number; target?: string }, functionDeclaration: string, args: unknown[]): Promise<BrowserControlEvaluation | undefined> {
        const frame = this.child(frameId);
        // The top-level frame has no owner element.
        if (!frame) return undefined;
        if (parent.target !== undefined) throw new Error('No target with given id found');
        if (parent.context !== undefined) {
            const context = this.contexts.get(parent.context);
            if (!context) throw new Error('Cannot find context with specified id');
            if (context.frame !== frame.parentId) return undefined;
        }
        const parentToken = frame.parentId === WKWEBVIEW_MAIN_FRAME ? this.mainFrameToken : this.children.get(frame.parentId)?.token;
        if (!parentToken) throw new Error('Cannot find context with specified id');
        // Owner elements are per-world wrappers, so the call runs in the frame world of the parent's known document.
        const reply = await this.evaluateIn(FRAME_WORLD, `(() => { const frame = globalThis[Symbol.for('coc.frame')];
if (!frame || frame.token !== ${JSON.stringify(parentToken)}) throw new Error(${JSON.stringify(STALE)});
const owner = frame.owner(${frame.owner});
return owner ? { owned: true, value: (${functionDeclaration}).apply(owner, ${JSON.stringify(args)}) } : { owned: false }; })()`, frame.parentId);
        if (reply.exception !== undefined) return reply;
        const result = reply.value as { owned?: unknown; value?: unknown } | null;
        return result?.owned === true ? { value: result.value } : undefined;
    }

    async createIsolatedWorld(frameId: string, worldName: string, target?: string): Promise<number> {
        const frame = this.child(frameId);
        if (target !== undefined) throw new Error('No target with given id found');
        if (frame) return this.childContext(frame, worldName);
        const document = await this.sync();
        const reply = await this.evaluateIn(worldName, TOKEN);
        if (reply.exception !== undefined || typeof reply.value !== 'string' || this.document !== document) throw unavailable();
        const id = ++this.sequence;
        this.contexts.set(id, { id, world: worldName, token: reply.value, frame: WKWEBVIEW_MAIN_FRAME });
        // The page world token proves the isolated world token belongs to the same document.
        if ((await this.sync()) !== document) throw unavailable();
        return id;
    }

    async addDocumentStartScript(): Promise<string> {
        throw new Error('unsupported-runtime: WKWebView document-start scripts are not available yet');
    }

    async removeDocumentStartScript(): Promise<void> {
        throw new Error('unsupported-runtime: WKWebView document-start scripts are not available yet');
    }

    async frameTree(target?: string): Promise<BrowserControlFrameTree> {
        if (target !== undefined) throw new Error('No target with given id found');
        const document = await this.sync();
        // Read in a helper-only world: page scripts can redefine `document.contentType` in theirs.
        const type = await this.evaluateIn(CONTROL_WORLD, 'document.contentType');
        await this.snapshot();
        if ((await this.sync()) !== document) throw new Error('Browser frame tree unavailable');
        const children = (parentId: string, depth: number): BrowserControlFrameTree[] => depth > 8 ? [] : [...this.children.values()]
            .filter(frame => frame.parentId === parentId)
            .map(frame => ({ frame: childInfo(frame), children: children(frame.id, depth + 1) }));
        const mimeType = type.exception === undefined && typeof type.value === 'string' ? type.value : undefined;
        return { frame: { ...frameInfo(document), ...(mimeType ? { mimeType } : {}) }, children: children(WKWEBVIEW_MAIN_FRAME, 1) };
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
        await Promise.all([...this.children.values()].map(frame => this.defaultContext(frame).catch(() => undefined)));
    }

    async disableContextEvents(): Promise<void> { this.contextEvents = false; }

    /** Child frames share the view's target on WKWebView. */
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

    /** From the helper: the page's devicePixelRatio leaves page zoom out before macOS 26. */
    async pixelRatio(): Promise<number> {
        const result = await this.request('pixel-ratio', {}) as { value?: unknown } | undefined;
        if (typeof result?.value !== 'number' || !Number.isFinite(result.value) || result.value <= 0) throw new Error('Browser pixel ratio unavailable');
        return result.value;
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
