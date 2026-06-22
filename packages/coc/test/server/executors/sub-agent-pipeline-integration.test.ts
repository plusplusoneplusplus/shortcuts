/**
 * Sub-agent pipeline integration test.
 *
 * This is the coverage the goal calls out as missing: no test drove a sub-agent
 * through the REAL server pipeline into the chat agent-canvas display. The
 * display-layer unit tests (agent-canvas-data, AgentCanvas.test.tsx, …) hand-build
 * `ClientConversationTurn[]` fixtures and so bypass the whole
 * SDK → executor → ProcessStore → tree-builder path.
 *
 * Here we drive sub-agent `ToolEvent`s through that path end to end:
 *   1. inject `createSubAgentMock([...])` as the chat executor's AI service — its
 *      `sendMessage` fires the producer's `ToolEvent[]` via `onToolEvent`;
 *   2. run the real `ChatExecutor.execute`, which wires the unified `onToolEvent`
 *      seam (`chat-base-executor.ts` → `buildToolEventHandler` →
 *      `appendTimelineItem`) and returns the assembled `timeline`;
 *   3. persist the final assistant turn into the in-memory ProcessStore exactly as
 *      production does (`process-lifecycle-runner.ts` → `appendConversationTurn`,
 *      `filterStreaming: true`);
 *   4. read the persisted turns back and run the real `buildAgentRunTreeFromTurns`,
 *      asserting the sync / background / nested tree the canvas renders.
 *
 * This proves the pipeline PRODUCES the very fixtures the display already reads,
 * with no per-provider branches — the helper works at the unified `ToolEvent`
 * seam, so it covers every current and future provider.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { QueuedTask, ConversationTurn } from '@plusplusoneplusplus/forge';
import { ChatExecutor } from '../../../src/server/executors/chat-executor';
import type { ChatModeExecutorOptions } from '../../../src/server/executors/chat-base-executor';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createSubAgentMock, type SubAgentSpec } from '../../helpers/mock-sdk-service';
import {
    buildAgentRunTreeFromTurns,
    countRuns,
} from '../../../src/server/spa/client/react/features/chat/agent-canvas/buildAgentRunTree';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

// ============================================================================
// Mocks — mirror chat-mode-executors.test.ts so execute() never touches disk.
// ============================================================================

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        promises: {
            ...actual.promises,
            readdir: vi.fn().mockResolvedValue([]),
            mkdir: vi.fn().mockResolvedValue(undefined),
        },
    };
});

vi.mock('../../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/server/processes/output-file-manager', () => ({
    OutputFileManager: {
        saveOutput: vi.fn().mockResolvedValue(undefined),
    },
}));

// ============================================================================
// Helpers
// ============================================================================

function makeChatTask(id: string): QueuedTask {
    return {
        id,
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: { kind: 'chat', mode: 'ask', prompt: 'Hello' },
        config: {},
        displayName: 'Hello',
    } as QueuedTask;
}

function makeOptions(
    store: ReturnType<typeof createMockProcessStore>,
    service: ChatModeExecutorOptions['aiService'],
): ChatModeExecutorOptions {
    return {
        aiService: service,
        defaultTimeoutMs: 30_000,
        followUpSuggestions: { enabled: false, count: 3 },
        resolveSkillConfig: vi.fn().mockResolvedValue({ skillDirectories: undefined, disabledSkills: undefined }),
        resolveWorkspaceIdForPath: vi.fn().mockResolvedValue('ws-id'),
    } as unknown as ChatModeExecutorOptions;
}

/** Let the executor's fire-and-forget streaming flush settle before we append. */
async function drainMicrotasks(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await Promise.resolve();
    }
}

/**
 * Drive `specs` through the real chat executor + ProcessStore and return the
 * persisted conversation turns (the same data the dashboard loads).
 */
async function runThroughPipeline(specs: SubAgentSpec[]): Promise<ClientConversationTurn[]> {
    const store = createMockProcessStore();
    const sub = createSubAgentMock(specs);
    const task = makeChatTask('subagent-pipeline');
    const processId = `queue_${task.id}`;

    // Production seeds the process with the user turn before executing.
    await store.addProcess({
        id: processId,
        type: 'chat',
        status: 'running',
        startTime: new Date(),
        promptPreview: 'Hello',
        fullPrompt: 'Hello',
        conversationTurns: [
            { role: 'user', content: 'Hello', timestamp: new Date(), turnIndex: 0, timeline: [] },
        ],
    } as Parameters<typeof store.addProcess>[0]);

    const executor = new ChatExecutor(store, makeOptions(store, sub.service));
    // Drives onToolEvent → buildToolEventHandler → appendTimelineItem; the
    // returned `timeline` is the assembled assistant-turn timeline.
    const result = (await executor.execute(task, 'Hello')) as {
        response: string;
        sessionId?: string;
        toolCalls?: unknown[];
        timeline: ConversationTurn['timeline'];
    };

    // Persist the final assistant turn exactly as process-lifecycle-runner does.
    await drainMicrotasks();
    await store.appendConversationTurn(
        processId,
        (turnIndex) => ({
            role: 'assistant' as const,
            content: result.response,
            timestamp: new Date(),
            turnIndex,
            toolCalls: (result.toolCalls as ConversationTurn['toolCalls']) || undefined,
            timeline: result.timeline,
        }),
        { filterStreaming: true },
    );

    const persisted = store.processes.get(processId)?.conversationTurns ?? [];
    return persisted as unknown as ClientConversationTurn[];
}

