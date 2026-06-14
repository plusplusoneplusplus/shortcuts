/**
 * MCP Tools Discovery Unit Tests
 *
 * Covers:
 *  - configToTestRequest mapping (stdio/http, invalid)
 *  - resolveEnabledMcpServers (effective merge + enabled allow-list filter)
 *  - discoverMcpToolsForServers (per-server success/error isolation)
 *
 * `listMcpTools` from mcp-connection-tester is mocked so no real processes spawn.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const listMcpToolsMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/server/routes/mcp-connection-tester', async (importActual) => {
    const actual = await importActual<typeof import('../../src/server/routes/mcp-connection-tester')>();
    return { ...actual, listMcpTools: listMcpToolsMock };
});

import {
    configToTestRequest,
    resolveEnabledMcpServers,
    discoverMcpToolsForServers,
    discoverWorkspaceMcpTools,
} from '../../src/server/routes/mcp-tools-discovery';
import { setHomeDirectoryOverride } from '@plusplusoneplusplus/forge';

// ----------------------------------------------------------------------------
// configToTestRequest
// ----------------------------------------------------------------------------

describe('configToTestRequest', () => {
    it('maps a stdio server config to a request', () => {
        const req = configToTestRequest({ type: 'stdio', command: 'node', args: ['server.js'], env: { A: '1' }, tools: ['*'] } as any);
        expect(req).toEqual({ type: 'stdio', command: 'node', args: ['server.js'], env: { A: '1' } });
    });

    it('treats missing type as stdio', () => {
        const req = configToTestRequest({ command: 'mcp-bin' } as any);
        expect(req).toEqual({ type: 'stdio', command: 'mcp-bin' });
    });

    it('maps an http server config (with headers) to a request', () => {
        const req = configToTestRequest({ type: 'http', url: 'http://localhost/mcp', headers: { Authorization: 'Bearer x' } } as any);
        expect(req).toEqual({ type: 'http', url: 'http://localhost/mcp', headers: { Authorization: 'Bearer x' } });
    });

    it('returns null for stdio config without a command', () => {
        expect(configToTestRequest({ type: 'stdio' } as any)).toBeNull();
    });

    it('returns null for http config without a url', () => {
        expect(configToTestRequest({ type: 'http' } as any)).toBeNull();
    });
});

// ----------------------------------------------------------------------------
// resolveEnabledMcpServers
// ----------------------------------------------------------------------------

describe('resolveEnabledMcpServers', () => {
    let tmpHome: string;
    let tmpWorkspace: string;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-home-'));
        tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-ws-'));
        setHomeDirectoryOverride(tmpHome);

        fs.mkdirSync(path.join(tmpHome, '.copilot'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpHome, '.copilot', 'mcp-config.json'),
            JSON.stringify({
                mcpServers: {
                    g1: { command: 'g1-bin' },
                    g2: { command: 'g2-bin' },
                },
            }),
        );

        fs.mkdirSync(path.join(tmpWorkspace, '.vscode'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpWorkspace, '.vscode', 'mcp.json'),
            JSON.stringify({
                servers: {
                    w1: { command: 'w1-bin', args: ['--flag'] },
                },
            }),
        );
    });

    afterEach(() => {
        setHomeDirectoryOverride(null);
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    });

    it('returns all servers when enabled list is null', () => {
        const resolved = resolveEnabledMcpServers(tmpWorkspace, null, true);
        expect(Object.keys(resolved).sort()).toEqual(['g1', 'g2', 'w1']);
        expect(resolved.w1).toEqual({ type: 'stdio', command: 'w1-bin', args: ['--flag'] });
    });

    it('filters by the enabled allow-list', () => {
        const resolved = resolveEnabledMcpServers(tmpWorkspace, ['g1', 'w1'], true);
        expect(Object.keys(resolved).sort()).toEqual(['g1', 'w1']);
        expect(resolved.g2).toBeUndefined();
    });

    it('returns an empty map when nothing is enabled', () => {
        const resolved = resolveEnabledMcpServers(tmpWorkspace, [], true);
        expect(resolved).toEqual({});
    });
});

// ----------------------------------------------------------------------------
// discoverMcpToolsForServers (per-server isolation)
// ----------------------------------------------------------------------------

describe('discoverMcpToolsForServers', () => {
    beforeEach(() => {
        listMcpToolsMock.mockReset();
    });

    it('returns ok for a reachable server and an error entry for an unreachable one', async () => {
        listMcpToolsMock.mockImplementation(async (req: { command?: string }) => {
            if (req.command === 'good') {
                return { success: true, message: 'ok', tools: [{ name: 't1' }], serverName: 'good-srv' };
            }
            return { success: false, message: 'connection refused', tools: [] };
        });

        const results = await discoverMcpToolsForServers({
            alpha: { type: 'stdio', command: 'good' },
            beta: { type: 'stdio', command: 'bad' },
        });

        expect(results.alpha).toEqual({ status: 'ok', tools: [{ name: 't1' }], serverName: 'good-srv' });
        expect(results.beta).toEqual({ status: 'error', tools: [], error: 'connection refused' });
    });

    it('isolates a thrown error to a single server', async () => {
        listMcpToolsMock.mockImplementation(async (req: { command?: string }) => {
            if (req.command === 'boom') throw new Error('kaboom');
            return { success: true, message: 'ok', tools: [], serverName: 'ok-srv' };
        });

        const results = await discoverMcpToolsForServers({
            ok: { type: 'stdio', command: 'fine' },
            broken: { type: 'stdio', command: 'boom' },
        });

        expect(results.ok.status).toBe('ok');
        expect(results.broken).toEqual({ status: 'error', tools: [], error: 'kaboom' });
    });

    it('returns an empty map for no servers', async () => {
        const results = await discoverMcpToolsForServers({});
        expect(results).toEqual({});
        expect(listMcpToolsMock).not.toHaveBeenCalled();
    });

    it('passes the per-server timeout through to listMcpTools', async () => {
        listMcpToolsMock.mockResolvedValue({ success: true, message: 'ok', tools: [] });
        await discoverMcpToolsForServers({ a: { type: 'stdio', command: 'x' } }, { timeoutMs: 1234 });
        expect(listMcpToolsMock).toHaveBeenCalledWith({ type: 'stdio', command: 'x' }, 1234);
    });
});

// ----------------------------------------------------------------------------
// discoverWorkspaceMcpTools (composition)
// ----------------------------------------------------------------------------

describe('discoverWorkspaceMcpTools', () => {
    let tmpHome: string;
    let tmpWorkspace: string;

    beforeEach(() => {
        listMcpToolsMock.mockReset();
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-home-'));
        tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-ws-'));
        setHomeDirectoryOverride(tmpHome);
        fs.mkdirSync(path.join(tmpHome, '.copilot'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpHome, '.copilot', 'mcp-config.json'),
            JSON.stringify({ mcpServers: { g1: { command: 'g1-bin' }, g2: { command: 'g2-bin' } } }),
        );
    });

    afterEach(() => {
        setHomeDirectoryOverride(null);
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    });

    it('discovers only enabled servers and keys results by server name', async () => {
        listMcpToolsMock.mockResolvedValue({ success: true, message: 'ok', tools: [{ name: 'tool' }] });
        const results = await discoverWorkspaceMcpTools(tmpWorkspace, ['g1'], { forceReload: true });
        expect(Object.keys(results)).toEqual(['g1']);
        expect(results.g1.status).toBe('ok');
        expect(results.g1.tools).toEqual([{ name: 'tool' }]);
    });
});
