// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BROWSER_DEMO_DRAIN, BROWSER_DEMO_WORLD, type BrowserDemoAction } from '../src/browser-demo-capture';
import { BrowserDemoTabCapture, BrowserDemoUnavailableError } from '../src/browser-demo-tab-capture';
import type { BrowserDemoGapReason } from '../src/browser-demo-session';

const realAdd = window.addEventListener.bind(window);
const added: [string, EventListener][] = [];

/** Evaluate in jsdom; jsdom cannot mint trusted events, so the recorder's listeners see them as trusted. */
function evaluate(expression: string): unknown {
    window.addEventListener = ((type: string, listener: EventListener, options?: AddEventListenerOptions) => {
        const wrapped: EventListener = event => listener(new Proxy(event, {
            get(target, key) {
                if (key === 'isTrusted') return true;
                const value = Reflect.get(target, key, target);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        }));
        added.push([type, wrapped]);
        realAdd(type, wrapped, options);
    }) as typeof window.addEventListener;
    try { return window.eval(expression); } finally { window.addEventListener = realAdd as typeof window.addEventListener; }
}

interface FakeOptions {
    frames?: unknown;
    worldFails?: Set<string>;
    evaluateOverride?: (frameId: string, expression: string) => unknown;
    noRunImmediately?: boolean;
}

function fakeView(options: FakeOptions = {}) {
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    let nextContext = 1;
    const contexts = new Map<number, string>();
    const cdp = async (method: string, params: Record<string, unknown> = {}) => {
        calls.push({ method, params });
        switch (method) {
            case 'Page.enable': return {};
            case 'Page.addScriptToEvaluateOnNewDocument':
                expect(params.worldName).toBe(BROWSER_DEMO_WORLD);
                if (!options.noRunImmediately) evaluate(params.source as string);
                return { identifier: 'script-1' };
            case 'Page.removeScriptToEvaluateOnNewDocument': return {};
            case 'Page.getFrameTree': return { frameTree: options.frames ?? { frame: { id: 'main' } } };
            case 'Page.createIsolatedWorld': {
                const frameId = params.frameId as string;
                if (options.worldFails?.has(frameId)) throw new Error('No frame with given id found');
                const id = nextContext++;
                contexts.set(id, frameId);
                return { executionContextId: id };
            }
            case 'Runtime.evaluate': {
                const frameId = contexts.get(params.contextId as number)!;
                const override = options.evaluateOverride?.(frameId, params.expression as string);
                if (override !== undefined) return override;
                // Child frames in this fake share the main document but answer as empty documents.
                if (frameId !== 'main') return { result: { value: { doc: frameId, items: [], dropped: 0 } } };
                return { result: { value: evaluate(params.expression as string) ?? null } };
            }
            default: throw new Error(`unexpected ${method}`);
        }
    };
    return { view: { cdp }, calls };
}

function sink() {
    const actions: BrowserDemoAction[] = [];
    const gaps: BrowserDemoGapReason[] = [];
    return { actions, gaps, target: { actions: (list: BrowserDemoAction[]) => actions.push(...list), gap: (reason: BrowserDemoGapReason) => gaps.push(reason) } };
}

beforeEach(() => {
    document.body.innerHTML = '<button>Save</button><input aria-label="Email">';
});

afterEach(() => {
    for (const [type, listener] of added.splice(0)) window.removeEventListener(type, listener, { capture: true });
    Reflect.deleteProperty(window, '__cocDemoInstalled');
    Reflect.deleteProperty(window, BROWSER_DEMO_DRAIN);
});

describe('BrowserDemoTabCapture', () => {
    it('installs in a private world and delivers sanitized trusted actions on poll', async () => {
        const { view, calls } = fakeView();
        const out = sink();
        const capture = new BrowserDemoTabCapture(view, out.target, 60_000);
        await capture.start();
        expect(calls.find(call => call.method === 'Page.addScriptToEvaluateOnNewDocument')?.params).toMatchObject({ runImmediately: true });
        document.querySelector('button')!.click();
        await capture.poll();
        expect(out.actions).toEqual([expect.objectContaining({ kind: 'click', role: 'button', label: 'Save' })]);
        expect(out.gaps).toEqual([]);
        await capture.stop();
    });

    it('installs into an already loaded document when the engine ignores runImmediately', async () => {
        const { view } = fakeView({ noRunImmediately: true });
        const out = sink();
        const capture = new BrowserDemoTabCapture(view, out.target, 60_000);
        await capture.start();
        document.querySelector('button')!.click();
        await capture.poll();
        expect(out.actions).toHaveLength(1);
        expect(out.gaps).toEqual([]);
        await capture.stop();
    });

    it('reports an engine without CDP as unavailable', async () => {
        await expect(new BrowserDemoTabCapture({}, sink().target).start()).rejects.toMatchObject({ reason: 'engine-unsupported' });
    });

    it('reports a failed handshake as unavailable and removes the script', async () => {
        const { view, calls } = fakeView({ evaluateOverride: () => ({ exceptionDetails: { text: 'blocked' } }) });
        const error = await new BrowserDemoTabCapture(view, sink().target).start().catch(failure => failure);
        expect(error).toBeInstanceOf(BrowserDemoUnavailableError);
        expect(error.reason).toBe('handshake-failed');
        expect(calls.some(call => call.method === 'Page.removeScriptToEvaluateOnNewDocument')).toBe(true);
    });

    it('treats replies as untrusted: invalid items and overflow become gaps, unknown fields are dropped', async () => {
        let hostile = false;
        const { view } = fakeView({
            evaluateOverride: (_frame, expression) => hostile && expression.includes(BROWSER_DEMO_DRAIN) ? { result: { value: {
                doc: 'd1', dropped: 4,
                items: ['{bad json', JSON.stringify({ kind: 'type', role: 'textbox', label: 'Email', url: 'https://x.test/?token=abc', value: 'hunter2' })],
            } } } : undefined,
        });
        const out = sink();
        const capture = new BrowserDemoTabCapture(view, out.target, 60_000);
        await capture.start();
        hostile = true;
        await capture.poll();
        expect(out.actions).toEqual([{ kind: 'type', role: 'textbox', label: 'Email', url: 'https://x.test/?token=…' }]);
        expect(JSON.stringify(out.actions)).not.toContain('hunter2');
        expect(out.gaps).toEqual(['capture-failed', 'rate-limit', 'capture-failed']);
        hostile = false;
        await capture.stop();
    });

    it('reports a frame it cannot instrument once, not on every poll', async () => {
        const { view } = fakeView({ frames: { frame: { id: 'main' }, childFrames: [{ frame: { id: 'ads' } }, { frame: { id: 'ok' } }] } as never, worldFails: new Set(['ads']) });
        const out = sink();
        const capture = new BrowserDemoTabCapture(view, out.target, 60_000);
        await capture.start();
        await capture.poll();
        await capture.poll();
        expect(out.gaps).toEqual(['frame-unavailable']);
        await capture.stop();
    });

    it('marks a gap when a drained document loses its script', async () => {
        const { view } = fakeView();
        const out = sink();
        const capture = new BrowserDemoTabCapture(view, out.target, 60_000);
        await capture.start();
        Reflect.deleteProperty(window, '__cocDemoInstalled');
        Reflect.deleteProperty(window, BROWSER_DEMO_DRAIN);
        await capture.poll();
        expect(out.gaps).toEqual(['capture-failed']);
        await capture.stop();
    });

    it('reports document replacement as a gap even when the fresh document already has the script', async () => {
        let doc = 'first';
        const { view } = fakeView({ evaluateOverride: () => ({ result: { value: { doc, items: [], dropped: 0 } } }) });
        const out = sink();
        const capture = new BrowserDemoTabCapture(view, out.target, 60_000);
        await capture.start();
        doc = 'next';
        await capture.poll();
        await capture.poll();
        expect(out.gaps).toEqual(['capture-failed']);
        await capture.stop();
    });

    it('drops queued actions across a pause/resume boundary before enabling collection again', async () => {
        const { view } = fakeView();
        const out = sink();
        const capture = new BrowserDemoTabCapture(view, out.target, 60_000);
        await capture.start();
        capture.setEnabled(false);
        document.querySelector('button')!.click();
        capture.setEnabled(true);
        await capture.poll();
        expect(out.actions).toEqual([]);
        document.querySelector('button')!.click();
        await capture.poll();
        expect(out.actions).toHaveLength(1);
        await capture.stop();
    });

    it('revokes an in-flight poll that crosses a pause/resume boundary', async () => {
        const { view } = fakeView();
        const out = sink();
        const capture = new BrowserDemoTabCapture(view, out.target, 60_000);
        await capture.start();
        let entered!: () => void;
        let finish!: () => void;
        const began = new Promise<void>(resolve => { entered = resolve; });
        const wait = new Promise<void>(resolve => { finish = resolve; });
        const cdp = view.cdp;
        let held = true;
        view.cdp = async (method, params = {}) => {
            if (method === 'Page.createIsolatedWorld' && held) {
                held = false;
                entered();
                await wait;
            }
            return cdp(method, params);
        };
        const polling = capture.poll();
        await began;
        capture.setEnabled(false);
        document.querySelector('button')!.click();
        capture.setEnabled(true);
        finish();
        await polling;
        expect(out.actions).toEqual([]);
        await capture.poll();
        document.querySelector('button')!.click();
        await capture.poll();
        expect(out.actions).toHaveLength(1);
        await capture.stop();
    });

    it('drops actions while disabled', async () => {
        const { view } = fakeView();
        const out = sink();
        const capture = new BrowserDemoTabCapture(view, out.target, 60_000);
        await capture.start();
        capture.setEnabled(false);
        await capture.poll();
        document.querySelector('button')!.click();
        await capture.poll();
        capture.setEnabled(true);
        await capture.poll();
        document.querySelector('button')!.click();
        await capture.poll();
        expect(out.actions).toHaveLength(1);
        await capture.stop();
    });

    it('keeps the final action on stop, then removes the script and silences the open document', async () => {
        const { view, calls } = fakeView();
        const out = sink();
        const capture = new BrowserDemoTabCapture(view, out.target, 60_000);
        await capture.start();
        document.querySelector('button')!.click();
        await capture.stop();
        expect(out.actions).toHaveLength(1);
        expect(calls.filter(call => call.method === 'Page.removeScriptToEvaluateOnNewDocument')).toEqual([{ method: 'Page.removeScriptToEvaluateOnNewDocument', params: { identifier: 'script-1' } }]);
        document.querySelector('button')!.click();
        const queue = (window as unknown as Record<string, () => { items: string[] }>)[BROWSER_DEMO_DRAIN];
        expect(queue().items).toEqual([]);
        await capture.poll();
        expect(out.actions).toHaveLength(1);
    });
});
