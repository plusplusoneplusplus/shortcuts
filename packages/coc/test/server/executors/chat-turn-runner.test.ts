/**
 * Chat Turn Runner Tests
 *
 * The MCP OAuth callback drives live UI (the dashboard's authorize prompt), so
 * it is pinned here: the pending record it registers, the SSE payload it emits,
 * and — critically — that no failure inside it can interrupt the turn.
 */

import { describe, it, expect, vi } from 'vitest';

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { McpOauthManager } from '../../../src/server/mcp-oauth';
import { buildMcpOAuthHandler, type McpOAuthRequiredEvent } from '../../../src/server/executors/chat-turn-runner';

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
