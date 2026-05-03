import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { RawMemoryRecordStore, MemoryCandidateStore, BoundedMemoryStore, ENTRY_DELIMITER } from '@plusplusoneplusplus/forge';
import { MemoryAggregateExecutor } from '../../../src/server/memory/memory-aggregate-executor';
import type { MemoryAggregatePayload } from '../../../src/server/tasks/task-types';

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'mem-agg-test-'));
}

function makePayload(overrides?: Partial<MemoryAggregatePayload>): MemoryAggregatePayload {
    return {
        kind: 'memory-aggregate',
        workspaceId: 'ws-test',
        target: 'memory',
        ...overrides,
    };
}

function makeTask(payload: MemoryAggregatePayload, model?: string): QueuedTask {
    return {
        id: 'task-agg-1',
        type: 'memory-aggregate',
        priority: 'low',
        status: 'running',
        createdAt: Date.now(),
        retryCount: 0,
        payload: payload as any,
        config: { model },
    } as QueuedTask;
}

describe('MemoryAggregateExecutor', () => {
    let tmpDir: string;
    let mockAiService: any;

    beforeEach(() => {
        tmpDir = makeTmpDir();
        mockAiService = {
            sendMessage: vi.fn(),
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function repoMemoryDir(workspaceId: string): string {
        return path.join(tmpDir, 'repos', workspaceId, 'memory');
    }

    function repoMemoryFile(workspaceId: string): string {
        return path.join(repoMemoryDir(workspaceId), 'MEMORY.md');
    }

    function setupRepoDir(workspaceId: string) {
        const repoDir = repoMemoryDir(workspaceId);
        fs.mkdirSync(repoDir, { recursive: true });
        return repoDir;
    }

    function seedRawRecords(workspaceId: string, records: string[]): void {
        const memDir = setupRepoDir(workspaceId);
        const rawStore = new RawMemoryRecordStore({ dbPath: path.join(memDir, 'raw-memory.db') });
        for (const content of records) {
            rawStore.append({
                target: 'repo',
                content,
                source: 'test',
                workspaceId,
            });
        }
        rawStore.close();
    }

    function seedBoundedMemory(workspaceId: string, content: string): void {
        const memDir = setupRepoDir(workspaceId);
        fs.writeFileSync(path.join(memDir, 'MEMORY.md'), content, 'utf-8');
    }

    function readBoundedMemoryRaw(workspaceId: string): string {
        const filePath = repoMemoryFile(workspaceId);
        return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
    }

    async function readRepoStats(workspaceId: string) {
        const candidateStore = new MemoryCandidateStore({
            dbPath: path.join(repoMemoryDir(workspaceId), 'raw-memory.db'),
        });
        const stats = await candidateStore.getStats();
        candidateStore.close();
        return stats;
    }

    it('retains pending candidates without invoking AI or rewriting bounded MEMORY.md', async () => {
        const wsId = 'ws-preserve';
        const originalMemory = [
            '  Existing fact with intentional spacing  ',
            'Existing fact about tests',
            'Existing fact about tests',
        ].join(ENTRY_DELIMITER);
        seedRawRecords(wsId, ['User prefers dark mode', 'Project uses pnpm']);
        seedBoundedMemory(wsId, originalMemory);

        const executor = new MemoryAggregateExecutor(mockAiService, tmpDir);
        const result = await executor.execute(makeTask(makePayload({ workspaceId: wsId })));

        expect(result.success).toBe(true);
        expect(result.result).toBe('Memory promotion pending; retained 2 candidate(s)');
        expect(mockAiService.sendMessage).not.toHaveBeenCalled();
        expect(readBoundedMemoryRaw(wsId)).toBe(originalMemory);

        const stats = await readRepoStats(wsId);
        expect(stats.pending).toBe(2);
        expect(stats.promoted).toBe(0);
        expect(stats.dropped).toBe(0);
        expect(stats.ignored).toBe(0);
    });

    it('does not call setEntries when pending raw candidates exist', async () => {
        const wsId = 'ws-no-set-entries';
        seedRawRecords(wsId, ['New candidate']);
        seedBoundedMemory(wsId, 'Trusted existing memory');
        const setEntriesSpy = vi.spyOn(BoundedMemoryStore.prototype, 'setEntries');

        const executor = new MemoryAggregateExecutor(mockAiService, tmpDir);
        const result = await executor.execute(makeTask(makePayload({ workspaceId: wsId })));

        expect(result.success).toBe(true);
        expect(setEntriesSpy).not.toHaveBeenCalled();
        expect(readBoundedMemoryRaw(wsId)).toBe('Trusted existing memory');
        setEntriesSpy.mockRestore();
    });

    it('returns early when no pending candidates exist', async () => {
        const wsId = 'ws-empty';
        setupRepoDir(wsId);
        const rawStore = new RawMemoryRecordStore({
            dbPath: path.join(repoMemoryDir(wsId), 'raw-memory.db'),
        });
        rawStore.close();

        const executor = new MemoryAggregateExecutor(mockAiService, tmpDir);
        const result = await executor.execute(makeTask(makePayload({ workspaceId: wsId })));

        expect(result.success).toBe(true);
        expect(result.result).toBe('No pending candidates');
        expect(mockAiService.sendMessage).not.toHaveBeenCalled();
        expect(fs.existsSync(repoMemoryFile(wsId))).toBe(false);
    });

    it('system-scope aggregation reads only system candidates and preserves system MEMORY.md', async () => {
        const wsId = 'ws-sys';
        const systemDir = path.join(tmpDir, 'memory', 'system');
        const systemMemoryPath = path.join(systemDir, 'MEMORY.md');
        fs.mkdirSync(systemDir, { recursive: true });
        fs.writeFileSync(systemMemoryPath, 'Global preference: light theme', 'utf-8');

        const rawStore = new RawMemoryRecordStore({
            dbPath: path.join(systemDir, 'raw-memory.db'),
        });
        await rawStore.append({
            target: 'system',
            content: 'Global preference: dark theme',
            source: 'test',
            workspaceId: wsId,
        });
        rawStore.close();
        seedRawRecords(wsId, ['Repo-scoped fact']);

        const executor = new MemoryAggregateExecutor(mockAiService, tmpDir);
        const result = await executor.execute(
            makeTask(makePayload({ workspaceId: wsId, target: 'system' })),
        );

        expect(result.success).toBe(true);
        expect(mockAiService.sendMessage).not.toHaveBeenCalled();
        expect(fs.readFileSync(systemMemoryPath, 'utf-8')).toBe('Global preference: light theme');

        const systemRaw = new MemoryCandidateStore({
            dbPath: path.join(systemDir, 'raw-memory.db'),
        });
        const systemStats = await systemRaw.getStats();
        systemRaw.close();
        expect(systemStats.pending).toBe(1);

        const repoStats = await readRepoStats(wsId);
        expect(repoStats.pending).toBe(1);
        expect(repoStats.dropped).toBe(0);
    });

    it('includes durationMs in result', async () => {
        const wsId = 'ws-dur';
        seedRawRecords(wsId, ['Fact']);

        const executor = new MemoryAggregateExecutor(mockAiService, tmpDir);
        const result = await executor.execute(makeTask(makePayload({ workspaceId: wsId })));

        expect(typeof result.durationMs).toBe('number');
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
});
