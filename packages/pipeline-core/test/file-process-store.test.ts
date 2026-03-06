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
    ProcessOutputEvent,
    ProcessIndexEntry,
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

    // --- parentProcessId filtering ---
    it('should filter processes by parentProcessId', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('parent1'));
        await store.addProcess(makeProcess('child1', { parentProcessId: 'parent1' }));
        await store.addProcess(makeProcess('unrelated'));

        const children = await store.getAllProcesses({ parentProcessId: 'parent1' });
        expect(children).toHaveLength(1);
        expect(children[0].id).toBe('child1');
    });

    it('should return empty when filtering by nonexistent parentProcessId', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1'));
        await store.addProcess(makeProcess('p2', { parentProcessId: 'p1' }));

        const result = await store.getAllProcesses({ parentProcessId: 'nonexistent' });
        expect(result).toEqual([]);
    });

    it('should return all processes when no parentProcessId filter is set', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('parent1'));
        await store.addProcess(makeProcess('child1', { parentProcessId: 'parent1' }));
        await store.addProcess(makeProcess('unrelated'));

        const all = await store.getAllProcesses({});
        expect(all).toHaveLength(3);
    });

    it('should combine parentProcessId with status filter', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('parent1'));
        await store.addProcess(makeProcess('child1', {
            parentProcessId: 'parent1',
            status: 'completed' as AIProcessStatus,
        }));
        await store.addProcess(makeProcess('child2', {
            parentProcessId: 'parent1',
            status: 'running' as AIProcessStatus,
        }));

        const completedChildren = await store.getAllProcesses({
            parentProcessId: 'parent1',
            status: 'completed',
        });
        expect(completedChildren).toHaveLength(1);
        expect(completedChildren[0].id).toBe('child1');
    });

    it('should clear only processes matching parentProcessId filter', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('parent1'));
        await store.addProcess(makeProcess('child1', { parentProcessId: 'parent1' }));
        await store.addProcess(makeProcess('unrelated'));

        const count = await store.clearProcesses({ parentProcessId: 'parent1' });
        expect(count).toBe(1);

        const remaining = await store.getAllProcesses();
        expect(remaining).toHaveLength(2);
        expect(remaining.map(p => p.id).sort()).toEqual(['parent1', 'unrelated']);
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

        // Verify index.json file is valid
        const raw = await fs.readFile(path.join(tmpDir, 'processes', 'index.json'), 'utf-8');
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

    // --- Workspace removal ---
    it('should remove a workspace by ID', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.registerWorkspace({ id: 'ws-1', name: 'A', rootPath: '/a' });
        await store.registerWorkspace({ id: 'ws-2', name: 'B', rootPath: '/b' });

        const removed = await store.removeWorkspace('ws-1');
        expect(removed).toBe(true);

        const workspaces = await store.getWorkspaces();
        expect(workspaces).toHaveLength(1);
        expect(workspaces[0].id).toBe('ws-2');
    });

    it('should return false when removing non-existent workspace', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const removed = await store.removeWorkspace('does-not-exist');
        expect(removed).toBe(false);
    });

    // --- Workspace update ---
    it('should update workspace fields', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.registerWorkspace({ id: 'ws-1', name: 'Old', rootPath: '/old', color: '#000' });

        const updated = await store.updateWorkspace('ws-1', { name: 'New', color: '#fff' });
        expect(updated).toBeDefined();
        expect(updated!.name).toBe('New');
        expect(updated!.color).toBe('#fff');
        expect(updated!.rootPath).toBe('/old'); // unchanged

        const workspaces = await store.getWorkspaces();
        expect(workspaces[0].name).toBe('New');
    });

    it('should return undefined when updating non-existent workspace', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const updated = await store.updateWorkspace('nope', { name: 'x' });
        expect(updated).toBeUndefined();
    });

    // --- Workspace remoteUrl ---
    it('should register workspace with remoteUrl', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.registerWorkspace({
            id: 'ws-remote', name: 'Remote', rootPath: '/path',
            remoteUrl: 'https://github.com/user/repo.git',
        });
        const workspaces = await store.getWorkspaces();
        const ws = workspaces.find(w => w.id === 'ws-remote');
        expect(ws).toBeDefined();
        expect(ws!.remoteUrl).toBe('https://github.com/user/repo.git');
    });

    it('should persist remoteUrl across reads', async () => {
        const store1 = new FileProcessStore({ dataDir: tmpDir });
        await store1.registerWorkspace({
            id: 'ws-persist', name: 'Persist', rootPath: '/path',
            remoteUrl: 'git@github.com:user/repo.git',
        });

        // Create a new store instance to read from disk
        const store2 = new FileProcessStore({ dataDir: tmpDir });
        const workspaces = await store2.getWorkspaces();
        const ws = workspaces.find(w => w.id === 'ws-persist');
        expect(ws!.remoteUrl).toBe('git@github.com:user/repo.git');
    });

    it('should update remoteUrl via updateWorkspace', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.registerWorkspace({
            id: 'ws-update-remote', name: 'Update', rootPath: '/path',
        });

        const updated = await store.updateWorkspace('ws-update-remote', {
            remoteUrl: 'https://github.com/updated/repo.git',
        });
        expect(updated).toBeDefined();
        expect(updated!.remoteUrl).toBe('https://github.com/updated/repo.git');

        const workspaces = await store.getWorkspaces();
        expect(workspaces.find(w => w.id === 'ws-update-remote')!.remoteUrl)
            .toBe('https://github.com/updated/repo.git');
    });

    it('should register workspace without remoteUrl (undefined)', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.registerWorkspace({
            id: 'ws-no-remote', name: 'No Remote', rootPath: '/path',
        });
        const workspaces = await store.getWorkspaces();
        const ws = workspaces.find(w => w.id === 'ws-no-remote');
        expect(ws!.remoteUrl).toBeUndefined();
    });

    // --- Wiki registration ---
    it('should register and retrieve wikis', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.registerWiki({
            id: 'wiki-1',
            name: 'Project Wiki',
            wikiDir: '/home/user/.wiki',
            repoPath: '/home/user/project',
            aiEnabled: true,
            registeredAt: '2026-01-15T10:00:00.000Z',
        });
        await store.registerWiki({
            id: 'wiki-2',
            name: 'Docs Wiki',
            wikiDir: '/home/user/.docs-wiki',
            aiEnabled: false,
            registeredAt: '2026-01-15T11:00:00.000Z',
            color: '#00ff00',
        });

        const wikis = await store.getWikis();
        expect(wikis).toHaveLength(2);
        expect(wikis.find(w => w.id === 'wiki-1')!.name).toBe('Project Wiki');
        expect(wikis.find(w => w.id === 'wiki-2')!.color).toBe('#00ff00');
    });

    it('should return empty wikis list on fresh store', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const wikis = await store.getWikis();
        expect(wikis).toEqual([]);
    });

    it('should upsert wiki on duplicate registration (idempotent)', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.registerWiki({
            id: 'wiki-1',
            name: 'Original',
            wikiDir: '/path/a',
            aiEnabled: true,
            registeredAt: '2026-01-01T00:00:00.000Z',
        });
        await store.registerWiki({
            id: 'wiki-1',
            name: 'Updated',
            wikiDir: '/path/b',
            aiEnabled: false,
            registeredAt: '2026-02-01T00:00:00.000Z',
        });

        const wikis = await store.getWikis();
        expect(wikis).toHaveLength(1);
        expect(wikis[0].name).toBe('Updated');
        expect(wikis[0].wikiDir).toBe('/path/b');
        expect(wikis[0].aiEnabled).toBe(false);
    });

    // --- Wiki removal ---
    it('should remove a wiki by ID', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.registerWiki({
            id: 'wiki-1', name: 'A', wikiDir: '/a', aiEnabled: true, registeredAt: '2026-01-01T00:00:00.000Z',
        });
        await store.registerWiki({
            id: 'wiki-2', name: 'B', wikiDir: '/b', aiEnabled: false, registeredAt: '2026-01-01T00:00:00.000Z',
        });

        const removed = await store.removeWiki('wiki-1');
        expect(removed).toBe(true);

        const wikis = await store.getWikis();
        expect(wikis).toHaveLength(1);
        expect(wikis[0].id).toBe('wiki-2');
    });

    it('should return false when removing non-existent wiki', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const removed = await store.removeWiki('does-not-exist');
        expect(removed).toBe(false);
    });

    // --- Wiki update ---
    it('should update wiki fields', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.registerWiki({
            id: 'wiki-1', name: 'Old', wikiDir: '/old', aiEnabled: true,
            registeredAt: '2026-01-01T00:00:00.000Z', color: '#000',
        });

        const updated = await store.updateWiki('wiki-1', { name: 'New', color: '#fff', aiEnabled: false });
        expect(updated).toBeDefined();
        expect(updated!.name).toBe('New');
        expect(updated!.color).toBe('#fff');
        expect(updated!.aiEnabled).toBe(false);
        expect(updated!.wikiDir).toBe('/old'); // unchanged

        const wikis = await store.getWikis();
        expect(wikis[0].name).toBe('New');
    });

    it('should return undefined when updating non-existent wiki', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const updated = await store.updateWiki('nope', { name: 'x' });
        expect(updated).toBeUndefined();
    });

    // --- Wiki persistence across instances ---
    it('should persist wikis across separate store instances', async () => {
        const store1 = new FileProcessStore({ dataDir: tmpDir });
        await store1.registerWiki({
            id: 'wiki-1', name: 'Persisted', wikiDir: '/wiki', aiEnabled: true,
            registeredAt: '2026-01-01T00:00:00.000Z',
        });

        const store2 = new FileProcessStore({ dataDir: tmpDir });
        const wikis = await store2.getWikis();
        expect(wikis).toHaveLength(1);
        expect(wikis[0].name).toBe('Persisted');
    });

    // --- Wiki atomic write safety ---
    it('should persist wikis to wikis.json with atomic writes', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.registerWiki({
            id: 'wiki-1', name: 'Test', wikiDir: '/test', aiEnabled: true,
            registeredAt: '2026-01-01T00:00:00.000Z',
        });

        const raw = await fs.readFile(path.join(tmpDir, 'wikis.json'), 'utf-8');
        expect(() => JSON.parse(raw)).not.toThrow();
        const parsed = JSON.parse(raw);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].id).toBe('wiki-1');
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

    // --- onProcessOutput / emitProcessOutput ---
    it('should deliver output chunks to subscriber in order', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1', { status: 'running' }));

        const received: ProcessOutputEvent[] = [];
        store.onProcessOutput('p1', (event) => received.push(event));

        store.emitProcessOutput('p1', 'chunk-1');
        store.emitProcessOutput('p1', 'chunk-2');
        store.emitProcessOutput('p1', 'chunk-3');

        expect(received).toHaveLength(3);
        expect(received[0]).toEqual({ type: 'chunk', content: 'chunk-1' });
        expect(received[1]).toEqual({ type: 'chunk', content: 'chunk-2' });
        expect(received[2]).toEqual({ type: 'chunk', content: 'chunk-3' });
    });

    it('should deliver complete event and clean up emitter', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1', { status: 'running' }));

        const received: ProcessOutputEvent[] = [];
        store.onProcessOutput('p1', (event) => received.push(event));

        store.emitProcessOutput('p1', 'hello');
        store.emitProcessComplete('p1', 'completed', '2m 30s');

        expect(received).toHaveLength(2);
        expect(received[1]).toEqual({ type: 'complete', status: 'completed', duration: '2m 30s' });

        // Emitter should be cleaned up — further emits are no-ops
        store.emitProcessOutput('p1', 'after-complete');
        expect(received).toHaveLength(2);
    });

    it('should support unsubscribe before complete', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });

        const received: ProcessOutputEvent[] = [];
        const unsub = store.onProcessOutput('p1', (event) => received.push(event));

        store.emitProcessOutput('p1', 'before-unsub');
        unsub();
        store.emitProcessOutput('p1', 'after-unsub');

        expect(received).toHaveLength(1);
        expect(received[0].content).toBe('before-unsub');
    });

    it('should handle emitProcessOutput with no subscribers', () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        // Should not throw
        store.emitProcessOutput('no-subscribers', 'data');
    });

    it('should handle emitProcessComplete with no subscribers', () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        // No emitter exists — should not throw
        store.emitProcessComplete('no-emitter', 'completed', '1s');
    });

    // --- Concurrent write safety (expanded) ---
    it('should handle 10 parallel updates on overlapping IDs', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        for (let i = 0; i < 5; i++) {
            await store.addProcess(makeProcess(`p${i}`, { status: 'running' }));
        }

        const updates = Array.from({ length: 10 }, (_, i) =>
            store.updateProcess(`p${i % 5}`, { result: `result-${i}` })
        );
        await Promise.all(updates);

        // All 5 processes should still exist and have a result
        for (let i = 0; i < 5; i++) {
            const p = await store.getProcess(`p${i}`);
            expect(p).toBeDefined();
            expect(p!.result).toBeDefined();
        }
    });

    // --- Large dataset performance ---
    it('should handle 500 processes with fast list and get', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir, maxProcesses: 600 });
        const count = 500;

        for (let i = 0; i < count; i++) {
            await store.addProcess(makeProcess(`p${i}`, {
                metadata: { type: 'clarification', workspaceId: i % 2 === 0 ? 'ws-a' : 'ws-b' }
            }));
        }

        const startList = Date.now();
        const all = await store.getAllProcesses();
        const listDuration = Date.now() - startList;
        expect(all).toHaveLength(count);
        expect(listDuration).toBeLessThan(2000);

        // Filter by workspace
        const wsA = await store.getAllProcesses({ workspaceId: 'ws-a' });
        expect(wsA).toHaveLength(250);

        // Fast single get
        const startGet = Date.now();
        const last = await store.getProcess(`p${count - 1}`);
        const getDuration = Date.now() - startGet;
        expect(last).toBeDefined();
        expect(getDuration).toBeLessThan(500);
    });

    // --- Retention pruning expanded ---
    it('should prune old processes while respecting maxCount', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir, maxProcesses: 100 });

        // Insert 150 completed processes
        for (let i = 0; i < 150; i++) {
            await store.addProcess(makeProcess(`p${i}`, {
                status: 'completed',
                startTime: new Date(Date.now() - (150 - i) * 60_000),
            }));
        }

        const all = await store.getAllProcesses();
        expect(all.length).toBeLessThanOrEqual(100);
    });
});

