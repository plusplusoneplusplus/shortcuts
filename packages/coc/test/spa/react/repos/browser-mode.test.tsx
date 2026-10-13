/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, renderHook, waitFor, act } from '@testing-library/react';
import { BrowserModePill } from '../../../../src/server/spa/client/react/features/chat/BrowserModePill';
import { getActiveMetaCommands, parseSlashCommands } from '../../../../src/server/spa/client/react/features/chat/slash-command-parser';
import { getMetaSkillItems, mergeSkillsWithMeta } from '../../../../src/server/spa/client/react/features/chat/SlashCommandMenu';
import { useBrowserToolEnabled } from '../../../../src/server/spa/client/react/features/chat/hooks/useBrowserMode';

const mocks = vi.hoisted(() => ({
    desktop: false, enabled: false, baseUrl: undefined as string | undefined,
    getConfig: vi.fn(), localGetConfig: vi.fn(), routes: vi.fn(),
}));
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    DASHBOARD_CONFIG_UPDATED_EVENT: 'coc-dashboard-config-updated',
    isBrowserControlEnabled: () => mocks.enabled,
}));
vi.mock('../../../../src/server/spa/client/react/shared/file-path/browser-bridge', () => ({
    desktopBrowserBridge: () => mocks.desktop ? {} : undefined,
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRouting', () => {
    const client = { preferences: { getLlmToolsConfig: mocks.getConfig } };
    return { useCocClient: (route?: string) => { mocks.routes(route); return client; }, useCloneBaseUrl: () => mocks.baseUrl };
});
vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => {
    const client = { preferences: { getLlmToolsConfig: mocks.localGetConfig } };
    return { getSpaCocClient: () => client };
});

