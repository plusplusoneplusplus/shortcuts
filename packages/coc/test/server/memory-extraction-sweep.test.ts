/**
 * Tests for MemoryExtractionSweep
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AIInvoker, ConversationTurn } from '@plusplusoneplusplus/forge';
import { FileMemoryStore as ObservationStore } from '@plusplusoneplusplus/forge';
import { writeMemoryConfig, DEFAULT_MEMORY_CONFIG } from '../../src/server/memory/memory-config-handler';
import { writeRepoPreferences } from '../../src/server/preferences-handler';
import { MemoryExtractionSweep } from '../../src/server/memory/memory-extraction-sweep';
import { createMockProcessStore } from './helpers/mock-process-store';

// ============================================================================
// Helpers
// ============================================================================

const WORKSPACE_ID = 'test-ws-abc';

function makeTurn(role: 'user' | 'assistant', content: string, index: number): ConversationTurn {
    return { role, content, timestamp: new Date(), turnIndex: index, timeline: [] };
}

function createMockAIInvoker(response: string): AIInvoker {
    return vi.fn().mockResolvedValue({ success: true, response });
}

function completedProcess(id: string, turns: ConversationTurn[], endTime?: Date) {
    return {
        id,
        type: 'prompt' as const,
        status: 'completed' as const,
        promptPreview: 'test',
        fullPrompt: 'test',
        startTime: new Date('2025-01-01'),
        endTime: endTime ?? new Date('2025-01-01'),
        conversationTurns: turns,
        metadata: { type: 'prompt', workspaceId: WORKSPACE_ID },
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('MemoryExtractionSweep', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-test-'));
        writeMemoryConfig(tmpDir, { ...DEFAULT_MEMORY_CONFIG, storageDir: path.join(tmpDir, 'memory') });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function enableMemory() {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { memoryExtraction: { enabled: true } });
    }

    it('extracts facts from completed idle processes', async () => {
        enableMemory();
        const turns = [
            makeTurn('user', 'How do I deploy?', 0),
            makeTurn('assistant', 'Run npm run deploy', 1),
        ];
        const processStore = createMockProcessStore({
            initialProcesses: [completedProcess('proc-1', turns)],
            initialWorkspaces: [{ id: WORKSPACE_ID, name: 'my-repo', rootPath: '/repo' }],
        });

        const aiInvoker = createMockAIInvoker(JSON.stringify([
            { fact: 'Deploy with npm run deploy', category: 'tools' },
        ]));

        const sweep = new MemoryExtractionSweep({
            store: processStore,
            dataDir: tmpDir,
            aiInvoker,
            config: { idleThresholdMs: 0, sweepIntervalMs: 999999 },
        });

        const extracted = await sweep.sweep();
        expect(extracted).toBe(1);
        expect(aiInvoker).toHaveBeenCalled();

        // Verify observation was written
        const repoDir = path.join(tmpDir, 'repos', WORKSPACE_ID, 'memory', 'observations');
        const obsStore = new ObservationStore({ dataDir: path.join(tmpDir, 'memory'), repoDir });
        const files = await obsStore.listRaw('repo', undefined);
        expect(files).toHaveLength(1);
    });

    it('skips repos with memory extraction disabled', async () => {
        // Don't call enableMemory() — default is disabled
        const turns = [
            makeTurn('user', 'Hello', 0),
            makeTurn('assistant', 'Hi', 1),
        ];
        const processStore = createMockProcessStore({
            initialProcesses: [completedProcess('proc-1', turns)],
            initialWorkspaces: [{ id: WORKSPACE_ID, name: 'my-repo', rootPath: '/repo' }],
        });

        const aiInvoker = createMockAIInvoker('[]');
        const sweep = new MemoryExtractionSweep({
            store: processStore,
            dataDir: tmpDir,
            aiInvoker,
            config: { idleThresholdMs: 0, sweepIntervalMs: 999999 },
        });

        const extracted = await sweep.sweep();
        expect(extracted).toBe(0);
        expect(aiInvoker).not.toHaveBeenCalled();
    });

    it('skips processes that are not idle enough', async () => {
        enableMemory();
        const turns = [
            makeTurn('user', 'Hello', 0),
            makeTurn('assistant', 'Hi', 1),
        ];
        // Process started and ended just now — not idle enough
        const recentProcess = {
            ...completedProcess('proc-1', turns, new Date()),
            startTime: new Date(), // also recent start time (fallback when lastEventAt absent)
        };
        const processStore = createMockProcessStore({
            initialProcesses: [recentProcess],
            initialWorkspaces: [{ id: WORKSPACE_ID, name: 'my-repo', rootPath: '/repo' }],
        });

        const aiInvoker = createMockAIInvoker('[]');
        const sweep = new MemoryExtractionSweep({
            store: processStore,
            dataDir: tmpDir,
            aiInvoker,
            config: { idleThresholdMs: 60_000, sweepIntervalMs: 999999 },
        });

        const extracted = await sweep.sweep();
        expect(extracted).toBe(0);
        expect(aiInvoker).not.toHaveBeenCalled();
    });

    it('skips already-extracted processes', async () => {
        enableMemory();
        const turns = [
            makeTurn('user', 'Hello', 0),
            makeTurn('assistant', 'Hi', 1),
        ];
        const processStore = createMockProcessStore({
            initialProcesses: [completedProcess('proc-1', turns)],
            initialWorkspaces: [{ id: WORKSPACE_ID, name: 'my-repo', rootPath: '/repo' }],
        });

        const aiInvoker = createMockAIInvoker(JSON.stringify([
            { fact: 'Test fact', category: 'tools' },
        ]));

        const sweep = new MemoryExtractionSweep({
            store: processStore,
            dataDir: tmpDir,
            aiInvoker,
            config: { idleThresholdMs: 0, sweepIntervalMs: 999999 },
        });

        // First sweep
        const first = await sweep.sweep();
        expect(first).toBe(1);

        // Second sweep — should skip already extracted
        const second = await sweep.sweep();
        expect(second).toBe(0);
    });

    it('respects batch size limit', async () => {
        enableMemory();
        const processes = Array.from({ length: 5 }, (_, i) =>
            completedProcess(`proc-${i}`, [
                makeTurn('user', `Question ${i}`, 0),
                makeTurn('assistant', `Answer ${i}`, 1),
            ]),
        );

        const processStore = createMockProcessStore({
            initialProcesses: processes,
            initialWorkspaces: [{ id: WORKSPACE_ID, name: 'my-repo', rootPath: '/repo' }],
        });

        const aiInvoker = createMockAIInvoker(JSON.stringify([
            { fact: 'A fact', category: 'tools' },
        ]));

        const sweep = new MemoryExtractionSweep({
            store: processStore,
            dataDir: tmpDir,
            aiInvoker,
            config: { idleThresholdMs: 0, sweepIntervalMs: 999999, batchSize: 2 },
        });

        const extracted = await sweep.sweep();
        expect(extracted).toBe(2);
    });

    it('triggers consolidation when threshold is exceeded', async () => {
        enableMemory();

        // Pre-populate with raw observations above threshold
        const config = { ...DEFAULT_MEMORY_CONFIG, storageDir: path.join(tmpDir, 'memory') };
        const repoDir = path.join(tmpDir, 'repos', WORKSPACE_ID, 'memory', 'observations');
        const obsStore = new ObservationStore({ dataDir: config.storageDir, repoDir });
        for (let i = 0; i < 5; i++) {
            await obsStore.writeRaw('repo', undefined, {
                pipeline: 'prefill',
                timestamp: new Date().toISOString(),
            }, `Existing fact ${i}`);
        }

        const turns = [
            makeTurn('user', 'Question', 0),
            makeTurn('assistant', 'Answer', 1),
        ];
        const processStore = createMockProcessStore({
            initialProcesses: [completedProcess('proc-1', turns)],
            initialWorkspaces: [{ id: WORKSPACE_ID, name: 'my-repo', rootPath: '/repo' }],
        });

        const aiInvoker = createMockAIInvoker(JSON.stringify([
            { fact: 'New fact', category: 'tools' },
        ]));

        const mockEnqueue = vi.fn().mockReturnValue('task-123');
        const queueFacade = { enqueue: mockEnqueue } as any;

        const sweep = new MemoryExtractionSweep({
            store: processStore,
            dataDir: tmpDir,
            aiInvoker,
            queueFacade,
            config: {
                idleThresholdMs: 0,
                sweepIntervalMs: 999999,
                consolidationThreshold: 5, // 5 existing + 1 new = 6 ≥ threshold
            },
        });

        await sweep.sweep();
        expect(mockEnqueue).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'memory-aggregate',
                repoId: WORKSPACE_ID,
            }),
        );
    });

    it('does not consolidate when below threshold', async () => {
        enableMemory();
        const turns = [
            makeTurn('user', 'Question', 0),
            makeTurn('assistant', 'Answer', 1),
        ];
        const processStore = createMockProcessStore({
            initialProcesses: [completedProcess('proc-1', turns)],
            initialWorkspaces: [{ id: WORKSPACE_ID, name: 'my-repo', rootPath: '/repo' }],
        });

        const aiInvoker = createMockAIInvoker(JSON.stringify([
            { fact: 'A fact', category: 'tools' },
        ]));

        const mockEnqueue = vi.fn().mockReturnValue('task-123');
        const queueFacade = { enqueue: mockEnqueue } as any;

        const sweep = new MemoryExtractionSweep({
            store: processStore,
            dataDir: tmpDir,
            aiInvoker,
            queueFacade,
            config: {
                idleThresholdMs: 0,
                sweepIntervalMs: 999999,
                consolidationThreshold: 20,
            },
        });

        await sweep.sweep();
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('start/stop/dispose lifecycle works', () => {
        const processStore = createMockProcessStore();
        const aiInvoker = createMockAIInvoker('[]');

        const sweep = new MemoryExtractionSweep({
            store: processStore,
            dataDir: tmpDir,
            aiInvoker,
            config: { sweepIntervalMs: 100 },
        });

        sweep.start();
        // Start again is idempotent
        sweep.start();
        sweep.stop();
        // Stop again is idempotent
        sweep.stop();

        // Dispose also stops
        sweep.start();
        sweep.dispose();
    });

    it('does not start when config.enabled is false', () => {
        const processStore = createMockProcessStore();
        const aiInvoker = createMockAIInvoker('[]');

        const sweep = new MemoryExtractionSweep({
            store: processStore,
            dataDir: tmpDir,
            aiInvoker,
            config: { enabled: false, sweepIntervalMs: 100 },
        });

        sweep.start();
        // No timer should be running (dispose is safe)
        sweep.dispose();
    });

    it('handles AI failure gracefully during sweep', async () => {
        enableMemory();
        const turns = [
            makeTurn('user', 'Hello', 0),
            makeTurn('assistant', 'Hi', 1),
        ];
        const processStore = createMockProcessStore({
            initialProcesses: [completedProcess('proc-1', turns)],
            initialWorkspaces: [{ id: WORKSPACE_ID, name: 'my-repo', rootPath: '/repo' }],
        });

        const aiInvoker = vi.fn().mockResolvedValue({
            success: false,
            error: 'Model unavailable',
        }) as unknown as AIInvoker;

        const sweep = new MemoryExtractionSweep({
            store: processStore,
            dataDir: tmpDir,
            aiInvoker,
            config: { idleThresholdMs: 0, sweepIntervalMs: 999999 },
        });

        const extracted = await sweep.sweep();
        // AI failed, so no successful extraction
        expect(extracted).toBe(0);
    });
});
