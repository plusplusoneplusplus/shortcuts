/**
 * Send To Conversation Tool Tests
 *
 * Unit tests for createSendToConversationTool — the dual-mode tool selected by
 * whether a `processId` is supplied:
 *   - create mode (no processId): defaults, explicit mode, validation errors,
 *     workspace defaulting, parent provider/model/effort inheritance, spawn link,
 *     and the `{ processId, openLink }` result shape.
 *   - post mode (processId): delivers `content` into the existing conversation
 *     via the injected `sendMessage` capability, returns `turnIndex`, and ignores
 *     create-only fields.
 *   - description disambiguates the two modes.
 */

import { describe, it, expect, vi } from 'vitest';
import { createSendToConversationTool } from '../../../src/server/llm-tools/send-to-conversation-tool';
import type {
    SendToConversationResult,
    SendToConversationSuccess,
    SendMessageFn,
    SendToConversationRuntimeOptions,
} from '../../../src/server/llm-tools/send-to-conversation-tool';
import type { CreateTaskInput, ProcessStore } from '@plusplusoneplusplus/forge';

// Minimal invocation stub for handler calls (matches the SDK invocation arg).
const invocationStub = {
    sessionId: 'session-1',
    toolCallId: 'call-1',
    toolName: 'send_to_conversation',
    arguments: {},
};

/** Parent process metadata the handler inherits provider/model/reasoningEffort from. */
type ParentMeta = { provider?: string; model?: string; reasoningEffort?: string };

/** Default parent so the common create-mode success path has a provider to inherit. */
const DEFAULT_PARENT_ID = 'queue_parent';
const DEFAULT_PARENT_META: ParentMeta = { provider: 'copilot' };

function makeStore(
    workspaceIds: string[] = ['ws-1'],
    processes: Record<string, { id: string; metadata?: ParentMeta }> = {},
): ProcessStore {
    const store: Partial<ProcessStore> = {
        getWorkspaces: vi.fn().mockResolvedValue(
            workspaceIds.map(id => ({ id, name: id, rootPath: `/repo/${id}` })),
        ),
        getProcess: vi.fn(async (id: string) => processes[id] as never),
    };
    return store as ProcessStore;
}

interface MakeToolOpts {
    workspaceId?: string;
    storeWorkspaces?: string[];
    taskId?: string;
    /** Parent processId in scope. Pass `null` for a non-chat context (no parent). */
    parentProcessId?: string | null;
    /** Parent process metadata; omit a field to model an absent inherited value. */
    parentMeta?: ParentMeta;
    /** Post-mode delivery capability. Omit to model an unwired post mode. */
    sendMessage?: SendMessageFn;
    /** Runtime provider/tier helpers supplied by the route layer. */
    runtime?: SendToConversationRuntimeOptions;
    /** Additional process records addressable by post-mode tests. */
    extraProcesses?: Record<string, { id: string; metadata?: ParentMeta }>;
}

/** Build a tool wired to a stub enqueue that captures the CreateTaskInput it receives. */
function makeTool(opts?: MakeToolOpts) {
    const captured: { input?: CreateTaskInput } = {};
    const enqueueChat = vi.fn(async (input: CreateTaskInput) => {
        captured.input = input;
        return opts?.taskId ?? 'task-123';
    });

    const parentProcessId = opts && 'parentProcessId' in opts ? opts.parentProcessId : DEFAULT_PARENT_ID;
    const parentMeta = opts?.parentMeta ?? DEFAULT_PARENT_META;
    const processes = {
        ...(opts?.extraProcesses ?? {}),
        ...(parentProcessId ? { [parentProcessId]: { id: parentProcessId, metadata: parentMeta } } : {}),
    };

    const { tool } = createSendToConversationTool({
        store: makeStore(opts?.storeWorkspaces, processes),
        workspaceId: opts?.workspaceId ?? 'ws-1',
        enqueueChat,
        sendMessage: opts?.sendMessage,
        parentProcessId: parentProcessId ?? undefined,
        runtime: opts?.runtime,
    });
    return { tool, enqueueChat, captured };
}

function payloadOf(input: CreateTaskInput): Record<string, unknown> {
    return input.payload as Record<string, unknown>;
}

function asSuccess(result: SendToConversationResult): SendToConversationSuccess {
    if ('error' in result) {
        throw new Error(`Expected success but got error: ${result.error}`);
    }
    return result;
}

