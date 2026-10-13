import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserControlBadge } from '../../../../src/server/spa/client/react/shared/file-path/BrowserControlBadge';
import { clearBrowserControlActivities, finishBrowserControlActivity, startBrowserControlActivity } from '../../../../src/server/spa/client/react/shared/file-path/browser-control-activity';
import { _clearConfigCache, configCacheKey, invalidateConfig } from '../../../../src/server/spa/client/react/api/staticConfigCache';

const mocks = vi.hoisted(() => ({
    enabled: true, desktop: true, baseUrl: undefined as string | undefined,
    cancel: vi.fn(), getConfig: vi.fn(), remoteCancel: vi.fn(), remoteGetConfig: vi.fn(),
}));
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    DASHBOARD_CONFIG_UPDATED_EVENT: 'coc-dashboard-config-updated',
    isBrowserControlEnabled: () => mocks.enabled,
}));
vi.mock('../../../../src/server/spa/client/react/shared/file-path/browser-bridge', () => ({
    desktopBrowserBridge: () => mocks.desktop ? { control: {} } : null,
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: () => mocks.baseUrl ? remoteClient : client,
    useCloneBaseUrl: () => mocks.baseUrl,
}));
vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => client, getCocClientFor: () => remoteClient,
}));
const client = { processes: { cancel: mocks.cancel }, preferences: { getLlmToolsConfig: mocks.getConfig } };
const remoteClient = { processes: { cancel: mocks.remoteCancel }, preferences: { getLlmToolsConfig: mocks.remoteGetConfig } };

beforeEach(() => {
    mocks.enabled = true;
    mocks.desktop = true;
    mocks.baseUrl = undefined;
    mocks.cancel.mockReset().mockResolvedValue(undefined);
    mocks.getConfig.mockReset().mockResolvedValue({ tools: [{ name: 'browser' }], disabledLlmTools: [] });
    mocks.remoteCancel.mockReset().mockResolvedValue(undefined);
    mocks.remoteGetConfig.mockReset().mockResolvedValue({ tools: [{ name: 'browser' }], disabledLlmTools: [] });
    _clearConfigCache();
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    clearBrowserControlActivities('workspace-a');
    clearBrowserControlActivities('workspace-b');
    clearBrowserControlActivities('workspace-a', mocks.baseUrl);
});

function start() {
    startBrowserControlActivity({ workspaceId: 'workspace-a', processId: 'process-a', tabId: 'workspace-a|tab-a' });
}
function mount() {
    return render(<BrowserControlBadge workspaceId="workspace-a" tabId="workspace-a|tab-a" routingRef={null} />);
}

