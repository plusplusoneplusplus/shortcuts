/**
 * Tests for toProcessHistoryItem mapper.
 */

import { describe, it, expect } from 'vitest';
import type { AIProcess } from '@plusplusoneplusplus/forge';
import { toProcessHistoryItem } from '../../../src/server/shared/process-history-item';

function makeProcess(overrides: Partial<AIProcess> = {}): AIProcess {
    return {
        id: 'proc-1',
        type: 'pipeline-execution',
        status: 'completed',
        startTime: new Date('2024-06-01T10:00:00Z'),
        endTime: new Date('2024-06-01T10:05:00Z'),
        promptPreview: 'Fix the login bug',
        fullPrompt: 'Fix the login bug in src/auth.ts',
        title: 'Fix login',
        metadata: {
            type: 'pipeline-execution',
            workspaceId: 'ws-abc',
            mode: 'chat',
            model: 'gpt-4',
            planFilePath: '/plans/login.md',
        },
        conversationTurns: [
            {
                role: 'user',
                content: 'Fix the login bug',
                timestamp: '2024-06-01T10:00:30Z',
                turnIndex: 0,
            },
            {
                role: 'assistant',
                content: 'I found the issue...',
                timestamp: '2024-06-01T10:02:00Z',
                turnIndex: 1,
            },
            {
                role: 'user',
                content: 'Thanks, looks good',
                timestamp: '2024-06-01T10:04:00Z',
                turnIndex: 2,
            },
        ],
        ...overrides,
    } as AIProcess;
}