// ============================================================================
// Tests
// ============================================================================

describe('sub-agent pipeline integration (mock SDK → ChatExecutor → ProcessStore → buildAgentRunTreeFromTurns)', () => {
    const specs: SubAgentSpec[] = [
        {
            id: 'sync-ok',
            kind: 'sync',
            agentType: 'Explore',
            name: 'mapper',
            description: 'map the data model',
            model: 'claude-sonnet-4.6',
            result: 'Found 3 entities.',
        },
        {
            id: 'sync-bad',
            kind: 'sync',
            agentType: 'general-purpose',
            description: 'risky probe',
            status: 'failed',
            result: 'boom',
        },
        {
            id: 'bg-ok',
            kind: 'background',
            agentType: 'builder',
            name: 'build-and-test',
            prompt: 'build it',
            result: 'Build succeeded.\nAll tests pass.',
            children: [
                { id: 'bg-child', kind: 'sync', agentType: 'reviewer', description: 'review the diff', result: 'LGTM' },
            ],
        },
    ];

    let turns: ClientConversationTurn[];

    beforeEach(async () => {
        turns = await runThroughPipeline(specs);
    });

    it('persists tool events onto a conversation turn timeline (timeline produced by the real executor, not a hand-built fixture)', () => {
        const assistant = turns.find((t) => t.role === 'assistant');
        expect(assistant).toBeDefined();
        const toolNames = (assistant!.timeline ?? [])
            .map((item) => item.toolCall?.name)
            .filter(Boolean);
        // Task calls for every spec + the read_agent completion for the background one.
        expect(toolNames).toContain('Task');
        expect(toolNames).toContain('read_agent');
    });

    it('builds the orchestrator tree with one node per Task (read_agent calls are not nodes)', () => {
        const root = buildAgentRunTreeFromTurns(turns, { status: 'completed' });
        // 3 top-level Tasks + 1 nested child = 4 Task nodes + the orchestrator root.
        expect(countRuns(root)).toBe(5);
        expect(root.role).toBe('orchestrator');
        expect(root.children.map((c) => c.id).sort()).toEqual(['bg-ok', 'sync-bad', 'sync-ok']);
    });

    it('reads a sync sub-agent (role/name/model/result) straight from the persisted pipeline output', () => {
        const root = buildAgentRunTreeFromTurns(turns, { status: 'completed' });
        const syncOk = root.children.find((c) => c.id === 'sync-ok')!;
        expect(syncOk).toMatchObject({
            name: 'mapper',
            role: 'Explore',
            model: 'claude-sonnet-4.6',
            status: 'done',
            result: 'Found 3 entities.',
            summary: 'Found 3 entities.',
        });
    });

    it('marks a failed sync sub-agent failed (tool-failed flows through to the tree)', () => {
        const root = buildAgentRunTreeFromTurns(turns, { status: 'completed' });
        const syncBad = root.children.find((c) => c.id === 'sync-bad')!;
        expect(syncBad.status).toBe('failed');
        expect(syncBad.name).toBe('risky probe');
        expect(syncBad.role).toBe('general-purpose');
    });

    it('resolves a background sub-agent final output via the read_agent agent_id match', () => {
        const root = buildAgentRunTreeFromTurns(turns, { status: 'completed' });
        const bgOk = root.children.find((c) => c.id === 'bg-ok')!;
        expect(bgOk.role).toBe('builder');
        // The Task ack completed, so the node is done; its output is the
        // read_agent body resolved by agent_id, not the background-ack string.
        expect(bgOk.status).toBe('done');
        expect(bgOk.result).toBe('Build succeeded.\nAll tests pass.');
        expect(bgOk.result).not.toContain('agent_id:');
        expect(bgOk.result).not.toContain('Agent completed.');
    });

    it('nests a child sub-agent under the Task that spawned it (parentToolCallId survives the pipeline)', () => {
        const root = buildAgentRunTreeFromTurns(turns, { status: 'completed' });
        const bgOk = root.children.find((c) => c.id === 'bg-ok')!;
        expect(bgOk.children.map((c) => c.id)).toEqual(['bg-child']);
        expect(bgOk.children[0]).toMatchObject({
            id: 'bg-child',
            name: 'review the diff',
            role: 'reviewer',
            result: 'LGTM',
        });
    });
});
