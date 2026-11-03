// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserAnnotationTab, BROWSER_ANNOTATION_WORLD } from '../src/browser-annotation-tab';
import type { BrowserCdpEventListener } from '../src/browser-host-contract';
import { buildBrowserAnnotationExpression } from '../src/browser-annotation-dom';

function deferred<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

function fixture() {
    const listeners = new Set<BrowserCdpEventListener>();
    const sink = { events: vi.fn(), ended: vi.fn() };
    const cdp = vi.fn(async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
        switch (method) {
            case 'Page.enable': return {};
            case 'Page.getFrameTree': return { frameTree: { frame: { id: 'main' } } };
            case 'Page.createIsolatedWorld':
                expect(params).toEqual({ frameId: 'main', worldName: BROWSER_ANNOTATION_WORLD });
                return { executionContextId: 42 };
            case 'Runtime.evaluate':
                expect(params.contextId).toBe(42);
                expect(params.returnByValue).toBe(true);
                return { result: { value: window.eval(params.expression as string) } };
            default: throw new Error(`Unexpected CDP command: ${method}`);
        }
    });
    const view = {
        cdp,
        onCdpEvent: (listener: BrowserCdpEventListener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        waitForCdpEvents: vi.fn(async () => {}),
    };
    const tab = new BrowserAnnotationTab(view, sink, 100);
    const emit = (method: string, params: Record<string, unknown> = {}, sessionId?: string) => {
        for (const listener of [...listeners]) listener(method, params, sessionId);
    };
    const select = () => {
        document.body.innerHTML = '<button>Pick</button>';
        const target = document.querySelector('button')!;
        target.getBoundingClientRect = () => ({ x: 10, y: 20, width: 30, height: 40, left: 10, top: 20, right: 40, bottom: 60, toJSON() {} });
        document.elementFromPoint = () => target;
        window.dispatchEvent(new MouseEvent('click', { clientX: 20, clientY: 30, cancelable: true }));
    };
    return { tab, view, cdp, sink, emit, select, listeners };
}

