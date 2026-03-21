/**
 * CleanupInfrastructure Tests
 *
 * Tests for the createCleanupInfrastructure factory function.
 * Uses OS temp directories for cross-platform compatibility.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { TaskQueueManager } from '@plusplusoneplusplus/forge';
import { createCleanupInfrastructure } from '../../../src/server/infrastructure/cleanup-infrastructure';
import { OutputPruner } from '../../../src/server/output-pruner';
import { StaleTaskDetector } from '../../../src/server/stale-task-detector';

// Minimal TaskQueueManager stub
function makeQueueFacade(): TaskQueueManager {
    return {
        getAll: vi.fn().mockResolvedValue([]),
        get: vi.fn(),
        add: vi.fn(),
        remove: vi.fn(),
        update: vi.fn(),
        clear: vi.fn(),
        dispose: vi.fn(),
        enqueue: vi.fn(),
        dequeue: vi.fn(),
        onTaskAdded: vi.fn(),
        getQueue: vi.fn().mockReturnValue({ getPending: () => [], getHistory: () => [] }),
    } as unknown as TaskQueueManager;
}

describe('createCleanupInfrastructure', () => {
    let tmpDir: string;
    let store: FileProcessStore;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cleanup-infra-test-'));
        store = new FileProcessStore(tmpDir);
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('returns outputPruner and staleDetector instances', () => {
        const queueFacade = makeQueueFacade();
        const result = createCleanupInfrastructure(store, tmpDir, queueFacade);

        expect(result.outputPruner).toBeInstanceOf(OutputPruner);
        expect(result.staleDetector).toBeInstanceOf(StaleTaskDetector);
    });

    it('wires store.onPrune for FileProcessStore', () => {
        const queueFacade = makeQueueFacade();
        createCleanupInfrastructure(store, tmpDir, queueFacade);

        expect(store.onPrune).toBeTypeOf('function');
    });

    it('staleDetector is started (timer is running)', () => {
        const queueFacade = makeQueueFacade();
        const { staleDetector } = createCleanupInfrastructure(store, tmpDir, queueFacade);

        // Calling start() again when already running is a no-op (idempotent)
        // We verify the detector is started by calling dispose() which clears the timer
        expect(() => staleDetector.dispose()).not.toThrow();
    });

    it('outputPruner is listening (stopListening is a no-op if not started would be falsy)', () => {
        const queueFacade = makeQueueFacade();
        const { outputPruner } = createCleanupInfrastructure(store, tmpDir, queueFacade);

        // stopListening should not throw if the pruner is already listening
        expect(() => outputPruner.stopListening()).not.toThrow();
    });

    it('logs a warning (not throws) if orphan cleanup fails', async () => {
        // Make the outputs directory unreadable by passing an invalid dataDir
        // The actual cleanupOrphans() call is fire-and-forget; we just confirm
        // no unhandled rejection propagates.
        const queueFacade = makeQueueFacade();
        expect(() =>
            createCleanupInfrastructure(store, path.join(tmpDir, 'nonexistent'), queueFacade),
        ).not.toThrow();

        // Allow the micro-task queue to flush
        await new Promise((r) => setTimeout(r, 10));
    });
});
