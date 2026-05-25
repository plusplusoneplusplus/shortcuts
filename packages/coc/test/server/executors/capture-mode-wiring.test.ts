/**
 * Tests that verify MemoryPromoteExecutor finalization behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ============================================================================
// Test: MemoryPromoteExecutor finalization
// ============================================================================

describe('MemoryPromoteExecutor — non-destructive candidate finalization', () => {
    let tmpDir: string;
    let mockAiService: any;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-promote-drop-'));
        mockAiService = {
            sendMessage: vi.fn(),
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function seedRawRecords(workspaceId: string, records: string[]) {
        const { MemoryCandidateStore } = require('@plusplusoneplusplus/forge');
        const memDir = path.join(tmpDir, 'repos', workspaceId, 'memory');
        fs.mkdirSync(memDir, { recursive: true });
        const candidateStore = new MemoryCandidateStore({ dbPath: path.join(memDir, 'raw-memory.db') });
        for (const content of records) {
            // Use low score and no explicit intent so candidates stay pending (not auto-promoted)
            void candidateStore.upsertCandidate({
                target: 'repo',
                content,
                source: 'test',
                workspaceId,
                score: 0,
                explicitMemoryIntent: false,
            });
        }
        candidateStore.close();
    }

    function seedBoundedMemory(workspaceId: string, entries: string[]) {
        const { ENTRY_DELIMITER } = require('@plusplusoneplusplus/forge');
        const memDir = path.join(tmpDir, 'repos', workspaceId, 'memory');
        fs.mkdirSync(memDir, { recursive: true });
        if (entries.length > 0) {
            fs.writeFileSync(path.join(memDir, 'MEMORY.md'), entries.join(ENTRY_DELIMITER), 'utf-8');
        }
    }

    async function getCandidateStats(workspaceId: string): Promise<any> {
        const { MemoryCandidateStore } = require('@plusplusoneplusplus/forge');
        const dbPath = path.join(tmpDir, 'repos', workspaceId, 'memory', 'raw-memory.db');
        const candidateStore = new MemoryCandidateStore({ dbPath });
        const stats = await candidateStore.getStats();
        candidateStore.close();
        return stats;
    }

    it('retains candidates without invoking AI', async () => {
        const { MemoryPromoteExecutor } = await import('../../../src/server/memory/memory-promote-executor');
        const wsId = 'ws-drop-only';

        seedRawRecords(wsId, ['Duplicate existing fact']);
        seedBoundedMemory(wsId, ['Duplicate existing fact']);

        const executor = new MemoryPromoteExecutor(mockAiService, tmpDir);
        const result = await executor.execute({
            id: 'task-drop-1',
            type: 'memory-promote',
            priority: 'low',
            status: 'running',
            createdAt: Date.now(),
            retryCount: 0,
            payload: { kind: 'memory-promote', workspaceId: wsId, target: 'memory' },
            config: {},
        } as any);

        expect(result.success).toBe(true);
        expect(mockAiService.sendMessage).not.toHaveBeenCalled();
        await expect(getCandidateStats(wsId)).resolves.toMatchObject({ pending: 1, dropped: 0 });
    });

    it('surfaces unexpected candidate store errors without losing migrated candidates', async () => {
        const { MemoryPromoteExecutor } = await import('../../../src/server/memory/memory-promote-executor');
        const { MemoryCandidateStore } = await import('@plusplusoneplusplus/forge');
        const wsId = 'ws-catch-release';

        seedRawRecords(wsId, ['A fact']);
        seedBoundedMemory(wsId, []);

        const listPendingSpy = vi
            .spyOn(MemoryCandidateStore.prototype, 'listPendingCandidates')
            .mockRejectedValueOnce(new Error('Unexpected candidate read failure'));

        const executor = new MemoryPromoteExecutor(mockAiService, tmpDir);
        const result = await executor.execute({
            id: 'task-catch-1',
            type: 'memory-promote',
            priority: 'low',
            status: 'running',
            createdAt: Date.now(),
            retryCount: 0,
            payload: { kind: 'memory-promote', workspaceId: wsId, target: 'memory' },
            config: {},
        } as any);

        expect(result.success).toBe(false);
        expect(listPendingSpy).toHaveBeenCalledTimes(1);

        listPendingSpy.mockRestore();

        // Candidate is still pending — the failure was non-destructive.
        const memDir = path.join(tmpDir, 'repos', wsId, 'memory');
        const candidateStore = new MemoryCandidateStore({
            dbPath: path.join(memDir, 'raw-memory.db'),
        });
        const pending = await candidateStore.listPendingCandidates();
        expect(pending).toHaveLength(1);
        expect(pending[0].content).toBe('A fact');
        candidateStore.close();
    });
});