describe('createSendToConversationTool — shape & description', () => {
    it('returns a valid Tool shape named send_to_conversation with content required', () => {
        const { tool } = makeTool();
        expect(tool.name).toBe('send_to_conversation');
        expect(typeof tool.handler).toBe('function');
        expect(tool.parameters).toMatchObject({
            type: 'object',
            required: ['content'],
        });
    });

    it('declares the dual-mode parameter set with provider and effortTier metadata', () => {
        const { tool } = makeTool();
        const props = (tool.parameters as { properties: Record<string, unknown> }).properties;
        expect(Object.keys(props).sort()).toEqual(
            ['content', 'deliveryMode', 'effortTier', 'mode', 'model', 'priority', 'processId', 'provider', 'title', 'workspaceId'].sort(),
        );
        expect(props.provider).toMatchObject({ type: 'string', enum: ['copilot', 'codex', 'claude', 'opencode'] });
        expect(props.effortTier).toMatchObject({ type: 'string', enum: ['very-low', 'low', 'medium', 'high'] });
    });

    // AC-05: description leads with the processId branch and notes create-only-ignored.
    it('description disambiguates modes (processId branch first, create-only ignored)', () => {
        const { tool } = makeTool();
        const desc = tool.description ?? '';
        expect(desc).toMatch(/processId/);
        // The processId branch is described before the "omitted → create" branch.
        expect(desc.indexOf('processId')).toBeLessThan(desc.indexOf('omitted'));
        expect(desc).toMatch(/ignored/i);
    });
});

