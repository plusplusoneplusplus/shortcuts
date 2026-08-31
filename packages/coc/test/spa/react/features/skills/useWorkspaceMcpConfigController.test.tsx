/**
 * @vitest-environment jsdom
 *
 * Race characterization for the single owner of a workspace's MCP policy.
 *
 * Before this controller existed, three surfaces mutated the same REST resource
 * through separate optimistic states: two parent screens each owning a server
 * toggle, and the inspector, which re-sent an `enabledMcpServers` snapshot
 * captured in a React callback closure on every tool checkbox change. Two
 * concurrent saves could therefore land in either order, and the loser could
 * write back a PRE-toggle server list — silently re-enabling a server the user
 * had just disabled, inside a multi-repo security boundary.
 *
 * These tests pin the properties that make that impossible:
 *   - field-specific patches (a tool save carries no server list at all)
 *   - serialized writes (never two policy requests in flight)
 *   - coalesced optimistic state (rapid toggles collapse to the latest value)
 *   - revision-guarded rollback (an older failure cannot revert newer state)
 *   - generation-guarded workspace scoping (a stale workspace never writes)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { useWorkspaceMcpConfigController } from '../../../../../src/server/spa/client/react/features/skills/useWorkspaceMcpConfigController';

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClientErrorMessage: (e: unknown, fallback: string) =>
        e instanceof Error ? e.message : fallback,
}));

const TWO_SERVERS = [
    { name: 'github', type: 'stdio' },
    { name: 'search', type: 'sse' },
];

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const getMcpConfig = vi.fn();
const updateMcpConfig = vi.fn();
/** Stable across renders, like the module-level resolvers the parents pass. */
const resolveClient = vi.fn((_workspaceId: string) => ({
    workspaces: { getMcpConfig, updateMcpConfig },
})) as any;

function renderController(workspaceId = 'ws-1') {
    return renderHook(
        ({ id }: { id: string }) => useWorkspaceMcpConfigController({ workspaceId: id, resolveClient }),
        { initialProps: { id: workspaceId } },
    );
}

async function renderLoaded(workspaceId = 'ws-1') {
    const view = renderController(workspaceId);
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    return view;
}

beforeEach(() => {
    vi.clearAllMocks();
    getMcpConfig.mockResolvedValue({
        availableServers: TWO_SERVERS,
        enabledMcpServers: null,
        enabledMcpTools: null,
        sources: undefined,
    });
    updateMcpConfig.mockResolvedValue({});
});

afterEach(() => {
    cleanup();
});

describe('useWorkspaceMcpConfigController — loading', () => {
    it('loads the canonical policy and server catalog through the routed client', async () => {
        const { result } = await renderLoaded();

        expect(resolveClient).toHaveBeenCalledWith('ws-1');
        expect(getMcpConfig).toHaveBeenCalledWith('ws-1', undefined);
        expect(result.current.availableServers).toEqual(TWO_SERVERS);
        expect(result.current.enabledMcpServers).toBeNull();
        expect(result.current.enabledMcpTools).toBeNull();
        expect(result.current.isEnabled('github')).toBe(true);
        expect(result.current.error).toBeNull();
    });

    it('surfaces a load failure', async () => {
        getMcpConfig.mockRejectedValueOnce(new Error('offline'));
        const { result } = await renderLoaded();
        expect(result.current.error).toBe('offline');
    });

    it('passes forceReload on an explicit refresh', async () => {
        const { result } = await renderLoaded();
        await act(async () => { result.current.refresh(true); });
        expect(getMcpConfig).toHaveBeenLastCalledWith('ws-1', { forceReload: true });
    });
});

describe('useWorkspaceMcpConfigController — field-specific writes', () => {
    it('a server toggle patches ONLY enabledMcpServers', async () => {
        const { result } = await renderLoaded();

        await act(async () => { result.current.toggleServer('github', false); });

        expect(updateMcpConfig).toHaveBeenCalledWith('ws-1', { enabledMcpServers: ['search'] });
        expect(result.current.enabledMcpServers).toEqual(['search']);
        expect(result.current.isEnabled('github')).toBe(false);
    });

    it('enabling the last disabled server collapses back to null', async () => {
        getMcpConfig.mockResolvedValueOnce({
            availableServers: TWO_SERVERS,
            enabledMcpServers: ['github'],
            enabledMcpTools: null,
        });
        const { result } = await renderLoaded();

        await act(async () => { result.current.toggleServer('search', true); });

        expect(updateMcpConfig).toHaveBeenCalledWith('ws-1', { enabledMcpServers: null });
    });

    it('a tool save patches ONLY enabledMcpTools', async () => {
        const { result } = await renderLoaded();

        await act(async () => { result.current.saveEnabledMcpTools({ github: ['create_issue'] }); });

        expect(updateMcpConfig).toHaveBeenCalledWith('ws-1', {
            enabledMcpTools: { github: ['create_issue'] },
        });
        expect(result.current.enabledMcpTools).toEqual({ github: ['create_issue'] });
    });

    it('normalizes an empty allow-list map to null', async () => {
        const { result } = await renderLoaded();
        await act(async () => { result.current.saveEnabledMcpTools({}); });
        expect(updateMcpConfig).toHaveBeenCalledWith('ws-1', { enabledMcpTools: null });
    });
});