afterEach(() => {
    const mode = (window as unknown as { __cocBrowserAnnotation?: { session: string } }).__cocBrowserAnnotation;
    if (mode) window.eval(buildBrowserAnnotationExpression({ action: 'stop', session: mode.session }));
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('BrowserAnnotationTab document transport', () => {
    it('installs once in the main isolated world, drains actual DOM selections and stops there', async () => {
        const f = fixture();
        const starting = f.tab.start();
        expect(f.tab.start()).toBe(starting);
        expect(await starting).toBe(true);
        f.select();
        await f.tab.poll();
        expect(f.sink.events).toHaveBeenCalledWith([expect.objectContaining({ type: 'selection', kind: 'element', rect: { x: 10, y: 20, width: 30, height: 40 } })]);
        expect(f.cdp.mock.calls.filter(([method]) => method === 'Page.createIsolatedWorld')).toHaveLength(1);
        await f.tab.stop();
        expect(f.sink.ended).toHaveBeenCalledExactlyOnceWith('stop', undefined);
        expect(f.listeners.size).toBe(0);
        expect(document.documentElement.querySelector('[tabindex="-1"]')).toBeNull();
        expect(await f.tab.start()).toBe(false);
        const count = f.cdp.mock.calls.length;
        await f.tab.poll();
        await f.tab.stop();
        expect(f.cdp.mock.calls).toHaveLength(count);
        expect(f.cdp.mock.calls.every(([method]) => method !== 'Page.addScriptToEvaluateOnNewDocument')).toBe(true);
    });

    it('polls automatically and coalesces concurrent drains', async () => {
        vi.useFakeTimers();
        const f = fixture();
        await f.tab.start();
        f.select();
        const first = f.tab.poll();
        expect(f.tab.poll()).toBe(first);
        await first;
        f.select();
        await vi.advanceTimersByTimeAsync(100);
        expect(f.sink.events).toHaveBeenCalledTimes(2);
        await f.tab.stop();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('waits for readiness and cancels startup before any injection', async () => {
        const f = fixture();
        const ready = deferred();
        let signal!: AbortSignal;
        const tab = new BrowserAnnotationTab({ ...f.view, waitForControlReady: current => { signal = current; return ready.promise; } }, f.sink);
        const starting = tab.start();
        await vi.waitFor(() => expect(signal).toBeDefined());
        const stopping = tab.stop();
        expect(signal.aborted).toBe(true);
        expect(f.cdp).not.toHaveBeenCalled();
        ready.resolve();
        expect(await starting).toBe(false);
        await stopping;
        expect(f.cdp).not.toHaveBeenCalled();
    });

    it('awaits native event subscription before installing', async () => {
        const f = fixture();
        const ready = deferred();
        f.view.waitForCdpEvents.mockImplementation(() => ready.promise);
        const starting = f.tab.start();
        await vi.waitFor(() => expect(f.listeners.size).toBe(1));
        expect(f.cdp).not.toHaveBeenCalled();
        ready.resolve();
        await starting;
        await f.tab.stop();
    });

    it.each([
        ['Page.frameStartedLoading', { frameId: 'main' }],
        ['Page.frameNavigated', { frame: { id: 'main' } }],
        ['Page.navigatedWithinDocument', { frameId: 'main' }],
        ['Page.frameDetached', { frameId: 'main' }],
        ['Runtime.executionContextDestroyed', { executionContextId: 42 }],
        ['Runtime.executionContextsCleared', {}],
        ['Inspector.detached', {}],
        ['Target.targetCrashed', {}],
    ] as [string, Record<string, unknown>][])('revokes synchronously on %s and removes the overlay', async (method, params) => {
        const f = fixture();
        await f.tab.start();
        f.select();
        f.emit(method, params);
        expect(f.sink.ended).toHaveBeenCalledTimes(1);
        await f.tab.stop();
        expect(f.sink.events).not.toHaveBeenCalled();
        expect(f.listeners.size).toBe(0);
        expect(document.documentElement.querySelector('[tabindex="-1"]')).toBeNull();
    });

    it('ignores other frames, contexts and child target sessions', async () => {
        const f = fixture();
        await f.tab.start();
        f.emit('Page.frameStartedLoading', { frameId: 'child' });
        f.emit('Page.frameNavigated', { frame: { id: 'child', parentId: 'main' } });
        f.emit('Runtime.executionContextDestroyed', { executionContextId: 7 });
        f.emit('Runtime.executionContextsCleared', {}, 'child-session');
        expect(f.sink.ended).not.toHaveBeenCalled();
        f.select();
        await f.tab.poll();
        expect(f.sink.events).toHaveBeenCalledTimes(1);
        await f.tab.stop();
    });

    it.each(['start', 'drain'])('drops delayed %s results after Stop and cleans the original context', async action => {
        const f = fixture();
        const entered = deferred();
        const release = deferred();
        const original = f.cdp.getMockImplementation()!;
        f.cdp.mockImplementation(async (method, params = {}) => {
            const result = await original(method, params);
            if (method === 'Runtime.evaluate' && (params.expression as string).includes(`"action":"${action}"`)) {
                entered.resolve();
                await release.promise;
            }
            return result;
        });
        let pending: Promise<unknown>;
        if (action === 'start') pending = f.tab.start();
        else { await f.tab.start(); f.select(); pending = f.tab.poll(); }
        await entered.promise;
        const stopping = f.tab.stop();
        expect(f.sink.ended).toHaveBeenCalledTimes(1);
        release.resolve();
        await pending;
        await stopping;
        expect(f.sink.events).not.toHaveBeenCalled();
        const expressions = f.cdp.mock.calls.filter(([method]) => method === 'Runtime.evaluate').map(([, params]) => params!.expression as string);
        expect(expressions.at(-1)).toContain('"action":"stop"');
        expect(f.cdp.mock.calls.filter(([method]) => method === 'Page.createIsolatedWorld')).toHaveLength(1);
        expect(document.documentElement.querySelector('[tabindex="-1"]')).toBeNull();
    });

    it('does not inject after navigation during isolated-world creation', async () => {
        const f = fixture();
        const original = f.cdp.getMockImplementation()!;
        f.cdp.mockImplementation(async (method, params) => {
            const result = await original(method, params);
            if (method === 'Page.createIsolatedWorld') f.emit('Page.navigatedWithinDocument', { frameId: 'main' });
            return result;
        });
        expect(await f.tab.start()).toBe(false);
        await f.tab.stop();
        const evaluations = f.cdp.mock.calls.filter(([method]) => method === 'Runtime.evaluate');
        expect(evaluations).toHaveLength(1);
        expect(evaluations[0][1]!.expression).toContain('"action":"stop"');
    });

    it('ends when the DOM handles Escape, without reinstalling on the next poll', async () => {
        const f = fixture();
        await f.tab.start();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await f.tab.poll();
        expect(f.sink.events).toHaveBeenCalledWith([{ type: 'exit', reason: 'escape' }]);
        expect(f.sink.ended).toHaveBeenCalledExactlyOnceWith('escape', undefined);
        await f.tab.stop();
    });

    it('rejects previews or unsupported hosts with no injection', async () => {
        const sink = { events: vi.fn(), ended: vi.fn() };
        await expect(new BrowserAnnotationTab({}, sink).start()).rejects.toThrow('cannot run');
        expect(sink.ended).toHaveBeenCalledWith('failed', expect.any(Error));
    });

    it.each([
        { exceptionDetails: { text: 'script failed' } },
        { result: { value: null } },
        { result: { value: { active: true, events: Array(34).fill({ type: 'exit', reason: 'stop' }) } } },
        { result: { value: { active: true, events: [{ type: 'selection', kind: 'area', immediate: false, rect: { x: 0, y: 0, width: -1, height: 20 }, page: {} }] } } },
    ])('rejects invalid startup replies and cleans up', async reply => {
        const f = fixture();
        const original = f.cdp.getMockImplementation()!;
        f.cdp.mockImplementation(async (method, params = {}) => {
            const result = await original(method, params);
            return method === 'Runtime.evaluate' && (params.expression as string).includes('"action":"start"') ? reply : result;
        });
        await expect(f.tab.start()).rejects.toThrow();
        expect(f.sink.ended).toHaveBeenCalledWith('failed', expect.any(Error));
        expect(f.listeners.size).toBe(0);
        expect(document.documentElement.querySelector('[tabindex="-1"]')).toBeNull();
    });

    it('keeps a replacement generation intact when an older session tears down', async () => {
        const f = fixture();
        await f.tab.start();
        const replacementSink = { events: vi.fn(), ended: vi.fn() };
        const replacement = new BrowserAnnotationTab(f.view, replacementSink);
        await replacement.start();
        await f.tab.stop();
        f.select();
        await replacement.poll();
        expect(replacementSink.events).toHaveBeenCalledWith([expect.objectContaining({ type: 'selection' })]);
        expect(replacementSink.ended).not.toHaveBeenCalled();
        await replacement.stop();
    });

    it.each(['Page.enable', 'Page.getFrameTree', 'Page.createIsolatedWorld'])('cleans subscriptions when %s fails', async failedMethod => {
        const f = fixture();
        const original = f.cdp.getMockImplementation()!;
        f.cdp.mockImplementation((method, params) => method === failedMethod
            ? Promise.reject(new Error('Native transport failure')) : original(method, params));
        await expect(f.tab.start()).rejects.toThrow('Native transport failure');
        expect(f.listeners.size).toBe(0);
        expect(f.sink.ended).toHaveBeenCalledTimes(1);
        expect(document.documentElement.querySelector('[tabindex="-1"]')).toBeNull();
    });

    it('rejects malformed selection metadata on drain and removes the active overlay', async () => {
        const f = fixture();
        await f.tab.start();
        const original = f.cdp.getMockImplementation()!;
        f.cdp.mockImplementation(async (method, params = {}) => {
            if (method === 'Runtime.evaluate' && (params.expression as string).includes('"action":"drain"')) {
                return { result: { value: { active: true, events: [{ type: 'selection', kind: 'element', immediate: false,
                    rect: { x: 0, y: 0, width: 10, height: 10 },
                    page: { url: 'https://test.example/', title: '', viewport: { width: 100, height: 100, devicePixelRatio: 1 } },
                    element: { selector: 42 },
                }] } } };
            }
            return original(method, params);
        });
        await f.tab.poll();
        await f.tab.stop();
        expect(f.sink.events).not.toHaveBeenCalled();
        expect(f.sink.ended).toHaveBeenCalledWith('failed', expect.any(Error));
        expect(document.documentElement.querySelector('[tabindex="-1"]')).toBeNull();
    });

    it('reports poll failure once and attempts teardown without reinstalling', async () => {
        const f = fixture();
        await f.tab.start();
        f.cdp.mockRejectedValue(new Error('Guest crashed'));
        await f.tab.poll();
        expect(f.sink.ended).toHaveBeenCalledExactlyOnceWith('failed', expect.objectContaining({ message: 'Guest crashed' }));
        await expect(f.tab.stop()).rejects.toThrow('Guest crashed');
        expect(f.listeners.size).toBe(0);
        expect(f.cdp.mock.calls.filter(([method]) => method === 'Page.createIsolatedWorld')).toHaveLength(1);
    });
});