describe('browser mode composer', () => {
    beforeEach(() => {
        mocks.desktop = false;
        mocks.enabled = false;
        mocks.baseUrl = undefined;
        mocks.routes.mockReset();
        mocks.getConfig.mockReset().mockResolvedValue({ tools: [{ name: 'browser' }], disabledLlmTools: [] });
        mocks.localGetConfig.mockReset().mockResolvedValue({ tools: [{ name: 'browser' }], disabledLlmTools: [] });
    });
    it.each([false, true])('recognizes /browser only under its gate: %s', browserEnabled => {
        const flags = { cronEnabled: false, canvasEnabled: false, browserEnabled };
        const parsed = parseSlashCommands('/BrOwSeR open a page /browser', [], getActiveMetaCommands(flags));
        expect(parsed.metaCommands).toEqual(browserEnabled ? ['browser'] : []);
        expect(parsed.prompt).toBe(browserEnabled ? 'open a page' : '/BrOwSeR open a page /browser');
        expect(getMetaSkillItems(flags).some(item => item.name === 'browser')).toBe(browserEnabled);
        expect(mergeSkillsWithMeta([{ name: 'browser' }], getMetaSkillItems(flags), flags).some(item => item.name === 'browser')).toBe(browserEnabled);
    });
    it('requires both desktop and the flag before requesting repo settings', () => {
        const { result, rerender } = renderHook(() => useBrowserToolEnabled('ws-browser'));
        expect(result.current).toBe(false);
        mocks.enabled = true;
        rerender();
        expect(result.current).toBe(false);
        mocks.desktop = true;
        mocks.enabled = false;
        rerender();
        expect(result.current).toBe(false);
        expect(mocks.getConfig).not.toHaveBeenCalled();
    });
    it('honors owner-scoped per-repo toggle and flag changes', async () => {
        mocks.enabled = mocks.desktop = true;
        const { result, rerender } = renderHook(({ workspace }) => useBrowserToolEnabled(workspace), { initialProps: { workspace: 'ws-one' } });
        await waitFor(() => expect(result.current).toBe(true));
        expect(mocks.getConfig).toHaveBeenCalledWith('ws-one');
        mocks.getConfig.mockResolvedValue({ tools: [{ name: 'browser' }], disabledLlmTools: ['browser'] });
        rerender({ workspace: 'ws-two' });
        await waitFor(() => expect(result.current).toBe(false));
        mocks.enabled = false;
        rerender({ workspace: 'ws-two' });
        expect(result.current).toBe(false);
    });
    it('renders a compact removable pill only while active', () => {
        const remove = vi.fn();
        const { rerender } = render(<BrowserModePill active={false} onRemove={remove} />);
        expect(screen.queryByTestId('browser-mode-pill')).toBeNull();
        rerender(<BrowserModePill active onRemove={remove} />);
        fireEvent.click(screen.getByRole('button', { name: 'Turn off browser mode' }));
        expect(remove).toHaveBeenCalledOnce();
        rerender(<BrowserModePill active={false} onRemove={remove} />);
        expect(screen.queryByTestId('browser-mode-pill')).toBeNull();
    });
    it('applies live config invalidation without remounting the composer', async () => {
        mocks.enabled = mocks.desktop = true;
        const { result } = renderHook(() => useBrowserToolEnabled('ws-live'));
        await waitFor(() => expect(result.current).toBe(true));
        mocks.enabled = false;
        act(() => window.dispatchEvent(new Event('coc-dashboard-config-updated')));
        expect(result.current).toBe(false);
        mocks.enabled = true;
        act(() => window.dispatchEvent(new Event('coc-dashboard-config-updated')));
        await waitFor(() => expect(result.current).toBe(true));
        expect(mocks.getConfig).toHaveBeenCalledTimes(2);
    });
    it('rejects a late capability response after switching owners', async () => {
        mocks.enabled = mocks.desktop = true;
        let finish: (value: unknown) => void = () => {};
        mocks.getConfig.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
            .mockResolvedValue({ tools: [], disabledLlmTools: [] });
        const { result, rerender } = renderHook(({ workspace }) => useBrowserToolEnabled(workspace), { initialProps: { workspace: 'ws-old' } });
        rerender({ workspace: 'ws-new' });
        await act(async () => { finish({ tools: [{ name: 'browser' }], disabledLlmTools: [] }); });
        expect(result.current).toBe(false);
    });
    it('routes clone settings through their owner while requesting the raw workspace', async () => {
        mocks.desktop = true;
        mocks.baseUrl = 'https://owner.example.test';
        const { result } = renderHook(() => useBrowserToolEnabled('remote:server:ws-browser'));
        await waitFor(() => expect(result.current).toBe(true));
        expect(mocks.routes).toHaveBeenCalledWith('remote:server:ws-browser');
        expect(mocks.getConfig).toHaveBeenCalledWith('ws-browser');
    });
    it('pins explicit local ownership despite a colliding remote route', async () => {
        mocks.desktop = true;
        mocks.baseUrl = 'https://other.example.test';
        const { result, rerender } = renderHook(() => useBrowserToolEnabled('ws-browser', null));
        expect(result.current).toBe(false);
        expect(mocks.localGetConfig).not.toHaveBeenCalled();
        mocks.enabled = true;
        rerender();
        await waitFor(() => expect(result.current).toBe(true));
        expect(mocks.localGetConfig).toHaveBeenCalledWith('ws-browser');
        expect(mocks.getConfig).not.toHaveBeenCalled();
    });
    it('refreshes remote live settings only for its exact owning server', async () => {
        mocks.desktop = true;
        mocks.baseUrl = 'https://owner.example.test';
        const { result } = renderHook(() => useBrowserToolEnabled('ws-browser', 'remote:server:ws-browser'));
        await waitFor(() => expect(result.current).toBe(true));
        const notify = (type: string, baseUrl: string, messageType = 'config-changed') => act(() => {
            window.dispatchEvent(new CustomEvent(type, { detail: { baseUrl, message: { type: messageType } } }));
        });
        notify('coc-remote-ws-message', 'https://other.example.test');
        notify('coc-remote-ws-message', mocks.baseUrl, 'process-updated');
        expect(mocks.getConfig).toHaveBeenCalledTimes(1);
        mocks.getConfig.mockResolvedValue({ tools: [], disabledLlmTools: [] });
        notify('coc-remote-ws-message', mocks.baseUrl);
        await waitFor(() => expect(result.current).toBe(false));
        expect(mocks.getConfig).toHaveBeenCalledTimes(2);
        mocks.getConfig.mockResolvedValue({ tools: [{ name: 'browser' }], disabledLlmTools: [] });
        notify('coc-remote-ws-connect', mocks.baseUrl);
        await waitFor(() => expect(result.current).toBe(true));
        expect(mocks.getConfig).toHaveBeenCalledTimes(3);
    });
    it('fails closed with a content-free diagnostic when settings cannot be loaded', async () => {
        mocks.enabled = mocks.desktop = true;
        mocks.getConfig.mockRejectedValue(new Error('sensitive response detail'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const { result } = renderHook(() => useBrowserToolEnabled('ws-browser'));
            await waitFor(() => expect(warn).toHaveBeenCalledWith('Browser control availability lookup failed.'));
            expect(result.current).toBe(false);
            expect(warn).toHaveBeenCalledOnce();
        } finally { warn.mockRestore(); }
    });
});