describe('useWorkspaceMcpConfigController — server toggle racing a tool save', () => {
    it('regression: a tool save that starts after a toggle cannot revert the server list', async () => {
        const put = deferred<any>();
        updateMcpConfig.mockReturnValueOnce(put.promise);
        const { result } = await renderLoaded();

        // Toggle a server off; its write is still in flight.
        act(() => { result.current.toggleServer('github', false); });
        await act(async () => { await Promise.resolve(); });
        expect(result.current.enabledMcpServers).toEqual(['search']);
        expect(updateMcpConfig).toHaveBeenCalledTimes(1);

        // A tool save now overlaps it — the exact interleaving that used to
        // resend the pre-toggle server list.
        act(() => { result.current.saveEnabledMcpTools({ github: ['create_issue'] }); });

        await act(async () => { put.resolve({}); });
        await waitFor(() => expect(updateMcpConfig).toHaveBeenCalledTimes(2));

        // The second request carries no server list whatsoever.
        expect(updateMcpConfig.mock.calls[1][1]).toEqual({
            enabledMcpTools: { github: ['create_issue'] },
        });
        expect(Object.prototype.hasOwnProperty.call(updateMcpConfig.mock.calls[1][1], 'enabledMcpServers')).toBe(false);
        expect(result.current.enabledMcpServers).toEqual(['search']);
    });

    it('serializes overlapping writes — never two policy requests in flight', async () => {
        const first = deferred<any>();
        updateMcpConfig.mockReturnValueOnce(first.promise);
        const { result } = await renderLoaded();

        act(() => { result.current.toggleServer('github', false); });
        await act(async () => { await Promise.resolve(); });
        expect(updateMcpConfig).toHaveBeenCalledTimes(1);

        act(() => { result.current.saveEnabledMcpTools({ github: [] }); });
        // The second write waits for the first to settle.
        await act(async () => { await Promise.resolve(); });
        expect(updateMcpConfig).toHaveBeenCalledTimes(1);

        await act(async () => { first.resolve({}); });
        await waitFor(() => expect(updateMcpConfig).toHaveBeenCalledTimes(2));
    });

    it('coalesces rapid repeated toggles into one write carrying the latest state', async () => {
        const first = deferred<any>();
        updateMcpConfig.mockReturnValueOnce(first.promise);
        const { result } = await renderLoaded();

        act(() => { result.current.toggleServer('github', false); });
        await act(async () => { await Promise.resolve(); });

        // Three more toggles while the first request is in flight.
        act(() => {
            result.current.toggleServer('search', false);
            result.current.toggleServer('search', true);
            result.current.toggleServer('search', false);
        });
        expect(updateMcpConfig).toHaveBeenCalledTimes(1);

        await act(async () => { first.resolve({}); });
        await waitFor(() => expect(updateMcpConfig).toHaveBeenCalledTimes(2));

        // One follow-up write, holding the final value — not one per toggle.
        expect(updateMcpConfig).toHaveBeenCalledTimes(2);
        expect(updateMcpConfig.mock.calls[1][1]).toEqual({ enabledMcpServers: [] });
        expect(result.current.enabledMcpServers).toEqual([]);
    });

    it('reports saving for the whole queued+in-flight window', async () => {
        const put = deferred<any>();
        updateMcpConfig.mockReturnValueOnce(put.promise);
        const { result } = await renderLoaded();

        act(() => { result.current.toggleServer('github', false); });
        expect(result.current.saving).toBe(true);

        await act(async () => { put.resolve({}); });
        await waitFor(() => expect(result.current.saving).toBe(false));
    });
});

describe('useWorkspaceMcpConfigController — failure handling', () => {
    it('rolls back to the last committed policy when nothing newer happened', async () => {
        updateMcpConfig.mockRejectedValueOnce(new Error('Network error'));
        const { result } = await renderLoaded();

        await act(async () => { result.current.toggleServer('github', false); });

        await waitFor(() => expect(result.current.enabledMcpServers).toBeNull());
        expect(result.current.error).toBe('Network error');
    });

    it('regression: an older failed write does not roll back newer state', async () => {
        const first = deferred<any>();
        updateMcpConfig.mockReturnValueOnce(first.promise);
        const { result } = await renderLoaded();

        act(() => { result.current.toggleServer('github', false); });
        await act(async () => { await Promise.resolve(); });

        // The user disables the other server too before the first write fails.
        act(() => { result.current.toggleServer('search', false); });
        expect(result.current.enabledMcpServers).toEqual([]);

        await act(async () => { first.reject(new Error('boom')); });
        await waitFor(() => expect(updateMcpConfig).toHaveBeenCalledTimes(2));

        // Reverting to the pre-toggle list here would re-enable both servers.
        expect(result.current.enabledMcpServers).toEqual([]);
        expect(updateMcpConfig.mock.calls[1][1]).toEqual({ enabledMcpServers: [] });
    });

    it('a failed tool save does not disturb the server list', async () => {
        updateMcpConfig
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(new Error('nope'));
        const { result } = await renderLoaded();

        await act(async () => { result.current.toggleServer('github', false); });
        await act(async () => { result.current.saveEnabledMcpTools({ github: [] }); });

        await waitFor(() => expect(result.current.enabledMcpTools).toBeNull());
        expect(result.current.enabledMcpServers).toEqual(['search']);
    });
});

