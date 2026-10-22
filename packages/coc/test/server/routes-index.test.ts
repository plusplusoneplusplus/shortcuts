/**
 * Tests for server/routes/index.ts — registerAllRoutes()
 *
 * Verifies that:
 * - all route groups are registered into the routes array
 * - wikiManager is returned (or undefined) correctly
 * - the function is a pure composition with no side-effects beyond registration
 */

import { Readable } from 'stream';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { ScrubberStore } from '../../src/server/sentinel-scrubber/scrubber-store';
import { ScrubberScheduler } from '../../src/server/sentinel-scrubber/scrubber-scheduler';
import type { ScrubberRunService } from '../../src/server/sentinel-scrubber/scrubber-runs';
import { SentinelTodoStore } from '../../src/server/sentinel-todos/sentinel-todo-store';
import * as fs from 'fs/promises';
import * as path from 'path';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { Route } from '../../src/server/types';
import { registerAllRoutes } from '../../src/server/routes/index';
import type { RegisterRoutesOptions } from '../../src/server/routes/index';
import type { CreateTaskInput, ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import { SqliteProcessStore, toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { SentinelTodoService } from '../../src/server/sentinel-todos/sentinel-todo-service';
import type { InboundTeamsMessage } from '@plusplusoneplusplus/coc-connector/teams';
import { TeamsMessagingManager } from '../../src/server/messaging/teams-messaging-manager';
import { WhatsAppMessagingManager } from '../../src/server/messaging/whatsapp-messaging-manager';
import { SentinelMirrorService } from '../../src/server/messaging/sentinel-mirror-service';
import { CLITaskExecutor } from '../../src/server/queue/queue-executor-bridge';
import { isChatPayload } from '../../src/server/tasks/task-types';
import { MessagingJobNotices } from '../../src/server/messaging/job-notices';
import { DelegatedJobResults } from '../../src/server/delegation/delegated-job-results';
import { RemoteDelegationResults } from '../../src/server/delegation/remote-delegation-results';
import { DelegatedJobStore } from '../../src/server/delegation/delegated-job-store';
import { TeamsUserStateStore } from '../../src/server/messaging/teams-user-state';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../helpers/mock-sdk-service';
import type { SendToConversationRuntimeOptions } from '../../src/server/llm-tools/send-to-conversation-tool';
import { DEFAULT_CONFIG, mergeConfig } from '../../src/config';
import { SentinelJobStore } from '../../src/server/sentinel-jobs/job-store';
import type { SentinelJobService } from '../../src/server/sentinel-jobs/job-service';
import { SentinelJobScheduler } from '../../src/server/sentinel-jobs/job-scheduler';

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
        enqueue: vi.fn().mockResolvedValue('task-1'),
        getRepoExecutor: vi.fn(),
        createAggregateQueueFacade: vi.fn(),
        registerRepoId: vi.fn(),
        dispatchToRepo: vi.fn(),
        setResolveDefaultProvider: vi.fn(),
        setDreamRunExecutor: vi.fn(),
        findManagerForTask: vi.fn(),
        registry: {
            on: vi.fn(),
        },
        on: vi.fn(),
    };
}