describe('getDefaultDataDir', () => {
    it('should return COC_DATA_DIR when env var is set, else ~/.coc under homedir', () => {
        const dir = getDefaultDataDir();
        if (process.env.COC_DATA_DIR) {
            expect(dir).toBe(process.env.COC_DATA_DIR);
        } else {
            expect(dir).toContain('.coc');
            expect(dir.startsWith(os.homedir())).toBe(true);
        }
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

// ============================================================================
// clearAllWorkspaces / clearAllWikis / getStorageStats
// ============================================================================

describe('FileProcessStore - Admin Methods', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fps-admin-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    // --- clearAllWorkspaces ---

    it('clearAllWorkspaces should clear all workspaces and return count', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.registerWorkspace({ id: 'ws1', name: 'Workspace 1', rootPath: '/tmp/ws1' });
        await store.registerWorkspace({ id: 'ws2', name: 'Workspace 2', rootPath: '/tmp/ws2' });

        const removed = await store.clearAllWorkspaces();
        expect(removed).toBe(2);

        const remaining = await store.getWorkspaces();
        expect(remaining).toEqual([]);
    });

    it('clearAllWorkspaces should return 0 for empty store', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const removed = await store.clearAllWorkspaces();
        expect(removed).toBe(0);
    });

    // --- clearAllWikis ---

    it('clearAllWikis should clear all wikis and return count', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.registerWiki({
            id: 'w1', name: 'Wiki 1', wikiDir: '/tmp/w1', aiEnabled: false, registeredAt: new Date().toISOString(),
        });
        await store.registerWiki({
            id: 'w2', name: 'Wiki 2', wikiDir: '/tmp/w2', aiEnabled: true, registeredAt: new Date().toISOString(),
        });

        const removed = await store.clearAllWikis();
        expect(removed).toBe(2);

        const remaining = await store.getWikis();
        expect(remaining).toEqual([]);
    });

    it('clearAllWikis should return 0 for empty store', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const removed = await store.clearAllWikis();
        expect(removed).toBe(0);
    });

    // --- getStorageStats ---

    it('getStorageStats should return correct counts', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });

        await store.addProcess(makeProcess('p1'));
        await store.addProcess(makeProcess('p2'));
        await store.registerWorkspace({ id: 'ws1', name: 'WS', rootPath: '/tmp/ws1' });
        await store.registerWiki({
            id: 'w1', name: 'Wiki', wikiDir: '/tmp/w1', aiEnabled: false, registeredAt: new Date().toISOString(),
        });

        const stats = await store.getStorageStats();
        expect(stats.totalProcesses).toBe(2);
        expect(stats.totalWorkspaces).toBe(1);
        expect(stats.totalWikis).toBe(1);
        expect(stats.storageSize).toBeGreaterThan(0);
    });

    it('getStorageStats should return zeros for empty store', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const stats = await store.getStorageStats();
        expect(stats.totalProcesses).toBe(0);
        expect(stats.totalWorkspaces).toBe(0);
        expect(stats.totalWikis).toBe(0);
        expect(stats.storageSize).toBe(0);
    });
});

