import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { QueuedTask, TaskExecutionResult } from '@plusplusoneplusplus/forge';
import { RawMemoryRecordStore, BoundedMemoryStore, ENTRY_DELIMITER } from '@plusplusoneplusplus/forge';
import { MemoryAggregateExecutor } from '../../../src/server/memory/memory-aggregate-executor';
import type { MemoryAggregatePayload } from '../../../src/server/task-types';

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
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function setupRepoDir(workspaceId: string) {
        const repoDir = path.join(tmpDir, 'repos', workspaceId, 'memory');
        fs.mkdirSync(repoDir, { recursive: true });
        return repoDir;
    }

    function seedRawRecords(workspaceId: string, records: string[]): RawMemoryRecordStore {
        const memDir = path.join(tmpDir, 'repos', workspaceId, 'memory');
        fs.mkdirSync(memDir, { recursive: true });
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
        return rawStore;
    }

    function seedBoundedMemory(workspaceId: string, entries: string[]): void {
        const memDir = path.join(tmpDir, 'repos', workspaceId, 'memory');
        fs.mkdirSync(memDir, { recursive: true });
        const filePath = path.join(memDir, 'MEMORY.md');
        if (entries.length > 0) {
            fs.writeFileSync(filePath, entries.join(ENTRY_DELIMITER), 'utf-8');
        }
    }

    function readBoundedMemory(workspaceId: string): string[] {
        const filePath = path.join(tmpDir, 'repos', workspaceId, 'memory', 'MEMORY.md');
        if (!fs.existsSync(filePath)) return [];
        const content = fs.readFileSync(filePath, 'utf-8');
        if (!content.trim()) return [];
        return content.split(ENTRY_DELIMITER);
    }

    // ─── Happy path ────────────────────────────────────────────────

    it('claims pending rows, invokes AI, and updates bounded MEMORY.md', async () => {
        const wsId = 'ws-happy';
        seedRawRecords(wsId, ['User prefers dark mode', 'Project uses pnpm']);
        seedBoundedMemory(wsId, ['Existing fact about tests']);

        mockAiService.sendMessage.mockResolvedValue({
            success: true,
            response: JSON.stringify([
                'Existing fact about tests',
                'User prefers dark mode',
                'Project uses pnpm',
            ]),
        });

        const executor = new MemoryAggregateExecutor(mockAiService, tmpDir);
        const result = await executor.execute(makeTask(makePayload({ workspaceId: wsId })));

        expect(result.success).toBe(true);
        expect(result.result).toContain('Reconciled 2 records');

        // Verify AI was called
        expect(mockAiService.sendMessage).toHaveBeenCalledTimes(1);
        const callArgs = mockAiService.sendMessage.mock.calls[0][0];
        expect(callArgs.systemMessage.mode).toBe('replace');
        expect(callArgs.systemMessage.content).toContain('<candidates>');
        expect(callArgs.tools).toEqual([]);

        // Verify MEMORY.md was updated
        const entries = readBoundedMemory(wsId);
        expect(entries).toContain('Existing fact about tests');
        expect(entries).toContain('User prefers dark mode');
        expect(entries).toContain('Project uses pnpm');
    });

    // ─── No pending records ────────────────────────────────────────

    it('returns early when no pending records exist', async () => {
        const wsId = 'ws-empty';
        setupRepoDir(wsId);
        // Create empty raw store
        const rawStore = new RawMemoryRecordStore({
            dbPath: path.join(tmpDir, 'repos', wsId, 'memory', 'raw-memory.db'),
        });
        rawStore.close();

        const executor = new MemoryAggregateExecutor(mockAiService, tmpDir);
        const result = await executor.execute(makeTask(makePayload({ workspaceId: wsId })));

        expect(result.success).toBe(true);
        expect(result.result).toBe('No pending records');
        expect(mockAiService.sendMessage).not.toHaveBeenCalled();
    });

    // ─── AI failure releases claims ────────────────────────────────

    it('releases claimed rows on AI failure for retry', async () => {
        const wsId = 'ws-fail';
        seedRawRecords(wsId, ['Some fact']);

        mockAiService.sendMessage.mockResolvedValue({
            success: false,
            error: 'AI temporarily unavailable',
        });

        const executor = new MemoryAggregateExecutor(mockAiService, tmpDir);
        const result = await executor.execute(makeTask(makePayload({ workspaceId: wsId })));

        expect(result.success).toBe(false);

        // Verify records are back to pending
        const rawStore = new RawMemoryRecordStore({
            dbPath: path.join(tmpDir, 'repos', wsId, 'memory', 'raw-memory.db'),
        });
        const pending = await rawStore.listPending();
        expect(pending).toHaveLength(1);
        expect(pending[0].content).toBe('Some fact');
        rawStore.close();
    });

    // ─── Malformed JSON releases claims ────────────────────────────

    it('releases claims when AI returns non-JSON response', async () => {
        const wsId = 'ws-badjson';
        seedRawRecords(wsId, ['A fact']);

        mockAiService.sendMessage.mockResolvedValue({
            success: true,
            response: 'This is not JSON at all.',
        });

        const executor = new MemoryAggregateExecutor(mockAiService, tmpDir);
        const result = await executor.execute(makeTask(makePayload({ workspaceId: wsId })));

        expect(result.success).toBe(false);
        expect((result as any).error?.message).toContain('Failed to parse');

        // Records should be pending again
        const rawStore = new RawMemoryRecordStore({
            dbPath: path.join(tmpDir, 'repos', wsId, 'memory', 'raw-memory.db'),
        });
        const pending = await rawStore.listPending();
        expect(pending).toHaveLength(1);
        rawStore.close();
    });

    // ─── Markdown-fenced JSON is handled ───────────────────────────

    it('extracts JSON from markdown-fenced response', async () => {
        const wsId = 'ws-fenced';
        seedRawRecords(wsId, ['Fact A']);
        seedBoundedMemory(wsId, []);

        mockAiService.sendMessage.mockResolvedValue({
            success: true,
            response: '```json\n["Fact A"]\n```',
        });

        const executor = new MemoryAggregateExecutor(mockAiService, tmpDir);
        const result = await executor.execute(makeTask(makePayload({ workspaceId: wsId })));

        expect(result.success).toBe(true);
        const entries = readBoundedMemory(wsId);
        expect(entries).toContain('Fact A');
    });

    // ─── System scope isolation ────────────────────────────────────

    it('system-scope aggregation uses system raw store path', async () => {
        const wsId = 'ws-sys';
        // Seed system-level raw records
        const systemDir = path.join(tmpDir, 'memory', 'system');
        fs.mkdirSync(systemDir, { recursive: true });
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

        mockAiService.sendMessage.mockResolvedValue({
            success: true,
            response: JSON.stringify(['Global preference: dark theme']),
        });

        const executor = new MemoryAggregateExecutor(mockAiService, tmpDir);
        const result = await executor.execute(
            makeTask(makePayload({ workspaceId: wsId, target: 'system' })),
        );

        expect(result.success).toBe(true);

        // Verify system MEMORY.md was written
        const systemMemPath = path.join(systemDir, 'MEMORY.md');
        expect(fs.existsSync(systemMemPath)).toBe(true);
        const content = fs.readFileSync(systemMemPath, 'utf-8');
        expect(content).toContain('Global preference: dark theme');
    });

    // ─── Model passthrough ─────────────────────────────────────────

    it('passes model from payload to AI service', async () => {
        const wsId = 'ws-model';
        seedRawRecords(wsId, ['Fact']);
        seedBoundedMemory(wsId, []);

        mockAiService.sendMessage.mockResolvedValue({
            success: true,
            response: JSON.stringify(['Fact']),
        });

        const executor = new MemoryAggregateExecutor(mockAiService, tmpDir);
        await executor.execute(
            makeTask(makePayload({ workspaceId: wsId, model: 'gpt-4o-mini' })),
        );

        const callArgs = mockAiService.sendMessage.mock.calls[0][0];
        expect(callArgs.model).toBe('gpt-4o-mini');
    });

    // ─── Duration tracking ─────────────────────────────────────────

    it('includes durationMs in result', async () => {
        const wsId = 'ws-dur';
        seedRawRecords(wsId, ['Fact']);
        seedBoundedMemory(wsId, []);

        mockAiService.sendMessage.mockResolvedValue({
            success: true,
            response: JSON.stringify(['Fact']),
        });

        const executor = new MemoryAggregateExecutor(mockAiService, tmpDir);
        const result = await executor.execute(makeTask(makePayload({ workspaceId: wsId })));

        expect(typeof result.durationMs).toBe('number');
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    // ─── Validation failure releases claims ────────────────────────

    it('releases claims when AI output fails validation', async () => {
        const wsId = 'ws-validate';
        seedRawRecords(wsId, ['Fact']);

        // Return a non-array
        mockAiService.sendMessage.mockResolvedValue({
            success: true,
            response: JSON.stringify({ not: 'an array' }),
        });

        const executor = new MemoryAggregateExecutor(mockAiService, tmpDir);
        const result = await executor.execute(makeTask(makePayload({ workspaceId: wsId })));

        expect(result.success).toBe(false);
        expect((result as any).error?.message).toContain('Validation failed');

        // Records should be pending again
        const rawStore = new RawMemoryRecordStore({
            dbPath: path.join(tmpDir, 'repos', wsId, 'memory', 'raw-memory.db'),
        });
        const pending = await rawStore.listPending();
        expect(pending).toHaveLength(1);
        rawStore.close();
    });

    // ─── System scope does not touch repo-scoped rows ──────────────

    it('system-scope does not touch repo-scoped raw rows', async () => {
        const wsId = 'ws-isolation';

        // Seed repo-level raw records
        seedRawRecords(wsId, ['Repo-scoped fact']);

        // Seed system-level raw store (empty)
        const systemDir = path.join(tmpDir, 'memory', 'system');
        fs.mkdirSync(systemDir, { recursive: true });
        const systemRaw = new RawMemoryRecordStore({
            dbPath: path.join(systemDir, 'raw-memory.db'),
        });
        systemRaw.close();

        const executor = new MemoryAggregateExecutor(mockAiService, tmpDir);
        const result = await executor.execute(
            makeTask(makePayload({ workspaceId: wsId, target: 'system' })),
        );

        // System has no pending records
        expect(result.success).toBe(true);
        expect(result.result).toBe('No pending records');
        expect(mockAiService.sendMessage).not.toHaveBeenCalled();

        // Repo-scoped records are untouched
        const repoRaw = new RawMemoryRecordStore({
            dbPath: path.join(tmpDir, 'repos', wsId, 'memory', 'raw-memory.db'),
        });
        const pending = await repoRaw.listPending();
        expect(pending).toHaveLength(1);
        expect(pending[0].content).toBe('Repo-scoped fact');
        repoRaw.close();
    });
});