describe('useWorkspaceMcpConfigController — refresh racing optimistic state', () => {
    it('a reload that resolves after a toggle keeps the newer local policy', async () => {
        const reload = deferred<any>();
        const { result } = await renderLoaded();
        getMcpConfig.mockReturnValueOnce(reload.promise);

        act(() => { result.current.refresh(true); });
        act(() => { result.current.toggleServer('github', false); });

        await act(async () => {
            reload.resolve({
                availableServers: TWO_SERVERS,
                enabledMcpServers: null, // the stale, pre-toggle view
                enabledMcpTools: null,
            });
        });

        expect(result.current.enabledMcpServers).toEqual(['search']);
        // The server catalog, which no local command owns, is still adopted.
        expect(result.current.availableServers).toEqual(TWO_SERVERS);
    });

    it('a reload with no pending mutation adopts the canonical policy', async () => {
        const { result } = await renderLoaded();
        getMcpConfig.mockResolvedValueOnce({
            availableServers: TWO_SERVERS,
            enabledMcpServers: ['github'],
            enabledMcpTools: { github: ['create_issue'] },
        });

        await act(async () => { result.current.refresh(true); });

        expect(result.current.enabledMcpServers).toEqual(['github']);
        expect(result.current.enabledMcpTools).toEqual({ github: ['create_issue'] });
    });
});

describe('useWorkspaceMcpConfigController — multi-repo scoping', () => {
    it('routes every request through the client that owns the workspace', async () => {
        const { result, rerender } = await renderLoaded('ws-local');
        await act(async () => { result.current.toggleServer('github', false); });

        rerender({ id: 'ws-remote' });
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => { result.current.toggleServer('github', false); });

        expect(updateMcpConfig.mock.calls.map(c => c[0])).toEqual(['ws-local', 'ws-remote']);
        expect(resolveClient.mock.calls.map((c: any[]) => c[0])).toContain('ws-remote');
    });

    it('switching workspaces resets policy state instead of leaking the previous repo’s', async () => {
        getMcpConfig
            .mockResolvedValueOnce({
                availableServers: TWO_SERVERS,
                enabledMcpServers: ['github'],
                enabledMcpTools: { github: ['create_issue'] },
            })
            .mockResolvedValueOnce({
                availableServers: [{ name: 'other', type: 'stdio' }],
                enabledMcpServers: null,
                enabledMcpTools: null,
            });
        const { result, rerender } = await renderLoaded('ws-a');
        expect(result.current.enabledMcpServers).toEqual(['github']);

        rerender({ id: 'ws-b' });
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.enabledMcpServers).toBeNull();
        expect(result.current.enabledMcpTools).toBeNull();
        expect(result.current.availableServers).toEqual([{ name: 'other', type: 'stdio' }]);
    });

    it('regression: a write settling after a workspace switch never touches the new workspace', async () => {
        const put = deferred<any>();
        updateMcpConfig.mockReturnValueOnce(put.promise);
        const { result, rerender } = await renderLoaded('ws-a');

        act(() => { result.current.toggleServer('github', false); });
        await act(async () => { await Promise.resolve(); });

        getMcpConfig.mockResolvedValue({
            availableServers: TWO_SERVERS,
            enabledMcpServers: ['github'],
            enabledMcpTools: null,
        });
        rerender({ id: 'ws-b' });
        await waitFor(() => expect(result.current.enabledMcpServers).toEqual(['github']));

        // ws-a's write fails only now — its rollback must not hit ws-b's state.
        await act(async () => { put.reject(new Error('stale')); });

        expect(result.current.enabledMcpServers).toEqual(['github']);
        expect(result.current.error).toBeNull();
    });

    it('regression: a mutation queued under the old workspace is never sent for the new one', async () => {
        const put = deferred<any>();
        updateMcpConfig.mockReturnValueOnce(put.promise);
        const { result, rerender } = await renderLoaded('ws-a');

        act(() => { result.current.toggleServer('github', false); });
        await act(async () => { await Promise.resolve(); });
        // Queue a second write behind the in-flight one, then switch away.
        act(() => { result.current.saveEnabledMcpTools({ github: [] }); });

        rerender({ id: 'ws-b' });
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => { put.resolve({}); });
        await act(async () => { await Promise.resolve(); });

        // Only ws-a's original in-flight write ever went out.
        expect(updateMcpConfig).toHaveBeenCalledTimes(1);
        expect(updateMcpConfig.mock.calls[0][0]).toBe('ws-a');
    });
});
