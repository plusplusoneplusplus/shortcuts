/**
 * Integration test for the create_conversation enqueue binding (AC-02 Part 2).
 *
 * Proves the tool is functional end-to-end against the *real* enqueue machinery
 * that `POST /api/queue` uses: `createCreateConversationTool` wired to an
 * `enqueueChat` callback that runs `enqueueViaBridge` against a real
 * `MultiRepoQueueRouter`. Calling the handler with `{ prompt }` routes a
 * `type:'chat'` task into the per-repo queue (so it appears in the chat list) and
 * returns the queued task's identity.
 *
 * Mirrors the binding built at the route layer in `registerAllRoutes`:
 *   enqueueChat = (input) => enqueueViaBridge(input, bridge, state, root, store)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { RepoQueueRegistry } from '@plusplusoneplusplus/forge';
import type { CreateTaskInput } from '@plusplusoneplusplus/forge';

// SDK mock — MultiRepoQueueRouter → CLITaskExecutor → getCopilotSDKService.
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { createMockProcessStore } from '../../helpers/mock-process-store';

const sdkMocks = createMockSDKService();

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        sdkServiceRegistry: { getOrThrow: () => sdkMocks.service },
    };
});

import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { createCreateConversationTool } from '../../../src/server/llm-tools/create-conversation-tool';
import { enqueueViaBridge, type QueueGlobalState } from '../../../src/server/routes/queue-shared';

const WS_ID = 'ws-spawn';
const ROOT = '/repo/spawn';

function freshState(): QueueGlobalState {
    return {
        globalPaused: false,
        globalPausedUntil: undefined,
        globalAutopilotPaused: false,
        globalAutopilotPausedUntil: undefined,
        resumeInProgress: new Set(),
    };
}

function setup(state: QueueGlobalState = freshState()) {
    const registry = new RepoQueueRegistry();
    const store = createMockProcessStore();
    (store.getWorkspaces as any).mockResolvedValue([{ id: WS_ID, rootPath: ROOT }]);
    // autoStart:false → enqueued tasks stay queued (no SDK execution in the test).
    const bridge = new MultiRepoQueueRouter(registry, store, { autoStart: false });

    const enqueueChat = (input: CreateTaskInput): Promise<string> =>
        enqueueViaBridge(input, bridge, state, ROOT, store);

    const { tool } = createCreateConversationTool({ store: store as any, workspaceId: WS_ID, enqueueChat });
    return { bridge, store, tool };
}

describe('create_conversation enqueue binding (real enqueueViaBridge path)', () => {
    beforeEach(() => {
        sdkMocks.resetAll();
    });

    it('enqueues a type:chat task that appears in the queue and returns its identity', async () => {
        const { bridge, tool } = setup();

        const result = await tool.handler({ prompt: 'spawn me a helper chat' }) as any;

        // Returned identity is queue_<taskId> with an openable deep link.
        expect(result.status).toBe('queued');
        expect(result.processId).toMatch(/^queue_/);
        expect(result.openLink).toBe(`#/process/${result.processId}`);

        // The conversation is actually in the queue (chat-list visible).
        const taskId = result.processId.slice('queue_'.length);
        const task = bridge.getTask(taskId);
        expect(task).toBeDefined();
        expect(task!.type).toBe('chat');
        expect((task!.payload as any).prompt).toBe('spawn me a helper chat');
        expect((task!.payload as any).mode).toBe('ask');
    });

    it('routes an explicit autopilot mode + title through the real path', async () => {
        const { bridge, tool } = setup();

        const result = await tool.handler({
            prompt: 'do the thing',
            mode: 'autopilot',
            title: 'Helper task',
        }) as any;

        expect(result.status).toBe('queued');
        expect(result.title).toBe('Helper task');

        const task = bridge.getTask(result.processId.slice('queue_'.length));
        expect((task!.payload as any).mode).toBe('autopilot');
        expect(task!.displayName).toBe('Helper task');
    });

    it('does not enqueue when validation fails (unknown workspace)', async () => {
        const { bridge, tool } = setup();

        const result = await tool.handler({ prompt: 'x', workspaceId: 'nope' }) as any;

        expect(result.error).toMatch(/Unknown workspaceId/);
        expect(bridge.createAggregateQueueFacade().getQueued()).toHaveLength(0);
    });
});
