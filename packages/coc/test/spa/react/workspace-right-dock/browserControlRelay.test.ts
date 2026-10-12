// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserSocketRelay } from '../../../../src/server/spa/client/react/shared/file-path/browser-control-relay';
import { registerCloneBaseUrls } from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { clearUnifiedPanelState, readUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import type { BrowserCommandResult } from '@plusplusoneplusplus/coc-client';
import { renderHook, cleanup } from '@testing-library/react';
import { useBrowserControlScope } from '../../../../src/server/spa/client/react/shared/file-path/browser-control-scope';
import { getBrowserControlActivity } from '../../../../src/server/spa/client/react/shared/file-path/browser-control-activity';

afterEach(() => {
    cleanup();
    delete (window as any).cocDesktop;
    registerCloneBaseUrls([]);
    clearUnifiedPanelState();
    vi.restoreAllMocks();
});

function harness(baseUrl?: string) {
    const send = vi.fn(() => true);
    let reveal!: (event: any) => void;
    const control = {
        bindScope: vi.fn(async (): Promise<{ ownerId: number } | void> => {}),
        execute: vi.fn(async (): Promise<BrowserCommandResult> => ({ tabs: [] })),
        cancel: vi.fn(),
        onReveal: vi.fn((handler: (event: any) => void) => { reveal = handler; return vi.fn(); }),
    };
    (window as any).cocDesktop = { browser: { control } };
    const relay = createBrowserSocketRelay({ send }, baseUrl);
    return { relay, control, send, reveal: (event: any) => reveal(event) };
}
const request = { id: 'r', workspaceId: 'w', processId: 'p', command: { action: 'tabs' } };
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('SPA browser socket relay', () => {
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
});
