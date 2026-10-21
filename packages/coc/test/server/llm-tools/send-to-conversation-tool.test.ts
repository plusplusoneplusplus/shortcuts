/**
 * Unit tests for createSendToConversationTool — the dual-mode tool selected by
 * whether a `processId` is supplied:
 *   - create mode (no processId): defaults, explicit mode, validation errors,
 *     workspace defaulting, parent provider/model/effort inheritance, spawn link,
 *     and the `{ processId, openLink }` result shape.
 *   - post mode (processId): delivers `content` into the existing conversation
 *     via the injected `sendMessage` capability, returns `turnIndex`, and ignores
 *     unrelated create-only fields; tracked item identities cannot use post mode.
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
        getProcess: vi.fn(async (id: string) => (processes[id] ? { ...processes[id], metadata: { workspaceId: workspaceIds[0], ...processes[id].metadata } } : undefined) as never),
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
        queue_existing: { id: 'queue_existing', metadata: {} },
        queue_target: { id: 'queue_target', metadata: {} },
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
        runtime: { serverIdentity: 'local-installation', isAutoProviderRoutingAvailable: () => true, ...opts?.runtime },
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
    it('rejects an explicit tracked item when admission is disabled instead of ordinary launch fallback', async () => {
        const { tool, enqueueChat } = makeTool();
        expect(await tool.handler({ content: 'Run saved work', todoItemId: 'historical-item' }, invocationStub)).toMatchObject({
            code: 'untracked', error: expect.stringContaining('no ordinary launch fallback'),
        });
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('rejects tracked item post-mode dispatch into an otherwise ordinary conversation', async () => {
        const sendMessage = vi.fn();
        const { tool } = makeTool({ sendMessage, extraProcesses: { existing: { id: 'existing', metadata: { mode: 'ask' } } } });
        expect(await tool.handler({ content: 'Run saved work', todoItemId: 'historical-item', processId: 'existing' }, invocationStub)).toMatchObject({
            code: 'untracked', error: expect.stringContaining('cannot use post mode'),
        });
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('requires content for send or processId for explicit cancel', () => {
        const { tool } = makeTool();
        expect(tool.name).toBe('send_to_conversation');
        expect(typeof tool.handler).toBe('function');
        expect(tool.parameters).toMatchObject({
            type: 'object',
            anyOf: [
                { properties: { action: { const: 'cancel' } }, required: ['action', 'processId'] },
                { properties: { action: { enum: ['send'] } }, required: ['content'] },
            ],
        });
    });

    it('declares the dual-mode parameter set with provider and effortTier metadata', () => {
        const { tool } = makeTool();
        const props = (tool.parameters as { properties: Record<string, unknown> }).properties;
        expect(Object.keys(props).sort()).toEqual(
            ['action', 'content', 'deliveryMode', 'effortTier', 'entryPoint', 'mode', 'model', 'priority', 'processId', 'provider', 'title', 'workspaceId'].sort(),
        );
        expect(props.provider).toMatchObject({ type: 'string', enum: ['auto', 'copilot', 'codex', 'claude', 'opencode'] });
        expect(props.effortTier).toMatchObject({ type: 'string', enum: ['very-low', 'low', 'medium', 'high'] });
        expect(props.effortTier).toMatchObject({
            description: expect.stringContaining('New-chat default: medium'),
        });
    });

    // AC-05: description leads with the processId (post) branch before the create branch.
    it('description disambiguates modes (processId branch first)', () => {
        const { tool } = makeTool();
        const desc = tool.description ?? '';
        expect(desc).toMatch(/processId/);
        expect(desc).toContain('without it, create a separate fire-and-forget chat');
        expect(desc.indexOf('With `processId`')).toBeLessThan(desc.indexOf('without it'));
    });

    it('documents persistent task-specific titles without making them required', () => {
        const { tool } = makeTool();
        expect(tool.parameters).not.toHaveProperty('required');
        expect(tool.description).toContain('short, task-specific `title`');
        expect(tool.parameters).toMatchObject({
            properties: {
                title: {
                    type: 'string',
                    description: expect.stringContaining('persistent title'),
                },
            },
        });
        const props = (tool.parameters as { properties: Record<string, { description?: string }> }).properties;
        expect(props.title.description).toContain('trimmed, non-empty, max 80 characters');
        expect(props.title.description).toContain('ignored in post mode');
    });

    it('keeps tool and parameter descriptions concise with key defaults and boundaries', () => {
        const { tool } = makeTool();
        expect(tool.description!.length).toBeLessThan(900);
        const props = (tool.parameters as { properties: Record<string, { description: string }> }).properties;
        expect(props.content.description).toBe(
            'Message or Ralph goal. Required for send; omit for cancel. ' +
            'Use concise Markdown: Task, Context, Deliverable, Constraints; omit unnecessary headings. ' +
            'Request reports as Outcome, Findings, Evidence, Gaps.',
        );
        for (const [name, property] of Object.entries(props)) {
            if (name !== 'content') expect(property.description.length).toBeLessThan(200);
        }
        expect(props.effortTier.description).toContain('No post default');
        expect(props.effortTier.description).toContain('Explicit model wins');
        expect(props.provider.description).toContain('destination routing without parent settings');
        expect(props.workspaceId.description).toContain('remote:<serverId>:<workspaceId>');
        expect(tool.description).toContain('Omit send-only fields');
        expect(tool.description).toContain('retaining history');
    });
});

describe('createSendToConversationTool — cancel dispatch', () => {
    it('cancels without content, enqueueing, posting, or launching Ralph', async () => {
        const cancelConversation = vi.fn().mockResolvedValue({
            processId: 'queue_target', workspaceId: 'ws-2', cancelled: true, status: 'cancelled',
        });
        const sendMessage = vi.fn();
        const launchRalph = vi.fn();
        const { tool, enqueueChat } = makeTool({ sendMessage, launchRalph, runtime: { cancelConversation } });
        expect(await tool.handler({ action: 'cancel', processId: ' queue_target ', workspaceId: 'ws-2' }, invocationStub)).toEqual({
            processId: 'queue_target', workspaceId: 'ws-2', cancelled: true, status: 'cancelled',
            openLink: '#chat-references/local-installation/ws-2/queue_target',
        });
        expect(cancelConversation).toHaveBeenCalledWith('queue_target', 'ws-2');
        expect(enqueueChat).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
        expect(launchRalph).not.toHaveBeenCalled();
    });

    it.each([undefined, '', '  ', 42])('rejects missing/invalid processId %j', async processId => {
        const cancelConversation = vi.fn();
        const { tool, enqueueChat } = makeTool({ runtime: { cancelConversation } });
        expect(await tool.handler({ action: 'cancel', processId: processId as never }, invocationStub)).toMatchObject({ error: expect.stringContaining('processId') });
        expect(cancelConversation).not.toHaveBeenCalled();
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it.each([
        { processId: 'remote:server:queue_target' },
        { processId: 'queue_target', workspaceId: 'remote:server:ws-1' },
        { processId: 'queue_target', workspaceId: 'repo@server' },
        { processId: 'queue_target', workspaceId: 42 },
    ])('rejects unsupported routes before dispatch: %j', async fields => {
        const cancelConversation = vi.fn();
        const { tool } = makeTool({ runtime: { cancelConversation } });
        expect(await tool.handler({ action: 'cancel', ...fields } as never, invocationStub)).toHaveProperty('error');
        expect(cancelConversation).not.toHaveBeenCalled();
    });

    it.each(['content', 'mode', 'deliveryMode', 'title', 'model', 'provider', 'effortTier', 'priority'])('rejects send-only %s for cancellation', async field => {
        const cancelConversation = vi.fn();
        const { tool } = makeTool({ runtime: { cancelConversation } });
        expect(await tool.handler({ action: 'cancel', processId: 'queue_target', [field]: 'dummy' }, invocationStub)).toHaveProperty('error');
        expect(cancelConversation).not.toHaveBeenCalled();
    });

    it('reports an unavailable capability and dispatch errors without success fields', async () => {
        const { tool } = makeTool();
        expect(await tool.handler({ action: 'cancel', processId: 'target' }, invocationStub)).toMatchObject({ error: expect.stringContaining('not available') });
        const cancelConversation = vi.fn().mockRejectedValue(new Error('abort failed'));
        const wired = makeTool({ runtime: { cancelConversation } });
        expect(await wired.tool.handler({ action: 'cancel', processId: 'target' }, invocationStub)).toEqual({ error: 'Failed to cancel conversation: abort failed' });
    });

    it('returns terminal no-op status distinctly', async () => {
        const cancelConversation = vi.fn().mockResolvedValue({ processId: 'target', cancelled: false, status: 'completed' });
        const { tool } = makeTool({ runtime: { cancelConversation } });
        expect(await tool.handler({ action: 'cancel', processId: 'target' }, invocationStub)).toEqual({
            processId: 'target', cancelled: false, status: 'completed',
        });
    });

    it('rejects unknown actions instead of creating a conversation', async () => {
        const { tool, enqueueChat } = makeTool();
        expect(await tool.handler({ action: 'delete' as never, content: 'hello' }, invocationStub)).toHaveProperty('error');
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('preserves explicit send creation and posting', async () => {
        const sendMessage = vi.fn().mockResolvedValue({ turnIndex: 2 });
        const cancelConversation = vi.fn();
        const { tool, enqueueChat } = makeTool({ sendMessage, runtime: { cancelConversation } });
        asSuccess(await tool.handler({ action: 'send', content: 'create' }, invocationStub));
        asSuccess(await tool.handler({ action: 'send', processId: 'queue_target', content: 'post' }, invocationStub));
        expect(enqueueChat).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(cancelConversation).not.toHaveBeenCalled();
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
        expect(result.openLink).toBe('#chat-references/local-installation/ws-1/queue_task-123');
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
        expect(captured.input!.config?.effortTier).toBeUndefined();
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
            runtime: { serverIdentity: 'local-installation' },
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
        expect(captured.input!.config?.effortTier).toBe('medium');
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

    it('inherits only the provider and defaults to Medium for { content } only', async () => {
        const { tool, captured } = makeTool({
            parentMeta: { provider: 'claude', model: 'claude-sonnet-4-6', reasoningEffort: 'high' },
        });
        await tool.handler({ content: 'spawned' }, invocationStub);
        const payload = payloadOf(captured.input!);
        expect(payload.provider).toBe('claude');
        expect(captured.input!.config?.effortTier).toBe('medium');
        expect(captured.input!.config?.model).toBeUndefined();
        expect(captured.input!.config?.reasoningEffort).toBeUndefined();
    });

    it.each(['copilot', 'codex', 'claude', 'opencode'] as const)(
        'defaults an explicit %s provider to Medium without inheriting model or effort',
        async provider => {
            const { tool, captured } = makeTool({
                parentMeta: { provider: 'copilot', model: 'gpt-5', reasoningEffort: 'high' },
            });
            asSuccess(await tool.handler({ content: 'work', provider }, invocationStub));
            expect(payloadOf(captured.input!).provider).toBe(provider);
            expect(captured.input!.config?.effortTier).toBe('medium');
            expect(captured.input!.config?.model).toBeUndefined();
            expect(captured.input!.config?.reasoningEffort).toBeUndefined();
        },
    );

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
            runtime: { serverIdentity: 'local-installation' },
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

    it('reasoningEffort is inherited with an explicit model but not exposed as a raw schema param', async () => {
        const { tool, captured } = makeTool({
            parentMeta: { provider: 'claude', model: 'claude-opus-4-8', reasoningEffort: 'xhigh' },
        });
        await tool.handler({ content: 'hi', model: 'opus' }, invocationStub);
        expect(captured.input!.config?.reasoningEffort).toBe('xhigh');

        const props = (tool.parameters as { properties: Record<string, unknown> }).properties;
        expect(props.reasoningEffort).toBeUndefined();
        expect(props.provider).toBeDefined();
    });

    it('defaults to Medium when parent has provider but no model', async () => {
        const { tool, enqueueChat, captured } = makeTool({ parentMeta: { provider: 'claude' } });
        const result = await tool.handler({ content: 'hi' }, invocationStub);
        expect('error' in result).toBe(false);
        expect(enqueueChat).toHaveBeenCalledTimes(1);
        expect(payloadOf(captured.input!).provider).toBe('claude');
        expect(captured.input!.config?.model).toBeUndefined();
        expect(captured.input!.config?.effortTier).toBe('medium');
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

    it('inherits the provider with default Medium when targeting a different workspace', async () => {
        const { tool, captured } = makeTool({
            workspaceId: 'ws-1',
            storeWorkspaces: ['ws-1', 'ws-2'],
            parentMeta: { provider: 'claude', model: 'claude-opus-4-8', reasoningEffort: 'high' },
        });
        await tool.handler({ content: 'hi', workspaceId: 'ws-2' }, invocationStub);
        const payload = payloadOf(captured.input!);
        expect(payload.workspaceId).toBe('ws-2');
        expect(payload.provider).toBe('claude');
        expect(captured.input!.config?.effortTier).toBe('medium');
        expect(captured.input!.config?.model).toBeUndefined();
        expect(captured.input!.config?.reasoningEffort).toBeUndefined();
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
            runtime: { serverIdentity: 'local-installation' },
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
        expect(result.openLink).toBe('#chat-references/local-installation/ws-1/queue_existing');
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
            parentProcessId: DEFAULT_PARENT_ID,
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
        const result = await tool.handler({ processId: 'queue_existing', content: 'hi' }, invocationStub);
        expect('error' in result && result.error).toMatch(/process not found/i);
    });
});

describe('createSendToConversationTool — ralph mode (create only)', () => {
    function makeLaunch(result: Awaited<ReturnType<LaunchRalphFn>> = {
        ok: true, processId: 'queue_ralph-task', sessionId: 'ralph-1',
    }) {
        return vi.fn<LaunchRalphFn>(async () => result);
    }

    it('launches with the trimmed goal, caller workspace, inherited provider, and default Medium', async () => {
        const launchRalph = makeLaunch();
        const { tool, enqueueChat } = makeTool({
            launchRalph,
            parentMeta: { provider: 'claude', model: 'claude-opus-5-5', reasoningEffort: 'high' },
        });
        const result = asSuccess(await tool.handler({ content: '  Build the thing  ', mode: 'ralph' }, invocationStub));

        expect(result).toEqual({ processId: 'queue_ralph-task', sessionId: 'ralph-1', openLink: '#chat-references/local-installation/ws-1/queue_ralph-task' });
        expect(enqueueChat).not.toHaveBeenCalled();
        expect(launchRalph).toHaveBeenCalledWith({
            goalSpec: 'Build the thing',
            workspaceId: 'ws-1',
            aiSelection: {
                provider: 'claude',
                config: { effortTier: 'medium' },
            },
            spawnedFromProcessId: DEFAULT_PARENT_ID,
        });
    });

    it.each([
        { connector: 'whatsapp' as const, chatKey: 'original-group' },
        { connector: 'teams' as const, chatKey: 'original-channel', threadId: 'original-thread' },
    ])('captures local Ralph routing without tracking iteration notices (%j)', async origin => {
        const launchRalph = makeLaunch();
        const trackMessagingJob = vi.fn();
        const { tool } = makeTool({ launchRalph, storeWorkspaces: ['ws-1', 'ws-2'], runtime: { messagingOrigin: () => origin, trackMessagingJob } });
        asSuccess(await tool.handler({ content: 'goal', mode: 'ralph', workspaceId: 'ws-2' }, invocationStub));
        expect(launchRalph.mock.calls[0][0]).toMatchObject({ workspaceId: 'ws-2', messagingOrigin: origin });
        expect(trackMessagingJob).not.toHaveBeenCalled();
    });

    it('captures Ralph routing independently of ordinary notice tracking', async () => {
        const launchRalph = makeLaunch();
        const origin = { connector: 'teams' as const, chatKey: 'channel', threadId: 'thread' };
        const { tool } = makeTool({ launchRalph, runtime: { messagingOrigin: () => origin } });
        asSuccess(await tool.handler({ content: 'goal', mode: 'ralph' }, invocationStub));
        expect(launchRalph.mock.calls[0][0].messagingOrigin).toEqual(origin);
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
        expect(launchRalph.mock.calls[0][0].aiSelection).toEqual({ provider: 'copilot', config: { effortTier: 'medium' } });
    });

    it('launches Auto Ralph with target routing, default Medium, and explicit overrides', async () => {
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
            expect(launchRalph.mock.lastCall![0].aiSelection).toEqual({
                autoProviderRouting: true,
                config: 'model' in overrides ? overrides : { effortTier: 'medium', ...overrides },
            });
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
            isRemoteAutoProviderRoutingAvailable: vi.fn().mockResolvedValue(true),
            validateRemoteProvider: vi.fn(),
            startRemoteChat: vi.fn().mockResolvedValue({ serverIdentity: 'remote-installation', processId: 'queue_remote-task' }),
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
        expect(result.openLink).toBe(`#chat-references/local-installation/ws-api/${result.processId}`);
        expect(directory.startRemoteChat).not.toHaveBeenCalled();
        expect(result.resultDelivery).toBeUndefined();
    });

    it('resolves name@server to the remote repo and starts the chat remotely', async () => {
        const { tool, enqueueChat, directory } = makeTargetTool();

        const result = asSuccess(await tool.handler({ content: 'hi', workspaceId: 'api@Dev-VM', title: 'Remote job' }, invocationStub));

        expect(enqueueChat).not.toHaveBeenCalled();
        expect(directory.startRemoteChat).toHaveBeenCalledWith(expect.objectContaining({ serverId: 'srv-1', kind: 'queue' }));
        expect(result).toMatchObject({
            processId: 'queue_remote-task',
            openLink: '#chat-references/remote-installation/w-api/queue_remote-task',
        });
    });

    it.each(['ask', 'autopilot', 'ralph'] as const)(
        'reports unavailable remote result return from a Sentinel for %s without duplicate admission', async mode => {
            const trackMessagingJob = vi.fn();
            const directory = makeDirectory();
            directory.startRemoteChat.mockResolvedValue({ serverIdentity: 'remote-installation', processId: 'queue_remote-task', sessionId: 'ralph-1' } as any);
            const { tool, enqueueChat } = makeTool({
                parentMeta: { provider: 'codex', mode: 'sentinel' } as ParentMeta & { mode?: string },
                runtime: { workspaceDirectory: directory,
                    messagingOrigin: () => ({ connector: 'teams', chatKey: 'channel', threadId: 'original-topic' }),
                    trackMessagingJob },
            });
            const result = asSuccess(await tool.handler({ content: 'goal', workspaceId: 'web@dev-vm', mode }, invocationStub));
            expect(tool.description).toContain('Do not promise an automatic return or start a duplicate job');
            expect(result.resultDelivery?.status).toBe('unavailable');
            expect(result.resultDelivery?.reason).toMatch(/remote job was started.*automatic result return.*unavailable/);
            expect(result.resultDelivery?.reason).toContain('WhatsApp/Teams');
            expect(result.resultDelivery?.reason).toContain('openLink');
            expect(result.resultDelivery?.reason).toContain('do not launch a duplicate');
            expect(result.openLink).toBe('#chat-references/remote-installation/w-web/queue_remote-task');
            expect(directory.startRemoteChat).toHaveBeenCalledTimes(1);
            expect(enqueueChat).not.toHaveBeenCalled();
            expect(trackMessagingJob).not.toHaveBeenCalled();
            const body = directory.startRemoteChat.mock.calls[0][0].body as any;
            expect(body.spawnedFromProcessId ?? body.payload?.context?.spawnedFromProcessId).toBeUndefined();
            expect(body.messagingOrigin ?? body.payload?.context?.messagingOrigin).toBeUndefined();
            if (mode === 'ralph') expect(result.sessionId).toBe('ralph-1');
        },
    );

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
                config: { effortTier: 'medium' },
            },
        });
        // Clone-key targets skip the directory listing entirely.
        expect(directory.list).not.toHaveBeenCalled();
    });

    it.each(['ask', 'autopilot', 'ralph'] as const)('forwards default Medium and Auto %s to remote routing without parent selections', async mode => {
        const { tool, directory } = makeTargetTool({ parentMeta: { provider: 'codex', model: 'gpt-5.5', reasoningEffort: 'high' } });
        asSuccess(await tool.handler({ content: 'goal', provider: 'auto', mode, workspaceId: 'remote:srv-1:w-web' }, invocationStub));
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
        (directory.startRemoteChat as any).mockResolvedValue({ serverIdentity: 'remote-installation', processId: 'queue_r1', sessionId: 'ralph-1' });

        const result = asSuccess(await tool.handler({ content: ' goal ', workspaceId: 'web@dev-vm', mode: 'ralph', title: 'G' }, invocationStub));

        expect((directory.startRemoteChat as any).mock.calls[0][0]).toEqual({
            serverId: 'srv-1',
            kind: 'ralph',
            body: { goalSpec: 'goal', workspaceId: 'w-web', config: { effortTier: 'medium' }, title: 'G' },
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

    it('fails without local fallback when the directory has no remote post capability', async () => {
        const sendMessage = vi.fn();
        const { tool, enqueueChat } = makeTargetTool({ sendMessage });
        const result = await tool.handler({ content: 'x', processId: 'queue_target', workspaceId: 'remote:srv-1:w-api' }, invocationStub);
        expect(result).toMatchObject({ dispatchState: 'not-started', error: expect.stringContaining('transport is unavailable') });
        expect(sendMessage).not.toHaveBeenCalled();
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('requires explicit remote workspace ownership instead of a remote-prefixed processId', async () => {
        const sendMessage = vi.fn();
        const { tool } = makeTargetTool({ sendMessage });
        const result = await tool.handler({ content: 'x', processId: 'remote:srv-1:queue_abc' }, invocationStub);
        expect('error' in result && result.error).toMatch(/exact remote processId/);
        expect(sendMessage).not.toHaveBeenCalled();
    });
});

describe('createSendToConversationTool — remote create over HTTP (real directory, mocked fetch)', () => {
    it('POSTs the chat to the remote /api/queue at its effective URL', async () => {
        const fetchImpl = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/api/health') ? { serverIdentity: 'remote-installation' } : { task: { id: 't-9' } }), { status: 201 })) as unknown as typeof fetch;
        const workspaceDirectory = createWorkspaceDirectory({
            store: makeStore([]),
            remoteServers: { list: () => [{ id: 'srv-1', label: 'vm', kind: 'url', url: 'http://vm:4000', effectiveUrl: 'http://vm:4000', status: 'online' } as any] },
            fetchImpl,
        });
        const { tool } = makeTool({ runtime: { workspaceDirectory } });

        const result = asSuccess(await tool.handler({ content: 'hi', workspaceId: 'remote:srv-1:w1' }, invocationStub));

        const [url, init] = (fetchImpl as any).mock.calls.find(([, init]: any) => init?.method === 'POST');
        expect(url).toBe('http://vm:4000/api/queue');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toMatchObject({ type: 'chat', workspaceId: 'w1', payload: { prompt: 'hi', mode: 'ask' } });
        expect(result.processId).toBe('queue_t-9');
        expect(result.resultDelivery?.status).toBe('unavailable');
    });

    it.each(['ask', 'autopilot', 'ralph'] as const)('POSTs Auto %s and explicit models to the target server API', async mode => {
        const fetchImpl = vi.fn(async (url: string) => new Response(JSON.stringify(
            url.endsWith('/api/health') ? { serverIdentity: 'remote-installation' } : url.endsWith('/api/config/runtime') ? { features: { autoAgentProviderRoutingEnabled: true } } : mode === 'ralph' ? { processId: 'queue_t-9', sessionId: 'r-1' } : { task: { id: 't-9' } },
        ), { status: 201 })) as unknown as typeof fetch;
        const workspaceDirectory = createWorkspaceDirectory({
            store: makeStore([]),
            remoteServers: { list: () => [{ id: 'srv-1', label: 'vm', kind: 'url', effectiveUrl: 'http://vm:4000', status: 'online' } as any] },
            fetchImpl,
        });
        const { tool, enqueueChat } = makeTool({ runtime: { workspaceDirectory } });
        const result = asSuccess(await tool.handler({ content: 'goal', workspaceId: 'remote:srv-1:w1', provider: 'auto', mode, model: 'opus' }, invocationStub));
        expect(result.resultDelivery?.status).toBe('unavailable');
        const [url, init] = (fetchImpl as any).mock.calls.find(([, init]: any) => init?.method === 'POST');
        expect(url).toBe(`http://vm:4000/api/${mode === 'ralph' ? 'ralph-launch' : 'queue'}`);
        const body = JSON.parse(init.body);
        expect(body.workspaceId).toBe('w1');
        expect(body.config).toEqual({ model: 'opus' });
        expect(mode === 'ralph' ? body.autoProviderRouting : body.payload.context.autoProviderRouting.requested).toBe(true);
        expect(mode === 'ralph' ? body.provider : body.payload.provider).toBeUndefined();
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('reports a remote rejection without falling back locally', async () => {
        const fetchImpl = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/api/health') ? { serverIdentity: 'remote-installation' } : { error: 'Unknown workspace' }), { status: url.endsWith('/api/health') ? 200 : 400 })) as unknown as typeof fetch;
        const workspaceDirectory = createWorkspaceDirectory({
            store: makeStore([]),
            remoteServers: { list: () => [{ id: 'srv-1', label: 'vm', kind: 'url', effectiveUrl: 'http://vm:4000', status: 'online' } as any] },
            fetchImpl,
        });
        const { tool, enqueueChat } = makeTool({ runtime: { workspaceDirectory } });

        const result = await tool.handler({ content: 'hi', workspaceId: 'remote:srv-1:w1' }, invocationStub);

        expect(result).toEqual({ error: 'Remote server "vm" rejected the request (HTTP 400). The chat was not started.', dispatchState: 'rejected' });
        expect(enqueueChat).not.toHaveBeenCalled();
    });
});

describe('remote follow-up transport (real directory, isolated HTTP fixtures)', () => {
    it('reports unsupported result return without hiding a successful untracked remote launch', async () => {
        const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => Response.json(
            url.endsWith('/api/health') ? { serverIdentity: 'destination-owner' } : { task: { id: 'admitted' } }));
        const dispatch = vi.fn(async () => ({ unavailable: {
            status: 'unavailable' as const, code: 'unsupported' as const, reason: 'Authenticated remote results are unsupported.',
        } }));
        const directory = createWorkspaceDirectory({ store: makeStore(),
            remoteServers: { list: () => [{ id: 'alias', kind: 'url', url: 'http://fixture.test', effectiveUrl: 'http://fixture.test',
                serverIdentity: 'destination-owner', status: 'online', addedAt: 1, updatedAt: 1 }] },
            fetchImpl: fetchImpl as typeof fetch, remoteResults: { dispatch } });
        const { tool, enqueueChat } = makeTool({ runtime: { workspaceDirectory: directory, getRemoteResultsEnabled: () => true } });
        const result = asSuccess(await tool.handler({ content: 'Inspect', workspaceId: 'remote:alias:ws-1' }, invocationStub));
        expect(result).toMatchObject({ processId: 'queue_admitted', resultDelivery: { status: 'unavailable', code: 'unsupported' } });
        expect(fetchImpl.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('routes a valid remote raw ID before local lookup, including colliding workspace/process IDs', async () => {
        const postRemoteChat = vi.fn(async () => ({ serverIdentity: 'remote-owner', processId: 'queue_target', turnIndex: 2,
            resultDelivery: { status: 'tracked' as const, jobId: 'remote-request' } }));
        const store = makeStore(['ws-1']);
        vi.mocked(store.getProcess).mockRejectedValue(new Error('Chat not found on origin'));
        const sendMessage = vi.fn();
        const enqueueChat = vi.fn();
        const { tool } = createSendToConversationTool({ store, workspaceId: 'ws-1', parentProcessId: DEFAULT_PARENT_ID,
            enqueueChat, sendMessage, runtime: { serverIdentity: 'origin-owner', getRemoteResultsEnabled: () => true,
                workspaceDirectory: { list: vi.fn(), listRemoteChats: vi.fn(), startRemoteChat: vi.fn(), postRemoteChat } } });
        const result = asSuccess(await tool.handler({ content: 'Follow up', processId: 'queue_target',
            workspaceId: 'remote:alias:ws-1' }, invocationStub));
        expect(result).toMatchObject({ openLink: '#chat-references/remote-owner/ws-1/queue_target', resultDelivery: { status: 'tracked' } });
        expect(postRemoteChat).toHaveBeenCalledWith(expect.objectContaining({
            serverId: 'alias', workspaceId: 'ws-1', processId: 'queue_target',
            resultOrigin: expect.objectContaining({ parent: { workspaceId: 'ws-1', processId: DEFAULT_PARENT_ID } }),
        }));
        expect(store.getProcess).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it.each(['queue', 'ralph'] as const)('uses compatible tracked %s admission once with private origin context outside the execution intent', async kind => {
        const dispatch = vi.fn(async () => ({ serverIdentity: 'destination-owner', processId: 'queue_remote',
            turnIndex: -1, resultDelivery: { status: 'tracked' as const, jobId: 'remote-job' } }));
        const fetchImpl = vi.fn(async () => Response.json({ serverIdentity: 'destination-owner' }));
        const directory = createWorkspaceDirectory({ store: makeStore(),
            remoteServers: { list: () => [{ id: 'alias', label: 'Remote', kind: 'url', effectiveUrl: 'http://fixture.test',
                url: 'http://fixture.test', serverIdentity: 'destination-owner', status: 'online', addedAt: 1, updatedAt: 1 }] },
            fetchImpl: fetchImpl as typeof fetch, remoteResults: { dispatch } });
        const result = await directory.startRemoteChat({ serverId: 'alias', kind,
            body: kind === 'ralph' ? { workspaceId: 'ws-1', goalSpec: 'Goal', provider: 'copilot', config: { effortTier: 'medium' } }
                : { type: 'chat', workspaceId: 'ws-1', priority: 'normal', payload: { kind: 'chat', workspaceId: 'ws-1', prompt: 'Goal', mode: 'ask' }, config: {} },
            resultOrigin: { parent: { workspaceId: 'ws-1', processId: DEFAULT_PARENT_ID }, title: 'Remote task',
                messagingOrigin: { connector: 'teams', chatKey: 'origin-chat' } } });
        expect(result.resultDelivery).toEqual({ status: 'tracked', jobId: 'remote-job' });
        expect(dispatch).toHaveBeenCalledOnce();
        expect(dispatch.mock.calls[0][1]).toMatchObject({ version: 1, workspaceId: 'ws-1', kind: kind === 'queue' ? 'launch' : 'ralph' });
        expect(JSON.stringify(dispatch.mock.calls[0][1])).not.toContain('messagingOrigin');
        expect(fetchImpl.mock.calls.every(([, init]) => !init || init.method !== 'POST')).toBe(true);
    });

    function fixture(options: {
        remote?: boolean; knownIdentity?: string; startTimeoutMs?: number;
        detail?: (proc: any) => unknown;
        tiers?: unknown;
        respond?: (url: string, init: RequestInit | undefined, next: () => Response) => Promise<Response>;
    } = {}) {
        const server = { id: 'alias', label: 'remote', kind: 'url', effectiveUrl: 'http://private-destination:4000',
            serverIdentity: options.knownIdentity ?? 'destination-owner' } as any;
        const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
            const next = () => {
                if (url.endsWith('/api/health')) return Response.json({ serverIdentity: 'destination-owner' });
                if (url.includes('/effort-tiers')) return Response.json(options.tiers ?? { provider: 'codex', effortTiers: {
                    high: { model: 'gpt-5.5', reasoningEffort: 'xhigh' },
                } });
                if (init?.method === 'POST') return Response.json({ processId: 'queue_target', turnIndex: 7 }, { status: 202 });
                const proc = { id: 'queue_target', type: 'chat', metadata: { workspaceId: 'ws-1', provider: 'copilot', mode: 'ask' },
                    activeProviderSession: { provider: 'codex', segmentId: 'segment', firstTurnIndex: 0 } };
                return Response.json({ process: options.detail ? options.detail(proc) : proc });
            };
            return options.respond ? options.respond(url, init, next) : next();
        });
        const store = makeStore(['ws-1'], { queue_target: { id: 'queue_target' } });
        const workspaceDirectory = createWorkspaceDirectory({ store,
            remoteServers: { list: () => options.remote === false ? [] : [server] },
            fetchImpl: fetchImpl as typeof fetch, startTimeoutMs: options.startTimeoutMs });
        const sendMessage = vi.fn();
        const getEffortTiersForProvider = vi.fn(() => { throw new Error('Origin tiers must not be used'); });
        const messagingOrigin = vi.fn(() => ({ connector: 'teams' as const, chatKey: 'private-origin', threadId: 'thread' }));
        const { tool, enqueueChat } = makeTool({ sendMessage, runtime: {
            workspaceDirectory, getEffortTiersForProvider, messagingOrigin,
        } });
        const call = (args: Record<string, unknown> = {}) => tool.handler({ content: 'Continue authorized work',
            processId: 'queue_target', workspaceId: 'remote:alias:ws-1', ...args }, invocationStub);
        const posts = () => fetchImpl.mock.calls.filter(([, init]) => init?.method === 'POST');
        const assertNoLocal = () => {
            expect(sendMessage).not.toHaveBeenCalled();
            expect(enqueueChat).not.toHaveBeenCalled();
            expect(getEffortTiersForProvider).not.toHaveBeenCalled();
            expect(messagingOrigin).not.toHaveBeenCalled();
        };
        return { server, fetchImpl, store, call, posts, assertNoLocal };
    }

    it.each(['enqueue', 'immediate', 'steer', undefined] as const)('posts one owner-scoped %s follow-up without local/connector leakage', async deliveryMode => {
        const h = fixture();
        const result = asSuccess(await h.call({ deliveryMode, provider: 'claude', title: 'Ignored', priority: 'high' }));
        expect(result).toMatchObject({ processId: 'queue_target', turnIndex: 7,
            openLink: '#chat-references/destination-owner/ws-1/queue_target', resultDelivery: { status: 'unavailable' } });
        expect(result.resultDelivery).toHaveProperty('reason', expect.stringContaining('do not send a duplicate follow-up'));
        expect(h.posts()).toHaveLength(1);
        const [url, init] = h.posts()[0];
        expect(url).toBe('http://private-destination:4000/api/processes/queue_target/message?workspace=ws-1');
        expect(JSON.parse(init!.body as string)).toEqual({ content: 'Continue authorized work',
            deliveryMode: deliveryMode === 'steer' ? 'immediate' : deliveryMode ?? 'enqueue' });
        expect(h.fetchImpl.mock.calls.map(([url]) => url)).toContain(
            'http://private-destination:4000/api/processes/queue_target?workspace=ws-1&exclude=conversation%2CtoolCalls');
        expect(h.store.getProcess).not.toHaveBeenCalled();
        h.assertNoLocal();
    });

    it('trims the explicit remote clone key before choosing transport', async () => {
        const h = fixture();
        asSuccess(await h.call({ workspaceId: '  remote:alias:ws-1  ' }));
        expect(h.posts()).toHaveLength(1);
        h.assertNoLocal();
    });

    it('resolves effort against the destination active binding and configured tiers', async () => {
        const h = fixture();
        asSuccess(await h.call({ effortTier: 'high', mode: 'autopilot', provider: 'claude' }));
        expect(h.fetchImpl.mock.calls.map(([url]) => url)).toContain('http://private-destination:4000/api/agent-providers/codex/effort-tiers');
        expect(JSON.parse(h.posts()[0][1]!.body as string)).toEqual({ content: 'Continue authorized work', mode: 'autopilot',
            model: 'gpt-5.5', reasoningEffort: 'xhigh', deliveryMode: 'enqueue' });
        h.assertNoLocal();
    });

    it('lets an explicit model win over a tier without inheriting origin effort', async () => {
        const h = fixture();
        asSuccess(await h.call({ model: 'gpt-5.5', effortTier: 'high' }));
        expect(h.fetchImpl.mock.calls.map(([url]) => url).some(url => url.includes('effort-tiers'))).toBe(false);
        expect(JSON.parse(h.posts()[0][1]!.body as string)).toEqual({ content: 'Continue authorized work', model: 'gpt-5.5', deliveryMode: 'enqueue' });
        h.assertNoLocal();
    });

    it.each([
        { name: 'unknown remote', options: { remote: false } },
        { name: 'replaced remote identity', options: { knownIdentity: 'other-owner' } },
        { name: 'wrong workspace despite raw-ID collision', options: { detail: (p: any) => ({ ...p, metadata: { ...p.metadata, workspaceId: 'foreign' } }) } },
        { name: 'wrong process', options: { detail: (p: any) => ({ ...p, id: 'other' }) } },
        { name: 'non-chat process', options: { detail: (p: any) => ({ ...p, type: 'workflow' }) } },
        { name: 'archived target', options: { detail: (p: any) => ({ ...p, archived: true }) } },
        { name: 'missing process', options: { detail: () => undefined } },
        { name: 'incompatible explicit model', options: {}, args: { model: 'claude-sonnet-4-6' } },
        { name: 'missing tier', options: { tiers: { provider: 'codex', effortTiers: {} } }, args: { effortTier: 'high' } },
        { name: 'wrong tier provider', options: { tiers: { provider: 'copilot', effortTiers: { high: { model: 'gpt-5.5' } } } }, args: { effortTier: 'high' } },
        { name: 'incompatible tier model', options: { tiers: { provider: 'codex', effortTiers: { high: { model: 'claude-sonnet-4-6' } } } }, args: { effortTier: 'high' } },
        { name: 'invalid tier effort', options: { tiers: { provider: 'codex', effortTiers: { high: { model: 'gpt-5.5', reasoningEffort: 'ultra' } } } }, args: { effortTier: 'high' } },
        { name: 'unknown provider for tier', options: { detail: (p: any) => ({ ...p, activeProviderSession: undefined, metadata: { ...p.metadata, provider: undefined } }) }, args: { effortTier: 'high' } },
        { name: 'invalid delivery', options: {}, args: { deliveryMode: 'unknown' } },
        { name: 'malformed remote clone key', options: {}, args: { workspaceId: 'remote:alias:' } },
        { name: 'invalid encoded remote key', options: {}, args: { workspaceId: 'remote:alias:%ZZ' } },
        { name: 'create-only qualified repo name', options: {}, args: { workspaceId: 'repo@remote' } },
        { name: 'nonstring workspace', options: {}, args: { workspaceId: 42 } },
        { name: 'oversized process', options: {}, args: { processId: 'x'.repeat(513) } },
        { name: 'unencodable process', options: {}, args: { processId: '\ud800' } },
        { name: 'ambiguous process prefix', options: {}, args: { processId: 'remote:alias:queue_target' } },
        { name: 'Ralph post', options: {}, args: { mode: 'ralph' } },
        { name: 'tracked To-do post', options: {}, args: { todoItemId: 'todo' } },
    ])('refuses $name before sending, with no local fallback', async ({ options, args }) => {
        const h = fixture(options);
        expect(await h.call(args)).toHaveProperty('error');
        expect(h.posts()).toHaveLength(0);
        h.assertNoLocal();
    });

    it.each([400, 401, 403, 404, 409, 410, 422, 429, 408, 500, 502, 503])('classifies HTTP %i with a single POST and no private error text', async status => {
        const h = fixture({ respond: async (_url, init, next) => init?.method === 'POST'
            ? Response.json({ error: 'http://private-destination token=secret' }, { status }) : next() });
        const result = await h.call();
        expect(result).toMatchObject({ dispatchState: status === 408 || status >= 500 ? 'uncertain' : 'rejected' });
        expect(h.posts()).toHaveLength(1);
        expect(JSON.stringify(result)).not.toMatch(/private-destination|secret/);
        h.assertNoLocal();
    });

    it.each(['disconnect', 'body-disconnect', 'invalid-json', 'missing-process', 'wrong-process', 'missing-turn', 'negative-turn', 'fractional-turn', 'unsafe-turn'])('%s after POST is uncertain and never resubmitted', async failure => {
        const h = fixture({ respond: async (_url, init, next) => {
            if (init?.method !== 'POST') return next();
            if (failure === 'disconnect') throw new Error('private-destination secret');
            if (failure === 'body-disconnect') return { ok: true, text: async () => { throw new Error('secret'); } } as unknown as Response;
            if (failure === 'invalid-json') return new Response('{bad');
            return Response.json({ ...(failure === 'missing-process' ? {} : { processId: failure === 'wrong-process' ? 'other' : 'queue_target' }),
                ...(failure === 'missing-turn' ? {} : { turnIndex: failure === 'negative-turn' ? -2 : failure === 'fractional-turn' ? 0.5 : failure === 'unsafe-turn' ? Number.MAX_SAFE_INTEGER + 1 : 7 }) });
        } });
        const result = await h.call();
        expect(result).toMatchObject({ dispatchState: 'uncertain', error: expect.stringContaining('Do not send a duplicate follow-up') });
        expect(result).not.toHaveProperty('openLink');
        expect(JSON.stringify(result)).not.toMatch(/private-destination|secret/);
        expect(h.posts()).toHaveLength(1);
        h.assertNoLocal();
    });

    it.each(['headers', 'body'])('bounds %s timeout, aborts transport, and clears its timer', async stage => {
        vi.useFakeTimers();
        try {
            let signal: AbortSignal | undefined;
            const h = fixture({ startTimeoutMs: 50, respond: async (_url, init, next) => {
                if (init?.method !== 'POST') return next();
                signal = init.signal as AbortSignal;
                return stage === 'headers' ? new Promise<Response>(() => {})
                    : { ok: true, text: () => new Promise<string>(() => {}) } as Response;
            } });
            const pending = h.call();
            await vi.advanceTimersByTimeAsync(50);
            expect(await pending).toMatchObject({ dispatchState: 'uncertain' });
            expect(signal?.aborted).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
            expect(h.posts()).toHaveLength(1);
            h.assertNoLocal();
        } finally { vi.useRealTimers(); }
    });

    it.each(['preflight', 'post'])('rejects a changed endpoint at %s without publishing guessed ownership', async phase => {
        let h: ReturnType<typeof fixture>;
        h = fixture({ respond: async (url, init, next) => {
            const response = next();
            if ((phase === 'preflight' && url.includes('?workspace=')) || (phase === 'post' && init?.method === 'POST')) {
                h.server.effectiveUrl = 'http://replacement:4000';
            }
            return response;
        } });
        expect(await h.call()).toMatchObject({ dispatchState: phase === 'preflight' ? 'not-started' : 'uncertain' });
        expect(h.posts()).toHaveLength(phase === 'preflight' ? 0 : 1);
        expect(h.fetchImpl.mock.calls.some(([url]) => url.includes('replacement'))).toBe(false);
        h.assertNoLocal();
    });

    it.each(['preflight', 'post'])('rejects health ownership change at %s', async phase => {
        let healthCount = 0;
        const h = fixture({ respond: async (url, _init, next) => {
            if (url.endsWith('/health') && ++healthCount === (phase === 'preflight' ? 2 : 3)) {
                return Response.json({ serverIdentity: 'replacement-owner' });
            }
            return next();
        } });
        expect(await h.call()).toMatchObject({ dispatchState: phase === 'preflight' ? 'not-started' : 'uncertain' });
        expect(h.posts()).toHaveLength(phase === 'preflight' ? 0 : 1);
        h.assertNoLocal();
    });

    it('encodes workspace/process segments independently and keeps the verified owner in links', async () => {
        const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => url.endsWith('/health')
            ? Response.json({ serverIdentity: 'owner/remote' }) : init?.method === 'POST'
                ? Response.json({ processId: 'p/#?', turnIndex: 0 })
                : Response.json({ process: { id: 'p/#?', type: 'chat', metadata: { workspaceId: 'ws/#?' } } }));
        const directory = createWorkspaceDirectory({ store: makeStore(),
            remoteServers: { list: () => [{ id: 'alias', effectiveUrl: 'http://remote' } as any] }, fetchImpl: fetchImpl as typeof fetch });
        const { tool } = makeTool({ runtime: { workspaceDirectory: directory } });
        const result = asSuccess(await tool.handler({ content: 'follow-up', processId: 'p/#?', workspaceId: 'remote:alias:ws%2F%23%3F' }, invocationStub));
        expect(result.openLink).toBe('#chat-references/owner%2Fremote/ws%2F%23%3F/p%2F%23%3F');
        expect(fetchImpl.mock.calls.find(([, init]) => init?.method === 'POST')?.[0]).toBe('http://remote/api/processes/p%2F%23%3F/message?workspace=ws%2F%23%3F');
    });
});

describe('remote admission uncertainty never retries execution', () => {
    const modes = [
        { mode: 'ask' as const },
        { mode: 'ralph' as const },
        { mode: 'ralph' as const, entryPoint: 'grill' as const },
    ];

    function fixture(admit: (init: RequestInit) => Promise<Response>, options?: { startTimeoutMs?: number }) {
        const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
            if (url.endsWith('/api/health')) return new Response(JSON.stringify({ serverIdentity: 'remote-installation' }));
            if (url.endsWith('/capabilities')) return new Response(JSON.stringify({ version: 1, grilling: true }));
            if (init?.method === 'POST') return admit(init);
            throw new Error(`Unexpected request: ${url}`);
        });
        const workspaceDirectory = createWorkspaceDirectory({ store: makeStore(),
            remoteServers: { list: () => [{ id: 'srv-1', label: 'vm', kind: 'url',
                effectiveUrl: 'http://private-target:4000', serverIdentity: 'remote-installation' } as any] },
            fetchImpl: fetchImpl as typeof fetch, ...options });
        const { tool, enqueueChat } = makeTool({ runtime: { workspaceDirectory } });
        return { fetchImpl, enqueueChat, call: (args: typeof modes[number]) => tool.handler({
            content: 'Work', workspaceId: 'remote:srv-1:destination', provider: 'copilot', ...args,
        }, invocationStub) };
    }

    for (const mode of modes) {
        describe(`${mode.mode} ${mode.entryPoint ?? 'execute'}`, () => {
            it.each(['disconnect', 'body-disconnect', 'invalid-json', 'missing-id', 'empty-id', 'oversized-id', 'invalid-unicode',
                ...(mode.mode === 'ralph' ? ['invalid-session'] : [])])(
                'reports %s after POST as uncertain, with no local fallback or duplicate', async failure => {
                    const h = fixture(async () => {
                        if (failure === 'disconnect') throw new Error('failed to fetch http://private-target:4000/?token=private-token');
                        if (failure === 'body-disconnect') return { ok: true, text: async () => { throw new Error('private response failure'); } } as unknown as Response;
                        if (failure === 'invalid-json') return new Response('{broken');
                        const id = failure === 'empty-id' ? ' ' : failure === 'oversized-id' ? 'x'.repeat(513)
                            : failure === 'invalid-unicode' ? '\ud800' : 'child';
                        return new Response(JSON.stringify(failure === 'missing-id' ? {} : mode.mode === 'ralph'
                            ? { processId: id, sessionId: failure === 'invalid-session' ? 123 : 'session', phase: 'grilling' }
                            : { task: { id } }));
                    });
                    const result = await h.call(mode);
                    expect(result).toMatchObject({ dispatchState: 'uncertain', error: expect.stringContaining('Do not launch a duplicate job') });
                    expect(result).not.toHaveProperty('openLink');
                    expect(JSON.stringify(result)).not.toMatch(/private-target|private-token|private response|not started/);
                    expect(h.fetchImpl.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
                    expect(h.enqueueChat).not.toHaveBeenCalled();
                });

            it.each([400, 401, 403, 404, 409, 422, 429, 408, 500, 502, 503, 504])(
                'classifies HTTP %i without assuming a server failure proves non-admission', async status => {
                    const h = fixture(async () => new Response(JSON.stringify({ error: 'private error http://private-target/?token=private-token' }), { status }));
                    const uncertain = status === 408 || status >= 500;
                    const result = await h.call(mode);
                    expect(result).toMatchObject({ dispatchState: uncertain ? 'uncertain' : 'rejected' });
                    expect((result as any).error).toContain(uncertain ? 'Do not launch a duplicate job' : `HTTP ${status}`);
                    expect(JSON.stringify(result)).not.toMatch(/private-target|private-token/);
                    expect(h.fetchImpl.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
                    expect(h.enqueueChat).not.toHaveBeenCalled();
                });

            it.each(['headers', 'body'])('aborts a timeout waiting for %s and retains uncertain admission', async stage => {
                vi.useFakeTimers();
                try {
                    let signal: AbortSignal | undefined;
                    const h = fixture(async init => {
                        signal = init.signal as AbortSignal;
                        if (stage === 'headers') return new Promise<Response>(() => {});
                        return { ok: true, text: () => new Promise<string>(() => {}) } as Response;
                    }, { startTimeoutMs: 50 });
                    const pending = h.call(mode);
                    await vi.advanceTimersByTimeAsync(50);
                    expect(await pending).toMatchObject({ dispatchState: 'uncertain', error: expect.stringContaining('Do not launch a duplicate job') });
                    expect(signal?.aborted).toBe(true);
                    expect(h.fetchImpl.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
                    expect(h.enqueueChat).not.toHaveBeenCalled();
                    expect(vi.getTimerCount()).toBe(0);
                } finally {
                    vi.useRealTimers();
                }
            });
        });
    }
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
            isRemoteAutoProviderRoutingAvailable: vi.fn().mockResolvedValue(true),
            validateRemoteProvider: vi.fn(),
            startRemoteChat: vi.fn().mockResolvedValue({ serverIdentity: 'remote-installation', processId: 'queue_remote-task' }),
        };
        const { tool, enqueueChat } = makeTool({ runtime: { workspaceDirectory: directory, messagingOrigin, trackMessagingJob } });

        const result = asSuccess(await tool.handler({ content: 'hi', workspaceId: 'remote:srv-1:w-api' }, invocationStub));

        expect(result.processId).toBe('queue_remote-task');
        expect(enqueueChat).not.toHaveBeenCalled();
        expect(JSON.stringify(directory.startRemoteChat.mock.calls[0][0])).not.toContain('messagingOrigin');
        expect(trackMessagingJob).not.toHaveBeenCalled();
    });
});

describe('Auto delegation capability fallback', () => {
    it.each(['ask', 'autopilot', 'ralph'] as const)('inherits the provider with default Medium for disabled local Auto %s across workspaces', async mode => {
        const launchRalph = vi.fn().mockResolvedValue({ ok: true, processId: 'queue_r', sessionId: 'r' });
        const validateProvider = vi.fn();
        const { tool, captured } = makeTool({ storeWorkspaces: ['ws-1', 'ws-2'], launchRalph,
            parentMeta: { provider: 'claude', model: 'sonnet', reasoningEffort: 'high' },
            runtime: { isAutoProviderRoutingAvailable: () => false, validateProvider },
        });
        asSuccess(await tool.handler({ content: 'goal', provider: 'auto', workspaceId: 'ws-2', mode }, invocationStub));
        expect(validateProvider).toHaveBeenCalledExactlyOnceWith('claude');
        if (mode === 'ralph') {
            expect(launchRalph.mock.calls[0][0].aiSelection).toEqual({ provider: 'claude', config: { effortTier: 'medium' } });
        } else {
            expect(payloadOf(captured.input!).provider).toBe('claude');
            expect((payloadOf(captured.input!).context as any).autoProviderRouting).toBeUndefined();
            expect(captured.input!.config).toMatchObject({ effortTier: 'medium' });
            expect(captured.input!.config?.model).toBeUndefined();
            expect(captured.input!.config?.reasoningEffort).toBeUndefined();
        }
    });

    it.each([
        [{}, { effortTier: 'medium' }],
        [{ model: 'opus' }, { model: 'opus', reasoningEffort: 'high' }],
        [{ effortTier: 'medium' }, { effortTier: 'medium' }],
        [{ model: 'opus', effortTier: 'medium' }, { model: 'opus', reasoningEffort: 'high' }],
    ])('honors explicit overrides %j during fallback', async (overrides, expected) => {
        const { tool, captured } = makeTool({ parentMeta: { provider: 'claude', model: 'sonnet', reasoningEffort: 'high' },
            runtime: { isAutoProviderRoutingAvailable: () => false },
        });
        asSuccess(await tool.handler({ content: 'goal', provider: 'auto', ...overrides } as any, invocationStub));
        expect(captured.input!.config).toMatchObject(expected);
        if ('effortTier' in expected) {
            expect(captured.input!.config?.model).toBeUndefined();
            expect(captured.input!.config?.reasoningEffort).toBeUndefined();
        } else {
            expect(captured.input!.config?.effortTier).toBeUndefined();
        }
    });

    it.each([{}, { provider: 'auto' }, { provider: 'unknown' }])('rejects absent/invalid parent provider %j', async parentMeta => {
        const { tool, enqueueChat } = makeTool({ parentMeta, runtime: { isAutoProviderRoutingAvailable: () => false } });
        expect(await tool.handler({ content: 'goal', provider: 'auto' }, invocationStub)).toMatchObject({ error: expect.stringMatching(/Cannot determine a provider/) });
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('missing capability falls back to the concrete parent provider', async () => {
        const { tool, captured } = makeTool({ parentMeta: { provider: 'codex' },
            runtime: { isAutoProviderRoutingAvailable: undefined },
        });
        asSuccess(await tool.handler({ content: 'goal', provider: 'auto' }, invocationStub));
        expect(payloadOf(captured.input!).provider).toBe('codex');
    });

    it.each(['auto', 'claude'] as const)('rejects unavailable %s provider without substituting', async provider => {
        const validateProvider = vi.fn().mockRejectedValue(new Error('Claude is disabled'));
        const { tool, enqueueChat } = makeTool({ parentMeta: { provider: 'claude' }, runtime: {
            isAutoProviderRoutingAvailable: () => false, validateProvider,
        } });
        expect(await tool.handler({ content: 'goal', provider }, invocationStub)).toMatchObject({ error: expect.stringContaining('Claude is disabled') });
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('rejects incompatible explicit model during fallback', async () => {
        const { tool, enqueueChat } = makeTool({ parentMeta: { provider: 'codex' }, runtime: { isAutoProviderRoutingAvailable: () => false } });
        expect(await tool.handler({ content: 'goal', provider: 'auto', model: 'opus' }, invocationStub)).toMatchObject({ error: expect.stringContaining('not compatible') });
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it.each(['auto', 'claude'] as const)('does not retry %s dispatch errors', async provider => {
        const { tool, enqueueChat } = makeTool();
        enqueueChat.mockRejectedValue(new Error('quota/runtime failure'));
        await expect(tool.handler({ content: 'goal', provider }, invocationStub)).rejects.toThrow('quota/runtime failure');
        expect(enqueueChat).toHaveBeenCalledTimes(1);
    });

    it('post mode ignores Auto without consulting create-mode capabilities', async () => {
        const isAutoProviderRoutingAvailable = vi.fn(() => { throw new Error('must not check'); });
        const sendMessage = vi.fn().mockResolvedValue({ turnIndex: 1 });
        const { tool } = makeTool({ sendMessage, runtime: { isAutoProviderRoutingAvailable } });
        asSuccess(await tool.handler({ content: 'continue', processId: 'queue_existing', provider: 'auto' }, invocationStub));
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage.mock.calls[0][0]).not.toHaveProperty('model');
        expect(sendMessage.mock.calls[0][0]).not.toHaveProperty('effort');
        expect(isAutoProviderRoutingAvailable).not.toHaveBeenCalled();
    });

    it.each(['ask', 'autopilot', 'ralph'] as const)('preflights disabled remote Auto %s using destination capabilities/defaults', async mode => {
        const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
            if (url.endsWith('/api/health')) return new Response(JSON.stringify({ serverIdentity: 'remote-installation' }));
            if (url.endsWith('/api/config/runtime')) return new Response(JSON.stringify({ features: { autoAgentProviderRoutingEnabled: false } }));
            if (url.endsWith('/api/agent-providers')) return new Response(JSON.stringify({ providers: [{ id: 'codex', enabled: true, available: true }] }));
            return new Response(JSON.stringify(mode === 'ralph' ? { processId: 'queue_r', sessionId: 'r' } : { task: { id: 'child' } }), { status: 201 });
        });
        const workspaceDirectory = createWorkspaceDirectory({ store: makeStore([]),
            remoteServers: { list: () => [{ id: 'srv-1', kind: 'url', effectiveUrl: 'http://vm:4000' } as any] }, fetchImpl: fetchImpl as typeof fetch,
        });
        const validateProvider = vi.fn().mockRejectedValue(new Error('Local Codex disabled'));
        const { tool, enqueueChat } = makeTool({ parentMeta: { provider: 'codex', model: 'gpt-5.5', reasoningEffort: 'high' }, runtime: { workspaceDirectory, validateProvider } });
        asSuccess(await tool.handler({ content: 'goal', provider: 'auto', mode, workspaceId: 'remote:srv-1:w1' }, invocationStub));
        expect(fetchImpl).toHaveBeenCalledTimes(5);
        const body = JSON.parse(fetchImpl.mock.calls.find(([, init]) => init?.method === 'POST')![1]!.body as string);
        expect(mode === 'ralph' ? body.provider : body.payload.provider).toBe('codex');
        expect(mode === 'ralph' ? body.autoProviderRouting : body.payload.context).toBeUndefined();
        expect(body.config).toEqual({ effortTier: 'medium' });
        expect(JSON.stringify(body)).not.toContain(DEFAULT_PARENT_ID);
        expect(validateProvider).not.toHaveBeenCalled();
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it.each(['missing-endpoint', 'disabled-provider', 'capability-error', 'no-parent', 'bad-model', 'dispatch-error', 'auto-dispatch-error'] as const)('handles remote %s without blind retries', async scenario => {
        const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
            if (url.endsWith('/api/health')) return new Response(JSON.stringify({ serverIdentity: 'remote-installation' }));
            if (url.endsWith('/api/config/runtime')) return new Response(JSON.stringify({ features: { autoAgentProviderRoutingEnabled: scenario === 'auto-dispatch-error' } }), { status: scenario === 'missing-endpoint' ? 404 : scenario === 'capability-error' ? 503 : 200 });
            if (url.endsWith('/api/agent-providers')) return new Response(JSON.stringify({ providers: [{ id: 'codex', enabled: scenario !== 'disabled-provider', available: true }] }));
            return new Response(JSON.stringify(scenario.endsWith('dispatch-error') ? { error: 'quota exhausted' } : { task: { id: 'child' } }), { status: scenario.endsWith('dispatch-error') ? 429 : 201 });
        });
        const workspaceDirectory = createWorkspaceDirectory({ store: makeStore([]),
            remoteServers: { list: () => [{ id: 'srv-1', kind: 'url', effectiveUrl: 'http://vm:4000' } as any] }, fetchImpl: fetchImpl as typeof fetch,
        });
        const { tool, enqueueChat } = makeTool({ parentProcessId: scenario === 'no-parent' ? null : DEFAULT_PARENT_ID, parentMeta: { provider: 'codex' }, runtime: { workspaceDirectory } });
        const result = await tool.handler({ content: 'goal', provider: 'auto', workspaceId: 'remote:srv-1:w1', model: scenario === 'bad-model' ? 'opus' : 'gpt-5.5' }, invocationStub);
        if (scenario === 'missing-endpoint') asSuccess(result);
        else expect(result).toHaveProperty('error');
        expect(fetchImpl.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(scenario === 'missing-endpoint' || scenario.endsWith('dispatch-error') ? 1 : 0);
        expect(enqueueChat).not.toHaveBeenCalled();
    });
});


describe('native Ralph grilling delegation contract', () => {
    it.each([
        { action: 'cancel', processId: 'queue_child', entryPoint: 'grill' },
        { content: 'Build', processId: 'queue_child', entryPoint: 'grill', mode: 'ralph' },
        { content: 'Build', entryPoint: 'grill', mode: 'ask' },
        { content: 'Build', entryPoint: 'invalid', mode: 'ralph' },
    ])('rejects invalid combinations before any admission: %j', async args => {
        const launchRalph = vi.fn();
        const { tool, enqueueChat } = makeTool({ launchRalph });
        expect(await tool.handler(args as any, invocationStub)).toHaveProperty('error');
        expect(launchRalph).not.toHaveBeenCalled(); expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('passes the grilling entry point through native launch with owner/session identity', async () => {
        const launchRalph = vi.fn().mockResolvedValue({ ok: true, processId: 'queue_grill', sessionId: 'ralph-grill', phase: 'grilling' });
        const { tool, enqueueChat } = makeTool({ launchRalph, runtime: { isAutoProviderRoutingAvailable: () => true },
            parentMeta: { provider: 'claude', model: 'claude-opus-5-5', reasoningEffort: 'high' } });
        const result = await tool.handler({ content: 'Build', mode: 'ralph', entryPoint: 'grill', provider: 'auto' }, invocationStub);
        expect(result).toMatchObject({ processId: 'queue_grill', sessionId: 'ralph-grill', phase: 'grilling', owner: { workspaceId: 'ws-1' } });
        expect(launchRalph.mock.calls[0][0]).toMatchObject({ entryPoint: 'grill', aiSelection: { autoProviderRouting: true, config: { effortTier: 'medium' } } });
        expect(launchRalph.mock.calls[0][0].aiSelection).not.toHaveProperty('provider');
        expect(launchRalph.mock.calls[0][0].aiSelection.config).not.toHaveProperty('model');
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('keeps explicit execute identical to omitted direct execution', async () => {
        const launchRalph = vi.fn().mockResolvedValue({ ok: true, processId: 'queue_execute', sessionId: 'ralph-execute' });
        const { tool } = makeTool({ launchRalph });
        const result = await tool.handler({ content: 'Build', mode: 'ralph', entryPoint: 'execute' }, invocationStub);
        expect(result).toEqual({ processId: 'queue_execute', sessionId: 'ralph-execute', openLink: '#chat-references/local-installation/ws-1/queue_execute' });
        expect(launchRalph.mock.calls[0][0].entryPoint).toBe('execute');
    });
});

describe('remote native grilling capability and admission boundary', () => {
    function remote(fetchImpl: typeof fetch, online = true) {
        const workspaceDirectory = createWorkspaceDirectory({ store: makeStore([]),
            remoteServers: { list: () => [{ id: 'srv-grill', label: 'target', kind: 'url',
                ...(online ? { effectiveUrl: 'http://target:4000' } : {}), status: online ? 'online' : 'offline' } as any] }, fetchImpl });
        return makeTool({ runtime: { workspaceDirectory }, parentMeta: { provider: 'codex', model: 'gpt-5.4', reasoningEffort: 'high' } });
    }
    const args = { content: 'Interview the goal', mode: 'ralph' as const, entryPoint: 'grill' as const,
        workspaceId: 'remote:srv-grill:physical-target', provider: 'auto' as const };

    it('checks the owning target before admission and sends only its physical workspace and explicit AI settings', async () => {
        const fetchImpl = vi.fn(async (url: string) => new Response(JSON.stringify(
            url.endsWith('/api/health') ? { serverIdentity: 'remote-installation' } : url.endsWith('/config/runtime') ? { features: { autoAgentProviderRoutingEnabled: true } }
                : url.endsWith('/capabilities') ? { version: 1, grilling: true }
                    : { processId: 'queue_native', sessionId: 'ralph-native', phase: 'grilling' }), { status: 200 }));
        const { tool, enqueueChat } = remote(fetchImpl as any);
        const result = asSuccess(await tool.handler(args, invocationStub));
        expect(result).toMatchObject({ phase: 'grilling', owner: { workspaceId: 'physical-target', serverId: 'srv-grill' },
            resultDelivery: { status: 'unavailable' } });
        expect(fetchImpl.mock.calls.map(call => call[0])).toEqual(['http://target:4000/api/config/runtime',
            'http://target:4000/api/health', 'http://target:4000/api/ralph-launch/capabilities', 'http://target:4000/api/ralph-launch', 'http://target:4000/api/health']);
        const body = JSON.parse((fetchImpl.mock.calls.find((call: any) => call[1]?.method === 'POST') as any)[1].body);
        expect(body).toMatchObject({ workspaceId: 'physical-target', entryPoint: 'grill', autoProviderRouting: true, config: { effortTier: 'medium' } });
        expect(body).not.toHaveProperty('workingDirectory'); expect(body).not.toHaveProperty('folderPath');
        expect(body).not.toHaveProperty('spawnedFromProcessId'); expect(body.config).not.toHaveProperty('model');
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it.each([{ version: 1, grilling: false }, {}, { version: 0, grilling: true }])('refuses old/disabled capabilities without a POST: %j', async capabilities => {
        const fetchImpl = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/api/health') ? { serverIdentity: 'remote-installation' } : capabilities), { status: 200 }));
        const { tool, enqueueChat } = remote(fetchImpl as any);
        const result = await tool.handler({ ...args, provider: 'codex' }, invocationStub);
        expect(result).toHaveProperty('error'); expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('offline targets fail without any network admission or local fallback', async () => {
        const fetchImpl = vi.fn(); const { tool, enqueueChat } = remote(fetchImpl as any, false);
        expect(await tool.handler({ ...args, provider: 'codex' }, invocationStub)).toHaveProperty('error');
        expect(fetchImpl).not.toHaveBeenCalled(); expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('uncertain acceptance attempts one POST and warns against relaunch', async () => {
        const fetchImpl = vi.fn(async (url: string) => {
            if (url.endsWith('/api/health')) return new Response(JSON.stringify({ serverIdentity: 'remote-installation' }));
            if (url.endsWith('/capabilities')) return new Response(JSON.stringify({ version: 1, grilling: true }), { status: 200 });
            throw new Error('connection reset after request');
        });
        const { tool, enqueueChat } = remote(fetchImpl as any);
        const result = await tool.handler({ ...args, provider: 'codex' }, invocationStub);
        expect((result as any).error).toContain('Admission is uncertain');
        expect(fetchImpl).toHaveBeenCalledTimes(3); expect(enqueueChat).not.toHaveBeenCalled();
    });
});

describe('durable job link ownership at admission', () => {
    it('rejects unknown local installation identity before launching a duplicateable job', async () => {
        const { tool, enqueueChat } = makeTool({ runtime: { serverIdentity: undefined } });
        expect(await tool.handler({ content: 'Work' }, invocationStub)).toMatchObject({ error: expect.stringContaining('identity') });
        expect(enqueueChat).not.toHaveBeenCalled();
    });

    it('uses the existing conversation owner rather than the invoking workspace', async () => {
        const sendMessage = vi.fn(async () => ({ turnIndex: 1 }));
        const { tool } = createSendToConversationTool({ workspaceId: 'parent', enqueueChat: vi.fn(), sendMessage,
            store: { getProcess: async () => ({ id: 'queue_child', metadata: { workspaceId: 'child/workspace ?#%' } }) } as unknown as ProcessStore,
            runtime: { serverIdentity: 'owning-installation' } });
        expect(await tool.handler({ content: 'Continue', processId: 'queue_child' }, invocationStub)).toMatchObject({
            openLink: '#chat-references/owning-installation/child%2Fworkspace%20%3F%23%25/queue_child',
        });
    });

    it('does not post when the process owner is unknown', async () => {
        const sendMessage = vi.fn();
        const { tool } = createSendToConversationTool({ workspaceId: 'parent', enqueueChat: vi.fn(), sendMessage,
            store: { getProcess: async () => ({ id: 'queue_child', metadata: {} }) } as unknown as ProcessStore,
            runtime: { serverIdentity: 'owning-installation' } });
        expect(await tool.handler({ content: 'Continue', processId: 'queue_child' }, invocationStub)).toHaveProperty('error');
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it.each(['missing', 'replaced', 'offline', 'changed-before-post', 'changed-after-post', 'endpoint-after-post'] as const)(
        'fails closed for %s remote ownership without a local launch or retry', async state => {
            const server = { id: 'ssh-forward-22', kind: 'ssh', effectiveUrl: 'http://target:5000', serverIdentity: 'owning-installation' };
            let posts = 0;
            let healthReads = 0;
            const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
                if (url.endsWith('/api/health')) {
                    healthReads++;
                    if (state === 'offline') throw new Error('private transport failure');
                    return new Response(JSON.stringify(state === 'missing' ? {}
                        : { serverIdentity: state === 'replaced' || (state === 'changed-after-post' && healthReads > 1)
                            ? 'replacement-installation' : 'owning-installation' }));
                }
                if (url.endsWith('/capabilities')) {
                    if (state === 'changed-before-post') server.effectiveUrl = 'http://replacement:7000';
                    return new Response(JSON.stringify({ version: 1, grilling: true }));
                }
                if (init?.method === 'POST') {
                    posts++;
                    if (state === 'endpoint-after-post') server.effectiveUrl = 'http://replacement:7000';
                    return new Response(JSON.stringify({ processId: 'queue_remote', sessionId: 'ralph', phase: 'grilling' }));
                }
                throw new Error('Unexpected request');
            });
            const workspaceDirectory = createWorkspaceDirectory({ store: makeStore(),
                remoteServers: { list: () => [server as any] }, fetchImpl: fetchImpl as typeof fetch });
            const { tool, enqueueChat } = makeTool({ runtime: { workspaceDirectory } });
            const result = await tool.handler({ content: 'Interview', workspaceId: 'remote:ssh-forward-22:child',
                provider: 'copilot', mode: 'ralph', entryPoint: 'grill' }, invocationStub);
            expect(result).toHaveProperty('error');
            expect(result).not.toHaveProperty('openLink');
            expect(posts).toBe(state.endsWith('after-post') ? 1 : 0);
            expect(result).toHaveProperty('dispatchState', posts ? 'uncertain' : 'not-started');
            if (posts) expect((result as any).error).toContain('Do not launch a duplicate job');
            expect(JSON.stringify(result)).not.toContain('private transport failure');
            expect(enqueueChat).not.toHaveBeenCalled();
        });
});
