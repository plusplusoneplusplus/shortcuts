import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BROWSER_DEMO_RECORDING_ERROR, BrowserHostManager } from '../src/browser-host-manager';
import type { BrowserEngineHost, BrowserEventSink, BrowserHostedView } from '../src/browser-host-contract';
import { BROWSER_VIEW_NEW_TAB_CHANNEL } from '../src/browser-view-policy';
import type { BrowserDemoCapture } from '../src/browser-demo-recorder';
import type { BrowserDemoTabSink } from '../src/browser-demo-tab-capture';

const owner = { workspaceId: 'w', processId: 'p', routingRef: 'w' };

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

function harness() {
    const sinks = new Map<string, BrowserEventSink>();
    const views = new Map<string, BrowserHostedView>();
    const host: BrowserEngineHost = {
        engine: 'electron', availability: async () => ({ engine: 'electron', available: true }),
        clearData: async () => {}, dispose: async () => {},
        create: async (request, sink) => {
            sinks.set(request.viewId, sink);
            const view: BrowserHostedView = {
                snapshot: () => ({ viewId: request.viewId, engine: 'electron', url: request.url, title: 'Fixture', canGoBack: false, canGoForward: false, loading: false }),
                navigate: vi.fn(), nav: vi.fn(), setBounds: vi.fn(), focus: vi.fn(), close: vi.fn(), setNavigationGate: vi.fn(),
                cdp: vi.fn(async (method: string, params?: Record<string, unknown>) =>
                    method === 'Runtime.evaluate' && String(params?.expression).includes('"action":"snapshot"')
                        ? { result: { value: { title: 'Fixture', url: request.url, elements: [], nextRef: 1 } } } : {}),
            };
            views.set(request.viewId, view);
            return view;
        },
    };
    const send = vi.fn();
    const manager = new BrowserHostManager({
        history: { recordVisit: async () => true, updateTitle: async () => true, flush: async () => {}, clearEngine: async () => true },
        hosts: { electron: host, webview2: { ...host, engine: 'webview2' } },
        fileHost: { create: async request => ({
            snapshot: () => ({ viewId: request.viewId, engine: 'electron', url: 'file:///preview.html', title: '', loading: false, canGoBack: false, canGoForward: false }),
            navigate: () => {}, nav: () => {}, close: () => {}, setBounds: () => {}, focus: () => {},
        }), dispose: async () => {} },
        getDefault: () => 'electron', saveDefault: () => {}, getPageZoom: () => 100, savePageZoom: () => {}, send, changed: () => {},
    });
    const captures: { view: unknown; sink: BrowserDemoTabSink; capture: BrowserDemoCapture }[] = [];
    (manager.demos as unknown as { options: { capture: (view: unknown, sink: BrowserDemoTabSink) => BrowserDemoCapture } }).options.capture = (view, sink) => {
        const capture = { start: async () => {}, setEnabled: () => {}, stop: async () => {} };
        captures.push({ view, sink, capture });
        return capture;
    };
    manager.bindControlScope(1, 'w', 'w');
    const run = (processId: string, command: Parameters<BrowserHostManager['executeControl']>[1]['command'], selectedTab?: string) =>
        manager.executeControl(1, { id: `r-${Math.random()}`, workspaceId: 'w', processId, command, selectedTab });
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));
    return { manager, sinks, views, send, captures, run, flush };
}

