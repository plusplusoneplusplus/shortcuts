/**
 * The shared turn payload both chat paths send.
 *
 * `buildChatTurnSendOptions` is pinned field by field because it is the single
 * home for everything a turn sends that is not path-specific — a field that
 * silently stops being emitted here stops being emitted on both paths at once.
 *
 * The MCP OAuth callback drives live UI (the dashboard's authorize prompt), so
 * it is pinned too: the pending record it registers, the SSE payload it emits,
 * and — critically — that no failure inside it can interrupt the turn.
 */

import { describe, it, expect, vi } from 'vitest';

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { McpOauthManager } from '../../../src/server/mcp-oauth';
import {
    buildChatTurnSendOptions,
    buildMcpOAuthHandler,
    type ChatTurnSendOptionsInput,
    type McpOAuthRequiredEvent,
} from '../../../src/server/executors/chat-turn-runner';

// ============================================================================
// Fixtures
// ============================================================================

function fakeStore(emitProcessEvent = vi.fn()): ProcessStore & { emitProcessEvent: ReturnType<typeof vi.fn> } {
    return { emitProcessEvent } as unknown as ProcessStore & { emitProcessEvent: ReturnType<typeof vi.fn> };
}

function fakeManager(addPending = vi.fn().mockReturnValue({ id: 'entry-1', status: 'pending' })): McpOauthManager {
    return { addPending } as unknown as McpOauthManager;
}

const event: McpOAuthRequiredEvent = {
    serverName: 'github',
    serverUrl: 'https://mcp.example/github',
    authorizationUrl: 'https://mcp.example/authorize?x=1',
    requestId: 'req-9',
};

// ============================================================================
// Tests
// ============================================================================

describe('buildMcpOAuthHandler', () => {
    it('returns undefined when no manager is wired, so the SDK does not track OAuth', () => {
        const handler = buildMcpOAuthHandler({
            store: fakeStore(),
            processId: 'p1',
            originalMessage: 'hi',
            manager: undefined,
            logLabel: '[Test]',
        });

        expect(handler).toBeUndefined();
    });

    it('registers a pending entry carrying the process, workspace, and original message', () => {
        const addPending = vi.fn().mockReturnValue({ id: 'entry-1', status: 'pending' });
        const handler = buildMcpOAuthHandler({
            store: fakeStore(),
            processId: 'p1',
            workspaceId: 'ws-1',
            originalMessage: 'run the thing',
            manager: fakeManager(addPending),
            logLabel: '[Test]',
        });

        handler!(event);

        expect(addPending).toHaveBeenCalledWith({
            requestId: 'req-9',
            serverName: 'github',
            serverUrl: 'https://mcp.example/github',
            authorizationUrl: 'https://mcp.example/authorize?x=1',
            processId: 'p1',
            workspaceId: 'ws-1',
            originalMessage: 'run the thing',
        });
    });

    it('emits the SSE event using the manager entry id, not the raw request id', () => {
        const emit = vi.fn();
        const handler = buildMcpOAuthHandler({
            store: fakeStore(emit),
            processId: 'p1',
            originalMessage: 'hi',
            manager: fakeManager(),
            logLabel: '[Test]',
        });

        handler!(event);

        expect(emit).toHaveBeenCalledWith('p1', {
            type: 'mcp-oauth-required',
            mcpOAuth: {
                requestId: 'entry-1',
                serverName: 'github',
                serverUrl: 'https://mcp.example/github',
                authorizationUrl: 'https://mcp.example/authorize?x=1',
            },
        });
    });

    it('does not interrupt the turn when registration throws', () => {
        const emit = vi.fn();
        const handler = buildMcpOAuthHandler({
            store: fakeStore(emit),
            processId: 'p1',
            originalMessage: 'hi',
            manager: fakeManager(vi.fn(() => { throw new Error('registry down'); })),
            logLabel: '[Test]',
        });

        expect(() => handler!(event)).not.toThrow();
        expect(emit).not.toHaveBeenCalled();
    });

    it('does not interrupt the turn when SSE emission throws', () => {
        const handler = buildMcpOAuthHandler({
            store: fakeStore(vi.fn(() => { throw new Error('no subscribers'); })),
            processId: 'p1',
            originalMessage: 'hi',
            manager: fakeManager(),
            logLabel: '[Test]',
        });

        expect(() => handler!(event)).not.toThrow();
    });

    it('handles an event with no authorization URL', () => {
        const emit = vi.fn();
        const handler = buildMcpOAuthHandler({
            store: fakeStore(emit),
            processId: 'p1',
            originalMessage: 'hi',
            manager: fakeManager(),
            logLabel: '[Test]',
        });

        handler!({ ...event, authorizationUrl: undefined });

        expect(emit.mock.calls[0][1].mcpOAuth.authorizationUrl).toBeUndefined();
    });
});


// ============================================================================
// buildChatTurnSendOptions
// ============================================================================

function makeTool(name: string) {
    return { name, description: name, handler: vi.fn() } as any;
}

function sendInput(overrides: Partial<ChatTurnSendOptionsInput> = {}): ChatTurnSendOptionsInput {
    return {
        prompt: 'do the thing',
        agentMode: 'interactive',
        policy: {},
        workingDirectory: '/repo',
        signal: new AbortController().signal,
        timeoutMs: 1_000,
        idleTimeoutMs: 500,
        keepWarm: false,
        warmKey: 'proc-1',
        systemMessage: { mode: 'append', content: 'sys' },
        tools: [],
        approvePermissions: false,
        onSessionCreated: vi.fn(),
        onStreamingChunk: vi.fn(),
        onToolEvent: vi.fn(),
        onTokenUsage: vi.fn(),
        onBackgroundTasksChanged: vi.fn(),
        onMcpOAuthRequired: undefined,
        ...overrides,
    };
}

