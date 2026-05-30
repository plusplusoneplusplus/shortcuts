/**
 * MultiRepoQueueRouter Tests
 *
 * Tests for MultiRepoQueueRouter:
 * - Lazy creation of per-repo bridges
 * - Path normalization (dedup)
 * - Independent bridges per repo
 * - repoId registration and lookup
 * - Auto-registration via getOrCreateBridge
 * - queueChange event forwarding with repoPath and repoId
 * - dispose() cleanup
 *
 * Uses real RepoQueueRegistry and TaskQueueManager (pure in-memory).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
    RepoQueueRegistry,
    TaskQueueManager,
} from '@plusplusoneplusplus/forge';

// SDK mock — needed because createQueueExecutorBridge → CLITaskExecutor → getCopilotSDKService
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore } from '../helpers/mock-process-store';

const sdkMocks = createMockSDKService();

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        sdkServiceRegistry: { getOrThrow: () => sdkMocks.service },
    };
});

import { MultiRepoQueueRouter } from '../../src/server/queue/multi-repo-queue-router';
import * as queueExecutorBridgeMod from '../../src/server/queue/queue-executor-bridge';

// ============================================================================
// Helpers
// ============================================================================

function createBridge(options?: { maxConcurrency?: number; autoStart?: boolean }) {
    const registry = new RepoQueueRegistry();
    const store = createMockProcessStore();
    const bridge = new MultiRepoQueueRouter(registry, store, {
        autoStart: false,
        ...options,
    });
    return { registry, store, bridge };
}

function repoId(id: string): string {
    return `ws-${id}`;
}

// ============================================================================
// Tests
// ============================================================================

describe('MultiRepoQueueRouter', () => {
    beforeEach(() => {
        sdkMocks.resetAll();
    });

    // --------------------------------------------------------------------
    // Lazy creation
    // --------------------------------------------------------------------

    describe('lazy creation', () => {
        it('getOrCreateBridge called twice returns the same instance', () => {
            const { bridge, registry } = createBridge();

            const b1 = bridge.getOrCreateBridge('/repo/a');
            const b2 = bridge.getOrCreateBridge('/repo/a');

            expect(b1).toBe(b2);
            expect(registry.hasRepo('/repo/a')).toBe(true);

            bridge.dispose();
        });

        it('creates a queue in the registry on first call', () => {
            const { bridge, registry } = createBridge();

            expect(registry.hasRepo('/repo/x')).toBe(false);
            bridge.getOrCreateBridge('/repo/x');
            expect(registry.hasRepo('/repo/x')).toBe(true);

            bridge.dispose();
        });
    });

    // --------------------------------------------------------------------
    // Path normalization
    // --------------------------------------------------------------------

    describe('path normalization', () => {
        it('normalizes paths so /repo/a/../a and /repo/a share the same bridge', () => {
            const { bridge } = createBridge();

            const b1 = bridge.getOrCreateBridge('/repo/a/../a');
            const b2 = bridge.getOrCreateBridge('/repo/a');

            expect(b1).toBe(b2);
            expect(bridge.getAllBridges().size).toBe(1);

            bridge.dispose();
        });
    });

    // --------------------------------------------------------------------
    // Independent bridges
    // --------------------------------------------------------------------

    describe('independent bridges', () => {
        it('different repos get different bridge instances', () => {
            const { bridge } = createBridge();

            const bA = bridge.getOrCreateBridge('/repo/a');
            const bB = bridge.getOrCreateBridge('/repo/b');

            expect(bA).not.toBe(bB);
            expect(bridge.getAllBridges().size).toBe(2);

            bridge.dispose();
        });
    });

    // --------------------------------------------------------------------
    // workingDirectory injection
    // --------------------------------------------------------------------

    describe('workingDirectory injection', () => {
        it('injects rootPath as workingDirectory into per-repo bridge options', () => {
            const { bridge } = createBridge();
            const spy = vi.spyOn(queueExecutorBridgeMod, 'createQueueExecutorBridge');

            bridge.getOrCreateBridge('/repo/wd-test');
            const resolvedPath = require('path').resolve('/repo/wd-test');

            expect(spy).toHaveBeenCalledTimes(1);
            const passedOptions = spy.mock.calls[0][2] as Record<string, unknown>;
            expect(passedOptions.workingDirectory).toBe(resolvedPath);

            spy.mockRestore();
            bridge.dispose();
        });

        it('per-repo workingDirectory overrides global defaultOptions', () => {
            const registry = new (require('@plusplusoneplusplus/forge').RepoQueueRegistry)();
            const store = createMockProcessStore();
            const bridge = new MultiRepoQueueRouter(registry, store, {
                autoStart: false,
                workingDirectory: '/global/default',
            });
            const spy = vi.spyOn(queueExecutorBridgeMod, 'createQueueExecutorBridge');

            bridge.getOrCreateBridge('/repo/override');
            const resolvedPath = require('path').resolve('/repo/override');

            expect(spy).toHaveBeenCalledTimes(1);
            const passedOptions = spy.mock.calls[0][2] as Record<string, unknown>;
            expect(passedOptions.workingDirectory).toBe(resolvedPath);

            spy.mockRestore();
            bridge.dispose();
        });

        it('preserves other defaultOptions when injecting workingDirectory', () => {
            const registry = new (require('@plusplusoneplusplus/forge').RepoQueueRegistry)();
            const store = createMockProcessStore();
            const bridge = new MultiRepoQueueRouter(registry, store, {
                autoStart: false,
                sharedConcurrency: 3,
            });
            const spy = vi.spyOn(queueExecutorBridgeMod, 'createQueueExecutorBridge');

            bridge.getOrCreateBridge('/repo/preserve');
            const resolvedPath = require('path').resolve('/repo/preserve');

            expect(spy).toHaveBeenCalledTimes(1);
            const passedOptions = spy.mock.calls[0][2] as Record<string, unknown>;
            expect(passedOptions.workingDirectory).toBe(resolvedPath);
            expect(passedOptions.sharedConcurrency).toBe(3);
            expect(passedOptions.autoStart).toBe(false);

            spy.mockRestore();
            bridge.dispose();
        });
    });

    // --------------------------------------------------------------------
    // registerRepoId + getBridgeByRepoId
    // --------------------------------------------------------------------

    describe('registerRepoId + getBridgeByRepoId', () => {
        it('returns the correct bridge after registerRepoId + getOrCreateBridge', () => {
            const { bridge } = createBridge();
            const rootPath = '/repo/registered';
            const workspaceId = repoId('registered');

            bridge.registerRepoId(workspaceId, rootPath);
            const created = bridge.getOrCreateBridge(rootPath);

            expect(bridge.getBridgeByRepoId(workspaceId)).toBe(created);

            bridge.dispose();
        });

        it('returns undefined for unknown repoId', () => {
            const { bridge } = createBridge();

            expect(bridge.getBridgeByRepoId('0000000000000000')).toBeUndefined();

            bridge.dispose();
        });

        it('registerRepoId before getOrCreateBridge allows later lookup', () => {
            const { bridge } = createBridge();
            const rootPath = '/repo/pre-registered';
            const workspaceId = repoId('pre-registered');

            // Register first, create bridge later
            bridge.registerRepoId(workspaceId, rootPath);
            expect(bridge.getBridgeByRepoId(workspaceId)).toBeUndefined(); // no bridge yet

            const created = bridge.getOrCreateBridge(rootPath);
            expect(bridge.getBridgeByRepoId(workspaceId)).toBe(created);

            bridge.dispose();
        });
    });

    // --------------------------------------------------------------------
    // Auto-registration
    // --------------------------------------------------------------------

    describe('auto-registration', () => {
        it('getOrCreateBridge does NOT auto-register repoId without prior registerRepoId', () => {
            const { bridge } = createBridge();
            const rootPath = '/repo/auto';
            const resolvedPath = require('path').resolve(rootPath);
            const workspaceId = repoId('auto');

            bridge.getOrCreateBridge(rootPath);

            // No auto-registration: getBridgeByRepoId returns undefined
            expect(bridge.getBridgeByRepoId(workspaceId)).toBeUndefined();

            bridge.dispose();
        });

        it('getOrCreateBridge picks up repoId when registerRepoId was called first', () => {
            const { bridge } = createBridge();
            const rootPath = '/repo/auto';
            const workspaceId = repoId('auto');

            bridge.registerRepoId(workspaceId, rootPath);
            const created = bridge.getOrCreateBridge(rootPath);

            expect(bridge.getBridgeByRepoId(workspaceId)).toBe(created);

            bridge.dispose();
        });
    });

    // --------------------------------------------------------------------
    // queueChange event forwarding
    // --------------------------------------------------------------------

    describe('queueChange event forwarding', () => {
        it('emits queueChange with repoPath and repoId when a task is enqueued', async () => {
            const { bridge, registry } = createBridge();
            const rootPath = '/repo/events';
            const resolvedPath = require('path').resolve(rootPath);
            // Without registerRepoId, getRepoIdForPath falls back to the normalized path
            const expectedRepoId = resolvedPath;

            // Create the bridge (which also creates the queue in the registry)
            bridge.getOrCreateBridge(rootPath);

            // Listen for the forwarded event
            const events: any[] = [];
            bridge.on('queueChange', (event: any) => {
                events.push(event);
            });

            // Enqueue a task on the registry's queue — this triggers 'change' on the queue,
            // which the registry forwards as 'queueChange', which MultiRepoQueueRouter
            // intercepts and re-emits with augmented payload.
            const queue = registry.getQueueForRepo(resolvedPath);
            queue.enqueue({
                type: 'custom',
                priority: 'medium',
                payload: { prompt: 'test' },
            });

            // Events are synchronous
            expect(events.length).toBeGreaterThan(0);

            const addEvent = events.find((e) => e.type === 'added');
            expect(addEvent).toBeDefined();
            expect(addEvent.repoPath).toBe(resolvedPath);
            expect(addEvent.repoId).toBe(expectedRepoId);

            bridge.dispose();
        });
    });

    // --------------------------------------------------------------------
    // getAllBridges
    // --------------------------------------------------------------------

    describe('getAllBridges', () => {
        it('returns a shallow copy keyed by normalized rootPath', () => {
            const { bridge } = createBridge();

            bridge.getOrCreateBridge('/repo/one');
            bridge.getOrCreateBridge('/repo/two');

            const all = bridge.getAllBridges();
            expect(all.size).toBe(2);

            // It's a copy — modifying it doesn't affect internal state
            all.clear();
            expect(bridge.getAllBridges().size).toBe(2);

            bridge.dispose();
        });
    });

    // --------------------------------------------------------------------
    // per-process bridge dispatch
    // --------------------------------------------------------------------

    describe('per-process bridge dispatch', () => {
        it('routes executeFollowUp to the first live bridge and forwards reasoningEffort', async () => {
            const { bridge } = createBridge();
            const repoA = bridge.getOrCreateBridge('/repo/follow-a');
            const repoB = bridge.getOrCreateBridge('/repo/follow-b');

            vi.spyOn(repoA, 'isSessionAlive').mockResolvedValue(false);
            vi.spyOn(repoB, 'isSessionAlive').mockResolvedValue(true);
            const executeA = vi.spyOn(repoA, 'executeFollowUp').mockResolvedValue(undefined);
            const executeB = vi.spyOn(repoB, 'executeFollowUp').mockResolvedValue(undefined);

            await bridge.executeFollowUp(
                'proc-follow',
                'follow-up',
                undefined,
                'ask',
                'immediate',
                ['image-1'],
                ['impl'],
                'gpt-5.5',
                undefined,
                'high',
            );

            expect(executeA).not.toHaveBeenCalled();
            expect(executeB).toHaveBeenCalledWith(
                'proc-follow',
                'follow-up',
                undefined,
                'ask',
                'immediate',
                ['image-1'],
                ['impl'],
                'gpt-5.5',
                undefined,
                'high',
            );

            bridge.dispose();
        });

        it('throws when no bridge accepts a follow-up process', async () => {
            const { bridge } = createBridge();
            const repoA = bridge.getOrCreateBridge('/repo/follow-miss-a');
            const repoB = bridge.getOrCreateBridge('/repo/follow-miss-b');

            vi.spyOn(repoA, 'isSessionAlive').mockResolvedValue(false);
            vi.spyOn(repoB, 'isSessionAlive').mockResolvedValue(false);
            const executeA = vi.spyOn(repoA, 'executeFollowUp').mockResolvedValue(undefined);
            const executeB = vi.spyOn(repoB, 'executeFollowUp').mockResolvedValue(undefined);

            await expect(bridge.executeFollowUp('proc-missing', 'follow-up'))
                .rejects.toThrow('No active session found for process proc-missing');
            expect(executeA).not.toHaveBeenCalled();
            expect(executeB).not.toHaveBeenCalled();

            bridge.dispose();
        });

        it('steerProcess stops after the first bridge that accepts the process', async () => {
            const { bridge } = createBridge();
            const repoA = bridge.getOrCreateBridge('/repo/steer-a');
            const repoB = bridge.getOrCreateBridge('/repo/steer-b');
            const repoC = bridge.getOrCreateBridge('/repo/steer-c');

            const steerA = vi.spyOn(repoA, 'steerProcess').mockResolvedValue(false);
            const steerB = vi.spyOn(repoB, 'steerProcess').mockResolvedValue(true);
            const steerC = vi.spyOn(repoC, 'steerProcess').mockResolvedValue(true);

            await expect(bridge.steerProcess('proc-steer', 'go left')).resolves.toBe(true);
            expect(steerA).toHaveBeenCalledWith('proc-steer', 'go left');
            expect(steerB).toHaveBeenCalledWith('proc-steer', 'go left');
            expect(steerC).not.toHaveBeenCalled();

            bridge.dispose();
        });

        it('ask-user helpers return true from the first bridge that resolves the request', async () => {
            const { bridge } = createBridge();
            const repoA = bridge.getOrCreateBridge('/repo/ask-a');
            const repoB = bridge.getOrCreateBridge('/repo/ask-b');
            const answers = [{ questionId: 'q1', answer: 'yes' }];

            vi.spyOn(repoA, 'answerAskUserQuestion').mockResolvedValue(false);
            const answerB = vi.spyOn(repoB, 'answerAskUserQuestion').mockResolvedValue(true);
            await expect(bridge.answerAskUserQuestion('proc-ask', 'q1', 'yes')).resolves.toBe(true);
            expect(answerB).toHaveBeenCalledWith('proc-ask', 'q1', 'yes');

            vi.spyOn(repoA, 'skipAskUserQuestion').mockResolvedValue(false);
            const skipB = vi.spyOn(repoB, 'skipAskUserQuestion').mockResolvedValue(true);
            await expect(bridge.skipAskUserQuestion('proc-ask', 'q1')).resolves.toBe(true);
            expect(skipB).toHaveBeenCalledWith('proc-ask', 'q1');

            vi.spyOn(repoA, 'answerAskUserQuestions').mockResolvedValue(false);
            const batchB = vi.spyOn(repoB, 'answerAskUserQuestions').mockResolvedValue(true);
            await expect(bridge.answerAskUserQuestions('proc-ask', 'batch-1', answers)).resolves.toBe(true);
            expect(batchB).toHaveBeenCalledWith('proc-ask', 'batch-1', answers);

            bridge.dispose();
        });
    });

    // --------------------------------------------------------------------
    // createAggregateQueueFacade — resolveManager repoId-to-path lookup
    // --------------------------------------------------------------------

    describe('createAggregateQueueFacade resolveManager', () => {
        it('enqueues into the correct repo queue when input carries a repoId (not a path)', () => {
            const { bridge, registry } = createBridge();
            const rootPath = '/repo/schedule-test';
            const resolvedPath = require('path').resolve(rootPath);
            const workspaceId = repoId('schedule-test');

            // Register repoId first, then create the bridge
            bridge.registerRepoId(workspaceId, rootPath);
            bridge.getOrCreateBridge(rootPath);

            const facade = bridge.createAggregateQueueFacade();

            // Enqueue with only repoId set (simulating a schedule-triggered task)
            const taskId = facade.enqueue({
                type: 'custom',
                priority: 'normal',
                payload: { prompt: 'hello' },
                repoId: workspaceId,
            } as any);

            // The task must appear in the queue for the correct repo, not a phantom queue
            expect(facade.getTask(taskId)).toBeDefined();

            // The registry must NOT have created a phantom repo keyed by the raw hex repoId
            expect(registry.hasRepo(workspaceId)).toBe(false);

            // The real repo must still exist
            expect(registry.hasRepo(resolvedPath)).toBe(true);

            bridge.dispose();
        });

        it('falls back to workingDirectory when repoId is not registered', () => {
            const { bridge, registry } = createBridge();
            const rootPath = '/repo/fallback-test';
            const resolvedPath = require('path').resolve(rootPath);

            bridge.getOrCreateBridge(rootPath);
            const facade = bridge.createAggregateQueueFacade();

            // Use an unknown repoId but provide workingDirectory as fallback
            const taskId = facade.enqueue({
                type: 'custom',
                priority: 'normal',
                payload: { prompt: 'world', workingDirectory: resolvedPath },
                repoId: 'aaaaaaaaaaaaaaaa', // unknown id
            } as any);

            expect(facade.getTask(taskId)).toBeDefined();
            // Phantom repo for the unknown hex id must not exist
            expect(registry.hasRepo('aaaaaaaaaaaaaaaa')).toBe(false);

            bridge.dispose();
        });
    });

    // --------------------------------------------------------------------
    // dispose
    // --------------------------------------------------------------------

    describe('dispose', () => {
        it('clears all bridges and internal state', () => {
            const { bridge } = createBridge();

            bridge.getOrCreateBridge('/repo/a');
            bridge.getOrCreateBridge('/repo/b');

            expect(bridge.getAllBridges().size).toBe(2);

            bridge.dispose();

            expect(bridge.getAllBridges().size).toBe(0);
        });

        it('allows creating new bridges after dispose', () => {
            const registry = new RepoQueueRegistry();
            const store = createMockProcessStore();
            const mrBridge = new MultiRepoQueueRouter(registry, store, { autoStart: false });

            mrBridge.getOrCreateBridge('/repo/a');
            mrBridge.dispose();

            // After dispose, the registry is also disposed. Creating a fresh bridge
            // requires a new instance of MultiRepoQueueRouter.
            const registry2 = new RepoQueueRegistry();
            const mrBridge2 = new MultiRepoQueueRouter(registry2, store, { autoStart: false });
            const b = mrBridge2.getOrCreateBridge('/repo/c');

            expect(b).toBeDefined();
            expect(mrBridge2.getAllBridges().size).toBe(1);

            mrBridge2.dispose();
        });
    });

    // ========================================================================
    // findTaskByProcessId
    // ========================================================================

    describe('findTaskByProcessId', () => {
        it('finds a queued task by processId and returns status', () => {
            const { bridge } = createBridge();
            bridge.getOrCreateBridge('/repo/find-test');
            const manager = bridge.registry.getQueueForRepo('/repo/find-test');

            const taskId = manager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', prompt: 'Hello' },
                config: {},
                processId: 'proc-queued',
                displayName: 'Chat',
            });

            const found = bridge.findTaskByProcessId('proc-queued');
            expect(found).toEqual({ id: taskId, type: 'chat', status: 'queued' });

            bridge.dispose();
        });

        it('finds a running task by processId and returns status "running"', () => {
            const { bridge } = createBridge();
            bridge.getOrCreateBridge('/repo/find-running');
            const manager = bridge.registry.getQueueForRepo('/repo/find-running');

            const taskId = manager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', prompt: 'Hello' },
                config: {},
                processId: 'proc-running',
                displayName: 'Chat',
            });
            manager.markStarted(taskId);

            const found = bridge.findTaskByProcessId('proc-running');
            expect(found).toEqual({ id: taskId, type: 'chat', status: 'running' });

            bridge.dispose();
        });

        it('finds a completed task by processId and returns status "completed"', () => {
            const { bridge } = createBridge();
            bridge.getOrCreateBridge('/repo/find-completed');
            const manager = bridge.registry.getQueueForRepo('/repo/find-completed');

            const taskId = manager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', prompt: 'Hello' },
                config: {},
                processId: 'proc-completed',
                displayName: 'Chat',
            });
            manager.markStarted(taskId);
            manager.markCompleted(taskId);

            const found = bridge.findTaskByProcessId('proc-completed');
            expect(found).toEqual({ id: taskId, type: 'chat', status: 'completed' });

            bridge.dispose();
        });

        it('returns undefined when processId is not found', () => {
            const { bridge } = createBridge();
            bridge.getOrCreateBridge('/repo/find-test-2');

            const found = bridge.findTaskByProcessId('nonexistent');
            expect(found).toBeUndefined();

            bridge.dispose();
        });
    });

    // --------------------------------------------------------------------
    // requeueForFollowUp
    // --------------------------------------------------------------------

    describe('requeueForFollowUp', () => {
        it('exposes requeueForFollowUp method', () => {
            const { bridge } = createBridge();
            expect(typeof (bridge as any).requeueForFollowUp).toBe('function');
            bridge.dispose();
        });

        it('succeeds when task is in completed history', async () => {
            const { bridge } = createBridge();
            bridge.getOrCreateBridge('/repo/requeue-test');
            const manager = bridge.registry.getQueueForRepo('/repo/requeue-test');

            const taskId = manager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', prompt: 'Original' },
                config: {},
                processId: 'proc-requeue',
                displayName: 'Chat',
            });
            manager.markStarted(taskId);
            manager.markCompleted(taskId);

            // Should not throw — task is in history
            await expect(
                bridge.requeueForFollowUp(taskId, 'Follow-up message')
            ).resolves.toBeUndefined();

            // Task should be back in the queue
            const requeued = manager.getTask(taskId);
            expect(requeued?.status).toBe('queued');
            expect((requeued?.payload as any)?.prompt).toBe('Follow-up message');

            bridge.dispose();
        });

        it('uses fallback enqueue when task is running (not in history)', async () => {
            const { bridge, store } = createBridge();
            bridge.getOrCreateBridge('/repo/requeue-running');
            const manager = bridge.registry.getQueueForRepo('/repo/requeue-running');

            const taskId = manager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', prompt: 'Original' },
                config: {},
                processId: 'proc-running-requeue',
                displayName: 'Chat',
            });
            manager.markStarted(taskId);

            // Provide process in store for fallback path
            await store.addProcess({
                id: `queue_${taskId}`,
                type: 'chat',
                status: 'running',
                promptPreview: 'Original',
                fullPrompt: 'Original',
                startTime: new Date(),
                workingDirectory: '/repo/requeue-running',
            } as any);

            // Task is running — skips applyFollowUpToTask, falls through to enqueue
            await expect(
                bridge.requeueForFollowUp(taskId, 'Follow-up while running')
            ).resolves.toBeUndefined();

            bridge.dispose();
        });

        it('passes deliveryMode through to task payload', async () => {
            const { bridge } = createBridge();
            bridge.getOrCreateBridge('/repo/requeue-delivery');
            const manager = bridge.registry.getQueueForRepo('/repo/requeue-delivery');

            const taskId = manager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', prompt: 'Original' },
                config: {},
                processId: 'proc-delivery',
                displayName: 'Chat',
            });
            manager.markStarted(taskId);
            manager.markCompleted(taskId);

            await bridge.requeueForFollowUp(taskId, 'Follow-up', undefined, undefined, undefined, 'immediate');

            const requeued = manager.getTask(taskId);
            expect((requeued?.payload as any)?.deliveryMode).toBe('immediate');

            bridge.dispose();
        });

        it('reuses original task ID in fallback path (post-restart)', async () => {
            const { bridge, store } = createBridge();

            // Process exists in store but task is NOT in any queue (server restart scenario)
            const proc = {
                id: 'queue_restart-task',
                type: 'chat',
                status: 'completed' as const,
                createdAt: new Date().toISOString(),
                workingDirectory: '/repo/fallback-test',
                fullPrompt: 'Original prompt',
                title: 'Chat',
                metadata: { workspaceId: 'ws-fallback' },
            };
            await store.addProcess(proc as any);

            // Ensure the bridge/queue exists for this repo
            bridge.getOrCreateBridge('/repo/fallback-test');

            await bridge.requeueForFollowUp('restart-task', 'Follow-up after restart');

            const manager = bridge.registry.getQueueForRepo('/repo/fallback-test');
            const requeued = manager.getTask('restart-task');
            expect(requeued).toBeDefined();
            expect(requeued!.id).toBe('restart-task');
            expect(requeued!.processId).toBe('queue_restart-task');
            expect(requeued!.status).toBe('queued');
            expect((requeued!.payload as any).prompt).toBe('Follow-up after restart');

            bridge.dispose();
        });
    });

    // --------------------------------------------------------------------
    // getRepoIdForPath — subdirectory prefix matching
    // --------------------------------------------------------------------

    describe('getRepoIdForPath subdirectory prefix matching', () => {
        it('returns workspace id for a subdirectory of a registered workspace', () => {
            const { bridge } = createBridge();
            const sep = require('path').sep;
            bridge.registerRepoId('ws-abc', '/home/user/repo');
            expect(bridge.getRepoIdForPath('/home/user/repo/src')).toBe('ws-abc');
            expect(bridge.getRepoIdForPath('/home/user/repo/src/nested/deep')).toBe('ws-abc');
            bridge.dispose();
        });

        it('returns most specific workspace id when paths overlap', () => {
            const { bridge } = createBridge();
            bridge.registerRepoId('ws-parent', '/home/user/repo');
            bridge.registerRepoId('ws-child', '/home/user/repo/packages/sub');
            expect(bridge.getRepoIdForPath('/home/user/repo/packages/sub/src')).toBe('ws-child');
            expect(bridge.getRepoIdForPath('/home/user/repo/other')).toBe('ws-parent');
            bridge.dispose();
        });

        it('falls back to absolute path for unregistered paths', () => {
            const { bridge } = createBridge();
            const p = require('path');
            const unregistered = p.resolve('/home/user/unrelated/path');
            expect(bridge.getRepoIdForPath(unregistered)).toBe(unregistered);
            bridge.dispose();
        });
    });

    // ========================================================================
    // clearInitialDelay
    // ========================================================================

    describe('clearInitialDelay', () => {
        it('bridges created after clearInitialDelay get 0 delay', () => {
            const registry = new RepoQueueRegistry();
            const store = createMockProcessStore();
            const bridge = new MultiRepoQueueRouter(registry, store, {
                autoStart: false,
                initialDelayMs: 30000,
            });

            // Before clearing — defaultOptions still has the delay
            // Clearing should update the default options
            bridge.clearInitialDelay();

            // Bridge created after clear should work immediately (no 30s hang)
            const b = bridge.getOrCreateBridge('/repo/lazy');
            expect(b).toBeDefined();

            bridge.dispose();
        });
    });

    // ========================================================================
    // findExecutorForTask
    // ========================================================================

    describe('findExecutorForTask', () => {
        it('returns the QueueExecutor that owns a given task', () => {
            const { bridge } = createBridge();
            bridge.getOrCreateBridge('/repo/exec-test');
            const manager = bridge.registry.getQueueForRepo('/repo/exec-test');

            const taskId = manager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'ask', prompt: 'find me' },
                config: {},
            });

            const executor = bridge.findExecutorForTask(taskId);
            expect(executor).toBeDefined();
            expect(executor!.isTaskCancelled(taskId)).toBe(false);

            bridge.dispose();
        });

        it('returns undefined for unknown task id', () => {
            const { bridge } = createBridge();
            bridge.getOrCreateBridge('/repo/exec-test2');

            expect(bridge.findExecutorForTask('nonexistent-task')).toBeUndefined();

            bridge.dispose();
        });
    });

    // ========================================================================
    // aggregate facade cancelTask routes through QueueExecutor
    // ========================================================================

    describe('aggregate facade cancelTask', () => {
        it('routes cancel through QueueExecutor.cancelTask for running tasks', () => {
            const { bridge } = createBridge();
            bridge.getOrCreateBridge('/repo/agg-cancel');
            const manager = bridge.registry.getQueueForRepo('/repo/agg-cancel');

            const taskId = manager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'ask', prompt: 'cancel me' },
                config: {},
            });

            const facade = bridge.createAggregateQueueFacade();

            // Cancel via the facade
            const result = facade.cancelTask(taskId);
            expect(result).toBe(true);

            // Verify the QueueExecutor was notified
            const executor = bridge.findExecutorForTask(taskId);
            // Task was cancelled before starting so executor marks it in its set
            // and queue manager moves it to cancelled
            expect(manager.getTask(taskId)?.status).toBe('cancelled');

            bridge.dispose();
        });

        it('falls back to manager.cancelTask when no executor bridge exists', () => {
            const registry = new RepoQueueRegistry();
            const store = createMockProcessStore();
            const bridge = new MultiRepoQueueRouter(registry, store, { autoStart: false });

            // Create a queue directly without going through getOrCreateBridge
            const manager = registry.getQueueForRepo('/repo/no-bridge');
            const taskId = manager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'ask', prompt: 'test' },
                config: {},
            });

            const facade = bridge.createAggregateQueueFacade();
            const result = facade.cancelTask(taskId);
            expect(result).toBe(true);
            expect(manager.getTask(taskId)?.status).toBe('cancelled');

            bridge.dispose();
        });
    });

    // ========================================================================
    // aggregate facade getAll() (regression: was missing, caused 500 on
    // repo-memory-handler overview/aggregate endpoints)
    // ========================================================================

    describe('aggregate facade getAll', () => {
        it('aggregates tasks from all per-repo managers', () => {
            const { bridge } = createBridge();
            bridge.getOrCreateBridge('/repo/ga-a');
            bridge.getOrCreateBridge('/repo/ga-b');
            const mgrA = bridge.registry.getQueueForRepo('/repo/ga-a');
            const mgrB = bridge.registry.getQueueForRepo('/repo/ga-b');

            mgrA.enqueue({ type: 'chat', priority: 'normal', payload: { kind: 'chat', mode: 'ask', prompt: 'a' }, config: {} });
            mgrB.enqueue({ type: 'chat', priority: 'normal', payload: { kind: 'chat', mode: 'ask', prompt: 'b' }, config: {} });

            const facade = bridge.createAggregateQueueFacade();
            const all = facade.getAll();
            expect(all).toHaveLength(2);

            bridge.dispose();
        });

        it('returns empty array when no managers exist', () => {
            const { bridge } = createBridge();
            const facade = bridge.createAggregateQueueFacade();
            expect(facade.getAll()).toEqual([]);
            bridge.dispose();
        });
    });

    // ========================================================================
    // aggregate facade updateTask()
    // ========================================================================

    describe('aggregate facade updateTask', () => {
        it('updates a task in the owning per-repo manager', () => {
            const { bridge } = createBridge();
            bridge.getOrCreateBridge('/repo/update-task');
            const manager = bridge.registry.getQueueForRepo('/repo/update-task');
            const taskId = manager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'ask', prompt: 'old prompt' },
                config: {},
                displayName: 'old display',
            });

            const facade = bridge.createAggregateQueueFacade() as any;
            const updated = facade.updateTask(taskId, {
                displayName: 'new display',
                payload: { kind: 'chat', mode: 'ask', prompt: 'new prompt' },
            });

            expect(updated).toBe(true);
            expect(manager.getTask(taskId)?.displayName).toBe('new display');
            expect(manager.getTask(taskId)?.payload).toMatchObject({ prompt: 'new prompt' });

            bridge.dispose();
        });

        it('returns false for unknown tasks', () => {
            const { bridge } = createBridge();
            const facade = bridge.createAggregateQueueFacade() as any;

            expect(facade.updateTask('missing-task', { displayName: 'ignored' })).toBe(false);

            bridge.dispose();
        });
    });

    // ========================================================================
    // enqueue() — workspaceId-to-rootPath routing
    // ========================================================================

    describe('enqueue() workspace routing', () => {
        it('routes to the correct per-repo queue when workspaceId is resolved via store', async () => {
            const registry = new RepoQueueRegistry();
            const store = createMockProcessStore();
            const wsRootPath = '/repo/wi-workspace';
            (store.getWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue([
                { id: 'ws-wi-test', rootPath: wsRootPath, name: 'WI Workspace' },
            ]);
            const bridge = new MultiRepoQueueRouter(registry, store, { autoStart: false });

            const resolvedPath = require('path').resolve(wsRootPath);
            bridge.getOrCreateBridge(wsRootPath);

            const taskId = await bridge.enqueue({
                type: 'run-workflow',
                priority: 'normal',
                payload: {
                    kind: 'chat',
                    mode: 'autopilot',
                    prompt: 'Work item task',
                    workspaceId: 'ws-wi-test',
                    workItemId: 'wi-1',
                } as any,
                config: {},
            });

            const manager = registry.getQueueForRepo(resolvedPath);
            expect(manager.getTask(taskId)).toBeDefined();
            expect(manager.getTask(taskId)!.type).toBe('run-workflow');

            bridge.dispose();
        });

        it('sets workingDirectory on payload when resolved via workspaceId', async () => {
            const registry = new RepoQueueRegistry();
            const store = createMockProcessStore();
            const wsRootPath = '/repo/wi-dir';
            (store.getWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue([
                { id: 'ws-wi-dir', rootPath: wsRootPath, name: 'WI Dir' },
            ]);
            const bridge = new MultiRepoQueueRouter(registry, store, { autoStart: false });
            bridge.getOrCreateBridge(wsRootPath);

            const input: any = {
                type: 'run-workflow',
                priority: 'normal',
                payload: {
                    kind: 'chat',
                    workspaceId: 'ws-wi-dir',
                    workItemId: 'wi-2',
                },
                config: {},
            };

            await bridge.enqueue(input);

            expect(input.payload.workingDirectory).toBe(require('path').resolve(wsRootPath));

            bridge.dispose();
        });

        it('falls back to process.cwd() when workspaceId is unknown', async () => {
            const registry = new RepoQueueRegistry();
            const store = createMockProcessStore(); // getWorkspaces returns []
            const bridge = new MultiRepoQueueRouter(registry, store, { autoStart: false });

            const taskId = await bridge.enqueue({
                type: 'run-workflow',
                priority: 'normal',
                payload: { kind: 'chat', workspaceId: 'unknown-ws', workItemId: 'wi-3' } as any,
                config: {},
            });

            expect(taskId).toBeDefined();

            bridge.dispose();
        });

        it('prefers workingDirectory over workspaceId when both are present', async () => {
            const registry = new RepoQueueRegistry();
            const store = createMockProcessStore();
            (store.getWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue([
                { id: 'ws-prefer-wd', rootPath: '/repo/from-ws', name: 'From WS' },
            ]);
            const bridge = new MultiRepoQueueRouter(registry, store, { autoStart: false });

            const explicitPath = require('path').resolve('/repo/explicit-wd');
            bridge.getOrCreateBridge(explicitPath);

            const taskId = await bridge.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: {
                    kind: 'chat',
                    workingDirectory: explicitPath,
                    workspaceId: 'ws-prefer-wd', // should be ignored since workingDirectory is set
                } as any,
                config: {},
            });

            const manager = registry.getQueueForRepo(explicitPath);
            expect(manager.getTask(taskId)).toBeDefined();

            bridge.dispose();
        });

        it('two work items from the same workspace share the same queue', async () => {
            const registry = new RepoQueueRegistry();
            const store = createMockProcessStore();
            const wsRootPath = '/repo/serial-ws';
            (store.getWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue([
                { id: 'ws-serial', rootPath: wsRootPath, name: 'Serial WS' },
            ]);
            const bridge = new MultiRepoQueueRouter(registry, store, { autoStart: false });
            bridge.getOrCreateBridge(wsRootPath);

            const id1 = await bridge.enqueue({
                type: 'run-workflow', priority: 'normal',
                payload: { kind: 'chat', workspaceId: 'ws-serial', workItemId: 'wi-a' } as any, config: {},
            });
            const id2 = await bridge.enqueue({
                type: 'run-workflow', priority: 'normal',
                payload: { kind: 'chat', workspaceId: 'ws-serial', workItemId: 'wi-b' } as any, config: {},
            });

            const resolvedPath = require('path').resolve(wsRootPath);
            const manager = registry.getQueueForRepo(resolvedPath);
            expect(manager.getTask(id1)).toBeDefined();
            expect(manager.getTask(id2)).toBeDefined();
            // Only one queue for this workspace — not two phantom queues
            expect(registry.getAllQueues().size).toBe(1);

            bridge.dispose();
        });
    });

});

