import { describe, it, expect } from 'vitest';
import type { ToolEvent } from '../../src/types';
import {
    createSubAgentToolEvents,
    createSubAgentMock,
    formatBackgroundStartedResult,
    formatAgentCompletedResult,
    readAgentToolCallId,
} from '../../src/testing/index';
import type { SubAgentSpec } from '../../src/testing/index';

/** Find the single event for a (toolCallId, type) pair. */
function evt(events: ToolEvent[], toolCallId: string, type: ToolEvent['type']): ToolEvent {
    const match = events.find((e) => e.toolCallId === toolCallId && e.type === type);
    if (!match) {
        throw new Error(`no ${type} event for ${toolCallId} in ${JSON.stringify(events)}`);
    }
    return match;
}

describe('createSubAgentToolEvents — synchronous', () => {
    it('emits a Task start + complete whose own result is the output', () => {
        const events = createSubAgentToolEvents([
            { id: 't1', agentType: 'Explore', description: 'map data model', result: 'all green' },
        ]);
        expect(events).toEqual([
            {
                type: 'tool-start',
                toolCallId: 't1',
                toolName: 'Task',
                parameters: { agent_type: 'Explore', description: 'map data model' },
            },
            {
                type: 'tool-complete',
                toolCallId: 't1',
                toolName: 'Task',
                result: 'all green',
            },
        ]);
    });

    it('forwards name/model/mode/prompt into the Task start parameters', () => {
        const [start] = createSubAgentToolEvents([{
            id: 't1',
            agentType: 'explore',
            name: 'time-agent-1',
            description: 'Query current time',
            model: 'claude-sonnet-4.6',
            mode: 'background',
            prompt: 'Query the current date and time.',
        }]);
        expect(start.parameters).toEqual({
            agent_type: 'explore',
            name: 'time-agent-1',
            description: 'Query current time',
            model: 'claude-sonnet-4.6',
            mode: 'background',
            prompt: 'Query the current date and time.',
        });
    });

    it('defaults a missing result to an empty string', () => {
        const events = createSubAgentToolEvents([{ id: 't1', name: 'a' }]);
        expect(evt(events, 't1', 'tool-complete').result).toBe('');
    });
});

describe('createSubAgentToolEvents — failed', () => {
    it('emits tool-failed with an error for a failed sync sub-agent', () => {
        const events = createSubAgentToolEvents([
            { id: 't1', name: 'a', status: 'failed', result: 'boom' },
        ]);
        expect(events.map((e) => e.type)).toEqual(['tool-start', 'tool-failed']);
        const failed = evt(events, 't1', 'tool-failed');
        expect(failed.error).toBe('boom');
        expect(failed.result).toBeUndefined();
    });

    it('falls back to a generic error message when no result is given', () => {
        const events = createSubAgentToolEvents([{ id: 't1', status: 'failed' }]);
        expect(evt(events, 't1', 'tool-failed').error).toBe('Sub-agent failed');
    });
});

describe('createSubAgentToolEvents — background', () => {
    it('emits a Task ack carrying agent_id plus a matching read_agent completion', () => {
        const events = createSubAgentToolEvents([{
            id: 'task-build',
            kind: 'background',
            agentType: 'task',
            name: 'build-and-test',
            prompt: 'build it',
            result: 'Build succeeded!',
        }]);

        // Task ack — completes immediately, carries the agent_id for wiring.
        const ack = evt(events, 'task-build', 'tool-complete');
        expect(ack.toolName).toBe('Task');
        expect(ack.result).toBe(
            'Agent started in background with agent_id: task-build. You will be notified when it completes.',
        );

        // read_agent — keyed by the same agent_id, carries the final output.
        const readId = readAgentToolCallId('task-build');
        const raStart = evt(events, readId, 'tool-start');
        expect(raStart.toolName).toBe('read_agent');
        expect(raStart.parameters).toEqual({ agent_id: 'task-build', wait: true });

        const raDone = evt(events, readId, 'tool-complete');
        expect(raDone.toolName).toBe('read_agent');
        expect(raDone.result).toBe(
            'Agent completed. agent_id: task-build, agent_type: task, status: completed\n\nBuild succeeded!',
        );
    });

    it('defaults the background Task mode to "background"', () => {
        const [start] = createSubAgentToolEvents([{ id: 't1', kind: 'background', name: 'a' }]);
        expect((start.parameters as Record<string, unknown>).mode).toBe('background');
    });

    it('keys the read_agent completion by an explicit agentId when provided', () => {
        const events = createSubAgentToolEvents([{
            id: 'task-a', kind: 'background', agentId: 'agent-a', result: 'Alpha',
        }]);
        expect(evt(events, 'task-a', 'tool-complete').result).toContain('agent_id: agent-a');
        const raDone = evt(events, readAgentToolCallId('task-a'), 'tool-complete');
        expect(raDone.result).toContain('agent_id: agent-a');
        expect(raDone.result).toContain('Alpha');
    });

    it('reports a failed background agent through the read_agent terminal string', () => {
        const events = createSubAgentToolEvents([{
            id: 'task-x', kind: 'background', status: 'failed', result: 'it broke',
        }]);
        // The Task ack still succeeds — only the launch is acknowledged.
        expect(evt(events, 'task-x', 'tool-complete').result).toContain('agent_id: task-x');
        const raDone = evt(events, readAgentToolCallId('task-x'), 'tool-complete');
        expect(raDone.result).toContain('Agent failed.');
        expect(raDone.result).toContain('status: failed');
        expect(raDone.result).toContain('it broke');
    });
});

