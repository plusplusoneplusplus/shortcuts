/**
 * FileProcessStore Prune Hook Tests
 *
 * Tests the onPrune callback that fires when pruneIfNeeded() removes entries.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import {
    FileProcessStore,
    AIProcess,
    AIProcessStatus,
    StoredProcessEntry,
} from '../src/index';

function makeProcess(id: string, overrides?: Partial<AIProcess>): AIProcess {
    return {
        id,
        type: 'clarification',
        promptPreview: `prompt-${id}`,
        fullPrompt: `Full prompt for ${id}`,
        status: 'completed' as AIProcessStatus,
        startTime: new Date(),
        ...overrides,
    };
}

describe('FileProcessStore onPrune callback', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fps-prune-hook-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('should fire onPrune with pruned entries when over limit', async () => {
        const prunedBatches: StoredProcessEntry[][] = [];
        const maxProcesses = 500;

        const store = new FileProcessStore({
            dataDir: tmpDir,
            maxProcesses,
            onPrune: (entries) => prunedBatches.push(entries),
        });

        // Add 500 terminal processes (at limit, no pruning)
        for (let i = 0; i < 500; i++) {
            await store.addProcess(makeProcess(`p${i}`, {
                status: 'completed',
                startTime: new Date(Date.now() + i * 1000),
            }));
        }
        expect(prunedBatches).toHaveLength(0);

        // Add 10 more (total 510, should prune 10 oldest)
        for (let i = 500; i < 510; i++) {
            await store.addProcess(makeProcess(`p${i}`, {
                status: 'completed',
                startTime: new Date(Date.now() + i * 1000),
            }));
        }

        // Each addProcess that triggers pruning should fire the callback
        expect(prunedBatches.length).toBeGreaterThan(0);

        // Collect all pruned IDs
        const allPrunedIds = prunedBatches.flatMap(batch => batch.map(e => e.process.id));
        // The oldest entries should have been pruned
        expect(allPrunedIds.length).toBeGreaterThanOrEqual(10);
        for (const id of allPrunedIds) {
            // Should no longer be in the store
            const proc = await store.getProcess(id);
            expect(proc).toBeUndefined();
        }
    });

    it('should not fire onPrune when under limit', async () => {
        const prunedBatches: StoredProcessEntry[][] = [];

        const store = new FileProcessStore({
            dataDir: tmpDir,
            maxProcesses: 500,
            onPrune: (entries) => prunedBatches.push(entries),
        });

        for (let i = 0; i < 100; i++) {
            await store.addProcess(makeProcess(`p${i}`, { status: 'completed' }));
        }

        expect(prunedBatches).toHaveLength(0);
    });

    it('should never prune non-terminal entries', async () => {
        const prunedBatches: StoredProcessEntry[][] = [];
        const maxProcesses = 10;

        const store = new FileProcessStore({
            dataDir: tmpDir,
            maxProcesses,
            onPrune: (entries) => prunedBatches.push(entries),
        });

        // Add 8 running processes
        for (let i = 0; i < 8; i++) {
            await store.addProcess(makeProcess(`running-${i}`, { status: 'running' }));
        }

        // Add 5 terminal processes (total 13, over limit of 10)
        for (let i = 0; i < 5; i++) {
            await store.addProcess(makeProcess(`completed-${i}`, {
                status: 'completed',
                startTime: new Date(Date.now() + i * 1000),
            }));
        }

        // Only terminal entries should appear in prune callbacks
        const allPrunedIds = prunedBatches.flatMap(batch => batch.map(e => e.process.id));
        for (const id of allPrunedIds) {
            expect(id).not.toMatch(/^running-/);
        }

        // All running processes should survive
        for (let i = 0; i < 8; i++) {
            const proc = await store.getProcess(`running-${i}`);
            expect(proc).toBeDefined();
            expect(proc!.status).toBe('running');
        }
    });

    it('should support setting onPrune after construction', async () => {
        const prunedBatches: StoredProcessEntry[][] = [];

        const store = new FileProcessStore({
            dataDir: tmpDir,
            maxProcesses: 5,
        });

        // Set onPrune after construction
        store.onPrune = (entries) => prunedBatches.push(entries);

        // Add 5 processes (at limit)
        for (let i = 0; i < 5; i++) {
            await store.addProcess(makeProcess(`p${i}`, {
                status: 'completed',
                startTime: new Date(Date.now() + i * 1000),
            }));
        }

        // Add 3 more to trigger pruning
        for (let i = 5; i < 8; i++) {
            await store.addProcess(makeProcess(`p${i}`, {
                status: 'completed',
                startTime: new Date(Date.now() + i * 1000),
            }));
        }

        expect(prunedBatches.length).toBeGreaterThan(0);
        const allPrunedIds = prunedBatches.flatMap(batch => batch.map(e => e.process.id));
        expect(allPrunedIds.length).toBeGreaterThanOrEqual(3);
    });
});