describe('createSendToConversationTool — create mode (no processId)', () => {
    it('applies defaults (ask mode, normal priority, caller workspace) for { content } only', async () => {
        const { tool, enqueueChat, captured } = makeTool({ workspaceId: 'ws-1' });

        const result = asSuccess(await tool.handler({ content: 'hello' }, invocationStub));

        expect(enqueueChat).toHaveBeenCalledTimes(1);
        const input = captured.input!;
        expect(input.type).toBe('chat');
        expect(input.priority).toBe('normal');
        const payload = input.payload as Record<string, unknown>;
        expect(payload.kind).toBe('chat');
        expect(payload.mode).toBe('ask');
        expect(payload.prompt).toBe('hello');
        expect(payload.workspaceId).toBe('ws-1');

        // Uniform return shape: { processId, openLink }; no turnIndex in create mode.
        expect(result.processId).toBe('queue_task-123');
        expect(result.openLink).toBe('#/process/queue_task-123');
        expect(result.turnIndex).toBeUndefined();
    });

    it('honors explicit mode:autopilot', async () => {
        const { tool, captured } = makeTool();
        await tool.handler({ content: 'do work', mode: 'autopilot' }, invocationStub);
        const payload = captured.input!.payload as Record<string, unknown>;
        expect(payload.mode).toBe('autopilot');
    });

    it('uses an explicit title as the display name', async () => {
        const { tool, captured } = makeTool();
        await tool.handler({ content: 'hello', title: 'My Spawned Chat' }, invocationStub);
        expect(captured.input!.displayName).toBe('My Spawned Chat');
    });

    it('passes an explicit model through to the task config', async () => {
        const { tool, captured } = makeTool();
        await tool.handler({ content: 'hi', model: 'claude-opus-4-8' }, invocationStub);
        expect(captured.input!.config?.model).toBe('claude-opus-4-8');
    });

    it('targets a different registered workspace when workspaceId is provided', async () => {
        const { tool, captured } = makeTool({ workspaceId: 'ws-1', storeWorkspaces: ['ws-1', 'ws-2'] });
        await tool.handler({ content: 'hi', workspaceId: 'ws-2' }, invocationStub);
        const payload = captured.input!.payload as Record<string, unknown>;
        expect(payload.workspaceId).toBe('ws-2');
    });

    it('honors a high priority', async () => {
        const { tool, captured } = makeTool();
        await tool.handler({ content: 'urgent', priority: 'high' }, invocationStub);
        expect(captured.input!.priority).toBe('high');
    });

    // ---- error paths ------------------------------------------------------

    it('errors on missing/blank content', async () => {
        const { tool, enqueueChat } = makeTool();
        const result = await tool.handler({ content: '   ' }, invocationStub);
        expect('error' in result && result.error).toMatch(/content/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('errors on an unknown workspaceId', async () => {
        const { tool, enqueueChat } = makeTool({ workspaceId: 'ws-1', storeWorkspaces: ['ws-1'] });
        const result = await tool.handler({ content: 'hi', workspaceId: 'ws-missing' }, invocationStub);
        expect('error' in result && result.error).toMatch(/unknown workspaceid/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('errors when no workspace can be resolved', async () => {
        const enqueueChat = vi.fn(async () => 'task-x');
        const { tool } = createSendToConversationTool({
            store: makeStore(['ws-1']),
            workspaceId: undefined,
            enqueueChat,
        });
        const result = await tool.handler({ content: 'hi' }, invocationStub);
        expect('error' in result && result.error).toMatch(/no target workspace/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('rejects mode:plan', async () => {
        const { tool, enqueueChat } = makeTool();
        const result = await tool.handler({ content: 'hi', mode: 'plan' as never }, invocationStub);
        expect('error' in result && result.error).toMatch(/invalid mode/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('rejects mode:ralph', async () => {
        const { tool, enqueueChat } = makeTool();
        const result = await tool.handler({ content: 'hi', mode: 'ralph' as never }, invocationStub);
        expect('error' in result && result.error).toMatch(/invalid mode/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('errors on an empty model string', async () => {
        const { tool, enqueueChat } = makeTool();
        const result = await tool.handler({ content: 'hi', model: '   ' }, invocationStub);
        expect('error' in result && result.error).toMatch(/invalid model/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('errors on an invalid priority', async () => {
        const { tool, enqueueChat } = makeTool();
        const result = await tool.handler({ content: 'hi', priority: 'urgent' as never }, invocationStub);
        expect('error' in result && result.error).toMatch(/invalid priority/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('errors on an invalid provider value', async () => {
        const { tool, enqueueChat } = makeTool();
        const result = await tool.handler({ content: 'hi', provider: 'auto' as never }, invocationStub);
        expect('error' in result && result.error).toMatch(/invalid provider/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('errors on an invalid effortTier value', async () => {
        const { tool, enqueueChat } = makeTool();
        const result = await tool.handler({ content: 'hi', effortTier: 'ultra' as never }, invocationStub);
        expect('error' in result && result.error).toMatch(/invalid efforttier/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    // ---- parent inheritance ----------------------------------------------

    it('inherits provider/model/reasoningEffort from the parent for { content } only', async () => {
        const { tool, captured } = makeTool({
            parentMeta: { provider: 'claude', model: 'claude-sonnet-4-6', reasoningEffort: 'high' },
        });
        await tool.handler({ content: 'spawned' }, invocationStub);
        const payload = payloadOf(captured.input!);
        expect(payload.provider).toBe('claude');
        expect(captured.input!.config?.model).toBe('claude-sonnet-4-6');
        expect(captured.input!.config?.reasoningEffort).toBe('high');
    });

    it('reads the parent process via store.getProcess(parentProcessId)', async () => {
        const getProcess = vi.fn(async (_id: string) => ({
            id: 'queue_p1',
            metadata: { provider: 'claude', model: 'claude-opus-4-8', reasoningEffort: 'medium' },
        }) as never);
        const store = {
            getWorkspaces: vi.fn().mockResolvedValue([{ id: 'ws-1', name: 'ws-1', rootPath: '/repo/ws-1' }]),
            getProcess,
        } as unknown as ProcessStore;
        const captured: { input?: CreateTaskInput } = {};
        const { tool } = createSendToConversationTool({
            store,
            workspaceId: 'ws-1',
            enqueueChat: async input => { captured.input = input; return 'task-1'; },
            parentProcessId: 'queue_p1',
        });
        await tool.handler({ content: 'hi' }, invocationStub);
        expect(getProcess).toHaveBeenCalledWith('queue_p1');
        expect(payloadOf(captured.input!).provider).toBe('claude');
    });

    it('explicit model overrides parent model; provider + effort still inherited', async () => {
        const { tool, captured } = makeTool({
            parentMeta: { provider: 'claude', model: 'claude-sonnet-4-6', reasoningEffort: 'high' },
        });
        await tool.handler({ content: 'hi', model: 'claude-opus-4-8' }, invocationStub);
        const payload = payloadOf(captured.input!);
        expect(payload.provider).toBe('claude');
        expect(captured.input!.config?.model).toBe('claude-opus-4-8');
        expect(captured.input!.config?.reasoningEffort).toBe('high');
    });

    it('explicit provider replaces parent provider/model/reasoningEffort inheritance', async () => {
        const { tool, captured } = makeTool({
            parentMeta: { provider: 'claude', model: 'claude-opus-4-8', reasoningEffort: 'high' },
        });
        await tool.handler({ content: 'hi', provider: 'codex' }, invocationStub);
        const payload = payloadOf(captured.input!);
        expect(payload.provider).toBe('codex');
        expect(captured.input!.config?.model).toBeUndefined();
        expect(captured.input!.config?.reasoningEffort).toBeUndefined();
    });

    it('explicit provider plus explicit model does not inherit parent reasoningEffort', async () => {
        const { tool, captured } = makeTool({
            parentMeta: { provider: 'claude', model: 'claude-opus-4-8', reasoningEffort: 'high' },
        });
        await tool.handler({ content: 'hi', provider: 'codex', model: 'gpt-5.5' }, invocationStub);
        const payload = payloadOf(captured.input!);
        expect(payload.provider).toBe('codex');
        expect(captured.input!.config?.model).toBe('gpt-5.5');
        expect(captured.input!.config?.reasoningEffort).toBeUndefined();
        expect((captured.input!.config as any).effortTier).toBeUndefined();
    });

    it('passes an explicit create-mode effortTier through queue config when no model is supplied', async () => {
        const { tool, captured } = makeTool({
            parentMeta: { provider: 'claude', model: 'claude-opus-4-8', reasoningEffort: 'high' },
        });
        await tool.handler({ content: 'hi', provider: 'codex', effortTier: 'high' }, invocationStub);
        const payload = payloadOf(captured.input!);
        expect(payload.provider).toBe('codex');
        expect(captured.input!.config?.model).toBeUndefined();
        expect(captured.input!.config?.reasoningEffort).toBeUndefined();
        expect((captured.input!.config as any).effortTier).toBe('high');
    });

    it('ignores create-mode effortTier when an explicit model is supplied', async () => {
        const { tool, captured } = makeTool({
            parentMeta: { provider: 'claude', model: 'claude-opus-4-8', reasoningEffort: 'high' },
        });
        await tool.handler(
            { content: 'hi', provider: 'codex', model: 'gpt-5.5', effortTier: 'high' },
            invocationStub,
        );
        expect(captured.input!.config?.model).toBe('gpt-5.5');
        expect((captured.input!.config as any).effortTier).toBeUndefined();
        expect(captured.input!.config?.reasoningEffort).toBeUndefined();
    });

    it('rejects an explicit provider whose requested model is incompatible', async () => {
        const { tool, enqueueChat } = makeTool();
        const result = await tool.handler(
            { content: 'hi', provider: 'codex', model: 'claude-opus-4-8' },
            invocationStub,
        );
        expect('error' in result && result.error).toMatch(/not compatible/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('rejects an unavailable explicit provider before enqueueing', async () => {
        const validateProvider = vi.fn(async () => {
            throw new Error('Claude provider is disabled.');
        });
        const { tool, enqueueChat } = makeTool({ runtime: { validateProvider } });
        const result = await tool.handler({ content: 'hi', provider: 'claude' }, invocationStub);
        expect(validateProvider).toHaveBeenCalledWith('claude');
        expect('error' in result && result.error).toMatch(/disabled/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('rejects an incompatible configured effortTier model for the selected provider', async () => {
        const { tool, enqueueChat } = makeTool({
            runtime: {
                getEffortTiersForProvider: () => ({
                    high: { model: 'claude-opus-4-8', reasoningEffort: 'high' },
                }),
            },
        });
        const result = await tool.handler({ content: 'hi', provider: 'codex', effortTier: 'high' }, invocationStub);
        expect('error' in result && result.error).toMatch(/not compatible/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('reasoningEffort is inherited but not exposed as a raw schema param', async () => {
        const { tool, captured } = makeTool({
            parentMeta: { provider: 'claude', model: 'claude-opus-4-8', reasoningEffort: 'xhigh' },
        });
        await tool.handler({ content: 'hi' }, invocationStub);
        expect(captured.input!.config?.reasoningEffort).toBe('xhigh');

        const props = (tool.parameters as { properties: Record<string, unknown> }).properties;
        expect(props.reasoningEffort).toBeUndefined();
        expect(props.provider).toBeDefined();
    });

    it('falls back to provider default (no error) when parent has provider but no model', async () => {
        const { tool, enqueueChat, captured } = makeTool({ parentMeta: { provider: 'claude' } });
        const result = await tool.handler({ content: 'hi' }, invocationStub);
        expect('error' in result).toBe(false);
        expect(enqueueChat).toHaveBeenCalledTimes(1);
        expect(payloadOf(captured.input!).provider).toBe('claude');
        expect(captured.input!.config?.model).toBeUndefined();
    });

    it('errors (and does NOT enqueue) with no resolvable parent to inherit a provider from', async () => {
        const { tool, enqueueChat } = makeTool({ parentProcessId: null });
        const result = await tool.handler({ content: 'hi' }, invocationStub);
        expect('error' in result && result.error).toMatch(/provider/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('inherited provider is set on payload (suppresses default-provider auto-routing)', async () => {
        const { tool, captured } = makeTool({ parentMeta: { provider: 'claude' } });
        await tool.handler({ content: 'hi' }, invocationStub);
        expect(payloadOf(captured.input!).provider).toBe('claude');
    });

    it('inherits parent settings even when targeting a different workspace', async () => {
        const { tool, captured } = makeTool({
            workspaceId: 'ws-1',
            storeWorkspaces: ['ws-1', 'ws-2'],
            parentMeta: { provider: 'claude', model: 'claude-opus-4-8', reasoningEffort: 'high' },
        });
        await tool.handler({ content: 'hi', workspaceId: 'ws-2' }, invocationStub);
        const payload = payloadOf(captured.input!);
        expect(payload.workspaceId).toBe('ws-2');
        expect(payload.provider).toBe('claude');
        expect(captured.input!.config?.reasoningEffort).toBe('high');
    });

    // ---- spawn link -------------------------------------------------------

    it('persists the parent link as payload.context.spawnedFromProcessId', async () => {
        const { tool, captured } = makeTool({ parentProcessId: 'queue_caller' });
        await tool.handler({ content: 'spawn me' }, invocationStub);
        const context = payloadOf(captured.input!).context as { spawnedFromProcessId?: string } | undefined;
        expect(context?.spawnedFromProcessId).toBe('queue_caller');
    });

    it('mode defaults to ask and is never read from the parent', async () => {
        const { tool, captured } = makeTool({
            parentMeta: { provider: 'claude', model: 'claude-opus-4-8' } as ParentMeta & { mode?: string },
        });
        await tool.handler({ content: 'hi' }, invocationStub);
        expect(payloadOf(captured.input!).mode).toBe('ask');
    });
});

describe('createSendToConversationTool — post mode (processId provided)', () => {
    // AC-04: posts into the existing conversation via sendMessage, returns turnIndex.
    it('delivers content via sendMessage and returns { processId, openLink, turnIndex }', async () => {
        const sendMessage = vi.fn(async () => ({ turnIndex: 7 }));
        const { tool, enqueueChat } = makeTool({ sendMessage });

        const result = asSuccess(
            await tool.handler({ processId: 'queue_existing', content: 'follow up please' }, invocationStub),
        );

        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ processId: 'queue_existing', content: 'follow up please' }),
        );
        // Post mode must NOT enqueue a new conversation.
        expect(enqueueChat).not.toHaveBeenCalled();
        expect(result.processId).toBe('queue_existing');
        expect(result.openLink).toBe('#/process/queue_existing');
        expect(result.turnIndex).toBe(7);
    });

    it('forwards mode, model, and deliveryMode to sendMessage', async () => {
        const sendMessage = vi.fn(async () => ({ turnIndex: 1 }));
        const { tool } = makeTool({ sendMessage });
        await tool.handler(
            {
                processId: 'queue_existing',
                content: 'go',
                mode: 'autopilot',
                model: 'claude-opus-4-8',
                deliveryMode: 'steer',
            },
            invocationStub,
        );
        expect(sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                processId: 'queue_existing',
                content: 'go',
                mode: 'autopilot',
                model: 'claude-opus-4-8',
                deliveryMode: 'steer',
            }),
        );
    });

    it('accepts but ignores post-mode provider', async () => {
        const sendMessage = vi.fn(async () => ({ turnIndex: 1 }));
        const { tool } = makeTool({ sendMessage });
        await tool.handler(
            {
                processId: 'queue_existing',
                content: 'go',
                provider: 'codex',
            },
            invocationStub,
        );
        expect(sendMessage).toHaveBeenCalledWith(
            expect.not.objectContaining({ provider: expect.anything() }),
        );
    });

    it('resolves post-mode effortTier against the existing conversation provider', async () => {
        const sendMessage = vi.fn(async () => ({ turnIndex: 1 }));
        const { tool } = makeTool({
            sendMessage,
            extraProcesses: {
                queue_existing: { id: 'queue_existing', metadata: { provider: 'claude' } },
            },
        });
        await tool.handler(
            {
                processId: 'queue_existing',
                content: 'go',
                provider: 'codex',
                effortTier: 'medium',
            },
            invocationStub,
        );
        expect(sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                processId: 'queue_existing',
                model: 'opus',
                effort: 'medium',
            }),
        );
    });

    it('uses post-mode model over effortTier and does not resolve the tier', async () => {
        const sendMessage = vi.fn(async () => ({ turnIndex: 1 }));
        const getEffortTiersForProvider = vi.fn();
        const { tool } = makeTool({
            sendMessage,
            runtime: { getEffortTiersForProvider },
        });
        await tool.handler(
            {
                processId: 'queue_existing',
                content: 'go',
                provider: 'claude',
                model: 'gpt-5.5',
                effortTier: 'high',
            },
            invocationStub,
        );
        expect(getEffortTiersForProvider).not.toHaveBeenCalled();
        expect(sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                processId: 'queue_existing',
                model: 'gpt-5.5',
            }),
        );
        expect(sendMessage).toHaveBeenCalledWith(
            expect.not.objectContaining({ effort: expect.anything() }),
        );
    });

    it('errors when post-mode effortTier cannot resolve the target process', async () => {
        const sendMessage = vi.fn(async () => ({ turnIndex: 1 }));
        const { tool } = makeTool({ sendMessage });
        const result = await tool.handler(
            { processId: 'queue_missing', content: 'go', effortTier: 'high' },
            invocationStub,
        );
        expect('error' in result && result.error).toMatch(/not found/i);
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('rejects an incompatible post-mode effortTier model for the existing provider', async () => {
        const sendMessage = vi.fn(async () => ({ turnIndex: 1 }));
        const { tool } = makeTool({
            sendMessage,
            extraProcesses: {
                queue_existing: { id: 'queue_existing', metadata: { provider: 'codex' } },
            },
            runtime: {
                getEffortTiersForProvider: () => ({
                    high: { model: 'claude-opus-4-8', reasoningEffort: 'high' },
                }),
            },
        });
        const result = await tool.handler(
            { processId: 'queue_existing', content: 'go', effortTier: 'high' },
            invocationStub,
        );
        expect('error' in result && result.error).toMatch(/not compatible/i);
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('ignores create-only fields (workspaceId, title, priority) without error', async () => {
        const sendMessage = vi.fn(async () => ({ turnIndex: 2 }));
        const { tool, enqueueChat } = makeTool({ sendMessage });
        const result = await tool.handler(
            {
                processId: 'queue_existing',
                content: 'hi',
                workspaceId: 'ws-2',
                title: 'ignored',
                priority: 'high',
            },
            invocationStub,
        );
        expect('error' in result).toBe(false);
        expect(enqueueChat).not.toHaveBeenCalled();
        const arg = sendMessage.mock.calls[0][0];
        expect(arg).not.toHaveProperty('workspaceId');
        expect(arg).not.toHaveProperty('title');
        expect(arg).not.toHaveProperty('priority');
    });

    it('errors on a blank content even in post mode', async () => {
        const sendMessage = vi.fn(async () => ({ turnIndex: 0 }));
        const { tool } = makeTool({ sendMessage });
        const result = await tool.handler({ processId: 'queue_existing', content: '  ' }, invocationStub);
        expect('error' in result && result.error).toMatch(/content/i);
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('errors on an invalid deliveryMode', async () => {
        const sendMessage = vi.fn(async () => ({ turnIndex: 0 }));
        const { tool } = makeTool({ sendMessage });
        const result = await tool.handler(
            { processId: 'queue_existing', content: 'hi', deliveryMode: 'whenever' as never },
            invocationStub,
        );
        expect('error' in result && result.error).toMatch(/invalid deliverymode/i);
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('errors gracefully when no sendMessage capability is wired', async () => {
        const { tool } = makeTool({ sendMessage: undefined });
        const result = await tool.handler({ processId: 'queue_existing', content: 'hi' }, invocationStub);
        expect('error' in result && result.error).toMatch(/not available/i);
    });

    it('surfaces a delivery failure as a tool error', async () => {
        const sendMessage = vi.fn(async () => { throw new Error('process not found'); });
        const { tool } = makeTool({ sendMessage });
        const result = await tool.handler({ processId: 'queue_missing', content: 'hi' }, invocationStub);
        expect('error' in result && result.error).toMatch(/process not found/i);
    });
});
