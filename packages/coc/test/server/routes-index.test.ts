/**
 * Tests for server/routes/index.ts — registerAllRoutes()
 *
 * Verifies that:
 * - all route groups are registered into the routes array
 * - wikiManager is returned (or undefined) correctly
 * - the function is a pure composition with no side-effects beyond registration
 */

import { Readable } from 'stream';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { Route } from '../../src/server/types';
import { registerAllRoutes } from '../../src/server/routes/index';
import type { RegisterRoutesOptions } from '../../src/server/routes/index';
import type { ProcessStore } from '@plusplusoneplusplus/forge';

// ── Minimal stubs ─────────────────────────────────────────────────────────────

function makeStore(): ProcessStore {
    return {
        addProcess: vi.fn(),
        updateProcess: vi.fn(),
        getProcess: vi.fn(),
        getAllProcesses: vi.fn().mockResolvedValue([]),
        removeProcess: vi.fn(),
        clearProcesses: vi.fn(),
        getWorkspaces: vi.fn().mockResolvedValue([]),
        registerWorkspace: vi.fn(),
        removeWorkspace: vi.fn(),
        updateWorkspace: vi.fn(),
        getWikis: vi.fn().mockResolvedValue([]),
        registerWiki: vi.fn(),
        removeWiki: vi.fn(),
        updateWiki: vi.fn(),
        clearAllWorkspaces: vi.fn(),
        clearAllWikis: vi.fn(),
        getStorageStats: vi.fn().mockResolvedValue({ totalProcesses: 0, totalWorkspaces: 0, totalWikis: 0, storageSize: 0 }),
        onProcessOutput: vi.fn().mockReturnValue(() => {}),
        emitProcessOutput: vi.fn(),
        emitProcessComplete: vi.fn(),
        emitProcessEvent: vi.fn(),
    } as unknown as ProcessStore;
}

function makeBridge(): any {
    return {
        enqueue: vi.fn(),
        getRepoExecutor: vi.fn(),
        createAggregateQueueFacade: vi.fn(),
        registerRepoId: vi.fn(),
        dispatchToRepo: vi.fn(),
        registry: {
            on: vi.fn(),
        },
        on: vi.fn(),
    };
}

function makeQueueFacade(): any {
    return {
        enqueue: vi.fn(),
        getQueue: vi.fn(),
        getHistory: vi.fn(),
        getQueueStats: vi.fn(),
    };
}

function makeScheduleManager(): any {
    return {
        dispose: vi.fn(),
        getSchedules: vi.fn().mockReturnValue([]),
        addSchedule: vi.fn(),
        removeSchedule: vi.fn(),
        updateSchedule: vi.fn(),
    };
}

function makeQueuePersistence(): any {
    return {
        dispose: vi.fn(),
        loadState: vi.fn(),
        saveState: vi.fn(),
    };
}

function makeWsServer(): any {
    return {
        broadcastProcessEvent: vi.fn(),
        broadcastWikiEvent: vi.fn(),
        closeAll: vi.fn(),
    };
}

function fakeJsonReq(method: string, body: unknown): any {
    const buf = Buffer.from(JSON.stringify(body));
    const req = new Readable({ read() {} }) as any;
    req.push(buf);
    req.push(null);
    req.method = method;
    req.headers = { 'content-type': 'application/json', 'content-length': String(buf.length) };
    return req;
}

function fakeRes(): any {
    const res: any = {
        statusCode: 200,
        headers: {} as Record<string, string>,
        body: '',
        setHeader(name: string, value: string) {
            res.headers[name] = value;
        },
        writeHead(statusCode: number, headers?: Record<string, string>) {
            res.statusCode = statusCode;
            if (headers) Object.assign(res.headers, headers);
        },
        end(chunk?: string) {
            if (chunk) res.body += chunk;
        },
    };
    return res;
}

function findRoute(routes: Route[], method: string, url: string): { route: Route; match?: RegExpMatchArray } | undefined {
    for (const route of routes) {
        if (route.method !== method) continue;
        if (typeof route.pattern === 'string') {
            if (route.pattern === url) return { route };
        } else {
            const match = url.match(route.pattern);
            if (match) return { route, match };
        }
    }
    return undefined;
}