describe('createSubAgentToolEvents — nesting', () => {
    it("links a child Task's parentToolCallId to its parent and nests its lifecycle inside", () => {
        const events = createSubAgentToolEvents([{
            id: 'l1', name: 'parent', agentType: 'general-purpose',
            children: [{ id: 'l2', name: 'child', agentType: 'task', result: 'child done' }],
        }]);

        const childStart = evt(events, 'l2', 'tool-start');
        expect(childStart.parentToolCallId).toBe('l1');

        // Parent start … child lifecycle … parent complete.
        const order = events.map((e) => `${e.toolCallId}:${e.type}`);
        expect(order).toEqual([
            'l1:tool-start',
            'l2:tool-start',
            'l2:tool-complete',
            'l1:tool-complete',
        ]);
    });

    it('does not set parentToolCallId on a top-level spec without parentId', () => {
        const [start] = createSubAgentToolEvents([{ id: 't1', name: 'a' }]);
        expect(start.parentToolCallId).toBeUndefined();
    });

    it('honors a parentId declared on a top-level spec', () => {
        const events = createSubAgentToolEvents([
            { id: 'l1', name: 'a' },
            { id: 'l2', name: 'b', parentId: 'l1' },
        ]);
        expect(evt(events, 'l2', 'tool-start').parentToolCallId).toBe('l1');
    });

    it('overrides a child-declared parentId with the actual parent id', () => {
        const events = createSubAgentToolEvents([{
            id: 'l1', name: 'a',
            children: [{ id: 'l2', name: 'b', parentId: 'someone-else' }],
        }]);
        expect(evt(events, 'l2', 'tool-start').parentToolCallId).toBe('l1');
    });

    it('nests to arbitrary depth (L1 → L2 → L3)', () => {
        const events = createSubAgentToolEvents([{
            id: 'l1', name: 'a',
            children: [{
                id: 'l2', name: 'b',
                children: [{ id: 'l3', name: 'c' }],
            }],
        }]);
        expect(evt(events, 'l2', 'tool-start').parentToolCallId).toBe('l1');
        expect(evt(events, 'l3', 'tool-start').parentToolCallId).toBe('l2');
    });
});

describe('createSubAgentToolEvents — multiple top-level specs', () => {
    it('emits each spec in order', () => {
        const specs: SubAgentSpec[] = [
            { id: 'a', name: 'A', result: 'ra' },
            { id: 'b', kind: 'background', agentId: 'agent-b', result: 'rb' },
        ];
        const events = createSubAgentToolEvents(specs);
        const ids = events.map((e) => e.toolCallId);
        // sync 'a' → start+complete; background 'b' → start+ack, then read pair.
        expect(ids).toEqual(['a', 'a', 'b', 'b', readAgentToolCallId('b'), readAgentToolCallId('b')]);
    });
});

describe('result-string formatters', () => {
    it('formatBackgroundStartedResult embeds a whitespace-free agent_id', () => {
        expect(formatBackgroundStartedResult('agent-7')).toBe(
            'Agent started in background with agent_id: agent-7. You will be notified when it completes.',
        );
    });

    it('formatAgentCompletedResult defaults status to completed and agent_type to task', () => {
        expect(formatAgentCompletedResult({ agentId: 'a1', output: 'hi' })).toBe(
            'Agent completed. agent_id: a1, agent_type: task, status: completed\n\nhi',
        );
    });

    it('formatAgentCompletedResult honors an explicit status and agent_type', () => {
        expect(formatAgentCompletedResult({
            agentId: 'a1', agentType: 'explore', status: 'failed', output: 'oops',
        })).toBe('Agent failed. agent_id: a1, agent_type: explore, status: failed\n\noops');
    });
});

describe('createSubAgentMock', () => {
    it('fires the produced tool events via onToolEvent, then resolves success', async () => {
        const { service } = createSubAgentMock([
            { id: 't1', agentType: 'Explore', description: 'map', result: 'done' },
        ]);
        const received: ToolEvent[] = [];
        const res = await service.sendMessage({
            prompt: 'go',
            onToolEvent: (e) => received.push(e),
        } as never);

        expect(received).toEqual(createSubAgentToolEvents([
            { id: 't1', agentType: 'Explore', description: 'map', result: 'done' },
        ]));
        expect(res).toMatchObject({ success: true });
    });

    it('locates onToolEvent across direct call shapes (sid, msg, opts)', async () => {
        // The service router forwards only its first arg, so a multi-arg call
        // shape is exercised by invoking the implementation handle directly.
        const { mockSendMessage } = createSubAgentMock([{ id: 't1', name: 'a' }]);
        const received: ToolEvent[] = [];
        await (mockSendMessage as unknown as (...a: unknown[]) => Promise<unknown>)(
            'sid-1',
            'follow up',
            { onToolEvent: (e: ToolEvent) => received.push(e) },
        );
        expect(received.map((e) => e.toolCallId)).toEqual(['t1', 't1']);
    });

    it('resolves success even when no onToolEvent handler is supplied', async () => {
        const { service } = createSubAgentMock([{ id: 't1', name: 'a' }]);
        const res = await service.sendMessage({ prompt: 'go' } as never);
        expect(res).toMatchObject({ success: true });
    });
});