function makeQueueFacade(): any {
    return {
        enqueue: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        getTask: vi.fn(),
        getAll: vi.fn().mockReturnValue([]),
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
        notesSearchService: { search: vi.fn() } as any,
        runtimeConfigService: {
            onChange: vi.fn().mockReturnValue(() => {}),
            config: {
                codex: { enabled: false },
                claude: { enabled: false },
                defaultProvider: 'copilot',
                features: { autoAgentProviderRouting: false },
            },
        } as any,
        ...overrides,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('registerAllRoutes', () => {
    it.each(['sentinel', 'workspace'])('revokes jobs and handbacks immediately after %s removal without affecting another workspace', async removed => {
        const store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'processes.db') });
        const owners = [
            { workspaceId: 'ws-jobs-a', processId: 'queue_owner_a' },
            { workspaceId: 'ws-jobs-b', processId: 'queue_owner_b' },
        ];
        for (const owner of owners) {
            await store.registerWorkspace({ id: owner.workspaceId, name: 'Jobs', rootPath: tmpDir });
            await store.addProcess({ id: owner.processId, type: 'chat', status: 'completed', startTime: new Date(),
                metadata: { ...owner, mode: 'sentinel', provider: 'copilot' } });
        }
        const jobs = new SentinelJobStore(store.getDatabase());
        const input = { name: 'Review', instructions: 'Read evidence', provider: 'copilot', model: 'model', cron: '0 * * * *' };
        const a = jobs.create(owners[0], input);
        const b = jobs.create(owners[1], input);
        const notification = jobs.create(owners[0], input);
        const bridge = makeBridge();
        bridge.registry = new EventEmitter();
        bridge.enqueue.mockImplementation(async (input: CreateTaskInput) => input.id!);
        bridge.getTask = vi.fn();
        const cancel = vi.fn();
        bridge.findExecutorForTask = vi.fn().mockReturnValue({ cancelTask: cancel });
        let getJobs!: () => SentinelJobService | undefined;
        const opts = makeOpts({ store, bridge, dataDir: tmpDir,
            setSentinelScheduledJobs: get => { getJobs = get; } });
        const config = opts.runtimeConfigService!.config as any;
        config.sentinel = { enabled: true };
        config.features.sentinelTodoJobs = true;
        const refresh = vi.spyOn(SentinelJobScheduler.prototype, 'refreshAll');
        const composition = registerAllRoutes([], opts);
        try {
            await composition.scrubberReady;
            const runA = await getJobs()!.start(owners[0], a.id);
            const runB = await getJobs()!.start(owners[1], b.id);
            const handback = await getJobs()!.start(owners[0], notification.id);
            jobs.patchRun(owners[0], notification.id, handback.id, {
                status: 'completed', handbackState: 'queued', handbackTaskId: 'pending-handback',
            });
            const previousRefreshes = refresh.mock.calls.length;
            if (removed === 'workspace') await store.removeWorkspace(owners[0].workspaceId);
            else await store.removeProcess(owners[0].processId);
            await vi.waitFor(() => expect(jobs.run(owners[0], a.id, runA.id).status).toBe('cancelled'));
            expect(refresh.mock.calls.length).toBeGreaterThan(previousRefreshes);
            expect(cancel).toHaveBeenCalledWith(runA.taskId);
            expect(cancel).toHaveBeenCalledWith('pending-handback');
            expect(jobs.run(owners[0], notification.id, handback.id).handbackState).toBe('suppressed');
            expect(jobs.run(owners[1], b.id, runB.id).status).toBe('queued');
            expect(cancel).not.toHaveBeenCalledWith(runB.taskId);
            expect(jobs.get(owners[0], a.id).processId).toBeTruthy();
            await expect(getJobs()!.assertOwner(owners[0])).rejects.toBeDefined();
        } finally {
            await composition.sentinelJobsShutdown();
            composition.whatsappMessagingManager.dispose();
            store.close();
        }
    });

    it('wires native job recovery, both live gates, queue cancellation and awaited scheduler shutdown independently of scrubber', async () => {
        const store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'processes.db') });
        const owner = { workspaceId: 'ws-jobs', processId: 'queue_owner' };
        await store.registerWorkspace({ id: owner.workspaceId, name: 'Jobs', rootPath: tmpDir });
        await store.addProcess({ id: owner.processId, type: 'chat', status: 'completed', startTime: new Date(),
            promptPreview: 'Sentinel', metadata: { ...owner, mode: 'sentinel', provider: 'copilot' } });
        const jobs = new SentinelJobStore(store.getDatabase());
        const job = jobs.create(owner, { name: 'Review', instructions: 'Read evidence', provider: 'copilot',
            model: 'model', cron: '0 * * * *' });
        const orphan = jobs.createRun(owner, job.id, 'manual', 'queue_orphan', new Date().toISOString());
        jobs.patchRun(owner, job.id, orphan.id, { taskId: 'orphan-task', status: 'running' });
        const bridge = makeBridge();
        bridge.registry = new EventEmitter();
        bridge.enqueue.mockImplementation(async (input: CreateTaskInput) => input.id!);
        bridge.getTask = vi.fn();
        const cancel = vi.fn();
        bridge.findExecutorForTask = vi.fn().mockReturnValue({ cancelTask: cancel });
        let getJobs!: () => SentinelJobService | undefined;
        let getScrubber!: () => ScrubberRunService | undefined;
        const opts = makeOpts({ store, bridge, dataDir: tmpDir,
            setSentinelScheduledJobs: get => { getJobs = get; }, setSentinelScrubber: get => { getScrubber = get; } });
        const config = opts.runtimeConfigService!.config as any;
        config.features.sentinelTodoScrubber = true;
        const disposed = vi.spyOn(SentinelJobScheduler.prototype, 'dispose');
        const routes: Route[] = [];
        const composition = registerAllRoutes(routes, opts);
        const base = `/api/workspaces/${owner.workspaceId}/sentinel-todos/${owner.processId}/jobs`;
        const read = async () => {
            const found = findRoute(routes, 'GET', base)!;
            const response = fakeRes();
            await found.route.handler(fakeJsonReq('GET', {}), response, found.match);
            return response;
        };
        try {
            await composition.scrubberReady;
            expect(jobs.run(owner, job.id, orphan.id).status).toBe('interrupted');
            expect(cancel).toHaveBeenCalledWith('orphan-task');
            expect((await read()).statusCode).toBe(404);
            config.features.sentinelTodoJobs = true;
            expect((await read()).statusCode).toBe(404); // Sentinel itself is still off
            config.sentinel = { enabled: true };
            expect((await read()).statusCode).toBe(200);
            const active = await getJobs()!.start(owner, job.id);
            expect(active.status).toBe('queued');
            expect(bridge.enqueue).toHaveBeenCalledWith(expect.objectContaining({
                processId: 'queue_orphan', priority: 'low', repoId: owner.workspaceId,
                payload: expect.objectContaining({ mode: 'ask', processId: 'queue_orphan' }),
            }));
            config.features.sentinelTodoJobs = false;
            vi.mocked(opts.runtimeConfigService!.onChange).mock.calls[0][0]({} as never);
            await vi.waitFor(() => expect(jobs.run(owner, job.id, active.id).status).toBe('cancelled'));
            expect(cancel).toHaveBeenCalledWith(active.taskId);
            expect(getScrubber()).toBeDefined();
            expect((await read()).statusCode).toBe(404);
            const persistentProcessId = jobs.get(owner, job.id).processId!;
            expect(await store.getProcess(persistentProcessId)).toBeDefined();
            config.features.sentinelTodoJobs = true;
            const next = await getJobs()!.start(owner, job.id);
            expect(next.status).toBe('queued');
            expect(next.taskId).not.toBe(active.taskId);
            expect(jobs.get(owner, job.id).processId).toBe(persistentProcessId);
            expect(await store.getProcess(persistentProcessId)).toBeDefined();
            await composition.sentinelJobsShutdown();
            expect(disposed).toHaveBeenCalledOnce();
        } finally {
            await composition.sentinelJobsShutdown();
            composition.whatsappMessagingManager.dispose();
            store.close();
        }
    });
    it('wires gated job ticks to the owner gate runtime and the live tool-scripting flag', async () => {
        const store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'processes.db') });
        const owner = { workspaceId: 'ws-gate', processId: 'queue_gate_owner' };
        await store.registerWorkspace({ id: owner.workspaceId, name: 'Gate', rootPath: tmpDir });
        await store.addProcess({ id: owner.processId, type: 'chat', status: 'completed', startTime: new Date(),
            promptPreview: 'Sentinel', metadata: { ...owner, mode: 'sentinel', provider: 'copilot' } });
        const jobs = new SentinelJobStore(store.getDatabase());
        const job = jobs.create(owner, { name: 'Watch', instructions: 'Read evidence', provider: 'copilot',
            model: 'model', cron: '0 * * * *', gateScript: 'return state;' });
        const bridge = makeBridge();
        bridge.registry = new EventEmitter();
        bridge.enqueue.mockImplementation(async (input: CreateTaskInput) => input.id!);
        bridge.getTask = vi.fn();
        bridge.findExecutorForTask = vi.fn().mockReturnValue({ cancelTask: vi.fn() });
        bridge.runJobGate = vi.fn(async () => []);
        let getJobs!: () => SentinelJobService | undefined;
        const opts = makeOpts({ store, bridge, dataDir: tmpDir, setSentinelScheduledJobs: get => { getJobs = get; } });
        const config = opts.runtimeConfigService!.config as any;
        config.sentinel = { enabled: true };
        config.features.sentinelTodoJobs = true;
        const composition = registerAllRoutes([], opts);
        try {
            await composition.scrubberReady;
            expect(await getJobs()!.tick(owner, job.id)).toMatchObject({ status: 'skipped', skipReason: 'gate-empty' });
            expect(bridge.runJobGate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
                ...owner, code: 'return state;', state: null }));
            config.features.toolScripting = false;
            expect(await getJobs()!.tick(owner, job.id)).toMatchObject({ status: 'skipped', skipReason: 'gate-unavailable' });
            expect(bridge.runJobGate).toHaveBeenCalledOnce();
        } finally {
            await composition.sentinelJobsShutdown();
            composition.whatsappMessagingManager.dispose();
            store.close();
        }
    });

    it('publishes browser state before the socket exists and resolves the live broker later', async () => {
        let socket: any;
        let getRuntime!: Parameters<NonNullable<RegisterRoutesOptions['setBrowserControl']>>[0];
        let state!: Parameters<NonNullable<RegisterRoutesOptions['setBrowserControl']>>[1];
        const opts = makeOpts({ dataDir: tmpDir, getWsServer: () => socket,
            setBrowserControl: (get, value) => { getRuntime = get; state = value; } });
        (opts.runtimeConfigService!.config as any).browserControl = { enabled: false };
        const composition = registerAllRoutes([], opts);
        try {
            expect(state).toBeDefined();
            expect(getRuntime()).toBeUndefined();
            let enabled = () => false;
            let framesEnabled = () => false;
            let richPasteEnabled = () => false;
            let backgroundEnabled = () => false;
            const broker = { setEnabledGetter: (get: () => boolean) => { enabled = get; },
                setFramesEnabledGetter: (get: () => boolean) => { framesEnabled = get; },
                setRichPasteEnabledGetter: (get: () => boolean) => { richPasteEnabled = get; },
                setBackgroundEnabledGetter: (get: () => boolean) => { backgroundEnabled = get; },
                getEnabled: () => enabled(), execute: vi.fn() };
            socket = { ...makeWsServer(), browserControl: broker };
            expect(getRuntime()).toBe(broker);
            expect(broker.getEnabled()).toBe(false);
            expect(framesEnabled()).toBe(false);
            (opts.runtimeConfigService!.config as any).browserControl.enabled = true;
            expect(broker.getEnabled()).toBe(true);
            (opts.runtimeConfigService!.config as any).browserControl.framesEnabled = true;
            expect(framesEnabled()).toBe(true);
            expect(richPasteEnabled()).toBe(false);
            (opts.runtimeConfigService!.config as any).browserControl.richPasteEnabled = true;
            expect(richPasteEnabled()).toBe(true);
            expect(backgroundEnabled()).toBe(false);
            (opts.runtimeConfigService!.config as any).browserControl.backgroundEnabled = true;
            expect(backgroundEnabled()).toBe(true);
            expect(getRuntime()).toBe(broker);
        } finally {
            composition.whatsappMessagingManager.dispose();
            composition.teamsMessagingManager.dispose();
            composition.autoPullManager.dispose();
            composition.workItemGitHubPullPoller.dispose();
            composition.workItemAzureBoardsPullPoller.dispose();
            composition.activeWorkspaceBackgroundRefresher.dispose();
            composition.dreamIdleScheduler.dispose();
            composition.repoTreeService.dispose();
            composition.agentProvidersQuotaCache?.dispose();
            composition.quotaPauseWatcher?.dispose();
        }
    });
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = path.resolve(`.routes-index-test-${randomUUID()}`);
        await fs.mkdir(tmpDir);
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it.each([
        { source: 'runtime', value: undefined },
        { source: 'runtime', value: true },
        { source: 'runtime', value: false },
        { source: 'resolved', value: undefined },
        { source: 'resolved', value: true },
        { source: 'resolved', value: false },
        { source: 'absent', value: undefined },
    ] as const)('keeps ledgers available with retired $source config ($value), preserving workspace data', async ({ source, value }) => {
        const store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'processes.db') });
        const owners = [
            { workspaceId: 'ws-a', processId: 'parent-a' },
            { workspaceId: 'ws-b', processId: 'parent-b' },
        ];
        const todos = new SentinelTodoStore(store.getDatabase());
        for (const owner of owners) {
            await store.addProcess({ id: owner.processId, type: 'chat', status: 'completed', startTime: new Date(),
                metadata: { workspaceId: owner.workspaceId, mode: 'sentinel' } });
            todos.create(owner, { title: owner.workspaceId }, { actor: 'user' });
        }
        const savedLedgers = owners.map(owner => todos.get(owner));
        const opts = makeOpts({ store, dataDir: tmpDir });
        if (source === 'runtime') {
            if (value !== undefined) Object.assign(opts.runtimeConfigService!.config.features, { sentinelTodoLedger: value });
        } else {
            opts.runtimeConfigService = undefined;
            if (source === 'resolved') {
                opts.resolvedConfig = mergeConfig(DEFAULT_CONFIG, {});
                Object.assign(opts.resolvedConfig.features, { sentinelTodoLedger: value });
            }
        }
        let getTodos!: () => SentinelTodoService | undefined;
        let getScrubber!: () => ScrubberRunService | undefined;
        opts.setSentinelTodos = get => { getTodos = get; };
        opts.setSentinelScrubber = get => { getScrubber = get; };
        const routes: Route[] = [];
        const composition = registerAllRoutes(routes, opts);
        try {
            await composition.scrubberReady;
            expect(getTodos()).toBeDefined();
            expect(getScrubber()).toBeUndefined();
            for (const owner of owners) {
                const found = findRoute(routes, 'GET', `/api/workspaces/${owner.workspaceId}/sentinel-todos/${owner.processId}`)!;
                const res = fakeRes();
                await found.route.handler(fakeJsonReq('GET', {}), res, found.match);
                expect(res.statusCode).toBe(200);
                expect(JSON.parse(res.body).items).toMatchObject([{ title: owner.workspaceId }]);
            }
            if (source === 'runtime') {
                Object.assign(opts.runtimeConfigService!.config.features, { sentinelTodoLedger: false });
                expect(getTodos()).toBeDefined();
                Object.assign(opts.runtimeConfigService!.config.features, { sentinelTodoLedger: true });
                for (const [index, owner] of owners.entries()) {
                    expect(await getTodos()!.list(owner)).toEqual(savedLedgers[index]);
                }
                expect(getScrubber()).toBeUndefined();
            }
            expect(owners.map(owner => todos.get(owner))).toEqual(savedLedgers);
        } finally {
            composition.whatsappMessagingManager.dispose();
            composition.teamsMessagingManager.dispose();
            composition.autoPullManager.dispose();
            composition.workItemGitHubPullPoller.dispose();
            composition.workItemAzureBoardsPullPoller.dispose();
            composition.activeWorkspaceBackgroundRefresher.dispose();
            composition.dreamIdleScheduler.dispose();
            composition.repoTreeService.dispose();
            composition.agentProvidersQuotaCache?.dispose();
            composition.quotaPauseWatcher?.dispose();
            store.close();
        }
    });

    it('wires scrubber recovery, REST, runtime, queue completion and owner invalidations', async () => {
        const refreshAll = vi.spyOn(ScrubberScheduler.prototype, 'refreshAll');
        const refresh = vi.spyOn(ScrubberScheduler.prototype, 'refresh');
        const disposeScheduler = vi.spyOn(ScrubberScheduler.prototype, 'dispose');
        const store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'processes.db') });
        const owner = { workspaceId: 'ws-fixture', processId: 'parent' };
        await store.addProcess({ id: owner.processId, type: 'chat', status: 'completed', startTime: new Date(),
            metadata: { ...owner, mode: 'sentinel' } });
        const todos = new SentinelTodoStore(store.getDatabase());
        const item = todos.create(owner, { title: 'Merged work' }, { actor: 'sentinel' }).item;
        const scrubber = new ScrubberStore(store.getDatabase());
        scrubber.createRun(owner, { id: 'orphan', trigger: 'manual', status: 'running',
            childProcessId: 'queue_old', createdAt: new Date().toISOString(),
            snapshot: [{ itemId: item.id, revision: item.revision }], deferredItemIds: [], awaitingReviewItemIds: [] });
        const bridge = makeBridge();
        bridge.enqueue.mockImplementation(async (input: CreateTaskInput) => input.id!);
        bridge.registry = new EventEmitter();
        bridge.findExecutorForTask = vi.fn().mockReturnValue({ cancelTask: vi.fn() });
        const wsServer = makeWsServer();
        const opts = makeOpts({ store, bridge, dataDir: tmpDir, getWsServer: () => wsServer });
        const flags = opts.runtimeConfigService!.config.features as any;
        flags.sentinelTodoLedger = false; // Retired config must not gate the scrubber.
        flags.sentinelTodoScrubber = true;
        let getScrubber!: () => ScrubberRunService | undefined;
        opts.setSentinelScrubber = get => { getScrubber = get; };
        const routes: Route[] = [];
        const composition = registerAllRoutes(routes, opts);
        const scrubberListener = bridge.registry.listeners('taskCompleted')[0];
        try {
            await composition.scrubberReady;
            expect(refreshAll).toHaveBeenCalledOnce();
            expect(scrubber.getRun(owner, 'orphan')?.status).toBe('interrupted');
            expect(bridge.findExecutorForTask).toHaveBeenCalledWith('old');
            expect(todos.get(owner).items[0].status).toBe('todo');
            const base = `/api/workspaces/${owner.workspaceId}/sentinel-todos/${owner.processId}/scrubber`;
            const configRoute = findRoute(routes, 'PUT', `${base}/config`)!;
            const configResponse = fakeRes();
            await configRoute.route.handler(fakeJsonReq('PUT', { enabled: false, cron: '0 * * * *', expectedRevision: 0 }),
                configResponse, configRoute.match);
            expect(configResponse.statusCode).toBe(200);
            expect(refresh).toHaveBeenCalledWith(owner);
            const found = findRoute(routes, 'POST', `${base}/runs`)!;
            const res = fakeRes();
            await found.route.handler(fakeJsonReq('POST', {}), res, found.match);
            expect(res.statusCode).toBe(202);
            const { runId } = JSON.parse(res.body);
            const input = bridge.enqueue.mock.calls[0][0] as CreateTaskInput;
            expect(input).toMatchObject({ repoId: owner.workspaceId, priority: 'low',
                payload: { mode: 'ask', context: { sentinelScrub: { ...owner, runId } } } });
            const context = { ...owner, runId };
            getScrubber()!.markRunning(context);
            getScrubber()!.submit(context, [{ itemId: item.id, verdict: 'done', autoApply: true,
                confidence: 'high', summary: 'Merged', rationale: 'Completion verified',
                evidence: [{ kind: 'pr', ref: 'https://github.com/o/r/pull/1', state: 'merged',
                    checkedAt: new Date().toISOString() }] }]);
            bridge.registry.emit('taskCompleted', '/fixture', { ...input, id: input.id, processId: `queue_${input.id}` });
            expect(todos.get(owner).items[0].status).toBe('done');
            expect(scrubber.getRun(owner, runId)?.status).toBe('completed');
            expect(wsServer.broadcastProcessEvent).toHaveBeenCalledWith(expect.objectContaining({
                type: 'sentinel-scrubber-changed', ...owner, runId }));
            expect(wsServer.broadcastProcessEvent).toHaveBeenCalledWith(expect.objectContaining({
                type: 'sentinel-todos-changed', ...owner, ledgerRevision: todos.get(owner).revision }));
            flags.sentinelTodoScrubber = false;
            const configListener = vi.mocked(opts.runtimeConfigService!.onChange).mock.calls[0][0];
            configListener({} as never);
            expect(refreshAll).toHaveBeenCalledTimes(2);
            expect(getScrubber()).toBeUndefined();
            const disabled = fakeRes();
            await found.route.handler(fakeJsonReq('POST', {}), disabled, found.match);
            expect(disabled.statusCode).toBe(404);
            flags.sentinelTodoScrubber = true;
            expect(getScrubber()).toBeDefined();
            await store.removeProcess(owner.processId);
            expect(refreshAll).toHaveBeenCalledTimes(3);
            composition.whatsappMessagingManager.dispose();
            expect(disposeScheduler).toHaveBeenCalledOnce();
            expect(bridge.registry.listeners('taskCompleted')).not.toContain(scrubberListener);
        } finally {
            composition.whatsappMessagingManager.dispose();
            store.close();
        }
    });

    it('initializes Sentinel SQLite before publishing tools and borrows the process database lifecycle', async () => {
        const store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'processes.db') });
        const owner = { workspaceId: 'ws-fixture', processId: 'parent' };
        await store.addProcess({
            id: owner.processId, type: 'chat', status: 'completed', startTime: new Date(),
            metadata: { workspaceId: owner.workspaceId, mode: 'sentinel' },
        });
        const delegatedJobs = new DelegatedJobStore(tmpDir);
        delegatedJobs.register({
            id: 'child', title: 'Existing job', parent: owner,
            child: { workspaceId: 'ws-child', processId: 'child' },
        });
        const previousJobs = delegatedJobs.list(owner.workspaceId);
        const base = makeOpts();
        (base.runtimeConfigService!.config.features as unknown as Record<string, unknown>).sentinelTodoLedger = false;
        let getTodos: (() => SentinelTodoService | undefined) | undefined;
        const opts = makeOpts({
            store, dataDir: tmpDir,
            runtimeConfigService: base.runtimeConfigService,
            setSentinelTodos: get => { getTodos = get; },
        });
        let composition: ReturnType<typeof registerAllRoutes> | undefined;
        try {
            const version = store.getDatabase().pragma<number>('user_version', { simple: true });
            composition = registerAllRoutes([], opts);
            const service = getTodos?.();
            expect(service).toBeDefined();
            await service!.create(owner, { title: 'Persist bookkeeping' }, { actor: 'user' });
            composition.whatsappMessagingManager.dispose();
            expect((await service!.list(owner)).items).toMatchObject([{ title: 'Persist bookkeeping' }]);
            expect(await store.getProcess(owner.processId)).toBeDefined();
            expect(delegatedJobs.list(owner.workspaceId)).toEqual(previousJobs);
            expect(store.getDatabase().pragma<number>('user_version', { simple: true })).toBe(version);
        } finally {
            composition?.whatsappMessagingManager.dispose();
            composition?.teamsMessagingManager.dispose();
            composition?.autoPullManager.dispose();
            composition?.workItemGitHubPullPoller.dispose();
            composition?.workItemAzureBoardsPullPoller.dispose();
            composition?.activeWorkspaceBackgroundRefresher.dispose();
            composition?.dreamIdleScheduler.dispose();
            composition?.repoTreeService.dispose();
            composition?.agentProvidersQuotaCache?.dispose();
            composition?.quotaPauseWatcher?.dispose();
            store.close();
        }
    });

    it('closes its owned native test database on shutdown without creating a file ledger', async () => {
        const store = makeStore();
        vi.mocked(store.getProcess).mockResolvedValue({
            id: 'parent', type: 'chat', status: 'completed', startTime: new Date(),
            metadata: { workspaceId: 'ws-fixture', mode: 'sentinel' },
        });
        const base = makeOpts();
        (base.runtimeConfigService!.config.features as unknown as Record<string, unknown>).sentinelTodoLedger = false;
        let getTodos: (() => SentinelTodoService | undefined) | undefined;
        const composition = registerAllRoutes([], makeOpts({
            store, dataDir: tmpDir, runtimeConfigService: base.runtimeConfigService,
            setSentinelTodos: get => { getTodos = get; },
        }));
        const owner = { workspaceId: 'ws-fixture', processId: 'parent' };
        const service = getTodos!()!;
        try {
            await service.create(owner, { title: 'Test bookkeeping' }, { actor: 'user' });
            expect(await fs.readdir(tmpDir)).not.toContain('processes.db');
            composition.whatsappMessagingManager.dispose();
            await expect(service.list(owner)).rejects.toThrow();
        } finally {
            composition.whatsappMessagingManager.dispose();
            composition.teamsMessagingManager.dispose();
            composition.autoPullManager.dispose();
            composition.workItemGitHubPullPoller.dispose();
            composition.workItemAzureBoardsPullPoller.dispose();
            composition.activeWorkspaceBackgroundRefresher.dispose();
            composition.dreamIdleScheduler.dispose();
            composition.repoTreeService.dispose();
            composition.agentProvidersQuotaCache?.dispose();
            composition.quotaPauseWatcher?.dispose();
        }
    });

    it('publishes the shared conversation cancellation capability through tool runtime', async () => {
        const store = createMockProcessStore();
        await store.addProcess({
            id: 'fixture', type: 'chat', status: 'running', startTime: new Date(), promptPreview: 'test',
            metadata: { workspaceId: 'ws-fixture' },
        });
        const bridge = makeBridge();
        bridge.cancelProcess = vi.fn().mockResolvedValue(undefined);
        let runtime: SendToConversationRuntimeOptions | undefined;
        registerAllRoutes([], makeOpts({
            store, bridge, dataDir: tmpDir,
            setSendToConversationRuntime: value => { runtime = value; },
        }));
        expect(runtime?.cancelConversation).toBeTypeOf('function');
        expect(await runtime!.cancelConversation!('fixture', 'ws-fixture')).toEqual({
            processId: 'fixture', workspaceId: 'ws-fixture', cancelled: true, status: 'cancelled',
        });
        expect(bridge.cancelProcess).toHaveBeenCalledExactlyOnceWith('fixture');
        expect((await store.getProcess('fixture'))?.status).toBe('cancelled');
        expect(bridge.enqueue).not.toHaveBeenCalled();
    });

    it('executes ordinary Teams messages as workspace-scoped chats with assistant turns', async () => {
        const store = createMockProcessStore();
        vi.mocked(store.getWorkspaces).mockResolvedValue([
            { id: 'global-workspace-00', name: 'Global', rootPath: path.join(tmpDir, 'first') },
            { id: 'ws-second', name: 'Second', rootPath: path.join(tmpDir, 'second') },
        ]);
        const sdk = createMockSDKService({
            listModelsResult: [{
                id: 'gpt-6.1-sol', name: 'gpt-6.1-sol',
                capabilities: {
                    supports: { reasoningEffort: true, vision: false },
                    limits: { max_context_window_tokens: 200_000 },
                },
                supportedReasoningEfforts: ['medium'],
            }],
        });
        sdk.mockSendMessage.mockResolvedValue({
            success: true, response: 'A reply', sessionId: 'session-1',
        });
        const executor = new CLITaskExecutor(store, { aiService: sdk.service, dataDir: tmpDir });
        const bridge = makeBridge();
        let taskNumber = 0;
        bridge.enqueue.mockImplementation(async (input: CreateTaskInput) => {
            const id = `teams-task-${++taskNumber}`;
            const task: QueuedTask = { ...input, id, status: 'running', createdAt: Date.now() };
            await executor.execute(task);
            return id;
        });

        let inbound: Parameters<TeamsMessagingManager['setMessageHandler']>[0] | undefined;
        vi.spyOn(TeamsMessagingManager.prototype, 'setMessageHandler').mockImplementation(handler => {
            inbound = handler;
        });
        const send = vi.spyOn(TeamsMessagingManager.prototype, 'sendMessage').mockResolvedValue('reply-id');
        const opts = makeOpts({ store, bridge, dataDir: tmpDir });
        opts.runtimeConfigService!.config.features.teamsAiAnswerRelay = false;
        registerAllRoutes([], opts);
        expect(inbound).toBeDefined();

        const message = (text: string, senderAadId: string, messageId: string): InboundTeamsMessage =>
            ({ text, senderAadId, messageId, channelId: 'channel-1' });
        await inbound!(message('how many outgoing commits?', 'sender-first', 'message-1'), () => {});
        await inbound!(message('/select repo 2', 'sender-second', 'message-2'), () => {});
        await inbound!(message('check the build', 'sender-second', 'message-3'), () => {});

        expect(bridge.enqueue).toHaveBeenCalledTimes(2);
        for (const [index, workspaceId, prompt] of [
            [0, 'global-workspace-00', 'how many outgoing commits?'],
            [1, 'ws-second', 'check the build'],
        ] as const) {
            const input = bridge.enqueue.mock.calls[index][0] as CreateTaskInput;
            expect(input).toMatchObject({
                type: 'chat', repoId: workspaceId, priority: 'normal',
                payload: { kind: 'chat', mode: 'sentinel', prompt, workspaceId },
                config: { afterEffortTier: 'medium', model: 'gpt-6.1-sol', reasoningEffort: 'medium' },
            });
            expect((input.config as Record<string, unknown>).effortTier).toBeUndefined();
            expect(isChatPayload(input.payload)).toBe(true);
            const process = await store.getProcess(toQueueProcessId(`teams-task-${index + 1}`), workspaceId);
            expect(process?.status).toBe('completed');
            expect(process?.metadata?.afterEffortTier).toBe('medium');
            expect(process?.conversationTurns).toEqual(expect.arrayContaining([
                expect.objectContaining({ role: 'user', content: expect.stringContaining(prompt) }),
                expect.objectContaining({ role: 'assistant', content: 'A reply' }),
            ]));
        }
        expect(sdk.mockSendMessage).toHaveBeenCalledTimes(2);
        expect(sdk.mockSendMessage.mock.calls.map(([options]) => ({
            model: options.model, reasoningEffort: options.reasoningEffort,
        }))).toEqual([
            { model: 'gpt-6.1-sol', reasoningEffort: 'medium' },
            { model: 'gpt-6.1-sol', reasoningEffort: 'medium' },
        ]);
        expect(send).toHaveBeenCalledTimes(3);
    });

    it.each([undefined, true, false])('resolves Teams relay admission from partial live config (%s)', async relayEnabled => {
        const store = makeStore();
        vi.mocked(store.getWorkspaces).mockResolvedValue([
            { id: 'global-workspace-00', name: 'Global', rootPath: path.join(tmpDir, 'a') },
            { id: 'ws-b', name: 'Beta', rootPath: path.join(tmpDir, 'b') },
        ]);
        const bridge = makeBridge();
        bridge.enqueue.mockImplementation(async (input: CreateTaskInput) => input.id);
        const opts = makeOpts({ store, bridge, dataDir: tmpDir });
        Object.assign(opts.runtimeConfigService!.config, {
            defaultProvider: 'codex',
            codex: { enabled: true },
            features: relayEnabled === undefined ? {} : { teamsAiAnswerRelay: relayEnabled },
            models: { providers: { codex: {
                effortTiers: { medium: { model: 'custom-medium', reasoningEffort: 'high' } },
            } } },
        });

        let inbound: Parameters<TeamsMessagingManager['setMessageHandler']>[0] | undefined;
        vi.spyOn(TeamsMessagingManager.prototype, 'setMessageHandler').mockImplementation(handler => {
            inbound = handler;
        });
        vi.spyOn(TeamsMessagingManager.prototype, 'getStatus').mockReturnValue({
            enabled: true, status: 'connected', teamId: 'team-1', channelId: 'channel-1',
            botName: 'CoC', error: null, serverUrl: null, authStatus: null,
        });
        vi.spyOn(TeamsMessagingManager.prototype, 'sendMessage').mockResolvedValue('reply-id');
        registerAllRoutes([], opts);

        await inbound!({
            text: 'relay question', senderAadId: 'sender-a', messageId: 'message-1', channelId: 'channel-1',
        }, () => {});

        expect(bridge.enqueue).toHaveBeenCalledTimes(1);
        const input = bridge.enqueue.mock.calls[0][0] as CreateTaskInput;
        expect(input).toMatchObject({
            type: 'chat', repoId: 'global-workspace-00',
            payload: { kind: 'chat', mode: 'sentinel', prompt: 'relay question', workspaceId: 'global-workspace-00' },
            config: { afterEffortTier: 'medium', model: 'custom-medium', reasoningEffort: 'high' },
        });
        if (relayEnabled === false) {
            expect(input.id).toBeUndefined();
            expect(input.processId).toBeUndefined();
            await expect(fs.access(path.join(tmpDir, 'repos', 'global-workspace-00', 'teams-answer-relay'))).rejects.toThrow();
        } else {
            expect(input.id).toEqual(expect.any(String));
            expect(input.processId).toBe(toQueueProcessId(input.id!));
            const receipts = await fs.readdir(path.join(tmpDir, 'repos', 'global-workspace-00', 'teams-answer-relay'));
            expect(receipts).toHaveLength(1);
            await inbound!({
                text: 'relay question', senderAadId: 'sender-a', messageId: 'message-1', channelId: 'channel-1',
            }, () => {});
            expect(bridge.enqueue).toHaveBeenCalledOnce();
        }
        expect((input.config as Record<string, unknown>).effortTier).toBeUndefined();
    });

    it('populates the routes array with a large set of routes', () => {
        const routes: Route[] = [];
        registerAllRoutes(routes, makeOpts());
        // There should be many routes registered (well over 30)
        expect(routes.length).toBeGreaterThan(30);
    });

    it.each([
        [undefined, 'ENTRY_NOT_FOUND'],
        [true, 'ENTRY_NOT_FOUND'],
        [false, 'EXPLORER_DELETE_DISABLED'],
    ] as const)('gates Explorer deletion on live features.explorerDelete (%s)', async (explorerDelete, code) => {
        const routes: Route[] = [];
        const opts = makeOpts();
        if (explorerDelete !== undefined) Object.assign(opts.runtimeConfigService!.config.features, { explorerDelete });
        registerAllRoutes(routes, opts);
        const found = findRoute(routes, 'DELETE', '/api/repos/missing-workspace/entry')!;
        const res = fakeRes();
        await found.route.handler({ url: '/api/repos/missing-workspace/entry?path=a.txt' } as any, res, found.match);
        // An unknown workspace never reaches deletion; only the gate decides the code.
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body)).toMatchObject({ code, partial: false, removedEntries: 0 });
    });

    it.each([true, false])('subscribes messaging workers to queue lifecycle events with mirror projections (%s)', async hasMirrorProjections => {
        const queueFacade = makeQueueFacade();
        const store = makeStore();
        if (hasMirrorProjections) {
            store.getProcessOwnerProjection = vi.fn().mockResolvedValue(undefined);
            store.hasRelayRequestAdmission = vi.fn().mockResolvedValue(false);
            store.hasRelayReceiptTurn = vi.fn().mockResolvedValue(false);
            store.getRelayRequestProjection = vi.fn().mockResolvedValue({ found: false, pending: false, closed: false });
        }
        const start = vi.spyOn(SentinelMirrorService.prototype, 'start');
        const dispose = vi.spyOn(SentinelMirrorService.prototype, 'dispose');
        const shutdown = vi.spyOn(WhatsAppMessagingManager.prototype, 'setDisposeHandler');
        const opts = makeOpts({ queueFacade, store, dataDir: tmpDir });
        registerAllRoutes([], opts);

        try {
            expect(queueFacade.on.mock.calls.map(([event]: [string]) => event)).toEqual([
                'taskCompleted', 'taskFailed', 'taskCancelled',
                'taskAdded', 'taskStarted',
                'taskCompleted', 'taskFailed', 'taskCancelled',
                'taskCompleted', 'taskFailed', 'taskCancelled',
                'ralphSessionComplete',
                // Destination remote result capture and its private whole-session recorder.
                'taskCompleted', 'taskFailed', 'taskCancelled',
                'ralphSessionComplete',
                'taskCompleted', 'taskFailed', 'taskCancelled',
                'ralphSessionComplete',
                'taskCompleted', 'taskFailed', 'taskCancelled',
                'taskCompleted', 'taskFailed', 'taskCancelled',
                ...(hasMirrorProjections ? ['taskCompleted', 'taskFailed', 'taskCancelled'] : []),
            ]);
            expect(start).toHaveBeenCalledTimes(hasMirrorProjections ? 1 : 0);
            expect(opts.runtimeConfigService?.onChange).toHaveBeenCalledWith(expect.any(Function));
        } finally {
            shutdown.mock.calls[0][0]();
            await Promise.resolve();
        }
        expect(dispose).toHaveBeenCalledTimes(hasMirrorProjections ? 1 : 0);
    });

    it('restores outbound receipts before result recovery can schedule connector sends', async () => {
        let finishNotices!: () => void;
        const notices = vi.spyOn(MessagingJobNotices.prototype, 'restore').mockImplementation(() =>
            new Promise<void>(resolve => { finishNotices = resolve; }));
        const results = vi.spyOn(DelegatedJobResults.prototype, 'restore').mockResolvedValue(undefined);
        // Destination-only capture never schedules connector sends; keep its private recorder out of this count.
        vi.spyOn(RemoteDelegationResults.prototype, 'restore').mockResolvedValue(undefined);
        registerAllRoutes([], makeOpts());
        expect(notices).toHaveBeenCalledOnce();
        expect(results).not.toHaveBeenCalled();
        finishNotices();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(results).toHaveBeenCalledOnce();
        expect(notices).toHaveBeenCalledOnce();
    });

    it('waits for delegated-result recovery before registering a new tool launch', async () => {
        let finishRestore!: () => void;
        vi.spyOn(DelegatedJobResults.prototype, 'restore').mockImplementation(() =>
            new Promise<void>(resolve => { finishRestore = resolve; }));
        const store = createMockProcessStore();
        await store.addProcess({ id: 'queue_parent', type: 'chat', status: 'completed', startTime: new Date(),
            promptPreview: 'Dispatch', metadata: { mode: 'sentinel', workspaceId: 'ws-parent' } });
        const bridge = makeBridge();
        const queue = { getStats: () => ({ isPaused: false, isAutopilotPaused: false }), enqueue: vi.fn(input => input.id) };
        bridge.getOrCreateBridge = vi.fn();
        bridge.getRepoIdForPath = vi.fn().mockReturnValue('ws-child');
        bridge.registry.getQueueForRepo = vi.fn().mockReturnValue(queue);
        let enqueueChat!: (input: CreateTaskInput) => Promise<string>;
        registerAllRoutes([], makeOpts({ dataDir: tmpDir, store, bridge,
            setEnqueueChat: value => { enqueueChat = value; } }));
        const admitted = enqueueChat({ id: 'child', type: 'chat', priority: 'normal', config: {},
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'Fix it', workspaceId: 'ws-child',
                context: { spawnedFromProcessId: 'queue_parent' } } });
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(new DelegatedJobStore(tmpDir).list('ws-parent')).toEqual([]);
        expect(queue.enqueue).not.toHaveBeenCalled();
        finishRestore();
        await expect(admitted).resolves.toBe('child');
        expect(new DelegatedJobStore(tmpDir).list('ws-parent')).toHaveLength(1);
        expect(queue.enqueue).toHaveBeenCalledOnce();
    });

    it('waits for recovery and registers a Teams command handoff before queue admission', async () => {
        let finishRestore!: () => void;
        vi.spyOn(DelegatedJobResults.prototype, 'restore').mockImplementation(() =>
            new Promise<void>(resolve => { finishRestore = resolve; }));
        const store = createMockProcessStore();
        vi.mocked(store.getWorkspaces).mockResolvedValue([
            { id: 'ws-parent', name: 'Parent', rootPath: path.join(tmpDir, 'parent') },
        ]);
        await store.addProcess({ id: 'queue_parent', type: 'chat', status: 'completed', startTime: new Date(),
            promptPreview: 'Dispatch', metadata: { mode: 'sentinel', workspaceId: 'ws-parent' } });
        new TeamsUserStateStore(tmpDir).update('sender', { selectedRepo: 'ws-parent', selectedTopic: 'queue_parent' });
        const bridge = makeBridge();
        bridge.enqueue.mockImplementation(async (input: CreateTaskInput) => {
            expect(new DelegatedJobStore(tmpDir).list('ws-parent')[0]).toMatchObject({
                parent: { workspaceId: 'ws-parent', processId: 'queue_parent' },
                child: { workspaceId: 'ws-parent', processId: toQueueProcessId(input.id!) },
            });
            return input.id;
        });
        let inbound: Parameters<TeamsMessagingManager['setMessageHandler']>[0] | undefined;
        vi.spyOn(TeamsMessagingManager.prototype, 'setMessageHandler').mockImplementation(handler => { inbound = handler; });
        vi.spyOn(TeamsMessagingManager.prototype, 'getStatus').mockReturnValue({
            enabled: true, status: 'connected', teamId: 'team', channelId: 'channel',
            botName: 'CoC', error: null, serverUrl: null, authStatus: null,
        });
        vi.spyOn(TeamsMessagingManager.prototype, 'sendMessage').mockResolvedValue('reply-id');
        const opts = makeOpts({ dataDir: tmpDir, store, bridge });
        opts.runtimeConfigService!.config.features.teamsAiAnswerRelay = false;
        registerAllRoutes([], opts);
        const admitted = inbound!({ text: '/autopilot inspect', senderAadId: 'sender', messageId: 'command', channelId: 'channel' }, () => {});
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(bridge.enqueue).not.toHaveBeenCalled();
        expect(new DelegatedJobStore(tmpDir).list('ws-parent')).toEqual([]);
        finishRestore();
        await admitted;
        expect(bridge.enqueue).toHaveBeenCalledOnce();
        expect(bridge.enqueue.mock.calls[0][0].payload.context).toMatchObject({
            spawnedFromProcessId: 'queue_parent', messagingOrigin: { connector: 'teams', threadId: 'command' },
        });
        expect(new TeamsUserStateStore(tmpDir).get('sender').selectedTopic).toBe('queue_parent');
    });

    it('routes authorized Notes searches through the required scoped service', async () => {
        const routes: Route[] = [];
        const store = makeStore();
        vi.mocked(store.getWorkspaces).mockResolvedValue([{
            id: 'workspace-1',
            name: 'Workspace One',
            rootPath: '/tmp/workspace-1',
        }]);
        const search = vi.fn().mockResolvedValue({
            results: [{ path: 'note.md', matches: [{ line: 1, text: 'needle' }] }],
            truncated: false,
        });
        registerAllRoutes(routes, makeOpts({
            store,
            dataDir: tmpDir,
            notesSearchService: { search } as any,
        }));
        const found = findRoute(routes, 'GET', '/api/workspaces/workspace-1/notes/search');
        expect(found).toBeDefined();

        const res = fakeRes();
        await found!.route.handler({
            url: '/api/workspaces/workspace-1/notes/search?q=needle',
        } as any, res, found!.match);

        expect(search).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            rootId: 'default',
            absolutePath: path.join(tmpDir, 'repos', 'workspace-1', 'notes'),
            isDefault: true,
            isTaskDerived: false,
        }, 'needle');
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({
            results: [{ path: 'note.md', matches: [{ line: 1, text: 'needle' }] }],
            truncated: false,
        });
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

    it('passes configured Dreams provider, model, and timeout into Dream run tasks', async () => {
        await fs.mkdir(path.join(tmpDir, 'repos', 'ws-dream'), { recursive: true });
        await fs.writeFile(
            path.join(tmpDir, 'repos', 'ws-dream', 'preferences.json'),
            JSON.stringify({ dreams: { enabled: true } }),
            'utf-8',
        );

        const routes: Route[] = [];
        const bridge = makeBridge();
        const store = makeStore();
        vi.mocked(store.getWorkspaces).mockResolvedValue([{ id: 'ws-dream', rootPath: '/repo/ws-dream' } as any]);
        const result = registerAllRoutes(routes, makeOpts({
            dataDir: tmpDir,
            store,
            bridge,
            runtimeConfigService: {
                onChange: vi.fn().mockReturnValue(() => {}),
                config: {
                    dreams: {
                        enabled: true,
                        provider: 'claude',
                        model: 'claude-sonnet-4.6',
                        timeoutMs: 1_800_000,
                        minIdleMs: 60_000,
                    },
                    defaultProvider: 'copilot',
                    codex: { enabled: false },
                    claude: { enabled: true },
                },
            } as any,
        }));

        expect(result.dreamIdleScheduler).toBeDefined();
        const found = findRoute(routes, 'POST', '/api/workspaces/ws-dream/dreams/run');
        expect(found).toBeDefined();
        const res = fakeRes();
        await found!.route.handler(fakeJsonReq('POST', {}), res, found!.match);

        expect(res.statusCode).toBe(202);
        expect(bridge.enqueue).toHaveBeenCalledOnce();
        const input = bridge.enqueue.mock.calls[0][0];
        expect(input).toMatchObject({
            type: 'dream-run',
            repoId: 'ws-dream',
            payload: {
                kind: 'dream-run',
                workspaceId: 'ws-dream',
                trigger: 'manual',
                provider: 'claude',
                model: 'claude-sonnet-4.6',
                timeoutMs: 1_800_000,
            },
            config: {
                model: 'claude-sonnet-4.6',
                timeoutMs: 1_800_000,
            },
        });
    });
});
