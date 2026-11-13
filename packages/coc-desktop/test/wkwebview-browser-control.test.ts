import { describe, expect, it, vi } from 'vitest';
import { BrowserHostError } from '../src/browser-host-contract';
import type { BrowserControlEvent } from '../src/browser-control-engine';
import { BrowserFrameRegistry } from '../src/browser-frame-registry';
import { WkWebViewBrowserControl } from '../src/wkwebview-browser-control';

/** A fake helper: one document at a time, each world with its own per-document token. */
function fakeHelper() {
    const page = { document: 1, url: 'https://example.test/', worlds: new Map<string, string>() };
    const calls: [string, Record<string, unknown>][] = [];
    const token = (world: string) => {
        if (!page.worlds.has(world)) page.worlds.set(world, `${world}#${page.document}`);
        return page.worlds.get(world)!;
    };
    let value: (expression: string, world: string) => unknown = () => 'value';
    const request = vi.fn(async (op: string, payload: Record<string, unknown>) => {
        calls.push([op, payload]);
        if (op === 'screenshot') return { data: 'aW1n' };
        if (op !== 'evaluate') return undefined;
        const expression = String(payload.expression);
        const world = String(payload.world);
        if (expression.startsWith('({ token:')) return { value: { token: token(world), url: page.url, origin: new URL(page.url).origin } };
        if (expression.startsWith('(() => { const key')) return { value: token(world) };
        if (expression.includes('visualViewport')) return { value: { clientWidth: 800, clientHeight: 600, pageX: 0, pageY: 300 } };
        if (expression.includes('coc-stale-context')) {
            const expected = JSON.parse(/!== ("[^"]*")\) throw/.exec(expression)![1]);
            if (token(world) !== expected) throw new BrowserHostError('evaluation-failed' as never, 'Error: coc-stale-context');
        }
        return { value: value(expression, world) };
    });
    return {
        page, calls, request,
        setValue(next: typeof value) { value = next; },
        navigate(url: string) { page.document++; page.url = url; page.worlds.clear(); },
    };
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

    it('reports the main frame tree and the default context, and retires contexts on navigation', async () => {
        const helper = fakeHelper();
        const control = new WkWebViewBrowserControl(helper.request);
        const events: BrowserControlEvent[] = [];
        control.onEvent(event => events.push(event));
        await control.enableFrameEvents();
        const tree = await control.frameTree();
        expect(tree).toEqual({ frame: { id: 'main', loaderId: 'page#1', url: 'https://example.test/', origin: 'https://example.test' } });
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
            { type: 'frame-navigated', frame: { id: 'main', loaderId: 'page#2', url: 'https://example.test/next', origin: 'https://example.test' } },
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

    it('has no child frames, owners or document-start scripts yet', async () => {
        const control = new WkWebViewBrowserControl(fakeHelper().request);
        await expect(control.callOnFrameOwner('main', {}, 'function(){}', [])).resolves.toBeUndefined();
        await expect(control.callOnFrameOwner('child', {}, 'function(){}', [])).rejects.toThrow('No frame');
        await expect(control.frameTree('child')).rejects.toThrow('No target');
        await expect(control.addDocumentStartScript('1')).rejects.toThrow('unsupported-runtime');
        await expect(control.setChildFrameAttach(true)).resolves.toBeUndefined();
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
