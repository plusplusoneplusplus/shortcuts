/**
 * Repo-group MCP aggregation: the shared effective resolver behind Settings →
 * MCP, tool discovery and every chat turn.
 *
 * Synthetic fixtures only: a temp home (global config), a temp data dir (group
 * membership + per-repo prefs) and temp member checkouts. No MCP server is
 * started.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { setHomeDirectoryOverride } from '@plusplusoneplusplus/forge';
import {
    anchorStdioServer,
    mcpConnectionFingerprint,
    mergeWorkspaceMcpServers,
    resolveWorkspaceMcp,
    toRuntimeMcpServers,
} from '../../src/server/workspaces/workspace-mcp-resolver';
import { resolveChatMcpServersForWorkspace } from '../../src/server/executors/mcp-tool-enforcement';
import { resolveEnabledMcpServers } from '../../src/server/routes/mcp-tools-discovery';
import { writeRepoPreferences } from '../../src/server/preferences-handler';

const GROUP_ID = 'group-demo';

interface Fixture {
    home: string;
    dataDir: string;
    groupRoot: string;
    repoA: string;
    repoB: string;
    repoC: string;
    workspaces: WorkspaceInfo[];
    store: ProcessStore;
}

function writeJson(file: string, data: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
}

function memberConfig(root: string, servers: Record<string, unknown>): void {
    writeJson(path.join(root, '.vscode', 'mcp.json'), { servers });
}

function makeFixture(): Fixture {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-group-mcp-'));
    const home = path.join(base, 'home');
    const dataDir = path.join(base, 'data');
    const groupRoot = path.join(dataDir, 'repos', GROUP_ID);
    const repoA = path.join(base, 'repo-a');
    const repoB = path.join(base, 'repo-b');
    const repoC = path.join(base, 'repo-c');
    for (const dir of [home, groupRoot, repoA, repoB, repoC]) fs.mkdirSync(dir, { recursive: true });
    writeJson(path.join(home, '.copilot', 'mcp-config.json'), {
        mcpServers: {
            globalOnly: { command: 'global-bin' },
            shadowed: { command: 'global-shadowed' },
        },
    });
    writeJson(path.join(groupRoot, 'group.json'), { name: 'Demo', members: ['ws-a', 'ws-b', 'ws-c'] });
    const workspaces: WorkspaceInfo[] = [
        { id: GROUP_ID, name: 'Demo', rootPath: groupRoot, virtual: true } as WorkspaceInfo,
        { id: 'ws-a', name: 'repo-a', rootPath: repoA } as WorkspaceInfo,
        { id: 'ws-b', name: 'repo-b', rootPath: repoB } as WorkspaceInfo,
        { id: 'ws-c', name: 'repo-c', rootPath: repoC } as WorkspaceInfo,
    ];
    const store = { getWorkspaces: async () => workspaces } as unknown as ProcessStore;
    setHomeDirectoryOverride(home);
    return { home, dataDir, groupRoot, repoA, repoB, repoC, workspaces, store };
}

let fx: Fixture;

beforeEach(() => {
    fx = makeFixture();
});

afterEach(() => {
    setHomeDirectoryOverride(null);
    fs.rmSync(path.dirname(fx.home), { recursive: true, force: true });
});

function groupWorkspace(): WorkspaceInfo {
    return fx.workspaces[0];
}

async function resolveGroup() {
    return resolveWorkspaceMcp({ store: fx.store, dataDir: fx.dataDir, workspace: groupWorkspace(), forceReload: true });
}

async function runtimeForGroup() {
    return resolveChatMcpServersForWorkspace({
        store: fx.store,
        dataDir: fx.dataDir,
        workspaceId: GROUP_ID,
        workingDirectory: fx.groupRoot,
        forceReload: true,
    });
}

describe('anchorStdioServer', () => {
    it('anchors cwd and explicit relative commands to the member root; keeps PATH commands', () => {
        const root = path.resolve('/repos/a');
        expect(anchorStdioServer({ command: 'npx', args: ['tool'] }, root))
            .toEqual({ command: 'npx', args: ['tool'], cwd: root });
        expect(anchorStdioServer({ command: './bin/mcp', cwd: 'tools' }, root))
            .toEqual({ command: path.join(root, 'tools', 'bin', 'mcp'), cwd: path.join(root, 'tools') });
        const remote = { type: 'http' as const, url: 'https://x.example/mcp' };
        expect(anchorStdioServer(remote, root)).toBe(remote);
    });
});

describe('mcpConnectionFingerprint', () => {
    it('ignores key order but distinguishes credentials, tools and cwd', () => {
        const a = { type: 'http' as const, url: 'https://x.example/mcp', headers: { Authorization: 'one' }, tools: ['*'] };
        expect(mcpConnectionFingerprint({ tools: ['*'], headers: { Authorization: 'one' }, url: 'https://x.example/mcp', type: 'http' }))
            .toBe(mcpConnectionFingerprint(a));
        expect(mcpConnectionFingerprint({ ...a, headers: { Authorization: 'two' } })).not.toBe(mcpConnectionFingerprint(a));
        expect(mcpConnectionFingerprint({ ...a, tools: ['read'] })).not.toBe(mcpConnectionFingerprint(a));
        expect(mcpConnectionFingerprint({ command: 'x', cwd: '/a' })).not.toBe(mcpConnectionFingerprint({ command: 'x', cwd: '/b' }));
    });
});

describe('mergeWorkspaceMcpServers', () => {
    it('keeps the ordinary repo rule: workspace over global, nothing else', () => {
        const merged = mergeWorkspaceMcpServers({
            global: { g: { command: 'g' }, both: { command: 'global' } },
            workspace: { both: { command: 'repo' } },
            workspaceRoot: '/repo',
        });
        expect(Object.keys(merged)).toEqual(['g', 'both']);
        expect(merged.both).toMatchObject({ source: 'workspace', config: { command: 'repo' } });
        expect(merged.g).toMatchObject({ source: 'global', executionRoot: '/repo' });
    });
});

describe('resolveWorkspaceMcp — repo group', () => {
    it('unions member servers, folds identical definitions and reports same-name conflicts', async () => {
        const shared = { type: 'http', url: 'https://shared.example/mcp', headers: { Authorization: 'Bearer same' } };
        memberConfig(fx.repoA, { shared, dup: { type: 'http', url: 'https://dup.example/mcp', headers: { Authorization: 'Bearer a' } } });
        memberConfig(fx.repoB, { shared, dup: { type: 'http', url: 'https://dup.example/mcp', headers: { Authorization: 'Bearer b' } }, onlyB: { command: 'b-bin' } });
        memberConfig(fx.repoC, { shared, shadowed: { command: 'member-shadowed' } });

        const resolution = await resolveGroup();
        expect(Object.keys(resolution.servers).sort()).toEqual(['dup', 'globalOnly', 'onlyB', 'shadowed', 'shared']);

        expect(resolution.servers.shared.member?.workspaceId).toBe('ws-a');
        expect(resolution.servers.shared.sharedWith).toEqual([
            { workspaceId: 'ws-b', name: 'repo-b' },
            { workspaceId: 'ws-c', name: 'repo-c' },
        ]);
        expect(resolution.servers.shared.conflicts).toBeUndefined();

        // Same name + same URL, different credentials: never merged. First member in group order wins, visibly.
        expect(resolution.servers.dup.member?.workspaceId).toBe('ws-a');
        expect(resolution.servers.dup.config).toMatchObject({ headers: { Authorization: 'Bearer a' } });
        expect(resolution.servers.dup.conflicts).toEqual([{ workspaceId: 'ws-b', name: 'repo-b' }]);

        // Member (workspace-level) definitions beat global ones.
        expect(resolution.servers.shadowed).toMatchObject({ source: 'member', member: { workspaceId: 'ws-c' } });
        expect(resolution.servers.globalOnly.source).toBe('global');
    });

    it('lets the group root definition override members and global', async () => {
        memberConfig(fx.repoA, { tool: { command: 'member-tool' } });
        memberConfig(fx.groupRoot, { tool: { command: 'group-tool' } });
        const resolution = await resolveGroup();
        expect(resolution.servers.tool).toMatchObject({ source: 'workspace', config: { command: 'group-tool' } });
    });

    it('runs member stdio servers in the member root, never the group root', async () => {
        memberConfig(fx.repoB, { local: { command: './scripts/mcp.sh', args: ['--config', 'mcp.yaml'] } });
        const resolution = await resolveGroup();
        expect(resolution.servers.local.config).toMatchObject({
            command: path.join(fx.repoB, 'scripts', 'mcp.sh'),
            args: ['--config', 'mcp.yaml'],
            cwd: fx.repoB,
        });
        const discovery = resolveEnabledMcpServers(resolution.servers, null);
        expect(discovery.local.cwd).toBe(fx.repoB);
        // Global stdio servers keep the session root as their execution context.
        expect(discovery.globalOnly.cwd).toBe(fx.groupRoot);
    });

    it('reports stale members and unreadable member configs without failing the rest', async () => {
        writeJson(path.join(fx.groupRoot, 'group.json'), { name: 'Demo', members: ['ws-a', 'ws-gone', 'ws-b'] });
        memberConfig(fx.repoA, { fromA: { command: 'a-bin' } });
        fs.mkdirSync(path.join(fx.repoB, '.vscode'), { recursive: true });
        fs.writeFileSync(path.join(fx.repoB, '.vscode', 'mcp.json'), '{ not json');

        const resolution = await resolveGroup();
        expect(Object.keys(resolution.servers).sort()).toEqual(['fromA', 'globalOnly', 'shadowed']);
        expect(resolution.members.map(m => [m.workspaceId, !!m.stale, m.success])).toEqual([
            ['ws-a', false, true],
            ['ws-gone', true, true],
            ['ws-b', false, false],
        ]);
        expect(resolution.members[1].staleReason).toBe('workspace-removed');
        expect(resolution.members[2].error).toMatch(/Failed to parse/);
    });

    it('reports an unreadable membership and still resolves global + group sources', async () => {
        fs.rmSync(path.join(fx.groupRoot, 'group.json'));
        const resolution = await resolveGroup();
        expect(resolution.membersError).toBeTruthy();
        expect(Object.keys(resolution.servers).sort()).toEqual(['globalOnly', 'shadowed']);
    });

    it('picks up membership changes on the next resolution', async () => {
        memberConfig(fx.repoC, { fromC: { command: 'c-bin' } });
        writeJson(path.join(fx.groupRoot, 'group.json'), { name: 'Demo', members: ['ws-a'] });
        expect((await resolveGroup()).servers.fromC).toBeUndefined();
        writeJson(path.join(fx.groupRoot, 'group.json'), { name: 'Demo', members: ['ws-a', 'ws-c'] });
        expect((await resolveGroup()).servers.fromC?.member?.workspaceId).toBe('ws-c');
    });

    it('leaves an ordinary repo unaffected by group logic', async () => {
        memberConfig(fx.repoA, { fromA: { command: 'a-bin' } });
        memberConfig(fx.repoB, { fromB: { command: 'b-bin' } });
        const resolution = await resolveWorkspaceMcp({ store: fx.store, dataDir: fx.dataDir, workspace: fx.workspaces[1], forceReload: true });
        expect(resolution.isGroup).toBe(false);
        expect(Object.keys(resolution.servers).sort()).toEqual(['fromA', 'globalOnly', 'shadowed']);
        // Repo servers are not rewritten: the session cwd is already the repo root.
        expect(resolution.servers.fromA.config).toEqual({ command: 'a-bin', tools: ['*'] });
    });
});

describe('policy boundaries', () => {
    it('never inherits a server a member disabled in its own settings', async () => {
        memberConfig(fx.repoA, { secret: { command: 'a-secret' }, open: { command: 'a-open' } });
        fx.workspaces[1].enabledMcpServers = ['open'];
        const resolution = await resolveGroup();
        expect(resolution.servers.secret).toBeUndefined();
        expect(resolution.members[0].disabledByMember).toEqual(['secret']);
        expect(Object.keys((await runtimeForGroup())!)).not.toContain('secret');
    });

    it('applies member tool allow-lists, and group allow-lists can only narrow them', async () => {
        memberConfig(fx.repoA, { svc: { command: 'svc' } });
        writeRepoPreferences(fx.dataDir, 'ws-a', { enabledMcpTools: { svc: ['read', 'list'] } });
        expect((await runtimeForGroup())!.svc.tools).toEqual(['read', 'list']);

        writeRepoPreferences(fx.dataDir, GROUP_ID, { enabledMcpTools: { svc: ['read', 'write'] } });
        expect((await runtimeForGroup())!.svc.tools).toEqual(['read']);
    });

    it('keeps the repo semantics where a tool entry replaces a global server tool list', () => {
        const servers = mergeWorkspaceMcpServers({ global: { g: { command: 'g', tools: ['a'] } }, workspace: {}, workspaceRoot: '/r' });
        expect(toRuntimeMcpServers(servers, null, { g: ['b'] })!.g.tools).toEqual(['b']);
    });

    it('honors the group server allow-list over member, group and global servers', async () => {
        memberConfig(fx.repoA, { fromA: { command: 'a-bin' } });
        fx.workspaces[0].enabledMcpServers = ['fromA'];
        expect(Object.keys((await runtimeForGroup())!)).toEqual(['fromA']);
        fx.workspaces[0].enabledMcpServers = [];
        expect(await runtimeForGroup()).toEqual({});
    });

    it('fails closed for a group whose workspace record cannot be read', async () => {
        memberConfig(fx.repoA, { fromA: { command: 'a-bin' } });
        const store = { getWorkspaces: async () => { throw new Error('store down'); } } as unknown as ProcessStore;
        const result = await resolveChatMcpServersForWorkspace({
            store, dataDir: fx.dataDir, workspaceId: GROUP_ID, workingDirectory: fx.groupRoot, forceReload: true,
        });
        expect(result).toEqual({});
    });
});

describe('runtime / settings parity', () => {
    it('sends exactly the resolved effective configs the settings page lists', async () => {
        memberConfig(fx.repoA, { local: { command: './run.sh' }, shared: { type: 'sse', url: 'https://s.example/sse' } });
        memberConfig(fx.repoB, { shared: { type: 'sse', url: 'https://s.example/sse' } });
        const resolution = await resolveGroup();
        const runtime = await runtimeForGroup();
        expect(runtime).toEqual(toRuntimeMcpServers(resolution.servers, null, null));
        expect(Object.keys(runtime!).sort()).toEqual(Object.keys(resolution.servers).sort());
        expect(runtime!.local).toMatchObject({ command: path.join(fx.repoA, 'run.sh'), cwd: fx.repoA });
    });
});
