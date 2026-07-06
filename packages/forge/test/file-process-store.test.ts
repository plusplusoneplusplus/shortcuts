/**
 * FileProcessStore Tests — Per-Workspace Layout
 *
 * Validates per-workspace directory layout (repos/<workspaceId>/processes/<id>.json),
 * index-scan semantics, and the getProcess(id, workspaceId?) hint parameter.
 * All tests use a temp directory cleaned up in afterEach.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import {
    FileProcessStore,
    getDefaultDataDir,
    ensureDataDir,
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
        status: 'running' as AIProcessStatus,
        startTime: new Date(),
        ...overrides,
    };
}

describe('FileProcessStore — per-workspace layout', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fps-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    // 1. Layout — addProcess creates per-workspace file
    it('should create per-workspace process file after addProcess', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const p = makeProcess('p1', { metadata: { type: 'ai', workspaceId: 'ws-a' } });
        await store.addProcess(p);

        const filePath = path.join(tmpDir, 'repos', 'ws-a', 'processes', 'p1.json');
        const raw = await fs.readFile(filePath, 'utf-8');
        const entry: StoredProcessEntry = JSON.parse(raw);
        expect(entry.workspaceId).toBe('ws-a');
        expect(entry.process.id).toBe('p1');
    });

    // 2. Layout — addProcess updates workspace index.json
    it('should update workspace index.json after adding processes', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        for (const id of ['p1', 'p2', 'p3']) {
            await store.addProcess(makeProcess(id, { metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        }

        const indexPath = path.join(tmpDir, 'repos', 'ws-a', 'processes', 'index.json');
        const raw = await fs.readFile(indexPath, 'utf-8');
        const index: Array<{ id: string }> = JSON.parse(raw);
        const ids = index.map(e => e.id).sort();
        expect(ids).toEqual(['p1', 'p2', 'p3']);
    });

    // 3. getProcess with workspaceId hint — hits correct file directly
    it('should retrieve process via direct path when workspaceId hint is provided', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));

        const result = await store.getProcess('p1', 'ws-a');
        expect(result).toBeDefined();
        expect(result!.id).toBe('p1');
    });

    // 4. getProcess without hint — uses index scan
    it('should find process via index scan when no workspaceId hint is given', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));

        const result = await store.getProcess('p1');
        expect(result).toBeDefined();
        expect(result!.id).toBe('p1');
    });

    // 6. getProcess — returns undefined for unknown id
    it('should return undefined for unknown id', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const result = await store.getProcess('nonexistent');
        expect(result).toBeUndefined();
    });

    // 7. getProcess — returns undefined when workspaceId hint is wrong
    it('should return undefined when workspaceId hint points to wrong workspace', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));

        const result = await store.getProcess('p1', 'ws-wrong');
        expect(result).toBeUndefined();
    });

    // getProcess — sets dataFilePath to the backing JSON file path
    it('should set dataFilePath when retrieving via workspaceId hint', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));

        const result = await store.getProcess('p1', 'ws-a');
        expect(result).toBeDefined();
        expect(result!.dataFilePath).toBe(path.join(tmpDir, 'repos', 'ws-a', 'processes', 'p1.json'));
    });

    it('should set dataFilePath when retrieving via index scan (no workspaceId hint)', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));

        const result = await store.getProcess('p1');
        expect(result).toBeDefined();
        expect(result!.dataFilePath).toBe(path.join(tmpDir, 'repos', 'ws-a', 'processes', 'p1.json'));
    });

    // 8. getAllProcesses — no filter returns all workspaces
    it('should return processes from all workspaces when no filter provided', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        for (const id of ['a1', 'a2', 'a3']) {
            await store.addProcess(makeProcess(id, { metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        }
        for (const id of ['b1', 'b2']) {
            await store.addProcess(makeProcess(id, { metadata: { type: 'ai', workspaceId: 'ws-b' } }));
        }

        const all = await store.getAllProcesses();
        expect(all).toHaveLength(5);
    });

    // 9. getAllProcesses — filter.workspaceId returns single workspace
    it('should return only processes from the specified workspace', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        for (const id of ['a1', 'a2', 'a3']) {
            await store.addProcess(makeProcess(id, { metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        }
        for (const id of ['b1', 'b2']) {
            await store.addProcess(makeProcess(id, { metadata: { type: 'ai', workspaceId: 'ws-b' } }));
        }

        const wsA = await store.getAllProcesses({ workspaceId: 'ws-a' });
        expect(wsA).toHaveLength(3);
        expect(wsA.map(p => p.id).sort()).toEqual(['a1', 'a2', 'a3']);
    });

    // 10. getAllProcesses — filter.status filters within and across workspaces
    it('should filter by status across workspaces', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('a-run', {
            status: 'running',
            metadata: { type: 'ai', workspaceId: 'ws-a' },
        }));
        await store.addProcess(makeProcess('a-done', {
            status: 'completed',
            metadata: { type: 'ai', workspaceId: 'ws-a' },
        }));
        await store.addProcess(makeProcess('b-done', {
            status: 'completed',
            metadata: { type: 'ai', workspaceId: 'ws-b' },
        }));

        const done = await store.getAllProcesses({ status: ['completed'] });
        expect(done).toHaveLength(2);
        expect(done.map(p => p.id).sort()).toEqual(['a-done', 'b-done']);
    });

    // 11. updateProcess — updates file and returns updated values
    it('should update process file and return updated values', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1', {
            status: 'running',
            metadata: { type: 'ai', workspaceId: 'ws-a' },
        }));

        await store.updateProcess('p1', { status: 'completed', result: 'done' });

        const updated = await store.getProcess('p1', 'ws-a');
        expect(updated!.status).toBe('completed');
        expect(updated!.result).toBe('done');
    });

    // 12. clearProcesses with workspaceId — removes dir
    it('should remove workspace dir when clearing by workspaceId', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        for (const id of ['a1', 'a2', 'a3']) {
            await store.addProcess(makeProcess(id, { metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        }
        for (const id of ['b1', 'b2']) {
            await store.addProcess(makeProcess(id, { metadata: { type: 'ai', workspaceId: 'ws-b' } }));
        }

        await store.clearProcesses({ workspaceId: 'ws-a' });

        // ws-a dir should be gone
        const wsAExists = await fs.access(path.join(tmpDir, 'repos', 'ws-a', 'processes')).then(() => true, () => false);
        expect(wsAExists).toBe(false);

        // ws-b files still intact
        for (const id of ['b1', 'b2']) {
            const p = await store.getProcess(id, 'ws-b');
            expect(p).toBeDefined();
        }
    });

    // 13. clearProcesses without workspaceId — applies status filter globally
    it('should clear matching processes across workspaces by status filter', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('a-done', {
            status: 'completed',
            metadata: { type: 'ai', workspaceId: 'ws-a' },
        }));
        await store.addProcess(makeProcess('a-run', {
            status: 'running',
            metadata: { type: 'ai', workspaceId: 'ws-a' },
        }));
        await store.addProcess(makeProcess('b-done', {
            status: 'completed',
            metadata: { type: 'ai', workspaceId: 'ws-b' },
        }));

        await store.clearProcesses({ status: ['completed'] });

        const remaining = await store.getAllProcesses();
        expect(remaining).toHaveLength(1);
        expect(remaining[0].id).toBe('a-run');
    });

    // 14. Processes with empty workspaceId — stored under _default
    it('should store processes with empty workspaceId under _default directory', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1', { metadata: { type: 'ai', workspaceId: '' } }));

        const filePath = path.join(tmpDir, 'repos', '_default', 'processes', 'p1.json');
        const raw = await fs.readFile(filePath, 'utf-8');
        const entry: StoredProcessEntry = JSON.parse(raw);
        expect(entry.workspaceId).toBe('');
    });

    // 15. getStorageStats — counts across all workspace dirs
    it('should count processes and workspace dirs across all workspaces', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        for (const id of ['a1', 'a2', 'a3']) {
            await store.addProcess(makeProcess(id, { metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        }
        for (const id of ['b1', 'b2']) {
            await store.addProcess(makeProcess(id, { metadata: { type: 'ai', workspaceId: 'ws-b' } }));
        }

        const stats = await store.getStorageStats();
        expect(stats.totalProcesses).toBe(5);
        expect(stats.totalWorkspaces).toBe(2);
    });

    // --- Utility exports ---
    it('getDefaultDataDir should return a string path', () => {
        const dir = getDefaultDataDir();
        expect(typeof dir).toBe('string');
        expect(dir.length).toBeGreaterThan(0);
    });

    it('ensureDataDir should create directory recursively', async () => {
        const nested = path.join(tmpDir, 'a', 'b', 'c');
        await ensureDataDir(nested);
        const stat = await fs.stat(nested);
        expect(stat.isDirectory()).toBe(true);
    });


    // Regression: addProcess with duplicate ID should upsert, not duplicate
    it('addProcess called twice with same id replaces index entry (upsert)', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const ws = 'ws-upsert';

        const p1 = makeProcess('queue_abc', {
            status: 'failed' as AIProcessStatus,
            metadata: { type: 'ai', workspaceId: ws },
        });
        await store.addProcess(p1);

        const p2 = makeProcess('queue_abc', {
            status: 'running' as AIProcessStatus,
            metadata: { type: 'ai', workspaceId: ws },
        });
        await store.addProcess(p2);

        const { entries: list } = await store.getProcessSummaries({ workspaceId: ws });
        const entries = list.filter(e => e.id === 'queue_abc');
        expect(entries).toHaveLength(1);
        expect(entries[0].status).toBe('running');
    });

    it('addProcess upsert preserves other entries in the index', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const ws = 'ws-upsert2';

        await store.addProcess(makeProcess('p-other', {
            metadata: { type: 'ai', workspaceId: ws },
        }));
        await store.addProcess(makeProcess('p-dup', {
            status: 'failed' as AIProcessStatus,
            metadata: { type: 'ai', workspaceId: ws },
        }));
        await store.addProcess(makeProcess('p-dup', {
            status: 'running' as AIProcessStatus,
            metadata: { type: 'ai', workspaceId: ws },
        }));

        const { entries: list } = await store.getProcessSummaries({ workspaceId: ws });
        expect(list).toHaveLength(2);
        expect(list.find(e => e.id === 'p-other')).toBeDefined();
        const dupEntry = list.find(e => e.id === 'p-dup');
        expect(dupEntry).toBeDefined();
        expect(dupEntry!.status).toBe('running');
    });

    // ========================================================================
    // getProcessCount
    // ========================================================================

    it('getProcessCount returns 0 for empty store', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        expect(await store.getProcessCount()).toBe(0);
    });

    it('getProcessCount returns total count without filter', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        for (const id of ['c1', 'c2', 'c3']) {
            await store.addProcess(makeProcess(id, { metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        }
        expect(await store.getProcessCount()).toBe(3);
    });

    it('getProcessCount filters by workspaceId', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('a1', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        await store.addProcess(makeProcess('a2', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        await store.addProcess(makeProcess('b1', { metadata: { type: 'ai', workspaceId: 'ws-b' } }));

        expect(await store.getProcessCount({ workspaceId: 'ws-a' })).toBe(2);
        expect(await store.getProcessCount({ workspaceId: 'ws-b' })).toBe(1);
        expect(await store.getProcessCount({ workspaceId: 'ws-none' })).toBe(0);
    });

    it('getProcessCount filters by status', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('r1', {
            status: 'running' as AIProcessStatus,
            metadata: { type: 'ai', workspaceId: 'ws-a' },
        }));
        await store.addProcess(makeProcess('c1', {
            status: 'completed' as AIProcessStatus,
            metadata: { type: 'ai', workspaceId: 'ws-a' },
        }));
        await store.addProcess(makeProcess('f1', {
            status: 'failed' as AIProcessStatus,
            metadata: { type: 'ai', workspaceId: 'ws-a' },
        }));

        expect(await store.getProcessCount({ status: 'running' })).toBe(1);
        expect(await store.getProcessCount({ status: ['running', 'failed'] })).toBe(2);
    });

    it('getProcessSummaries filters by since using activity time', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('old', {
            startTime: new Date('2026-04-28T12:00:00.000Z'),
            lastEventAt: new Date('2026-04-28T12:00:00.000Z'),
            metadata: { type: 'ai', workspaceId: 'ws-a' },
        }));
        await store.addProcess(makeProcess('active', {
            startTime: new Date('2026-04-28T12:00:00.000Z'),
            lastEventAt: new Date('2026-04-29T12:00:00.000Z'),
            metadata: { type: 'ai', workspaceId: 'ws-a' },
        }));

        const { entries, total } = await store.getProcessSummaries({
            workspaceId: 'ws-a',
            since: new Date('2026-04-29T00:00:00.000Z'),
        });

        expect(total).toBe(1);
        expect(entries.map(e => e.id)).toEqual(['active']);
        expect(entries[0].activityAt).toBe('2026-04-29T12:00:00.000Z');
    });

    it('getProcessSummaries filters by until with an exclusive activity upper bound', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('included', {
            startTime: new Date('2026-04-29T12:00:00.000Z'),
            lastEventAt: new Date('2026-04-29T23:59:59.000Z'),
            metadata: { type: 'ai', workspaceId: 'ws-a' },
        }));
        await store.addProcess(makeProcess('excluded', {
            startTime: new Date('2026-04-29T12:00:00.000Z'),
            lastEventAt: new Date('2026-04-30T00:00:00.000Z'),
            metadata: { type: 'ai', workspaceId: 'ws-a' },
        }));

        const { entries } = await store.getProcessSummaries({
            workspaceId: 'ws-a',
            until: new Date('2026-04-30T00:00:00.000Z'),
        });

        expect(entries.map(e => e.id)).toEqual(['included']);
    });

    it('getProcessSummaries supports bounded activity windows', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('before', {
            startTime: new Date('2026-04-28T23:00:00.000Z'),
            lastEventAt: new Date('2026-04-28T23:00:00.000Z'),
            metadata: { type: 'ai', workspaceId: 'ws-a' },
        }));
        await store.addProcess(makeProcess('inside', {
            startTime: new Date('2026-04-29T12:00:00.000Z'),
            lastEventAt: new Date('2026-04-29T12:00:00.000Z'),
            metadata: { type: 'ai', workspaceId: 'ws-a' },
        }));
        await store.addProcess(makeProcess('after', {
            startTime: new Date('2026-04-30T00:00:00.000Z'),
            lastEventAt: new Date('2026-04-30T00:00:00.000Z'),
            metadata: { type: 'ai', workspaceId: 'ws-a' },
        }));

        const { entries, total } = await store.getProcessSummaries({
            workspaceId: 'ws-a',
            since: new Date('2026-04-29T00:00:00.000Z'),
            until: new Date('2026-04-30T00:00:00.000Z'),
        });

        expect(total).toBe(1);
        expect(entries.map(e => e.id)).toEqual(['inside']);
    });

    it('getProcessSummaries surfaces pendingAskUserCount when the process is awaiting input', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const questions = [
            {
                batchId: 'b',
                questionId: 'q1',
                question: 'pick',
                type: 'select',
                options: [{ value: 'a', label: 'A' }],
                defaultValue: 'a',
                turnIndex: 0,
                index: 0,
                batchSize: 1,
            },
        ];
        await store.addProcess(makeProcess('waiting', {
            status: 'running',
            metadata: { type: 'ai', workspaceId: 'ws-await' },
            pendingAskUser: questions as AIProcess['pendingAskUser'],
        }));
        await store.addProcess(makeProcess('thinking', {
            status: 'running',
            metadata: { type: 'ai', workspaceId: 'ws-await' },
        }));

        const { entries } = await store.getProcessSummaries({ workspaceId: 'ws-await' });
        const byId = Object.fromEntries(entries.map(e => [e.id, e]));
        expect(byId['waiting'].pendingAskUserCount).toBe(1);
        expect(byId['thinking'].pendingAskUserCount).toBeUndefined();

        await store.updateProcess('waiting', { pendingAskUser: undefined });
        const { entries: cleared } = await store.getProcessSummaries({ workspaceId: 'ws-await' });
        const clearedWaiting = cleared.find(e => e.id === 'waiting')!;
        expect(clearedWaiting.pendingAskUserCount).toBeUndefined();
    });

    // Compaction state must survive a reload (the reload seed reads getProcessSummaries)
    // so the chat-list sidebar keeps a mid-`/compact` conversation under RUNNING TASKS.
    it('getProcessSummaries forwards in-flight compaction metadata in entries', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('compacting', {
            status: 'running',
            metadata: {
                type: 'chat',
                workspaceId: 'ws-compact',
                compaction: { state: 'running', priorStatus: 'completed', startedAt: '2026-06-01T10:00:00Z' },
            },
        }));
        await store.addProcess(makeProcess('plain', {
            status: 'completed',
            metadata: { type: 'chat', workspaceId: 'ws-compact' },
        }));

        const { entries } = await store.getProcessSummaries({ workspaceId: 'ws-compact' });
        const byId = Object.fromEntries(entries.map(e => [e.id, e]));
        expect(byId['compacting'].compaction?.state).toBe('running');
        expect(byId['compacting'].compaction?.priorStatus).toBe('completed');
        expect(byId['plain'].compaction).toBeUndefined();
    });

    it('persists, reads back, and clears pendingAskUserAnswer across reloads', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const answer = {
            batchId: 'batch-9',
            answers: [
                { questionId: 'q1', question: 'Pick one', answer: 'a', skipped: false, deferred: false },
                { questionId: 'q2', question: 'Need ctx', answer: null, skipped: false, deferred: true, reason: 'needs-context' as const, note: 'why?' },
            ],
            submittedAt: '2026-06-24T00:00:00.000Z',
        };
        await store.addProcess(makeProcess('answered', {
            status: 'failed',
            metadata: { type: 'ai', workspaceId: 'ws-await' },
            pendingAskUserAnswer: answer as AIProcess['pendingAskUserAnswer'],
        }));

        // Fresh store instance forces a read from disk (survives "restart").
        const reloaded = new FileProcessStore({ dataDir: tmpDir });
        const stored = await reloaded.getProcess('answered');
        expect(stored!.pendingAskUserAnswer).toEqual(answer);

        await reloaded.updateProcess('answered', { pendingAskUserAnswer: undefined });
        const afterClear = new FileProcessStore({ dataDir: tmpDir });
        const cleared = await afterClear.getProcess('answered');
        expect(cleared!.pendingAskUserAnswer).toBeUndefined();
    });

    it('getProcessCount across workspaces agrees with getAllProcesses().length', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('a1', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        await store.addProcess(makeProcess('a2', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        await store.addProcess(makeProcess('b1', { metadata: { type: 'ai', workspaceId: 'ws-b' } }));

        const count = await store.getProcessCount();
        const all = await store.getAllProcesses();
        expect(count).toBe(all.length);
    });

    // ========================================================================
    // getProcessIds
    // ========================================================================

    it('getProcessIds returns empty array for empty store', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        expect(await store.getProcessIds()).toEqual([]);
    });

    it('getProcessIds returns all IDs without filter', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        await store.addProcess(makeProcess('p2', { metadata: { type: 'ai', workspaceId: 'ws-b' } }));

        const ids = await store.getProcessIds();
        expect(ids).toHaveLength(2);
        expect(new Set(ids)).toEqual(new Set(['p1', 'p2']));
    });

    it('getProcessIds filters by workspaceId', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('a1', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        await store.addProcess(makeProcess('a2', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        await store.addProcess(makeProcess('b1', { metadata: { type: 'ai', workspaceId: 'ws-b' } }));

        const ids = await store.getProcessIds({ workspaceId: 'ws-a' });
        expect(ids).toHaveLength(2);
        expect(new Set(ids)).toEqual(new Set(['a1', 'a2']));
    });

    it('getProcessIds filters by status', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1', { status: 'running', metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        await store.addProcess(makeProcess('p2', { status: 'completed', metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        await store.addProcess(makeProcess('p3', { status: 'failed', metadata: { type: 'ai', workspaceId: 'ws-a' } }));

        const ids = await store.getProcessIds({ status: 'completed' });
        expect(ids).toEqual(['p2']);
    });

    it('getProcessIds ignores pagination from filter', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        await store.addProcess(makeProcess('p2', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        await store.addProcess(makeProcess('p3', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));

        const ids = await store.getProcessIds({ limit: 1, offset: 0 });
        expect(ids).toHaveLength(3);
    });

    it('getProcessIds agrees with getProcessSummaries on IDs', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('a1', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        await store.addProcess(makeProcess('b1', { metadata: { type: 'ai', workspaceId: 'ws-b' } }));

        const ids = await store.getProcessIds();
        const { entries } = await store.getProcessSummaries();
        expect(new Set(ids)).toEqual(new Set(entries.map(e => e.id)));
    });
});
