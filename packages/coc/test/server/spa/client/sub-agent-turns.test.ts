import { describe, it, expect } from 'vitest';
import { buildSubAgentTurns } from '../../../../src/server/spa/client/react/features/chat/agent-canvas/buildSubAgentTurns';
import type { ClientConversationTurn, ClientTimelineItem, ClientToolCall } from '../../../../src/server/spa/client/react/types/dashboard';

function tc(p: Partial<ClientToolCall> & { id: string }): ClientToolCall {
    return { toolName: 'bash', args: {}, status: 'completed', ...p };
}
function tl(type: ClientTimelineItem['type'], toolCall: ClientToolCall): ClientTimelineItem {
    return { type, timestamp: '2026-06-13T10:00:00.000Z', toolCall };
}
function assistantTurn(
    toolCalls: ClientToolCall[],
    timeline: ClientTimelineItem[] = [],
): ClientConversationTurn {
    return { role: 'assistant', content: '', timeline, toolCalls };
}

// orchestrator → sub-1 → (b1, sub-2 → g1); `orch` is an orchestrator-level step.
function fixture(): ClientConversationTurn[] {
    return [assistantTurn([
        tc({ id: 'sub-1', toolName: 'task', args: { name: 'agent-1', prompt: 'do the thing' }, result: 'sub-1 done' }),
        tc({ id: 'b1', toolName: 'bash', parentToolCallId: 'sub-1', args: { command: 'ls' } }),
        tc({ id: 'sub-2', toolName: 'task', parentToolCallId: 'sub-1', args: { name: 'agent-2', prompt: 'nested thing' }, result: 'sub-2 done' }),
        tc({ id: 'g1', toolName: 'view', parentToolCallId: 'sub-2', args: { file_path: '/a' } }),
        tc({ id: 'orch', toolName: 'bash', args: { command: 'pwd' } }),
    ])];
}

describe('buildSubAgentTurns', () => {
    it('emits a user turn (prompt) and an assistant turn (result)', () => {
        const [user, assistant] = buildSubAgentTurns(fixture(), 'sub-1');
        expect(user).toMatchObject({ role: 'user', content: 'do the thing' });
        expect(assistant).toMatchObject({ role: 'assistant', content: 'sub-1 done' });
    });

    it('includes the full descendant subtree, excluding the sub-agent itself and unrelated steps', () => {
        const [, assistant] = buildSubAgentTurns(fixture(), 'sub-1');
        const ids = (assistant.toolCalls || []).map((c) => c.id).sort();
        expect(ids).toEqual(['b1', 'g1', 'sub-2']); // b1 + nested sub-2 + sub-2's child g1
        expect(ids).not.toContain('sub-1'); // never include the sub-agent's own Task call
        expect(ids).not.toContain('orch'); // never include orchestrator-level steps
    });

    it('includes a nested sub-agent as a Task tool call (renders as a card)', () => {
        const [, assistant] = buildSubAgentTurns(fixture(), 'sub-1');
        const nested = (assistant.toolCalls || []).find((c) => c.id === 'sub-2');
        expect(nested?.toolName).toBe('task');
    });

    it('retains parentToolCallId on the filtered steps (load-bearing for re-rooting)', () => {
        const [, assistant] = buildSubAgentTurns(fixture(), 'sub-1');
        const b1 = (assistant.toolCalls || []).find((c) => c.id === 'b1');
        expect(b1?.parentToolCallId).toBe('sub-1');
        const g1 = (assistant.toolCalls || []).find((c) => c.id === 'g1');
        expect(g1?.parentToolCallId).toBe('sub-2');
    });

    it('scopes to a deeper sub-agent when that id is selected', () => {
        const [user, assistant] = buildSubAgentTurns(fixture(), 'sub-2');
        expect(user.content).toBe('nested thing');
        expect((assistant.toolCalls || []).map((c) => c.id)).toEqual(['g1']);
    });

    it('filters the timeline to the sub-agent\'s steps, preserving order', () => {
        const turns = [assistantTurn(
            [
                tc({ id: 'sub-1', toolName: 'task', args: { prompt: 'p' }, result: 'r' }),
                tc({ id: 'b1', toolName: 'bash', parentToolCallId: 'sub-1' }),
            ],
            [
                tl('tool-start', tc({ id: 'b1', toolName: 'bash', parentToolCallId: 'sub-1', status: 'running' })),
                tl('tool-start', tc({ id: 'orch', toolName: 'bash' })),
                tl('tool-complete', tc({ id: 'b1', toolName: 'bash', parentToolCallId: 'sub-1' })),
            ],
        )];
        const [, assistant] = buildSubAgentTurns(turns, 'sub-1');
        expect(assistant.timeline.map((it) => `${it.type}:${it.toolCall?.id}`))
            .toEqual(['tool-start:b1', 'tool-complete:b1']); // 'orch' excluded, order kept
    });

    it('handles a background-mode stub result with no captured steps', () => {
        const turns = [assistantTurn([
            tc({ id: 'bg', toolName: 'task', args: { name: 'b', mode: 'background', prompt: 'p' }, result: 'Agent started in background with agent_id: b.' }),
        ])];
        const [user, assistant] = buildSubAgentTurns(turns, 'bg');
        expect(user.content).toBe('p');
        expect(assistant.content).toContain('started in background');
        expect(assistant.toolCalls).toEqual([]);
    });

    it('returns a valid pair for a sub-agent with zero child steps', () => {
        const turns = [assistantTurn([
            tc({ id: 'lonely', toolName: 'task', args: { prompt: 'just me' }, result: 'ok' }),
        ])];
        const [user, assistant] = buildSubAgentTurns(turns, 'lonely');
        expect(user.content).toBe('just me');
        expect(assistant.content).toBe('ok');
        expect(assistant.toolCalls).toEqual([]);
    });

    it('falls back to the description when no prompt is present', () => {
        const turns = [assistantTurn([
            tc({ id: 's', toolName: 'task', args: { description: 'the description' }, result: 'r' }),
        ])];
        expect(buildSubAgentTurns(turns, 's')[0].content).toBe('the description');
    });

    it('returns [] for an unknown sub-agent id', () => {
        expect(buildSubAgentTurns(fixture(), 'nope')).toEqual([]);
        expect(buildSubAgentTurns(undefined, 'x')).toEqual([]);
    });

    it('dedupes a child seen in both toolCalls and the timeline, keeping non-empty args', () => {
        const turns = [assistantTurn(
            [
                tc({ id: 'sub-1', toolName: 'task', args: { prompt: 'p' }, result: 'r' }),
                tc({ id: 'b1', toolName: 'bash', parentToolCallId: 'sub-1', args: { command: 'ls -la' } }),
            ],
            [
                // terminal snapshot drops args + parent — must not clobber the full one
                tl('tool-complete', { id: 'b1', toolName: 'bash', args: {}, status: 'completed' }),
            ],
        )];
        const calls = buildSubAgentTurns(turns, 'sub-1')[1].toolCalls || [];
        const b1 = calls.filter((c) => c.id === 'b1');
        expect(b1).toHaveLength(1);
        expect(b1[0].args).toEqual({ command: 'ls -la' });
        expect(b1[0].parentToolCallId).toBe('sub-1');
    });
});
