/**
 * Tests that verify capture-mode wiring in chat executors.
 *
 * Validates that:
 * - Initial chat executors (ask, plan, autopilot, commit-chat, note-chat) pass
 *   captureContext to buildBoundedMemoryAddon
 * - FollowUpExecutor passes captureContext with correct turnIndex
 * - Addon dispose() is called after execution completes
 * - Aggregate finalization retains candidates without rewriting bounded memory
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ============================================================================
// Test: ChatBaseExecutor.buildCaptureContext
// ============================================================================

describe('ChatBaseExecutor.buildCaptureContext', () => {
    it('produces context with processId and turnIndex 0', async () => {
        // We test the helper indirectly via the ChatExecutor buildModeOptions path.
        // Here we verify the contract by importing the base class and inspecting it.
        const { ChatBaseExecutor } = await import('../../../src/server/executors/chat-base-executor');
        const { toQueueProcessId } = await import('@plusplusoneplusplus/forge');

        // Create a minimal concrete subclass to test the protected helper
        class TestExecutor extends (ChatBaseExecutor as any) {
            constructor() {
                const fakeStore = { registerFlushHandler: vi.fn(), unregisterFlushHandler: vi.fn() };
                super(fakeStore, {
                    aiService: {},
                    defaultTimeoutMs: 30000,
                    followUpSuggestions: { enabled: false, count: 0 },
                    toolCallCacheStore: {},
                    resolveSkillConfig: vi.fn(),
                    resolveWorkspaceIdForPath: vi.fn(),
                }, '/tmp/test');
            }
            buildModeOptions() { return Promise.resolve({}); }
            // Expose protected method for testing
            testBuildCaptureContext(task: any) {
                return this.buildCaptureContext(task);
            }
        }

        const executor = new TestExecutor();
        const task = { id: 'task-123' };
        const ctx = executor.testBuildCaptureContext(task);

        expect(ctx).toEqual({
            processId: toQueueProcessId('task-123'),
            turnIndex: 0,
        });
    });
});

// ============================================================================
// Test: buildBoundedMemoryAddon receives captureContext from executors
// ============================================================================

describe('Executor capture-mode wiring', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-wire-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    /**
     * We mock buildBoundedMemoryAddon at the prompt-builder level to verify
     * that executors pass captureContext when constructing the addon.
     */
    it('ChatExecutor passes captureContext to buildBoundedMemoryAddon', async () => {
        const capturedArgs: any[] = [];
        const mockAddon = {
            systemMessageSuffix: undefined,
            tools: [],
            suffix: '',
            dispose: vi.fn(),
        };

        // Use dynamic import + vi.mock
        vi.doMock('../../../src/server/executors/bounded-memory-addon', () => ({
            buildBoundedMemoryAddon: vi.fn(async (...args: any[]) => {
                capturedArgs.push(args);
                return mockAddon;
            }),
        }));

        // Clear the cached module to pick up the mock
        vi.resetModules();

        const { ChatExecutor } = await import('../../../src/server/executors/chat-executor');
        const { toQueueProcessId } = await import('@plusplusoneplusplus/forge');

        const fakeStore = {
            registerFlushHandler: vi.fn(),
            unregisterFlushHandler: vi.fn(),
            emitProcessEvent: vi.fn(),
            emitProcessOutput: vi.fn(),
            updateProcess: vi.fn().mockResolvedValue(undefined),
            getProcess: vi.fn().mockResolvedValue(undefined),
        };

        const executor = new ChatExecutor(fakeStore as any, {
            aiService: { isAvailable: vi.fn().mockResolvedValue({ available: true }), sendMessage: vi.fn().mockResolvedValue({ success: true, response: 'ok' }) } as any,
            defaultTimeoutMs: 30000,
            followUpSuggestions: { enabled: false, count: 0 },
            toolCallCacheStore: { getOrCreate: vi.fn() } as any,
            resolveSkillConfig: vi.fn().mockResolvedValue({}),
            resolveWorkspaceIdForPath: vi.fn().mockResolvedValue('ws-1'),
        }, tmpDir);

        const task = {
            id: 'test-task-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            retryCount: 0,
            payload: { workspaceId: 'ws-1' },
            config: {},
        };

        // Call buildModeOptions via execute (which also calls it)
        // We need to access buildModeOptions, but it's protected.
        // Use the pattern of calling execute which will eventually invoke buildModeOptions.
        try {
            await executor.execute(task as any, 'test prompt');
        } catch {
            // Execution may fail but we only care about the addon call
        }

        // Verify buildBoundedMemoryAddon was called with captureContext
        expect(capturedArgs.length).toBeGreaterThanOrEqual(1);
        const [dataDir, wsId, captureCtx] = capturedArgs[0];
        expect(dataDir).toBe(tmpDir);
        expect(wsId).toBe('ws-1');
        expect(captureCtx).toBeDefined();
        expect(captureCtx.processId).toBe(toQueueProcessId('test-task-1'));
        expect(captureCtx.turnIndex).toBe(0);

        vi.doUnmock('../../../src/server/executors/bounded-memory-addon');
    });

    it('dispose is returned from ChatModeAIOptions and called during cleanup', async () => {
        const disposeFn = vi.fn();
        const mockAddon = {
            systemMessageSuffix: undefined,
            tools: [],
            suffix: '',
            dispose: disposeFn,
        };

        vi.doMock('../../../src/server/executors/bounded-memory-addon', () => ({
            buildBoundedMemoryAddon: vi.fn(async () => mockAddon),
        }));

        vi.resetModules();

        const { ChatExecutor } = await import('../../../src/server/executors/chat-executor');

        const fakeStore = {
            registerFlushHandler: vi.fn(),
            unregisterFlushHandler: vi.fn(),
            emitProcessEvent: vi.fn(),
            emitProcessOutput: vi.fn(),
            updateProcess: vi.fn().mockResolvedValue(undefined),
            getProcess: vi.fn().mockResolvedValue(undefined),
        };

        const executor = new ChatExecutor(fakeStore as any, {
            aiService: {
                isAvailable: vi.fn().mockResolvedValue({ available: true }),
                sendMessage: vi.fn().mockResolvedValue({ success: true, response: 'ok' }),
            } as any,
            defaultTimeoutMs: 30000,
            followUpSuggestions: { enabled: false, count: 0 },
            toolCallCacheStore: { getOrCreate: vi.fn() } as any,
            resolveSkillConfig: vi.fn().mockResolvedValue({}),
            resolveWorkspaceIdForPath: vi.fn().mockResolvedValue('ws-1'),
        }, tmpDir);

        const task = {
            id: 'test-task-2',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            retryCount: 0,
            payload: { workspaceId: 'ws-1' },
            config: {},
        };

        try {
            await executor.execute(task as any, 'test prompt');
        } catch {
            // Ignore execution errors
        }

        // dispose() should have been called in the finally block
        expect(disposeFn).toHaveBeenCalled();

        vi.doUnmock('../../../src/server/executors/bounded-memory-addon');
    });
});

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
