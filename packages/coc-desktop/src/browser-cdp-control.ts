import type { BrowserCdpEventListener, BrowserHostedView } from './browser-host-contract';
import type {
    BrowserControl, BrowserControlEvaluation, BrowserControlEvent, BrowserControlFrameInfo, BrowserControlFrameTree,
    BrowserControlKeyInput, BrowserControlMouseInput, BrowserControlViewport,
} from './browser-control-engine';

/** The main-only CDP transport of a Chromium engine view (Electron debugger or the WebView2 helper). */
export interface BrowserCdpTransport {
    cdp(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>;
    onCdpEvent?(listener: BrowserCdpEventListener): () => void;
    waitForCdpEvents?(): Promise<void>;
}

interface CdpFrame { id?: unknown; parentId?: unknown; name?: unknown; securityOrigin?: unknown; loaderId?: unknown; url?: unknown; mimeType?: unknown }
interface CdpFrameTree { frame?: CdpFrame; childFrames?: CdpFrameTree[] }
interface CdpEvaluation { result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } } }

const MOUSE_TYPES = { move: 'mouseMoved', down: 'mousePressed', up: 'mouseReleased', wheel: 'mouseWheel' } as const;
const KEY_TYPES = { down: 'keyDown', up: 'keyUp', char: 'char' } as const;

const text = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;

function frameInfo(frame: CdpFrame): BrowserControlFrameInfo {
    return { id: String(frame.id), parentId: text(frame.parentId), name: text(frame.name), origin: text(frame.securityOrigin),
        loaderId: text(frame.loaderId), url: text(frame.url), mimeType: text(frame.mimeType) };
}

function frameTree(node: CdpFrameTree): BrowserControlFrameTree {
    return { frame: frameInfo(node.frame!), children: node.childFrames?.filter(child => child.frame?.id).map(frameTree) };
}

function evaluation(reply: unknown): BrowserControlEvaluation {
    const { result, exceptionDetails } = (reply ?? {}) as CdpEvaluation;
    if (exceptionDetails) return { exception: exceptionDetails.exception?.description || exceptionDetails.text || '' };
    return result && 'value' in result ? { value: result.value } : {};
}

/** Maps one CDP event to the engine-neutral event, or undefined when control does not use it. */
export function browserControlEventFromCdp(method: string, params: Record<string, unknown>, session?: string): BrowserControlEvent | undefined {
    const target = session === undefined ? {} : { target: session };
    const frameId = text(params.frameId);
    switch (method) {
        case 'Target.attachedToTarget': {
            const info = params.targetInfo as { type?: string; targetId?: string } | undefined;
            if (info?.type !== 'iframe' || typeof params.sessionId !== 'string' || !info.targetId) return undefined;
            return { type: 'target-attached', target: params.sessionId, frameId: info.targetId, ...(session === undefined ? {} : { parentTarget: session }) };
        }
        case 'Target.detachedFromTarget': return { type: 'target-detached', target: String(params.sessionId) };
        case 'Page.frameAttached': return frameId ? { type: 'frame-attached', frameId, parentFrameId: String(params.parentFrameId), ...target } : undefined;
        case 'Page.frameNavigated': {
            const frame = params.frame as CdpFrame | undefined;
            return frame?.id ? { type: 'frame-navigated', frame: frameInfo(frame), ...target } : undefined;
        }
        case 'Page.navigatedWithinDocument': return frameId ? { type: 'frame-same-document', frameId, ...target } : undefined;
        case 'Page.frameDetached': return frameId ? { type: 'frame-detached', frameId, swapped: params.reason === 'swap', ...target } : undefined;
        case 'Page.frameStartedLoading': return frameId ? { type: 'frame-loading', frameId, ...target } : undefined;
        case 'Page.frameStoppedLoading': return frameId ? { type: 'frame-stopped-loading', frameId, ...target } : undefined;
        case 'Runtime.executionContextCreated': {
            const context = params.context as { id?: unknown; origin?: string; auxData?: { frameId?: string; isDefault?: boolean } } | undefined;
            if (typeof context?.id !== 'number') return undefined;
            return { type: 'context-created', context: context.id, frameId: context.auxData?.frameId, origin: context.origin,
                isDefault: context.auxData?.isDefault === true, ...target };
        }
        case 'Runtime.executionContextDestroyed':
            return typeof params.executionContextId === 'number' ? { type: 'context-destroyed', context: params.executionContextId, ...target } : undefined;
        case 'Runtime.executionContextsCleared': return { type: 'contexts-cleared', ...target };
        case 'Target.targetCrashed': return { type: 'crashed', ...target };
        case 'Inspector.detached': return { type: 'detached', reason: 'detached' };
        case 'Inspector.targetCrashed': return { type: 'detached', reason: 'crashed' };
        default: return undefined;
    }
}

