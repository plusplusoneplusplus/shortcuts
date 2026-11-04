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

const fixtureImage = { dataUrl: 'data:image/png;base64,cG5n', width: 30, height: 40 };

function fixture(capture = false) {
    const listeners = new Set<BrowserCdpEventListener>();
    const sink = { events: vi.fn(), ended: vi.fn() };
    const cdp = vi.fn(async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
        switch (method) {
            case 'Page.enable': return {};
            case 'Page.getFrameTree': return { frameTree: { frame: { id: 'main', url: 'https://fixture.test/', mimeType: 'text/html' } } };
            case 'Page.createIsolatedWorld':
                expect(params).toEqual({ frameId: 'main', worldName: BROWSER_ANNOTATION_WORLD });
                return { executionContextId: 42 };
            case 'Runtime.evaluate':
                expect(params.contextId).toBe(42);
                expect(params.returnByValue).toBe(true);
                return { result: { value: await window.eval(params.expression as string) } };
            default: throw new Error(`Unexpected CDP command: ${method}`);
        }
    });
    const view = {
        cdp,
        onCdpEvent: (listener: BrowserCdpEventListener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        waitForCdpEvents: vi.fn(async () => {}),
        ...(capture ? { captureAnnotation: vi.fn(async () => fixtureImage) } : {}),
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

// Primitive capture tests drain directly so they exercise a single explicitly requested crop.
function drainSelection(sink: { events: ReturnType<typeof vi.fn> }) {
    const mode = (window as unknown as { __cocBrowserAnnotation: { session: string } }).__cocBrowserAnnotation;
    const result = window.eval(buildBrowserAnnotationExpression({ action: 'drain', session: mode.session }));
    sink.events(result.events);
}

afterEach(() => {
    const mode = (window as unknown as { __cocBrowserAnnotation?: { session: string } }).__cocBrowserAnnotation;
    if (mode) window.eval(buildBrowserAnnotationExpression({ action: 'stop', session: mode.session }));
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('BrowserAnnotationTab document transport', () => {
    it.each([
        { url: 'https://fixture.test/download?id=1', mimeType: 'application/pdf' },
        { url: 'https://fixture.test/download', mimeType: 'APPLICATION/PDF' },
        { url: 'https://fixture.test/download', mimeType: ' application/pdf; charset=binary ' },
        { url: 'https://fixture.test/download', mimeType: 'application/x-google-chrome-pdf' },
        { url: 'https://fixture.test/report.PDF?download=1', mimeType: 'text/html' },
        { url: 'file:///preview.html', mimeType: 'text/html' },
        { url: 'about:blank', mimeType: 'text/html' },
        { url: 'chrome-extension://pdf/viewer.html', mimeType: 'text/html' },
        { url: 'invalid', mimeType: 'text/html' },
        { url: 'https://fixture.test/' },
        { url: 'https://fixture.test/', mimeType: '' },
        { mimeType: 'text/html' },
    ])('refuses unsupported committed document %j before creating a world', async facts => {
        const f = fixture();
        const original = f.cdp.getMockImplementation()!;
        f.cdp.mockImplementation((method, params) => method === 'Page.getFrameTree'
            ? Promise.resolve({ frameTree: { frame: { id: 'main', ...facts } } }) : original(method, params));
        await expect(f.tab.start()).rejects.toThrow('PDFs, previews or the CoC app');
        expect(f.cdp.mock.calls.map(([method]) => method)).toEqual(['Page.enable', 'Page.getFrameTree']);
        expect(f.sink.ended).toHaveBeenCalledExactlyOnceWith('failed', expect.any(Error));
        expect(f.listeners.size).toBe(0);
        expect(await f.tab.start()).toBe(false);
    });

    it('checks the engine URL against main-owned app registrations before any world creation', async () => {
        const f = fixture();
        const isAppUrl = vi.fn(() => true);
        const tab = new BrowserAnnotationTab(f.view, f.sink, 100, isAppUrl);
        await expect(tab.start()).rejects.toThrow('CoC app');
        expect(isAppUrl).toHaveBeenCalledExactlyOnceWith('https://fixture.test/');
        expect(f.cdp.mock.calls.map(([method]) => method)).toEqual(['Page.enable', 'Page.getFrameTree']);
    });

    it('drops an allowed frame-tree reply after navigation without creating a world', async () => {
        const f = fixture();
        const pending = deferred<unknown>();
        const original = f.cdp.getMockImplementation()!;
        f.cdp.mockImplementation((method, params) => method === 'Page.getFrameTree' ? pending.promise : original(method, params));
        const starting = f.tab.start();
        await vi.waitFor(() => expect(f.cdp).toHaveBeenCalledWith('Page.getFrameTree'));
        f.emit('Page.frameNavigated', { frame: { id: 'replacement' } });
        pending.resolve({ frameTree: { frame: { id: 'main', url: 'https://fixture.test/', mimeType: 'text/html' } } });
        expect(await starting).toBe(false);
        await f.tab.stop();
        expect(f.cdp.mock.calls.map(([method]) => method)).toEqual(['Page.enable', 'Page.getFrameTree']);
        expect(f.sink.ended).toHaveBeenCalledExactlyOnceWith('navigation', undefined);
    });

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
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
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

    it.each(['start', 'drain', 'remove'])('drops delayed %s results after Stop and cleans the original context', async action => {
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
        else { await f.tab.start(); f.select(); pending = action === 'remove' ? f.tab.remove('1') : f.tab.poll(); }
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

    it('keeps the mode after editor Escape, then ends on the next Escape', async () => {
        const f = fixture(); await f.tab.start(); f.select(); await f.tab.poll();
        f.sink.events.mockClear();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await f.tab.poll();
        expect(f.sink.events).not.toHaveBeenCalled();
        expect(f.sink.ended).not.toHaveBeenCalled();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await f.tab.poll();
        expect(f.sink.ended).toHaveBeenCalledWith('escape', undefined);
        await f.tab.stop();
    });

    it('drains actual editor submissions through the document-bound transport', async () => {
        const attach = Element.prototype.attachShadow;
        let root!: ShadowRoot;
        const spy = vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
            return root = attach.call(this, init);
        });
        const f = fixture(true);
        try {
            await f.tab.start(); f.select(); await f.tab.poll();
            const { image, ...selection } = f.sink.events.mock.calls[0][0][0];
            expect(image).toBe(fixtureImage);
            const input = root.querySelector('textarea')!;
            input.value = 'Exact selected element';
            input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            Object.defineProperty(root, 'elementFromPoint', { configurable: true, value: () => root.querySelector('.save') });
            root.querySelector('.save')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
            await f.tab.poll();
            expect(f.sink.events).toHaveBeenLastCalledWith([{ type: 'comment', id: '1', number: 1, comment: 'Exact selected element', selection }]);
            const click = (element: Element) => {
                Object.defineProperty(root, 'elementFromPoint', { configurable: true, value: () => element });
                element.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
            };
            click(root.querySelector('.pin')!);
            input.value = 'Revised comment';
            click(root.querySelector('.save')!);
            await f.tab.poll();
            expect(f.sink.events).toHaveBeenLastCalledWith([{ type: 'comment', id: '1', number: 1,
                comment: 'Revised comment', selection: { ...selection, immediate: false } }]);
            click(root.querySelector('.pin')!); click(root.querySelector('.delete')!);
            await f.tab.poll();
            expect(f.sink.events).toHaveBeenLastCalledWith([{ type: 'delete', id: '1' }]);
            expect(f.sink.ended).not.toHaveBeenCalled();
        } finally { await f.tab.stop(); spy.mockRestore(); }
    });

    it('removes actual saved pins, emits deletion once, and retains the active overlay', async () => {
        const attach = Element.prototype.attachShadow;
        let root!: ShadowRoot;
        const spy = vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
            return root = attach.call(this, init);
        });
        const f = fixture(true);
        try {
            await f.tab.start(); f.select();
            root.querySelector('textarea')!.value = 'Remove this pin from its chip';
            Object.defineProperty(root, 'elementFromPoint', { configurable: true, value: () => root.querySelector('.save') });
            root.querySelector('.save')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
            expect(root.querySelectorAll('.pin')).toHaveLength(0);
            await f.tab.poll();
            root.querySelector('.save')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
            expect(root.querySelectorAll('.pin')).toHaveLength(1);
            // Remove drains queued comment events before deletion, after selection capture admission.
            await f.tab.remove('1');
            expect(f.sink.events.mock.calls.flatMap(([events]) => events.map((event: { type: string }) => event.type))).toEqual(['selection', 'comment', 'delete']);
            expect(f.sink.events.mock.calls.at(-1)![0].at(-1)).toEqual({ type: 'delete', id: '1' });
            expect(root.querySelectorAll('.pin')).toHaveLength(0);
            await f.tab.remove('1');
            expect(f.sink.events).toHaveBeenCalledTimes(2);
            expect(f.sink.ended).not.toHaveBeenCalled();
        } finally { await f.tab.stop(); spy.mockRestore(); }
    });

    it('ignores removal queued behind a drain when navigation revokes the document', async () => {
        const f = fixture(); await f.tab.start();
        const entered = deferred(), release = deferred();
        const original = f.cdp.getMockImplementation()!;
        f.cdp.mockImplementation(async (method, params = {}) => {
            if (method === 'Runtime.evaluate' && String(params.expression).includes('"action":"drain"')) {
                entered.resolve(); await release.promise;
            }
            return original(method, params);
        });
        const poll = f.tab.poll(); await entered.promise;
        const remove = f.tab.remove('1');
        f.emit('Page.navigatedWithinDocument', { frameId: 'main' });
        release.resolve(); await Promise.all([poll, remove]); await f.tab.stop();
        expect(f.cdp.mock.calls.some(([, params]) => String(params?.expression).includes('"action":"remove"'))).toBe(false);
    });

    it('rejects removal transport failures, ends delivery and removes the overlay', async () => {
        const f = fixture(); await f.tab.start();
        const original = f.cdp.getMockImplementation()!;
        f.cdp.mockImplementation(async (method, params = {}) => {
            if (method === 'Runtime.evaluate' && String(params.expression).includes('"action":"remove"')) throw new Error('Removal failed');
            return original(method, params);
        });
        await expect(f.tab.remove('1')).rejects.toThrow('Removal failed');
        expect(f.sink.ended).toHaveBeenCalledWith('failed', expect.any(Error));
        await f.tab.stop();
        const count = f.cdp.mock.calls.length;
        await f.tab.remove('1');
        expect(f.cdp).toHaveBeenCalledTimes(count);
    });

    it.each(['', '0', '01', '9007199254740992'])('rejects invalid removal ID %j without CDP', async id => {
        const f = fixture(); await f.tab.start();
        const count = f.cdp.mock.calls.length;
        await expect(f.tab.remove(id)).rejects.toThrow(TypeError);
        expect(f.cdp).toHaveBeenCalledTimes(count);
        await f.tab.stop();
    });

    it.each(['', '  ', 'x'.repeat(8001), 42, null])('rejects invalid comment text at the native boundary (case %#)', async comment => {
        const f = fixture(); await f.tab.start(); f.select(); await f.tab.poll();
        const selection = f.sink.events.mock.calls[0][0][0];
        const original = f.cdp.getMockImplementation()!;
        let drain = true;
        f.cdp.mockImplementation(async (method, params) => {
            if (method === 'Runtime.evaluate' && drain) {
                drain = false;
                return { result: { value: { active: true, events: [{ type: 'comment', id: '1', number: 1, comment, selection }] } } };
            }
            return original(method, params);
        });
        await f.tab.poll();
        expect(f.sink.ended).toHaveBeenCalledWith('failed', expect.any(Error));
        await f.tab.stop();
    });

    it.each([null, { type: 'exit', reason: 'stop' }, { type: 'selection', kind: 'area', rect: {} }])('rejects invalid nested comment selections (case %#)', async selection => {
        const f = fixture(); await f.tab.start();
        const original = f.cdp.getMockImplementation()!;
        let drain = true;
        f.cdp.mockImplementation(async (method, params) => {
            if (method === 'Runtime.evaluate' && drain) {
                drain = false;
                return { result: { value: { active: true, events: [{ type: 'comment', id: '1', number: 1, comment: 'Comment', selection }] } } };
            }
            return original(method, params);
        });
        await f.tab.poll();
        expect(f.sink.ended).toHaveBeenCalledWith('failed', expect.any(Error));
        await f.tab.stop();
    });

    it.each([
        { type: 'delete', id: '' }, { type: 'delete', id: 1 }, { type: 'delete', id: '0' },
        { type: 'delete', id: '9007199254740992' }, { type: 'delete', id: '1.5' },
        { type: 'comment', id: '1', number: 0 }, { type: 'comment', id: '1', number: 101 },
        { type: 'comment', id: '1', number: 1.5 }, { type: 'comment', id: '1', number: '1' },
        { type: 'comment', id: '-1', number: 1 }, { type: 'comment', id: '01', number: 1 },
    ])('rejects malformed pin identity/number at the native boundary (case %#)', async fields => {
        const f = fixture(); await f.tab.start(); f.select(); await f.tab.poll();
        const selection = f.sink.events.mock.calls[0][0][0];
        const original = f.cdp.getMockImplementation()!;
        let drain = true;
        f.cdp.mockImplementation(async (method, params) => {
            if (method === 'Runtime.evaluate' && drain) {
                drain = false;
                return { result: { value: { active: true, events: [{ comment: 'Comment', selection, ...fields }] } } };
            }
            return original(method, params);
        });
        await f.tab.poll();
        expect(f.sink.ended).toHaveBeenCalledWith('failed', expect.any(Error));
        await f.tab.stop();
    });

    it('captures only the pending selection, hides chrome through native completion and restores it', async () => {
        const f = fixture();
        const image = { dataUrl: 'data:image/png;base64,cG5n', width: 30, height: 40 };
        const captureAnnotation = vi.fn(async () => {
            expect(document.documentElement.querySelector<HTMLElement>('[tabindex="-1"]')!.style.opacity).toBe('0');
            // The hidden shield still swallows page input and preserves the pending draft.
            const click = new MouseEvent('click', { clientX: 20, clientY: 30, cancelable: true });
            window.dispatchEvent(click);
            expect(click.defaultPrevented).toBe(true);
            return image;
        });
        const tab = new BrowserAnnotationTab({ ...f.view, captureAnnotation }, f.sink);
        await tab.start(); f.select(); drainSelection(f.sink);
        // Actual CDP sorts nested object keys; matching must be independent of property order.
        const selection = JSON.parse(JSON.stringify(f.sink.events.mock.calls[0][0][0], (_key, part) =>
            part && typeof part === 'object' && !Array.isArray(part)
                ? Object.fromEntries(Object.keys(part).sort().map(key => [key, part[key]])) : part));
        try {
            expect(await tab.captureSelection(selection)).toBe(image);
            expect(captureAnnotation).toHaveBeenCalledExactlyOnceWith(selection.rect, selection.page.viewport);
            expect(document.documentElement.querySelector<HTMLElement>('[tabindex="-1"]')!.style.opacity).toBe('1');
            expect(f.sink.ended).not.toHaveBeenCalled();
        } finally { await tab.stop(); }
    });

    it('automatically delivers a native PNG before admitting a fast-save comment and never injects image bytes', async () => {
        const attach = Element.prototype.attachShadow;
        let root!: ShadowRoot;
        const spy = vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
            return root = attach.call(this, init);
        });
        const f = fixture(true);
        const click = (selector: string) => {
            const element = root.querySelector(selector)!;
            Object.defineProperty(root, 'elementFromPoint', { configurable: true, value: () => element });
            element.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
        };
        try {
            await f.tab.start(); f.select();
            root.querySelector('textarea')!.value = 'Save quickly';
            click('.save');
            expect(root.querySelector('.pin')).toBeNull();
            await f.tab.poll();
            const { image, ...selection } = f.sink.events.mock.calls[0][0][0];
            expect(image).toBe(fixtureImage);
            expect(f.view.captureAnnotation).toHaveBeenCalledExactlyOnceWith(selection.rect, selection.page.viewport);
            click('.save');
            await f.tab.poll();
            expect(f.sink.events).toHaveBeenLastCalledWith([{ type: 'comment', id: '1', number: 1, comment: 'Save quickly', selection }]);
            click('.pin'); root.querySelector('textarea')!.value = 'Edit without recapture'; click('.save');
            await f.tab.poll();
            expect(f.view.captureAnnotation).toHaveBeenCalledTimes(1);
            expect(f.cdp.mock.calls.every(([, params]) => !String(params?.expression).includes(fixtureImage.dataUrl))).toBe(true);
        } finally { await f.tab.stop(); spy.mockRestore(); }
    });

    it('captures selections collected during a delayed Start reply without needing a polling timer', async () => {
        const f = fixture(true);
        const original = f.cdp.getMockImplementation()!;
        f.cdp.mockImplementation(async (method, params = {}) => {
            const reply = await original(method, params);
            if (method === 'Runtime.evaluate' && String(params.expression).includes('"action":"start"')) {
                f.select();
                const mode = (window as unknown as { __cocBrowserAnnotation: { session: string } }).__cocBrowserAnnotation;
                return { result: { value: window.eval(buildBrowserAnnotationExpression({ action: 'drain', session: mode.session })) } };
            }
            return reply;
        });
        expect(await f.tab.start()).toBe(true);
        expect(f.view.captureAnnotation).toHaveBeenCalledTimes(1);
        expect(f.sink.events).toHaveBeenCalledWith([expect.objectContaining({ captureId: '1', image: fixtureImage })]);
        await f.tab.stop();
    });

    it('does not deadlock the command tail or deliver late images when Stop interrupts automatic capture', async () => {
        const f = fixture(true), entered = deferred(), release = deferred();
        f.view.captureAnnotation!.mockImplementation(async () => {
            entered.resolve(); await release.promise; return fixtureImage;
        });
        await f.tab.start(); f.select();
        const polling = f.tab.poll(); await entered.promise;
        const stopping = f.tab.stop();
        expect(f.sink.ended).toHaveBeenCalledExactlyOnceWith('stop', undefined);
        release.resolve();
        await Promise.all([polling, stopping]);
        expect(f.sink.events).not.toHaveBeenCalled();
        expect(document.documentElement.querySelector('[tabindex="-1"]')).toBeNull();
    });

    it('reports a recoverable automatic capture failure in the private editor and retries without ending mode', async () => {
        const attach = Element.prototype.attachShadow;
        let root!: ShadowRoot;
        const spy = vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
            return root = attach.call(this, init);
        });
        const f = fixture(true);
        f.view.captureAnnotation!.mockRejectedValueOnce(new Error('Native preview unavailable'));
        try {
            await f.tab.start(); f.select(); await f.tab.poll();
            expect(f.sink.events.mock.calls[0][0][0].image).toBeUndefined();
            expect(root.querySelector('[role="status"]')!.textContent).toContain('Native preview unavailable');
            expect(root.querySelector<HTMLButtonElement>('.save')!.disabled).toBe(true);
            const retry = root.querySelector('.editor button:last-child')!;
            Object.defineProperty(root, 'elementFromPoint', { configurable: true, value: () => retry });
            retry.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
            await f.tab.poll();
            expect(f.sink.events).toHaveBeenLastCalledWith([expect.objectContaining({ captureId: '1', image: fixtureImage })]);
            expect(f.view.captureAnnotation).toHaveBeenCalledTimes(2);
            expect(f.sink.ended).not.toHaveBeenCalled();
        } finally { await f.tab.stop(); spy.mockRestore(); }
    });

    it('captures only the current draft from multiple selections drained in one batch', async () => {
        const f = fixture(true);
        await f.tab.start(); f.select();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        f.select();
        await f.tab.poll();
        const delivered = f.sink.events.mock.calls[0][0];
        expect(delivered).toMatchObject([{ captureId: '1' }, { captureId: '2', image: fixtureImage }]);
        expect(delivered[0].image).toBeUndefined();
        expect(f.view.captureAnnotation).toHaveBeenCalledTimes(1);
        expect(f.sink.ended).not.toHaveBeenCalled();
        await f.tab.stop();
    });

    it('rejects an old screenshot when the user reselects between chrome restoration and acknowledgement', async () => {
        const f = fixture(true);
        await f.tab.start(); f.select();
        const original = f.cdp.getMockImplementation()!;
        let replaced = false;
        f.cdp.mockImplementation(async (method, params = {}) => {
            if (!replaced && method === 'Runtime.evaluate' && String(params.expression).includes('"action":"captured"')) {
                replaced = true;
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
                f.select();
            }
            return original(method, params);
        });
        await f.tab.poll();
        expect(f.sink.events).not.toHaveBeenCalled();
        await f.tab.poll();
        expect(f.sink.events).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({ captureId: '2', image: fixtureImage })]);
        expect(f.view.captureAnnotation).toHaveBeenCalledTimes(2);
        await f.tab.stop();
    });

    it('automatically captures the drawn area rather than the hovered element rectangle', async () => {
        const f = fixture(true);
        await f.tab.start();
        for (const [type, x, y] of [['pointerdown', 100, 80], ['pointerup', 50, 40]] as const) {
            window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, shiftKey: true, cancelable: true }));
        }
        await f.tab.poll();
        expect(f.view.captureAnnotation).toHaveBeenCalledWith({ x: 50, y: 40, width: 50, height: 40 }, expect.anything());
        expect(f.sink.events).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({ kind: 'area', captureId: '1',
            image: fixtureImage, immediate: false })]);
        await f.tab.stop();
    });

    it('ends mode and tears down when automatic capture acknowledgement transport fails', async () => {
        const f = fixture(true);
        await f.tab.start(); f.select();
        const original = f.cdp.getMockImplementation()!;
        f.cdp.mockImplementation(async (method, params = {}) => {
            if (method === 'Runtime.evaluate' && String(params.expression).includes('"action":"captured"')) {
                throw new Error('Capture acknowledgement failed');
            }
            return original(method, params);
        });
        await f.tab.poll();
        expect(f.sink.events).not.toHaveBeenCalled();
        expect(f.sink.ended).toHaveBeenCalledWith('failed', expect.any(Error));
        await f.tab.stop();
        expect(document.documentElement.querySelector('[tabindex="-1"]')).toBeNull();
    });

    it.each(['0', '01', '9007199254740992', 1])('rejects malformed selection capture identity %j at the CDP boundary', async captureId => {
        const f = fixture();
        await f.tab.start(); f.select(); await f.tab.poll();
        const selection = f.sink.events.mock.calls[0][0][0];
        f.cdp.mockResolvedValueOnce({ result: { value: { active: true, events: [{ ...selection, captureId }] } } });
        await f.tab.poll();
        expect(f.sink.ended).toHaveBeenCalledWith('failed', expect.any(Error));
        await f.tab.stop();
    });

    it.each(['failure', 'navigation', 'scroll', 'resize', 'escape'])('restores or removes capture chrome after %s', async outcome => {
        const f = fixture();
        const captureAnnotation = vi.fn(async () => {
            if (outcome === 'failure') throw new Error('Native capture failed');
            if (outcome === 'navigation') f.emit('Page.navigatedWithinDocument', { frameId: 'main' });
            if (outcome === 'scroll') Object.defineProperty(window, 'scrollY', { configurable: true, value: 10 });
            if (outcome === 'resize') Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
            if (outcome === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            return { dataUrl: 'data:image/png;base64,cG5n', width: 30, height: 40 };
        });
        const width = window.innerWidth, scrollY = window.scrollY;
        const tab = new BrowserAnnotationTab({ ...f.view, captureAnnotation }, f.sink);
        try {
            await tab.start(); f.select(); drainSelection(f.sink);
            const selection = f.sink.events.mock.calls[0][0][0];
            await expect(tab.captureSelection(selection)).rejects.toThrow(outcome === 'failure' ? 'Native capture failed' : 'stale');
            if (outcome === 'failure' || outcome === 'escape' || outcome === 'scroll' || outcome === 'resize') {
                expect(document.documentElement.querySelector<HTMLElement>('[tabindex="-1"]')!.style.opacity).toBe('1');
                expect(f.sink.ended).not.toHaveBeenCalled();
            }
        } finally {
            await tab.stop();
            Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
            Object.defineProperty(window, 'scrollY', { configurable: true, value: scrollY });
        }
        expect(document.documentElement.querySelector('[tabindex="-1"]')).toBeNull();
    });

    it('refuses a superseded draft before native capture and leaves the mode active', async () => {
        const f = fixture();
        const captureAnnotation = vi.fn();
        const tab = new BrowserAnnotationTab({ ...f.view, captureAnnotation }, f.sink);
        await tab.start(); f.select(); drainSelection(f.sink);
        const selection = f.sink.events.mock.calls[0][0][0];
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await expect(tab.captureSelection(selection)).rejects.toThrow('stale');
        expect(captureAnnotation).not.toHaveBeenCalled();
        expect(f.sink.ended).not.toHaveBeenCalled();
        await tab.stop();
    });

    it('restores chrome when a suspended document cannot paint before the capture deadline', async () => {
        const f = fixture(); const captureAnnotation = vi.fn();
        const tab = new BrowserAnnotationTab({ ...f.view, captureAnnotation }, f.sink);
        await tab.start(); f.select(); drainSelection(f.sink);
        const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0);
        try {
            await expect(tab.captureSelection(f.sink.events.mock.calls[0][0][0])).rejects.toThrow('paint timed out');
            expect(captureAnnotation).not.toHaveBeenCalled();
            expect(document.documentElement.querySelector<HTMLElement>('[tabindex="-1"]')!.style.opacity).toBe('1');
            expect(f.sink.ended).not.toHaveBeenCalled();
        } finally { raf.mockRestore(); await tab.stop(); }
    });

    it('holds teardown behind an issued capture and refuses the late image after Stop', async () => {
        const f = fixture(); const entered = deferred(), release = deferred();
        const captureAnnotation = vi.fn(async () => {
            entered.resolve(); await release.promise;
            return { dataUrl: 'data:image/png;base64,cG5n', width: 30, height: 40 };
        });
        const tab = new BrowserAnnotationTab({ ...f.view, captureAnnotation }, f.sink);
        await tab.start(); f.select(); drainSelection(f.sink);
        const capturing = tab.captureSelection(f.sink.events.mock.calls[0][0][0]);
        await entered.promise;
        const stopping = tab.stop();
        expect(f.sink.ended).toHaveBeenCalledExactlyOnceWith('stop', undefined);
        release.resolve();
        await expect(capturing).rejects.toThrow('stale');
        await stopping;
        expect(document.documentElement.querySelector('[tabindex="-1"]')).toBeNull();
    });

    it('cannot hide or remove a replacement generation when an older capture completes', async () => {
        const f = fixture(); const entered = deferred(), release = deferred();
        const captureAnnotation = vi.fn(async () => {
            entered.resolve(); await release.promise;
            return { dataUrl: 'data:image/png;base64,cG5n', width: 30, height: 40 };
        });
        const tab = new BrowserAnnotationTab({ ...f.view, captureAnnotation }, f.sink);
        const replacementSink = { events: vi.fn(), ended: vi.fn() };
        const replacement = new BrowserAnnotationTab(f.view, replacementSink);
        await tab.start(); f.select(); drainSelection(f.sink);
        const capturing = tab.captureSelection(f.sink.events.mock.calls[0][0][0]);
        await entered.promise; await replacement.start();
        release.resolve(); await expect(capturing).rejects.toThrow('stale'); await tab.stop();
        expect(document.documentElement.querySelector<HTMLElement>('[tabindex="-1"]')!.style.opacity).toBe('1');
        f.select(); await replacement.poll();
        expect(replacementSink.events).toHaveBeenCalled();
        expect(replacementSink.ended).not.toHaveBeenCalled();
        await replacement.stop();
    });

    it('rejects unsupported capture without hiding chrome or changing the mode', async () => {
        const f = fixture(); await f.tab.start(); f.select(); await f.tab.poll();
        await expect(f.tab.captureSelection(f.sink.events.mock.calls[0][0][0])).rejects.toThrow('cannot capture');
        expect(document.documentElement.querySelector<HTMLElement>('[tabindex="-1"]')!.style.opacity).toBe('1');
        expect(f.sink.ended).not.toHaveBeenCalled();
        await f.tab.stop();
        await expect(f.tab.captureSelection(f.sink.events.mock.calls[0][0][0])).rejects.toThrow('no longer active');
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
