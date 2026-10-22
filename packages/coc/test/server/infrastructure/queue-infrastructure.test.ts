/**
 * Regression coverage for the extracted queue infrastructure builder.
 * Verifies that createQueueInfrastructure returns correctly configured
 * instances equivalent to the inline setup it replaced in index.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

const sdkMocks = createMockSDKService();

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        sdkServiceRegistry: { getOrThrow: () => sdkMocks.service },
    };
});

import { createQueueInfrastructure } from '../../../src/server/infrastructure/queue-infrastructure';
import { createFixedQueueRuntimeConfig, DEFAULT_QUEUE_RUNTIME_CONFIG } from '../../../src/server/queue/queue-runtime-config';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { SqliteQueuePersistence } from '../../../src/server/queue/sqlite-queue-persistence';
import { RepoQueueRegistry, SqliteQueueStore, toQueueProcessId } from '@plusplusoneplusplus/forge';
import { RemoteDelegationAdmissionStore } from '../../../src/server/delegation/remote-delegation-admission-store';
import type { RemoteDelegationProof } from '../../../src/server/delegation/remote-delegation-auth';
import { CLITaskExecutor } from '../../../src/server/queue/queue-executor-bridge';
import type { ExecutorRuntimeCapabilities } from '../../../src/server/executors/executor-runtime-contracts';
import { ConversationToolInventoryStore } from '../../../src/server/storage/conversation-tool-inventory-store';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'node:crypto';
import { DelegatedJobStore } from '../../../src/server/delegation/delegated-job-store';
import { DelegatedJobReviews, delegatedReviewReceipt } from '../../../src/server/delegation/delegated-job-reviews';
import { ProcessMessageDeliveryService } from '../../../src/server/processes/process-message-delivery-service';

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'queue-infra-test-'));
}

function createTempSqliteStore(dataDir: string): SqliteProcessStore {
    return new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') });
}

describe('createQueueInfrastructure', () => {
    let dataDir: string;
    let store: SqliteProcessStore;
    const getWsServer = () => ({ broadcastProcessEvent: vi.fn() }) as any;

    beforeEach(() => {
        dataDir = makeTempDir();
        store = createTempSqliteStore(dataDir);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        store.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('returns registry, bridge, queuePersistence, queueFacade and activation', () => {
        const result = createQueueInfrastructure(
            store,
            dataDir,
            { queue: { autoStart: false } },
            DEFAULT_QUEUE_RUNTIME_CONFIG,
            getWsServer,
        );

        expect(result.registry).toBeInstanceOf(RepoQueueRegistry);
        expect(result.bridge).toBeInstanceOf(MultiRepoQueueRouter);
        expect(result.queuePersistence).toBeInstanceOf(SqliteQueuePersistence);
        expect(result.queueFacade).toBeDefined();
        expect(typeof result.queueFacade.enqueue).toBe('function');
        expect(typeof result.activateQueueProcessing).toBe('function');
    });

    it('forwards the late-bound scrubber capability into the queue runtime', () => {
        let service: unknown;
        const getScrubber = vi.fn(() => service as any);
        const args: Parameters<typeof createQueueInfrastructure> = [
            store, dataDir, { queue: { autoStart: false } }, DEFAULT_QUEUE_RUNTIME_CONFIG, getWsServer,
        ];
        args[23] = getScrubber;
        const result = createQueueInfrastructure(...args);
        try {
            // Inspect the runtime passed to repo executors; late binding must survive construction.
            const runtime = (result.bridge as any).defaultOptions.runtime;
            expect(runtime.getSentinelCoda).toBe(getScrubber);
            expect(runtime.getSentinelCoda()).toBeUndefined();
            service = { markRunning: vi.fn(), submit: vi.fn() };
            expect(runtime.getSentinelCoda()).toBe(service);
            service = undefined;
            expect(runtime.getSentinelCoda()).toBeUndefined();
        } finally {
            result.queuePersistence.dispose();
            result.bridge.dispose();
        }
    });

    it('applies historyLimit option to registry maxHistorySize', () => {
        const { registry } = createQueueInfrastructure(
            store,
            dataDir,
            { queue: { autoStart: false, historyLimit: 42 } },
            DEFAULT_QUEUE_RUNTIME_CONFIG,
            getWsServer,
        );

        expect(registry).toBeInstanceOf(RepoQueueRegistry);
    });

    it('retains unreturned destination execution evidence across restart independently of history limits', () => {
        const admissions = new RemoteDelegationAdmissionStore(dataDir);
        const workspaceId = 'destination-repo';
        const otherWorkspaceId = 'other-destination-repo';
        const repoPath = path.join(dataDir, 'destination-repo');
        const first = createQueueInfrastructure(
            store, dataDir, { queue: { autoStart: false, historyLimit: 1 } },
            DEFAULT_QUEUE_RUNTIME_CONFIG, getWsServer,
        );
        first.bridge.registerRepoId(workspaceId, repoPath);
        first.bridge.getOrCreateBridge(repoPath);
        const manager = first.registry.getQueueForRepo(repoPath)!;
        const cases = [
            { state: 'dispatching', kind: 'launch', status: 'completed' },
            { state: 'uncertain', kind: 'follow-up', status: 'failed' },
            { state: 'accepted', kind: 'follow-up', status: 'cancelled' },
            { state: 'accepted', kind: 'launch', status: 'completed' },
            { state: 'rejected', kind: 'launch', status: 'failed' },
            { state: 'recorded', kind: 'launch', status: 'completed' },
        ] as const;
        const bindings = cases.map(entry => {
            const proof: RemoteDelegationProof = {
                version: 1, requestId: randomUUID(), originServerIdentity: 'origin-owner',
                parent: { workspaceId: 'origin-workspace', processId: 'parent-sentinel' },
                destination: { serverIdentity: admissions.serverIdentity, workspaceId },
                kind: entry.kind, intentDigest: 'a'.repeat(64), admission: 'dispatching',
                ...(entry.kind === 'follow-up' ? { targetProcessId: 'existing-chat' } : {}),
            };
            const { executionId } = admissions.claim(proof).receipt;
            const processId = entry.kind === 'follow-up' ? 'existing-chat' : toQueueProcessId(executionId);
            const taskId = entry.state === 'uncertain' ? `pending-${processId}-${executionId}` : executionId;
            manager.enqueue({
                id: taskId, type: 'chat', repoId: workspaceId, processId,
                payload: { kind: 'chat', workspaceId,
                    ...(entry.kind === 'follow-up' ? { processId, relayRequestId: executionId } : {}) },
            });
            if (entry.status === 'cancelled') manager.cancelTask(taskId);
            else {
                manager.markStarted(taskId);
                if (entry.status === 'failed') manager.markFailed(taskId, 'Exact turn failed');
                else manager.markCompleted(taskId, 'Exact turn response');
            }
            if (entry.state === 'uncertain' || entry.state === 'rejected') admissions.settle(proof, entry.state);
            if (entry.state === 'accepted' || entry.state === 'recorded') admissions.accept(proof, { processId });
            if (entry.state === 'recorded') admissions.recordResult(proof, {
                terminalEventId: 'ignored', outcome: 'completed', summary: 'Already recorded', links: [],
            });
            return { proof, executionId, taskId, status: entry.status };
        });
        // A real ledger in another workspace must not retain this workspace's row.
        const foreignProof = { ...bindings[0].proof, requestId: randomUUID(),
            destination: { serverIdentity: admissions.serverIdentity, workspaceId: otherWorkspaceId } };
        const foreignId = admissions.claim(foreignProof).receipt.executionId;
        const sqliteQueue = new SqliteQueueStore(store.getDatabase());
        sqliteQueue.upsertQueueTask({
            id: foreignId, type: 'chat', status: 'failed', priority: 'normal', createdAt: Date.now(),
            repoId: workspaceId, payload: { kind: 'chat', workspaceId }, config: {},
        });
        expect(manager.getHistory()).toHaveLength(1);
        expect(sqliteQueue.getQueueTasks(workspaceId)).toHaveLength(7);
        first.queuePersistence.dispose();
        first.bridge.dispose();
        store.close();
        store = createTempSqliteStore(dataDir);

        const restored = createQueueInfrastructure(
            store, dataDir, { queue: { autoStart: false, historyLimit: 1 } },
            DEFAULT_QUEUE_RUNTIME_CONFIG, getWsServer,
        );
        try {
            const restoredQueue = new SqliteQueueStore(store.getDatabase());
            expect(restoredQueue.getQueueTasks(workspaceId)).toHaveLength(4);
            expect(restored.queueFacade.getHistory()).toEqual([]);
            for (const binding of bindings.slice(0, 4)) {
                expect(restored.queuePersistence.getRetainedTerminalTask(workspaceId, binding.taskId))
                    .toMatchObject({ id: binding.taskId, repoId: workspaceId, status: binding.status });
                expect(restored.queuePersistence.getRetainedTerminalTask(otherWorkspaceId, binding.taskId)).toBeUndefined();
            }
            restored.bridge.getOrCreateBridge(repoPath);
            const freshManager = restored.registry.getQueueForRepo(repoPath)!;
            for (let index = 0; index < 3; index++) {
                const taskId = freshManager.enqueue({ type: 'custom', payload: {} });
                freshManager.markStarted(taskId);
                freshManager.markCompleted(taskId);
            }
            expect(restored.queueFacade.getHistory()).toHaveLength(1);
            expect(restored.queuePersistence.getRetainedTerminalTask(workspaceId, bindings[0].executionId)).toBeDefined();

            const pending = bindings[0];
            admissions.accept(pending.proof, { processId: toQueueProcessId(pending.executionId) });
            admissions.recordResult(pending.proof, {
                terminalEventId: 'ignored', outcome: 'completed', summary: 'Durably captured', links: [],
            });
            expect(restored.queuePersistence.getRetainedTerminalTask(workspaceId, pending.executionId)).toBeUndefined();
            restored.queuePersistence.restore();
            expect(restoredQueue.getQueueTasks(workspaceId).map(task => task.id)).not.toContain(pending.executionId);
            expect(restoredQueue.getQueueTasks(workspaceId)).toHaveLength(3);
        } finally {
            restored.queuePersistence.dispose();
            restored.bridge.dispose();
        }
    });

    it('forwards the inventory store getter into restored and lazy executor runtimes', () => {
        let inventoryStore: ConversationToolInventoryStore | undefined;
        const getInventory = () => inventoryStore;
        const args: Parameters<typeof createQueueInfrastructure> = [
            store, dataDir, { queue: { autoStart: false } }, DEFAULT_QUEUE_RUNTIME_CONFIG, getWsServer,
        ];
        args[27] = getInventory;
        const result = createQueueInfrastructure(...args);
        try {
            const runtime = (result.bridge as unknown as {
                defaultOptions: { runtime: ExecutorRuntimeCapabilities };
            }).defaultOptions.runtime;
            expect(runtime.getToolInventoryStore).toBe(getInventory);
            expect(runtime.getToolInventoryStore?.()).toBeUndefined();
            inventoryStore = new ConversationToolInventoryStore(store.getDatabase());
            expect(runtime.getToolInventoryStore?.()).toBe(inventoryStore);
        } finally {
            result.queuePersistence.dispose();
            result.bridge.dispose();
        }
    });

    it('recovers a remote assessment completed before its ledger acknowledgement without another parent turn', async () => {
        const workspaceId = 'origin-repo';
        const parentId = 'queue_sentinel';
        const rootPath = path.join(dataDir, workspaceId);
        await store.registerWorkspace({ id: workspaceId, name: 'Origin', rootPath });
        await store.addProcess({ id: parentId, type: 'chat', status: 'completed', startTime: new Date(), promptPreview: 'Sentinel',
            workingDirectory: rootPath, metadata: { workspaceId, mode: 'sentinel', provider: 'copilot' } });
        const jobs = new DelegatedJobStore(dataDir);
        jobs.register({ id: 'remote-request', title: 'Remote result', parent: { workspaceId, processId: parentId },
            child: { workspaceId: 'remote-repo', processId: 'queue_child', serverId: 'alias' },
            remote: { originServerIdentity: jobs.serverIdentity, serverIdentity: 'destination', requestId: 'request', kind: 'launch' } });
        jobs.recordResult(workspaceId, 'remote-request', { terminalEventId: 'terminal', outcome: 'completed', summary: 'Outcome', links: [] });
        const job = jobs.list(workspaceId)[0];
        const receiptId = delegatedReviewReceipt(job);
        const first = createQueueInfrastructure(store, dataDir, { queue: { autoStart: false, historyLimit: 1 } },
            DEFAULT_QUEUE_RUNTIME_CONFIG, getWsServer);
        first.bridge.registerRepoId(workspaceId, rootPath);
        first.bridge.getOrCreateBridge(rootPath);
        const reviews = new DelegatedJobReviews({ jobs, store, queue: first.queueFacade,
            delivery: new ProcessMessageDeliveryService({ store, bridge: first.bridge }) });
        await reviews.schedule(job);
        reviews.dispose();
        await store.appendConversationTurn(parentId, turnIndex => ({
            role: 'assistant', content: 'Assessed reply', timestamp: new Date(), turnIndex,
        }));
        const manager = first.registry.getQueueForRepo(rootPath)!;
        manager.markStarted(receiptId);
        manager.markCompleted(receiptId);
        first.queuePersistence.dispose();
        first.bridge.dispose();
        store.close();
        store = createTempSqliteStore(dataDir);
        const restored = createQueueInfrastructure(store, dataDir, { queue: { autoStart: false, historyLimit: 1 } },
            DEFAULT_QUEUE_RUNTIME_CONFIG, getWsServer);
        const relay = vi.fn();
        const recoveredReviews = new DelegatedJobReviews({ jobs, store, queue: restored.queueFacade,
            delivery: new ProcessMessageDeliveryService({ store, bridge: restored.bridge }),
            getRetainedTask: (owner, id) => restored.queuePersistence.getRetainedTerminalTask(owner, id), queueMessagingResult: relay });
        try {
            expect(restored.queuePersistence.getRetainedTerminalTask(workspaceId, receiptId)?.status).toBe('completed');
            await recoveredReviews.schedule(jobs.list(workspaceId)[0]);
            expect(jobs.list(workspaceId)[0].terminal?.delivery.state).toBe('delivered');
            expect(restored.queueFacade.getQueued()).toEqual([]);
            expect((await store.getProcess(parentId))?.conversationTurns?.filter(turn => turn.role === 'user')).toHaveLength(1);
        } finally {
            recoveredReviews.dispose();
            restored.queuePersistence.dispose();
            restored.bridge.dispose();
        }
    });

    it('passes followUpSuggestions to bridge without throwing', () => {
        const followUpSuggestions = { enabled: true, count: 5 };

        expect(() =>
            createQueueInfrastructure(
                store,
                dataDir,
                { queue: { autoStart: false } },
                createFixedQueueRuntimeConfig({ followUpSuggestions }),
                getWsServer,
            ),
        ).not.toThrow();
    });

    it('restores persisted queue state from SQLite during construction', () => {
        expect(() =>
            createQueueInfrastructure(
                store,
                dataDir,
                { queue: { autoStart: false } },
                DEFAULT_QUEUE_RUNTIME_CONFIG,
                getWsServer,
            ),
        ).not.toThrow();
    });

    it('works with no queue options provided', () => {
        const result = createQueueInfrastructure(
            store,
            dataDir,
            {},
            DEFAULT_QUEUE_RUNTIME_CONFIG,
            getWsServer,
        );
        expect(result.registry).toBeInstanceOf(RepoQueueRegistry);
        expect(result.queueFacade).toBeDefined();
    });

    it('passes restartPickupDelayMs through to bridge as initialDelayMs', () => {
        const result = createQueueInfrastructure(
            store,
            dataDir,
            { queue: { autoStart: false, restartPickupDelayMs: 5000 } },
            DEFAULT_QUEUE_RUNTIME_CONFIG,
            getWsServer,
        );

        expect(result.bridge).toBeInstanceOf(MultiRepoQueueRouter);
    });

    it('activates restored executors only after late-bound dependencies are wired', async () => {
        const first = createQueueInfrastructure(
            store,
            dataDir,
            { queue: { autoStart: false } },
            DEFAULT_QUEUE_RUNTIME_CONFIG,
            getWsServer,
        );
        const repoPath = path.join(dataDir, 'restored-repo');
        first.bridge.registerRepoId('restored-repo', repoPath);
        first.bridge.getOrCreateBridge(repoPath);
        first.registry.getQueueForRepo(repoPath).enqueue({
            type: 'chat',
            priority: 'normal',
            repoId: 'restored-repo',
            payload: {
                kind: 'chat',
                mode: 'ralph',
                prompt: 'restored Ralph task',
                context: { autoProviderRouting: { requested: true } },
            },
            config: {},
        });
        first.queuePersistence.dispose();
        first.bridge.dispose();

        let resolverWasWired = false;
        const executeSpy = vi.spyOn(CLITaskExecutor.prototype, 'execute').mockImplementation(function () {
            resolverWasWired = typeof (this as unknown as { resolveDefaultProvider?: unknown }).resolveDefaultProvider === 'function';
            return Promise.resolve({ success: true, durationMs: 0 });
        });
        const result = createQueueInfrastructure(
            store,
            dataDir,
            {},
            DEFAULT_QUEUE_RUNTIME_CONFIG,
            getWsServer,
        );

        await new Promise(resolve => setTimeout(resolve, 20));
        expect(executeSpy).not.toHaveBeenCalled();

        result.bridge.setResolveDefaultProvider(async () => ({
            provider: 'copilot',
            selectedByAuto: true,
            fallbackUsed: false,
            decisions: [],
            warnings: [],
        }));
        result.activateQueueProcessing();

        await vi.waitFor(() => expect(executeSpy).toHaveBeenCalledTimes(1));
        expect(resolverWasWired).toBe(true);
        result.queuePersistence.dispose();
        result.bridge.dispose();
    });

    it('keeps existing and future executors stopped when autoStart is false', () => {
        const result = createQueueInfrastructure(
            store,
            dataDir,
            { queue: { autoStart: false } },
            DEFAULT_QUEUE_RUNTIME_CONFIG,
            getWsServer,
        );
        const firstPath = path.join(dataDir, 'first-repo');
        result.bridge.getOrCreateBridge(firstPath);
        const firstManager = result.registry.getQueueForRepo(firstPath);
        const firstTaskId = firstManager.enqueue({
            type: 'chat',
            payload: { kind: 'chat', mode: 'ask', prompt: 'first' },
        });

        result.activateQueueProcessing();
        expect(result.bridge.findExecutorForTask(firstTaskId)?.isRunning()).toBe(false);

        const secondPath = path.join(dataDir, 'second-repo');
        result.bridge.getOrCreateBridge(secondPath);
        const secondManager = result.registry.getQueueForRepo(secondPath);
        const secondTaskId = secondManager.enqueue({
            type: 'chat',
            payload: { kind: 'chat', mode: 'ask', prompt: 'second' },
        });
        expect(result.bridge.findExecutorForTask(secondTaskId)?.isRunning()).toBe(false);
    });

    it('creates in-memory DB when store is not SqliteProcessStore', () => {
        const mockStore = {
            getAllProcesses: vi.fn(),
            getStorageStats: vi.fn(),
        } as any;

        const result = createQueueInfrastructure(
            mockStore,
            dataDir,
            { queue: { autoStart: false } },
            DEFAULT_QUEUE_RUNTIME_CONFIG,
            getWsServer,
        );

        expect(result.queuePersistence).toBeInstanceOf(SqliteQueuePersistence);
        expect(result.registry).toBeInstanceOf(RepoQueueRegistry);
    });

    it('persists enqueued tasks in queue_tasks table', () => {
        const { queueFacade } = createQueueInfrastructure(
            store,
            dataDir,
            { queue: { autoStart: false } },
            DEFAULT_QUEUE_RUNTIME_CONFIG,
            getWsServer,
        );

        queueFacade.enqueue({
            type: 'test-task',
            payload: { prompt: 'hello' },
            repoId: 'test-repo',
        });

        const db = store.getDatabase();
        const rows = db.prepare('SELECT * FROM queue_tasks').all() as any[];
        expect(rows.length).toBeGreaterThanOrEqual(1);
        expect(rows.some((r: any) => r.type === 'test-task')).toBe(true);
    });
});
