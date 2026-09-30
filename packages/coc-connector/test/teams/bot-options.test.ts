import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamsBotOptions } from '../../src/teams/types';

const constructors = vi.hoisted(() => ({
    mcp: vi.fn(),
    graph: vi.fn(),
}));

vi.mock('../../src/teams/mcp/transport-mcp', () => ({
    McpTransport: class {
        constructor(...args: unknown[]) { constructors.mcp(...args); }
    },
}));

vi.mock('../../src/teams/graph/transport-graph', () => ({
    GraphTransport: class {
        constructor(...args: unknown[]) { constructors.graph(...args); }
    },
}));

import { TeamsBot } from '../../src/teams/bot';

beforeEach(() => vi.clearAllMocks());

describe('TeamsBot transport options', () => {
    it('forwards MCP polling, IC3 configuration, routing, and nested auth refresh', () => {
        const opts: TeamsBotOptions = {
            mode: 'mcp',
            mcpServerUrl: 'https://example.invalid/mcp',
            onMessage: vi.fn(),
            pollChannelReplies: () => true,
            channelThreadRoots: () => ['root'],
            onChannelRootDiscovered: vi.fn(),
            enableIc3DirectMessages: true,
            ic3DirectMessageOptions: { region: 'emea', acquireToken: vi.fn() },
            connectionId: 'connection',
            operationRoutes: { self: 'ic3' },
            auth: { onTokenRefresh: vi.fn() },
        };

        new TeamsBot(opts);

        expect(constructors.mcp).toHaveBeenCalledExactlyOnceWith(
            opts.mcpServerUrl, opts.pollChannelReplies, opts.channelThreadRoots,
            opts.onChannelRootDiscovered, opts.enableIc3DirectMessages, opts.ic3DirectMessageOptions,
            { connectionId: opts.connectionId, routes: opts.operationRoutes,
                onTokenRefresh: opts.auth?.onTokenRefresh },
        );
        expect(constructors.graph).not.toHaveBeenCalled();
    });

    it.each([undefined, vi.fn()])('forwards optional auth refresh in default Graph mode', (onTokenRefresh) => {
        new TeamsBot({
            onMessage: vi.fn(),
            connectionId: 'connection',
            operationRoutes: { channel: 'graph' },
            ...(onTokenRefresh ? { auth: { onTokenRefresh } } : {}),
        });

        expect(constructors.graph).toHaveBeenCalledExactlyOnceWith({
            connectionId: 'connection', routes: { channel: 'graph' }, onTokenRefresh,
        });
        expect(constructors.mcp).not.toHaveBeenCalled();
    });
});
