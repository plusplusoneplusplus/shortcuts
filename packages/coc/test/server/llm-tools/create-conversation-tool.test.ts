/**
 * Create Conversation Tool Tests
 *
 * Unit tests for createCreateConversationTool: defaults, explicit mode/provider,
 * validation error paths (unknown workspace, bad provider, rejected modes,
 * bad model, missing prompt), workspace defaulting, and the rich result shape.
 */

import { describe, it, expect, vi } from 'vitest';
import { createCreateConversationTool } from '../../../src/server/llm-tools/create-conversation-tool';
import type { CreateConversationResult, CreateConversationSuccess } from '../../../src/server/llm-tools/create-conversation-tool';
import type { CreateTaskInput, ProcessStore } from '@plusplusoneplusplus/forge';

// Minimal invocation stub for handler calls (matches the SDK invocation arg).
const invocationStub = {
    sessionId: 'session-1',
    toolCallId: 'call-1',
    toolName: 'create_conversation',
    arguments: {},
};

/** Parent process metadata the handler inherits provider/model/reasoningEffort from. */
type ParentMeta = { provider?: string; model?: string; reasoningEffort?: string };

/** Default parent so the common success path has a provider to inherit. */
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
    const processes = parentProcessId
        ? { [parentProcessId]: { id: parentProcessId, metadata: parentMeta } }
        : {};

    const { tool } = createCreateConversationTool({
        store: makeStore(opts?.storeWorkspaces, processes),
        workspaceId: opts?.workspaceId ?? 'ws-1',
        enqueueChat,
        parentProcessId: parentProcessId ?? undefined,
    });
    return { tool, enqueueChat, captured };
}

function payloadOf(input: CreateTaskInput): Record<string, unknown> {
    return input.payload as Record<string, unknown>;
}

function asSuccess(result: CreateConversationResult): CreateConversationSuccess {
    if ('error' in result) {
        throw new Error(`Expected success but got error: ${result.error}`);
    }
    return result;
}

