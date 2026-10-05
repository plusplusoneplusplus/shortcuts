/**
 * Unit tests for createSendToConversationTool — the dual-mode tool selected by
 * whether a `processId` is supplied:
 *   - create mode (no processId): defaults, explicit mode, validation errors,
 *     workspace defaulting, parent provider/model/effort inheritance, spawn link,
 *     and the `{ processId, openLink }` result shape.
 *   - post mode (processId): delivers `content` into the existing conversation
 *     via the injected `sendMessage` capability, returns `turnIndex`, and ignores
 *     create-only fields.
 *   - ralph mode (create only): launches through the injected `launchRalph`
 *     capability with the resolved goal/workspace/AI selection.
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
import type { LaunchRalphFn } from '../../../src/server/ralph/ralph-launch-service';
import { createWorkspaceDirectory } from '../../../src/server/servers/workspace-directory';

// Minimal invocation stub for handler calls (matches the SDK invocation arg).
const invocationStub = {
    sessionId: 'session-1',
    toolCallId: 'call-1',
    toolName: 'send_to_conversation',
    arguments: {},
};

/** Parent process metadata the handler inherits provider/model/reasoningEffort from. */
type ParentMeta = { provider?: string; model?: string; reasoningEffort?: string; mode?: string };

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
    /** Ralph launch capability. Omit to model an unwired ralph mode. */
    launchRalph?: LaunchRalphFn;
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
        launchRalph: opts?.launchRalph,
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
        expect(props.provider).toMatchObject({ type: 'string', enum: ['auto', 'copilot', 'codex', 'claude', 'opencode'] });
        expect(props.effortTier).toMatchObject({ type: 'string', enum: ['very-low', 'low', 'medium', 'high'] });
    });

    // AC-05: description leads with the processId (post) branch before the create branch.
    it('description disambiguates modes (processId branch first)', () => {
        const { tool } = makeTool();
        const desc = tool.description ?? '';
        expect(desc).toMatch(/processId/);
        expect(desc.indexOf('With `processId`')).toBeLessThan(desc.indexOf('Without `processId`'));
    });

    it('documents persistent task-specific titles without making them required', () => {
        const { tool } = makeTool();
        expect((tool.parameters as { required: string[] }).required).toEqual(['content']);
        expect(tool.description).toContain('short, task-specific `title`');
        expect(tool.description).toContain('visible custom title even after AI title generation');
        expect(tool.parameters).toMatchObject({
            required: ['content'],
            properties: {
                title: {
                    type: 'string',
                    description: expect.stringContaining('optional persistent custom title'),
                },
            },
        });
        const props = (tool.parameters as { properties: Record<string, { description?: string }> }).properties;
        expect(props.title.description).toContain('Trimmed, non-empty, max 80 characters');
        expect(props.title.description).toContain('Ignored in post mode');
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
        expect(input.displayName).toBe('hello');
        expect(payload).not.toHaveProperty('customTitle');

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

    it('trims an explicit title and carries it alongside the display name', async () => {
        const { tool, captured } = makeTool();
        asSuccess(await tool.handler({ content: 'hello', title: ' \tMy Spawned Chat\n ' }, invocationStub));
        expect(captured.input!.displayName).toBe('My Spawned Chat');
        expect(payloadOf(captured.input!).customTitle).toBe('My Spawned Chat');
    });

    it('accepts exactly 80 title characters after trimming', async () => {
        const { tool, captured } = makeTool();
        const title = 'x'.repeat(80);
        asSuccess(await tool.handler({ content: 'hello', title: ` ${title} ` }, invocationStub));
        expect(captured.input!.displayName).toBe(title);
        expect(payloadOf(captured.input!).customTitle).toBe(title);
    });

    it.each(['', ' \t\n '])('rejects a blank create-mode title %j without enqueueing', async title => {
        const { tool, enqueueChat } = makeTool();
        const result = await tool.handler({ content: 'hello', title }, invocationStub);
        expect('error' in result && result.error).toMatch(/title.*non-empty string/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('rejects a title longer than 80 characters without enqueueing', async () => {
        const { tool, enqueueChat } = makeTool();
        const result = await tool.handler({ content: 'hello', title: ` ${'x'.repeat(81)} ` }, invocationStub);
        expect('error' in result && result.error).toMatch(/title.*80 characters/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it.each([null, 42])('rejects a non-string create-mode title %j without enqueueing', async title => {
        const { tool, enqueueChat } = makeTool();
        const result = await tool.handler({ content: 'hello', title: title as never }, invocationStub);
        expect('error' in result && result.error).toMatch(/title.*non-empty string/i);
        expect(enqueueChat).not.toHaveBeenCalled();
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
        const result = await tool.handler({ content: 'hi', provider: 'invalid' as never }, invocationStub);
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

    it.each(['ask', 'autopilot'] as const)('explicit Auto in %s mode inherits no parent AI settings', async mode => {
        const validateProvider = vi.fn();
        const getEffortTiersForProvider = vi.fn();
        const { tool, captured } = makeTool({
            parentMeta: { provider: 'claude', model: 'opus', reasoningEffort: 'high' },
            storeWorkspaces: ['ws-1', 'ws-2'],
            runtime: { validateProvider, getEffortTiersForProvider },
        });
        asSuccess(await tool.handler({ content: 'work', provider: 'auto', workspaceId: 'ws-2', mode }, invocationStub));
        expect(payloadOf(captured.input!)).toMatchObject({
            workspaceId: 'ws-2', mode,
            context: { spawnedFromProcessId: DEFAULT_PARENT_ID, autoProviderRouting: { requested: true } },
        });
        expect(payloadOf(captured.input!).provider).toBeUndefined();
        expect(payloadOf(captured.input!).model).toBeUndefined();
        expect(captured.input!.config?.model).toBeUndefined();
        expect(captured.input!.config?.reasoningEffort).toBeUndefined();
        expect(validateProvider).not.toHaveBeenCalled();
        expect(getEffortTiersForProvider).not.toHaveBeenCalled();
    });

    it('explicit Auto works without parent context', async () => {
        const { tool, captured } = makeTool({ parentProcessId: null });
        asSuccess(await tool.handler({ content: 'work', provider: 'auto' }, invocationStub));
        expect(payloadOf(captured.input!).context).toEqual({ autoProviderRouting: { requested: true } });
    });

    it.each([
        { model: 'opus', effortTier: 'high' as const },
        { effortTier: 'high' as const },
    ])('preserves explicit Auto overrides %j for target resolution', async overrides => {
        const { tool, captured } = makeTool({ parentMeta: { provider: 'codex', model: 'gpt-5.5', reasoningEffort: 'low' } });
        asSuccess(await tool.handler({ content: 'work', provider: 'auto', ...overrides }, invocationStub));
        expect(captured.input!.config?.model).toBe(overrides.model);
        expect(captured.input!.config?.effortTier).toBe(overrides.model ? undefined : 'high');
        expect(captured.input!.config?.reasoningEffort).toBeUndefined();
    });

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

    it('mode defaults to autopilot when called from a sentinel (dispatcher) chat', async () => {
        const { tool, captured } = makeTool({
            parentMeta: { provider: 'claude', mode: 'sentinel' } as ParentMeta & { mode?: string },
        });
        await tool.handler({ content: 'rename X to Y' }, invocationStub);
        expect(payloadOf(captured.input!).mode).toBe('autopilot');
    });

    it('an explicit mode still wins from a sentinel chat', async () => {
        const { tool, captured } = makeTool({
            parentMeta: { provider: 'claude', mode: 'sentinel' } as ParentMeta & { mode?: string },
        });
        await tool.handler({ content: 'look around', mode: 'ask' }, invocationStub);
        expect(payloadOf(captured.input!).mode).toBe('ask');
    });

    it('a non-sentinel parent mode is never inherited as the default', async () => {
        for (const mode of ['ask', 'autopilot', 'ralph']) {
            const { tool, captured } = makeTool({
                parentMeta: { provider: 'claude', mode } as ParentMeta & { mode?: string },
            });
            await tool.handler({ content: 'hi' }, invocationStub);
            expect(payloadOf(captured.input!).mode).toBe('ask');
        }
    });

    it('falls back to ask when the parent cannot be read', async () => {
        const store = {
            getWorkspaces: vi.fn().mockResolvedValue([{ id: 'ws-1', name: 'ws-1', rootPath: '/repo/ws-1' }]),
            // Only the default-mode lookup fails; the provider inheritance read succeeds.
            getProcess: vi.fn()
                .mockRejectedValueOnce(new Error('boom'))
                .mockResolvedValue({ id: 'queue_p1', metadata: { provider: 'claude', mode: 'sentinel' } }),
        } as unknown as ProcessStore;
        const captured: { input?: CreateTaskInput } = {};
        const { tool } = createSendToConversationTool({
            store,
            workspaceId: 'ws-1',
            enqueueChat: async input => { captured.input = input; return 'task-1'; },
            parentProcessId: 'queue_p1',
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

    it('ignores Auto in post mode and resolves effort against the existing provider', async () => {
        const sendMessage = vi.fn().mockResolvedValue({ turnIndex: 3 });
        const { tool } = makeTool({ sendMessage, extraProcesses: { queue_existing: { id: 'queue_existing', metadata: { provider: 'claude' } } } });
        asSuccess(await tool.handler({ content: 'continue', processId: 'queue_existing', provider: 'auto', effortTier: 'medium' }, invocationStub));
        expect(sendMessage.mock.calls[0][0]).toMatchObject({ model: 'opus', effort: 'medium' });
        expect(sendMessage.mock.calls[0][0].provider).toBeUndefined();
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

    it.each([' \t\n ', 'x'.repeat(81)])('ignores invalid create-mode title %j in post mode', async title => {
        const sendMessage = vi.fn(async () => ({ turnIndex: 2 }));
        const { tool, enqueueChat } = makeTool({ sendMessage });
        const result = asSuccess(await tool.handler(
            { processId: 'queue_existing', content: 'hi', title },
            invocationStub,
        ));
        expect(result.turnIndex).toBe(2);
        expect(enqueueChat).not.toHaveBeenCalled();
        expect(sendMessage).toHaveBeenCalledWith({
            processId: 'queue_existing',
            content: 'hi',
        });
    });

    it('omits mode in post mode so delivery keeps the conversation mode (no ask default)', async () => {
        const sendMessage = vi.fn(async () => ({ turnIndex: 1 }));
        const { tool } = makeTool({ sendMessage });
        asSuccess(await tool.handler({ processId: 'queue_existing', content: 'go on' }, invocationStub));
        const [input] = sendMessage.mock.calls[0] as unknown as [Record<string, unknown>];
        expect(input).not.toHaveProperty('mode');
    });

    it.each(['ask', 'autopilot'] as const)('passes an explicit post-mode %s through', async mode => {
        const sendMessage = vi.fn(async () => ({ turnIndex: 1 }));
        const { tool } = makeTool({ sendMessage });
        asSuccess(await tool.handler({ processId: 'queue_existing', content: 'go on', mode }, invocationStub));
        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ mode }));
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

describe('createSendToConversationTool — ralph mode (create only)', () => {
    function makeLaunch(result: Awaited<ReturnType<LaunchRalphFn>> = {
        ok: true, processId: 'queue_ralph-task', sessionId: 'ralph-1',
    }) {
        return vi.fn<LaunchRalphFn>(async () => result);
    }

    it('launches with the trimmed goal, caller workspace, and inherited AI selection', async () => {
        const launchRalph = makeLaunch();
        const { tool, enqueueChat } = makeTool({
            launchRalph,
            parentMeta: { provider: 'claude', model: 'claude-opus-5-5', reasoningEffort: 'high' },
        });
        const result = asSuccess(await tool.handler({ content: '  Build the thing  ', mode: 'ralph' }, invocationStub));

        expect(result).toEqual({ processId: 'queue_ralph-task', sessionId: 'ralph-1', openLink: '#/process/queue_ralph-task' });
        expect(enqueueChat).not.toHaveBeenCalled();
        expect(launchRalph).toHaveBeenCalledWith({
            goalSpec: 'Build the thing',
            workspaceId: 'ws-1',
            aiSelection: {
                provider: 'claude',
                config: { model: 'claude-opus-5-5', reasoningEffort: 'high' },
            },
            spawnedFromProcessId: DEFAULT_PARENT_ID,
        });
    });

    it('never requests a worktree or max iterations', async () => {
        const launchRalph = makeLaunch();
        const { tool } = makeTool({ launchRalph });
        await tool.handler({ content: 'goal', mode: 'ralph' }, invocationStub);
        const input = launchRalph.mock.calls[0][0];
        expect(input).not.toHaveProperty('worktree');
        expect(input).not.toHaveProperty('maxIterations');
    });

    it('an explicit provider uses that provider defaults instead of the parent selection', async () => {
        const launchRalph = makeLaunch();
        const { tool } = makeTool({
            launchRalph,
            parentMeta: { provider: 'claude', model: 'claude-opus-5-5', reasoningEffort: 'high' },
        });
        asSuccess(await tool.handler({ content: 'goal', mode: 'ralph', provider: 'copilot' }, invocationStub));
        expect(launchRalph.mock.calls[0][0].aiSelection).toEqual({ provider: 'copilot', config: {} });
    });

    it('launches Auto Ralph with target routing and only explicit overrides', async () => {
        const launchRalph = makeLaunch();
        const { tool } = makeTool({
            launchRalph, storeWorkspaces: ['ws-1', 'ws-2'],
            parentMeta: { provider: 'codex', model: 'gpt-5.5', reasoningEffort: 'high' },
        });
        for (const overrides of [{}, { model: 'opus' }, { effortTier: 'medium' as const }]) {
            asSuccess(await tool.handler({ content: 'goal', mode: 'ralph', provider: 'auto', workspaceId: 'ws-2', ...overrides }, invocationStub));
            expect(launchRalph.mock.lastCall![0]).toMatchObject({
                workspaceId: 'ws-2', spawnedFromProcessId: DEFAULT_PARENT_ID,
                aiSelection: { autoProviderRouting: true, config: overrides },
            });
            expect(launchRalph.mock.lastCall![0].aiSelection).toEqual({ autoProviderRouting: true, config: overrides });
        }
    });

    it('passes an explicit effortTier through the AI selection config', async () => {
        const launchRalph = makeLaunch();
        const { tool } = makeTool({ launchRalph, parentMeta: { provider: 'copilot', model: 'gpt-5', reasoningEffort: 'low' } });
        asSuccess(await tool.handler({ content: 'goal', mode: 'ralph', effortTier: 'high' }, invocationStub));
        expect(launchRalph.mock.calls[0][0].aiSelection).toEqual({ provider: 'copilot', config: { effortTier: 'high' } });
    });

    it('applies a trimmed title as the session custom title', async () => {
        const launchRalph = makeLaunch();
        const { tool } = makeTool({ launchRalph });
        asSuccess(await tool.handler({ content: 'goal', mode: 'ralph', title: '  Ship search  ' }, invocationStub));
        expect(launchRalph.mock.calls[0][0].title).toBe('Ship search');
    });

    it('targets another registered workspace when workspaceId is provided', async () => {
        const launchRalph = makeLaunch();
        const { tool } = makeTool({ launchRalph, storeWorkspaces: ['ws-1', 'ws-2'] });
        asSuccess(await tool.handler({ content: 'goal', mode: 'ralph', workspaceId: 'ws-2' }, invocationStub));
        expect(launchRalph.mock.calls[0][0].workspaceId).toBe('ws-2');
    });

    it('errors on an unknown workspace without launching', async () => {
        const launchRalph = makeLaunch();
        const { tool } = makeTool({ launchRalph });
        const result = await tool.handler({ content: 'goal', mode: 'ralph', workspaceId: 'nope' }, invocationStub);
        expect('error' in result && result.error).toMatch(/unknown workspaceId/i);
        expect(launchRalph).not.toHaveBeenCalled();
    });

    it('errors on blank content without launching', async () => {
        const launchRalph = makeLaunch();
        const { tool } = makeTool({ launchRalph });
        const result = await tool.handler({ content: '   ', mode: 'ralph' }, invocationStub);
        expect('error' in result && result.error).toMatch(/content/i);
        expect(launchRalph).not.toHaveBeenCalled();
    });

    it('rejects ralph in post mode', async () => {
        const launchRalph = makeLaunch();
        const sendMessage = vi.fn<SendMessageFn>(async () => ({ turnIndex: 1 }));
        const { tool } = makeTool({ launchRalph, sendMessage });
        const result = await tool.handler({ content: 'goal', mode: 'ralph', processId: 'queue_other' }, invocationStub);
        expect('error' in result && result.error).toMatch(/only applies when creating a new conversation/i);
        expect(launchRalph).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('is accepted from an Ask-mode caller (no caller-mode gate)', async () => {
        const launchRalph = makeLaunch();
        const { tool } = makeTool({ launchRalph, parentMeta: { provider: 'copilot', mode: 'ask' } });
        asSuccess(await tool.handler({ content: 'goal', mode: 'ralph' }, invocationStub));
        expect(launchRalph).toHaveBeenCalledTimes(1);
    });

    it('surfaces a launch-service error', async () => {
        const launchRalph = makeLaunch({ ok: false, error: 'Invalid reasoningEffort' });
        const { tool } = makeTool({ launchRalph });
        const result = await tool.handler({ content: 'goal', mode: 'ralph' }, invocationStub);
        expect('error' in result && result.error).toBe('Failed to launch Ralph session: Invalid reasoningEffort');
    });

    it('errors when no launch capability is wired', async () => {
        const { tool, enqueueChat } = makeTool();
        const result = await tool.handler({ content: 'goal', mode: 'ralph' }, invocationStub);
        expect('error' in result && result.error).toMatch(/not available/i);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('declares ralph in the mode enum and documents it; plan stays unsupported', () => {
        const { tool } = makeTool();
        const props = (tool.parameters as { properties: Record<string, { enum?: string[] }> }).properties;
        expect(props.mode.enum).toEqual(['autopilot', 'ask', 'ralph']);
        expect(tool.description).toContain('mode: "ralph"');
        expect(tool.description).toContain('`plan` is not supported');
    });
});

describe('createSendToConversationTool — workspace targets (names, remote clone keys)', () => {
    const entries = [
        { id: 'ws-1', name: 'ws-1', type: 'repo', server: 'local', serverKind: 'local', online: true },
        { id: 'ws-api', name: 'api', type: 'repo', server: 'local', serverKind: 'local', online: true },
        { id: 'remote:srv-1:w-api', name: 'api', type: 'repo', server: 'dev-vm', serverKind: 'devtunnel', online: true },
        { id: 'remote:srv-1:w-web', name: 'web', type: 'repo', server: 'dev-vm', serverKind: 'devtunnel', online: true },
        { id: 'remote:srv-2:w-old', name: 'legacy', type: 'repo', server: 'old-box', serverKind: 'url', online: false },
    ];

    function makeDirectory() {
        return {
            list: vi.fn().mockResolvedValue({ entries, servers: [] }),
            startRemoteChat: vi.fn().mockResolvedValue({ processId: 'queue_remote-task' }),
        };
    }

    function makeTargetTool(extra?: Partial<MakeToolOpts>) {
        const directory = makeDirectory();
        const made = makeTool({ storeWorkspaces: ['ws-1', 'ws-api'], runtime: { workspaceDirectory: directory }, ...extra });
        return { ...made, directory };
    }

    it('resolves a unique local repo name to the local workspace', async () => {
        const { tool, captured, directory } = makeTargetTool();
        (directory.list as any).mockResolvedValue({ entries: entries.filter(e => e.id !== 'remote:srv-1:w-api'), servers: [] });

        const result = asSuccess(await tool.handler({ content: 'hi', workspaceId: 'API' }, invocationStub));

        expect(captured.input?.workspaceId ?? payloadOf(captured.input!).workspaceId).toBe('ws-api');
        expect(result.openLink).toBe(`#/process/${result.processId}`);
        expect(directory.startRemoteChat).not.toHaveBeenCalled();
    });

    it('resolves name@server to the remote repo and starts the chat remotely', async () => {
        const { tool, enqueueChat, directory } = makeTargetTool();

        const result = asSuccess(await tool.handler({ content: 'hi', workspaceId: 'api@Dev-VM', title: 'Remote job' }, invocationStub));

        expect(enqueueChat).not.toHaveBeenCalled();
        expect(directory.startRemoteChat).toHaveBeenCalledWith(expect.objectContaining({ serverId: 'srv-1', kind: 'queue' }));
        expect(result).toEqual({
            processId: 'queue_remote-task',
            openLink: `#repos/${encodeURIComponent('remote:srv-1:w-api')}/chats/queue_remote-task`,
        });
    });

    it('rejects an ambiguous name, listing candidate ids and servers', async () => {
        const { tool, enqueueChat } = makeTargetTool();

        const result = await tool.handler({ content: 'hi', workspaceId: 'api' }, invocationStub);

        expect('error' in result && result.error).toMatch(/Ambiguous workspace name 'api'/);
        expect('error' in result && result.error).toContain('ws-api (server: local)');
        expect('error' in result && result.error).toContain('remote:srv-1:w-api (server: dev-vm)');
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('suggests list_workspaces when nothing matches', async () => {
        const { tool } = makeTargetTool();
        const result = await tool.handler({ content: 'hi', workspaceId: 'nope' }, invocationStub);
        expect('error' in result && result.error).toMatch(/Unknown workspaceId: 'nope'.*list_workspaces/);
    });

    it('posts a clone-key target to the remote with the chat body and no inherited provider/model/effort', async () => {
        const { tool, directory } = makeTargetTool({ parentMeta: { provider: 'claude', model: 'opus', reasoningEffort: 'high' } });

        asSuccess(await tool.handler({ content: 'build it', workspaceId: 'remote:srv-1:w-web', mode: 'autopilot', title: 'T' }, invocationStub));

        const request = (directory.startRemoteChat as any).mock.calls[0][0];
        expect(request).toEqual({
            serverId: 'srv-1',
            kind: 'queue',
            body: {
                type: 'chat',
                priority: 'normal',
                workspaceId: 'w-web',
                displayName: 'T',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'build it', workspaceId: 'w-web', customTitle: 'T' },
            },
        });
        // Clone-key targets skip the directory listing entirely.
        expect(directory.list).not.toHaveBeenCalled();
    });

    it.each(['ask', 'autopilot', 'ralph'] as const)('forwards explicit Auto %s to remote routing without parent selections', async mode => {
        const { tool, directory } = makeTargetTool({ parentMeta: { provider: 'codex', model: 'gpt-5.5', reasoningEffort: 'high' } });
        asSuccess(await tool.handler({ content: 'goal', provider: 'auto', mode, workspaceId: 'remote:srv-1:w-web', effortTier: 'medium' }, invocationStub));
        const call = (directory.startRemoteChat as any).mock.calls[0][0];
        expect(call.kind).toBe(mode === 'ralph' ? 'ralph' : 'queue');
        expect(call.body.config).toEqual({ effortTier: 'medium' });
        if (mode === 'ralph') {
            expect(call.body.autoProviderRouting).toBe(true);
            expect(call.body.provider).toBeUndefined();
        } else {
            expect(call.body.payload.context).toEqual({ autoProviderRouting: { requested: true } });
            expect(call.body.payload.provider).toBeUndefined();
            expect(call.body.payload.model).toBeUndefined();
        }
    });

    it('passes an explicit provider with model/effortTier through to the remote', async () => {
        const { tool, directory } = makeTargetTool();

        asSuccess(await tool.handler({ content: 'x', workspaceId: 'remote:srv-1:w-web', provider: 'codex', effortTier: 'high' }, invocationStub));

        const body = (directory.startRemoteChat as any).mock.calls[0][0].body;
        expect(body.payload.provider).toBe('codex');
        expect(body.config).toEqual({ effortTier: 'high' });
    });

    it.each(['ask', 'autopilot', 'ralph'] as const)('forwards explicit Auto model overrides in remote %s without a tier', async mode => {
        const { tool, directory } = makeTargetTool({ parentMeta: { provider: 'codex', model: 'gpt-5.5', reasoningEffort: 'high' } });
        asSuccess(await tool.handler({ content: 'goal', provider: 'auto', model: 'opus', effortTier: 'high', mode, workspaceId: 'remote:srv-1:w-web' }, invocationStub));
        const { body } = (directory.startRemoteChat as any).mock.calls[0][0];
        expect(body.config).toEqual({ model: 'opus' });
        expect(mode === 'ralph' ? body.autoProviderRouting : body.payload.context.autoProviderRouting.requested).toBe(true);
    });

    it('launches remote ralph through the remote Ralph launch API', async () => {
        const { tool, directory } = makeTargetTool();
        (directory.startRemoteChat as any).mockResolvedValue({ processId: 'queue_r1', sessionId: 'ralph-1' });

        const result = asSuccess(await tool.handler({ content: ' goal ', workspaceId: 'web@dev-vm', mode: 'ralph', title: 'G' }, invocationStub));

        expect((directory.startRemoteChat as any).mock.calls[0][0]).toEqual({
            serverId: 'srv-1',
            kind: 'ralph',
            body: { goalSpec: 'goal', workspaceId: 'w-web', config: {}, title: 'G' },
        });
        expect(result.sessionId).toBe('ralph-1');
    });

    it('errors for an offline remote picked by name, with no local fallback', async () => {
        const { tool, enqueueChat, directory } = makeTargetTool();
        const result = await tool.handler({ content: 'x', workspaceId: 'legacy' }, invocationStub);
        expect('error' in result && result.error).toMatch(/Remote server "old-box" is offline/);
        expect(enqueueChat).not.toHaveBeenCalled();
        expect(directory.startRemoteChat).not.toHaveBeenCalled();
    });

    it('surfaces an unreachable remote error from the directory, with no local fallback', async () => {
        const { tool, enqueueChat, directory } = makeTargetTool();
        (directory.startRemoteChat as any).mockRejectedValue(new Error('Remote server "dev-vm" is unreachable: fetch failed. The chat was not started.'));
        const result = await tool.handler({ content: 'x', workspaceId: 'remote:srv-1:w-web' }, invocationStub);
        expect('error' in result && result.error).toMatch(/unreachable/);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('rejects post mode with a remote clone-key processId as not supported yet', async () => {
        const sendMessage = vi.fn();
        const { tool } = makeTargetTool({ sendMessage });
        const result = await tool.handler({ content: 'x', processId: 'remote:srv-1:queue_abc' }, invocationStub);
        expect('error' in result && result.error).toMatch(/not supported yet/);
        expect(sendMessage).not.toHaveBeenCalled();
    });
});

describe('createSendToConversationTool — remote create over HTTP (real directory, mocked fetch)', () => {
    it('POSTs the chat to the remote /api/queue at its effective URL', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ task: { id: 't-9' } }), { status: 201 })) as unknown as typeof fetch;
        const workspaceDirectory = createWorkspaceDirectory({
            store: makeStore([]),
            remoteServers: { list: () => [{ id: 'srv-1', label: 'vm', kind: 'url', url: 'http://vm:4000', effectiveUrl: 'http://vm:4000', status: 'online' } as any] },
            fetchImpl,
        });
        const { tool } = makeTool({ runtime: { workspaceDirectory } });

        const result = asSuccess(await tool.handler({ content: 'hi', workspaceId: 'remote:srv-1:w1' }, invocationStub));

        const [url, init] = (fetchImpl as any).mock.calls[0];
        expect(url).toBe('http://vm:4000/api/queue');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toMatchObject({ type: 'chat', workspaceId: 'w1', payload: { prompt: 'hi', mode: 'ask' } });
        expect(result.processId).toBe('queue_t-9');
    });

    it.each(['ask', 'autopilot', 'ralph'] as const)('POSTs Auto %s and explicit models to the target server API', async mode => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify(
            mode === 'ralph' ? { processId: 'queue_t-9', sessionId: 'r-1' } : { task: { id: 't-9' } },
        ), { status: 201 })) as unknown as typeof fetch;
        const workspaceDirectory = createWorkspaceDirectory({
            store: makeStore([]),
            remoteServers: { list: () => [{ id: 'srv-1', label: 'vm', kind: 'url', effectiveUrl: 'http://vm:4000', status: 'online' } as any] },
            fetchImpl,
        });
        const { tool, enqueueChat } = makeTool({ runtime: { workspaceDirectory } });
        asSuccess(await tool.handler({ content: 'goal', workspaceId: 'remote:srv-1:w1', provider: 'auto', mode, model: 'opus' }, invocationStub));
        const [url, init] = (fetchImpl as any).mock.calls[0];
        expect(url).toBe(`http://vm:4000/api/${mode === 'ralph' ? 'ralph-launch' : 'queue'}`);
        const body = JSON.parse(init.body);
        expect(body.workspaceId).toBe('w1');
        expect(body.config).toEqual({ model: 'opus' });
        expect(mode === 'ralph' ? body.autoProviderRouting : body.payload.context.autoProviderRouting.requested).toBe(true);
        expect(mode === 'ralph' ? body.provider : body.payload.provider).toBeUndefined();
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('reports a remote rejection without falling back locally', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'Unknown workspace' }), { status: 400 })) as unknown as typeof fetch;
        const workspaceDirectory = createWorkspaceDirectory({
            store: makeStore([]),
            remoteServers: { list: () => [{ id: 'srv-1', label: 'vm', kind: 'url', effectiveUrl: 'http://vm:4000', status: 'online' } as any] },
            fetchImpl,
        });
        const { tool, enqueueChat } = makeTool({ runtime: { workspaceDirectory } });

        const result = await tool.handler({ content: 'hi', workspaceId: 'remote:srv-1:w1' }, invocationStub);

        expect('error' in result && result.error).toBe('Remote server "vm" rejected the request: Unknown workspace. The chat was not started.');
        expect(enqueueChat).not.toHaveBeenCalled();
    });
});

describe('createSendToConversationTool — messaging completion notices', () => {
    const origin = { connector: 'whatsapp' as const, chatKey: 'group@g.us' };

    it.each([origin, { connector: 'teams' as const, chatKey: 'channel', threadId: 'dispatcher-root' }])(
        'records a connector turn origin on a local create-mode chat and tracks it (%j)', async origin => {
        const trackMessagingJob = vi.fn();
        const { tool, captured } = makeTool({ runtime: { messagingOrigin: () => origin, trackMessagingJob } });

        const result = asSuccess(await tool.handler({ content: 'build it', mode: 'autopilot' }, invocationStub));

        expect(payloadOf(captured.input!).context).toEqual({ spawnedFromProcessId: DEFAULT_PARENT_ID, messagingOrigin: origin });
        expect(trackMessagingJob).toHaveBeenCalledWith({ processId: result.processId, workspaceId: 'ws-1', origin });
    });

    it('records no origin for a dashboard turn', async () => {
        const trackMessagingJob = vi.fn();
        const { tool, captured } = makeTool({ runtime: { messagingOrigin: () => undefined, trackMessagingJob } });

        await tool.handler({ content: 'build it', mode: 'autopilot' }, invocationStub);

        expect(payloadOf(captured.input!).context).toEqual({ spawnedFromProcessId: DEFAULT_PARENT_ID });
        expect(trackMessagingJob).not.toHaveBeenCalled();
    });

    it('skips remote targets silently and still starts them', async () => {
        const trackMessagingJob = vi.fn();
        const messagingOrigin = vi.fn(() => origin);
        const directory = {
            list: vi.fn().mockResolvedValue({
                entries: [{ id: 'remote:srv-1:w-api', name: 'api', type: 'repo', server: 'dev-vm', serverKind: 'devtunnel', online: true }],
                servers: [],
            }),
            startRemoteChat: vi.fn().mockResolvedValue({ processId: 'queue_remote-task' }),
        };
        const { tool, enqueueChat } = makeTool({ runtime: { workspaceDirectory: directory, messagingOrigin, trackMessagingJob } });

        const result = asSuccess(await tool.handler({ content: 'hi', workspaceId: 'remote:srv-1:w-api' }, invocationStub));

        expect(result.processId).toBe('queue_remote-task');
        expect(enqueueChat).not.toHaveBeenCalled();
        expect(JSON.stringify(directory.startRemoteChat.mock.calls[0][0])).not.toContain('messagingOrigin');
        expect(trackMessagingJob).not.toHaveBeenCalled();
    });
});
