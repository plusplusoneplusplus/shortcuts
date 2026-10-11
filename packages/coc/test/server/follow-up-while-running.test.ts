/**
 * Narrow follow-up routing checks not covered elsewhere:
 * - isSessionAlive against the process store
 * - findTaskByProcessId for failed tasks in history
 * - requeueForFollowUp after a failed task
 *
 * Running/completed lookup and broader requeue behavior live in
 * multi-repo-queue-router.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    RepoQueueRegistry,
    TaskQueueManager,
} from '@plusplusoneplusplus/forge';

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

// ============================================================================
// Helpers
// ============================================================================

function createBridge() {
    const registry = new RepoQueueRegistry();
    const store = createMockProcessStore();
    const bridge = new MultiRepoQueueRouter(registry, store, {
        autoStart: false,
    });
    return { registry, store, bridge };
}

function enqueueAndStart(manager: TaskQueueManager, processId: string) {
    const taskId = manager.enqueue({
        type: 'chat',
        priority: 'normal',
        payload: { kind: 'chat', prompt: 'Original prompt' },
        config: {},
        processId,
        displayName: 'Chat',
    });
    manager.markStarted(taskId);
    return taskId;
}

// ============================================================================
// isSessionAlive (meaningful check)
// ============================================================================

describe('isSessionAlive (process store check)', () => {
    it('returns true when process exists in store', async () => {
        const { bridge, store } = createBridge();
        store.processes.set('existing-proc', { id: 'existing-proc', status: 'running' } as any);
        expect(await bridge.isSessionAlive('existing-proc')).toBe(true);
        bridge.dispose();
    });

    it('returns true when no bridges exist (fresh sessions always possible)', async () => {
        const { bridge } = createBridge();
        expect(await bridge.isSessionAlive('nonexistent')).toBe(true);
        bridge.dispose();
    });
});

// ============================================================================
// Follow-up routing decision (integration with findTaskByProcessId)
// ============================================================================

describe('follow-up routing by task status', () => {
    it('findTaskByProcessId finds failed tasks in history', () => {
        const { bridge } = createBridge();
        bridge.getOrCreateBridge('/repo/find-failed');
        const manager = bridge.registry.getQueueForRepo('/repo/find-failed');
        const taskId = enqueueAndStart(manager, 'proc-find-failed');
        manager.markFailed(taskId, 'test error');

        const found = bridge.findTaskByProcessId('proc-find-failed');
        expect(found).toBeDefined();
        expect(found!.status).toBe('failed');
        bridge.dispose();
    });

    it('requeueForFollowUp works for failed tasks (not just completed)', async () => {
        const { bridge } = createBridge();
        bridge.getOrCreateBridge('/repo/requeue-failed');
        const manager = bridge.registry.getQueueForRepo('/repo/requeue-failed');
        const taskId = enqueueAndStart(manager, 'proc-requeue-failed');
        manager.markFailed(taskId, 'test error');

        await bridge.requeueForFollowUp(taskId, 'Retry after failure');

        const task = manager.getTask(taskId);
        expect(task?.status).toBe('queued');
        expect((task?.payload as any)?.prompt).toBe('Retry after failure');
        bridge.dispose();
    });

});
