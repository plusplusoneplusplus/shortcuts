/**
 * Repo-group Settings → MCP over the real REST routes, with synthetic config
 * files: the list shows member servers with provenance and no secrets, detail
 * reads the defining member, and definition edits never write a member or a
 * same-named global entry from the group page.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { setHomeDirectoryOverride } from '@plusplusoneplusplus/forge';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';

const GROUP_ID = 'group-demo';

let base: string;
let home: string;
let dataDir: string;
let groupRoot: string;
let repoA: string;
let repoB: string;
let server: http.Server;
let baseUrl: string;

function writeJson(file: string, data: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

async function call(method: string, urlPath: string, body?: unknown): Promise<{ status: number; json: any }> {
    const res = await fetch(`${baseUrl}${urlPath}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : undefined };
}

beforeEach(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-group-mcp-api-'));
    home = path.join(base, 'home');
    dataDir = path.join(base, 'data');
    groupRoot = path.join(dataDir, 'repos', GROUP_ID);
    repoA = path.join(base, 'repo-a');
    repoB = path.join(base, 'repo-b');
    for (const dir of [home, groupRoot, repoA, repoB]) fs.mkdirSync(dir, { recursive: true });
    setHomeDirectoryOverride(home);

    writeJson(path.join(home, '.copilot', 'mcp-config.json'), {
        mcpServers: { docs: { command: 'global-docs', description: 'global docs' } },
    });
    writeJson(path.join(groupRoot, 'group.json'), { name: 'Demo', members: ['ws-a', 'ws-b', 'ws-gone'] });
    writeJson(path.join(repoA, '.vscode', 'mcp.json'), {
        servers: {
            docs: { command: 'node', args: ['docs.js', '--token', 'SECRET-ARG'], env: { DOCS_TOKEN: 'SECRET-ENV' }, description: 'repo-a docs' },
            api: { type: 'http', url: 'https://api.example/mcp', headers: { Authorization: 'Bearer SECRET-A' } },
        },
    });
    writeJson(path.join(repoB, '.vscode', 'mcp.json'), {
        servers: {
            api: { type: 'http', url: 'https://api.example/mcp', headers: { Authorization: 'Bearer SECRET-B' } },
        },
    });

    const workspaces = [
        { id: GROUP_ID, name: 'Demo', rootPath: groupRoot, virtual: true },
        { id: 'ws-a', name: 'repo-a', rootPath: repoA },
        { id: 'ws-b', name: 'repo-b', rootPath: repoB },
    ];
    const store = createMockProcessStore({ initialWorkspaces: workspaces as any });
    (store.getWorkspaces as any).mockResolvedValue(workspaces);

    const routes: Route[] = [];
    registerApiRoutes(routes, store, undefined, dataDir);
    server = http.createServer(createRouter({ routes, spaHtml: '<html></html>' }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    setHomeDirectoryOverride(null);
    fs.rmSync(base, { recursive: true, force: true });
});

describe('GET /api/workspaces/:group/mcp-config', () => {
    it('lists member servers with provenance, conflicts and member sources, without secrets', async () => {
        const { status, json } = await call('GET', `/api/workspaces/${GROUP_ID}/mcp-config?forceReload=true`);
        expect(status).toBe(200);

        const byName = Object.fromEntries(json.availableServers.map((s: any) => [s.name, s]));
        expect(Object.keys(byName).sort()).toEqual(['api', 'docs']);
        expect(byName.docs).toMatchObject({ source: 'member', member: { workspaceId: 'ws-a', name: 'repo-a' }, description: 'repo-a docs' });
        expect(byName.api).toMatchObject({
            source: 'member',
            member: { workspaceId: 'ws-a' },
            conflicts: [{ workspaceId: 'ws-b', name: 'repo-b' }],
        });

        expect(json.sources.global.servers[0]).toMatchObject({ name: 'docs', effective: false, overriddenBy: 'member' });
        expect(json.sources.members.map((m: any) => [m.workspaceId, m.servers.length, !!m.stale])).toEqual([
            ['ws-a', 2, false],
            ['ws-b', 1, false],
            ['ws-gone', 0, true],
        ]);
        expect(json.sources.members[1].servers[0]).toMatchObject({ name: 'api', effective: false, overriddenBy: 'member' });

        const raw = JSON.stringify(json);
        for (const secret of ['SECRET-ARG', 'SECRET-ENV', 'SECRET-A', 'SECRET-B']) expect(raw).not.toContain(secret);
    });

    it('keeps the ordinary repo response shape (no member sources)', async () => {
        const { json } = await call('GET', '/api/workspaces/ws-b/mcp-config?forceReload=true');
        expect(json.sources.members).toBeUndefined();
        expect(json.availableServers.map((s: any) => [s.name, s.source])).toEqual([['docs', 'global'], ['api', 'workspace']]);
    });
});

describe('detail and mutation routing', () => {
    it('reads detail from the defining member repo', async () => {
        const { status, json } = await call('GET', `/api/workspaces/${GROUP_ID}/mcp-config/docs/detail`);
        expect(status).toBe(200);
        expect(json).toMatchObject({ source: 'member', member: { workspaceId: 'ws-a' }, description: 'repo-a docs', envKeys: ['DOCS_TOKEN'] });
    });

    it('refuses to edit, delete or migrate a member-owned server from the group page', async () => {
        const before = {
            global: fs.readFileSync(path.join(home, '.copilot', 'mcp-config.json'), 'utf-8'),
            repoA: fs.readFileSync(path.join(repoA, '.vscode', 'mcp.json'), 'utf-8'),
        };
        const put = await call('PUT', `/api/workspaces/${GROUP_ID}/mcp-config/docs`, { description: 'hijack' });
        const del = await call('DELETE', `/api/workspaces/${GROUP_ID}/mcp-config/docs`);
        const migrate = await call('POST', `/api/workspaces/${GROUP_ID}/mcp-config/docs/migrate`, { targetScope: 'global' });
        for (const res of [put, del, migrate]) {
            expect(res.status).toBe(409);
            expect(JSON.stringify(res.json)).toContain('repo-a');
        }
        expect(fs.readFileSync(path.join(home, '.copilot', 'mcp-config.json'), 'utf-8')).toBe(before.global);
        expect(fs.readFileSync(path.join(repoA, '.vscode', 'mcp.json'), 'utf-8')).toBe(before.repoA);
        expect(fs.existsSync(path.join(groupRoot, '.vscode', 'mcp.json'))).toBe(false);
    });

    it('still edits a global server from the group page when no member defines it', async () => {
        writeJson(path.join(home, '.copilot', 'mcp-config.json'), { mcpServers: { only: { command: 'g' } } });
        const res = await call('PUT', `/api/workspaces/${GROUP_ID}/mcp-config/only`, { description: 'updated' });
        expect(res.status).toBe(200);
        const global = JSON.parse(fs.readFileSync(path.join(home, '.copilot', 'mcp-config.json'), 'utf-8'));
        expect(global.mcpServers.only.description).toBe('updated');
    });
});
