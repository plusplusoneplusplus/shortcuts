/**
 * Engine-neutral browser control. Shared control, frame and annotation code talks to this
 * interface only; each engine adapter maps it onto its own transport (CDP for Electron and
 * WebView2, the native helper for WKWebView). Every call stays in the main process.
 *
 * `target` is an opaque engine-owned identity for an out-of-process child frame target
 * (a CDP session for Chromium engines). Omitted means the view's top-level target.
 */

export interface BrowserControlFrameInfo {
    id: string;
    parentId?: string;
    name?: string;
    /** Security origin, `opaque` or empty when unknown. */
    origin?: string;
    /** Changes when the frame commits a new document. */
    loaderId?: string;
    url?: string;
    mimeType?: string;
}

export interface BrowserControlFrameTree {
    frame: BrowserControlFrameInfo;
    children?: BrowserControlFrameTree[];
}

export type BrowserControlEvent =
    | { type: 'target-attached'; target: string; frameId: string; parentTarget?: string }
    | { type: 'target-detached'; target: string }
    | { type: 'frame-attached'; frameId: string; parentFrameId?: string; target?: string }
    | { type: 'frame-navigated'; frame: BrowserControlFrameInfo; target?: string }
    | { type: 'frame-same-document'; frameId: string; target?: string }
    /** `swapped` frames move to another process and stay in the tree. */
    | { type: 'frame-detached'; frameId: string; swapped: boolean; target?: string }
    | { type: 'frame-loading'; frameId: string; target?: string }
    | { type: 'frame-stopped-loading'; frameId: string; target?: string }
    | { type: 'context-created'; context: number; frameId?: string; origin?: string; isDefault: boolean; target?: string }
    | { type: 'context-destroyed'; context: number; target?: string }
    | { type: 'contexts-cleared'; target?: string }
    | { type: 'crashed'; target?: string }
    /** The control transport itself is gone (detached or its renderer crashed). */
    | { type: 'detached'; reason: 'detached' | 'crashed' };

export type BrowserControlEventListener = (event: BrowserControlEvent) => void;

/** A script result: a returned `value` (possibly absent) or the page exception text. */
export type BrowserControlEvaluation = { value?: unknown; exception?: undefined } | { exception: string };

export interface BrowserControlEvaluateOptions {
    /** Execution context (isolated world or frame default context); omitted means the main world of `target`. */
    context?: number;
    target?: string;
    awaitPromise?: boolean;
}

export interface BrowserControlMouseInput {
    type: 'move' | 'down' | 'up' | 'wheel';
    x: number;
    y: number;
    button?: 'left';
    clickCount?: number;
    deltaX?: number;
    deltaY?: number;
    target?: string;
}

export interface BrowserControlKeyInput {
    /** `up` is a release: it is always dispatched, even after cancellation. */
    type: 'down' | 'up' | 'char';
    key?: string;
    code?: string;
    keyCode?: number;
    /** Bit mask: 1 Alt, 2 Control, 4 Meta, 8 Shift. */
    modifiers?: number;
    text?: string;
    unmodifiedText?: string;
    /** Editing commands (macOS) the key performs. */
    commands?: string[];
}

export interface BrowserControlViewport {
    clientWidth: number;
    clientHeight: number;
    pageX: number;
    pageY: number;
}

export interface BrowserControlScreenshotRequest {
    format: 'jpeg' | 'png';
    quality?: number;
    /** CSS pixels in page coordinates; `scale` multiplies device pixels. */
    clip: { x: number; y: number; width: number; height: number; scale: number };
}

export interface BrowserControl {
    mouse(input: BrowserControlMouseInput): Promise<void>;
    key(input: BrowserControlKeyInput): Promise<void>;
    insertText(text: string): Promise<void>;

    evaluate(expression: string, options?: BrowserControlEvaluateOptions): Promise<BrowserControlEvaluation>;
    /**
     * Calls `functionDeclaration` with `this` bound to the element that owns frame `frameId`,
     * inside the parent's `context`. Resolves undefined when the parent does not own the frame.
     */
    callOnFrameOwner(frameId: string, parent: { context?: number; target?: string }, functionDeclaration: string, args: unknown[]): Promise<BrowserControlEvaluation | undefined>;
    /** A fresh isolated world in one frame's current document; returns its context id. */
    createIsolatedWorld(frameId: string, worldName: string, target?: string): Promise<number>;
    addDocumentStartScript(source: string, worldName?: string): Promise<string>;
    removeDocumentStartScript(id: string): Promise<void>;

    frameTree(target?: string): Promise<BrowserControlFrameTree>;
    enableFrameEvents(target?: string): Promise<void>;
    disableFrameEvents(): Promise<void>;
    enableContextEvents(target?: string): Promise<void>;
    disableContextEvents(): Promise<void>;
    /** Attach related out-of-process child frames as `target-attached` events; never browser-wide discovery. */
    setChildFrameAttach(enabled: boolean, target?: string): Promise<void>;
    detachTarget(target: string, parentTarget?: string): Promise<void>;

    /** CSS visual viewport of the top-level document. */
    layoutMetrics(): Promise<BrowserControlViewport>;
    /** Base64 image data. */
    screenshot(request: BrowserControlScreenshotRequest): Promise<string>;
    /** Pages behave as focused while background control drives them. */
    setFocusEmulation(enabled: boolean): Promise<void>;

    onEvent(listener: BrowserControlEventListener): () => void;
    /** Resolves once subscribed events are flowing. */
    waitForEvents?(): Promise<void>;
}


const CONTROL_CALLS = [
    'mouse', 'key', 'insertText', 'evaluate', 'callOnFrameOwner', 'createIsolatedWorld', 'addDocumentStartScript',
    'removeDocumentStartScript', 'frameTree', 'enableFrameEvents', 'disableFrameEvents', 'enableContextEvents',
    'disableContextEvents', 'setChildFrameAttach', 'detachTarget', 'layoutMetrics', 'screenshot', 'setFocusEmulation',
] as const satisfies ReadonlyArray<Exclude<keyof BrowserControl, 'onEvent' | 'waitForEvents'>>;

/** Whether a call is an input release, which must always complete once its press was dispatched. */
export function isBrowserControlRelease(call: keyof BrowserControl, args: readonly unknown[]): boolean {
    return (call === 'mouse' || call === 'key') && (args[0] as { type?: string } | undefined)?.type === 'up';
}

/**
 * A control that resolves its engine on every call and runs `before` first (cancellation,
 * input revision checks). Event subscription bypasses `before`.
 */
export function lazyBrowserControl(resolve: () => BrowserControl, before?: (call: keyof BrowserControl, args: readonly unknown[]) => void): BrowserControl {
    const control = Object.fromEntries(CONTROL_CALLS.map(call => [call, async (...args: unknown[]) => {
        before?.(call, args);
        const target = resolve();
        return (target[call] as (...values: unknown[]) => Promise<unknown>).apply(target, args);
    }])) as unknown as BrowserControl;
    control.onEvent = listener => resolve().onEvent(listener);
    control.waitForEvents = async () => {
        const target = resolve();
        await target.waitForEvents?.();
    };
    return control;
}
