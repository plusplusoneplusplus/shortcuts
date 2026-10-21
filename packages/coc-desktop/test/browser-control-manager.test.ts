import { describe, expect, it, vi } from 'vitest';
import { BrowserHostManager } from '../src/browser-host-manager';
import { BrowserControlPage } from '../src/browser-control-page';
import type { RichClipboard } from '../src/browser-rich-clipboard';
import type { BrowserCommand } from '@plusplusoneplusplus/coc-client';
import type { BrowserEngineHost, BrowserHostedView, BrowserEventSink } from '../src/browser-host-contract';
import { BROWSER_CONTROL_REVEAL_CHANNEL } from '../src/browser-control-command';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

function harness(redirectTo?: string, richClipboard?: RichClipboard) {
    const views: BrowserHostedView[] = [];
    const sinks: BrowserEventSink[] = [];
    const host: BrowserEngineHost = {
        engine: 'electron', availability: async () => ({ engine: 'electron', available: true }),
        clearData: async () => {}, dispose: async () => {},
        create: async (request, sink) => {
            sinks.push(sink);
            let url = redirectTo ?? request.url;
            const view: BrowserHostedView = {
                snapshot: () => ({ viewId: request.viewId, engine: 'electron', url, title: 'Fixture', canGoBack: true, canGoForward: false, loading: false }),
                navigate: vi.fn(async next => { url = next; }), nav: vi.fn(),
                setBounds: vi.fn(), focus: vi.fn(), close: vi.fn(),
                cdp: vi.fn(async (method, params) => {
                    if (method === 'Runtime.evaluate') {
                        if (String(params?.expression).includes('"action":"snapshot"')) return { result: { value: { title: 'Fixture', url, elements: [], nextRef: 1 } } };
                        if (String(params?.expression).includes('"action":"read"')) {
                            const text = '# Fixture\n\nContent';
                            return { result: { value: { text, textTotal: text.length } } };
                        }
                        return { result: { value: { valueJson: '42', valueTruncated: false } } };
                    }
                    return {};
                }),
            };
            views.push(view);
            return view;
        },
    };
    const send = vi.fn();
    const manager = new BrowserHostManager({
        richClipboard,
        history: { recordVisit: async () => true, updateTitle: async () => true, flush: async () => {}, clearEngine: async () => true },
        hosts: { electron: host, webview2: { ...host, engine: 'webview2' } },
        fileHost: { create: async request => ({
            snapshot: () => ({ viewId: request.viewId, engine: 'electron', url: 'file:///preview', title: '', loading: false, canGoBack: false, canGoForward: false }),
            navigate: () => {}, nav: () => {}, close: () => {}, setBounds: () => {}, focus: () => {},
        }), dispose: async () => {} },
        getDefault: () => 'electron', saveDefault: () => {}, getPageZoom: () => 100, savePageZoom: () => {}, send, changed: () => {},
    });
    manager.bindControlScope(1, 'w', 'w');
    manager.bindControlScope(2, 'w', 'w');
    manager.bindControlScope(3, 'other', 'other');
    const run = (command: BrowserCommand, selectedTab?: string, processId = 'p', signal?: AbortSignal) =>
        manager.executeControl(1, { id: 'r', workspaceId: 'w', processId, command, selectedTab }, signal);
    return { manager, run, views, sinks, send };
}

