import { describe, it, expect } from 'vitest';
import {
    buildAgentRunTreeFromTurns,
    countRuns,
} from '../../../../src/server/spa/client/react/features/chat/agent-canvas/buildAgentRunTree';
import type { AgentRunNode } from '../../../../src/server/spa/client/react/features/chat/agent-canvas/types';
import type { ClientConversationTurn, ClientToolCall } from '../../../../src/server/spa/client/react/types/dashboard';

function tc(partial: Partial<ClientToolCall> & { id: string }): ClientToolCall {
    return { toolName: 'Task', args: {}, status: 'completed', ...partial };
}

function assistantTurn(
    toolCalls: ClientToolCall[],
    timeline: ClientConversationTurn['timeline'] = [],
): ClientConversationTurn {
    return { role: 'assistant', content: '', timeline, toolCalls };
}

describe('buildAgentRunTreeFromTurns', () => {
    it('returns a lone orchestrator root when there are no sub-agents', () => {
        const root = buildAgentRunTreeFromTurns([], { title: 'Dark mode work', status: 'completed' });
        expect(root).toMatchObject({
            id: 'root',
            isRoot: true,
            role: 'orchestrator',
            name: 'Dark mode work',
            status: 'done',
        });
        expect(root.children).toEqual([]);
        expect(countRuns(root)).toBe(1);
    });

    it('maps Task tool calls into sub-agent children with name/role/status/timing', () => {
        const turns = [assistantTurn([
            tc({
                id: 't1',
                args: { agent_type: 'Explore', description: 'map data model' },
                status: 'running',
                startTime: '2026-06-13T10:00:00.000Z',
                endTime: undefined,
            }),
        ])];
        const root = buildAgentRunTreeFromTurns(turns, { status: 'running' });
        expect(root.status).toBe('running');
        expect(root.children).toHaveLength(1);
        expect(root.children[0]).toMatchObject({
            id: 't1',
            name: 'map data model',
            role: 'Explore',
            status: 'running',
            startedAt: Date.parse('2026-06-13T10:00:00.000Z'),
        });
        expect(root.children[0].completedAt).toBeUndefined();
    });

    it('falls back to a truncated prompt when no description is present', () => {
        const longPrompt = 'investigate the entire conversation timeline rendering pipeline end to end';
        const turns = [assistantTurn([
            tc({ id: 't1', args: { agent_type: 'general-purpose', prompt: longPrompt } }),
        ])];
        const root = buildAgentRunTreeFromTurns(turns);
        expect(root.children[0].name).toBe('investigate the entire conversation timeline…');
        expect(root.children[0].role).toBe('general-purpose');
    });

    it('also reads subagent_type as the role', () => {
        const turns = [assistantTurn([
            tc({ id: 't1', args: { subagent_type: 'rust-code-reviewer', description: 'review' } }),
        ])];
        expect(buildAgentRunTreeFromTurns(turns).children[0].role).toBe('rust-code-reviewer');
    });

    it('ignores non-Task tool calls', () => {
        const turns = [assistantTurn([
            tc({ id: 'r1', toolName: 'Read', args: { file_path: '/a.ts' } }),
            tc({ id: 'b1', toolName: 'Bash', args: { command: 'ls' } }),
        ])];
        expect(buildAgentRunTreeFromTurns(turns).children).toEqual([]);
    });

    it('dedupes a tool call seen in both toolCalls and the timeline, preferring terminal state', () => {
        const turns = [assistantTurn(
            [tc({ id: 't1', args: { description: 'x' }, status: 'running' })],
            [{
                type: 'tool-complete',
                timestamp: '2026-06-13T10:00:00.000Z',
                toolCall: tc({ id: 't1', args: { description: 'x' }, status: 'completed', result: 'all green\nmore' }),
            }],
        )];
        const root = buildAgentRunTreeFromTurns(turns);
        expect(root.children).toHaveLength(1);
        expect(root.children[0].status).toBe('done');
        expect(root.children[0].summary).toBe('all green');
    });

    it('derives root status from children when no explicit status is given', () => {
        const running = [assistantTurn([tc({ id: 't1', args: { description: 'x' }, status: 'running' })])];
        expect(buildAgentRunTreeFromTurns(running).status).toBe('running');

        const allDone = [assistantTurn([tc({ id: 't1', args: { description: 'x' }, status: 'completed' })])];
        expect(buildAgentRunTreeFromTurns(allDone).status).toBe('done');
    });

    it('maps failed/cancelled root status to failed and queued to queued', () => {
        expect(buildAgentRunTreeFromTurns([], { status: 'failed' }).status).toBe('failed');
        expect(buildAgentRunTreeFromTurns([], { status: 'cancelled' }).status).toBe('failed');
        expect(buildAgentRunTreeFromTurns([], { status: 'queued' }).status).toBe('queued');
    });

    it('orders children by start time, placing unknown start times last', () => {
        const turns = [assistantTurn([
            tc({ id: 'late', args: { description: 'late' }, startTime: '2026-06-13T10:05:00.000Z' }),
            tc({ id: 'early', args: { description: 'early' }, startTime: '2026-06-13T10:01:00.000Z' }),
            tc({ id: 'unknown', args: { description: 'unknown' } }),
        ])];
        const ids = buildAgentRunTreeFromTurns(turns).children.map((c) => c.id);
        expect(ids).toEqual(['early', 'late', 'unknown']);
    });
});

describe('countRuns', () => {
    it('counts every run including the root', () => {
        const tree: AgentRunNode = {
            id: 'root', name: 'r', role: 'orchestrator', status: 'done',
            children: [
                { id: 'a', name: 'a', role: 'agent', status: 'done', children: [
                    { id: 'a1', name: 'a1', role: 'agent', status: 'done', children: [] },
                ] },
                { id: 'b', name: 'b', role: 'agent', status: 'done', children: [] },
            ],
        };
        expect(countRuns(tree)).toBe(4);
    });
});
