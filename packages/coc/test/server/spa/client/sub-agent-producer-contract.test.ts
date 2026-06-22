/**
 * Producer ↔ parser contract guard.
 *
 * `createSubAgentToolEvents` (in `@plusplusoneplusplus/coc-agent-sdk/testing`) is
 * the SINGLE source for the two result-string formats the chat agent-canvas
 * parser consumes:
 *   - the background-startup acknowledgement carrying `agent_id: <id>`
 *     (read by `STARTED_AGENT_ID_RE` in agentToolCalls.ts), and
 *   - the `read_agent` terminal completion `Agent <status>.\n\n<output>`
 *     (read by `READ_AGENT_TERMINAL_RE`).
 *
 * Those two regexes are intentionally NOT exported (the parser is out of scope
 * for changes), so this guard validates the producer's strings through the real
 * parser: `buildAgentCompletionByTaskId` only keys a Task's id to its final
 * output when BOTH regexes match (the Task ack must yield an `agent_id` and the
 * matching `read_agent` result must yield a clean body). If either format drifts
 * from what the parser expects, the extracted body falls back to the raw string
 * and these assertions fail — locking producer and parser in lockstep.
 */

import { describe, it, expect } from 'vitest';
import {
    createSubAgentToolEvents,
    formatBackgroundStartedResult,
    formatAgentCompletedResult,
    type SubAgentSpec,
} from '@plusplusoneplusplus/coc-agent-sdk/testing';
import type { ToolEvent } from '@plusplusoneplusplus/coc-agent-sdk';
import {
    buildAgentCompletionByTaskId,
    collectToolCalls,
} from '../../../../src/server/spa/client/react/features/chat/agent-canvas/agentToolCalls';
import {
    buildAgentRunTreeFromTurns,
    countRuns,
} from '../../../../src/server/spa/client/react/features/chat/agent-canvas/buildAgentRunTree';
import type {
    ClientConversationTurn,
    ClientToolCall,
    ClientTimelineItem,
} from '../../../../src/server/spa/client/react/types/dashboard';

// ---------------------------------------------------------------------------
// Adapter: producer ToolEvent[] → the persisted turn the parser reads back.
//
// Mirrors base-executor's `buildToolEventHandler`: every event becomes one
// timeline item whose `toolCall` carries running/completed/failed status, args
// from `parameters`, the result/error, and any `parentToolCallId`. The parser's
// `collectToolCalls` dedups a tool-start + tool-complete pair by id, merging the
// start's args with the completion's result — exactly the real pipeline shape.
// ---------------------------------------------------------------------------

const T0 = Date.parse('2026-06-22T10:00:00.000Z');

function eventsToTurn(events: ToolEvent[]): ClientConversationTurn {
    const timeline: ClientTimelineItem[] = events.map((evt, i) => {
        const ts = new Date(T0 + i * 1000).toISOString();
        const status: ClientToolCall['status'] = evt.type === 'tool-start'
            ? 'running'
            : evt.type === 'tool-complete' ? 'completed' : 'failed';
        const toolCall: ClientToolCall = {
            id: evt.toolCallId,
            toolName: evt.toolName ?? 'unknown',
            args: evt.parameters ?? {},
            status,
            startTime: ts,
            ...(evt.type !== 'tool-start' ? { endTime: ts } : {}),
            ...(evt.result !== undefined ? { result: evt.result } : {}),
            ...(evt.error !== undefined ? { error: evt.error } : {}),
            ...(evt.parentToolCallId ? { parentToolCallId: evt.parentToolCallId } : {}),
        };
        return { type: evt.type, timestamp: ts, toolCall };
    });
    return { role: 'assistant', content: '', timeline };
}

function completionsFor(specs: SubAgentSpec[]) {
    const turn = eventsToTurn(createSubAgentToolEvents(specs));
    return buildAgentCompletionByTaskId(collectToolCalls([turn]));
}

