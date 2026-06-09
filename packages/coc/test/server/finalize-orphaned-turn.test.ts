/**
 * Tests for the finalize-orphaned-turn helper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    finalizeOrphanedProcess,
    sweepOrphanedRunningProcesses,
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

        const count = await sweepOrphanedRunningProcesses(store);
        expect(count).toBe(2);

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

        const count = await sweepOrphanedRunningProcesses(store);
        expect(count).toBe(0);
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
});