describe('createCreateConversationTool', () => {
    it('returns a valid Tool shape with prompt required', () => {
        const { tool } = makeTool();
        expect(tool.name).toBe('create_conversation');
        expect(typeof tool.handler).toBe('function');
        expect(tool.parameters).toMatchObject({
            type: 'object',
            required: ['prompt'],
        });
    });

    it('applies defaults (ask mode, normal priority, caller workspace) for { prompt } only', async () => {
        const { tool, enqueueChat, captured } = makeTool({ workspaceId: 'ws-1' });

        const result = asSuccess(await tool.handler({ prompt: 'hello' }, invocationStub));

        expect(enqueueChat).toHaveBeenCalledTimes(1);
        const input = captured.input!;
        expect(input.type).toBe('chat');
        expect(input.priority).toBe('normal');
        const payload = input.payload as Record<string, unknown>;
        expect(payload.kind).toBe('chat');
        expect(payload.mode).toBe('ask');
        expect(payload.prompt).toBe('hello');
        expect(payload.workspaceId).toBe('ws-1');

        expect(result.processId).toBe('queue_task-123');
        expect(result.status).toBe('queued');
        expect(result.openLink).toBe('#/process/queue_task-123');
        expect(result.title).toContain('hello');
    });

    it('honors explicit mode:autopilot', async () => {
        const { tool, captured } = makeTool();
        await tool.handler({ prompt: 'do work', mode: 'autopilot' }, invocationStub);
        const payload = captured.input!.payload as Record<string, unknown>;
        expect(payload.mode).toBe('autopilot');
    });

    it('uses an explicit title as the display name', async () => {
        const { tool, captured } = makeTool();
        const result = asSuccess(await tool.handler({ prompt: 'hello', title: 'My Spawned Chat' }, invocationStub));
        expect(captured.input!.displayName).toBe('My Spawned Chat');
        expect(result.title).toBe('My Spawned Chat');
    });

    it('passes provider and model through to the task', async () => {
        const { tool, captured } = makeTool();
        await tool.handler({ prompt: 'hi', provider: 'claude', model: 'claude-opus-4-8' }, invocationStub);
        const payload = captured.input!.payload as Record<string, unknown>;
        expect(payload.provider).toBe('claude');
        expect(captured.input!.config?.model).toBe('claude-opus-4-8');
    });

    it('targets a different registered workspace when workspaceId is provided', async () => {
        const { tool, captured } = makeTool({ workspaceId: 'ws-1', storeWorkspaces: ['ws-1', 'ws-2'] });
        await tool.handler({ prompt: 'hi', workspaceId: 'ws-2' }, invocationStub);
        const payload = captured.input!.payload as Record<string, unknown>;
        expect(payload.workspaceId).toBe('ws-2');
    });

    it('honors a high priority', async () => {
        const { tool, captured } = makeTool();
        await tool.handler({ prompt: 'urgent', priority: 'high' }, invocationStub);
        expect(captured.input!.priority).toBe('high');
    });

    // ---- error paths ------------------------------------------------------

    it('errors on missing/blank prompt', async () => {
        const { tool, enqueueChat } = makeTool();
        const result = await tool.handler({ prompt: '   ' }, invocationStub);
        expect('error' in result && result.error).toMatch(/prompt/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('errors on an unknown workspaceId', async () => {
        const { tool, enqueueChat } = makeTool({ workspaceId: 'ws-1', storeWorkspaces: ['ws-1'] });
        const result = await tool.handler({ prompt: 'hi', workspaceId: 'ws-missing' }, invocationStub);
        expect('error' in result && result.error).toMatch(/unknown workspaceid/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('errors when no workspace can be resolved', async () => {
        const captured: { input?: CreateTaskInput } = {};
        const enqueueChat = vi.fn(async (input: CreateTaskInput) => {
            captured.input = input;
            return 'task-x';
        });
        const { tool } = createCreateConversationTool({
            store: makeStore(['ws-1']),
            workspaceId: undefined,
            enqueueChat,
        });
        const result = await tool.handler({ prompt: 'hi' }, invocationStub);
        expect('error' in result && result.error).toMatch(/no target workspace/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('errors on an invalid provider', async () => {
        const { tool, enqueueChat } = makeTool();
        const result = await tool.handler(
            { prompt: 'hi', provider: 'gemini' as never },
            invocationStub,
        );
        expect('error' in result && result.error).toMatch(/invalid provider/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('rejects mode:plan', async () => {
        const { tool, enqueueChat } = makeTool();
        const result = await tool.handler({ prompt: 'hi', mode: 'plan' as never }, invocationStub);
        expect('error' in result && result.error).toMatch(/invalid mode/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('rejects mode:ralph', async () => {
        const { tool, enqueueChat } = makeTool();
        const result = await tool.handler({ prompt: 'hi', mode: 'ralph' as never }, invocationStub);
        expect('error' in result && result.error).toMatch(/invalid mode/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('errors on an empty model string', async () => {
        const { tool, enqueueChat } = makeTool();
        const result = await tool.handler({ prompt: 'hi', model: '   ' }, invocationStub);
        expect('error' in result && result.error).toMatch(/invalid model/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('errors on an invalid priority', async () => {
        const { tool, enqueueChat } = makeTool();
        const result = await tool.handler(
            { prompt: 'hi', priority: 'urgent' as never },
            invocationStub,
        );
        expect('error' in result && result.error).toMatch(/invalid priority/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    // ---- parent inheritance (AC-01 / AC-02) -------------------------------

    it('inherits provider/model/reasoningEffort from the parent for { prompt } only', async () => {
        const { tool, captured } = makeTool({
            parentMeta: { provider: 'claude', model: 'claude-sonnet-4-6', reasoningEffort: 'high' },
        });
        await tool.handler({ prompt: 'spawned' }, invocationStub);
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
        const { tool } = createCreateConversationTool({
            store,
            workspaceId: 'ws-1',
            enqueueChat: async input => { captured.input = input; return 'task-1'; },
            parentProcessId: 'queue_p1',
        });
        await tool.handler({ prompt: 'hi' }, invocationStub);
        expect(getProcess).toHaveBeenCalledWith('queue_p1');
        expect(payloadOf(captured.input!).provider).toBe('claude');
    });

    it('explicit model overrides parent model; provider + effort still inherited', async () => {
        const { tool, captured } = makeTool({
            parentMeta: { provider: 'claude', model: 'claude-sonnet-4-6', reasoningEffort: 'high' },
        });
        await tool.handler({ prompt: 'hi', model: 'claude-opus-4-8' }, invocationStub);
        const payload = payloadOf(captured.input!);
        expect(payload.provider).toBe('claude');
        expect(captured.input!.config?.model).toBe('claude-opus-4-8');
        expect(captured.input!.config?.reasoningEffort).toBe('high');
    });

    it('explicit provider overrides parent provider; model + effort still inherited', async () => {
        const { tool, captured } = makeTool({
            parentMeta: { provider: 'copilot', model: 'gpt-5', reasoningEffort: 'low' },
        });
        await tool.handler({ prompt: 'hi', provider: 'claude' }, invocationStub);
        const payload = payloadOf(captured.input!);
        expect(payload.provider).toBe('claude');
        // model 'gpt-5' is inherited but coerced to the claude provider default downstream.
        expect(captured.input!.config?.reasoningEffort).toBe('low');
    });

    it('reasoningEffort is always inherited and exposes no schema param', async () => {
        const { tool, captured } = makeTool({
            parentMeta: { provider: 'claude', model: 'claude-opus-4-8', reasoningEffort: 'xhigh' },
        });
        await tool.handler({ prompt: 'hi' }, invocationStub);
        expect(captured.input!.config?.reasoningEffort).toBe('xhigh');

        const props = (tool.parameters as { properties: Record<string, unknown> }).properties;
        expect(props.reasoningEffort).toBeUndefined();
    });

    it('falls back to provider default (no error) when parent has provider but no model', async () => {
        const { tool, enqueueChat, captured } = makeTool({
            parentMeta: { provider: 'claude' },
        });
        const result = await tool.handler({ prompt: 'hi' }, invocationStub);
        expect('error' in result).toBe(false);
        expect(enqueueChat).toHaveBeenCalledTimes(1);
        expect(payloadOf(captured.input!).provider).toBe('claude');
        // No inherited model → config.model stays undefined; the executor resolves
        // the provider's default later. The key point is no error is returned.
        expect(captured.input!.config?.model).toBeUndefined();
    });

    it('errors (and does NOT enqueue) with no resolvable parent and no explicit provider', async () => {
        const { tool, enqueueChat } = makeTool({ parentProcessId: null });
        const result = await tool.handler({ prompt: 'hi' }, invocationStub);
        expect('error' in result && result.error).toMatch(/provider/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('spawns with explicit provider+model even when no parent is resolvable', async () => {
        const { tool, enqueueChat, captured } = makeTool({ parentProcessId: null });
        const result = await tool.handler(
            { prompt: 'hi', provider: 'claude', model: 'claude-opus-4-8' },
            invocationStub,
        );
        expect('error' in result).toBe(false);
        expect(enqueueChat).toHaveBeenCalledTimes(1);
        expect(payloadOf(captured.input!).provider).toBe('claude');
        expect(captured.input!.config?.model).toBe('claude-opus-4-8');
    });

    it('inherited provider is set on payload (suppresses default-provider auto-routing)', async () => {
        // Setting payload.provider makes the enqueue path treat the provider as
        // explicit, so resolveDefaultProviderForTask skips auto-routing.
        const { tool, captured } = makeTool({ parentMeta: { provider: 'claude' } });
        await tool.handler({ prompt: 'hi' }, invocationStub);
        expect(payloadOf(captured.input!).provider).toBe('claude');
    });

    it('inherits parent settings even when targeting a different workspace', async () => {
        const { tool, captured } = makeTool({
            workspaceId: 'ws-1',
            storeWorkspaces: ['ws-1', 'ws-2'],
            parentMeta: { provider: 'claude', model: 'claude-opus-4-8', reasoningEffort: 'high' },
        });
        await tool.handler({ prompt: 'hi', workspaceId: 'ws-2' }, invocationStub);
        const payload = payloadOf(captured.input!);
        expect(payload.workspaceId).toBe('ws-2');
        expect(payload.provider).toBe('claude');
        expect(captured.input!.config?.reasoningEffort).toBe('high');
    });

    // ---- spawn link (AC-01) ----------------------------------------------

    it('persists the parent link as payload.context.spawnedFromProcessId', async () => {
        const { tool, captured } = makeTool({ parentProcessId: 'queue_caller' });
        await tool.handler({ prompt: 'spawn me' }, invocationStub);
        const context = payloadOf(captured.input!).context as { spawnedFromProcessId?: string } | undefined;
        expect(context?.spawnedFromProcessId).toBe('queue_caller');
    });

    it('omits the spawn link when there is no resolvable parent', async () => {
        const { tool, captured } = makeTool({ parentProcessId: null });
        await tool.handler({ prompt: 'hi', provider: 'claude', model: 'claude-opus-4-8' }, invocationStub);
        const context = payloadOf(captured.input!).context as { spawnedFromProcessId?: string } | undefined;
        expect(context?.spawnedFromProcessId).toBeUndefined();
    });

    it('mode defaults to ask and is never read from the parent', async () => {
        const { tool, captured } = makeTool({
            // A parent "mode" must not leak into the spawned conversation.
            parentMeta: { provider: 'claude', model: 'claude-opus-4-8' } as ParentMeta & { mode?: string },
        });
        await tool.handler({ prompt: 'hi' }, invocationStub);
        expect(payloadOf(captured.input!).mode).toBe('ask');
    });
});
