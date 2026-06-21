/**
 * Tests for the finalize-orphaned-turn helper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    finalizeOrphanedProcess,
    sweepOrphanedRunningProcesses,
    collectResumableFollowUpProcessIds,
} from '../../src/server/processes/finalize-orphaned-turn';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { ConversationTurn } from '@plusplusoneplusplus/forge';

function asMock(store: ReturnType<typeof createMockProcessStore>) {
    // The mock store's appendConversationTurn returns { turn, allTurns }; we
    // also patch in a getConversationTurns helper that the production helper
    // expects to find.
    (store as any).getConversationTurns = vi.fn(async (id: string) => {
        return store.processes.get(id)?.conversationTurns ?? [];
    });
    return store;
}

describe('finalizeOrphanedProcess', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = asMock(createMockProcessStore());
    });

    it('replaces an orphaned streaming turn with a finalized turn and updates status', async () => {
        const streamingContent = 'Mid-stream assistant output before the SDK died';
        const turns: ConversationTurn[] = [
            { role: 'user', content: 'hi', timestamp: new Date(), turnIndex: 0, timeline: [] },
            { role: 'assistant', content: streamingContent, timestamp: new Date(), turnIndex: 1, timeline: [], streaming: true },
        ];
        store.processes.set('p1', {
            id: 'p1',
            type: 'clarification',
            promptPreview: '',
            fullPrompt: '',
            status: 'running',
            startTime: new Date(),
            conversationTurns: turns,
        } as any);

        await finalizeOrphanedProcess(store, 'p1', 'forced fail');

        const proc = store.processes.get('p1')!;
        expect(proc.status).toBe('failed');
        expect(proc.error).toBe('forced fail');
        expect(proc.endTime).toBeInstanceOf(Date);

        const assistantTurns = (proc.conversationTurns ?? []).filter(t => t.role === 'assistant');
        expect(assistantTurns).toHaveLength(1);
        expect(assistantTurns[0].content).toBe(streamingContent);
        expect(assistantTurns[0].streaming).toBeFalsy();
        expect(assistantTurns[0].interrupted).toBe(true);
        expect(assistantTurns[0].interruptionReason).toBe('forced fail');
    });

    it('falls back to status-only update when there is no orphaned streaming turn', async () => {
        store.processes.set('p2', {
            id: 'p2',
            type: 'clarification',
            promptPreview: '',
            fullPrompt: '',
            status: 'running',
            startTime: new Date(),
            conversationTurns: [
                { role: 'user', content: 'hi', timestamp: new Date(), turnIndex: 0, timeline: [] },
            ],
        } as any);

        await finalizeOrphanedProcess(store, 'p2', 'forced fail');

        const proc = store.processes.get('p2')!;
        expect(proc.status).toBe('failed');
        expect(proc.error).toBe('forced fail');
        // No assistant turn was appended
        expect((proc.conversationTurns ?? []).filter(t => t.role === 'assistant')).toHaveLength(0);
    });

    it('marks status as cancelled without an error message when requested', async () => {
        store.processes.set('p3', {
            id: 'p3',
            type: 'clarification',
            promptPreview: '',
            fullPrompt: '',
            status: 'cancelling',
            startTime: new Date(),
            conversationTurns: [],
        } as any);

        await finalizeOrphanedProcess(store, 'p3', 'ignored', { status: 'cancelled' });

        const proc = store.processes.get('p3')!;
        expect(proc.status).toBe('cancelled');
        expect(proc.error).toBeUndefined();
    });

    it('does not throw when the process does not exist in the store', async () => {
        await expect(
            finalizeOrphanedProcess(store, 'missing', 'forced fail'),
        ).resolves.toBeUndefined();
    });

    it('falls back when appendConversationTurn throws', async () => {
        store.processes.set('p4', {
            id: 'p4',
            type: 'clarification',
            promptPreview: '',
            fullPrompt: '',
            status: 'running',
            startTime: new Date(),
            conversationTurns: [
                { role: 'assistant', content: 'partial', timestamp: new Date(), turnIndex: 0, timeline: [], streaming: true },
            ],
        } as any);

        (store as any).appendConversationTurn = vi.fn().mockRejectedValue(new Error('boom'));

        await finalizeOrphanedProcess(store, 'p4', 'forced fail');

        const proc = store.processes.get('p4')!;
        expect(proc.status).toBe('failed');
        expect(proc.error).toBe('forced fail');
    });
});

describe('sweepOrphanedRunningProcesses', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = asMock(createMockProcessStore());
    });

    it('finalizes all running and cancelling processes at startup', async () => {
        store.processes.set('p1', {
            id: 'p1', type: 'clarification', promptPreview: '', fullPrompt: '',
            status: 'running', startTime: new Date(),
            conversationTurns: [],
        } as any);
        store.processes.set('p2', {
            id: 'p2', type: 'clarification', promptPreview: '', fullPrompt: '',
            status: 'cancelling', startTime: new Date(),
            conversationTurns: [],
        } as any);
        store.processes.set('p3', {
            id: 'p3', type: 'clarification', promptPreview: '', fullPrompt: '',
            status: 'completed', startTime: new Date(), endTime: new Date(),
            conversationTurns: [],
        } as any);

        const result = await sweepOrphanedRunningProcesses(store);
        expect(result).toEqual({ finalized: 2, revived: 0 });

        expect(store.processes.get('p1')!.status).toBe('failed');
        expect(store.processes.get('p2')!.status).toBe('cancelled');
        // Completed process untouched
        expect(store.processes.get('p3')!.status).toBe('completed');
    });

    it('returns 0 when there are no running processes', async () => {
        store.processes.set('p1', {
            id: 'p1', type: 'clarification', promptPreview: '', fullPrompt: '',
            status: 'completed', startTime: new Date(), endTime: new Date(),
            conversationTurns: [],
        } as any);

        const result = await sweepOrphanedRunningProcesses(store);
        expect(result).toEqual({ finalized: 0, revived: 0 });
    });

    it('preserves accumulated assistant content from streaming turns', async () => {
        store.processes.set('p1', {
            id: 'p1', type: 'clarification', promptPreview: '', fullPrompt: '',
            status: 'running', startTime: new Date(),
            conversationTurns: [
                { role: 'user', content: 'hi', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'A lot of work done before crash', timestamp: new Date(), turnIndex: 1, timeline: [], streaming: true },
            ],
        } as any);

        await sweepOrphanedRunningProcesses(store);

        const proc = store.processes.get('p1')!;
        expect(proc.status).toBe('failed');
        const assistantTurns = (proc.conversationTurns ?? []).filter(t => t.role === 'assistant');
        expect(assistantTurns).toHaveLength(1);
        expect(assistantTurns[0].content).toBe('A lot of work done before crash');
        expect(assistantTurns[0].streaming).toBeFalsy();
        expect(assistantTurns[0].interrupted).toBe(true);
        expect(assistantTurns[0].interruptionReason).toBe('Process orphaned by server restart');
    });

    it('revives a protected running process to queued instead of failing it', async () => {
        // Regression: a chat follow-up re-enqueued by queue restore points its
        // payload.processId back at this conversation, so the process is
        // recoverable. The sweep must NOT mark it failed.
        store.processes.set('p1', {
            id: 'p1', type: 'chat', promptPreview: '', fullPrompt: '',
            status: 'running', startTime: new Date(),
            conversationTurns: [
                { role: 'user', content: 'hi', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'partial', timestamp: new Date(), turnIndex: 1, timeline: [], streaming: true },
            ],
        } as any);

        const result = await sweepOrphanedRunningProcesses(store, {
            protectedProcessIds: new Set(['p1']),
        });
        expect(result).toEqual({ finalized: 0, revived: 1 });

        const proc = store.processes.get('p1')!;
        expect(proc.status).toBe('queued');
        // Pending, not finished: no error / endTime stamped.
        expect(proc.error).toBeUndefined();
        expect(proc.endTime).toBeUndefined();
        // Dangling streaming turn is still finalized as interrupted so the UI
        // does not show a perpetually-streaming partial response.
        const assistantTurns = (proc.conversationTurns ?? []).filter(t => t.role === 'assistant');
        expect(assistantTurns).toHaveLength(1);
        expect(assistantTurns[0].streaming).toBeFalsy();
        expect(assistantTurns[0].interrupted).toBe(true);
    });

    it('never revives a cancelling process even if protected', async () => {
        store.processes.set('p1', {
            id: 'p1', type: 'chat', promptPreview: '', fullPrompt: '',
            status: 'cancelling', startTime: new Date(),
            conversationTurns: [],
        } as any);

        const result = await sweepOrphanedRunningProcesses(store, {
            protectedProcessIds: new Set(['p1']),
        });
        expect(result).toEqual({ finalized: 1, revived: 0 });
        expect(store.processes.get('p1')!.status).toBe('cancelled');
    });

    it('fails unprotected running processes while reviving protected ones', async () => {
        store.processes.set('protected', {
            id: 'protected', type: 'chat', promptPreview: '', fullPrompt: '',
            status: 'running', startTime: new Date(), conversationTurns: [],
        } as any);
        store.processes.set('orphaned', {
            id: 'orphaned', type: 'chat', promptPreview: '', fullPrompt: '',
            status: 'running', startTime: new Date(), conversationTurns: [],
        } as any);

        const result = await sweepOrphanedRunningProcesses(store, {
            protectedProcessIds: new Set(['protected']),
        });
        expect(result).toEqual({ finalized: 1, revived: 1 });
        expect(store.processes.get('protected')!.status).toBe('queued');
        expect(store.processes.get('orphaned')!.status).toBe('failed');
    });
});

describe('finalizeOrphanedProcess with queued status', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = asMock(createMockProcessStore());
    });

    it('sets status to queued without error or endTime, finalizing the streaming turn', async () => {
        store.processes.set('p1', {
            id: 'p1', type: 'chat', promptPreview: '', fullPrompt: '',
            status: 'running', startTime: new Date(),
            conversationTurns: [
                { role: 'assistant', content: 'partial output', timestamp: new Date(), turnIndex: 0, timeline: [], streaming: true },
            ],
        } as any);

        await finalizeOrphanedProcess(store, 'p1', 'Process orphaned by server restart', { status: 'queued' });

        const proc = store.processes.get('p1')!;
        expect(proc.status).toBe('queued');
        expect(proc.error).toBeUndefined();
        expect(proc.endTime).toBeUndefined();
        const assistantTurns = (proc.conversationTurns ?? []).filter(t => t.role === 'assistant');
        expect(assistantTurns).toHaveLength(1);
        expect(assistantTurns[0].content).toBe('partial output');
        expect(assistantTurns[0].streaming).toBeFalsy();
        expect(assistantTurns[0].interrupted).toBe(true);
    });

    it('sets status to queued via the status-only fallback (no streaming turn)', async () => {
        store.processes.set('p2', {
            id: 'p2', type: 'chat', promptPreview: '', fullPrompt: '',
            status: 'running', startTime: new Date(),
            conversationTurns: [
                { role: 'user', content: 'hi', timestamp: new Date(), turnIndex: 0, timeline: [] },
            ],
        } as any);

        await finalizeOrphanedProcess(store, 'p2', 'ignored', { status: 'queued' });

        const proc = store.processes.get('p2')!;
        expect(proc.status).toBe('queued');
        expect(proc.error).toBeUndefined();
        expect(proc.endTime).toBeUndefined();
    });
});

describe('collectResumableFollowUpProcessIds', () => {
    it('collects payload.processId from chat follow-up tasks', () => {
        const ids = collectResumableFollowUpProcessIds([
            { payload: { kind: 'chat', processId: 'queue_abc' } },
            { payload: { kind: 'chat', processId: 'queue_def' } },
        ]);
        expect(ids).toEqual(new Set(['queue_abc', 'queue_def']));
    });

    it('ignores fresh chat tasks (no processId) and non-chat tasks', () => {
        const ids = collectResumableFollowUpProcessIds([
            { payload: { kind: 'chat', prompt: 'new task' } }, // no processId → not a follow-up
            { payload: { kind: 'workflow', processId: 'queue_xyz' } }, // not a chat payload
            { payload: undefined }, // defensive: missing payload
            { payload: { kind: 'chat', processId: 'queue_keep' } },
        ]);
        expect(ids).toEqual(new Set(['queue_keep']));
    });

    it('returns an empty set for no tasks', () => {
        expect(collectResumableFollowUpProcessIds([])).toEqual(new Set());
    });
});
