/**
 * FileProcessStore Prune Hook Tests — Per-Workspace
 *
 * Tests the onPrune callback for per-workspace pruning behaviour.
 * Pruning in workspace A must not affect workspace B.
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
        type: 'ai',
        promptPreview: 'test prompt',
        fullPrompt: 'test full prompt',
        status: 'completed' as AIProcessStatus,
        startTime: new Date(),
        ...overrides,
    };
}

describe('FileProcessStore onPrune callback — per-workspace', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fps-prune-hook-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    // 16. Per-workspace pruning — exceeding max in ws-a evicts only ws-a
    it('should prune only ws-a processes when ws-a exceeds maxProcesses', async () => {
        const maxProcesses = 5;
        const store = new FileProcessStore({ dataDir: tmpDir, maxProcesses });

        // Add 6 terminal processes to ws-a (one over limit)
        for (let i = 0; i < 6; i++) {
            await store.addProcess(makeProcess(`a${i}`, {
                status: 'completed',
                startTime: new Date(Date.now() + i * 1000),
                metadata: { type: 'ai', workspaceId: 'ws-a' },
            }));
        }

        // Add 3 terminal processes to ws-b (under limit)
        for (let i = 0; i < 3; i++) {
            await store.addProcess(makeProcess(`b${i}`, {
                status: 'completed',
                startTime: new Date(Date.now() + i * 1000),
                metadata: { type: 'ai', workspaceId: 'ws-b' },
            }));
        }

        const wsA = await store.getAllProcesses({ workspaceId: 'ws-a' });
        const wsB = await store.getAllProcesses({ workspaceId: 'ws-b' });
        expect(wsA).toHaveLength(maxProcesses);
        expect(wsB).toHaveLength(3);
    });

    // 17. onPrune callback — called with evicted entries
    it('should call onPrune with the oldest evicted entry when over limit', async () => {
        const prunedBatches: StoredProcessEntry[][] = [];
        const maxProcesses = 5;
        const store = new FileProcessStore({
            dataDir: tmpDir,
            maxProcesses,
            onPrune: (entries) => prunedBatches.push(entries),
        });

        // Add exactly maxProcesses terminal processes
        for (let i = 0; i < maxProcesses; i++) {
            await store.addProcess(makeProcess(`p${i}`, {
                status: 'completed',
                startTime: new Date(Date.now() + i * 1000),
                metadata: { type: 'ai', workspaceId: 'ws-a' },
            }));
        }
        expect(prunedBatches).toHaveLength(0);

        // Add one more — triggers pruning of oldest
        await store.addProcess(makeProcess('p5', {
            status: 'completed',
            startTime: new Date(Date.now() + 5000),
            metadata: { type: 'ai', workspaceId: 'ws-a' },
        }));

        expect(prunedBatches.length).toBeGreaterThan(0);
        const allPrunedIds = prunedBatches.flatMap(b => b.map(e => e.process.id));
        expect(allPrunedIds.length).toBeGreaterThanOrEqual(1);

        // Evicted entries should no longer be in the store
        for (const id of allPrunedIds) {
            const proc = await store.getProcess(id);
            expect(proc).toBeUndefined();
        }
    });

    // 18. onPrune — not called when under limit
    it('should not call onPrune when process count is under maxProcesses', async () => {
        const prunedBatches: StoredProcessEntry[][] = [];
        const maxProcesses = 5;
        const store = new FileProcessStore({
            dataDir: tmpDir,
            maxProcesses,
            onPrune: (entries) => prunedBatches.push(entries),
        });

        // Add 4 processes (below limit of 5)
        for (let i = 0; i < 4; i++) {
            await store.addProcess(makeProcess(`p${i}`, {
                status: 'completed',
                metadata: { type: 'ai', workspaceId: 'ws-a' },
            }));
        }

        expect(prunedBatches).toHaveLength(0);
    });

    // 19. Pruning does not evict running processes
    it('should never prune running processes even when over limit', async () => {
        const prunedBatches: StoredProcessEntry[][] = [];
        const maxProcesses = 5;
        const store = new FileProcessStore({
            dataDir: tmpDir,
            maxProcesses,
            onPrune: (entries) => prunedBatches.push(entries),
        });

        // Add 5 terminal + 1 running (total 6, over limit of 5)
        for (let i = 0; i < 5; i++) {
            await store.addProcess(makeProcess(`t${i}`, {
                status: 'completed',
                startTime: new Date(Date.now() + i * 1000),
                metadata: { type: 'ai', workspaceId: 'ws-a' },
            }));
        }
        await store.addProcess(makeProcess('runner', {
            status: 'running',
            metadata: { type: 'ai', workspaceId: 'ws-a' },
        }));

        // Running process must survive
        const runner = await store.getProcess('runner');
        expect(runner).toBeDefined();
        expect(runner!.status).toBe('running');

        // Pruned entries must all be terminal
        const allPrunedIds = prunedBatches.flatMap(b => b.map(e => e.process.id));
        for (const id of allPrunedIds) {
            expect(id).not.toBe('runner');
        }

        // At least one terminal was pruned
        expect(allPrunedIds.length).toBeGreaterThanOrEqual(1);
    });
});
