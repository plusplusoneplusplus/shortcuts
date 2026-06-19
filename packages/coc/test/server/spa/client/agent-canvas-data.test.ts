import { describe, it, expect } from 'vitest';
import {
    buildAgentRunTreeFromTurns,
    countRuns,
    findTurnIndexForRun,
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

    it('captures name, type, model, mode and description from Task args', () => {
        const turns = [assistantTurn([tc({
            id: 't1',
            status: 'running',
            args: {
                agent_type: 'explore',
                name: 'time-agent-1',
                description: 'Query current time',
                model: 'claude-sonnet-4.6',
                mode: 'background',
                prompt: 'Query the current date and time.',
            },
        })])];
        expect(buildAgentRunTreeFromTurns(turns).children[0]).toMatchObject({
            id: 't1',
            name: 'time-agent-1',
            role: 'explore',
            description: 'Query current time',
            model: 'claude-sonnet-4.6',
            mode: 'background',
            prompt: 'Query the current date and time.',
        });
    });

    it('uses the agent name as the title and drops a redundant description', () => {
        // No explicit name → title falls back to description, which is then cleared
        // so the inspector does not show it twice.
        const child = buildAgentRunTreeFromTurns([
            assistantTurn([tc({ id: 't1', args: { agent_type: 'explore', description: 'map data' } })]),
        ]).children[0];
        expect(child.name).toBe('map data');
        expect(child.description).toBeUndefined();
        expect(child.model).toBeUndefined();
    });

    it('ignores non-Task tool calls', () => {
        const turns = [assistantTurn([
            tc({ id: 'r1', toolName: 'Read', args: { file_path: '/a.ts' } }),
            tc({ id: 'b1', toolName: 'Bash', args: { command: 'ls' } }),
        ])];
        expect(buildAgentRunTreeFromTurns(turns).children).toEqual([]);
    });

    it('detects persisted Task calls that use `name` instead of `toolName`', () => {
        // forge's persisted ToolCall read model carries `name`, not `toolName`,
        // so sub-agents must still be found after the chat completes + refreshes.
        const persisted = {
            id: 't1', name: 'Task', status: 'completed', result: 'done',
            args: { agent_type: 'Explore', description: 'map data model' },
        } as unknown as ClientToolCall;
        const root = buildAgentRunTreeFromTurns([assistantTurn([persisted])]);
        expect(root.children).toHaveLength(1);
        expect(root.children[0]).toMatchObject({ id: 't1', name: 'map data model', role: 'Explore', status: 'done' });
    });

    it('reads sub-agent args from `parameters` when `args` is absent', () => {
        const persisted = {
            id: 't1', name: 'Task', status: 'running',
            parameters: { agent_type: 'general-purpose', description: 'research' },
        } as unknown as ClientToolCall;
        const root = buildAgentRunTreeFromTurns([assistantTurn([persisted])]);
        expect(root.children[0]).toMatchObject({ id: 't1', name: 'research', role: 'general-purpose', status: 'running' });
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

    it('keeps full args when a later tool-complete snapshot has empty args', () => {
        // Real shape: toolCalls + timeline tool-start carry full args, but the
        // timeline tool-complete (same id, same terminal status) has empty args.
        const fullArgs = {
            agent_type: 'explore', name: 'time-agent-1',
            model: 'claude-sonnet-4.6', mode: 'background', description: 'Query current time',
        };
        const turns = [assistantTurn(
            [tc({ id: 't1', args: fullArgs, status: 'completed', result: 'ok' })],
            [
                { type: 'tool-start', timestamp: '2026-06-13T21:18:04.000Z', toolCall: tc({ id: 't1', args: fullArgs, status: 'running' }) },
                { type: 'tool-complete', timestamp: '2026-06-13T21:18:09.000Z', toolCall: tc({ id: 't1', args: {}, status: 'completed', result: 'ok' }) },
            ],
        )];
        const child = buildAgentRunTreeFromTurns(turns).children[0];
        expect(child).toMatchObject({
            id: 't1', name: 'time-agent-1', role: 'explore',
            model: 'claude-sonnet-4.6', mode: 'background', status: 'done',
        });
    });

    it('keeps the real start when the tool-complete snapshot re-stamps startTime to the finish time', () => {
        // useChatSSE stamps `startTime: now` on EVERY tool snapshot, so a
        // tool-complete carries a startTime equal to the *completion* moment.
        // The merge must keep the earliest start (the tool-start snapshot),
        // otherwise the sub-agent renders a bogus 0:00 duration in the canvas.
        const turns = [assistantTurn(
            [],
            [
                { type: 'tool-start', timestamp: '2026-06-13T10:00:00.000Z', toolCall: tc({ id: 't1', args: { description: 'work' }, status: 'running', startTime: '2026-06-13T10:00:00.000Z', endTime: undefined }) },
                { type: 'tool-complete', timestamp: '2026-06-13T10:00:44.000Z', toolCall: tc({ id: 't1', args: { description: 'work' }, status: 'completed', startTime: '2026-06-13T10:00:44.000Z', endTime: '2026-06-13T10:00:44.000Z', result: 'ok' }) },
            ],
        )];
        const child = buildAgentRunTreeFromTurns(turns).children[0];
        expect(child.status).toBe('done');
        expect(child.startedAt).toBe(Date.parse('2026-06-13T10:00:00.000Z'));
        expect(child.completedAt).toBe(Date.parse('2026-06-13T10:00:44.000Z'));
        // The whole point: a real, non-zero span survives the merge.
        expect(child.completedAt! - child.startedAt!).toBe(44_000);
    });

    it('uses read_agent final output for a background task result', () => {
        const finalResult = 'Build succeeded!\nLog: out/mcp/build/cosmosclient.74.log';
        const turns = [assistantTurn([
            tc({
                id: 'task-build',
                args: { name: 'build-and-test', mode: 'background', prompt: 'build it' },
                status: 'completed',
                startTime: '2026-06-13T10:00:00.000Z',
                endTime: '2026-06-13T10:00:01.000Z',
                result: 'Agent started in background with agent_id: build-and-test. You will be notified when it completes.',
            }),
            tc({
                id: 'read-build',
                toolName: 'read_agent',
                args: { agent_id: 'build-and-test', wait: true },
                status: 'completed',
                startTime: '2026-06-13T10:00:30.000Z',
                endTime: '2026-06-13T10:00:44.000Z',
                result: `Agent completed. agent_id: build-and-test, agent_type: task, status: completed\n\n${finalResult}`,
            }),
        ])];
        const child = buildAgentRunTreeFromTurns(turns).children[0];
        expect(child.result).toBe(finalResult);
        expect(child.summary).toBe('Build succeeded!');
        expect(child.completedAt).toBe(Date.parse('2026-06-13T10:00:44.000Z'));
    });

    it('keeps the start snapshot tool name when the read_agent completion snapshot is unknown', () => {
        const turns = [assistantTurn(
            [
                tc({
                    id: 'task-build',
                    args: { name: 'build-and-test', mode: 'background', prompt: 'build it' },
                    result: 'Agent started in background with agent_id: build-and-test.',
                }),
            ],
            [
                {
                    type: 'tool-start',
                    timestamp: '2026-06-13T10:00:30.000Z',
                    toolCall: tc({
                        id: 'read-build',
                        toolName: 'read_agent',
                        args: { agent_id: 'build-and-test', wait: true },
                        status: 'running',
                    }),
                },
                {
                    type: 'tool-complete',
                    timestamp: '2026-06-13T10:00:44.000Z',
                    toolCall: tc({
                        id: 'read-build',
                        toolName: 'unknown',
                        args: {},
                        status: 'completed',
                        result: 'Agent completed. agent_id: build-and-test\n\nFinal live result',
                    }),
                },
            ],
        )];
        expect(buildAgentRunTreeFromTurns(turns).children[0].result).toBe('Final live result');
    });

    it('matches read_agent final output to the correct background task by agent_id', () => {
        const root = buildAgentRunTreeFromTurns([assistantTurn([
            tc({
                id: 'task-a',
                args: { name: 'agent-a', mode: 'background', prompt: 'A' },
                result: 'Agent started in background with agent_id: agent-a.',
            }),
            tc({
                id: 'task-b',
                args: { name: 'agent-b', mode: 'background', prompt: 'B' },
                result: 'Agent started in background with agent_id: agent-b.',
            }),
            tc({
                id: 'read-b',
                toolName: 'read_agent',
                args: { agent_id: 'agent-b', wait: true },
                result: 'Agent completed. agent_id: agent-b\n\nBravo result',
            }),
            tc({
                id: 'read-a',
                toolName: 'read_agent',
                args: { agent_id: 'agent-a', wait: true },
                result: 'Agent completed. agent_id: agent-a\n\nAlpha result',
            }),
        ])]);
        const byId = new Map(root.children.map((child) => [child.id, child]));
        expect(byId.get('task-a')?.result).toBe('Alpha result');
        expect(byId.get('task-b')?.result).toBe('Bravo result');
    });

    it('prefers the earliest start / latest end across persisted and timeline snapshots', () => {
        // Persisted row has the true span; a later timeline snapshot re-stamps a
        // start at finish time. Earliest-start / latest-end keeps the true span
        // regardless of which snapshot the status-rank merge treats as "better".
        const turns = [assistantTurn(
            [tc({ id: 't1', args: { description: 'work' }, status: 'completed', startTime: '2026-06-13T10:00:00.000Z', endTime: '2026-06-13T10:00:30.000Z', result: 'ok' })],
            [
                { type: 'tool-complete', timestamp: '2026-06-13T10:00:44.000Z', toolCall: tc({ id: 't1', args: {}, status: 'completed', startTime: '2026-06-13T10:00:44.000Z', endTime: '2026-06-13T10:00:44.000Z', result: 'ok' }) },
            ],
        )];
        const child = buildAgentRunTreeFromTurns(turns).children[0];
        expect(child.startedAt).toBe(Date.parse('2026-06-13T10:00:00.000Z'));
        expect(child.completedAt).toBe(Date.parse('2026-06-13T10:00:44.000Z'));
    });

    it('still resolves a start when only the terminal snapshot carries a time', () => {
        // If the tool-start snapshot was missed, fall back to whatever time the
        // terminal snapshot has rather than dropping it.
        const turns = [assistantTurn(
            [tc({ id: 't1', args: { description: 'work' }, status: 'running', startTime: undefined, endTime: undefined })],
            [
                { type: 'tool-complete', timestamp: '2026-06-13T10:00:44.000Z', toolCall: tc({ id: 't1', args: { description: 'work' }, status: 'completed', startTime: '2026-06-13T10:00:44.000Z', endTime: '2026-06-13T10:00:44.000Z', result: 'ok' }) },
            ],
        )];
        const child = buildAgentRunTreeFromTurns(turns).children[0];
        expect(child.startedAt).toBe(Date.parse('2026-06-13T10:00:44.000Z'));
        expect(child.completedAt).toBe(Date.parse('2026-06-13T10:00:44.000Z'));
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

    it('nests a sub-agent under the sub-agent that spawned it (parentToolCallId)', () => {
        const turns = [assistantTurn([
            tc({ id: 'l1', args: { name: 'parent', agent_type: 'general-purpose' } }),
            tc({ id: 'l2', parentToolCallId: 'l1', args: { name: 'child', agent_type: 'task' } }),
        ])];
        const root = buildAgentRunTreeFromTurns(turns);
        // Only the L1 agent attaches to the orchestrator; L2 nests beneath it.
        expect(root.children.map((c) => c.id)).toEqual(['l1']);
        expect(root.children[0].children.map((c) => c.id)).toEqual(['l2']);
        expect(countRuns(root)).toBe(3); // root + l1 + l2
    });

    it('nests to arbitrary depth (L0 → L1 → L2 → L3)', () => {
        const turns = [assistantTurn([
            tc({ id: 'l1', args: { name: 'a' } }),
            tc({ id: 'l2', parentToolCallId: 'l1', args: { name: 'b' } }),
            tc({ id: 'l3', parentToolCallId: 'l2', args: { name: 'c' } }),
        ])];
        const root = buildAgentRunTreeFromTurns(turns);
        expect(root.children[0].id).toBe('l1');
        expect(root.children[0].children[0].id).toBe('l2');
        expect(root.children[0].children[0].children[0].id).toBe('l3');
        expect(countRuns(root)).toBe(4);
    });

    it('attaches a Task with an unknown parentToolCallId at the root level', () => {
        // parent id references a non-Task / missing tool call → don't drop it.
        const turns = [assistantTurn([
            tc({ id: 'orphan', parentToolCallId: 'does-not-exist', args: { name: 'orphan' } }),
        ])];
        const root = buildAgentRunTreeFromTurns(turns);
        expect(root.children.map((c) => c.id)).toEqual(['orphan']);
    });

    it('breaks parentToolCallId cycles without infinite recursion', () => {
        const turns = [assistantTurn([
            tc({ id: 'a', parentToolCallId: 'b', args: { name: 'a' } }),
            tc({ id: 'b', parentToolCallId: 'a', args: { name: 'b' } }),
        ])];
        const root = buildAgentRunTreeFromTurns(turns);
        // Neither can nest under the other; both fall back to root level.
        expect(root.children.map((c) => c.id).sort()).toEqual(['a', 'b']);
        expect(countRuns(root)).toBe(3);
    });

    it('derives root status from a deeply-nested running descendant', () => {
        const turns = [assistantTurn([
            tc({ id: 'l1', status: 'completed', args: { name: 'a' } }),
            tc({ id: 'l2', parentToolCallId: 'l1', status: 'running', args: { name: 'b' } }),
        ])];
        // No explicit root status → a running L2 keeps the orchestrator "running".
        expect(buildAgentRunTreeFromTurns(turns).status).toBe('running');
    });

    it('orders nested children by start time too', () => {
        const turns = [assistantTurn([
            tc({ id: 'p', args: { name: 'p' } }),
            tc({ id: 'late', parentToolCallId: 'p', args: { name: 'late' }, startTime: '2026-06-13T10:05:00.000Z' }),
            tc({ id: 'early', parentToolCallId: 'p', args: { name: 'early' }, startTime: '2026-06-13T10:01:00.000Z' }),
        ])];
        const parent = buildAgentRunTreeFromTurns(turns).children[0];
        expect(parent.children.map((c) => c.id)).toEqual(['early', 'late']);
    });
});

describe('findTurnIndexForRun', () => {
    it('returns the data-turn-index of the turn that issued the run', () => {
        const turns = [
            { role: 'user' as const, content: 'go', timeline: [], turnIndex: 0 },
            assistantTurn([tc({ id: 't1', args: { description: 'x' } })], []),
        ];
        // second turn has no explicit turnIndex → falls back to array index 1
        expect(findTurnIndexForRun(turns, 't1')).toBe(1);
    });

    it('prefers an explicit turn.turnIndex over the array index', () => {
        const turns = [
            { ...assistantTurn([tc({ id: 't1', args: { description: 'x' } })]), turnIndex: 7 },
        ];
        expect(findTurnIndexForRun(turns, 't1')).toBe(7);
    });

    it('matches a run found only in the timeline', () => {
        const turns = [assistantTurn([], [{
            type: 'tool-complete',
            timestamp: '2026-06-13T10:00:00.000Z',
            toolCall: tc({ id: 't9', args: {}, status: 'completed' }),
        }])];
        expect(findTurnIndexForRun(turns, 't9')).toBe(0);
    });

    it('returns null when the run is not present', () => {
        expect(findTurnIndexForRun([assistantTurn([tc({ id: 't1', args: {} })])], 'missing')).toBeNull();
        expect(findTurnIndexForRun(undefined, 't1')).toBeNull();
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
