/**
 * @vitest-environment jsdom
 *
 * Regression tests: the MCP server inspector must talk to the server that OWNS
 * the workspace, not the local origin.
 *
 * Bug: the controller issued every MCP call through the bare `getSpaCocClient()`.
 * The seven `/workspaces/:id/mcp-config*` routes are workspace-guarded and read
 * the host machine's disk via `ws.rootPath`, so for a REMOTE clone they 404'd
 * ("Workspace not found") on the local server — the panel rendered remote data
 * fetched by its routed parent while every interaction hit the wrong machine.
 * The OAuth start route is neither workspace-scoped nor guarded, so it did not
 * 404; it silently resolved to no workspace root and stored the token in the
 * LOCAL credential store.
 *
 * Fix: `getCocClientForWorkspace(workspaceId)` for the REST calls and
 * `cloneApiBase(startedWs)` for the raw OAuth fetch + the status poller.
 *
 * These tests register a remote baseUrl via `registerCloneBaseUrls`, spy `fetch`,
 * and assert every URL carries that base; a local (unregistered) workspace keeps
 * using the relative local origin — byte-for-byte unchanged.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { useMcpServerInspectorController } from '../../../../../src/server/spa/client/react/features/skills/useMcpServerInspectorController';
import { McpOAuthFlowController } from '../../../../../src/server/spa/client/react/features/skills/mcpOAuthFlowController';
import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../../../src/server/spa/client/react/repos/cloneRegistry';

const REMOTE_WS = 'ws-remote-1';
const REMOTE_BASE = 'http://127.0.0.1:4011';
const LOCAL_WS = 'ws-local-1';

function jsonResponse(data: unknown): Partial<Response> {
    return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => data,
        text: async () => JSON.stringify(data),
    };
}

let urls: string[];
let startPolling: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    resetCloneRegistryForTests();
    urls = [];
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
        const url = String(input);
        urls.push(url);
        if (url.includes('/mcp-oauth/start')) {
            return Promise.resolve(jsonResponse({ requestId: 'r1', authorizationUrl: 'https://auth.example' }));
        }
        // Every MCP config read/write returns a shape loose enough for all of them.
        return Promise.resolve(jsonResponse({ servers: {}, name: 'srv', rawJson: {}, envKeys: [], args: [] }));
    }));
    vi.spyOn(window, 'open').mockReturnValue(null);
    // Stub the interval poller so no background timer survives; the spy also lets
    // us assert which apiBase the poll would target.
    startPolling = vi.spyOn(McpOAuthFlowController.prototype, 'startPolling').mockImplementation(() => {});
});

afterEach(() => {
    cleanup();
    resetCloneRegistryForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function mcpUrls(wsId: string): string[] {
    return urls.filter(u => u.includes(`/workspaces/${wsId}/mcp-config`));
}

describe('MCP server inspector — remote-clone request routing', () => {
    it('regression: discovers tools from the remote clone server, never the local one', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        const { result } = renderHook(() => useMcpServerInspectorController(REMOTE_WS, {}));
        await waitFor(() => expect(result.current.discoveryState).toBe('loaded'));

        const toolsUrl = urls.find(u => u.includes(`/workspaces/${REMOTE_WS}/mcp-config/tools`));
        expect(toolsUrl).toBeTruthy();
        expect(toolsUrl!.startsWith(REMOTE_BASE)).toBe(true);
    });

    it('discovers tools for a local (unregistered) workspace from the local origin', async () => {
        const { result } = renderHook(() => useMcpServerInspectorController(LOCAL_WS, {}));
        await waitFor(() => expect(result.current.discoveryState).toBe('loaded'));

        const toolsUrl = urls.find(u => u.includes(`/workspaces/${LOCAL_WS}/mcp-config/tools`));
        expect(toolsUrl).toBeTruthy();
        expect(toolsUrl!.startsWith(REMOTE_BASE)).toBe(false);
        expect(toolsUrl!.startsWith('http')).toBe(false); // relative to the page origin
    });

    it('regression: server detail is read from the remote clone server', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        const { result } = renderHook(() => useMcpServerInspectorController(REMOTE_WS, {}));
        await waitFor(() => expect(result.current.discoveryState).toBe('loaded'));

        act(() => { result.current.toggleExpand('github'); });
        await waitFor(() => expect(result.current.getDetail('github')).not.toBe('loading'));

        const detailUrl = urls.find(u => u.includes('/mcp-config/github/detail'));
        expect(detailUrl).toBeTruthy();
        expect(detailUrl!.startsWith(REMOTE_BASE)).toBe(true);
    });

    it('regression: add / update / migrate / delete and the tools allow-list all target the remote clone', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        const { result } = renderHook(() => useMcpServerInspectorController(REMOTE_WS, { enabledMcpServers: ['github'] }));
        await waitFor(() => expect(result.current.discoveryState).toBe('loaded'));

        await act(async () => { await result.current.addServer({ name: 'srv', type: 'stdio', scope: 'workspace' }); });
        await act(async () => { await result.current.updateServer('srv', { args: ['--flag'] }); });
        await act(async () => { await result.current.migrateServer('srv', 'global'); });
        await act(async () => { await result.current.deleteServer('srv'); });
        await act(async () => {
            result.current.enableAllTools('github');
            await new Promise(r => setTimeout(r, 0));
        });

        // Each mutation is present and every mcp-config call went to the owner.
        expect(urls.some(u => u.endsWith(`/workspaces/${REMOTE_WS}/mcp-config`))).toBe(true); // add + allow-list PUT
        expect(urls.some(u => u.includes('/mcp-config/srv/migrate'))).toBe(true);
        expect(urls.some(u => u.endsWith('/mcp-config/srv'))).toBe(true); // update + delete
        const scoped = mcpUrls(REMOTE_WS);
        expect(scoped.length).toBeGreaterThan(4);
        for (const u of scoped) {
            expect(u.startsWith(REMOTE_BASE)).toBe(true);
        }
    });

    it('mutations for a local workspace keep using the local origin', async () => {
        const { result } = renderHook(() => useMcpServerInspectorController(LOCAL_WS, {}));
        await waitFor(() => expect(result.current.discoveryState).toBe('loaded'));

        await act(async () => { await result.current.addServer({ name: 'srv', type: 'stdio', scope: 'workspace' }); });

        const scoped = mcpUrls(LOCAL_WS);
        expect(scoped.length).toBeGreaterThan(0);
        for (const u of scoped) {
            expect(u.startsWith('http')).toBe(false);
        }
    });

    it('regression: the OAuth start call and the status poller both target the remote clone', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        const { result } = renderHook(() => useMcpServerInspectorController(REMOTE_WS, {}));
        await act(async () => { result.current.authenticate('srv'); await new Promise(r => setTimeout(r, 0)); });

        expect(result.current.authFlow.srv?.phase).toBe('authorizing');

        const startUrl = urls.find(u => u.includes('/mcp-oauth/start'));
        expect(startUrl).toBeTruthy();
        expect(startUrl!.startsWith(REMOTE_BASE)).toBe(true);

        expect(startPolling).toHaveBeenCalledTimes(1);
        const pollOptions = startPolling.mock.calls[0][0] as { apiBase: string };
        expect(pollOptions.apiBase.startsWith(REMOTE_BASE)).toBe(true);
    });

    it('the OAuth flow for a local workspace keeps using the local origin', async () => {
        const { result } = renderHook(() => useMcpServerInspectorController(LOCAL_WS, {}));
        await act(async () => { result.current.authenticate('srv'); await new Promise(r => setTimeout(r, 0)); });

        const startUrl = urls.find(u => u.includes('/mcp-oauth/start'));
        expect(startUrl).toBeTruthy();
        expect(startUrl!.startsWith('http')).toBe(false);

        const pollOptions = startPolling.mock.calls[0][0] as { apiBase: string };
        expect(pollOptions.apiBase.startsWith('http')).toBe(false);
    });
});
