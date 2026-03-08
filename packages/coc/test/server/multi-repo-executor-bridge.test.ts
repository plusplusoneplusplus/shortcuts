/**
 * MultiRepoQueueExecutorBridge Tests
 *
 * Tests for MultiRepoQueueExecutorBridge:
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
} from '@plusplusoneplusplus/pipeline-core';

// SDK mock — needed because createQueueExecutorBridge → CLITaskExecutor → getCopilotSDKService
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore } from '../helpers/mock-process-store';

const sdkMocks = createMockSDKService();

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        getCopilotSDKService: () => sdkMocks.service,
    };
});

import { MultiRepoQueueExecutorBridge } from '../../src/server/multi-repo-executor-bridge';

// ============================================================================
// Helpers
// ============================================================================

function createBridge(options?: { maxConcurrency?: number; autoStart?: boolean }) {
    const registry = new RepoQueueRegistry();
    const store = createMockProcessStore();
    const bridge = new MultiRepoQueueExecutorBridge(registry, store, {
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

describe('MultiRepoQueueExecutorBridge', () => {
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
            // which the registry forwards as 'queueChange', which MultiRepoQueueExecutorBridge
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
    // createAggregateFacade — resolveManager repoId-to-path lookup
    // --------------------------------------------------------------------

    describe('createAggregateFacade resolveManager', () => {
        it('enqueues into the correct repo queue when input carries a repoId (not a path)', () => {
            const { bridge, registry } = createBridge();
            const rootPath = '/repo/schedule-test';
            const resolvedPath = require('path').resolve(rootPath);
            const workspaceId = repoId('schedule-test');

            // Register repoId first, then create the bridge
            bridge.registerRepoId(workspaceId, rootPath);
            bridge.getOrCreateBridge(rootPath);

            const facade = bridge.createAggregateFacade();

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
            const facade = bridge.createAggregateFacade();

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
            const mrBridge = new MultiRepoQueueExecutorBridge(registry, store, { autoStart: false });

            mrBridge.getOrCreateBridge('/repo/a');
            mrBridge.dispose();

            // After dispose, the registry is also disposed. Creating a fresh bridge
            // requires a new instance of MultiRepoQueueExecutorBridge.
            const registry2 = new RepoQueueRegistry();
            const mrBridge2 = new MultiRepoQueueExecutorBridge(registry2, store, { autoStart: false });
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
        it('finds a task by processId across repos', () => {
            const { bridge } = createBridge();
            bridge.getOrCreateBridge('/repo/find-test');
            const manager = bridge.registry.getQueueForRepo('/repo/find-test');

            const taskId = manager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', prompt: 'Hello' },
                config: {},
                processId: 'proc-123',
                displayName: 'Chat',
            });
            manager.markStarted(taskId);
            manager.markCompleted(taskId);

            const found = bridge.findTaskByProcessId('proc-123');
            expect(found).toEqual({ id: taskId, type: 'chat' });

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
    });
});