/** `BrowserControl` for Chromium engines: every call is the CDP command the shared code used before. */
export function createCdpBrowserControl(transport: BrowserCdpTransport): BrowserControl {
    const send = (method: string, params?: Record<string, unknown>, session?: string): Promise<unknown> =>
        session === undefined ? transport.cdp(method, params) : transport.cdp(method, params, session);
    return {
        async mouse(input: BrowserControlMouseInput) {
            const { type, target, ...rest } = input;
            await send('Input.dispatchMouseEvent', { type: MOUSE_TYPES[type], ...defined(rest) }, target);
        },
        async key(input: BrowserControlKeyInput) {
            const { type, keyCode, ...rest } = input;
            await send('Input.dispatchKeyEvent', defined({ type: KEY_TYPES[type], ...rest, windowsVirtualKeyCode: keyCode }));
        },
        async insertText(value) { await send('Input.insertText', { text: value }); },
        async evaluate(expression, options = {}) {
            return evaluation(await send('Runtime.evaluate', defined({ expression, contextId: options.context, returnByValue: true,
                awaitPromise: options.awaitPromise }), options.target));
        },
        async callOnFrameOwner(frameId, parent, functionDeclaration, args) {
            const owner = await send('DOM.getFrameOwner', { frameId }, parent.target) as { backendNodeId?: number } | undefined;
            if (!owner?.backendNodeId) return undefined;
            const resolved = await send('DOM.resolveNode', { backendNodeId: owner.backendNodeId, executionContextId: parent.context }, parent.target) as { object?: { objectId?: string } } | undefined;
            const objectId = resolved?.object?.objectId;
            if (!objectId) return undefined;
            try {
                return evaluation(await send('Runtime.callFunctionOn', { objectId, functionDeclaration, returnByValue: true,
                    ...(args.length ? { arguments: args.map(value => ({ value })) } : {}) }, parent.target));
            } finally {
                await send('Runtime.releaseObject', { objectId }, parent.target);
            }
        },
        async createIsolatedWorld(frameId, worldName, target) {
            const world = await send('Page.createIsolatedWorld', { frameId, worldName }, target) as { executionContextId?: unknown } | undefined;
            if (!Number.isSafeInteger(world?.executionContextId)) throw new Error('Isolated world is unavailable.');
            return world!.executionContextId as number;
        },
        async addDocumentStartScript(source, worldName) {
            const reply = await send('Page.addScriptToEvaluateOnNewDocument', defined({ source, worldName })) as { identifier?: unknown } | undefined;
            if (typeof reply?.identifier !== 'string') throw new Error('Document script registration failed.');
            return reply.identifier;
        },
        async removeDocumentStartScript(identifier) { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier }); },
        async frameTree(target) {
            const tree = await send('Page.getFrameTree', {}, target) as { frameTree?: CdpFrameTree } | undefined;
            if (!tree?.frameTree?.frame?.id) throw new Error('Browser frame tree unavailable');
            return frameTree(tree.frameTree);
        },
        async enableFrameEvents(target) { await send('Page.enable', {}, target); },
        async disableFrameEvents() { await send('Page.disable'); },
        async enableContextEvents(target) { await send('Runtime.enable', {}, target); },
        async disableContextEvents() { await send('Runtime.disable'); },
        async setChildFrameAttach(enabled, target) {
            await send('Target.setAutoAttach', enabled
                ? { autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{ type: 'iframe', exclude: false }, { exclude: true }] }
                : { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }, target);
        },
        async detachTarget(target, parentTarget) { await send('Target.detachFromTarget', { sessionId: target }, parentTarget); },
        async layoutMetrics(): Promise<BrowserControlViewport> {
            const metrics = await send('Page.getLayoutMetrics') as { cssVisualViewport?: BrowserControlViewport; visualViewport?: BrowserControlViewport } | undefined;
            const viewport = metrics?.cssVisualViewport ?? metrics?.visualViewport;
            if (!viewport) throw new Error('Browser viewport unavailable');
            return viewport;
        },
        async screenshot({ format, quality, clip }) {
            const result = await send('Page.captureScreenshot', { format, ...(quality === undefined ? {} : { quality }), captureBeyondViewport: true, clip }) as { data?: string } | undefined;
            if (!result?.data) throw new Error('Browser screenshot returned no image');
            return result.data;
        },
        async setFocusEmulation(enabled) { await send('Emulation.setFocusEmulationEnabled', { enabled }); },
        onEvent(listener) {
            if (!transport.onCdpEvent) throw new Error('unsupported-runtime: frame event transport unavailable');
            return transport.onCdpEvent((method, params, session) => {
                const event = browserControlEventFromCdp(method, params ?? {}, session);
                if (event) listener(event);
            });
        },
        ...(transport.waitForCdpEvents ? { waitForEvents: () => transport.waitForCdpEvents!() } : {}),
    };
}

function defined<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

/** Attaches the CDP-backed `control` to a Chromium engine view. */
export function withCdpControl<T extends BrowserCdpTransport & Partial<BrowserHostedView>>(view: T): T & { readonly control: BrowserControl } {
    return Object.assign(view, { control: createCdpBrowserControl(view) });
}
