/**
 * Tests for the workspace-scoped MCP inspector controller hook.
 *
 * Focus: switching workspaces never reuses another repo's detail, discovery,
 * allow-list, or OAuth state; async results that resolve after a switch are
 * dropped; mutations hit the REST client with the expected payloads.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import type { McpServerToolsResult } from '@plusplusoneplusplus/coc-client';
import { useMcpServerInspectorController } from '../../../../../src/server/spa/client/react/features/skills/useMcpServerInspectorController';
import { McpOAuthFlowController } from '../../../../../src/server/spa/client/react/features/skills/mcpOAuthFlowController';

const discoverMcpTools = vi.hoisted(() => vi.fn());
const updateMcpConfig = vi.hoisted(() => vi.fn());
const getMcpServerDetail = vi.hoisted(() => vi.fn());
const addMcpServer = vi.hoisted(() => vi.fn());
const deleteMcpServer = vi.hoisted(() => vi.fn());
const migrateMcpServer = vi.hoisted(() => vi.fn());
const updateMcpServer = vi.hoisted(() => vi.fn());

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        workspaces: {
            discoverMcpTools: (...a: unknown[]) => discoverMcpTools(...a),
            updateMcpConfig: (...a: unknown[]) => updateMcpConfig(...a),
            getMcpServerDetail: (...a: unknown[]) => getMcpServerDetail(...a),
            addMcpServer: (...a: unknown[]) => addMcpServer(...a),
            deleteMcpServer: (...a: unknown[]) => deleteMcpServer(...a),
            migrateMcpServer: (...a: unknown[]) => migrateMcpServer(...a),
            updateMcpServer: (...a: unknown[]) => updateMcpServer(...a),
        },
    }),
    getSpaCocClientErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

const okResult: McpServerToolsResult = { status: 'ok', tools: [{ name: 'a' }, { name: 'b' }] };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    discoverMcpTools.mockResolvedValue({ servers: {} });
    updateMcpConfig.mockResolvedValue({ workspace: {} });
    getMcpServerDetail.mockResolvedValue({ description: 'd', envKeys: [], args: [], toolScope: 'all', source: 'workspace', rawJson: {} });
    addMcpServer.mockResolvedValue({ name: 'x', scope: 'workspace' });
    deleteMcpServer.mockResolvedValue({ name: 'x', deleted: true });
    migrateMcpServer.mockResolvedValue({ name: 'x', scope: 'global' });
    updateMcpServer.mockResolvedValue({ name: 'x', updated: true });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'open').mockReturnValue(null);
    // Stub the real interval-based poller so no background timer survives the
    // test. Poll completion/failure/timeout is covered by the controller's own
    // unit test (mcpOAuthFlowController.test.ts).
    vi.spyOn(McpOAuthFlowController.prototype, 'startPolling').mockImplementation(() => {});
});

afterEach(() => {
    cleanup(); // unmount hooks so the controller tears down any OAuth pollers
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('useMcpServerInspectorController — discovery', () => {
    it('eagerly discovers tools for the workspace on mount', async () => {
        discoverMcpTools.mockResolvedValue({ servers: { github: okResult } });
        const { result } = renderHook(() => useMcpServerInspectorController('ws-1', {}));
        await waitFor(() => expect(result.current.discovery.github?.status).toBe('ok'));
        expect(discoverMcpTools).toHaveBeenCalledWith('ws-1', undefined);
        expect(result.current.discoveryState).toBe('loaded');
    });

    it('does not call the client without a workspace id', async () => {
        renderHook(() => useMcpServerInspectorController('', {}));
        await act(async () => { await Promise.resolve(); });
        expect(discoverMcpTools).not.toHaveBeenCalled();
    });
});

describe('useMcpServerInspectorController — workspace isolation', () => {
    it('resets detail, discovery, allow-list and expanded row on workspace switch', async () => {
        discoverMcpTools.mockImplementation((ws: string) =>
            Promise.resolve({ servers: ws === 'ws-1' ? { github: okResult } : {} }));
        getMcpServerDetail.mockImplementation((ws: string, name: string) =>
            Promise.resolve({ description: `${ws}:${name}`, envKeys: [], args: [], toolScope: 'all', source: 'workspace', rawJson: {} }));

        const { result, rerender } = renderHook(
            ({ ws, tools }) => useMcpServerInspectorController(ws, { enabledMcpTools: tools }),
            { initialProps: { ws: 'ws-1', tools: { github: ['a'] } as Record<string, string[]> } },
        );

        await waitFor(() => expect(result.current.discovery.github?.status).toBe('ok'));
        expect(result.current.toolsAllowList).toEqual({ github: ['a'] });

        // Load ws-1 detail for a server named "github".
        act(() => { result.current.toggleExpand('github'); });
        await waitFor(() => expect(result.current.getDetail('github')).toMatchObject({ description: 'ws-1:github' }));
        expect(result.current.expandedServer).toBe('github');

        // Switch to ws-2, which also has a server named "github" but different config.
        rerender({ ws: 'ws-2', tools: {} });

        // Prior workspace state is discarded synchronously on switch.
        expect(result.current.getDetail('github')).toBeNull();
        expect(result.current.expandedServer).toBeNull();
        expect(result.current.toolsAllowList).toEqual({});

        await waitFor(() => expect(result.current.discoveryState).toBe('loaded'));
        // ws-2 has no github discovery — the ws-1 result is never reused.
        expect(result.current.discovery.github).toBeUndefined();
        expect(discoverMcpTools).toHaveBeenCalledWith('ws-2', undefined);
    });

    it('drops a discovery result that resolves after the workspace switched', async () => {
        let resolveWs1: (v: unknown) => void = () => {};
        discoverMcpTools.mockImplementation((ws: string) => {
            if (ws === 'ws-1') return new Promise(res => { resolveWs1 = res; });
            return Promise.resolve({ servers: {} });
        });

        const { result, rerender } = renderHook(
            ({ ws }) => useMcpServerInspectorController(ws, {}),
            { initialProps: { ws: 'ws-1' } },
        );

        rerender({ ws: 'ws-2' });
        await waitFor(() => expect(result.current.discoveryState).toBe('loaded'));

        // The slow ws-1 discovery lands now — it must be ignored.
        await act(async () => { resolveWs1({ servers: { stale: okResult } }); await Promise.resolve(); });
        expect(result.current.discovery.stale).toBeUndefined();
    });

    it('clears the OAuth flow state on workspace switch', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ requestId: 'r1', authorizationUrl: 'https://auth' }) });
        const { result, rerender } = renderHook(
            ({ ws }) => useMcpServerInspectorController(ws, {}),
            { initialProps: { ws: 'ws-1' } },
        );
        await act(async () => { result.current.authenticate('srv'); await new Promise(r => setTimeout(r, 0)); });
        expect(result.current.authFlow.srv?.phase).toBe('authorizing');

        rerender({ ws: 'ws-2' });
        expect(result.current.authFlow).toEqual({});
    });
});

describe('useMcpServerInspectorController — OAuth', () => {
    it('starts a flow, opens the auth url and enters the authorizing phase', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ requestId: 'r1', authorizationUrl: 'https://auth.example' }) });
        const { result } = renderHook(() => useMcpServerInspectorController('ws-1', {}));

        await act(async () => { result.current.authenticate('srv'); await new Promise(r => setTimeout(r, 0)); });

        expect(result.current.authFlow.srv?.phase).toBe('authorizing');
        expect(window.open).toHaveBeenCalledWith('https://auth.example', '_blank', 'noopener,noreferrer');
        const startCall = fetchMock.mock.calls.find(c => String(c[0]).includes('/mcp-oauth/start'));
        expect(startCall).toBeTruthy();
        expect(JSON.parse((startCall![1] as { body: string }).body)).toEqual({ serverName: 'srv', workspaceId: 'ws-1' });
    });

    it('marks the flow completed immediately when already authenticated', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ alreadyAuthenticated: true }) });
        const onRefresh = vi.fn();
        const { result } = renderHook(() => useMcpServerInspectorController('ws-1', { onRefresh }));
        await act(async () => { result.current.authenticate('srv'); await new Promise(r => setTimeout(r, 0)); });
        expect(result.current.authFlow.srv?.phase).toBe('completed');
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('marks the flow failed when the start request is rejected', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'server error' });
        const { result } = renderHook(() => useMcpServerInspectorController('ws-1', {}));
        await act(async () => { result.current.authenticate('srv'); await new Promise(r => setTimeout(r, 0)); });
        expect(result.current.authFlow.srv?.phase).toBe('failed');
    });
});

describe('useMcpServerInspectorController — mutations', () => {
    it('addServer calls the client and refreshes the parent', async () => {
        const onMutate = vi.fn();
        const onRefresh = vi.fn();
        const { result } = renderHook(() => useMcpServerInspectorController('ws-1', { onMutate, onRefresh }));
        await act(async () => { await result.current.addServer({ name: 'x', type: 'stdio', scope: 'workspace' }); });
        expect(addMcpServer).toHaveBeenCalledWith('ws-1', { name: 'x', type: 'stdio', scope: 'workspace' });
        expect(onMutate).toHaveBeenCalledTimes(1);
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('deleteServer removes the server, collapses the row and refreshes', async () => {
        getMcpServerDetail.mockResolvedValue({ description: 'd', envKeys: [], args: [], toolScope: 'all', source: 'workspace', rawJson: {} });
        const onMutate = vi.fn();
        const onRefresh = vi.fn();
        const { result } = renderHook(() => useMcpServerInspectorController('ws-1', { onMutate, onRefresh }));
        act(() => { result.current.toggleExpand('srv'); });
        await waitFor(() => expect(result.current.expandedServer).toBe('srv'));

        await act(async () => { await result.current.deleteServer('srv'); });
        expect(deleteMcpServer).toHaveBeenCalledWith('ws-1', 'srv');
        expect(result.current.expandedServer).toBeNull();
        expect(onMutate).toHaveBeenCalledTimes(1);
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('updateServer and migrateServer invalidate the cached detail', async () => {
        const { result } = renderHook(() => useMcpServerInspectorController('ws-1', {}));
        act(() => { result.current.toggleExpand('srv'); });
        await waitFor(() => expect(result.current.getDetail('srv')).toMatchObject({ description: 'd' }));

        await act(async () => { await result.current.updateServer('srv', { args: ['--flag'] }); });
        expect(updateMcpServer).toHaveBeenCalledWith('ws-1', 'srv', { args: ['--flag'] });
        expect(result.current.getDetail('srv')).toBeNull(); // invalidated

        act(() => { result.current.toggleExpand('srv'); }); // collapse
        act(() => { result.current.toggleExpand('srv'); }); // re-open → re-fetch
        await waitFor(() => expect(result.current.getDetail('srv')).toMatchObject({ description: 'd' }));

        await act(async () => { await result.current.migrateServer('srv', 'global'); });
        expect(migrateMcpServer).toHaveBeenCalledWith('ws-1', 'srv', 'global');
        expect(result.current.getDetail('srv')).toBeNull();
    });
});

describe('useMcpServerInspectorController — allow-list', () => {
    it('persists a tool toggle-off through updateMcpConfig, preserving enabledMcpServers', async () => {
        discoverMcpTools.mockResolvedValue({ servers: { github: okResult } });
        const { result } = renderHook(() => useMcpServerInspectorController('ws-1', { enabledMcpServers: ['github'] }));
        await waitFor(() => expect(result.current.discovery.github?.status).toBe('ok'));

        await act(async () => { result.current.toggleTool('github', 'a', false); await new Promise(r => setTimeout(r, 0)); });
        expect(updateMcpConfig).toHaveBeenCalledWith('ws-1', {
            enabledMcpServers: ['github'],
            enabledMcpTools: { github: ['b'] },
        });
    });

    it('reverts the optimistic allow-list when the save fails', async () => {
        discoverMcpTools.mockResolvedValue({ servers: { github: okResult } });
        updateMcpConfig.mockImplementationOnce(async () => { throw new Error('boom'); });
        // Omit enabledMcpTools (a stable `undefined`) so the allow-list sync effect
        // is not re-triggered by a fresh object identity on every render.
        const { result } = renderHook(() => useMcpServerInspectorController('ws-1', {}));
        await waitFor(() => expect(result.current.discovery.github?.status).toBe('ok'));

        act(() => { result.current.toggleTool('github', 'a', false); });
        await waitFor(() => expect(result.current.toolsAllowList).toEqual({ github: ['b'] })); // optimistic
        await waitFor(() => expect(result.current.toolsAllowList).toEqual({})); // reverted after failure
    });
});
