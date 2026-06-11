/**
 * BaseExecutor Unit Tests
 *
 * Verifies the streaming lifecycle, throttled flushing, tool event handling,
 * output persistence, and cancellation token management provided by BaseExecutor.
 *
 * Uses a concrete TestExecutor subclass to exercise the protected methods.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProcessStore, AIProcess } from '@plusplusoneplusplus/forge';
import { BaseExecutor, type ProcessSessionState } from '../../../src/server/executors/base-executor';
import { createMockProcessStore } from '../helpers/mock-process-store';

// ============================================================================
// Concrete test subclass
// ============================================================================

/** Minimal concrete executor that exposes all protected members for testing. */
class TestExecutor extends BaseExecutor {
    // Expose protected members for white-box testing
    public getOrCreateSessionPublic(processId: string): ProcessSessionState {
        return this.getOrCreateSession(processId);
    }
    public cleanupSessionPublic(processId: string): void {
        return this.cleanupSession(processId);
    }
    public appendTimelineItemPublic(processId: string, item: any): void {
        return this.appendTimelineItem(processId, item);
    }
    public checkThrottleAndFlushPublic(processId: string): void {
        return this.checkThrottleAndFlush(processId);
    }
    public async flushConversationTurnPublic(processId: string, streaming: boolean): Promise<void> {
        return this.flushConversationTurn(processId, streaming);
    }
    public async persistOutputPublic(processId: string, content: string, workspaceId?: string): Promise<void> {
        return this.persistOutput(processId, content, workspaceId);
    }
    public buildToolEventHandlerPublic(processId: string, computeTurnIndex: () => number) {
        return this.buildToolEventHandler(processId, computeTurnIndex);
    }
    public get cancelledTasksPublic(): Set<string> {
        return this.cancelledTasks;
    }
    public static get THROTTLE_TIME_MS_PUBLIC(): number {
        return BaseExecutor.THROTTLE_TIME_MS;
    }
    public static get THROTTLE_CHUNK_COUNT_PUBLIC(): number {
        return BaseExecutor.THROTTLE_CHUNK_COUNT;
    }
    public buildBackgroundTaskHandlerPublic(processId: string) {
        return this.buildBackgroundTaskHandler(processId);
    }
}

// ============================================================================
// Test helpers
// ============================================================================