// ============================================================================
// Index + Per-Process Files Architecture
// ============================================================================

describe('FileProcessStore - Index + Per-Process Files', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fps-index-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('should create processes/ directory with index.json and per-process files', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1'));
        await store.addProcess(makeProcess('p2'));

        // Verify directory structure
        const indexRaw = await fs.readFile(path.join(tmpDir, 'processes', 'index.json'), 'utf-8');
        const index = JSON.parse(indexRaw) as ProcessIndexEntry[];
        expect(index).toHaveLength(2);
        expect(index.map(e => e.id).sort()).toEqual(['p1', 'p2']);

        // Verify per-process files exist
        const p1Raw = await fs.readFile(path.join(tmpDir, 'processes', 'p1.json'), 'utf-8');
        const p1Entry = JSON.parse(p1Raw) as StoredProcessEntry;
        expect(p1Entry.process.id).toBe('p1');
        expect(p1Entry.process.fullPrompt).toBe('Full prompt for p1');
    });

    it('index.json should not contain heavy fields (fullPrompt, result, conversationTurns)', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1', {
            fullPrompt: 'A very long prompt...',
            result: 'A very long result...',
            conversationTurns: [
                { role: 'user', content: 'Hello', timestamp: new Date(), turnIndex: 0 },
            ],
        }));

        const indexRaw = await fs.readFile(path.join(tmpDir, 'processes', 'index.json'), 'utf-8');
        const index = JSON.parse(indexRaw);
        expect(index).toHaveLength(1);
        const entry = index[0];
        expect(entry.fullPrompt).toBeUndefined();
        expect(entry.result).toBeUndefined();
        expect(entry.conversationTurns).toBeUndefined();
        expect(entry.id).toBe('p1');
        expect(entry.status).toBe('completed');
    });

    it('should handle missing per-process file gracefully (getProcess returns undefined)', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1'));
        await store.addProcess(makeProcess('p2'));

        // Manually delete p1's file to simulate inconsistency
        await fs.unlink(path.join(tmpDir, 'processes', 'p1.json'));

        expect(await store.getProcess('p1')).toBeUndefined();
        // p2 should still work
        const p2 = await store.getProcess('p2');
        expect(p2).toBeDefined();
        expect(p2!.id).toBe('p2');
    });

    it('should skip missing per-process files in getAllProcesses', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1'));
        await store.addProcess(makeProcess('p2'));
        await store.addProcess(makeProcess('p3'));

        // Delete p2's file
        await fs.unlink(path.join(tmpDir, 'processes', 'p2.json'));

        const all = await store.getAllProcesses();
        expect(all).toHaveLength(2);
        expect(all.map(p => p.id).sort()).toEqual(['p1', 'p3']);
    });

    it('prune should delete per-process files for pruned entries', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir, maxProcesses: 5 });

        for (let i = 0; i < 8; i++) {
            await store.addProcess(makeProcess(`p${i}`, {
                status: 'completed',
                startTime: new Date(Date.now() + i * 1000),
            }));
        }

        const all = await store.getAllProcesses();
        expect(all.length).toBeLessThanOrEqual(5);

        // Verify pruned files are gone
        const files = await fs.readdir(path.join(tmpDir, 'processes'));
        const jsonFiles = files.filter(f => f !== 'index.json' && f.endsWith('.json'));
        expect(jsonFiles.length).toBeLessThanOrEqual(5);
    });

    it('clear should delete per-process files', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1'));
        await store.addProcess(makeProcess('p2'));
        await store.addProcess(makeProcess('p3'));

        await store.clearProcesses();

        // Verify all process files are deleted
        const files = await fs.readdir(path.join(tmpDir, 'processes'));
        const jsonFiles = files.filter(f => f !== 'index.json' && f.endsWith('.json'));
        expect(jsonFiles).toHaveLength(0);

        // Index should be empty
        const indexRaw = await fs.readFile(path.join(tmpDir, 'processes', 'index.json'), 'utf-8');
        expect(JSON.parse(indexRaw)).toEqual([]);
    });

    it('remove should delete the per-process file', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1'));
        await store.addProcess(makeProcess('p2'));

        await store.removeProcess('p1');

        // p1 file should be gone
        const files = await fs.readdir(path.join(tmpDir, 'processes'));
        const jsonFiles = files.filter(f => f !== 'index.json' && f.endsWith('.json'));
        expect(jsonFiles).toEqual(['p2.json']);
    });

    // --- Legacy migration ---
    it('should migrate legacy processes.json to index + per-process files', async () => {
        // Create a legacy processes.json
        const legacyEntries: StoredProcessEntry[] = [
            {
                workspaceId: 'ws-1',
                process: {
                    id: 'legacy-1',
                    type: 'clarification',
                    promptPreview: 'prompt-1',
                    fullPrompt: 'Full prompt 1',
                    status: 'completed',
                    startTime: '2026-01-15T10:00:00.000Z',
                },
            },
            {
                workspaceId: 'ws-2',
                process: {
                    id: 'legacy-2',
                    type: 'code-review',
                    promptPreview: 'prompt-2',
                    fullPrompt: 'Full prompt 2',
                    status: 'running',
                    startTime: '2026-01-15T11:00:00.000Z',
                },
            },
        ];
        await fs.writeFile(
            path.join(tmpDir, 'processes.json'),
            JSON.stringify(legacyEntries, null, 2),
            'utf-8'
        );

        // Create store — migration should run on first access
        const store = new FileProcessStore({ dataDir: tmpDir });
        const all = await store.getAllProcesses();
        expect(all).toHaveLength(2);
        expect(all.map(p => p.id).sort()).toEqual(['legacy-1', 'legacy-2']);

        // Verify index.json was created
        const indexRaw = await fs.readFile(path.join(tmpDir, 'processes', 'index.json'), 'utf-8');
        const index = JSON.parse(indexRaw) as ProcessIndexEntry[];
        expect(index).toHaveLength(2);

        // Verify per-process files were created
        const p1 = await store.getProcess('legacy-1');
        expect(p1).toBeDefined();
        expect(p1!.fullPrompt).toBe('Full prompt 1');

        // Verify legacy file was renamed to .bak
        const bakExists = await fs.access(path.join(tmpDir, 'processes.json.bak')).then(() => true, () => false);
        expect(bakExists).toBe(true);

        // Original processes.json should be gone
        const origExists = await fs.access(path.join(tmpDir, 'processes.json')).then(() => true, () => false);
        expect(origExists).toBe(false);
    });

    it('should not re-migrate if index.json already exists', async () => {
        // Create legacy file AND already-migrated index
        await fs.writeFile(path.join(tmpDir, 'processes.json'), '[]', 'utf-8');
        await fs.mkdir(path.join(tmpDir, 'processes'), { recursive: true });
        await fs.writeFile(path.join(tmpDir, 'processes', 'index.json'), '[]', 'utf-8');

        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1'));

        // Legacy file should still exist (not renamed)
        const origExists = await fs.access(path.join(tmpDir, 'processes.json')).then(() => true, () => false);
        expect(origExists).toBe(true);
    });

    it('should sanitize process IDs in filenames to prevent path traversal', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const dangerousId = '../../../etc/passwd';
        await store.addProcess(makeProcess(dangerousId));

        const retrieved = await store.getProcess(dangerousId);
        expect(retrieved).toBeDefined();
        expect(retrieved!.id).toBe(dangerousId);

        // The file should be inside processesDir, not escaping it
        const files = await fs.readdir(path.join(tmpDir, 'processes'));
        const jsonFiles = files.filter(f => f !== 'index.json' && f.endsWith('.json'));
        expect(jsonFiles).toHaveLength(1);
        // Sanitized: ../../../etc/passwd -> ______etc_passwd
        expect(jsonFiles[0]).not.toContain('..');
    });
});
