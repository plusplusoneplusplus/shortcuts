/**
 * Tests for MemoryAggregateExecutor — verifies raw observations are deleted
 * after successful AI consolidation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MemoryAggregateExecutor } from '../../src/server/memory/memory-aggregate-executor';
import { createMockProcessStore } from './helpers/mock-process-store';
import { writeMemoryConfig, DEFAULT_MEMORY_CONFIG } from '../../src/server/memory/memory-config-handler';
import { FileMemoryStore as ObservationStore } from '@plusplusoneplusplus/forge';
import { FileMemoryStore as NoteMemoryStore } from '../../src/server/memory/memory-store';

// Mock the AI invoker module so we never call a real AI service
const mockAIFn = vi.fn().mockResolvedValue({ success: true, response: '# Consolidated\n- fact1' });
vi.mock('../../src/ai-invoker', () => ({
    createCLIAIInvoker: vi.fn(() => mockAIFn),
}));

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-agg-test-'));
    writeMemoryConfig(tmpDir, { ...DEFAULT_MEMORY_CONFIG, storageDir: path.join(tmpDir, 'memory') });
    mockAIFn.mockReset().mockResolvedValue({ success: true, response: '# Consolidated\n- fact1' });
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Seed raw observation files via the store's writeRaw and return the store. */
async function seedObservations(workspaceId: string, count: number): Promise<ObservationStore> {
    const repoDir = path.join(tmpDir, 'repos', workspaceId, 'memory', 'observations');
    fs.mkdirSync(repoDir, { recursive: true });
    const pStore = new ObservationStore({ dataDir: path.join(tmpDir, 'memory'), repoDir });

    for (let i = 0; i < count; i++) {
        await pStore.writeRaw('repo', undefined, {
            pipeline: `pipeline-${i}`,
            timestamp: new Date(Date.now() - i * 1000).toISOString(),
        }, `observation ${i}`);
    }
    return pStore;
}

/** Seed user notes via the server-side FileMemoryStore. */
function seedNotes(workspaceId: string, count: number): NoteMemoryStore {
    const noteDir = path.join(tmpDir, 'repos', workspaceId, 'memory', 'notes');
    fs.mkdirSync(noteDir, { recursive: true });
    const store = new NoteMemoryStore(noteDir);
    for (let i = 0; i < count; i++) {
        store.create({ summary: `note ${i}`, tags: [`tag${i}`], content: `note content ${i}` });
    }
    return store;
}

function makeTask(id: string, workspaceId: string, sources: string[] = ['observations']): any {
    return {
        id,
        queue: 'memory',
        type: 'memory-aggregate',
        payload: { repoId: workspaceId, sources, model: 'test-model' },
        status: 'running',
        addedAt: new Date().toISOString(),
    };
}

describe('MemoryAggregateExecutor', () => {
    it('deletes raw observation files after successful consolidation', async () => {
        const workspaceId = 'test-repo';
        const pStore = await seedObservations(workspaceId, 3);

        // Verify raw files exist before execution
        const beforeList = await pStore.listRaw('repo', undefined);
        expect(beforeList.length).toBe(3);

        const processStore = createMockProcessStore();
        const executor = new MemoryAggregateExecutor(processStore, tmpDir);
        const result = await executor.execute(makeTask('task-1', workspaceId));

        expect(result.success).toBe(true);

        // Raw files must be gone after aggregation
        const afterList = await pStore.listRaw('repo', undefined);
        expect(afterList).toEqual([]);
    });

    it('does not delete raw files when AI call fails', async () => {
        mockAIFn.mockResolvedValueOnce({ success: false, error: 'AI unavailable' });

        const workspaceId = 'test-repo-fail';
        const pStore = await seedObservations(workspaceId, 2);

        const processStore = createMockProcessStore();
        const executor = new MemoryAggregateExecutor(processStore, tmpDir);
        const result = await executor.execute(makeTask('task-2', workspaceId));

        expect(result.success).toBe(false);

        // Raw files must still exist after a failed aggregation
        const afterList = await pStore.listRaw('repo', undefined);
        expect(afterList.length).toBe(2);
    });

    it('deletes notes after successful consolidation with observations', async () => {
        const workspaceId = 'test-repo-notes';
        const pStore = await seedObservations(workspaceId, 2);
        const noteStore = seedNotes(workspaceId, 3);

        const processStore = createMockProcessStore();
        const executor = new MemoryAggregateExecutor(processStore, tmpDir);
        const result = await executor.execute(makeTask('task-3', workspaceId, ['observations', 'notes']));

        expect(result.success).toBe(true);

        // Both observations and notes must be deleted
        const afterObs = await pStore.listRaw('repo', undefined);
        expect(afterObs).toEqual([]);
        const afterNotes = noteStore.list({ pageSize: 10000 });
        expect(afterNotes.entries).toEqual([]);
    });

    it('does not delete notes when AI call fails', async () => {
        mockAIFn.mockResolvedValueOnce({ success: false, error: 'AI unavailable' });

        const workspaceId = 'test-repo-notes-fail';
        const noteStore = seedNotes(workspaceId, 2);

        const processStore = createMockProcessStore();
        const executor = new MemoryAggregateExecutor(processStore, tmpDir);
        const result = await executor.execute(makeTask('task-4', workspaceId, ['notes']));

        expect(result.success).toBe(false);

        // Notes must still exist
        const afterNotes = noteStore.list({ pageSize: 10000 });
        expect(afterNotes.entries.length).toBe(2);
    });

    it('handles notes-only consolidation', async () => {
        const workspaceId = 'test-repo-notes-only';
        seedNotes(workspaceId, 3);

        // Ensure observations dir exists for consolidated write
        const repoDir = path.join(tmpDir, 'repos', workspaceId, 'memory', 'observations');
        fs.mkdirSync(repoDir, { recursive: true });

        const processStore = createMockProcessStore();
        const executor = new MemoryAggregateExecutor(processStore, tmpDir);
        const result = await executor.execute(makeTask('task-5', workspaceId, ['notes']));

        expect(result.success).toBe(true);
        expect((result.result as any).consolidated).toContain('Consolidated');

        // Notes must be deleted
        const noteStore = seedNotes(workspaceId, 0); // get handle
        const afterNotes = noteStore.list({ pageSize: 10000 });
        expect(afterNotes.entries).toEqual([]);
    });
});
