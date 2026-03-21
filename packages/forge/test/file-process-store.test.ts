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

    // --- getProcessFilePath ---
    describe('getProcessFilePath', () => {
        it('should return the expected path for a normal workspace and process ID', () => {
            const store = new FileProcessStore({ dataDir: tmpDir });
            const result = store.getProcessFilePath('ws-a', 'proc-1');
            const expected = path.join(tmpDir, 'repos', 'ws-a', 'processes', 'proc-1.json');
            expect(result).toBe(expected);
        });

        it('should fall back to _default workspace when workspaceId is empty', () => {
            const store = new FileProcessStore({ dataDir: tmpDir });
            const result = store.getProcessFilePath('', 'proc-1');
            expect(result).toContain(path.join('repos', '_default', 'processes'));
            expect(result).toContain('proc-1.json');
        });

        it('should sanitize special characters in process ID', () => {
            const store = new FileProcessStore({ dataDir: tmpDir });
            const result = store.getProcessFilePath('ws-a', 'foo/bar:baz');
            const expected = path.join(tmpDir, 'repos', 'ws-a', 'processes', 'foo_bar_baz.json');
            expect(result).toBe(expected);
        });

        it('should conform to the ProcessStore interface', () => {
            const store = new FileProcessStore({ dataDir: tmpDir });
            expect(typeof store.getProcessFilePath).toBe('function');
        });

        it('should return path consistent with addProcess file location', async () => {
            const store = new FileProcessStore({ dataDir: tmpDir });
            const p = makeProcess('p1', { metadata: { type: 'ai', workspaceId: 'ws-a' } });
            await store.addProcess(p);
            const expectedPath = store.getProcessFilePath('ws-a', 'p1');
            const raw = await fs.readFile(expectedPath, 'utf-8');
            const entry = JSON.parse(raw);
            expect(entry.process.id).toBe('p1');
        });
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
});