describe('browser demo recording in the host manager', () => {
    it('blocks every AI browser command for the recording chat and hides recorded tabs from other chats', async () => {
        const h = harness();
        try {
            await h.manager.open(1, 'root', 'https://a.test/', 'w');
            await h.manager.open(1, 'free', 'https://b.test/', 'w');
            const { id } = await h.manager.demos.start(1, owner, 'root');
            await expect(h.run('p', { action: 'tabs' })).rejects.toThrow(BROWSER_DEMO_RECORDING_ERROR);
            await expect(h.run('p', { action: 'open', url: 'https://c.test/', newTab: true })).rejects.toThrow(/^recording-active:/);
            const tabs = await h.run('other', { action: 'tabs' });
            expect(tabs.tabs?.map(tab => tab.url)).toEqual(['https://b.test/']);
            await expect(h.run('other', { action: 'press', key: 'Enter' }, 't1:root')).rejects.toThrow('Browser tab not found in this workspace');
            h.manager.demos.pause(1, id);
            await expect(h.run('p', { action: 'tabs' })).rejects.toThrow(/^recording-active:/);
            await h.manager.demos.stop(1, id);
            expect((await h.run('p', { action: 'tabs' })).tabs).toHaveLength(2);
        } finally { await h.manager.dispose(); }
    });

    it('refuses to start on a tab an AI turn is driving', async () => {
        const h = harness();
        try {
            const opened = await h.run('ai', { action: 'open', url: 'https://a.test/' });
            const viewId = opened.tab!.split(':').slice(1).join(':');
            await expect(h.manager.demos.start(1, owner, viewId)).rejects.toMatchObject({ reason: 'busy' });
            h.manager.finishControl(1, 'ai');
            await expect(h.manager.demos.start(1, owner, viewId)).resolves.toMatchObject({ status: 'recording' });
        } finally { await h.manager.dispose(); }
    });

    it.each(['p', 'other'])('excludes queued input from recording admission (chat: %s)', async processId => {
        const h = harness();
        try {
            await h.manager.open(1, 'root', 'https://a.test/', 'w');
            await h.manager.open(1, 'free', 'https://b.test/', 'w');
            const input = h.run(processId, { action: 'press', key: 'Enter' }, 't1:root');
            await expect(h.manager.demos.start(1, owner, 'root')).rejects.toMatchObject({ reason: 'busy' });
            if (processId === 'p') {
                await expect(h.manager.demos.start(1, owner, 'free')).rejects.toMatchObject({ reason: 'busy' });
            }
            await input;
            const cdp = vi.mocked(h.views.get('root')!.cdp!);
            expect(cdp.mock.calls.filter(([method]) => method === 'Input.dispatchKeyEvent')
                .map(([, params]) => params?.type)).toEqual(['keyDown', 'keyUp']);
            h.manager.finishControl(1);
            await expect(h.manager.demos.start(1, owner, 'root')).resolves.toMatchObject({ status: 'recording' });
            await expect(h.run(processId === 'p' ? 'p' : 'fresh', { action: 'press', key: 'Tab' }, 't1:root')).rejects.toThrow(
                processId === 'p' ? BROWSER_DEMO_RECORDING_ERROR : 'Browser tab not found in this workspace');
            expect(cdp.mock.calls.filter(([method]) => method === 'Input.dispatchKeyEvent')).toHaveLength(2);
        } finally { await h.manager.dispose(); }
    });

    it('retains admission exclusion until cancelled input finishes its required release', async () => {
        const h = harness();
        const down = deferred<unknown>();
        const up = deferred<unknown>();
        const pressed = deferred<void>();
        const released = deferred<void>();
        try {
            await h.manager.open(1, 'root', 'https://a.test/', 'w');
            await h.manager.open(1, 'free', 'https://b.test/', 'w');
            const cdp = vi.mocked(h.views.get('root')!.cdp!);
            cdp.mockImplementation(async (_method, params) => {
                if (params?.type === 'keyDown') { pressed.resolve(); return down.promise; }
                if (params?.type === 'keyUp') { released.resolve(); return up.promise; }
                return {};
            });
            const controller = new AbortController();
            const input = h.manager.executeControl(1, { id: 'cancelled', workspaceId: 'w', processId: 'p',
                selectedTab: 't1:root', command: { action: 'press', key: 'Enter' } }, controller.signal);
            await pressed.promise;
            controller.abort(new Error('Turn stopped'));
            await expect(input).rejects.toThrow('Turn stopped');
            h.manager.finishControl(1, 'p');
            await expect(h.manager.demos.start(1, owner, 'root')).rejects.toMatchObject({ reason: 'busy' });
            await expect(h.manager.demos.start(1, owner, 'free')).rejects.toMatchObject({ reason: 'busy' });
            down.resolve({});
            await released.promise;
            await expect(h.manager.demos.start(1, owner, 'root')).rejects.toMatchObject({ reason: 'busy' });
            await expect(h.manager.demos.start(1, owner, 'free')).rejects.toMatchObject({ reason: 'busy' });
            up.resolve({});
            await h.manager.withControlPage(1, 'root', 'w', async () => {});
            await expect(h.manager.demos.start(1, owner, 'free')).resolves.toMatchObject({ status: 'recording' });
            expect(cdp.mock.calls.filter(([method]) => method === 'Input.dispatchKeyEvent')
                .map(([, params]) => params?.type)).toEqual(['keyDown', 'keyUp']);
        } finally {
            down.resolve({});
            up.resolve({});
            await h.manager.dispose();
        }
    });

    it('rechecks recording membership in the main-process dispatch path', async () => {
        const h = harness();
        try {
            await h.manager.open(1, 'root', 'https://a.test/', 'w');
            await h.manager.demos.start(1, owner, 'root');
            const operation = vi.fn(async () => {});
            await expect(h.manager.withControlPage(1, 'root', 'w', operation)).rejects.toThrow(BROWSER_DEMO_RECORDING_ERROR);
            expect(operation).not.toHaveBeenCalled();
        } finally { await h.manager.dispose(); }
    });

    it('allows another chat to record an unrelated tab while AI input remains pending', async () => {
        const h = harness();
        const gate = deferred<unknown>();
        const pressed = deferred<void>();
        try {
            await h.manager.open(1, 'root', 'https://a.test/', 'w');
            await h.manager.open(1, 'free', 'https://b.test/', 'w');
            vi.mocked(h.views.get('root')!.cdp!).mockImplementation(async (method, params) => {
                if (params?.type === 'keyDown') { pressed.resolve(); return gate.promise; }
                if (method === 'Runtime.evaluate') return {
                    result: { value: { title: 'Fixture', url: 'https://a.test/', elements: [], nextRef: 1 } },
                };
                return {};
            });
            const input = h.run('other', { action: 'press', key: 'Enter' }, 't1:root');
            await pressed.promise;
            await expect(h.manager.demos.start(1, owner, 'free')).resolves.toMatchObject({ status: 'recording' });
            gate.resolve({});
            await input;
        } finally { gate.resolve({}); await h.manager.dispose(); }
    });

    it('refuses stopped-draft resume while its chat has queued input on another tab', async () => {
        const h = harness();
        try {
            await h.manager.open(1, 'root', 'https://a.test/', 'w');
            await h.manager.open(1, 'free', 'https://b.test/', 'w');
            const { id } = await h.manager.demos.start(1, owner, 'root');
            await h.manager.demos.stop(1, id);
            const input = h.run('p', { action: 'press', key: 'Enter' }, 't1:free');
            await expect(h.manager.demos.resume(1, id)).rejects.toMatchObject({ reason: 'busy' });
            expect(h.manager.demos.draft(1, id).status).toBe('stopped');
            await input;
            h.manager.finishControl(1, 'p');
            await expect(h.manager.demos.resume(1, id)).resolves.toMatchObject({ status: 'recording' });
        } finally { await h.manager.dispose(); }
    });

    it('refuses local HTML previews', async () => {
        const h = harness();
        const dir = mkdtempSync(path.join(os.tmpdir(), 'demo-preview-'));
        try {
            const file = path.join(dir, 'preview.html');
            writeFileSync(file, '<p>preview</p>');
            expect(await h.manager.openFile(1, 'preview', file, 'w')).toMatchObject({ ok: true });
            await expect(h.manager.demos.start(1, owner, 'preview')).rejects.toMatchObject({ reason: 'file-preview' });
        } finally { await h.manager.dispose(); rmSync(dir, { recursive: true, force: true }); }
    });

    it('follows new tabs and popups opened from recorded tabs under main-minted ids, recursively', async () => {
        const h = harness();
        try {
            await h.manager.open(1, 'root', 'https://a.test/', 'w');
            await h.manager.open(1, 'free', 'https://z.test/', 'w');
            const { id } = await h.manager.demos.start(1, owner, 'root');
            h.sinks.get('free')!.newTab('https://z.test/next');
            expect(h.send).toHaveBeenLastCalledWith(1, BROWSER_VIEW_NEW_TAB_CHANNEL, { openerViewId: 'free', engine: 'electron', url: 'https://z.test/next' });
            h.sinks.get('root')!.newTab('https://b.test/');
            const childId = h.send.mock.calls.at(-1)![2].viewId as string;
            expect(childId).toMatch(/^browser-/);
            await h.manager.open(1, childId, 'https://b.test/', 'w');
            await h.flush();
            h.sinks.get(childId)!.newTab('https://c.test/');
            const grandchildId = h.send.mock.calls.at(-1)![2].viewId as string;
            await h.manager.open(1, grandchildId, 'https://c.test/', 'w');
            await h.flush();
            const popup = { ...h.views.get('root')!, snapshot: () => ({ viewId: 'browser-popout-1', engine: 'electron' as const, url: 'https://login.test/', title: 'Sign in', canGoBack: false, canGoForward: false, loading: false }) };
            h.sinks.get(grandchildId)!.controlPopoutOpened!('browser-popout-1', popup);
            await h.flush();
            let draft = h.manager.demos.draft(1, id);
            expect(draft.tabs.map(tab => [tab.viewId, tab.openerViewId])).toEqual([
                ['root', undefined], [childId, 'root'], [grandchildId, childId], ['browser-popout-1', grandchildId],
            ]);
            h.sinks.get(grandchildId)!.controlPopoutClosed!('browser-popout-1');
            await h.flush();
            draft = h.manager.demos.draft(1, id);
            expect(draft.tabs.find(tab => tab.viewId === 'browser-popout-1')).toMatchObject({ closed: true });
            expect(h.captures).toHaveLength(4);
        } finally { await h.manager.dispose(); }
    });

    it('records committed navigations of recorded tabs and stops to review when they all close', async () => {
        const h = harness();
        try {
            await h.manager.open(1, 'root', 'https://a.test/', 'w');
            const { id } = await h.manager.demos.start(1, owner, 'root');
            h.sinks.get('root')!.visited!('https://a.test/settings?key=secret', 'Settings');
            await h.manager.close(1, 'root', true);
            const draft = h.manager.demos.draft(1, id);
            expect(draft.status).toBe('stopped');
            expect(draft.steps.map(step => step.type)).toEqual(['tab-opened', 'navigate', 'tab-closed']);
            expect(JSON.stringify(draft)).not.toContain('secret');
        } finally { await h.manager.dispose(); }
    });

    it('keeps the native view alive through the final close drain while retiring its routing immediately', async () => {
        const h = harness();
        const gate = deferred<void>();
        try {
            await h.manager.open(1, 'root', 'https://a.test/', 'w');
            const { id } = await h.manager.demos.start(1, owner, 'root');
            const { capture, sink } = h.captures[0];
            capture.stop = async flush => {
                expect(flush).toBe(true);
                expect(h.views.get('root')!.close).not.toHaveBeenCalled();
                await gate.promise;
                sink.actions([{ kind: 'click', role: 'button', label: 'Save', url: 'https://a.test/' }]);
            };
            const closing = h.manager.close(1, 'root');
            expect((await h.run('other', { action: 'tabs' })).tabs).toEqual([]);
            expect(h.manager.demos.draft(1, id).tabs[0].closed).toBeUndefined();
            gate.resolve();
            await closing;
            expect(h.views.get('root')!.close).toHaveBeenCalledOnce();
            expect(h.manager.demos.draft(1, id).steps.map(step => step.type)).toEqual(['tab-opened', 'action', 'tab-closed']);
            expect(h.manager.demos.draft(1, id).status).toBe('stopped');
        } finally { gate.resolve(); await h.manager.dispose(); }
    });

    // Regression: awaiting draft cleanup before clearing the tab map let a reload's reopen reuse the dying entry.
    it('frees drafts in the same tick as a full SPA reload so reopened tabs are fresh', async () => {
        const h = harness();
        try {
            await h.manager.open(1, 'root', 'https://a.test/', 'w');
            await h.manager.demos.start(1, owner, 'root');
            const reload = h.manager.closeOwner(1);
            expect(h.manager.demos.unsent(1)).toEqual([]);
            expect(await h.manager.open(1, 'root', 'https://b.test/', 'w')).toMatchObject({ ok: true });
            await reload;
            expect(h.views.get('root')!.snapshot().url).toBe('https://b.test/');
            await expect(h.manager.demos.start(1, owner, 'root')).resolves.toMatchObject({ status: 'recording', viewIds: ['root'] });
        } finally { await h.manager.dispose(); }
    });

    it('frees a window drafts when the window closes, leaving other windows alone', async () => {
        const h = harness();
        try {
            await h.manager.open(1, 'root', 'https://a.test/', 'w');
            await h.manager.open(2, 'root', 'https://a.test/', 'w');
            await h.manager.demos.start(1, owner, 'root');
            await h.manager.demos.start(2, owner, 'root');
            await h.manager.closeOwner(1);
            expect(h.manager.demos.unsent(1)).toEqual([]);
            expect(h.manager.demos.unsent(2)).toHaveLength(1);
        } finally { await h.manager.dispose(); }
    });
});
