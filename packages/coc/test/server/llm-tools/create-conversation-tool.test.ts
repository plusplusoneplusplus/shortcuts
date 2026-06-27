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

function makeStore(workspaceIds: string[] = ['ws-1']): ProcessStore {
    const store: Partial<ProcessStore> = {
        getWorkspaces: vi.fn().mockResolvedValue(
            workspaceIds.map(id => ({ id, name: id, rootPath: `/repo/${id}` })),
        ),
    };
    return store as ProcessStore;
}

/** Build a tool wired to a stub enqueue that captures the CreateTaskInput it receives. */
function makeTool(opts?: { workspaceId?: string; storeWorkspaces?: string[]; taskId?: string }) {
    const captured: { input?: CreateTaskInput } = {};
    const enqueueChat = vi.fn(async (input: CreateTaskInput) => {
        captured.input = input;
        return opts?.taskId ?? 'task-123';
    });
    const { tool } = createCreateConversationTool({
        store: makeStore(opts?.storeWorkspaces),
        workspaceId: opts?.workspaceId ?? 'ws-1',
        enqueueChat,
    });
    return { tool, enqueueChat, captured };
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
});