describe('toProcessHistoryItem', () => {
    it('maps all fields from a complete AIProcess', () => {
        const proc = makeProcess();
        const item = toProcessHistoryItem(proc, '2024-06-01T11:00:00Z');

        expect(item).toEqual({
            id: 'proc-1',
            type: 'pipeline-execution',
            status: 'completed',
            title: 'Fix login',
            promptPreview: 'Fix the login bug',
            startTime: new Date('2024-06-01T10:00:00Z').getTime(),
            endTime: new Date('2024-06-01T10:05:00Z').getTime(),
            error: undefined,
            mode: 'chat',
            model: 'gpt-4',
            workspaceId: 'ws-abc',
            planFilePath: '/plans/login.md',
            turnCount: 3,
            lastActivityAt: new Date('2024-06-01T10:04:00Z').getTime(),
            seenAt: '2024-06-01T11:00:00Z',
        });
    });

    it('title falls back to promptPreview when proc.title is empty', () => {
        const proc = makeProcess({ title: undefined });
        const item = toProcessHistoryItem(proc);
        expect(item.title).toBe('Fix the login bug');
    });

    it('title falls back to proc.id when both title and promptPreview are missing', () => {
        const proc = makeProcess({ title: undefined, promptPreview: undefined });
        const item = toProcessHistoryItem(proc);
        expect(item.title).toBe('proc-1');
    });

    it('title uses proc.title even when empty string (falsy)', () => {
        const proc = makeProcess({ title: '' });
        const item = toProcessHistoryItem(proc);
        // empty string is falsy, should fall back
        expect(item.title).toBe('Fix the login bug');
    });

    it('turnCount is 0 when conversationTurns is undefined', () => {
        const proc = makeProcess({ conversationTurns: undefined });
        const item = toProcessHistoryItem(proc);
        expect(item.turnCount).toBe(0);
    });

    it('turnCount is 0 when conversationTurns is empty', () => {
        const proc = makeProcess({ conversationTurns: [] });
        const item = toProcessHistoryItem(proc);
        expect(item.turnCount).toBe(0);
    });

    it('lastActivityAt uses last turn timestamp when turns exist', () => {
        const proc = makeProcess();
        const item = toProcessHistoryItem(proc);
        expect(item.lastActivityAt).toBe(new Date('2024-06-01T10:04:00Z').getTime());
    });

    it('lastActivityAt falls back to endTime when no turns', () => {
        const proc = makeProcess({ conversationTurns: [] });
        const item = toProcessHistoryItem(proc);
        expect(item.lastActivityAt).toBe(new Date('2024-06-01T10:05:00Z').getTime());
    });

    it('lastActivityAt is undefined when no turns and no endTime', () => {
        const proc = makeProcess({ conversationTurns: [], endTime: undefined });
        const item = toProcessHistoryItem(proc);
        expect(item.lastActivityAt).toBeUndefined();
    });

    it('lastActivityAt falls back to endTime when last turn has no timestamp', () => {
        const proc = makeProcess({
            conversationTurns: [
                { role: 'user', content: 'hello', turnIndex: 0 },
            ],
        });
        const item = toProcessHistoryItem(proc);
        expect(item.lastActivityAt).toBe(new Date('2024-06-01T10:05:00Z').getTime());
    });

    it('seenAt is passed through unchanged', () => {
        const proc = makeProcess();
        const item = toProcessHistoryItem(proc, '2024-12-25T00:00:00Z');
        expect(item.seenAt).toBe('2024-12-25T00:00:00Z');
    });

    it('seenAt is undefined when not provided', () => {
        const proc = makeProcess();
        const item = toProcessHistoryItem(proc);
        expect(item.seenAt).toBeUndefined();
    });

    it('handles undefined metadata — all metadata fields become undefined or empty string', () => {
        const proc = makeProcess({ metadata: undefined });
        const item = toProcessHistoryItem(proc);
        expect(item.mode).toBeUndefined();
        expect(item.model).toBeUndefined();
        expect(item.workspaceId).toBe('');
        expect(item.planFilePath).toBeUndefined();
    });

    it('endTime is undefined when proc.endTime is missing', () => {
        const proc = makeProcess({ endTime: undefined });
        const item = toProcessHistoryItem(proc);
        expect(item.endTime).toBeUndefined();
    });

    it('error is mapped through', () => {
        const proc = makeProcess({ error: 'Something went wrong' });
        const item = toProcessHistoryItem(proc);
        expect(item.error).toBe('Something went wrong');
    });

    it('uses raw process ID (no toTaskId transform)', () => {
        const proc = makeProcess({ id: 'queue-process-abc-123' });
        const item = toProcessHistoryItem(proc);
        expect(item.id).toBe('queue-process-abc-123');
    });

    it('forwards metadata.ralph verbatim when present', () => {
        const proc = makeProcess({
            metadata: {
                type: 'pipeline-execution',
                workspaceId: 'ws-abc',
                mode: 'ralph',
                ralph: {
                    sessionId: 'ralph-1778429298422-15jh57',
                    phase: 'executing',
                    currentIteration: 3,
                },
            },
        } as any);
        const item = toProcessHistoryItem(proc);
        expect(item.ralph).toEqual({
            sessionId: 'ralph-1778429298422-15jh57',
            phase: 'executing',
            currentIteration: 3,
        });
    });

    it('forwards child metadata.forEach verbatim when present', () => {
        const proc = makeProcess({
            metadata: {
                type: 'chat',
                workspaceId: 'ws-abc',
                mode: 'autopilot',
                forEach: {
                    kind: 'child',
                    workspaceId: 'ws-abc',
                    runId: 'for-each-run-1',
                    itemId: 'item-2',
                    childMode: 'autopilot',
                },
            },
        } as any);

        const item = toProcessHistoryItem(proc);

        expect(item.forEach).toEqual({
            kind: 'child',
            workspaceId: 'ws-abc',
            runId: 'for-each-run-1',
            itemId: 'item-2',
            childMode: 'autopilot',
        });
    });

    it('forwards metadata.mapReduce verbatim when present', () => {
        const proc = makeProcess({
            metadata: {
                type: 'chat',
                workspaceId: 'ws-abc',
                mode: 'autopilot',
                mapReduce: {
                    workspaceId: 'ws-abc',
                    runId: 'map-reduce-run-1',
                    phase: 'reduce',
                    childMode: 'autopilot',
                },
            },
        } as any);

        const item = toProcessHistoryItem(proc);

        expect(item.mapReduce).toEqual({
            workspaceId: 'ws-abc',
            runId: 'map-reduce-run-1',
            phase: 'reduce',
            childMode: 'autopilot',
        });
    });

    it('forwards generation metadata.forEach verbatim when present', () => {
        const proc = makeProcess({
            metadata: {
                type: 'chat',
                workspaceId: 'ws-abc',
                mode: 'ask',
                forEach: {
                    kind: 'generation',
                    workspaceId: 'ws-abc',
                    generationId: 'for-each-gen-1',
                    runId: 'for-each-run-1',
                    childMode: 'ask',
                    originalRequest: 'Split this change',
                    status: 'approved',
                    latestItemCount: 1,
                    latestPlanTurnIndex: 4,
                    latestPlan: {
                        turnIndex: 4,
                        childMode: 'ask',
                        sharedInstructions: 'Keep changes small',
                        items: [
                            {
                                id: 'item-1',
                                title: 'First item',
                                prompt: 'Do the first item',
                                status: 'pending',
                            },
                        ],
                    },
                },
            },
        } as any);

        const item = toProcessHistoryItem(proc);

        expect(item.forEach).toEqual({
            kind: 'generation',
            workspaceId: 'ws-abc',
            generationId: 'for-each-gen-1',
            runId: 'for-each-run-1',
            childMode: 'ask',
            originalRequest: 'Split this change',
            status: 'approved',
            latestItemCount: 1,
            latestPlanTurnIndex: 4,
            latestPlan: {
                turnIndex: 4,
                childMode: 'ask',
                sharedInstructions: 'Keep changes small',
                items: [
                    {
                        id: 'item-1',
                        title: 'First item',
                        prompt: 'Do the first item',
                        status: 'pending',
                    },
                ],
            },
        });
    });

    it('omits forEach when metadata.forEach is absent', () => {
        const proc = makeProcess();
        const item = toProcessHistoryItem(proc);
        expect(item.forEach).toBeUndefined();
    });

    it('omits ralph when metadata.ralph is absent', () => {
        const proc = makeProcess();
        const item = toProcessHistoryItem(proc);
        expect(item.ralph).toBeUndefined();
    });
});