describe('AI controlling badge', () => {
    it('supports remote desktop owners independently of page-origin flag and cancels only the owning host', async () => {
        const sourceBaseUrl = mocks.baseUrl = 'https://owner.example';
        mocks.enabled = false;
        start();
        startBrowserControlActivity({ workspaceId: 'workspace-a', processId: 'process-a', tabId: 'remote|tab-a', sourceBaseUrl });
        render(<BrowserControlBadge workspaceId="workspace-a" tabId="remote|tab-a" routingRef="remote-owner" />);
        fireEvent.click(await screen.findByRole('button', { name: 'Stop AI browser control' }));
        await waitFor(() => expect(mocks.remoteCancel).toHaveBeenCalledExactlyOnceWith('process-a', { workspace: 'workspace-a' }));
        expect(mocks.remoteGetConfig).toHaveBeenCalledWith('workspace-a');
        expect(mocks.cancel).not.toHaveBeenCalled();
    });

    it('hides when the remote effective registry disables the feature and refreshes only matching owner notifications', async () => {
        const sourceBaseUrl = mocks.baseUrl = 'https://owner.example';
        startBrowserControlActivity({ workspaceId: 'workspace-a', processId: 'process-a', tabId: 'remote|tab-a', sourceBaseUrl });
        render(<BrowserControlBadge workspaceId="workspace-a" tabId="remote|tab-a" routingRef="remote-owner" />);
        await screen.findByText('AI controlling');
        mocks.remoteGetConfig.mockResolvedValue({ tools: [], disabledLlmTools: [] });
        const update = (baseUrl: string) => window.dispatchEvent(new CustomEvent('coc-remote-ws-message', {
            detail: { baseUrl, message: { type: 'config-changed' } },
        }));
        await act(async () => update('https://other-owner.example'));
        expect(screen.getByText('AI controlling')).toBeTruthy();
        await act(async () => update(sourceBaseUrl));
        expect(screen.queryByText('AI controlling')).toBeNull();
    });

    it('logs a content-free config read failure and keeps the badge hidden', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mocks.getConfig.mockRejectedValue(new Error('private server diagnostic'));
        start();
        mount();
        await waitFor(() => expect(warn).toHaveBeenCalledExactlyOnceWith('Browser control availability lookup failed.'));
        expect(screen.queryByText('AI controlling')).toBeNull();
        expect(warn.mock.calls.flat().join(' ')).not.toContain('private server diagnostic');
    });

    it('appears only for the owning workspace/tab and remains until the turn finishes', async () => {
        start();
        const { rerender } = mount();
        await screen.findByText('AI controlling');
        expect(mocks.getConfig).toHaveBeenCalledWith('workspace-a');
        rerender(<BrowserControlBadge workspaceId="workspace-b" tabId="workspace-a|tab-a" routingRef={null} />);
        expect(screen.queryByText('AI controlling')).toBeNull();
        rerender(<BrowserControlBadge workspaceId="workspace-a" tabId="other-tab" routingRef={null} />);
        expect(screen.queryByText('AI controlling')).toBeNull();
        rerender(<BrowserControlBadge workspaceId="workspace-a" tabId="workspace-a|tab-a" routingRef={null} />);
        await screen.findByText('AI controlling');
        act(() => finishBrowserControlActivity('workspace-a', 'process-a'));
        expect(screen.queryByText('AI controlling')).toBeNull();
    });

    it('Stop cancels the controlling conversation through its owner client', async () => {
        start();
        mount();
        fireEvent.click(await screen.findByRole('button', { name: 'Stop AI browser control' }));
        await waitFor(() => expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith('process-a', { workspace: 'workspace-a' }));
        await waitFor(() => expect(screen.queryByText('AI controlling')).toBeNull());
    });

    it('retains activity and offers retry when cancellation fails', async () => {
        mocks.cancel.mockRejectedValueOnce(new Error('unavailable'));
        start();
        mount();
        fireEvent.click(await screen.findByRole('button', { name: 'Stop AI browser control' }));
        await screen.findByRole('alert');
        expect(screen.getByText('AI controlling')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Stop AI browser control' }));
        await waitFor(() => expect(screen.queryByText('AI controlling')).toBeNull());
    });

    it.each(['feature', 'repo', 'desktop'])('hides when the %s gate is disabled', async gate => {
        if (gate === 'feature') mocks.enabled = false;
        if (gate === 'desktop') mocks.desktop = false;
        if (gate === 'repo') mocks.getConfig.mockResolvedValue({ tools: [{ name: 'browser' }], disabledLlmTools: ['browser'] });
        start();
        mount();
        await act(async () => {});
        expect(screen.queryByText('AI controlling')).toBeNull();
    });

    it('reacts to live feature changes and existing repo tool cache invalidation', async () => {
        start();
        mount();
        await screen.findByText('AI controlling');
        act(() => {
            mocks.enabled = false;
            window.dispatchEvent(new Event('coc-dashboard-config-updated'));
        });
        expect(screen.queryByText('AI controlling')).toBeNull();
        act(() => {
            mocks.enabled = true;
            window.dispatchEvent(new Event('coc-dashboard-config-updated'));
        });
        await screen.findByText('AI controlling');
        mocks.getConfig.mockResolvedValue({ tools: [{ name: 'browser' }], disabledLlmTools: ['browser'] });
        await act(async () => invalidateConfig(configCacheKey.llmToolsConfig('workspace-a')));
        expect(screen.queryByText('AI controlling')).toBeNull();
    });
});
