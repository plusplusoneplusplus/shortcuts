/**
 * MCP Tool Enforcement Unit Tests (AC-04)
 *
 * Verifies the per-repo MCP allow-list resolution used by the dashboard
 * chat/session executors:
 *   - applyMcpAllowList: pure server-level + tool-level allow-list semantics.
 *   - resolveChatMcpServers: effective-config resolution + allow-list.
 *   - resolveChatMcpServersForWorkspace: workspace + per-repo prefs lookup.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { MCPServerConfig, ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { setHomeDirectoryOverride, clearMcpConfigCache } from '@plusplusoneplusplus/forge';
import {
    applyMcpAllowList,
    resolveChatMcpServers,
    resolveChatMcpServersForWorkspace,
} from '../../../src/server/executors/mcp-tool-enforcement';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';

// ----------------------------------------------------------------------------
// applyMcpAllowList (pure)
// ----------------------------------------------------------------------------

describe('applyMcpAllowList', () => {
    const servers: Record<string, MCPServerConfig> = {
        alpha: { command: 'alpha-bin', tools: ['*'] },
        beta: { type: 'http', url: 'https://beta', tools: ['*'] },
    };

    it('returns undefined when no servers are configured', () => {
        expect(applyMcpAllowList({}, null, null)).toBeUndefined();
        expect(applyMcpAllowList({}, ['alpha'], { alpha: ['a'] })).toBeUndefined();
    });

    it('keeps all servers and tools when both allow-lists are absent', () => {
        const result = applyMcpAllowList(servers, null, null);
        expect(Object.keys(result!).sort()).toEqual(['alpha', 'beta']);
        expect(result!.alpha.tools).toEqual(['*']);
        expect(result!.beta.tools).toEqual(['*']);
    });

    it('enables exactly the listed tools (disabled tool absent)', () => {
        const result = applyMcpAllowList(servers, null, { alpha: ['keep_me'] });
        expect(result!.alpha.tools).toEqual(['keep_me']);
        // Server with no entry keeps all tools.
        expect(result!.beta.tools).toEqual(['*']);
    });

    it('treats an empty entry as "all tools disabled" for that server', () => {
        const result = applyMcpAllowList(servers, null, { alpha: [] });
        expect(result!.alpha.tools).toEqual([]);
        expect(result!.beta.tools).toEqual(['*']);
    });

    it('omits a server disabled at the server level', () => {
        const result = applyMcpAllowList(servers, ['beta'], null);
        expect(Object.keys(result!)).toEqual(['beta']);
        expect(result!.alpha).toBeUndefined();
    });

    it('returns an empty map (disable all) when every server is disabled', () => {
        const result = applyMcpAllowList(servers, [], null);
        expect(result).toEqual({});
    });

    it('treats null/undefined enabledMcpServers as all-enabled', () => {
        expect(Object.keys(applyMcpAllowList(servers, null, null)!).sort()).toEqual(['alpha', 'beta']);
        expect(Object.keys(applyMcpAllowList(servers, undefined, null)!).sort()).toEqual(['alpha', 'beta']);
    });

    it('does not mutate the input server configs', () => {
        const input: Record<string, MCPServerConfig> = { alpha: { command: 'alpha-bin', tools: ['*'] } };
        applyMcpAllowList(input, null, { alpha: ['only'] });
        expect(input.alpha.tools).toEqual(['*']);
    });

    it('combines server-level and tool-level filtering', () => {
        const result = applyMcpAllowList(servers, ['alpha'], { alpha: ['x', 'y'] });
        expect(Object.keys(result!)).toEqual(['alpha']);
        expect(result!.alpha.tools).toEqual(['x', 'y']);
    });
});

// ----------------------------------------------------------------------------
// resolveChatMcpServers (effective config + allow-list)
// ----------------------------------------------------------------------------

describe('resolveChatMcpServers', () => {
    let tmpHome: string;
    let tmpWorkspace: string;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-enf-home-'));
        tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-enf-ws-'));
        setHomeDirectoryOverride(tmpHome);
        clearMcpConfigCache();

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
    });

    afterEach(() => {
        setHomeDirectoryOverride(null);
        clearMcpConfigCache();
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    });

    it('returns undefined when no rootPath is supplied', () => {
        expect(resolveChatMcpServers({ rootPath: undefined, enabledMcpServers: null, enabledMcpTools: null }))
            .toBeUndefined();
    });

    it('resolves the effective config and applies the tool allow-list', () => {
        const result = resolveChatMcpServers({
            rootPath: tmpWorkspace,
            enabledMcpServers: null,
            enabledMcpTools: { g1: ['only_this'] },
            forceReload: true,
        });
        expect(Object.keys(result!).sort()).toEqual(['g1', 'g2']);
        expect(result!.g1.tools).toEqual(['only_this']);
        // Loader defaults g2's tools to ['*'] when not specified.
        expect(result!.g2.tools).toEqual(['*']);
    });

    it('drops a server disabled at the server level', () => {
        const result = resolveChatMcpServers({
            rootPath: tmpWorkspace,
            enabledMcpServers: ['g1'],
            enabledMcpTools: null,
            forceReload: true,
        });
        expect(Object.keys(result!)).toEqual(['g1']);
    });
});

// ----------------------------------------------------------------------------
// resolveChatMcpServersForWorkspace (workspace + prefs lookup)
// ----------------------------------------------------------------------------

function makeStoreWithWorkspace(ws: WorkspaceInfo | undefined): ProcessStore {
    return {
        getWorkspaces: async () => (ws ? [ws] : []),
    } as unknown as ProcessStore;
}

describe('resolveChatMcpServersForWorkspace', () => {
    let tmpHome: string;
    let tmpWorkspace: string;
    let tmpData: string;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-enf-home-'));
        tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-enf-ws-'));
        tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-enf-data-'));
        setHomeDirectoryOverride(tmpHome);
        clearMcpConfigCache();

        fs.mkdirSync(path.join(tmpHome, '.copilot'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpHome, '.copilot', 'mcp-config.json'),
            JSON.stringify({
                mcpServers: {
                    srv: { command: 'srv-bin' },
                },
            }),
        );
    });

    afterEach(() => {
        setHomeDirectoryOverride(null);
        clearMcpConfigCache();
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWorkspace, { recursive: true, force: true });
        fs.rmSync(tmpData, { recursive: true, force: true });
    });

    it('returns undefined without a workspaceId', async () => {
        const store = makeStoreWithWorkspace(undefined);
        const result = await resolveChatMcpServersForWorkspace({
            store,
            dataDir: tmpData,
            workspaceId: undefined,
            workingDirectory: tmpWorkspace,
        });
        expect(result).toBeUndefined();
    });

    it('reads enabledMcpTools from per-repo prefs and applies it', async () => {
        const ws: WorkspaceInfo = {
            id: 'ws-1',
            name: 'ws',
            rootPath: tmpWorkspace,
            enabledMcpServers: null,
        } as WorkspaceInfo;
        writeRepoPreferences(tmpData, 'ws-1', { enabledMcpTools: { srv: ['kept_tool'] } });

        const store = makeStoreWithWorkspace(ws);
        const result = await resolveChatMcpServersForWorkspace({
            store,
            dataDir: tmpData,
            workspaceId: 'ws-1',
            workingDirectory: tmpWorkspace,
        });
        expect(result!.srv.tools).toEqual(['kept_tool']);
    });

    it('honors the server-level allow-list from the workspace record', async () => {
        const ws: WorkspaceInfo = {
            id: 'ws-2',
            name: 'ws',
            rootPath: tmpWorkspace,
            enabledMcpServers: [],
        } as WorkspaceInfo;

        const store = makeStoreWithWorkspace(ws);
        const result = await resolveChatMcpServersForWorkspace({
            store,
            dataDir: tmpData,
            workspaceId: 'ws-2',
            workingDirectory: tmpWorkspace,
        });
        // Every server disabled → empty map (disable all MCP servers).
        expect(result).toEqual({});
    });

    it('still resolves via the working directory when the workspace lookup throws', async () => {
        const store = {
            getWorkspaces: async () => { throw new Error('store down'); },
        } as unknown as ProcessStore;
        const result = await resolveChatMcpServersForWorkspace({
            store,
            dataDir: tmpData,
            workspaceId: 'ws-3',
            workingDirectory: tmpWorkspace,
        });
        // Falls back to working-directory resolution; the global config still
        // resolves the configured server with all tools enabled.
        expect(result!.srv.tools).toEqual(['*']);
    });
});