describe('main browser control scope and selection', () => {
    it('routes rich paste through native focus and the clipboard without clicking or selecting all', async () => {
        const clipboard = { availableFormats: () => [], write: vi.fn() };
        const h = harness(undefined, clipboard);
        const configure = vi.spyOn(BrowserControlPage.prototype, 'configureFrames').mockResolvedValue();
        const paste = vi.spyOn(BrowserControlPage.prototype, 'pasteHtml').mockImplementation(async (_ref, write) => {
            expect(h.views[0].focus).toHaveBeenCalledOnce();
            write();
        });
        try {
            const opened = await h.run({ action: 'open', url: 'https://fixture.test/' });
            await h.manager.executeControl(1, { id: 'paste', workspaceId: 'w', processId: 'p',
                framesEnabled: true, richPasteEnabled: true, selectedTab: opened.tab,
                command: { action: 'paste_html', ref: 'e1', html: '<b>Synthetic</b>', text: 'Synthetic' } });
            expect(paste).toHaveBeenCalledOnce();
            expect(clipboard.write).toHaveBeenCalledExactlyOnceWith({ html: '<b>Synthetic</b>', text: 'Synthetic' });
            expect(vi.mocked(h.views[0].cdp!).mock.calls.some(([method]) => method.startsWith('Input.'))).toBe(false);
        } finally {
            configure.mockRestore();
            paste.mockRestore();
            await h.manager.dispose();
        }
    });
    it('focuses an embedded view before keyboard input but not for reads', async () => {
        const h = harness();
        try {
            const opened = await h.run({ action: 'open', url: 'https://fixture.test/' });
            const view = h.views[0];
            const order: string[] = [];
            vi.mocked(view.focus).mockImplementation(() => { order.push('focus'); });
            const cdp = vi.mocked(view.cdp!);
            const original = cdp.getMockImplementation()!;
            cdp.mockImplementation(async (method, params, session) => {
                if (method === 'Input.dispatchKeyEvent') order.push(String(params?.type));
                return original(method, params, session);
            });
            await h.run({ action: 'read' }, opened.tab);
            expect(order).toEqual([]);
            await h.run({ action: 'press', key: 'Control+v' }, opened.tab);
            expect(order).toEqual(['focus', 'keyDown', 'keyUp']);
        } finally {
            await h.manager.dispose();
        }
    });

    it.each(['failure', 'abort'] as const)('does not dispatch input after focus %s', async outcome => {
        const h = harness();
        try {
            const opened = await h.run({ action: 'open', url: 'https://fixture.test/' });
            const controller = new AbortController();
            const error = new Error('Synthetic focus unavailable');
            vi.mocked(h.views[0].focus).mockImplementation(() => {
                if (outcome === 'failure') throw error;
                controller.abort(error);
            });
            const cdp = vi.mocked(h.views[0].cdp!);
            cdp.mockClear();
            await expect(h.run({ action: 'press', key: 'x' }, opened.tab, 'p', controller.signal)).rejects.toThrow(error.message);
            expect(cdp.mock.calls.some(([method]) => method.startsWith('Input.'))).toBe(false);
        } finally {
            await h.manager.dispose();
        }
    });

    it('lets concurrent conversations alternate a shared tab without marking the displaced conversation finished', async () => {
        const h = harness();
        const opened = await h.run({ action: 'open', url: 'https://fixture.test/' }, undefined, 'conversation-a');
        await h.run({ action: 'select', tab: opened.tab! }, undefined, 'conversation-b');
        await expect(h.run({ action: 'read' }, opened.tab, 'conversation-a')).resolves.toMatchObject({ text: '# Fixture\n\nContent' });
        await expect(h.run({ action: 'read' }, opened.tab, 'conversation-b')).resolves.toMatchObject({ text: '# Fixture\n\nContent' });
        await h.manager.dispose();
    });

    it('does not navigate a newly opened redirected tab twice', async () => {
        const h = harness('https://fixture.test/destination');
        const opened = await h.run({ action: 'open', url: 'https://fixture.test/start' });
        expect(opened.url).toBe('https://fixture.test/destination');
        expect(h.views[0].navigate).not.toHaveBeenCalled();
        await h.manager.dispose();
    });

    it('returns a separate full interactive baseline for subtree and all snapshots', async () => {
        const h = harness();
        const opened = await h.run({ action: 'open', url: 'https://fixture.test/' });
        const displayed = [{ ref: 'e1', role: 'heading', name: 'Subtree', depth: 0 }];
        const interactive = [...displayed, { ref: 'e2', role: 'button', name: 'Elsewhere', depth: 0 }];
        const cdp = vi.mocked(h.views[0].cdp!);
        for (const command of [{ action: 'snapshot', ref: 'e1' }, { action: 'snapshot', all: true }] as BrowserCommand[]) {
            cdp.mockResolvedValueOnce({ result: { value: { title: 'Fixture', url: 'https://fixture.test/', elements: displayed, nextRef: 3 } } })
                .mockResolvedValueOnce({ result: { value: { title: 'Fixture', url: 'https://fixture.test/', elements: interactive, nextRef: 3 } } });
            const result = await h.run(command, opened.tab);
            expect(result.elements).toEqual(displayed);
            expect(result.interactiveElements).toEqual(interactive);
        }
        await h.manager.dispose();
    });

    it('transport-pages full markdown at the requested offset and reports its total length without a hint', async () => {
        const h = harness();
        const opened = await h.run({ action: 'open', url: 'https://fixture.test/' });
        const text = 'A'.repeat(8000) + 'B'.repeat(8000) + 'End';
        const cdp = vi.mocked(h.views[0].cdp!);
        cdp.mockImplementation(async (method, params) => {
            expect(method).toBe('Runtime.evaluate');
            const expression = String(params?.expression);
            expect(expression).toContain('"action":"read"');
            const offset = Number(expression.match(/"offset":(\d+)/)?.[1] ?? 0);
            return { result: { value: { text: text.slice(offset, offset + 8000), textTotal: text.length } } };
        });
        expect(await h.run({ action: 'read' }, opened.tab)).toMatchObject({ text: 'A'.repeat(8000), textTotal: 16003 });
        expect(await h.run({ action: 'read', offset: 8000 }, opened.tab)).toMatchObject({ text: 'B'.repeat(8000), textTotal: 16003 });
        expect(await h.run({ action: 'read', offset: 16000 }, opened.tab)).toMatchObject({ text: 'End', textTotal: 16003 });
        expect(await h.run({ action: 'read', offset: 17000 }, opened.tab)).toMatchObject({ text: '', textTotal: 16003 });
        await h.manager.dispose();
    });

    it.each([undefined, 'jpeg', 'png'] as const)('forwards screenshot format %s to the shared control page', async format => {
        const h = harness();
        const opened = await h.run({ action: 'open', url: 'https://fixture.test/' });
        const cdp = vi.mocked(h.views[0].cdp!);
        cdp.mockClear();
        cdp.mockResolvedValueOnce({ cssVisualViewport: { clientWidth: 800, clientHeight: 600, pageX: 0, pageY: 0 } })
            .mockResolvedValueOnce({ result: { value: { valueJson: '1', valueTruncated: false } } })
            .mockResolvedValueOnce({ data: 'fixture==' });
        expect(await h.run({ action: 'screenshot', ...(format ? { format } : {}) }, opened.tab)).toMatchObject({
            tab: opened.tab, title: 'Fixture', url: 'https://fixture.test/',
            image: { data: 'fixture==', mimeType: format === 'png' ? 'image/png' : 'image/jpeg' },
        });
        expect(cdp.mock.calls.map(([method]) => method)).toEqual(['Page.getLayoutMetrics', 'Runtime.evaluate', 'Page.captureScreenshot']);
        expect(cdp).toHaveBeenLastCalledWith('Page.captureScreenshot', {
            format: format ?? 'jpeg', ...(format === 'png' ? {} : { quality: 75 }), captureBeyondViewport: true,
            clip: { x: 0, y: 0, width: 800, height: 600, scale: 1 },
        });
        await h.manager.dispose();
    });

    it('includes real engine popup URL views in their opener workspace, focuses them and rejects calls when closed', async () => {
        const h = harness();
        await h.manager.open(1, 'opener', 'https://fixture.test/', 'w');
        const popup = {
            ...h.views[0], focus: vi.fn(), close: vi.fn(),
            snapshot: () => ({ ...h.views[0].snapshot(), viewId: 'popup', url: 'https://fixture.test/popup' }),
        };
        h.sinks[0].controlPopoutOpened!('popup', popup);
        expect((await h.run({ action: 'tabs' })).tabs?.map(tab => tab.id)).toEqual(['t1:opener', 't1:popup']);
        await h.run({ action: 'select', tab: 't1:popup' });
        expect(popup.focus).toHaveBeenCalledOnce();
        await expect(h.manager.executeControl(3, { id: 'r', workspaceId: 'other', processId: 'p', command: { action: 'select', tab: 't1:popup' } })).rejects.toThrow('not found');
        const waiting = h.run({ action: 'wait', ms: 30_000 }, 't1:popup');
        h.sinks[0].controlPopoutClosed!('popup');
        await expect(waiting).rejects.toThrow('popout closed');
        expect((await h.run({ action: 'tabs' })).tabs?.map(tab => tab.id)).toEqual(['t1:opener']);
        await h.manager.dispose();
    });
    it('lists workspace URL tabs across owners/popouts, never files, other workspaces or another clone with the same workspace id', async () => {
        const h = harness();
        await h.manager.open(1, 'one', 'https://fixture.test/', 'w');
        await h.manager.open(2, 'two', 'https://popout.test/', 'w');
        await h.manager.open(3, 'other', 'https://other.test/', 'other');
        h.manager.bindControlScope(4, 'w', 'remote:server:w');
        await h.manager.open(4, 'remote', 'https://remote.test/', 'remote:server:w');
        const directory = mkdtempSync(path.join(process.cwd(), '.browser-control-fixture-'));
        try {
            const fixture = path.join(directory, 'preview.html');
            writeFileSync(fixture, '<h1>Preview</h1>');
            expect(await h.manager.openSource(1, 'file', { kind: 'file', path: fixture }, 'w')).toMatchObject({ ok: true });
            expect((await h.run({ action: 'tabs' })).tabs?.map(tab => tab.id)).toEqual(['t1:one', 't2:two']);
            await expect(h.run({ action: 'select', tab: 't1:file' })).rejects.toThrow('not found');
        } finally { rmSync(directory, { recursive: true, force: true }); }
        await expect(h.run({ action: 'select', tab: 't3:other' })).rejects.toThrow('not found');
        await expect(h.run({ action: 'select', tab: 't4:remote' })).rejects.toThrow('not found');
        await expect(h.manager.executeControl(3, { id: 'r', workspaceId: 'w', processId: 'p', command: { action: 'tabs' } })).rejects.toThrow('scope changed');
        await h.manager.dispose();
    });

    it('opens normal tabs, reveals with the conversation owner, uses server-provided selection and gives select tab precedence', async () => {
        const h = harness();
        const first = await h.run({ action: 'open', url: 'https://fixture.test/' });
        expect(first.tab).toMatch(/^t1:browser-/);
        expect(h.send).toHaveBeenCalledWith(1, BROWSER_CONTROL_REVEAL_CHANNEL, expect.objectContaining({ workspaceId: 'w', processId: 'p' }));
        const second = await h.run({ action: 'open', url: 'https://fixture.test/two' }, first.tab);
        expect(second.tab).toBe(first.tab);
        expect(h.views).toHaveLength(1);
        const separate = await h.run({ action: 'open', url: 'https://fixture.test/', newTab: true }, first.tab, 'q');
        expect(separate.tab).not.toBe(first.tab);
        expect(h.views).toHaveLength(2);
        const snapshot = await h.run({ action: 'snapshot' }, first.tab);
        expect(snapshot.tab).toBe(first.tab);
        await expect(h.run({ action: 'snapshot', tab: first.tab }, separate.tab)).rejects.toThrow('unexpected parameter tab');
        await expect(h.run({ action: 'open', url: 'https://fixture.test/', tab: first.tab }, separate.tab)).rejects.toThrow('unexpected parameter tab');
        const selected = await h.run({ action: 'select', tab: separate.tab! }, first.tab, 'q');
        expect(selected.tab).toBe(separate.tab);
        expect((await h.run({ action: 'read' }, first.tab)).text).toBe('# Fixture\n\nContent');
        expect(await h.run({ action: 'eval', js: '42' }, first.tab)).toMatchObject({ valueJson: '42', valueTruncated: false });
        // No manager-owned conversation selection; absent server state fails closed.
        await expect(h.run({ action: 'snapshot' })).rejects.toThrow('No browser tab selected');
        await h.manager.dispose();
    });

    it('routes same-workspace selection to its owning window and rejects closed/stale tabs', async () => {
        const h = harness();
        await h.manager.open(2, 'popout', 'https://fixture.test/', 'w');
        await h.run({ action: 'select', tab: 't2:popout' });
        expect(h.send).toHaveBeenCalledWith(2, BROWSER_CONTROL_REVEAL_CHANNEL, expect.objectContaining({ viewId: 'popout' }));
        await h.manager.close(2, 'popout');
        await expect(h.run({ action: 'snapshot' }, 't2:popout')).rejects.toThrow('not found');
        const replacement = await h.run({ action: 'open', url: 'https://fixture.test/' }, 't2:popout');
        expect(replacement.tab).not.toBe('t2:popout');
        await expect(h.run({ action: 'select', tab: 't2:popout' }, replacement.tab)).rejects.toThrow('not found');
        await h.manager.dispose();
    });

    it('keeps serving a retained background scope after the window selects another workspace, isolated per routing ref', async () => {
        const h = harness();
        const exec = (workspaceId: string, command: BrowserCommand, routingRef?: string, selectedTab?: string) =>
            h.manager.executeControl(1, { id: 'r', workspaceId, processId: 'p', command, selectedTab }, undefined, routingRef);
        const opened = await h.run({ action: 'open', url: 'https://fixture.test/' });
        await h.manager.open(1, 'b-tab', 'https://b.test/', 'b');
        h.manager.bindControlScope(4, 'w', 'remote:server:w');
        await h.manager.open(4, 'remote', 'https://remote.test/', 'remote:server:w');
        h.manager.retainControlScope(1, 'w', 'w');
        h.manager.bindControlScope(1, 'b', 'b');
        h.send.mockClear();
        expect(h.manager.controlSessionKey(1, 'w', 'w')).toBe('w');
        expect(h.manager.controlSessionKey(1, 'b')).toBe('b');
        // Foreground-only routing (no ref) no longer reaches the background workspace.
        await expect(exec('w', { action: 'tabs' })).rejects.toThrow('scope changed');
        expect((await exec('w', { action: 'tabs' }, 'w')).tabs?.map(tab => tab.id)).toEqual([opened.tab]);
        expect((await exec('b', { action: 'tabs' })).tabs?.map(tab => tab.id)).toEqual(['t1:b-tab']);
        await expect(exec('w', { action: 'read' }, 'w', opened.tab)).resolves.toMatchObject({ text: '# Fixture\n\nContent' });
        expect(h.send).toHaveBeenCalledWith(1, BROWSER_CONTROL_REVEAL_CHANNEL, expect.objectContaining({ workspaceId: 'w', routingRef: 'w', background: true }));
        // Never another workspace's or another clone's tabs, even with a retained ref.
        await expect(exec('w', { action: 'select', tab: 't1:b-tab' }, 'w')).rejects.toThrow('not found');
        await expect(exec('w', { action: 'select', tab: 't4:remote' }, 'w')).rejects.toThrow('not found');
        await expect(exec('b', { action: 'tabs' }, 'w')).rejects.toThrow('scope changed');
        await expect(exec('w', { action: 'tabs' }, 'remote:server:w')).rejects.toThrow('scope changed');
        // Foreground reveals stay unflagged.
        h.send.mockClear();
        await exec('b', { action: 'select', tab: 't1:b-tab' });
        expect(h.send).toHaveBeenCalledWith(1, BROWSER_CONTROL_REVEAL_CHANNEL, expect.not.objectContaining({ background: true }));
        h.manager.retainControlScope(1, 'w', null);
        await expect(exec('w', { action: 'tabs' }, 'w')).rejects.toThrow('scope changed');
        h.manager.retainControlScope(1, 'w', 'w');
        h.manager.bindControlScope(1, null, null);
        expect(h.manager.retainedSessionKeys(1).size).toBe(0);
        await h.manager.dispose();
    });

    it('validates and bounds retained background scopes', async () => {
        const h = harness();
        expect(() => h.manager.retainControlScope(1, '', 'w')).toThrow(TypeError);
        expect(() => h.manager.retainControlScope(1, 'w', 42)).toThrow(TypeError);
        for (let i = 0; i < 64; i++) h.manager.retainControlScope(1, `ws-${i}`, `ws-${i}`);
        expect(() => h.manager.retainControlScope(1, 'ws-64', 'ws-64')).toThrow('Too many');
        h.manager.retainControlScope(1, 'ws-0', 'ws-0');
        expect(h.manager.retainedSessionKeys(1).size).toBe(64);
        await h.manager.dispose();
    });

    it('serializes navigation, snapshots and raw eval in one retained control queue', async () => {
        const h = harness();
        const first = await h.run({ action: 'open', url: 'https://fixture.test/' });
        await h.run({ action: 'navigate', direction: 'reload' }, first.tab);
        expect(h.views[0].nav).toHaveBeenCalledWith('reload');
        const controller = new AbortController();
        const waiting = h.run({ action: 'wait', ms: 30_000 }, first.tab, 'p', controller.signal);
        const evalResult = h.run({ action: 'eval', js: '42' }, first.tab);
        controller.abort(new Error('Stopped'));
        await expect(waiting).rejects.toThrow('Stopped');
        await expect(evalResult).resolves.toMatchObject({ valueJson: '42', valueTruncated: false });
        await h.manager.dispose();
    });
});