describe('sub-agent producer ↔ parser contract', () => {
    it('background ack + read_agent completion are parsed by the real parser (STARTED_AGENT_ID_RE + READ_AGENT_TERMINAL_RE)', () => {
        const output = 'Build succeeded.\nAll tests pass.';
        const byTaskId = completionsFor([
            { id: 'bg-ok', kind: 'background', agentType: 'builder', name: 'build-and-test', prompt: 'build it', result: output },
        ]);

        // The Task id is keyed to its final output ONLY when both regexes match:
        // the ack yields `agent_id: bg-ok` and the read_agent result yields the
        // clean body (header stripped). If READ_AGENT_TERMINAL_RE had missed,
        // `result` would still contain the `Agent completed.` header line.
        const completion = byTaskId.get('bg-ok');
        expect(completion).toBeDefined();
        expect(completion!.result).toBe(output);
        expect(completion!.result).not.toContain('Agent completed.');
        expect(completion!.result).not.toContain('agent_id:');
    });

    it('a failed background agent surfaces the failed body (Agent failed. header is stripped)', () => {
        const byTaskId = completionsFor([
            { id: 'bg-bad', kind: 'background', agentType: 'builder', name: 'flaky', result: 'Compilation error', status: 'failed' },
        ]);
        const completion = byTaskId.get('bg-bad');
        expect(completion).toBeDefined();
        expect(completion!.result).toBe('Compilation error');
        expect(completion!.result).not.toContain('Agent failed.');
    });

    it('the formatters wire the same agent_id into the ack and the read_agent call', () => {
        // Cross-check the two single-source formatters against the emitted events
        // so a drift between them (which would silently break the agent_id link)
        // is caught here, not only through the parser round-trip above.
        const events = createSubAgentToolEvents([
            { id: 'task-1', kind: 'background', agentId: 'agent-xyz', agentType: 'explore', result: 'done' },
        ]);
        const ack = events.find((e) => e.toolName === 'Task' && e.type === 'tool-complete');
        const readStart = events.find((e) => e.toolName === 'read_agent' && e.type === 'tool-start');
        const readDone = events.find((e) => e.toolName === 'read_agent' && e.type === 'tool-complete');
        expect(ack!.result).toBe(formatBackgroundStartedResult('agent-xyz'));
        expect(ack!.result).toContain('agent_id: agent-xyz');
        expect((readStart!.parameters as { agent_id?: string }).agent_id).toBe('agent-xyz');
        expect(readDone!.result).toBe(formatAgentCompletedResult({
            agentId: 'agent-xyz', agentType: 'explore', status: 'completed', output: 'done',
        }));
    });

    it('the agent_id is matched across distinct background agents (no cross-talk)', () => {
        const byTaskId = completionsFor([
            { id: 'a', kind: 'background', agentType: 'task', agentId: 'agent-a', result: 'Alpha result' },
            { id: 'b', kind: 'background', agentType: 'task', agentId: 'agent-b', result: 'Bravo result' },
        ]);
        expect(byTaskId.get('a')!.result).toBe('Alpha result');
        expect(byTaskId.get('b')!.result).toBe('Bravo result');
    });
});

describe('sub-agent producer ↔ buildAgentRunTreeFromTurns (display) agreement', () => {
    const specs: SubAgentSpec[] = [
        {
            id: 'sync-ok',
            kind: 'sync',
            agentType: 'Explore',
            name: 'mapper',
            description: 'map the data model',
            model: 'claude-sonnet-4.6',
            result: 'Found 3 entities.',
        },
        {
            id: 'sync-bad',
            kind: 'sync',
            agentType: 'general-purpose',
            description: 'risky probe',
            status: 'failed',
            result: 'boom',
        },
        {
            id: 'bg-ok',
            kind: 'background',
            agentType: 'builder',
            name: 'build-and-test',
            prompt: 'build it',
            result: 'Build succeeded.\nAll tests pass.',
            children: [
                { id: 'bg-child', kind: 'sync', agentType: 'reviewer', description: 'review the diff', result: 'LGTM' },
            ],
        },
    ];

    function tree() {
        return buildAgentRunTreeFromTurns([eventsToTurn(createSubAgentToolEvents(specs))], { status: 'completed' });
    }

    it('emits one node per Task (read_agent calls are not nodes) at the right depth', () => {
        const root = tree();
        // 3 top-level Tasks + 1 nested child = 4 Task nodes + the orchestrator root.
        expect(countRuns(root)).toBe(5);
        expect(root.children.map((c) => c.id).sort()).toEqual(['bg-ok', 'sync-bad', 'sync-ok']);
        const bgOk = root.children.find((c) => c.id === 'bg-ok')!;
        expect(bgOk.children.map((c) => c.id)).toEqual(['bg-child']);
    });

    it('reads role/name/model and the sync Task result straight from the producer', () => {
        const syncOk = tree().children.find((c) => c.id === 'sync-ok')!;
        expect(syncOk).toMatchObject({
            name: 'mapper',
            role: 'Explore',
            model: 'claude-sonnet-4.6',
            status: 'done',
            result: 'Found 3 entities.',
            summary: 'Found 3 entities.',
        });
    });

    it('marks a failed sync Task failed', () => {
        const syncBad = tree().children.find((c) => c.id === 'sync-bad')!;
        expect(syncBad.status).toBe('failed');
        expect(syncBad.name).toBe('risky probe');
        expect(syncBad.role).toBe('general-purpose');
    });

    it('uses the read_agent body (matched by agent_id) as the background node result', () => {
        const bgOk = tree().children.find((c) => c.id === 'bg-ok')!;
        expect(bgOk.role).toBe('builder');
        // The Task ack completed, so the node is done; its output is the
        // read_agent body resolved by agent_id, not the ack string.
        expect(bgOk.status).toBe('done');
        expect(bgOk.result).toBe('Build succeeded.\nAll tests pass.');
        expect(bgOk.summary).toBe('Build succeeded.');
    });

    it('nests the child sub-agent under the Task that spawned it', () => {
        const bgChild = tree().children.find((c) => c.id === 'bg-ok')!.children[0];
        expect(bgChild).toMatchObject({
            id: 'bg-child',
            name: 'review the diff',
            role: 'reviewer',
            result: 'LGTM',
        });
    });
});
