/**
 * Unit tests for mcp-config-writer.ts
 *
 * Uses a temporary directory to exercise real file read/write operations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock forge so getMcpConfigPath and getWorkspaceMcpConfigPath return paths inside our temp dir
const mockGetMcpConfigPath = vi.hoisted(() => vi.fn<[], string>());
const mockGetWorkspaceMcpConfigPath = vi.hoisted(() => vi.fn<[string], string>());

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        getMcpConfigPath: mockGetMcpConfigPath,
        getWorkspaceMcpConfigPath: mockGetWorkspaceMcpConfigPath,
    };
});

import {
    loadDefaultMcpConfig,
    loadWorkspaceMcpConfig,
    setHomeDirectoryOverride,
    clearMcpConfigCache,
} from '@plusplusoneplusplus/forge';

import {
    readRawGlobalConfig,
    writeRawGlobalConfig,
    readRawWorkspaceConfig,
    writeRawWorkspaceConfig,
    findServerSource,
    getServerDetail,
    updateServerConfig,
    deleteServerFromConfig,
    addServerToConfig,
    migrateServerScope,
    readAllDescriptions,
} from '../../src/server/routes/mcp-config-writer';

// ============================================================================
// Setup
// ============================================================================

let tmpDir: string;
let globalConfigPath: string;
let workspaceRoot: string;
let workspaceConfigPath: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-writer-test-'));
    const globalDir = path.join(tmpDir, '.copilot');
    fs.mkdirSync(globalDir, { recursive: true });
    globalConfigPath = path.join(globalDir, 'mcp-config.json');

    workspaceRoot = path.join(tmpDir, 'workspace');
    fs.mkdirSync(path.join(workspaceRoot, '.vscode'), { recursive: true });
    workspaceConfigPath = path.join(workspaceRoot, '.vscode', 'mcp.json');

    mockGetMcpConfigPath.mockReturnValue(globalConfigPath);
    mockGetWorkspaceMcpConfigPath.mockImplementation((_root: string) => workspaceConfigPath);
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeGlobal(data: Record<string, unknown>) {
    fs.writeFileSync(globalConfigPath, JSON.stringify(data), 'utf-8');
}
function writeWorkspace(data: Record<string, unknown>) {
    fs.writeFileSync(workspaceConfigPath, JSON.stringify(data), 'utf-8');
}

// ============================================================================
// readRawGlobalConfig / readRawWorkspaceConfig
// ============================================================================

describe('readRawGlobalConfig', () => {
    it('returns { mcpServers: {} } when file does not exist', () => {
        const result = readRawGlobalConfig();
        expect(result).toEqual({ mcpServers: {} });
    });

    it('returns parsed JSON when file exists', () => {
        writeGlobal({ mcpServers: { github: { command: 'npx' } } });
        const result = readRawGlobalConfig();
        expect(result).toMatchObject({ mcpServers: { github: { command: 'npx' } } });
    });

    it('returns { mcpServers: {} } when file contains invalid JSON', () => {
        fs.writeFileSync(globalConfigPath, '{ bad json', 'utf-8');
        const result = readRawGlobalConfig();
        expect(result).toEqual({ mcpServers: {} });
    });
});

describe('readRawWorkspaceConfig', () => {
    it('returns { servers: {} } when file does not exist', () => {
        const result = readRawWorkspaceConfig(workspaceRoot);
        expect(result).toEqual({ servers: {} });
    });

    it('returns parsed JSON when file exists', () => {
        writeWorkspace({ servers: { local: { command: 'node', args: ['server.js'] } } });
        const result = readRawWorkspaceConfig(workspaceRoot);
        expect(result).toMatchObject({ servers: { local: { command: 'node' } } });
    });

    it('preserves extra fields like description and toolScope', () => {
        writeWorkspace({
            servers: {
                myserver: { command: 'npx', description: 'My server', toolScope: 'readonly' },
            },
        });
        const result = readRawWorkspaceConfig(workspaceRoot);
        const entry = (result.servers as any).myserver;
        expect(entry.description).toBe('My server');
        expect(entry.toolScope).toBe('readonly');
    });
});

// ============================================================================
// writeRawGlobalConfig / writeRawWorkspaceConfig
// ============================================================================

describe('writeRawGlobalConfig', () => {
    it('writes JSON to the global config path', async () => {
        await writeRawGlobalConfig({ mcpServers: { test: { command: 'node' } } });
        const content = fs.readFileSync(globalConfigPath, 'utf-8');
        const parsed = JSON.parse(content);
        expect(parsed.mcpServers.test.command).toBe('node');
    });

    it('creates parent directories if they do not exist', async () => {
        const deepPath = path.join(tmpDir, 'deep', 'nested', 'mcp-config.json');
        mockGetMcpConfigPath.mockReturnValue(deepPath);
        await writeRawGlobalConfig({ mcpServers: {} });
        expect(fs.existsSync(deepPath)).toBe(true);
    });
});

describe('writeRawWorkspaceConfig', () => {
    it('writes JSON to the workspace config path', async () => {
        await writeRawWorkspaceConfig(workspaceRoot, { servers: { test: { command: 'node' } } });
        const content = fs.readFileSync(workspaceConfigPath, 'utf-8');
        const parsed = JSON.parse(content);
        expect(parsed.servers.test.command).toBe('node');
    });
});

// ============================================================================
// findServerSource
// ============================================================================

describe('findServerSource', () => {
    it('returns null when server not in either config', () => {
        const result = findServerSource('missing', workspaceRoot);
        expect(result).toBeNull();
    });

    it('finds server in global config', () => {
        writeGlobal({ mcpServers: { github: { command: 'npx' } } });
        const result = findServerSource('github', workspaceRoot);
        expect(result).not.toBeNull();
        expect(result!.source).toBe('global');
        expect((result!.rawEntry as any).command).toBe('npx');
    });

    it('finds server in workspace config', () => {
        writeWorkspace({ servers: { local: { command: 'node' } } });
        const result = findServerSource('local', workspaceRoot);
        expect(result).not.toBeNull();
        expect(result!.source).toBe('workspace');
    });

    it('prefers workspace over global when same name in both', () => {
        writeGlobal({ mcpServers: { shared: { command: 'global-cmd' } } });
        writeWorkspace({ servers: { shared: { command: 'workspace-cmd' } } });
        const result = findServerSource('shared', workspaceRoot);
        expect(result!.source).toBe('workspace');
        expect((result!.rawEntry as any).command).toBe('workspace-cmd');
    });
});

// ============================================================================
// getServerDetail
// ============================================================================

describe('getServerDetail', () => {
    it('returns null when server not found', () => {
        const result = getServerDetail('missing', workspaceRoot);
        expect(result).toBeNull();
    });

    it('returns detail for global server', () => {
        writeGlobal({
            mcpServers: {
                github: {
                    command: 'npx',
                    args: ['-y', '@modelcontextprotocol/server-github'],
                    env: { GITHUB_TOKEN: 'secret' },
                    description: 'GitHub MCP',
                    toolScope: 'readonly',
                },
            },
        });
        const result = getServerDetail('github', workspaceRoot);
        expect(result).not.toBeNull();
        expect(result!.description).toBe('GitHub MCP');
        expect(result!.envKeys).toEqual(['GITHUB_TOKEN']);
        expect(result!.args).toEqual(['-y', '@modelcontextprotocol/server-github']);
        expect(result!.toolScope).toBe('readonly');
        expect(result!.source).toBe('global');
        // env values should NOT be in envKeys (only keys are exposed)
        expect(result!.rawJson).toMatchObject({ command: 'npx' });
    });

    it('defaults toolScope to "all" when not specified', () => {
        writeGlobal({ mcpServers: { server: { command: 'cmd' } } });
        const result = getServerDetail('server', workspaceRoot);
        expect(result!.toolScope).toBe('all');
    });

    it('defaults description to empty string when not specified', () => {
        writeGlobal({ mcpServers: { server: { command: 'cmd' } } });
        const result = getServerDetail('server', workspaceRoot);
        expect(result!.description).toBe('');
    });

    it('returns empty envKeys when no env field', () => {
        writeGlobal({ mcpServers: { server: { command: 'cmd' } } });
        const result = getServerDetail('server', workspaceRoot);
        expect(result!.envKeys).toEqual([]);
    });

    it('returns empty args when no args field', () => {
        writeGlobal({ mcpServers: { server: { command: 'cmd' } } });
        const result = getServerDetail('server', workspaceRoot);
        expect(result!.args).toEqual([]);
    });
});

// ============================================================================
// updateServerConfig
// ============================================================================

describe('updateServerConfig', () => {
    it('returns false when server not found', async () => {
        const result = await updateServerConfig('missing', workspaceRoot, { description: 'new' });
        expect(result).toBe(false);
    });

    it('updates description in global config', async () => {
        writeGlobal({ mcpServers: { github: { command: 'npx' } } });
        const result = await updateServerConfig('github', workspaceRoot, { description: 'Updated' });
        expect(result).toBe(true);
        const config = readRawGlobalConfig();
        expect((config.mcpServers as any).github.description).toBe('Updated');
    });

    it('updates description in workspace config', async () => {
        writeWorkspace({ servers: { local: { command: 'node' } } });
        const result = await updateServerConfig('local', workspaceRoot, { description: 'Local server' });
        expect(result).toBe(true);
        const config = readRawWorkspaceConfig(workspaceRoot);
        expect((config.servers as any).local.description).toBe('Local server');
    });

    it('updates args', async () => {
        writeGlobal({ mcpServers: { server: { command: 'npx', args: ['old-arg'] } } });
        await updateServerConfig('server', workspaceRoot, { args: ['new-arg', '--flag'] });
        const config = readRawGlobalConfig();
        expect((config.mcpServers as any).server.args).toEqual(['new-arg', '--flag']);
    });

    it('merges new env vars with existing ones', async () => {
        writeGlobal({ mcpServers: { server: { command: 'npx', env: { OLD_KEY: 'old-val' } } } });
        await updateServerConfig('server', workspaceRoot, { env: { NEW_KEY: 'new-val' } });
        const config = readRawGlobalConfig();
        const env = (config.mcpServers as any).server.env;
        expect(env.OLD_KEY).toBe('old-val');
        expect(env.NEW_KEY).toBe('new-val');
    });

    it('updates toolScope', async () => {
        writeGlobal({ mcpServers: { server: { command: 'npx' } } });
        await updateServerConfig('server', workspaceRoot, { toolScope: 'allowlist' });
        const config = readRawGlobalConfig();
        expect((config.mcpServers as any).server.toolScope).toBe('allowlist');
    });

    it('only updates provided fields and leaves others intact', async () => {
        writeGlobal({ mcpServers: { server: { command: 'npx', args: ['a'], description: 'orig' } } });
        await updateServerConfig('server', workspaceRoot, { description: 'new desc' });
        const config = readRawGlobalConfig();
        const entry = (config.mcpServers as any).server;
        expect(entry.description).toBe('new desc');
        expect(entry.args).toEqual(['a']); // unchanged
        expect(entry.command).toBe('npx'); // unchanged
    });
});

// ============================================================================
// deleteServerFromConfig
// ============================================================================

describe('deleteServerFromConfig', () => {
    it('returns false when server not found', async () => {
        const result = await deleteServerFromConfig('missing', workspaceRoot);
        expect(result).toBe(false);
    });

    it('removes server from global config', async () => {
        writeGlobal({ mcpServers: { github: { command: 'npx' }, other: { command: 'other' } } });
        const result = await deleteServerFromConfig('github', workspaceRoot);
        expect(result).toBe(true);
        const config = readRawGlobalConfig();
        expect((config.mcpServers as any).github).toBeUndefined();
        expect((config.mcpServers as any).other).toBeDefined();
    });

    it('removes server from workspace config', async () => {
        writeWorkspace({ servers: { local: { command: 'node' }, other: { command: 'other' } } });
        const result = await deleteServerFromConfig('local', workspaceRoot);
        expect(result).toBe(true);
        const config = readRawWorkspaceConfig(workspaceRoot);
        expect((config.servers as any).local).toBeUndefined();
        expect((config.servers as any).other).toBeDefined();
    });
});

// ============================================================================
// addServerToConfig
// ============================================================================

describe('addServerToConfig', () => {
    it('adds a stdio server to global config', async () => {
        await addServerToConfig(workspaceRoot, {
            name: 'myserver',
            type: 'stdio',
            command: 'npx',
            args: ['-y', '@org/server'],
            scope: 'global',
        });
        const config = readRawGlobalConfig();
        const entry = (config.mcpServers as any).myserver;
        expect(entry.command).toBe('npx');
        expect(entry.args).toEqual(['-y', '@org/server']);
    });

    it('adds an http server to global config', async () => {
        await addServerToConfig(workspaceRoot, {
            name: 'remote',
            type: 'http',
            url: 'https://api.example.com/mcp',
            scope: 'global',
        });
        const config = readRawGlobalConfig();
        const entry = (config.mcpServers as any).remote;
        expect(entry.type).toBe('http');
        expect(entry.url).toBe('https://api.example.com/mcp');
    });

    it('adds a server to workspace config', async () => {
        await addServerToConfig(workspaceRoot, {
            name: 'local',
            type: 'stdio',
            command: 'node',
            scope: 'workspace',
        });
        const config = readRawWorkspaceConfig(workspaceRoot);
        expect((config.servers as any).local.command).toBe('node');
    });

    it('stores description and toolScope when provided', async () => {
        await addServerToConfig(workspaceRoot, {
            name: 'srvr',
            type: 'stdio',
            command: 'cmd',
            description: 'My server',
            toolScope: 'readonly',
            scope: 'global',
        });
        const config = readRawGlobalConfig();
        const entry = (config.mcpServers as any).srvr;
        expect(entry.description).toBe('My server');
        expect(entry.toolScope).toBe('readonly');
    });

    it('omits toolScope from config when "all" (the default)', async () => {
        await addServerToConfig(workspaceRoot, {
            name: 'srvr',
            type: 'stdio',
            command: 'cmd',
            toolScope: 'all',
            scope: 'global',
        });
        const config = readRawGlobalConfig();
        const entry = (config.mcpServers as any).srvr;
        expect(entry.toolScope).toBeUndefined();
    });

    it('stores env vars when provided', async () => {
        await addServerToConfig(workspaceRoot, {
            name: 'srvr',
            type: 'stdio',
            command: 'cmd',
            env: { TOKEN: 'secret' },
            scope: 'global',
        });
        const config = readRawGlobalConfig();
        expect((config.mcpServers as any).srvr.env.TOKEN).toBe('secret');
    });
});

// ============================================================================
// migrateServerScope
// ============================================================================

describe('migrateServerScope', () => {
    it('returns false when server not found', async () => {
        const result = await migrateServerScope('missing', workspaceRoot, 'global');
        expect(result).toBe(false);
    });

    it('returns true without moving when server is already in target scope', async () => {
        writeGlobal({ mcpServers: { github: { command: 'npx' } } });
        const result = await migrateServerScope('github', workspaceRoot, 'global');
        expect(result).toBe(true);
        // Still in global
        const config = readRawGlobalConfig();
        expect((config.mcpServers as any).github).toBeDefined();
    });

    it('moves server from global to workspace', async () => {
        writeGlobal({ mcpServers: { github: { command: 'npx', description: 'GitHub server' } } });
        const result = await migrateServerScope('github', workspaceRoot, 'workspace');
        expect(result).toBe(true);
        // Removed from global
        const globalConfig = readRawGlobalConfig();
        expect((globalConfig.mcpServers as any).github).toBeUndefined();
        // Added to workspace
        const wsConfig = readRawWorkspaceConfig(workspaceRoot);
        const entry = (wsConfig.servers as any).github;
        expect(entry).toBeDefined();
        expect(entry.command).toBe('npx');
        expect(entry.description).toBe('GitHub server');
    });

    it('moves server from workspace to global', async () => {
        writeWorkspace({ servers: { local: { command: 'node', args: ['app.js'] } } });
        const result = await migrateServerScope('local', workspaceRoot, 'global');
        expect(result).toBe(true);
        // Removed from workspace
        const wsConfig = readRawWorkspaceConfig(workspaceRoot);
        expect((wsConfig.servers as any).local).toBeUndefined();
        // Added to global
        const globalConfig = readRawGlobalConfig();
        const entry = (globalConfig.mcpServers as any).local;
        expect(entry).toBeDefined();
        expect(entry.command).toBe('node');
        expect(entry.args).toEqual(['app.js']);
    });

    it('preserves extra fields during migration', async () => {
        writeGlobal({
            mcpServers: { server: { command: 'npx', description: 'My server', toolScope: 'readonly' } },
        });
        await migrateServerScope('server', workspaceRoot, 'workspace');
        const wsConfig = readRawWorkspaceConfig(workspaceRoot);
        const entry = (wsConfig.servers as any).server;
        expect(entry.description).toBe('My server');
        expect(entry.toolScope).toBe('readonly');
    });
});

// ============================================================================
// readAllDescriptions
// ============================================================================

describe('readAllDescriptions', () => {
    it('returns empty map when no config files exist', () => {
        const result = readAllDescriptions(workspaceRoot);
        expect(result).toEqual({});
    });

    it('returns descriptions from global config', () => {
        writeGlobal({
            mcpServers: {
                github: { command: 'npx', description: 'GitHub MCP' },
                other: { command: 'other' },
            },
        });
        const result = readAllDescriptions(workspaceRoot);
        expect(result.github).toBe('GitHub MCP');
        expect(result.other).toBeUndefined();
    });

    it('returns descriptions from workspace config', () => {
        writeWorkspace({
            servers: {
                local: { command: 'node', description: 'Local server' },
            },
        });
        const result = readAllDescriptions(workspaceRoot);
        expect(result.local).toBe('Local server');
    });

    it('workspace description wins over global when same name', () => {
        writeGlobal({ mcpServers: { shared: { command: 'global-cmd', description: 'Global desc' } } });
        writeWorkspace({ servers: { shared: { command: 'ws-cmd', description: 'Workspace desc' } } });
        const result = readAllDescriptions(workspaceRoot);
        expect(result.shared).toBe('Workspace desc');
    });
});

// ============================================================================
// Cache invalidation
// ============================================================================

describe('cache invalidation after write', () => {
    beforeEach(() => {
        // Point the forge loader's home directory at the temp dir so
        // loadDefaultMcpConfig / loadWorkspaceMcpConfig use the same paths
        // as the writer's mocked getMcpConfigPath / getWorkspaceMcpConfigPath.
        setHomeDirectoryOverride(tmpDir);
    });

    afterEach(() => {
        setHomeDirectoryOverride(null);
        clearMcpConfigCache();
    });

    it('invalidates global loader cache after writeRawGlobalConfig', async () => {
        // Seed initial config and prime the loader cache
        writeGlobal({ mcpServers: { server: { command: 'cmd-v1' } } });
        const firstLoad = loadDefaultMcpConfig();
        expect(Object.keys(firstLoad.mcpServers)).toContain('server');

        // Write a different config via the writer — should invalidate the cache
        await writeRawGlobalConfig({ mcpServers: { newserver: { command: 'cmd-v2' } } });

        // Loader must return fresh data (not the stale cached version)
        const secondLoad = loadDefaultMcpConfig();
        expect(Object.keys(secondLoad.mcpServers)).toContain('newserver');
        expect(Object.keys(secondLoad.mcpServers)).not.toContain('server');
    });

    it('invalidates workspace loader cache after writeRawWorkspaceConfig', async () => {
        // Seed initial workspace config and prime the loader cache
        writeWorkspace({ servers: { local: { command: 'node-v1' } } });
        const firstLoad = loadWorkspaceMcpConfig(workspaceRoot);
        expect(Object.keys(firstLoad.mcpServers)).toContain('local');

        // Write updated workspace config via the writer
        await writeRawWorkspaceConfig(workspaceRoot, { servers: { newlocal: { command: 'node-v2' } } });

        // Loader must see the new server, not the cached old one
        const secondLoad = loadWorkspaceMcpConfig(workspaceRoot);
        expect(Object.keys(secondLoad.mcpServers)).toContain('newlocal');
        expect(Object.keys(secondLoad.mcpServers)).not.toContain('local');
    });

    it('invalidates global cache after addServerToConfig', async () => {
        writeGlobal({ mcpServers: {} });
        loadDefaultMcpConfig(); // populate cache

        await addServerToConfig(workspaceRoot, { name: 'added', type: 'stdio', command: 'npx', scope: 'global' });

        const result = loadDefaultMcpConfig();
        expect(Object.keys(result.mcpServers)).toContain('added');
    });

    it('invalidates global cache after deleteServerFromConfig', async () => {
        writeGlobal({ mcpServers: { todelete: { command: 'npx' } } });
        loadDefaultMcpConfig(); // populate cache

        await deleteServerFromConfig('todelete', workspaceRoot);

        const result = loadDefaultMcpConfig();
        expect(Object.keys(result.mcpServers)).not.toContain('todelete');
    });
});
