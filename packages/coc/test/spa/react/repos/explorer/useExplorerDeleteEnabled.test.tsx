import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    local: false,
    route: vi.fn(),
    client: vi.fn(),
    request: vi.fn(),
}));
vi.mock('../../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    resolveCloneRoute: mocks.route,
    getCocClientForWorkspace: mocks.client,
    subscribeCloneBaseUrl: () => () => {},
}));
vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isFeatureEnabled: () => mocks.local,
    DASHBOARD_CONFIG_UPDATED_EVENT: 'config-updated',
}));
import { useExplorerDeleteEnabled } from '../../../../../src/server/spa/client/react/hooks/feature-flags/useExplorerDeleteEnabled';

beforeEach(() => {
    vi.clearAllMocks();
    mocks.local = false;
    mocks.route.mockReturnValue({ kind: 'local' });
    mocks.client.mockReturnValue({ request: mocks.request });
});
afterEach(cleanup);

it('defaults off locally and responds to live config updates', () => {
    const { result } = renderHook(() => useExplorerDeleteEnabled('workspace', null));
    expect(result.current.enabled).toBe(false);
    act(() => { mocks.local = true; window.dispatchEvent(new Event('config-updated')); });
    expect(result.current.enabled).toBe(true);
    expect(mocks.client).not.toHaveBeenCalled();
});

it('reads the flag from the remote owner, not from a locally enabled flag', async () => {
    mocks.local = true;
    mocks.route.mockReturnValue({ kind: 'remote', baseUrl: 'https://owner.invalid' });
    mocks.request.mockResolvedValue({ features: {} });
    const { result } = renderHook(() => useExplorerDeleteEnabled('workspace', 'remote:server-a:workspace'));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('/config/runtime'));
    expect(mocks.client).toHaveBeenCalledWith('remote:server-a:workspace');
    expect(result.current.enabled).toBe(false);
});

it('reports an unavailable remote without falling through locally', async () => {
    mocks.local = true;
    mocks.route.mockReturnValue({ kind: 'unresolved-remote' });
    const { result } = renderHook(() => useExplorerDeleteEnabled('workspace', 'remote:missing:workspace'));
    await waitFor(() => expect(result.current.error).toMatch(/owning server is unavailable/));
    expect(result.current.enabled).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
});

it('shows probe failures and remains disabled', async () => {
    mocks.route.mockReturnValue({ kind: 'remote', baseUrl: 'https://owner.invalid' });
    mocks.request.mockRejectedValue(new Error('Offline'));
    const { result } = renderHook(() => useExplorerDeleteEnabled('workspace', 'remote:server-a:workspace'));
    await waitFor(() => expect(result.current.error).toContain('Offline'));
    expect(result.current.enabled).toBe(false);
});

it('rejects late capability responses after the selected owner changes', async () => {
    let finish!: (value: unknown) => void;
    mocks.route.mockReturnValue({ kind: 'remote', baseUrl: 'https://owner.invalid' });
    mocks.request.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
        .mockResolvedValueOnce({ features: { explorerDeleteEnabled: false } });
    const { result, rerender } = renderHook(({ route }) => useExplorerDeleteEnabled('workspace', route), {
        initialProps: { route: 'remote:server-a:workspace' },
    });
    rerender({ route: 'remote:server-b:workspace' });
    await act(async () => { finish({ features: { explorerDeleteEnabled: true } }); });
    expect(result.current.enabled).toBe(false);
});
