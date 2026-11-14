import { describe, expect, it, vi } from 'vitest';
import { BrowserHostError } from '../src/browser-host-contract';
import type { BrowserControlEvent } from '../src/browser-control-engine';
import { BrowserFrameRegistry } from '../src/browser-frame-registry';
import { WkWebViewBrowserControl } from '../src/wkwebview-browser-control';

interface FakeFrame { parent: string | null; owner: number | null; token: string; url: string; worlds: Map<string, string>; owned: Set<number> }

/** A fake helper: per-frame documents, each world with its own per-document token, plus the coc-frames world. */
function fakeHelper() {
    let documents = 0;
    const frameToken = () => (++documents).toString(16).padStart(32, '0');
    const page = { document: 1, url: 'https://example.test/', worlds: new Map<string, string>() };
    const frames = new Map<string, FakeFrame>();
    const calls: [string, Record<string, unknown>][] = [];
    const main = (): FakeFrame => ({ parent: null, owner: null, token: frameToken(), url: page.url, worlds: page.worlds, owned: new Set() });
    frames.set('main', main());
    const token = (frame: FakeFrame, world: string) => {
        if (!frame.worlds.has(world)) frame.worlds.set(world, `${world}#${frame.token}`);
        return frame.worlds.get(world)!;
    };
    const info = (id: string, frame: FakeFrame) => ({ frameId: id, parentFrameId: frame.parent, owner: frame.owner, token: frame.token, url: frame.url, origin: new URL(frame.url).origin });
    let value: (expression: string, world: string, frame: string) => unknown = () => 'value';
    const request = vi.fn(async (op: string, payload: Record<string, unknown>) => {
        calls.push([op, payload]);
        if (op === 'screenshot') return { data: 'aW1n' };
        if (op === 'frames') return { frames: [...frames].map(([id, frame]) => info(id, frame)) };
        if (op !== 'evaluate') return undefined;
        const frameId = typeof payload.frame === 'string' ? payload.frame : 'main';
        const frame = frames.get(frameId);
        if (!frame) throw new BrowserHostError('invalid', 'No frame for given id found.');
        const expression = String(payload.expression);
        const world = String(payload.world);
        if (frameId === 'main') frame.url = page.url;
        if (expression.startsWith('({ token:')) return { value: { token: token(frame, world), url: frame.url, origin: new URL(frame.url).origin } };
        if (expression.startsWith('(() => { const key')) return { value: token(frame, world) };
        if (expression === 'document.contentType') return { value: 'text/html' };
        if (world === 'coc-frames' && expression.startsWith("globalThis[Symbol.for('coc.frame')]?.token")) return { value: frame.token };
        if (world === 'coc-frames' && expression.includes('frame.owner(')) {
            const expected = JSON.parse(/frame\.token !== ("[^"]*")\)/.exec(expression)![1]);
            if (frame.token !== expected) throw new BrowserHostError('evaluation-failed' as never, 'Error: coc-stale-context');
            const owner = Number(/frame\.owner\((\d+)\)/.exec(expression)![1]);
            return { value: frame.owned.has(owner) ? { owned: true, value: value(expression, world, frameId) } : { owned: false } };
        }
        if (expression.includes('visualViewport')) return { value: { clientWidth: 800, clientHeight: 600, pageX: 0, pageY: 300 } };
        if (typeof payload.guard === 'string') {
            const expected = JSON.parse(/!== ("[^"]*")\) throw/.exec(payload.guard)![1]);
            if (token(frame, world) !== expected) throw new BrowserHostError('evaluation-failed' as never, 'Error: coc-stale-context');
        }
        return { value: value(expression, world, frameId) };
    });
    const detach = (id: string, events: [string, Record<string, unknown>][]) => {
        for (const [child, frame] of [...frames]) if (frame.parent === id) detach(child, events);
        frames.delete(id);
        events.push(['frame-detached', { frameId: id }]);
    };
    return {
        page, calls, request, frames,
        setValue(next: typeof value) { value = next; },
        navigate(url: string) {
            page.document++; page.url = url; page.worlds.clear();
            const events: [string, Record<string, unknown>][] = [];
            for (const [id, frame] of [...frames]) if (frame.parent === 'main') detach(id, events);
            frames.set('main', main());
            events.push(['frame-navigated', info('main', frames.get('main')!)]);
            return events;
        },
        /** Loads a new document into a child frame (adding it when new); returns the helper's events. */
        child(id: string, parent: string, owner: number, url: string) {
            const events: [string, Record<string, unknown>][] = [];
            for (const [child, frame] of [...frames]) if (frame.parent === id) detach(child, events);
            frames.get(parent)!.owned.add(owner);
            frames.set(id, { parent, owner, token: frameToken(), url, worlds: new Map(), owned: new Set() });
            events.push(['frame-navigated', info(id, frames.get(id)!)]);
            return events;
        },
        remove(id: string) {
            const frame = frames.get(id)!;
            frames.get(frame.parent!)!.owned.delete(frame.owner!);
            const events: [string, Record<string, unknown>][] = [];
            detach(id, events);
            return events;
        },
    };
}

function deliver(control: WkWebViewBrowserControl, events: [string, Record<string, unknown>][]): void {
    for (const [event, message] of events) control.frameEvent(event as 'frame-navigated', message);
}

describe('WkWebViewBrowserControl', () => {
    it('maps input to the helper input op without CDP-only fields', async () => {
        const helper = fakeHelper();
        const control = new WkWebViewBrowserControl(helper.request);
        await control.mouse({ type: 'down', x: 5, y: 6, button: 'left', clickCount: 1 });
        await control.mouse({ type: 'wheel', x: 1, y: 2, deltaY: 40 });
        await control.key({ type: 'down', key: 'a', code: 'KeyA', keyCode: 65, modifiers: 4, commands: ['selectAll'] });
        await control.key({ type: 'char', text: 'x' });
        await control.insertText('hello');
        await control.setFocusEmulation(true);
        expect(helper.calls).toEqual([
            ['input', { input: { kind: 'mouse', type: 'down', x: 5, y: 6, clickCount: 1 } }],
            ['input', { input: { kind: 'mouse', type: 'wheel', x: 1, y: 2, deltaY: 40 } }],
            ['input', { input: { kind: 'key', type: 'down', key: 'a', code: 'KeyA', modifiers: 4, commands: ['selectAll'] } }],
            ['input', { input: { kind: 'key', type: 'char', text: 'x' } }],
            ['input', { input: { kind: 'text', text: 'hello' } }],
            ['focus-emulation', { enabled: true }],
        ]);
    });

    it('evaluates in the page world and reports page exceptions as exceptions', async () => {
        const helper = fakeHelper();
        const control = new WkWebViewBrowserControl(helper.request);
        await expect(control.evaluate('1 + 1')).resolves.toEqual({ value: 'value' });
        expect(helper.calls.at(-1)).toEqual(['evaluate', { expression: '1 + 1', world: 'page' }]);
        helper.setValue(() => { throw new BrowserHostError('evaluation-failed' as never, 'Error: boom'); });
        await expect(control.evaluate('boom()')).resolves.toEqual({ exception: 'Error: boom' });
        helper.setValue(() => { throw new BrowserHostError('not-found', 'Browser tab is closed.'); });
        await expect(control.evaluate('x')).rejects.toMatchObject({ reason: 'not-found' });
        await expect(control.evaluate('x', { target: 'child' })).rejects.toThrow('No target');
        await expect(control.evaluate('x', { context: 99 })).rejects.toThrow('Cannot find context');
    });

    it('hands user source, its post-processing and the context check to the helper apart, so page CSP never sees eval', async () => {
        const helper = fakeHelper();
        const control = new WkWebViewBrowserControl(helper.request);
        await control.evaluate('value => value', { source: 'document.title', awaitPromise: true });
        expect(helper.calls.at(-1)).toEqual(['evaluate', { expression: 'document.title', world: 'page', then: 'value => value' }]);
        await control.enableContextEvents();
        await control.evaluate('value => value', { source: 'a = 1; a', context: 1 });
        const [, payload] = helper.calls.at(-1)!;
        expect(payload).toMatchObject({ expression: 'a = 1; a', world: 'page', then: 'value => value' });
        expect(payload.guard).toContain('coc-stale-context');
        for (const [, sent] of helper.calls) expect(JSON.stringify(sent)).not.toContain('eval');
        await control.evaluate('document.title', { context: 1 });
        expect(helper.calls.at(-1)?.[1]).toMatchObject({ expression: 'document.title', guard: expect.stringContaining('coc-stale-context') });
        expect(helper.calls.at(-1)?.[1]).not.toHaveProperty('then');
    });

    it('reports the main frame tree and the default context, and retires contexts on navigation', async () => {
        const helper = fakeHelper();
        const control = new WkWebViewBrowserControl(helper.request);
        const events: BrowserControlEvent[] = [];
        control.onEvent(event => events.push(event));
        await control.enableFrameEvents();
        const tree = await control.frameTree();
        expect(tree).toEqual({ frame: { id: 'main', loaderId: `page#${'1'.padStart(32, '0')}`, url: 'https://example.test/', origin: 'https://example.test', mimeType: 'text/html' }, children: [] });
        await control.enableContextEvents();
        expect(events).toEqual([{ type: 'context-created', context: 1, frameId: 'main', origin: 'https://example.test', isDefault: true }]);

        helper.setValue(() => 'main world');
        await expect(control.evaluate('document.title', { context: 1 })).resolves.toEqual({ value: 'main world' });
        expect(helper.calls.at(-1)?.[1]).toMatchObject({ world: 'page' });

        events.length = 0;
        control.stateChanged({ loading: true });
        helper.navigate('https://example.test/next');
        control.stateChanged({ loading: false });
        await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({ type: 'context-created', context: 2 })));
        expect(events).toEqual([
            { type: 'frame-loading', frameId: 'main' },
            { type: 'frame-stopped-loading', frameId: 'main' },
            { type: 'context-destroyed', context: 1 },
            { type: 'frame-navigated', frame: { id: 'main', loaderId: `page#${'2'.padStart(32, '0')}`, url: 'https://example.test/next', origin: 'https://example.test' } },
            { type: 'context-created', context: 2, frameId: 'main', origin: 'https://example.test', isDefault: true },
        ]);
        await expect(control.evaluate('x', { context: 1 })).rejects.toThrow('Cannot find context');
    });

    it('reports same-document URL changes', async () => {
        const helper = fakeHelper();
        const control = new WkWebViewBrowserControl(helper.request);
        const events: BrowserControlEvent[] = [];
        control.onEvent(event => events.push(event));
        await control.enableFrameEvents();
        await control.frameTree();
        helper.page.url = 'https://example.test/#hash';
        control.stateChanged({ loading: false });
        await vi.waitFor(() => expect(events).toEqual([{ type: 'frame-same-document', frameId: 'main' }]));
        expect((await control.frameTree()).frame.url).toBe('https://example.test/#hash');
    });

    it('binds isolated worlds to one document and fails them after navigation', async () => {
        const helper = fakeHelper();
        const control = new WkWebViewBrowserControl(helper.request);
        const context = await control.createIsolatedWorld('main', 'coc-browser-annotation');
        helper.setValue((_expression, world) => world);
        await expect(control.evaluate('1', { context })).resolves.toEqual({ value: 'coc-browser-annotation' });
        helper.navigate('https://example.test/next');
        // The helper's in-call token check fails even before main hears about the navigation.
        await expect(control.evaluate('1', { context })).rejects.toThrow('Cannot find context');
        await expect(control.createIsolatedWorld('child', 'coc-browser-annotation')).rejects.toThrow('No frame');
    });

    it('measures the viewport in its own world and captures viewport-relative screenshots', async () => {
        const helper = fakeHelper();
        const control = new WkWebViewBrowserControl(helper.request);
        await expect(control.layoutMetrics()).resolves.toEqual({ clientWidth: 800, clientHeight: 600, pageX: 0, pageY: 300 });
        expect(helper.calls.at(-1)?.[1]).toMatchObject({ world: 'coc-control' });
        await expect(control.screenshot({ format: 'jpeg', quality: 75, clip: { x: 10, y: 320, width: 100, height: 50, scale: 0.5 } })).resolves.toBe('aW1n');
        expect(helper.calls.at(-1)).toEqual(['screenshot', { rect: { x: 10, y: 20, width: 100, height: 50 }, scale: 0.5, format: 'jpeg', quality: 75 }]);
    });

    it('has no main-frame owner, other targets or document-start scripts', async () => {
        const control = new WkWebViewBrowserControl(fakeHelper().request);
        await expect(control.callOnFrameOwner('main', {}, 'function(){}', [])).resolves.toBeUndefined();
        await expect(control.callOnFrameOwner('child', {}, 'function(){}', [])).rejects.toThrow('No frame');
        await expect(control.frameTree('child')).rejects.toThrow('No target');
        await expect(control.addDocumentStartScript('1')).rejects.toThrow('unsupported-runtime');
        await expect(control.setChildFrameAttach(true)).resolves.toBeUndefined();
    });

    it('reports child frames from helper events with per-document default contexts', async () => {
        const helper = fakeHelper();
        const control = new WkWebViewBrowserControl(helper.request);
        const events: BrowserControlEvent[] = [];
        control.onEvent(event => events.push(event));
        await control.enableFrameEvents();
        await control.enableContextEvents();
        events.length = 0;

        deliver(control, helper.child('main/1', 'main', 1, 'https://child.test/a'));
        deliver(control, helper.child('main/1/1', 'main/1', 1, 'https://leaf.test/'));
        const childToken = helper.frames.get('main/1')!.token;
        await vi.waitFor(() => expect(events.filter(event => event.type === 'context-created')).toHaveLength(2));
        expect(events).toEqual([
            { type: 'frame-attached', frameId: 'main/1', parentFrameId: 'main' },
            { type: 'frame-navigated', frame: { id: 'main/1', parentId: 'main', loaderId: childToken, url: 'https://child.test/a', origin: 'https://child.test' } },
            { type: 'frame-attached', frameId: 'main/1/1', parentFrameId: 'main/1' },
            expect.objectContaining({ type: 'frame-navigated', frame: expect.objectContaining({ id: 'main/1/1', parentId: 'main/1' }) }),
            { type: 'context-created', context: expect.any(Number), frameId: 'main/1', origin: 'https://child.test', isDefault: true },
            { type: 'context-created', context: expect.any(Number), frameId: 'main/1/1', origin: 'https://leaf.test', isDefault: true },
        ]);
        const context = (events[4] as { context: number }).context;

        const tree = await control.frameTree();
        expect(tree.children).toEqual([{
            frame: expect.objectContaining({ id: 'main/1', loaderId: childToken }),
            children: [{ frame: expect.objectContaining({ id: 'main/1/1', parentId: 'main/1' }), children: [] }],
        }]);

        helper.setValue((_expression, world, frame) => `${world}@${frame}`);
        await expect(control.evaluate('1', { context })).resolves.toEqual({ value: 'page@main/1' });
        expect(helper.calls.at(-1)?.[1]).toMatchObject({ world: 'page', frame: 'main/1' });

        // A new child document detaches its descendants first and retires the old context.
        events.length = 0;
        deliver(control, helper.child('main/1', 'main', 1, 'https://child.test/b'));
        await vi.waitFor(() => expect(events.at(-1)?.type).toBe('context-created'));
        expect(events.map(event => event.type)).toEqual(['context-destroyed', 'frame-detached', 'context-destroyed', 'frame-navigated', 'context-created']);
        expect(events[1]).toEqual({ type: 'frame-detached', frameId: 'main/1/1', swapped: false });
        await expect(control.evaluate('1', { context })).rejects.toThrow('Cannot find context');

        // A removed frame's contexts fail even before main hears of the removal.
        const next = (events.at(-1) as { context: number }).context;
        const removal = helper.remove('main/1');
        await expect(control.evaluate('1', { context: next })).rejects.toThrow('Cannot find context');
        events.length = 0;
        deliver(control, removal);
        expect(events).toEqual([{ type: 'context-destroyed', context: next }, { type: 'frame-detached', frameId: 'main/1', swapped: false }]);
        expect((await control.frameTree()).children).toEqual([]);
    });

    it('reconciles child frames with the helper snapshot', async () => {
        const helper = fakeHelper();
        const control = new WkWebViewBrowserControl(helper.request);
        // Frames the control never heard about, and one it heard about that is gone.
        helper.child('main/1', 'main', 1, 'https://child.test/');
        deliver(control, [['frame-navigated', { frameId: 'main/9', parentFrameId: 'main', owner: 9, token: 'f'.repeat(32), url: 'https://gone.test/', origin: 'https://gone.test' }]]);
        // Malformed events are ignored.
        deliver(control, [['frame-navigated', { frameId: 'main/2', parentFrameId: 'main', owner: 2, token: 'not-a-token', url: 'https://x.test/', origin: 'https://x.test' }]]);
        const tree = await control.frameTree();
        expect(tree.children?.map(child => child.frame.id)).toEqual(['main/1']);
        await expect(control.createIsolatedWorld('main/9', 'coc-browser-annotation')).rejects.toThrow('No frame');
    });

    it('calls functions on a child frame owner in the parent document', async () => {
        const helper = fakeHelper();
        const control = new WkWebViewBrowserControl(helper.request);
        deliver(control, helper.navigate('https://example.test/'));
        deliver(control, helper.child('main/1', 'main', 1, 'https://child.test/'));
        deliver(control, helper.child('main/1/2', 'main/1', 2, 'https://leaf.test/'));
        await control.enableContextEvents();
        const main = await control.createIsolatedWorld('main', 'coc-browser-control');
        const child = await control.createIsolatedWorld('main/1', 'coc-browser-control');
        helper.setValue((expression, world, frame) => ({ world, frame, args: /\.apply\(owner, (.*)\) \}/.exec(expression)?.[1] }));

        await expect(control.callOnFrameOwner('main/1', { context: main }, 'function(a){return a}', [true, { x: 1 }]))
            .resolves.toEqual({ value: { world: 'coc-frames', frame: 'main', args: '[true,{"x":1}]' } });
        expect(helper.calls.at(-1)?.[1]).not.toHaveProperty('frame');
        await expect(control.callOnFrameOwner('main/1/2', { context: child }, 'function(){}', []))
            .resolves.toEqual({ value: expect.objectContaining({ frame: 'main/1' }) });
        // A parent context of another frame does not own it.
        await expect(control.callOnFrameOwner('main/1/2', { context: main }, 'function(){}', [])).resolves.toBeUndefined();
        await expect(control.callOnFrameOwner('main/1', { context: 999 }, 'function(){}', [])).rejects.toThrow('Cannot find context');
        await expect(control.callOnFrameOwner('main/1', { target: 'x' }, 'function(){}', [])).rejects.toThrow('No target');

        // The owner element is gone but main has not heard yet.
        helper.frames.get('main')!.owned.delete(1);
        await expect(control.callOnFrameOwner('main/1', {}, 'function(){}', [])).resolves.toBeUndefined();
        // The parent committed a document main has not heard of yet.
        helper.frames.get('main')!.owned.add(1);
        helper.frames.get('main')!.token = 'e'.repeat(32);
        await expect(control.callOnFrameOwner('main/1', {}, 'function(){}', [])).rejects.toThrow('Cannot find context');
        helper.setValue(() => { throw new BrowserHostError('evaluation-failed' as never, 'TypeError: boom'); });
        deliver(control, [['frame-navigated', { frameId: 'main', token: 'e'.repeat(32) }]]);
        await expect(control.callOnFrameOwner('main/1', {}, 'function(){}', [])).resolves.toEqual({ exception: 'TypeError: boom' });
    });

    it('binds child isolated worlds to the frame document main knows', async () => {
        const helper = fakeHelper();
        const control = new WkWebViewBrowserControl(helper.request);
        deliver(control, helper.child('main/1', 'main', 1, 'https://child.test/'));
        // The frame committed a new document the control has not heard of.
        helper.child('main/1', 'main', 1, 'https://child.test/next');
        await expect(control.createIsolatedWorld('main/1', 'coc-browser-annotation')).rejects.toThrow('Isolated world is unavailable');
        deliver(control, helper.child('main/1', 'main', 1, 'https://child.test/third'));
        const context = await control.createIsolatedWorld('main/1', 'coc-browser-annotation');
        helper.setValue((_expression, world, frame) => `${world}@${frame}`);
        await expect(control.evaluate('1', { context })).resolves.toEqual({ value: 'coc-browser-annotation@main/1' });
        helper.child('main/1', 'main', 1, 'https://child.test/fourth');
        await expect(control.evaluate('1', { context })).rejects.toThrow('Cannot find context');
    });

    it('reports crashes and closure as a detached transport and rejects later calls', async () => {
        const helper = fakeHelper();
        const control = new WkWebViewBrowserControl(helper.request);
        const events: BrowserControlEvent[] = [];
        control.onEvent(event => events.push(event));
        control.stateChanged({ loading: false, errorCode: 'runtime-crashed' });
        expect(events).toEqual([{ type: 'crashed' }, { type: 'detached', reason: 'crashed' }]);
        await expect(control.evaluate('1')).rejects.toMatchObject({ reason: 'not-found' });
        await expect(control.mouse({ type: 'move', x: 1, y: 1 })).rejects.toMatchObject({ reason: 'not-found' });
        expect(() => control.onEvent(() => {})).toThrow('unavailable');
        control.close('detached');
        expect(events).toHaveLength(2);
    });

    it('drives the shared frame registry across child frames', async () => {
        const helper = fakeHelper();
        const control = new WkWebViewBrowserControl(helper.request);
        const registry = new BrowserFrameRegistry(control, vi.fn());
        deliver(control, helper.child('main/1', 'main', 1, 'https://child.test/'));
        helper.setValue((expression, _world, frame) => expression.includes('readyState') ? true : `title@${frame}`);
        await registry.start();
        const frames = registry.list();
        expect(frames).toEqual([
            expect.objectContaining({ rawId: 'main', depth: 0, status: 'ready' }),
            expect.objectContaining({ rawId: 'main/1', depth: 1, status: 'ready', origin: 'https://child.test' }),
        ]);
        const handle = frames[1]!.id;
        await expect(registry.evaluate('document.title', handle)).resolves.toBe('title@main/1');

        // A child added after start appears once its default context exists.
        deliver(control, helper.child('main/2', 'main', 2, 'https://other.test/'));
        await vi.waitFor(() => expect(registry.list().find(frame => frame.rawId === 'main/2')?.status).toBe('ready'));

        const revision = registry.revision;
        deliver(control, helper.remove('main/1'));
        expect(() => registry.assert(revision)).toThrow('stale');
        await expect(registry.evaluate('1', handle)).rejects.toThrow('stale');
        expect(registry.list().map(frame => frame.rawId)).toEqual(['main', 'main/2']);
        await registry.stop();
    });

    it('drives the shared frame registry on the main frame', async () => {
        const helper = fakeHelper();
        const control = new WkWebViewBrowserControl(helper.request);
        const invalidate = vi.fn();
        const registry = new BrowserFrameRegistry(control, invalidate);
        helper.setValue(expression => expression.includes('readyState') ? true : 'title');
        await registry.start();
        const [frame] = registry.list();
        expect(frame).toMatchObject({ rawId: 'main', status: 'ready', origin: 'https://example.test', context: 1 });
        const handle = frame!.id;
        await expect(registry.evaluate('document.title', handle)).resolves.toBe('title');

        const revision = registry.revision;
        control.stateChanged({ loading: true });
        helper.navigate('https://example.test/next');
        control.stateChanged({ loading: false });
        await vi.waitFor(() => expect(registry.list()[0]?.context).toBe(2));
        expect(() => registry.assert(revision)).toThrow('stale');
        expect(registry.list()[0]!.id).not.toBe(handle);
        await expect(registry.evaluate('1', handle)).rejects.toThrow('stale');
        await registry.stop();
    });
});
