/**
 * Routing Classifier Tests
 *
 * Unit tests for the container session routing classifier.
 * Tests parsing, classification logic, and fallback behavior.
 */

import { describe, it, expect } from 'vitest';
import { classifyRouting, parseClassifierResponse } from '../../../src/server/container-sessions/routing-classifier';
import type { ContainerAgentInfo, ContainerSessionTurn } from '../../../src/server/container-sessions/container-session-types';
import type { RoutingClassifierDeps } from '../../../src/server/container-sessions/routing-classifier';

// ============================================================================
// Helpers
// ============================================================================

const AGENTS: ContainerAgentInfo[] = [
    {
        id: 'agent-shortcuts',
        name: 'shortcuts',
        workspaces: [
            { id: 'ws-short', name: 'shortcuts', rootPath: '/repos/shortcuts' },
        ],
    },
    {
        id: 'agent-docs',
        name: 'docs-site',
        workspaces: [
            { id: 'ws-docs', name: 'docs', rootPath: '/repos/docs' },
            { id: 'ws-blog', name: 'blog', rootPath: '/repos/blog' },
        ],
    },
];

function makeDeps(response: string): RoutingClassifierDeps {
    return {
        invokeClassifier: async () => response,
    };
}

function makeTurn(overrides: Partial<ContainerSessionTurn> = {}): ContainerSessionTurn {
    return {
        index: overrides.index ?? 0,
        role: overrides.role ?? 'user',
        content: overrides.content ?? 'hello',
        routing: overrides.routing ?? { agentId: 'agent-shortcuts', workspaceId: 'ws-short', confidence: 0.9, reason: 'test' },
        downstreamProcessId: overrides.downstreamProcessId ?? null,
        timestamp: overrides.timestamp ?? '2026-01-01T00:00:00.000Z',
    };
}

// ============================================================================
// parseClassifierResponse
// ============================================================================

describe('parseClassifierResponse', () => {
    it('parses a well-formed ROUTE response', () => {
        const response = 'ROUTE: agent_id=agent-docs workspace_id=ws-docs confidence=0.95 reason=mentions documentation';
        const result = parseClassifierResponse(response, AGENTS);
        expect(result.agentId).toBe('agent-docs');
        expect(result.workspaceId).toBe('ws-docs');
        expect(result.confidence).toBe(0.95);
        expect(result.reason).toBe('mentions documentation');
    });

    it('handles case-insensitive ROUTE prefix', () => {
        const response = 'route: agent_id=agent-shortcuts workspace_id=ws-short confidence=0.8 reason=code fix';
        const result = parseClassifierResponse(response, AGENTS);
        expect(result.agentId).toBe('agent-shortcuts');
    });

    it('falls back when response is unparseable', () => {
        const result = parseClassifierResponse('I cannot determine the route', AGENTS);
        expect(result.agentId).toBe('agent-shortcuts'); // first agent
        expect(result.confidence).toBe(0.3);
        expect(result.reason).toContain('Could not parse');
    });

    it('falls back when agent ID is invalid', () => {
        const response = 'ROUTE: agent_id=nonexistent workspace_id=ws-docs confidence=0.9 reason=test';
        const result = parseClassifierResponse(response, AGENTS);
        expect(result.agentId).toBe('agent-shortcuts'); // first agent
        expect(result.confidence).toBe(0.3);
    });

    it('falls back when workspace ID is invalid but agent is valid', () => {
        const response = 'ROUTE: agent_id=agent-docs workspace_id=nonexistent confidence=0.9 reason=test';
        const result = parseClassifierResponse(response, AGENTS);
        expect(result.agentId).toBe('agent-docs');
        expect(result.workspaceId).toBe('ws-docs'); // first workspace of valid agent
        expect(result.confidence).toBe(0.4);
    });

    it('clamps confidence to [0, 1]', () => {
        const response = 'ROUTE: agent_id=agent-docs workspace_id=ws-docs confidence=1.5 reason=test';
        const result = parseClassifierResponse(response, AGENTS);
        expect(result.confidence).toBe(1.0);
    });
});

// ============================================================================
// classifyRouting
// ============================================================================

describe('classifyRouting', () => {
    it('returns override immediately when set', async () => {
        const deps = makeDeps('should not be called');
        const result = await classifyRouting(
            {
                agents: AGENTS,
                history: [],
                message: 'fix auth',
                override: { agentId: 'agent-docs', workspaceId: 'ws-blog' },
            },
            deps,
        );
        expect(result.agentId).toBe('agent-docs');
        expect(result.workspaceId).toBe('ws-blog');
        expect(result.confidence).toBe(1.0);
        expect(result.reason).toBe('Manual override');
    });

    it('skips LLM when only one workspace exists', async () => {
        const singleAgent: ContainerAgentInfo[] = [
            { id: 'only', name: 'Only Agent', workspaces: [{ id: 'ws-only', name: 'only', rootPath: '/only' }] },
        ];
        const deps = makeDeps('should not be called');
        const result = await classifyRouting(
            { agents: singleAgent, history: [], message: 'anything' },
            deps,
        );
        expect(result.agentId).toBe('only');
        expect(result.workspaceId).toBe('ws-only');
        expect(result.confidence).toBe(1.0);
    });

    it('throws when no agents available', async () => {
        const deps = makeDeps('');
        await expect(
            classifyRouting({ agents: [], history: [], message: 'test' }, deps),
        ).rejects.toThrow('No agents or workspaces available');
    });

    it('calls LLM and parses response for multiple workspaces', async () => {
        const deps = makeDeps('ROUTE: agent_id=agent-docs workspace_id=ws-blog confidence=0.88 reason=mentions blog post');
        const result = await classifyRouting(
            { agents: AGENTS, history: [], message: 'write a blog post' },
            deps,
        );
        expect(result.agentId).toBe('agent-docs');
        expect(result.workspaceId).toBe('ws-blog');
        expect(result.confidence).toBe(0.88);
    });

    it('falls back to last-used route on low confidence', async () => {
        const deps = makeDeps('ROUTE: agent_id=agent-docs workspace_id=ws-docs confidence=0.3 reason=unsure');
        const history: ContainerSessionTurn[] = [
            makeTurn({ routing: { agentId: 'agent-shortcuts', workspaceId: 'ws-short', confidence: 0.9, reason: 'previous' } }),
        ];
        const result = await classifyRouting(
            { agents: AGENTS, history, message: 'do something vague' },
            deps,
        );
        expect(result.agentId).toBe('agent-shortcuts');
        expect(result.workspaceId).toBe('ws-short');
        expect(result.confidence).toBe(0.6);
        expect(result.reason).toContain('last-used');
    });

    it('accepts low confidence when no history exists', async () => {
        const deps = makeDeps('ROUTE: agent_id=agent-docs workspace_id=ws-docs confidence=0.3 reason=unsure');
        const result = await classifyRouting(
            { agents: AGENTS, history: [], message: 'do something vague' },
            deps,
        );
        // No fallback available, so accepts the low-confidence result
        expect(result.agentId).toBe('agent-docs');
        expect(result.confidence).toBe(0.3);
    });
});
