/**
 * FileProcessStore Per-Workspace Pruning Tests
 *
 * Tests for pruneWorkspaceIfNeeded: per-workspace cap,
 * file deletion, onPrune callback, and cross-workspace isolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

describe('FileProcessStore per-workspace pruning', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fps-ws-prune-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('prune stays within cap per workspace (independent A and B)', async () => {
        const maxProcesses = 5;
        const store = new FileProcessStore({ dataDir: tmpDir, maxProcesses });

        // Add 7 processes to workspace A
        for (let i = 0; i < 7; i++) {
            await store.addProcess(makeProcess(`a-${i}`, {
                metadata: { type: 'clarification', workspaceId: 'ws-a' },
                status: 'completed',
                startTime: new Date(1000 + i * 1000),
            }));
        }

        // Add 7 processes to workspace B
        for (let i = 0; i < 7; i++) {
            await store.addProcess(makeProcess(`b-${i}`, {
                metadata: { type: 'clarification', workspaceId: 'ws-b' },
                status: 'completed',
                startTime: new Date(1000 + i * 1000),
            }));
        }

        const wsAProcesses = await store.getAllProcesses({ workspaceId: 'ws-a' });
        const wsBProcesses = await store.getAllProcesses({ workspaceId: 'ws-b' });

        expect(wsAProcesses.length).toBeLessThanOrEqual(maxProcesses);
        expect(wsBProcesses.length).toBeLessThanOrEqual(maxProcesses);
    });

    it('non-terminal processes are never pruned', async () => {
        const maxProcesses = 10;
        const store = new FileProcessStore({ dataDir: tmpDir, maxProcesses });

        // Add 10 running processes
        for (let i = 0; i < 10; i++) {
            await store.addProcess(makeProcess(`running-${i}`, { status: 'running' }));
        }

        // Add 3 terminal processes (total 13, over limit)
        for (let i = 0; i < 3; i++) {
            await store.addProcess(makeProcess(`completed-${i}`, {
                status: 'completed',
                startTime: new Date(1000 + i * 1000),
            }));
        }

        const all = await store.getAllProcesses();
        const runningIds = all.filter(p => p.status === 'running').map(p => p.id);
        expect(runningIds).toHaveLength(10);
        for (let i = 0; i < 10; i++) {
            expect(runningIds).toContain(`running-${i}`);
        }
    });

    it('oldest terminal entries are evicted first', async () => {
        const maxProcesses = 5;
        const store = new FileProcessStore({ dataDir: tmpDir, maxProcesses });

        // Add 6 processes with distinct sequential start times
        for (let i = 0; i < 6; i++) {
            await store.addProcess(makeProcess(`p${i}`, {
                status: 'completed',
                startTime: new Date(1000 + i * 1000),
            }));
        }

        // p0 is the oldest; after adding p5 (6th), p0 should be evicted
        const p0 = await store.getProcess('p0');
        expect(p0).toBeUndefined();

        // p1..p5 should survive
        for (let i = 1; i <= 5; i++) {
            const p = await store.getProcess(`p${i}`);
            expect(p).toBeDefined();
        }
    });

    it('process files are moved to pruned bucket instead of deleted', async () => {
        const maxProcesses = 3;
        const store = new FileProcessStore({ dataDir: tmpDir, maxProcesses });
        const startTime = new Date('2026-03-01T10:00:00.000Z');

        for (let i = 0; i < 4; i++) {
            await store.addProcess(makeProcess(`p${i}`, {
                status: 'completed',
                startTime: new Date(startTime.getTime() + i * 1000),
            }));
        }

        // p0 was oldest — its file should have moved to pruned/2026-03/, not deleted
        const activeFile = path.join(tmpDir, 'repos', '_default', 'processes', 'p0.json');
        const activeExists = await fs.access(activeFile).then(() => true, () => false);
        expect(activeExists).toBe(false);

        const prunedFile = path.join(tmpDir, 'repos', '_default', 'processes', 'pruned', '2026-03', 'p0.json');
        const prunedExists = await fs.access(prunedFile).then(() => true, () => false);
        expect(prunedExists).toBe(true);
    });

    it('pruned bucket index.json accumulates entries', async () => {
        const maxProcesses = 2;
        const store = new FileProcessStore({ dataDir: tmpDir, maxProcesses });
        const startTime = new Date('2026-03-01T10:00:00.000Z');

        for (let i = 0; i < 4; i++) {
            await store.addProcess(makeProcess(`p${i}`, {
                status: 'completed',
                startTime: new Date(startTime.getTime() + i * 1000),
            }));
        }

        const bucketIndex = path.join(tmpDir, 'repos', '_default', 'processes', 'pruned', '2026-03', 'index.json');
        const data = await fs.readFile(bucketIndex, 'utf-8');
        const entries = JSON.parse(data) as { id: string }[];
        expect(entries.map(e => e.id)).toContain('p0');
        expect(entries.map(e => e.id)).toContain('p1');
    });

    it('processes pruned across different months land in separate buckets', async () => {
        const maxProcesses = 2;
        const store = new FileProcessStore({ dataDir: tmpDir, maxProcesses });

        // p0 in Feb, p1 in Mar, p2 in Apr (all completed, sequential)
        const times = [
            new Date('2026-02-15T00:00:00.000Z'),
            new Date('2026-03-15T00:00:00.000Z'),
            new Date('2026-04-15T00:00:00.000Z'),
            new Date('2026-05-15T00:00:00.000Z'),
        ];
        for (let i = 0; i < 4; i++) {
            await store.addProcess(makeProcess(`p${i}`, {
                status: 'completed',
                startTime: times[i],
            }));
        }

        // p0 (Feb) → pruned/2026-02/, p1 (Mar) → pruned/2026-03/
        const febFile = path.join(tmpDir, 'repos', '_default', 'processes', 'pruned', '2026-02', 'p0.json');
        const marFile = path.join(tmpDir, 'repos', '_default', 'processes', 'pruned', '2026-03', 'p1.json');
        expect(await fs.access(febFile).then(() => true, () => false)).toBe(true);
        expect(await fs.access(marFile).then(() => true, () => false)).toBe(true);
    });

    it('onPrune callback receives the correct evicted entries', async () => {
        const prunedBatches: StoredProcessEntry[][] = [];
        const maxProcesses = 3;

        const store = new FileProcessStore({
            dataDir: tmpDir,
            maxProcesses,
            onPrune: (entries) => prunedBatches.push(entries),
        });

        for (let i = 0; i < 5; i++) {
            await store.addProcess(makeProcess(`p${i}`, {
                status: 'completed',
                startTime: new Date(1000 + i * 1000),
            }));
        }

        expect(prunedBatches.length).toBeGreaterThan(0);
        const allPrunedIds = prunedBatches.flatMap(b => b.map(e => e.process.id));
        // p0 and p1 should have been pruned (oldest two)
        expect(allPrunedIds).toContain('p0');
        expect(allPrunedIds).toContain('p1');
        // Callback should supply full StoredProcessEntry objects
        for (const batch of prunedBatches) {
            for (const entry of batch) {
                expect(entry.process).toBeDefined();
                expect(entry.workspaceId).toBeDefined();
            }
        }
    });

    it('workspace B is unaffected by workspace A pruning', async () => {
        const maxProcesses = 3;
        const store = new FileProcessStore({ dataDir: tmpDir, maxProcesses });

        // Add 2 processes to workspace B first
        for (let i = 0; i < 2; i++) {
            await store.addProcess(makeProcess(`b-${i}`, {
                metadata: { type: 'clarification', workspaceId: 'ws-b' },
                status: 'completed',
                startTime: new Date(500 + i * 100),
            }));
        }

        // Add 5 processes to workspace A (triggers pruning in A)
        for (let i = 0; i < 5; i++) {
            await store.addProcess(makeProcess(`a-${i}`, {
                metadata: { type: 'clarification', workspaceId: 'ws-a' },
                status: 'completed',
                startTime: new Date(1000 + i * 1000),
            }));
        }

        // Both workspace B processes should still exist
        const b0 = await store.getProcess('b-0');
        const b1 = await store.getProcess('b-1');
        expect(b0).toBeDefined();
        expect(b1).toBeDefined();

        // Workspace B index is intact
        const wsBProcesses = await store.getAllProcesses({ workspaceId: 'ws-b' });
        expect(wsBProcesses).toHaveLength(2);
    });

    it('no pruning occurs when under the cap', async () => {
        const prunedBatches: StoredProcessEntry[][] = [];
        const maxProcesses = 10;

        const store = new FileProcessStore({
            dataDir: tmpDir,
            maxProcesses,
            onPrune: (entries) => prunedBatches.push(entries),
        });

        for (let i = 0; i < 9; i++) {
            await store.addProcess(makeProcess(`p${i}`, { status: 'completed' }));
        }

        expect(prunedBatches).toHaveLength(0);
        const all = await store.getAllProcesses();
        expect(all).toHaveLength(9);
    });

    it('pruneWorkspaceIfNeeded is idempotent when already at cap', async () => {
        const maxProcesses = 5;
        const store = new FileProcessStore({ dataDir: tmpDir, maxProcesses });

        // Add exactly maxProcesses processes
        for (let i = 0; i < maxProcesses; i++) {
            await store.addProcess(makeProcess(`p${i}`, {
                status: 'completed',
                startTime: new Date(1000 + i * 1000),
            }));
        }

        // Verify we are at exactly maxProcesses
        const before = await store.getAllProcesses();
        expect(before).toHaveLength(maxProcesses);

        // Adding one more triggers pruning of exactly 1 (oldest)
        await store.addProcess(makeProcess('p-extra', {
            status: 'completed',
            startTime: new Date(1000 + maxProcesses * 1000),
        }));

        const after = await store.getAllProcesses();
        expect(after).toHaveLength(maxProcesses);
        expect(after.map(p => p.id)).not.toContain('p0');
        expect(after.map(p => p.id)).toContain('p-extra');
    });
});