function makeOpts(overrides: Partial<RegisterRoutesOptions> = {}): RegisterRoutesOptions {
    const wsServer = makeWsServer();
    return {
        store: makeStore(),
        bridge: makeBridge(),
        queueFacade: makeQueueFacade(),
        scheduleManager: makeScheduleManager(),
        dataDir: '/tmp/coc-test',
        configPath: undefined,
        tokenTtlMs: undefined,
        globalWorkspaceRootPath: '/tmp/global',
        resolvedAiService: {} as any,
        getWsServer: () => wsServer,
        queuePersistence: makeQueuePersistence(),
        runtimeConfigService: {
            config: {
                codex: { enabled: false },
                claude: { enabled: false },
                defaultProvider: 'copilot',
            },
        } as any,
        ...overrides,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('registerAllRoutes', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'routes-index-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('populates the routes array with a large set of routes', () => {
        const routes: Route[] = [];
        registerAllRoutes(routes, makeOpts());
        // There should be many routes registered (well over 30)
        expect(routes.length).toBeGreaterThan(30);
    });

    it('returns { wikiManager } as a defined object (wiki routes always registered)', () => {
        const routes: Route[] = [];
        const result = registerAllRoutes(routes, makeOpts());
        expect(result).toHaveProperty('wikiManager');
        // Wiki routes are always registered (safe even with no wikis)
        expect(result.wikiManager).toBeDefined();
    });

    it('returns GitHub and Azure Boards work-item pollers', () => {
        const routes: Route[] = [];
        const result = registerAllRoutes(routes, makeOpts({ dataDir: tmpDir }));

        expect(result.workItemGitHubPullPoller).toBeDefined();
        expect(result.workItemAzureBoardsPullPoller).toBeDefined();
    });

    it('reconfigures both work-item provider pollers when work-item preferences change', async () => {
        const routes: Route[] = [];
        const result = registerAllRoutes(routes, makeOpts({ dataDir: tmpDir }));
        const githubConfigure = vi.spyOn(result.workItemGitHubPullPoller, 'configureWorkspace').mockResolvedValue(undefined);
        const azureConfigure = vi.spyOn(result.workItemAzureBoardsPullPoller, 'configureWorkspace').mockResolvedValue(undefined);
        const found = findRoute(routes, 'PATCH', '/api/workspaces/workspace-1/preferences');
        expect(found).toBeDefined();

        const res = fakeRes();
        await found!.route.handler(fakeJsonReq('PATCH', {
            workItems: {
                sync: {
                    github: { pollingEnabled: false },
                    azureBoards: { pollingEnabled: false },
                },
            },
        }), res, found!.match);

        expect(res.statusCode).toBe(200);
        expect(githubConfigure).toHaveBeenCalledWith('workspace-1');
        expect(azureConfigure).toHaveBeenCalledWith('workspace-1');
    });

    it('includes at minimum one route for each core area', () => {
        const routes: Route[] = [];
        registerAllRoutes(routes, makeOpts());

        const patterns = routes.map(r => (typeof r.pattern === 'string' ? r.pattern : r.pattern.toString()));

        // Processes
        expect(patterns.some(p => p.includes('/api/processes'))).toBe(true);
        // Queue
        expect(patterns.some(p => p.includes('/api/queue'))).toBe(true);
        // Schedules (nested under /api/workspaces/:id/schedules)
        expect(patterns.some(p => p.includes('schedules'))).toBe(true);
        // Tasks (nested under /api/workspaces/:id/tasks)
        expect(patterns.some(p => p.includes('tasks'))).toBe(true);
        // Wikis
        expect(patterns.some(p => p.includes('/api/wikis'))).toBe(true);
        // Workflows (nested under /api/workspaces/:id/workflows or /summary)
        expect(patterns.some(p => p.includes('summary'))).toBe(true);
        // Admin
        expect(patterns.some(p => p.includes('/api/admin'))).toBe(true);
        // Agent providers
        expect(patterns.some(p => p.includes('/api/agent-providers'))).toBe(true);
        // Logs
        expect(patterns.some(p => p.includes('/api/logs'))).toBe(true);
        // Remote servers
        expect(patterns.some(p => p.includes('/api/servers'))).toBe(true);
        // Terminal status
        expect(patterns.some(p => p.includes('/api/terminal/status'))).toBe(true);
        // Memory
        expect(patterns.some(p => p.includes('/api/memory'))).toBe(true);
    });

    it('does not mutate the opts object', () => {
        const routes: Route[] = [];
        const opts = makeOpts();
        const storeBefore = opts.store;
        registerAllRoutes(routes, opts);
        expect(opts.store).toBe(storeBefore);
    });

    it('can be called multiple times with separate routes arrays', () => {
        const routes1: Route[] = [];
        const routes2: Route[] = [];
        registerAllRoutes(routes1, makeOpts());
        registerAllRoutes(routes2, makeOpts());
        expect(routes1.length).toBe(routes2.length);
        expect(routes1).not.toBe(routes2);
    });
});
