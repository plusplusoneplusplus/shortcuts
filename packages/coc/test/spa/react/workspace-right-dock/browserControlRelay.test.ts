// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserSocketRelay } from '../../../../src/server/spa/client/react/shared/file-path/browser-control-relay';
import { registerCloneBaseUrls } from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { clearUnifiedPanelState, readUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import type { BrowserCommandResult } from '@plusplusoneplusplus/coc-client';
import { renderHook, cleanup } from '@testing-library/react';
import { useBrowserControlScope } from '../../../../src/server/spa/client/react/shared/file-path/browser-control-scope';
import { getBrowserControlActivity, clearBrowserControlActivities } from '../../../../src/server/spa/client/react/shared/file-path/browser-control-activity';
import { applyRuntimeConfigPatch, _resetRuntimeConfig } from '../../../../src/server/spa/client/react/utils/config';
import { getBrowserControlNotices } from '../../../../src/server/spa/client/react/shared/file-path/browser-control-notice';
import { getBrowserNavigationPrompts } from '../../../../src/server/spa/client/react/shared/file-path/browser-navigation-prompts';
import { browserWebviewEntries, removeBrowserWebview } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/browserWebviewLayerStore';
const clients = vi.hoisted(() => ({
    cancel: vi.fn(async () => {}), remoteCancel: vi.fn(async () => {}),
    config: vi.fn(async (_workspace?: string) => ({ tools: [{ name: 'browser' }], disabledLlmTools: [] as string[] })),
    remoteConfig: vi.fn(async (_workspace?: string) => ({ tools: [{ name: 'browser' }], disabledLlmTools: [] as string[] })),
}));
vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ processes: { cancel: clients.cancel }, preferences: { getLlmToolsConfig: clients.config } }),
    getCocClientFor: () => ({ processes: { cancel: clients.remoteCancel }, preferences: { getLlmToolsConfig: clients.remoteConfig } }),
}));

afterEach(() => {
    cleanup();
    delete (window as any).cocDesktop;
    registerCloneBaseUrls([]);
    clearUnifiedPanelState();
    for (const workspace of ['w', 'other']) {
        clearBrowserControlActivities(workspace);
        clearBrowserControlActivities(workspace, 'http://127.0.0.1:4500');
    }
    _resetRuntimeConfig();
    clients.config.mockReset().mockResolvedValue({ tools: [{ name: 'browser' }], disabledLlmTools: [] });
    clients.remoteConfig.mockReset().mockResolvedValue({ tools: [{ name: 'browser' }], disabledLlmTools: [] });
    vi.restoreAllMocks();
});

