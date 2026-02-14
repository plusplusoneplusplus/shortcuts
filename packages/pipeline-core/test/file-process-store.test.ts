/**
 * FileProcessStore Tests
 *
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

describe('FileProcessStore', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fps-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    // --- Empty store ---
    it('should return empty array for getAllProcesses on new store', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const processes = await store.getAllProcesses();
        expect(processes).toEqual([]);
    });

    it('should return undefined for getProcess on non-existent id', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const result = await store.getProcess('non-existent');
        expect(result).toBeUndefined();
    });

    // --- Add and get ---
    it('should add and retrieve a process with Date objects restored', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const now = new Date('2026-01-15T10:00:00.000Z');
        const process = makeProcess('p1', {
            startTime: now,
            endTime: new Date('2026-01-15T10:05:00.000Z'),
        });
        await store.addProcess(process);

        const retrieved = await store.getProcess('p1');
        expect(retrieved).toBeDefined();
        expect(retrieved!.id).toBe('p1');
        expect(retrieved!.startTime).toBeInstanceOf(Date);
        expect(retrieved!.startTime.toISOString()).toBe('2026-01-15T10:00:00.000Z');
        expect(retrieved!.endTime).toBeInstanceOf(Date);
        expect(retrieved!.endTime!.toISOString()).toBe('2026-01-15T10:05:00.000Z');
    });

    // --- Update ---
    it('should update only specified fields', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1', { status: 'running' }));

        await store.updateProcess('p1', { status: 'completed', result: 'done' });

        const retrieved = await store.getProcess('p1');
        expect(retrieved!.status).toBe('completed');
        expect(retrieved!.result).toBe('done');
        expect(retrieved!.fullPrompt).toBe('Full prompt for p1');
    });

    it('should no-op when updating non-existent process', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1'));
        // Should not throw
        await store.updateProcess('non-existent', { status: 'failed' });
        const all = await store.getAllProcesses();
        expect(all).toHaveLength(1);
    });

    // --- Remove ---
    it('should remove a process', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1'));
        await store.addProcess(makeProcess('p2'));

        await store.removeProcess('p1');

        expect(await store.getProcess('p1')).toBeUndefined();
        expect(await store.getProcess('p2')).toBeDefined();
    });

    // --- Multi-workspace filtering ---
    it('should filter processes by workspaceId', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1', {
            metadata: { type: 'clarification', workspaceId: 'ws-1' }
        }));
        await store.addProcess(makeProcess('p2', {
            metadata: { type: 'clarification', workspaceId: 'ws-2' }
        }));
        await store.addProcess(makeProcess('p3', {
            metadata: { type: 'clarification', workspaceId: 'ws-1' }
        }));

        const ws1 = await store.getAllProcesses({ workspaceId: 'ws-1' });
        expect(ws1).toHaveLength(2);
        expect(ws1.map(p => p.id).sort()).toEqual(['p1', 'p3']);

        const all = await store.getAllProcesses();
        expect(all).toHaveLength(3);
    });

    // --- Clear by workspace ---
    it('should clear only processes matching workspace filter', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1', {
            metadata: { type: 'clarification', workspaceId: 'ws-1' }
        }));
        await store.addProcess(makeProcess('p2', {
            metadata: { type: 'clarification', workspaceId: 'ws-2' }
        }));

        const count = await store.clearProcesses({ workspaceId: 'ws-1' });
        expect(count).toBe(1);

        const remaining = await store.getAllProcesses();
        expect(remaining).toHaveLength(1);
        expect(remaining[0].id).toBe('p2');
    });

    // --- Clear all ---
    it('should clear all processes when no filter', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1'));
        await store.addProcess(makeProcess('p2'));
        await store.addProcess(makeProcess('p3'));

        const count = await store.clearProcesses();
        expect(count).toBe(3);

        const all = await store.getAllProcesses();
        expect(all).toEqual([]);
    });

    // --- Retention limit ---
    it('should enforce retention limit and never prune running/queued', async () => {
        const maxProcesses = 10;
        const store = new FileProcessStore({ dataDir: tmpDir, maxProcesses });

        // Add a running and queued process
        await store.addProcess(makeProcess('running-1', { status: 'running' }));
        await store.addProcess(makeProcess('queued-1', { status: 'queued' }));

        // Add 10 completed processes (total = 12, over limit of 10)
        for (let i = 0; i < 10; i++) {
            await store.addProcess(makeProcess(`completed-${i}`, {
                status: 'completed',
                startTime: new Date(Date.now() + i * 1000),
            }));
        }

        const all = await store.getAllProcesses();
        expect(all.length).toBeLessThanOrEqual(maxProcesses);

        // running/queued must survive
        const ids = all.map(p => p.id);
        expect(ids).toContain('running-1');
        expect(ids).toContain('queued-1');
    });

    // --- Persistence across instances ---
    it('should persist data across separate store instances', async () => {
        const store1 = new FileProcessStore({ dataDir: tmpDir });
        await store1.addProcess(makeProcess('p1', { status: 'running' }));

        // Create a completely new instance pointing to same dir
        const store2 = new FileProcessStore({ dataDir: tmpDir });
        const retrieved = await store2.getProcess('p1');
        expect(retrieved).toBeDefined();
        expect(retrieved!.id).toBe('p1');
        expect(retrieved!.status).toBe('running');
    });

    // --- Atomic write safety ---
    it('should handle concurrent addProcess calls without data loss', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const count = 20;

        // Fire concurrent writes
        const promises = Array.from({ length: count }, (_, i) =>
            store.addProcess(makeProcess(`concurrent-${i}`))
        );
        await Promise.all(promises);

        const all = await store.getAllProcesses();
        expect(all).toHaveLength(count);

        // Verify JSON file is valid
        const raw = await fs.readFile(path.join(tmpDir, 'processes.json'), 'utf-8');
        expect(() => JSON.parse(raw)).not.toThrow();
    });

    // --- Workspace registration ---
    it('should register and retrieve workspaces', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.registerWorkspace({
            id: 'ws-1',
            name: 'Project A',
            rootPath: '/home/user/project-a',
        });
        await store.registerWorkspace({
            id: 'ws-2',
            name: 'Project B',
            rootPath: '/home/user/project-b',
            color: '#ff0000',
        });

        const workspaces = await store.getWorkspaces();
        expect(workspaces).toHaveLength(2);
        expect(workspaces.find(w => w.id === 'ws-1')!.name).toBe('Project A');
        expect(workspaces.find(w => w.id === 'ws-2')!.color).toBe('#ff0000');
    });

    it('should upsert workspace on duplicate registration', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.registerWorkspace({
            id: 'ws-1',
            name: 'Original',
            rootPath: '/path/a',
        });
        await store.registerWorkspace({
            id: 'ws-1',
            name: 'Updated',
            rootPath: '/path/b',
        });

        const workspaces = await store.getWorkspaces();
        expect(workspaces).toHaveLength(1);
        expect(workspaces[0].name).toBe('Updated');
        expect(workspaces[0].rootPath).toBe('/path/b');
    });

    // --- Filter by status ---
    it('should filter by status', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1', { status: 'running' }));
        await store.addProcess(makeProcess('p2', { status: 'completed' }));
        await store.addProcess(makeProcess('p3', { status: 'failed' }));

        const running = await store.getAllProcesses({ status: 'running' });
        expect(running).toHaveLength(1);
        expect(running[0].id).toBe('p1');

        const multi = await store.getAllProcesses({ status: ['running', 'failed'] });
        expect(multi).toHaveLength(2);
    });

    // --- Filter by type ---
    it('should filter by type', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1', { type: 'clarification' }));
        await store.addProcess(makeProcess('p2', { type: 'code-review' }));

        const reviews = await store.getAllProcesses({ type: 'code-review' });
        expect(reviews).toHaveLength(1);
        expect(reviews[0].id).toBe('p2');
    });

    // --- Filter by since ---
    it('should filter by since date', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('old', {
            startTime: new Date('2025-01-01'),
        }));
        await store.addProcess(makeProcess('new', {
            startTime: new Date('2026-06-01'),
        }));

        const recent = await store.getAllProcesses({
            since: new Date('2026-01-01'),
        });
        expect(recent).toHaveLength(1);
        expect(recent[0].id).toBe('new');
    });

    // --- Pagination ---
    it('should support limit and offset', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        for (let i = 0; i < 5; i++) {
            await store.addProcess(makeProcess(`p${i}`));
        }

        const page = await store.getAllProcesses({ limit: 2, offset: 1 });
        expect(page).toHaveLength(2);
        expect(page[0].id).toBe('p1');
        expect(page[1].id).toBe('p2');
    });

    // --- onProcessChange callback ---
    it('should fire onProcessChange callbacks', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const events: ProcessEvent[] = [];
        store.onProcessChange = (event) => events.push(event);

        const p = makeProcess('p1');
        await store.addProcess(p);
        await store.updateProcess('p1', { status: 'failed' });
        await store.removeProcess('p1');

        expect(events).toHaveLength(3);
        expect(events[0].type).toBe('process-added');
        expect(events[1].type).toBe('process-updated');
        expect(events[2].type).toBe('process-removed');
    });
});

describe('getDefaultDataDir', () => {
    it('should return path ending in .pipeline-server under homedir', () => {
        const dir = getDefaultDataDir();
        expect(dir).toContain('.pipeline-server');
        expect(dir.startsWith(os.homedir())).toBe(true);
    });
});

describe('ensureDataDir', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fps-ensure-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('should create nested directories', async () => {
        const nested = path.join(tmpDir, 'a', 'b', 'c');
        const result = await ensureDataDir(nested);
        expect(result).toBe(path.resolve(nested));

        const stat = await fs.stat(nested);
        expect(stat.isDirectory()).toBe(true);
    });

    it('should be idempotent', async () => {
        const dir = path.join(tmpDir, 'existing');
        await ensureDataDir(dir);
        // Should not throw on second call
        const result = await ensureDataDir(dir);
        expect(result).toBe(path.resolve(dir));
    });
});
