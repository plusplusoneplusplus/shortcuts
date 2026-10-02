import { describe, expect, it } from 'vitest';
import * as teams from '../../src/teams';
import { GraphClient } from '../../src/teams/graph/graph-client';
import { GraphOperations } from '../../src/teams/graph/operations-graph';
import { GraphTransport } from '../../src/teams/graph/transport-graph';
import { Ic3DirectMessageClient, TeamsIc3SendError } from '../../src/teams/ic3/ic3-direct-message';
import { Ic3Operations } from '../../src/teams/ic3/operations-ic3';
import { McpClient } from '../../src/teams/mcp/mcp-client';
import { McpOperations, TeamsMcpSendRejectedError } from '../../src/teams/mcp/operations-mcp';
import { McpTransport } from '../../src/teams/mcp/transport-mcp';

describe('Teams public exports', () => {
    it.each([
        ['GraphClient', GraphClient],
        ['GraphOperations', GraphOperations],
        ['GraphTransport', GraphTransport],
        ['Ic3DirectMessageClient', Ic3DirectMessageClient],
        ['TeamsIc3SendError', TeamsIc3SendError],
        ['Ic3Operations', Ic3Operations],
        ['McpClient', McpClient],
        ['McpOperations', McpOperations],
        ['TeamsMcpSendRejectedError', TeamsMcpSendRejectedError],
        ['McpTransport', McpTransport],
    ] as const)('exports %s from its backend implementation', (name, implementation) => {
        expect(teams[name]).toBe(implementation);
    });

    it('constructs standalone operations through the public entry point without connecting', () => {
        const ic3 = new teams.Ic3Operations({ connectionId: 'ic3-connection' });
        const mcp = new teams.McpOperations({
            connectionId: 'mcp-connection',
            client: new teams.McpClient({ serverUrl: 'https://example.invalid/mcp' }),
        });

        expect(ic3.backend).toBe('ic3');
        expect(mcp.backend).toBe('mcp');
        expect(ic3.connectionId).toBe('ic3-connection');
        expect(mcp.connectionId).toBe('mcp-connection');
        ic3.dispose();
        mcp.dispose();
    });
});