describe('buildChatTurnSendOptions', () => {
    it('forwards the invariant fields and callbacks every turn needs', () => {
        const input = sendInput({
            tools: [makeTool('ask_user')],
            skillDirectories: ['/skills'],
            disabledSkills: ['noisy'],
        });

        const options = buildChatTurnSendOptions(input);

        expect(options.prompt).toBe('do the thing');
        expect(options.mode).toBe('interactive');
        expect(options.workingDirectory).toBe('/repo');
        expect(options.signal).toBe(input.signal);
        expect(options.timeoutMs).toBe(1_000);
        expect(options.idleTimeoutMs).toBe(500);
        expect(options.infiniteSessions).toEqual({ enabled: true });
        expect(options.systemMessage).toEqual({ mode: 'append', content: 'sys' });
        expect(options.tools?.map(t => t.name)).toEqual(['ask_user']);
        expect(options.skillDirectories).toEqual(['/skills']);
        expect(options.disabledSkills).toEqual(['noisy']);
        expect(options.onSessionCreated).toBe(input.onSessionCreated);
        expect(options.onStreamingChunk).toBe(input.onStreamingChunk);
        expect(options.onToolEvent).toBe(input.onToolEvent);
        expect(options.onTokenUsage).toBe(input.onTokenUsage);
        expect(options.onBackgroundTasksChanged).toBe(input.onBackgroundTasksChanged);
    });

    it('spreads the resolved model, effort, and context tier only when present', () => {
        const bare = buildChatTurnSendOptions(sendInput());
        expect('model' in bare).toBe(false);
        expect('reasoningEffort' in bare).toBe(false);
        expect('contextTier' in bare).toBe(false);

        const full = buildChatTurnSendOptions(sendInput({
            policy: { modelId: 'gpt-5', reasoningEffort: 'high', contextTier: 'long_context' },
        }));
        expect(full.model).toBe('gpt-5');
        expect(full.reasoningEffort).toBe('high');
        expect(full.contextTier).toBe('long_context');
    });

    it('gates keep-warm on the executor flag and scopes it by the warm key', () => {
        const cold = buildChatTurnSendOptions(sendInput({ keepWarm: false }));
        expect('keepWarm' in cold).toBe(false);
        expect('warmKey' in cold).toBe(false);

        const warm = buildChatTurnSendOptions(sendInput({ keepWarm: true, warmKey: 'proc-42' }));
        expect(warm.keepWarm).toBe(true);
        expect(warm.warmKey).toBe('proc-42');
    });

    it('sends no tools field when the bundle is empty', () => {
        expect(buildChatTurnSendOptions(sendInput({ tools: [] })).tools).toBeUndefined();
    });

    it('omits excludedTools unless Memory V2 shadowed a builtin', () => {
        expect('excludedTools' in buildChatTurnSendOptions(sendInput())).toBe(false);
        expect('excludedTools' in buildChatTurnSendOptions(sendInput({ excludedTools: [] }))).toBe(false);
        expect(buildChatTurnSendOptions(sendInput({ excludedTools: ['write'] })).excludedTools).toEqual(['write']);
    });

    it('pairs a resolved MCP allow-list with loadDefaultMcpConfig: false', () => {
        const withoutList = buildChatTurnSendOptions(sendInput());
        expect('mcpServers' in withoutList).toBe(false);
        expect('loadDefaultMcpConfig' in withoutList).toBe(false);

        const servers = { github: { command: 'x' } } as any;
        const withList = buildChatTurnSendOptions(sendInput({ mcpServers: servers }));
        expect(withList.mcpServers).toBe(servers);
        expect(withList.loadDefaultMcpConfig).toBe(false);
    });

    it('installs a permission handler only when the executor auto-approves', () => {
        expect(buildChatTurnSendOptions(sendInput({ approvePermissions: false })).onPermissionRequest)
            .toBeUndefined();
        expect(buildChatTurnSendOptions(sendInput({ approvePermissions: true })).onPermissionRequest)
            .toBeTypeOf('function');
    });

    it('forwards the MCP OAuth handler so both paths dispatch OAuth alike', () => {
        const handler = vi.fn();
        expect(buildChatTurnSendOptions(sendInput({ onMcpOAuthRequired: handler })).onMcpOAuthRequired)
            .toBe(handler);
    });

    it('omits additionalDirectories outside a repo group', () => {
        expect('additionalDirectories' in buildChatTurnSendOptions(sendInput())).toBe(false);
        expect(buildChatTurnSendOptions(sendInput({ additionalDirectories: ['/member'] })).additionalDirectories)
            .toEqual(['/member']);
    });

    it('lets a caller override the core with its path-specific extras', () => {
        // The contract the two executors rely on: the builder returns the
        // invariant core, and each path spreads its own fields on top.
        const options = {
            ...buildChatTurnSendOptions(sendInput({ timeoutMs: 1_000 })),
            sessionId: 'sess-7',
            strictSessionResume: true as const,
            deliveryMode: 'enqueue' as const,
            timeoutMs: 9_999,
        };

        expect(options.sessionId).toBe('sess-7');
        expect(options.strictSessionResume).toBe(true);
        expect(options.deliveryMode).toBe('enqueue');
        expect(options.timeoutMs).toBe(9_999);
    });
});