function harness(baseUrl?: string, modern = false) {
    const send = vi.fn(() => true);
    let reveal!: (event: any) => void;
    let activity!: (event: any) => void;
    let stop!: (event: any) => void;
    let takeoverState!: (state: any) => void;
    let navigationCheck!: (event: any) => void;
    const control = {
        framesSupported: modern,
        richPasteSupported: modern,
        bindScope: vi.fn(async (): Promise<{ ownerId: number } | void> => {}),
        execute: vi.fn(async (): Promise<BrowserCommandResult> => ({ tabs: [] })),
        cancel: vi.fn(),
        onReveal: vi.fn((handler: (event: any) => void) => { reveal = handler; return vi.fn(); }),
        ...(modern ? {
            onTakeover: vi.fn((handler: (state: any) => void) => { takeoverState = handler; return vi.fn(); }),
            setTakeoverPolicy: vi.fn(async () => {}),
            finish: vi.fn(), setVisible: vi.fn(), releaseFrames: vi.fn(async () => {}),
            onActivity: vi.fn((handler: (event: any) => void) => { activity = handler; return vi.fn(); }),
            onStop: vi.fn((handler: (event: any) => void) => { stop = handler; return vi.fn(); }),
            onNavigationCheck: vi.fn((handler: (event: any) => void) => { navigationCheck = handler; return vi.fn(); }),
            decideNavigation: vi.fn(),
        } : {}),
    };
    (window as any).cocDesktop = { browser: { control } };
    const relay = createBrowserSocketRelay({ send }, baseUrl);
    return { relay, control, send, reveal: (event: any) => reveal(event), activity: (event: any) => activity(event), stop: (event: any) => stop(event),
        navigationCheck: (event: any) => navigationCheck(event), takeoverState: (state: any) => takeoverState(state) };
}
const request = { id: 'r', workspaceId: 'w', processId: 'p', command: { action: 'tabs' } };
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('SPA browser socket relay', () => {
    it.each([false, true])('requires a rich-paste-capable desktop: %s', async modern => {
        const h = harness(undefined, modern);
        await h.relay.update('w');
        h.relay.onOpen();
        const input = { ...request, framesEnabled: true, richPasteEnabled: true,
            command: { action: 'paste_html', ref: 'e1', html: '<b>Synthetic</b>', text: 'Synthetic' } };
        h.relay.onMessage({ type: 'browser-command', request: input });
        await tick();
        if (modern) expect(h.control.execute).toHaveBeenCalledWith(input);
        else expect(h.control.execute).not.toHaveBeenCalled();
        h.relay.dispose();
    });
    it('cancels enabled pending frame work on its source config change and suppresses late success', async () => {
        const h = harness(undefined, true);
        await h.relay.update('w'); h.relay.onOpen();
        let resolve!: (result: BrowserCommandResult) => void;
        h.control.execute.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
        h.relay.onMessage({ type: 'browser-command', request: { ...request, framesEnabled: true } });
        h.relay.onMessage({ type: 'config-changed' });
        expect(h.control.cancel).toHaveBeenCalledWith('r');
        expect(h.control.releaseFrames).toHaveBeenCalledWith('w');
        expect(h.send).toHaveBeenCalledWith({ type: 'browser-command-result', reply: {
            id: 'r', ok: false, error: 'Browser frame policy changed during command',
        } });
        h.send.mockClear();
        resolve({ tabs: [] }); await tick();
        expect(h.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'browser-command-result' }));
        h.relay.dispose();
    });
    it('does not cancel legacy pending work on config changes or apply page-origin frame flags to clones', async () => {
        const baseUrl = 'http://127.0.0.1:4500';
        registerCloneBaseUrls([{ workspaceId: 'w', serverId: 'server', baseUrl }]);
        const h = harness(baseUrl, true);
        await h.relay.update('remote:server:w'); h.relay.onOpen();
        let resolve!: (result: BrowserCommandResult) => void;
        h.control.execute.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
        h.relay.onMessage({ type: 'browser-command', request });
        h.relay.onMessage({ type: 'config-changed' });
        applyRuntimeConfigPatch({ browserFrameControlEnabled: false });
        expect(h.control.cancel).not.toHaveBeenCalled();
        expect(h.control.releaseFrames).not.toHaveBeenCalled();
        resolve({ tabs: [] }); await tick();
        expect(h.send).toHaveBeenCalledWith({ type: 'browser-command-result', reply: { id: 'r', ok: true, result: { tabs: [] } } });
        h.relay.dispose();
    });
    it('releases idle frame tracking on a source config change without waiting for another command', async () => {
        const h = harness(undefined, true);
        await h.relay.update('w'); h.relay.onOpen();
        h.relay.onMessage({ type: 'browser-command', request: { ...request, framesEnabled: true } });
        await tick();
        h.relay.onMessage({ type: 'config-changed' });
        expect(h.control.releaseFrames).toHaveBeenCalledExactlyOnceWith('w');
        expect(h.control.cancel).not.toHaveBeenCalled();
        h.relay.dispose();
    });
    it('forwards source-server frame policy unchanged, independent of page-origin config', async () => {
        const baseUrl = 'http://127.0.0.1:4500';
        registerCloneBaseUrls([{ workspaceId: 'w', serverId: 'server', baseUrl }]);
        applyRuntimeConfigPatch({ browserControlEnabled: false, browserFrameControlEnabled: false });
        const h = harness(baseUrl, true);
        await h.relay.update('remote:server:w'); h.relay.onOpen();
        const frames = [{ id: 'f-one', origin: 'opaque', name: '', document: 'd-one', status: 'ready' as const, depth: 0 }];
        const result = { frames, frame: 'f-one', document: 'd-one' };
        h.control.execute.mockResolvedValueOnce(result);
        const frameRequest = { ...request, command: { action: 'frames' }, framesEnabled: true };
        h.relay.onMessage({ type: 'browser-command', request: frameRequest });
        await tick();
        expect(h.control.execute).toHaveBeenCalledWith(frameRequest);
        expect(h.send).toHaveBeenCalledWith({ type: 'browser-command-result', reply: { id: 'r', ok: true, result } });
        h.relay.dispose();
    });
    it('fails closed for older desktop capability, malformed policy and disabled frame parameters', async () => {
        const h = harness();
        await h.relay.update('w'); h.relay.onOpen();
        for (const [extra, error] of [
            [{ framesEnabled: true }, 'Unsupported desktop capability: browser frame control'],
            [{ framesEnabled: 'true' }, 'Invalid browser frame policy'],
            [{ command: { action: 'frames' } }, 'Browser frame control is disabled'],
            [{ framesEnabled: false, command: { action: 'read', frame: 'f-one' } }, 'Browser frame control is disabled'],
        ] as const) {
            h.relay.onMessage({ type: 'browser-command', request: { ...request, ...extra } });
            expect(h.send).toHaveBeenLastCalledWith({ type: 'browser-command-result', reply: { id: 'r', ok: false, error } });
        }
        expect(h.control.execute).not.toHaveBeenCalled();
        h.relay.dispose();
    });
    it('isolates simultaneous local/clone visibility and disconnect clears on one trusted bridge', async () => {
        const baseUrl = 'http://127.0.0.1:4500', cloneRef = 'remote:server:w';
        registerCloneBaseUrls([{ workspaceId: 'w', serverId: 'server', baseUrl }]);
        applyRuntimeConfigPatch({ browserControlEnabled: true });
        const local = harness(undefined, true);
        const visibility = new Map<string, boolean>();
        local.control.setVisible!.mockImplementation((visible: boolean, ref: string) => { visibility.set(ref, visible); });
        await local.relay.update('w'); local.relay.onOpen(); await tick();
        expect(visibility.get('w')).toBe(true);
        const remote = createBrowserSocketRelay({ send: vi.fn(() => true) }, baseUrl);
        await remote.update('w'); remote.onOpen(); await tick();
        expect(visibility.get('w')).toBe(true);
        expect(local.control.setVisible).not.toHaveBeenCalledWith(false);
        clients.remoteConfig.mockResolvedValue({ tools: [{ name: 'browser' }], disabledLlmTools: ['browser'] });
        await remote.update(cloneRef); await tick();
        expect(visibility.get(cloneRef)).toBe(false);
        expect(visibility.get('w')).toBe(true);
        applyRuntimeConfigPatch({ browserControlEnabled: false });
        clients.remoteConfig.mockResolvedValue({ tools: [{ name: 'browser' }], disabledLlmTools: [] });
        remote.onMessage({ type: 'config-changed' }); await tick();
        expect(visibility.get('w')).toBe(false);
        expect(visibility.get(cloneRef)).toBe(true);
        local.control.finish!.mockClear();
        local.relay.onClose();
        expect(visibility.get(cloneRef)).toBe(true);
        expect(local.control.finish).toHaveBeenCalledExactlyOnceWith(undefined, 'w');
        local.relay.dispose(); remote.dispose();
    });
    it('refreshes inactive actual-owner activity scopes using their source preferences and drops stale config replies', async () => {
        const baseUrl = 'http://127.0.0.1:4500';
        registerCloneBaseUrls([
            { workspaceId: 'w', serverId: 'server', baseUrl },
            { workspaceId: 'other', serverId: 'server', baseUrl },
        ]);
        const h = harness(baseUrl, true);
        await h.relay.update('remote:server:w'); h.relay.onOpen();
        h.reveal({ workspaceId: 'other', processId: 'other-process', viewId: 'owned', routingRef: 'remote:server:other',
            turnId: 'incoming', url: 'https://fixture.test/' });
        await h.relay.update(null); await tick();
        clients.remoteConfig.mockClear();
        clients.remoteConfig.mockResolvedValue({ tools: [{ name: 'browser' }], disabledLlmTools: ['browser'] });
        h.relay.onMessage({ type: 'config-changed' }); await tick();
        expect(clients.remoteConfig).toHaveBeenCalledExactlyOnceWith('other');
        expect(h.control.setVisible).toHaveBeenLastCalledWith(false, 'remote:server:other');
        let resolve!: (config: { tools: { name: string }[]; disabledLlmTools: string[] }) => void;
        clients.remoteConfig.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
        h.relay.onMessage({ type: 'config-changed' });
        h.relay.onClose();
        h.control.setVisible!.mockClear();
        resolve({ tools: [{ name: 'browser' }], disabledLlmTools: [] }); await tick();
        expect(h.control.setVisible).not.toHaveBeenCalled();
        expect(clients.config).not.toHaveBeenCalled();
        h.relay.dispose();
    });
    it('receives actual-owner activity and follow-ups even while its own source socket is transiently disconnected', async () => {
        const h = harness(undefined, true);
        await h.relay.update('w'); h.relay.onOpen();
        const event = { workspaceId: 'w', processId: 'p', viewId: 'owned', routingRef: 'w', turnId: 'actual-owner', active: true };
        h.reveal({ ...event, url: 'https://fixture.test/' });
        h.activity(event);
        const tab = readUnifiedPanelState('w').workspaceTabs[0];
        expect(getBrowserControlActivity('w', tab.id)?.turnId).toBe('actual-owner');
        h.activity({ ...event, turnId: 'follow-up' });
        h.activity({ ...event, active: false });
        expect(getBrowserControlActivity('w', tab.id)?.turnId).toBe('follow-up');
        h.relay.onMessage({ type: 'browser-turn-finished', workspaceId: 'w', processId: 'p', turnId: 'actual-owner' });
        expect(getBrowserControlActivity('w', tab.id)?.turnId).toBe('follow-up');
        h.relay.onClose();
        h.activity({ ...event, turnId: 'follow-up' });
        expect(getBrowserControlActivity('w', tab.id)?.turnId).toBe('follow-up');
        h.reveal({ ...event, turnId: 'foreign-next', url: 'https://fixture.test/' });
        h.activity({ ...event, turnId: 'foreign-next' });
        expect(getBrowserControlActivity('w', tab.id)?.turnId).toBe('foreign-next');
        expect(h.control.finish).toHaveBeenCalled();
        h.relay.dispose();
        expect(getBrowserControlActivity('w', tab.id)).toBeNull();
    });
    it('finishes only its own routed activity on socket disconnect and rejects late trusted events for that turn', async () => {
        const h = harness(undefined, true);
        await h.relay.update('w'); h.relay.onOpen();
        h.relay.onMessage({ type: 'browser-command', request: { ...request, turnId: 'own-routing-turn' } });
        const event = { workspaceId: 'w', processId: 'p', viewId: 'owned', routingRef: 'w', turnId: 'own-routing-turn', active: true };
        h.reveal({ ...event, url: 'https://fixture.test/' });
        h.activity(event);
        const tab = readUnifiedPanelState('w').workspaceTabs[0];
        expect(getBrowserControlActivity('w', tab.id)?.turnId).toBe(event.turnId);
        h.relay.onClose();
        h.reveal({ ...event, url: 'https://fixture.test/' });
        h.activity(event);
        expect(getBrowserControlActivity('w', tab.id)).toBeNull();
        h.relay.dispose();
    });
    it('uses main routing ownership rather than stale local command bookkeeping during disconnect', async () => {
        const h = harness(undefined, true);
        h.control.bindScope.mockResolvedValueOnce({ ownerId: 2 });
        await h.relay.update('w'); h.relay.onOpen();
        h.relay.onMessage({ type: 'browser-command', request: { ...request, turnId: 'continuing-turn' } });
        const event = { workspaceId: 'w', processId: 'p', viewId: 'owned', routingRef: 'w',
            turnId: 'continuing-turn', routingOwnerId: 1, active: true };
        h.reveal({ ...event, url: 'https://fixture.test/' });
        h.activity(event);
        const tab = readUnifiedPanelState('w').workspaceTabs[0];
        h.relay.onClose();
        expect(getBrowserControlActivity('w', tab.id)?.turnId).toBe('continuing-turn');
        h.relay.dispose();
    });
    it('routes trusted native Stop only to the source clone conversation and rejects stale/foreign tokens', async () => {
        const baseUrl = 'http://127.0.0.1:4500';
        registerCloneBaseUrls([{ workspaceId: 'w', serverId: 'server', baseUrl }]);
        clients.remoteCancel.mockClear(); clients.cancel.mockClear();
        const h = harness(baseUrl, true);
        await h.relay.update('remote:server:w'); h.relay.onOpen();
        h.relay.onMessage({ type: 'browser-command', request: { ...request, turnId: 'native-turn' } });
        const event = { workspaceId: 'w', processId: 'p', viewId: 'native-popup', routingRef: 'remote:server:w', turnId: 'native-turn', active: true };
        h.stop({ ...event, routingRef: 'w' });
        h.stop({ ...event, turnId: 'old' });
        expect(clients.remoteCancel).not.toHaveBeenCalled();
        h.stop(event); await tick();
        expect(clients.remoteCancel).toHaveBeenCalledExactlyOnceWith('p', { workspace: 'w' });
        expect(clients.cancel).not.toHaveBeenCalled();
        expect(h.control.finish).toHaveBeenCalledWith('native-turn');
        h.relay.dispose();
    });
    it('reports denied scope binding without private details and keeps capability unavailable', async () => {
        const h = harness();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        h.control.bindScope.mockRejectedValueOnce(new Error('Private fixture scope detail'));
        await h.relay.update('w'); h.relay.onOpen();
        expect(warn.mock.calls).toEqual([['Could not bind desktop browser control scope; capability remains unavailable.']]);
        expect(h.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'browser-capability' }));
        h.relay.onMessage({ type: 'browser-command', request });
        expect(h.control.execute).not.toHaveBeenCalled();
        expect(h.send).toHaveBeenLastCalledWith({ type: 'browser-command-result', reply: { id: 'r', ok: false, error: 'Browser workspace scope changed' } });
        h.relay.dispose();
    });
    it('never maps another native window owner to its own same-resource tab or restores a terminal turn from a late reply', async () => {
        const h = harness();
        h.control.bindScope.mockResolvedValueOnce({ ownerId: 1 });
        await h.relay.update('w'); h.relay.onOpen();
        h.reveal({ workspaceId: 'w', processId: 'p', viewId: 'same-view', url: 'https://fixture.test/', routingRef: 'w' });
        const tab = readUnifiedPanelState('w').workspaceTabs[0];
        let finish!: (result: BrowserCommandResult) => void;
        h.control.execute.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        h.relay.onMessage({ type: 'browser-command', request: { ...request, selectedTab: 't2:same-view' } });
        expect(getBrowserControlActivity('w', tab.id)).toBeNull();
        h.relay.onMessage({ type: 'process-updated', process: { id: 'p', workspaceId: 'w', status: 'cancelled' } });
        finish({ tab: 't1:same-view', elements: [] }); await tick();
        expect(getBrowserControlActivity('w', tab.id)).toBeNull();
        h.relay.dispose();
    });
    it('isolates local and remote activity with identical raw workspace/process ids through terminal updates and disconnect', async () => {
        const baseUrl = 'http://127.0.0.1:4500';
        registerCloneBaseUrls([{ workspaceId: 'w', serverId: 'server', baseUrl }]);
        const local = harness(), remote = harness(baseUrl);
        await local.relay.update('w'); local.relay.onOpen();
        await remote.relay.update('remote:server:w'); remote.relay.onOpen();
        local.reveal({ workspaceId: 'w', processId: 'p', viewId: 'local-view', url: 'https://fixture.test/', routingRef: 'w' });
        remote.reveal({ workspaceId: 'w', processId: 'p', viewId: 'remote-view', url: 'https://fixture.test/', routingRef: 'remote:server:w' });
        const localTab = readUnifiedPanelState('w').workspaceTabs[0];
        const remoteTab = readUnifiedPanelState('remote:server:w').workspaceTabs[0];
        expect(getBrowserControlActivity('w', localTab.id)?.processId).toBe('p');
        expect(getBrowserControlActivity('w', remoteTab.id, baseUrl)?.processId).toBe('p');
        local.relay.onMessage({ type: 'process-updated', process: { id: 'p', workspaceId: 'w', status: 'completed' } });
        local.relay.onClose();
        expect(getBrowserControlActivity('w', remoteTab.id, baseUrl)?.processId).toBe('p');
        remote.relay.onClose();
        expect(getBrowserControlActivity('w', remoteTab.id, baseUrl)).toBeNull();
        local.relay.dispose(); remote.relay.dispose();
    });
    it('maps main-qualified tab ids to the owning panel badge and retains it until terminal status, not command completion', async () => {
        const h = harness();
        await h.relay.update('w'); h.relay.onOpen();
        h.reveal({ workspaceId: 'w', processId: 'p', viewId: 'browser-agent', url: 'https://fixture.test/', routingRef: 'w' });
        const tab = readUnifiedPanelState('w').workspaceTabs[0];
        expect(getBrowserControlActivity('w', tab.id)?.processId).toBe('p');
        h.control.execute.mockResolvedValueOnce({ tab: 't1:browser-agent', elements: [] });
        h.relay.onMessage({ type: 'browser-command', request: { ...request, selectedTab: 't1:browser-agent' } });
        await tick();
        expect(getBrowserControlActivity('w', tab.id)?.processId).toBe('p');
        h.relay.onMessage({ type: 'process-updated', process: { id: 'p', workspaceId: 'w', status: 'completed' } });
        expect(getBrowserControlActivity('w', tab.id)).toBeNull();
        h.relay.onMessage({ type: 'browser-command', request: { ...request, id: 'late-start', selectedTab: 't1:browser-agent' } });
        expect(h.control.execute).toHaveBeenCalledTimes(1);
        expect(h.send).toHaveBeenLastCalledWith({ type: 'browser-command-result', reply: { id: 'late-start', ok: false, error: 'Browser conversation turn has finished' } });
        h.reveal({ workspaceId: 'w', processId: 'p', viewId: 'late-view', url: 'https://fixture.test/', routingRef: 'w' });
        expect(readUnifiedPanelState('w').workspaceTabs).toHaveLength(1);
        h.relay.onMessage({ type: 'process-updated', process: { id: 'p', workspaceId: 'w', status: 'running' } });
        h.relay.onMessage({ type: 'browser-command', request: { ...request, id: 'next', selectedTab: 't1:browser-agent' } });
        await tick();
        expect(getBrowserControlActivity('w', tab.id)?.processId).toBe('p');
        h.relay.onClose();
        expect(getBrowserControlActivity('w', tab.id)).toBeNull();
        h.relay.dispose();
    });
    it('uses the concrete conversation owner inside a repo-group and opens the tab in the group panel scope', async () => {
        const h = harness();
        await h.relay.update('group'); h.relay.onOpen();
        const owner = renderHook(() => useBrowserControlScope('w', 'group'));
        await tick();
        expect(h.control.bindScope).toHaveBeenLastCalledWith('w', 'w');
        expect(h.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'browser-capability', workspaceId: 'w' }));
        h.reveal({ workspaceId: 'w', processId: 'p', viewId: 'group-browser', url: 'https://fixture.test/', routingRef: 'w' });
        expect(readUnifiedPanelState('group').workspaceTabs).toHaveLength(1);
        expect(readUnifiedPanelState('w').workspaceTabs).toHaveLength(0);
        owner.unmount(); await tick();
        expect(h.control.bindScope).toHaveBeenLastCalledWith('group', 'group');
        h.relay.dispose();
    });
    it('advertises only desktop capability for its correct workspace and updates focus order on the existing socket', async () => {
        const h = harness();
        vi.spyOn(document, 'hasFocus').mockReturnValue(false);
        await h.relay.update('w');
        h.relay.onOpen();
        expect(h.control.bindScope).toHaveBeenCalledWith('w', 'w');
        expect(h.send).toHaveBeenLastCalledWith({ type: 'browser-capability', workspaceId: 'w', focused: false });
        vi.mocked(document.hasFocus).mockReturnValue(true);
        window.dispatchEvent(new Event('focus'));
        expect(h.send).toHaveBeenLastCalledWith({ type: 'browser-capability', workspaceId: 'w', focused: true });
        h.relay.dispose();
        delete (window as any).cocDesktop;
        const web = createBrowserSocketRelay({ send: h.send });
        h.send.mockClear();
        await web.update('w'); web.onOpen();
        expect(h.send).not.toHaveBeenCalled();
        web.dispose();
    });

    it('forwards the exact raw request to preload and correlates result/error replies', async () => {
        const h = harness();
        await h.relay.update('w'); h.relay.onOpen();
        expect(h.relay.onMessage({ type: 'browser-command', request })).toBe(true);
        await tick();
        expect(h.control.execute).toHaveBeenCalledWith(request);
        expect(h.send).toHaveBeenLastCalledWith({ type: 'browser-command-result', reply: { id: 'r', ok: true, result: { tabs: [] } } });
        h.control.execute.mockRejectedValueOnce(new Error('stale ref, re-snapshot'));
        h.relay.onMessage({ type: 'browser-command', request: { ...request, id: 'error' } });
        await tick();
        expect(h.send).toHaveBeenLastCalledWith({ type: 'browser-command-result', reply: { id: 'error', ok: false, error: 'stale ref, re-snapshot' } });
        expect(h.relay.onMessage({ type: 'process-updated' })).toBe(false);
        h.relay.dispose();
    });

    it('rejects wrong workspace commands, cancels on server cancellation/disconnect and suppresses late replies', async () => {
        const h = harness();
        await h.relay.update('w'); h.relay.onOpen();
        h.relay.onMessage({ type: 'browser-command', request: { ...request, workspaceId: 'other' } });
        expect(h.control.execute).not.toHaveBeenCalled();
        expect(h.send).toHaveBeenLastCalledWith({ type: 'browser-command-result', reply: { id: 'r', ok: false, error: 'Browser workspace scope changed' } });
        let finish!: (result: BrowserCommandResult) => void;
        h.control.execute.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        h.relay.onMessage({ type: 'browser-command', request });
        h.relay.onMessage({ type: 'browser-command-cancel', id: 'r' });
        expect(h.control.cancel).toHaveBeenCalledWith('r');
        h.relay.onClose();
        const count = h.send.mock.calls.length;
        finish({ value: 'late' }); await tick();
        expect(h.send).toHaveBeenCalledTimes(count);
        h.relay.dispose();
    });

    it('binds remote clone refs to raw wire workspace ids only on that clone socket, never the local one', async () => {
        registerCloneBaseUrls([{ workspaceId: 'w', serverId: 'server', baseUrl: 'http://127.0.0.1:4500' }]);
        const local = harness(), remote = harness('http://127.0.0.1:4500');
        await local.relay.update('remote:server:w'); local.relay.onOpen();
        expect(local.control.bindScope).not.toHaveBeenCalled();
        expect(local.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'browser-capability' }));
        await remote.relay.update('remote:server:w'); remote.relay.onOpen();
        expect(remote.control.bindScope).toHaveBeenCalledWith('w', 'remote:server:w');
        expect(remote.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'browser-capability', workspaceId: 'w' }));
        local.relay.dispose(); remote.relay.dispose();
    });

    it('opens/reuses an ordinary workspace browser tab and reveals even when the dock is unmounted', async () => {
        const h = harness();
        await h.relay.update('w'); h.relay.onOpen();
        h.reveal({ workspaceId: 'w', processId: 'p', viewId: 'browser-agent', url: 'https://fixture.test/' });
        const first = readUnifiedPanelState('w');
        expect(first.workspaceTabs).toHaveLength(1);
        expect(first.workspaceTabs[0]).toMatchObject({ kind: 'browser', resourceId: 'browser-agent', ownerWorkspaceId: 'w', browserUrl: 'https://fixture.test/' });
        h.reveal({ workspaceId: 'w', processId: 'q', viewId: 'browser-agent', url: 'https://fixture.test/next' });
        expect(readUnifiedPanelState('w').workspaceTabs).toHaveLength(1);
        h.reveal({ workspaceId: 'other', processId: 'p', viewId: 'other', url: 'https://other.test/' });
        expect(readUnifiedPanelState('other').workspaceTabs).toHaveLength(0);
        h.relay.dispose();
    });
    describe('background control', () => {
        const withRetain = (h: ReturnType<typeof harness>) => {
            const retainScope = vi.fn(async (_ref: string, _workspace: string | null) => {});
            (h.control as any).retainScope = retainScope;
            return retainScope;
        };
        const hold = (h: ReturnType<typeof harness>) => {
            let finish!: (result: BrowserCommandResult) => void;
            h.control.execute.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
            return (result: BrowserCommandResult) => finish(result);
        };

        it('keeps an active turn bound and served after the window switches workspace', async () => {
            applyRuntimeConfigPatch({ browserBackgroundControlEnabled: true });
            const h = harness(undefined, true);
            const retainScope = withRetain(h);
            await h.relay.update('w'); h.relay.onOpen();
            expect(h.send).toHaveBeenLastCalledWith({ type: 'browser-capability', workspaceId: 'w', focused: expect.any(Boolean), background: [] });
            const finish = hold(h);
            h.relay.onMessage({ type: 'browser-command', request: { ...request, turnId: 't1' } });
            expect(h.control.execute).toHaveBeenLastCalledWith({ ...request, turnId: 't1' }, 'w');

            window.location.hash = '#repos/other';
            await h.relay.update('other');
            expect(retainScope).toHaveBeenCalledWith('w', 'w');
            expect(retainScope.mock.invocationCallOrder[0]).toBeLessThan(h.control.bindScope.mock.invocationCallOrder[1]);
            expect(h.control.cancel).not.toHaveBeenCalled();
            expect(h.send).toHaveBeenCalledWith({ type: 'browser-capability-clear', background: ['w'] });
            expect(h.send).toHaveBeenLastCalledWith({ type: 'browser-capability', workspaceId: 'other', focused: expect.any(Boolean), background: ['w'] });

            // The in-flight reply still reaches the server and later commands run on the retained scope.
            finish({ tabs: [] }); await tick();
            expect(h.send).toHaveBeenCalledWith({ type: 'browser-command-result', reply: { id: 'r', ok: true, result: { tabs: [] } } });
            const next = { ...request, id: 'r2', turnId: 't1' };
            h.relay.onMessage({ type: 'browser-command', request: next });
            expect(h.control.execute).toHaveBeenLastCalledWith(next, 'w');

            // A background reveal opens the tab without moving the window.
            h.reveal({ workspaceId: 'w', processId: 'p', viewId: 'browser-agent', url: 'https://fixture.test/', turnId: 't1', routingRef: 'w', background: true });
            expect(window.location.hash).toBe('#repos/other');
            expect(readUnifiedPanelState('w').workspaceTabs).toHaveLength(1);

            // Finishing the turn drops the retention and stops serving the workspace.
            h.relay.onMessage({ type: 'browser-turn-finished', workspaceId: 'w', processId: 'p', turnId: 't1' });
            expect(retainScope).toHaveBeenLastCalledWith('w', null);
            expect(h.send).toHaveBeenLastCalledWith({ type: 'browser-capability', workspaceId: 'other', focused: expect.any(Boolean), background: [] });
            h.relay.onMessage({ type: 'browser-command', request: { ...request, id: 'r3', turnId: 't1' } });
            expect(h.send).toHaveBeenLastCalledWith({ type: 'browser-command-result', reply: { id: 'r3', ok: false, error: 'Browser workspace scope changed' } });
            h.relay.dispose();
        });

        it('creates the Electron guest for a background reveal and keeps it laid out only while the turn drives it in the background', async () => {
            applyRuntimeConfigPatch({ browserBackgroundControlEnabled: true });
            const h = harness(undefined, true);
            withRetain(h);
            const open = vi.fn(async () => ({ ok: true, engine: 'electron', embed: 'webview', src: 'https://fixture.test/', partition: 'token' }));
            Object.assign((window as any).cocDesktop.browser, { open, adopt: vi.fn() });
            await h.relay.update('other'); h.relay.onOpen();
            const entry = () => [...browserWebviewEntries()].find(item => item.viewId === 'browser-agent');
            try {
                h.reveal({ workspaceId: 'w', processId: 'bg-p', viewId: 'browser-agent', url: 'https://fixture.test/', turnId: 'bg-t1', routingRef: 'w', background: true });
                expect(open).toHaveBeenCalledExactlyOnceWith('browser-agent', 'https://fixture.test/', 'w');
                await vi.waitFor(() => expect(entry()?.config).toBeTruthy());
                expect(entry()?.background).toBe(true);
                // Foreground activity and turn end both stop the background layout.
                h.activity({ workspaceId: 'w', processId: 'bg-p', turnId: 'bg-t1', routingRef: 'w', viewId: 'browser-agent', active: true });
                expect(entry()?.background).toBe(false);
                h.activity({ workspaceId: 'w', processId: 'bg-p', turnId: 'bg-t1', routingRef: 'w', viewId: 'browser-agent', active: true, background: true });
                expect(entry()?.background).toBe(true);
                h.activity({ workspaceId: 'w', processId: 'bg-p', turnId: 'bg-t1', routingRef: 'w', viewId: 'browser-agent', active: false, background: true });
                expect(entry()?.background).toBe(false);
                // A foreground reveal leaves guest creation to the mounted panel.
                h.reveal({ workspaceId: 'other', processId: 'bg-p2', viewId: 'browser-front', url: 'https://fixture.test/', turnId: 'bg-t2', routingRef: 'other' });
                expect(open).toHaveBeenCalledOnce();
            } finally {
                h.relay.dispose();
                removeBrowserWebview('browser-agent');
            }
        });

        it('never routes a command to a workspace without a retained scope', async () => {
            applyRuntimeConfigPatch({ browserBackgroundControlEnabled: true });
            const h = harness(undefined, true);
            withRetain(h);
            await h.relay.update('w'); h.relay.onOpen();
            h.relay.onMessage({ type: 'browser-command', request: { ...request, workspaceId: 'other' } });
            expect(h.control.execute).not.toHaveBeenCalled();
            expect(h.send).toHaveBeenLastCalledWith({ type: 'browser-command-result', reply: { id: 'r', ok: false, error: 'Browser workspace scope changed' } });
            h.relay.dispose();
        });

        it('cancels on switch and never retains with the flag off', async () => {
            const h = harness(undefined, true);
            const retainScope = withRetain(h);
            await h.relay.update('w'); h.relay.onOpen();
            hold(h);
            h.relay.onMessage({ type: 'browser-command', request: { ...request, turnId: 't1' } });
            expect(h.control.execute).toHaveBeenLastCalledWith({ ...request, turnId: 't1' });
            await h.relay.update('other');
            expect(retainScope).not.toHaveBeenCalled();
            expect(h.control.cancel).toHaveBeenCalledWith('r');
            expect(h.send).toHaveBeenCalledWith({ type: 'browser-capability-clear' });
            expect(h.send).toHaveBeenLastCalledWith({ type: 'browser-capability', workspaceId: 'other', focused: expect.any(Boolean) });
            h.relay.dispose();
        });

        it('drops retained scopes and cancels their work when the flag turns off or the socket closes', async () => {
            applyRuntimeConfigPatch({ browserBackgroundControlEnabled: true });
            const h = harness(undefined, true);
            const retainScope = withRetain(h);
            await h.relay.update('w'); h.relay.onOpen();
            hold(h);
            h.relay.onMessage({ type: 'browser-command', request: { ...request, turnId: 't1' } });
            await h.relay.update('other');
            applyRuntimeConfigPatch({ browserBackgroundControlEnabled: false });
            expect(retainScope).toHaveBeenLastCalledWith('w', null);
            expect(h.control.cancel).toHaveBeenCalledWith('r');
            expect(h.send).toHaveBeenLastCalledWith({ type: 'browser-capability', workspaceId: 'other', focused: expect.any(Boolean) });

            applyRuntimeConfigPatch({ browserBackgroundControlEnabled: true });
            await h.relay.update('w');
            h.relay.onMessage({ type: 'browser-command', request: { ...request, id: 'r2', turnId: 't2' } });
            await h.relay.update('other');
            expect(retainScope).toHaveBeenLastCalledWith('w', 'w');
            h.relay.onClose();
            expect(retainScope).toHaveBeenLastCalledWith('w', null);
            h.relay.dispose();
        });

        it('retains remote clone turns under the clone ref on that clone socket only', async () => {
            const baseUrl = 'http://127.0.0.1:4500';
            registerCloneBaseUrls([{ workspaceId: 'w', serverId: 'server', baseUrl }]);
            applyRuntimeConfigPatch({ browserBackgroundControlEnabled: true });
            const h = harness(baseUrl, true);
            const retainScope = withRetain(h);
            await h.relay.update('remote:server:w'); h.relay.onOpen();
            h.relay.onMessage({ type: 'browser-command', request: { ...request, turnId: 't1' } });
            await h.relay.update('other');
            expect(retainScope).toHaveBeenCalledExactlyOnceWith('remote:server:w', 'w');
            expect(h.send).toHaveBeenCalledWith({ type: 'browser-capability-clear', background: ['w'] });
            const next = { ...request, id: 'r2', turnId: 't1' };
            h.relay.onMessage({ type: 'browser-command', request: next });
            expect(h.control.execute).toHaveBeenLastCalledWith(next, 'remote:server:w');
            h.relay.dispose();
        });

        describe('Switch back notice', () => {
            const foregroundRequired = new Error("Error invoking remote method 'coc-desktop:browser-control': Error: foreground-required: rich paste needs the workspace on screen");
            const paste = { ...request, id: 'r-paste', turnId: 't1', framesEnabled: true, richPasteEnabled: true, command: { action: 'paste_html', ref: 'e1', html: '<b>x</b>' } };
            const backgroundTurn = async (baseUrl?: string, ref = 'w') => {
                applyRuntimeConfigPatch({ browserBackgroundControlEnabled: true });
                const h = harness(baseUrl, true);
                const retainScope = withRetain(h);
                window.location.hash = `#repos/${ref}`;
                await h.relay.update(ref); h.relay.onOpen();
                h.relay.onMessage({ type: 'browser-command', request: { ...request, turnId: 't1' } });
                await tick();
                window.location.hash = '#repos/other';
                await h.relay.update('other');
                h.send.mockClear();
                return { ...h, retainScope };
            };
            const results = (h: ReturnType<typeof harness>) => (h.send.mock.calls as unknown[][])
                .map(([message]) => message as any).filter(message => message.type === 'browser-command-result');
            afterEach(() => { window.location.hash = ''; });

            it('waits without replying, then re-runs the action on Switch back as a foreground command', async () => {
                const h = await backgroundTurn();
                h.control.execute.mockRejectedValueOnce(foregroundRequired);
                h.relay.onMessage({ type: 'browser-command', request: paste });
                await tick();
                expect(h.send).toHaveBeenCalledWith({ type: 'browser-command-waiting', id: 'r-paste', waiting: true });
                expect(results(h)).toEqual([]);
                const [notice] = getBrowserControlNotices();
                expect(notice).toMatchObject({ workspaceId: 'w', processId: 'p', routingRef: 'w', actions: ['paste_html'] });
                // No timeout: the wait survives other switches while the turn is alive.
                await h.relay.update('third');
                expect(getBrowserControlNotices()).toHaveLength(1);

                notice.switchBack();
                expect(window.location.hash).toBe('#repos/w/chats/p');
                h.control.execute.mockClear();
                await h.relay.update('w');
                expect(h.control.execute).toHaveBeenCalledExactlyOnceWith(paste, 'w');
                const waitingOff = (h.send.mock.calls as unknown[][]).findIndex(([m]) => (m as any).type === 'browser-command-waiting' && (m as any).waiting === false);
                expect(waitingOff).toBeGreaterThanOrEqual(0);
                await tick();
                expect(results(h)).toEqual([{ type: 'browser-command-result', reply: { id: 'r-paste', ok: true, result: { tabs: [] } } }]);
                expect(getBrowserControlNotices()).toEqual([]);
                h.relay.dispose();
            });

            it('shows one notice per turn listing each waiting action', async () => {
                const h = await backgroundTurn();
                h.control.execute.mockRejectedValueOnce(foregroundRequired).mockRejectedValueOnce(foregroundRequired);
                h.relay.onMessage({ type: 'browser-command', request: paste });
                h.relay.onMessage({ type: 'browser-command', request: { ...paste, id: 'r-click', command: { action: 'click', ref: 'e2' } } });
                await tick();
                expect(getBrowserControlNotices()).toHaveLength(1);
                expect(getBrowserControlNotices()[0].actions).toEqual(['paste_html', 'click']);
                h.relay.dispose();
                expect(getBrowserControlNotices()).toEqual([]);
            });

            it.each([
                ['turn finished', (h: any) => h.relay.onMessage({ type: 'browser-turn-finished', workspaceId: 'w', processId: 'p', turnId: 't1' }), 'Browser conversation turn has finished'],
                ['tab closed', (h: any) => h.activity({ workspaceId: 'w', processId: 'p', turnId: 't1', routingRef: 'w', viewId: 'v', active: false, finished: false }), 'Browser tab closed'],
                ['flag off', () => applyRuntimeConfigPatch({ browserBackgroundControlEnabled: false }), 'Browser workspace scope changed'],
            ])('rejects the waiting action and clears its notice when the %s', async (_label, trigger, error) => {
                const h = await backgroundTurn();
                h.control.execute.mockRejectedValueOnce(foregroundRequired);
                h.relay.onMessage({ type: 'browser-command', request: paste });
                await tick();
                trigger(h);
                expect(results(h)).toEqual([{ type: 'browser-command-result', reply: { id: 'r-paste', ok: false, error } }]);
                expect(getBrowserControlNotices()).toEqual([]);
                h.control.execute.mockClear();
                await h.relay.update('w');
                expect(h.control.execute).not.toHaveBeenCalled();
                h.relay.dispose();
            });

            it('drops a waiting action the server cancelled without replying and never re-runs it', async () => {
                const h = await backgroundTurn();
                h.control.execute.mockRejectedValueOnce(foregroundRequired);
                h.relay.onMessage({ type: 'browser-command', request: paste });
                await tick();
                h.relay.onMessage({ type: 'browser-command-cancel', id: 'r-paste' });
                expect(h.control.cancel).not.toHaveBeenCalled();
                expect(getBrowserControlNotices()).toEqual([]);
                h.control.execute.mockClear();
                await h.relay.update('w');
                expect(h.control.execute).not.toHaveBeenCalled();
                expect(results(h)).toEqual([]);
                h.relay.dispose();
            });

            it('returns other background errors and foreground-required errors on screen unchanged', async () => {
                const h = await backgroundTurn();
                h.control.execute.mockRejectedValueOnce(new Error('Element not found'));
                h.relay.onMessage({ type: 'browser-command', request: paste });
                await tick();
                expect(results(h)).toEqual([{ type: 'browser-command-result', reply: { id: 'r-paste', ok: false, error: 'Element not found' } }]);
                await h.relay.update('w');
                h.send.mockClear();
                h.control.execute.mockRejectedValueOnce(foregroundRequired);
                h.relay.onMessage({ type: 'browser-command', request: { ...paste, id: 'r-front' } });
                await tick();
                expect(results(h)).toEqual([{ type: 'browser-command-result', reply: { id: 'r-front', ok: false, error: foregroundRequired.message } }]);
                expect(getBrowserControlNotices()).toEqual([]);
                h.relay.dispose();
            });

            it('opens the repo-group scope the turn was started from', async () => {
                applyRuntimeConfigPatch({ browserBackgroundControlEnabled: true });
                const h = harness(undefined, true);
                withRetain(h);
                await h.relay.update('group-1'); h.relay.onOpen();
                const scope = renderHook(() => useBrowserControlScope('w', 'group-1'));
                await tick();
                expect(h.control.bindScope).toHaveBeenLastCalledWith('w', 'w');
                h.relay.onMessage({ type: 'browser-command', request: { ...request, turnId: 't1' } });
                await tick();
                scope.unmount(); await tick();
                await h.relay.update('other');
                h.control.execute.mockRejectedValueOnce(foregroundRequired);
                h.relay.onMessage({ type: 'browser-command', request: paste });
                await tick();
                getBrowserControlNotices()[0].switchBack();
                expect(window.location.hash).toBe('#repos/group-1/chats/p');
                h.relay.dispose();
            });

            it('routes Switch back and Stop through the owning remote clone', async () => {
                const baseUrl = 'http://127.0.0.1:4500';
                registerCloneBaseUrls([{ workspaceId: 'w', serverId: 'server', baseUrl }]);
                const h = await backgroundTurn(baseUrl, 'remote:server:w');
                h.control.execute.mockRejectedValueOnce(foregroundRequired);
                h.relay.onMessage({ type: 'browser-command', request: paste });
                await tick();
                const [notice] = getBrowserControlNotices();
                expect(notice.routingRef).toBe('remote:server:w');
                await notice.stop();
                expect(clients.remoteCancel).toHaveBeenCalledWith('p', { workspace: 'w' });
                expect(clients.cancel).not.toHaveBeenCalled();
                notice.switchBack();
                expect(window.location.hash).toBe(`#repos/${encodeURIComponent('remote:server:w')}/chats/p`);
                await h.relay.update('remote:server:w');
                expect(h.control.execute).toHaveBeenLastCalledWith(paste, 'remote:server:w');
                h.relay.dispose();
            });
        });
    });
    describe('navigation approval', () => {
        const check = { checkId: 'c1', workspaceId: 'w', processId: 'p', turnId: 't1', routingRef: 'w', url: 'https://mail.example.com/inbox' };
        const prompt = { checkId: 'c1', workspaceId: 'w', processId: 'p', turnId: 't1', site: 'example.com', url: check.url };

        it('asks the owning server about a held navigation and relays its decision to the desktop', async () => {
            const h = harness(undefined, true);
            await h.relay.update('w'); h.relay.onOpen();
            h.navigationCheck(check);
            expect(h.send).toHaveBeenCalledWith({ type: 'browser-navigation-check', checkId: 'c1', workspaceId: 'w', processId: 'p', turnId: 't1', url: check.url });
            expect(h.relay.onMessage({ type: 'browser-navigation-decision', checkId: 'c1', allow: true })).toBe(true);
            expect(h.control.decideNavigation).toHaveBeenCalledExactlyOnceWith('c1', true);
            // A repeated or unknown decision never reaches the desktop again.
            h.relay.onMessage({ type: 'browser-navigation-decision', checkId: 'c1', allow: false });
            h.relay.onMessage({ type: 'browser-navigation-decision', checkId: 'other', allow: true });
            expect(h.control.decideNavigation).toHaveBeenCalledOnce();
            h.relay.dispose();
        });

        it('shows the prompt, sends each answer on the same socket and removes the card when cleared', async () => {
            const h = harness(undefined, true);
            await h.relay.update('w'); h.relay.onOpen();
            h.navigationCheck(check);
            h.relay.onMessage({ type: 'browser-navigation-prompt', prompt });
            const [entry] = getBrowserNavigationPrompts();
            expect(entry).toMatchObject({ ...prompt, sourceBaseUrl: undefined });
            for (const answer of ['once', 'always', 'deny'] as const) {
                entry.answer(answer);
                expect(h.send).toHaveBeenLastCalledWith({ type: 'browser-navigation-answer', checkId: 'c1', answer });
            }
            h.relay.onMessage({ type: 'browser-navigation-prompt-cleared', checkId: 'c1' });
            expect(getBrowserNavigationPrompts()).toEqual([]);
            h.relay.dispose();
        });

        it('ignores prompts for navigations it never asked about', async () => {
            const h = harness(undefined, true);
            await h.relay.update('w'); h.relay.onOpen();
            h.relay.onMessage({ type: 'browser-navigation-prompt', prompt });
            expect(getBrowserNavigationPrompts()).toEqual([]);
            h.relay.dispose();
        });

        it('blocks held navigations and drops their cards when the socket closes or the relay is disposed', async () => {
            const h = harness(undefined, true);
            await h.relay.update('w'); h.relay.onOpen();
            h.navigationCheck(check);
            h.relay.onMessage({ type: 'browser-navigation-prompt', prompt });
            h.relay.onClose();
            expect(h.control.decideNavigation).toHaveBeenCalledExactlyOnceWith('c1', false);
            expect(getBrowserNavigationPrompts()).toEqual([]);
            // Checks arriving while disconnected are blocked at once.
            h.navigationCheck({ ...check, checkId: 'c2' });
            expect(h.control.decideNavigation).toHaveBeenLastCalledWith('c2', false);
            h.relay.onOpen();
            h.navigationCheck({ ...check, checkId: 'c3' });
            h.relay.dispose();
            expect(h.control.decideNavigation).toHaveBeenLastCalledWith('c3', false);
        });

        it('only the owning clone socket asks, and its cards are keyed to that server', async () => {
            const baseUrl = 'http://127.0.0.1:4500';
            registerCloneBaseUrls([{ workspaceId: 'w', serverId: 'server', baseUrl }]);
            const local = harness(undefined, true);
            const localHandler = local.control.onNavigationCheck.mock.calls[0][0];
            const remote = harness(baseUrl, true);
            await remote.relay.update('remote:server:w'); remote.relay.onOpen();
            await local.relay.update(null); local.relay.onOpen();
            const remoteCheck = { ...check, routingRef: 'remote:server:w' };
            localHandler(remoteCheck);
            expect(local.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'browser-navigation-check' }));
            remote.navigationCheck(remoteCheck);
            expect(remote.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'browser-navigation-check', checkId: 'c1' }));
            remote.relay.onMessage({ type: 'browser-navigation-prompt', prompt });
            expect(getBrowserNavigationPrompts()[0]).toMatchObject({ sourceBaseUrl: baseUrl, key: JSON.stringify([baseUrl, 'c1']) });
            remote.relay.dispose();
            local.relay.dispose();
        });
    });
});


describe('human takeover relay lifecycle', () => {
    it('retains paused work with background off, sends privacy state only to its source and clears it on disconnect', async () => {
        const h = harness(undefined, true);
        const retainScope = vi.fn(async () => {}); Object.assign(h.control, { retainScope, humanTakeoverSupported: true });
        await h.relay.update('w'); h.relay.onOpen();
        h.control.execute.mockImplementationOnce(() => new Promise(() => {}));
        h.relay.onMessage({ type: 'browser-command', request: { ...request, turnId: 'turn', humanTakeoverEnabled: true } });
        h.takeoverState({ workspaceId: 'w', processId: 'p', turnId: 'turn', routingRef: 'w', status: 'human', viewIds: ['one'] });
        expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'browser-takeover-state' }));
        await h.relay.update('other');
        expect(retainScope).toHaveBeenCalledWith('w', 'w'); expect(h.control.cancel).not.toHaveBeenCalled();
        h.relay.onClose();
        expect(h.control.setTakeoverPolicy).toHaveBeenCalledWith('w', false); expect(h.control.cancel).toHaveBeenCalledWith('r');
        h.relay.dispose();
    });
});