function createTestProcess(id: string, turns: any[] = []): AIProcess {
    return {
        id,
        type: 'clarification',
        promptPreview: 'test',
        fullPrompt: 'test',
        status: 'running',
        startTime: new Date(),
        conversationTurns: turns,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('BaseExecutor', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let executor: TestExecutor;

    beforeEach(() => {
        store = createMockProcessStore();
        executor = new TestExecutor(store);
    });

    // ========================================================================
    // Session lifecycle
    // ========================================================================

    describe('session lifecycle', () => {
        it('creates a fresh session with empty state on first access', () => {
            const session = executor.getOrCreateSessionPublic('proc-1');
            expect(session.outputBuffer).toBe('');
            expect(session.timelineBuffer).toEqual([]);
            expect(session.pendingSuggestions).toBeUndefined();
            expect(session.throttleState.chunksSinceLastFlush).toBe(0);
        });

        it('returns the same session object on subsequent calls', () => {
            const a = executor.getOrCreateSessionPublic('proc-1');
            const b = executor.getOrCreateSessionPublic('proc-1');
            expect(a).toBe(b);
        });

        it('creates independent sessions for different process IDs', () => {
            const a = executor.getOrCreateSessionPublic('proc-a');
            const b = executor.getOrCreateSessionPublic('proc-b');
            a.outputBuffer = 'hello';
            expect(b.outputBuffer).toBe('');
        });

        it('cleanupSession removes the session', () => {
            executor.getOrCreateSessionPublic('proc-del');
            executor.cleanupSessionPublic('proc-del');
            // After cleanup a new fresh session is created
            const fresh = executor.getOrCreateSessionPublic('proc-del');
            expect(fresh.outputBuffer).toBe('');
        });

        it('cleanupSession on unknown ID is a no-op', () => {
            expect(() => executor.cleanupSessionPublic('does-not-exist')).not.toThrow();
        });

        it('cleanupSession retains Ralph grill state with fresh turn lifecycle fields', async () => {
            const session = executor.getOrCreateSessionPublic('proc-ralph-grill');
            const ralphGrill: NonNullable<ProcessSessionState['ralphGrill']> = {
                roundsRun: 1,
                maxRounds: 3,
                terminal: false,
                agents: {},
                askedQuestions: ['Which scope?'],
                warnings: [],
            };
            session.outputBuffer = 'stale output';
            session.timelineBuffer = [{ type: 'content', content: 'stale output', timestamp: new Date() }];
            session.turnFinalized = true;
            session.turnWriteChain = Promise.reject(new Error('stale chain'));
            session.turnWriteChain.catch(() => undefined);
            session.ralphGrill = ralphGrill;

            executor.cleanupSessionPublic('proc-ralph-grill');

            const retained = executor.getOrCreateSessionPublic('proc-ralph-grill');
            expect(retained).not.toBe(session);
            expect(retained.outputBuffer).toBe('');
            expect(retained.timelineBuffer).toEqual([]);
            expect(retained.turnFinalized).toBe(false);
            expect(retained.ralphGrill).toBe(ralphGrill);
            await expect(retained.turnWriteChain).resolves.toBeUndefined();
        });
    });

    // ========================================================================
    // Timeline buffering
    // ========================================================================

    describe('appendTimelineItem', () => {
        it('appends a non-content item to the buffer', () => {
            executor.appendTimelineItemPublic('proc-1', { type: 'tool-start', timestamp: new Date(), toolCall: { id: 't1', name: 'read_file', status: 'running', startTime: new Date(), args: {} } });
            const session = executor.getOrCreateSessionPublic('proc-1');
            expect(session.timelineBuffer).toHaveLength(1);
            expect(session.timelineBuffer[0].type).toBe('tool-start');
        });

        it('merges consecutive content items', () => {
            executor.appendTimelineItemPublic('proc-1', { type: 'content', timestamp: new Date(), content: 'Hello ' });
            executor.appendTimelineItemPublic('proc-1', { type: 'content', timestamp: new Date(), content: 'World' });
            const session = executor.getOrCreateSessionPublic('proc-1');
            expect(session.timelineBuffer).toHaveLength(1);
            expect(session.timelineBuffer[0].content).toBe('Hello World');
        });

        it('does not merge content items separated by a tool event', () => {
            executor.appendTimelineItemPublic('proc-1', { type: 'content', timestamp: new Date(), content: 'A' });
            executor.appendTimelineItemPublic('proc-1', { type: 'tool-start', timestamp: new Date(), toolCall: { id: 't1', name: 'tool', status: 'running', startTime: new Date(), args: {} } });
            executor.appendTimelineItemPublic('proc-1', { type: 'content', timestamp: new Date(), content: 'B' });
            const session = executor.getOrCreateSessionPublic('proc-1');
            expect(session.timelineBuffer).toHaveLength(3);
        });
    });

    // ========================================================================
    // Throttled flushing
    // ========================================================================

    describe('checkThrottleAndFlush', () => {
        it('increments chunksSinceLastFlush on each call', () => {
            // Initialize lastFlushTime to now so time-based flush doesn't fire
            const session = executor.getOrCreateSessionPublic('proc-t');
            session.throttleState.lastFlushTime = Date.now();
            executor.checkThrottleAndFlushPublic('proc-t');
            executor.checkThrottleAndFlushPublic('proc-t');
            // No flush yet (below threshold)
            expect(session.throttleState.chunksSinceLastFlush).toBe(2);
        });

        it('resets counter and triggers flush after THROTTLE_CHUNK_COUNT chunks', async () => {
            const processId = 'proc-throttle';
            const proc = createTestProcess(processId);
            await store.addProcess(proc);
            const session = executor.getOrCreateSessionPublic(processId);
            session.outputBuffer = 'data';
            // Prevent time-based flush from firing during count-based test
            session.throttleState.lastFlushTime = Date.now();

            const count = TestExecutor.THROTTLE_CHUNK_COUNT_PUBLIC;
            // Send count - 1 chunks (no flush yet)
            for (let i = 0; i < count - 1; i++) {
                executor.checkThrottleAndFlushPublic(processId);
            }
            const beforeFlush = executor.getOrCreateSessionPublic(processId).throttleState.chunksSinceLastFlush;
            expect(beforeFlush).toBe(count - 1);

            // One more chunk triggers flush
            executor.checkThrottleAndFlushPublic(processId);
            const afterFlush = executor.getOrCreateSessionPublic(processId).throttleState.chunksSinceLastFlush;
            expect(afterFlush).toBe(0);
        });

        it('resets counter and triggers flush when time threshold is exceeded', () => {
            const processId = 'proc-time';
            const session = executor.getOrCreateSessionPublic(processId);
            // Set lastFlushTime far in the past
            session.throttleState.lastFlushTime = Date.now() - TestExecutor.THROTTLE_TIME_MS_PUBLIC - 1000;
            session.throttleState.chunksSinceLastFlush = 1;

            executor.checkThrottleAndFlushPublic(processId);

            expect(session.throttleState.chunksSinceLastFlush).toBe(0);
        });
    });

    // ========================================================================
    // flushConversationTurn
    // ========================================================================

    describe('flushConversationTurn', () => {
        it('does nothing when session has no buffer and no timeline', async () => {
            // No session created — flush should be a no-op
            await executor.flushConversationTurnPublic('proc-empty', true);
            expect(store.updateProcess).not.toHaveBeenCalled();
        });

        it('appends a streaming assistant turn to existing turns', async () => {
            const processId = 'proc-flush-1';
            const proc = createTestProcess(processId, [
                { role: 'user', content: 'hi', timestamp: new Date(), turnIndex: 0, timeline: [] },
            ]);
            await store.addProcess(proc);

            const session = executor.getOrCreateSessionPublic(processId);
            session.outputBuffer = 'partial response';

            await executor.flushConversationTurnPublic(processId, true);

            const updated = store.processes.get(processId);
            expect(updated?.conversationTurns).toHaveLength(2);
            const last = updated!.conversationTurns![1];
            expect(last.role).toBe('assistant');
            expect(last.content).toBe('partial response');
            expect(last.streaming).toBe(true);
        });

        it('updates existing streaming turn in-place rather than appending', async () => {
            const processId = 'proc-flush-2';
            const proc = createTestProcess(processId, [
                { role: 'user', content: 'hi', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'partial', timestamp: new Date(), turnIndex: 1, timeline: [], streaming: true },
            ]);
            await store.addProcess(proc);

            const session = executor.getOrCreateSessionPublic(processId);
            session.outputBuffer = 'updated partial';

            await executor.flushConversationTurnPublic(processId, true);

            const updated = store.processes.get(processId);
            expect(updated?.conversationTurns).toHaveLength(2);
            expect(updated!.conversationTurns![1].content).toBe('updated partial');
        });

        it('finds streaming assistant turn even when user message was appended after it (race regression)', async () => {
            const processId = 'proc-flush-race';
            // Simulate: AI streaming at index 3, then user sends follow-up at index 4
            const proc = createTestProcess(processId, [
                { role: 'user', content: 'q1', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'a1', timestamp: new Date(), turnIndex: 1, timeline: [] },
                { role: 'user', content: 'q2', timestamp: new Date(), turnIndex: 2, timeline: [] },
                { role: 'assistant', content: 'partial...', timestamp: new Date(), turnIndex: 3, timeline: [], streaming: true },
                { role: 'user', content: 'q3', timestamp: new Date(), turnIndex: 4, timeline: [] },
            ]);
            await store.addProcess(proc);

            const session = executor.getOrCreateSessionPublic(processId);
            session.outputBuffer = 'updated streaming content';

            await executor.flushConversationTurnPublic(processId, true);

            const updated = store.processes.get(processId);
            // Must still be 5 turns — no duplicate appended
            expect(updated?.conversationTurns).toHaveLength(5);
            // The streaming turn at index 3 should be updated in-place
            expect(updated!.conversationTurns![3].content).toBe('updated streaming content');
            expect(updated!.conversationTurns![3].streaming).toBe(true);
            // User turn at index 4 is untouched
            expect(updated!.conversationTurns![4].content).toBe('q3');
            expect(updated!.conversationTurns![4].role).toBe('user');
        });

        it('is a no-op when process does not exist in store', async () => {
            const session = executor.getOrCreateSessionPublic('proc-missing');
            session.outputBuffer = 'data';

            await executor.flushConversationTurnPublic('proc-missing', true);
            expect(store.updateProcess).not.toHaveBeenCalled();
        });
    });

    // ========================================================================
    // persistOutput
    // ========================================================================

    describe('persistOutput', () => {
        it('is a no-op when dataDir is not set', async () => {
            const executorNoDir = new TestExecutor(store); // dataDir = undefined
            await executorNoDir.persistOutputPublic('proc-1', 'some content');
            expect(store.updateProcess).not.toHaveBeenCalled();
        });

        it('is a no-op when content is empty', async () => {
            const executorWithDir = new TestExecutor(store, '/tmp/test-data');
            await executorWithDir.persistOutputPublic('proc-1', '');
            expect(store.updateProcess).not.toHaveBeenCalled();
        });
    });

    // ========================================================================
    // Tool event handling
    // ========================================================================

    describe('buildToolEventHandler', () => {
        it('appends tool-start event to timeline buffer', () => {
            const handler = executor.buildToolEventHandlerPublic('proc-tool', () => 0);
            handler({
                type: 'tool-start',
                toolCallId: 'tc1',
                toolName: 'read_file',
                parameters: { path: '/foo' },
            } as any);

            const session = executor.getOrCreateSessionPublic('proc-tool');
            expect(session.timelineBuffer).toHaveLength(1);
            expect(session.timelineBuffer[0].type).toBe('tool-start');
        });

        it('appends tool-complete event to timeline buffer', () => {
            const handler = executor.buildToolEventHandlerPublic('proc-tool-c', () => 0);
            handler({
                type: 'tool-complete',
                toolCallId: 'tc2',
                toolName: 'write_file',
                parameters: {},
                result: 'ok',
            } as any);

            const session = executor.getOrCreateSessionPublic('proc-tool-c');
            expect(session.timelineBuffer[0].type).toBe('tool-complete');
        });

        it('treats capture-mode memory completion as a normal timeline event only', () => {
            const handler = executor.buildToolEventHandlerPublic('proc-memory-capture', () => 0);
            handler({
                type: 'tool-complete',
                toolCallId: 'tc-memory',
                toolName: 'memory',
                parameters: { action: 'add', target: 'repo', content: 'Useful fact' },
                result: JSON.stringify({
                    success: true,
                    message: 'Memory candidate captured; memory will update after aggregation.',
                    recordId: 'rec-abc-123',
                }),
            } as any);

            const session = executor.getOrCreateSessionPublic('proc-memory-capture');
            expect(session.timelineBuffer).toHaveLength(1);
            expect(session.timelineBuffer[0]).toEqual(expect.objectContaining({
                type: 'tool-complete',
                toolCall: expect.objectContaining({
                    name: 'memory',
                    status: 'completed',
                    result: expect.stringContaining('rec-abc-123'),
                }),
            }));
            expect(store.emitProcessEvent).toHaveBeenCalledTimes(1);
            expect(store.emitProcessEvent).toHaveBeenCalledWith('proc-memory-capture', expect.objectContaining({
                type: 'tool-complete',
                toolName: 'memory',
                result: expect.stringContaining('rec-abc-123'),
            }));
        });

        it('emits process event via store for tool-start', () => {
            const handler = executor.buildToolEventHandlerPublic('proc-emit', () => 0);
            handler({
                type: 'tool-start',
                toolCallId: 'tc3',
                toolName: 'some_tool',
                parameters: {},
            } as any);

            expect(store.emitProcessEvent).toHaveBeenCalledWith('proc-emit', expect.objectContaining({
                type: 'tool-start',
                toolName: 'some_tool',
            }));
        });

        it('captures suggest_follow_ups result as pendingSuggestions', () => {
            const handler = executor.buildToolEventHandlerPublic('proc-sugg', () => 2);
            handler({
                type: 'tool-complete',
                toolCallId: 'tc4',
                toolName: 'suggest_follow_ups',
                result: JSON.stringify({ suggestions: ['Do X', 'Do Y', 'Do Z'] }),
            } as any);

            const session = executor.getOrCreateSessionPublic('proc-sugg');
            expect(session.pendingSuggestions).toEqual(['Do X', 'Do Y', 'Do Z']);
            expect(store.emitProcessEvent).toHaveBeenCalledWith('proc-sugg', expect.objectContaining({
                type: 'suggestions',
                suggestions: ['Do X', 'Do Y', 'Do Z'],
                turnIndex: 2,
            }));
        });

        it('ignores malformed suggest_follow_ups result without throwing', () => {
            const handler = executor.buildToolEventHandlerPublic('proc-malform', () => 0);
            expect(() => handler({
                type: 'tool-complete',
                toolCallId: 'tc5',
                toolName: 'suggest_follow_ups',
                result: 'not-valid-json{{{',
            } as any)).not.toThrow();
        });
    });

    // ========================================================================
    // Cancellation tokens
    // ========================================================================

    describe('cancelledTasks', () => {
        it('starts empty', () => {
            expect(executor.cancelledTasksPublic.size).toBe(0);
        });

        it('is an isolated Set per executor instance', () => {
            const other = new TestExecutor(store);
            executor.cancelledTasksPublic.add('task-1');
            expect(other.cancelledTasksPublic.size).toBe(0);
        });
    });

    // ========================================================================
    // Static constants
    // ========================================================================

    describe('static constants', () => {
        it('THROTTLE_TIME_MS is a positive number', () => {
            expect(TestExecutor.THROTTLE_TIME_MS_PUBLIC).toBeGreaterThan(0);
        });

        it('THROTTLE_CHUNK_COUNT is a positive number', () => {
            expect(TestExecutor.THROTTLE_CHUNK_COUNT_PUBLIC).toBeGreaterThan(0);
        });
    });

    // ========================================================================
    // Background task handler
    // ========================================================================

    describe('buildBackgroundTaskHandler', () => {
        it('emits background-tasks ProcessOutputEvent with correct fields', () => {
            const handler = executor.buildBackgroundTaskHandlerPublic('proc-bg');
            handler({
                backgroundAgents: [{ id: 'a1', description: 'research' }],
                backgroundShells: [{ id: 's1', description: 'npm test' }],
                backgroundTotalActive: 2,
                backgroundWaitingForDrain: true,
            });

            expect(store.emitProcessEvent).toHaveBeenCalledWith('proc-bg', {
                type: 'background-tasks',
                backgroundAgents: [{ id: 'a1', description: 'research' }],
                backgroundShells: [{ id: 's1', description: 'npm test' }],
                backgroundTotalActive: 2,
                backgroundWaitingForDrain: true,
            });
        });

        it('emits background-tasks with zero active when tasks drain', () => {
            const handler = executor.buildBackgroundTaskHandlerPublic('proc-bg2');
            handler({
                backgroundAgents: [],
                backgroundShells: [],
                backgroundTotalActive: 0,
                backgroundWaitingForDrain: false,
            });

            expect(store.emitProcessEvent).toHaveBeenCalledWith('proc-bg2', {
                type: 'background-tasks',
                backgroundAgents: [],
                backgroundShells: [],
                backgroundTotalActive: 0,
                backgroundWaitingForDrain: false,
            });
        });

        it('does not throw when store.emitProcessEvent throws', () => {
            store.emitProcessEvent = vi.fn(() => { throw new Error('store crash'); });
            const handler = executor.buildBackgroundTaskHandlerPublic('proc-bg3');
            expect(() => handler({
                backgroundAgents: [],
                backgroundShells: [],
                backgroundTotalActive: 0,
                backgroundWaitingForDrain: false,
            })).not.toThrow();
        });
    });
});
