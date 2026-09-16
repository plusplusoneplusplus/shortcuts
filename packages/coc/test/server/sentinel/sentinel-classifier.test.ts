import type {
    AIProcess,
    ConversationTurn,
    PendingAskUserQuestion,
} from '@plusplusoneplusplus/forge';
import { describe, expect, it, vi } from 'vitest';
import {
    classifySentinelProcesses,
    resolveSentinelExclusionSet,
    scanSentinelWorkspace,
    type SentinelLooseEndJudge,
} from '../../../src/server/sentinel/sentinel-classifier';
import { createMockProcessStore } from '../../helpers/mock-process-store';

const NOW = new Date('2026-09-16T20:00:00.000Z');
const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

function turn(index: number, role: ConversationTurn['role'], content = `turn ${index}`): ConversationTurn {
    return {
        role,
        content,
        timestamp: new Date(NOW.getTime() - (10 - index) * 1_000),
        turnIndex: index,
        timeline: [],
    };
}

function pendingQuestion(question = 'Which option?'): PendingAskUserQuestion {
    return {
        batchId: 'batch-1',
        questionId: 'question-1',
        question,
        type: 'text',
        turnIndex: 1,
        index: 0,
        batchSize: 1,
    };
}

function processFixture(
    id: string,
    overrides: Partial<AIProcess> = {},
): AIProcess {
    return {
        id,
        type: 'chat',
        promptPreview: id,
        fullPrompt: id,
        status: 'completed',
        startTime: new Date(NOW.getTime() - HOUR_MS),
        endTime: new Date(NOW.getTime() - 30 * 60 * 1_000),
        lastEventAt: new Date(NOW.getTime() - 30 * 60 * 1_000),
        metadata: { type: 'chat', mode: 'ask', workspaceId: 'workspace-a' },
        conversationTurns: [turn(0, 'user'), turn(1, 'assistant')],
        ...overrides,
    };
}

describe('resolveSentinelExclusionSet', () => {
    it('excludes every Sentinel and all descendants transitively', () => {
        const processes = [
            processFixture('sentinel-owner', {
                metadata: { type: 'chat', mode: 'sentinel', workspaceId: 'workspace-a' },
            }),
            processFixture('child', { parentProcessId: 'sentinel-owner' }),
            processFixture('grandchild', { parentProcessId: 'child' }),
            processFixture('other-sentinel', {
                metadata: { type: 'chat', mode: 'sentinel', workspaceId: 'workspace-a' },
            }),
            processFixture('other-child', { parentProcessId: 'other-sentinel' }),
            processFixture('ordinary'),
        ];

        expect([...resolveSentinelExclusionSet(processes, 'sentinel-owner')].sort()).toEqual([
            'child',
            'grandchild',
            'other-child',
            'other-sentinel',
            'sentinel-owner',
        ]);
    });
});

describe('classifySentinelProcesses', () => {
    it('classifies recent chats with deterministic precedence and excludes ineligible chats', async () => {
        const processes = [
            processFixture('sentinel-owner', {
                metadata: { type: 'chat', mode: 'sentinel', workspaceId: 'workspace-a' },
            }),
            processFixture('sentinel-child', { parentProcessId: 'sentinel-owner' }),
            processFixture('sentinel-grandchild', { parentProcessId: 'sentinel-child' }),
            processFixture('blocked', {
                status: 'completed',
                pendingAskUser: [pendingQuestion('Choose a database?')],
            }),
            processFixture('failed', { status: 'failed', error: 'Provider unavailable' }),
            processFixture('stale', { status: 'running', stale: true }),
            processFixture('queued', {
                status: 'queued',
                startTime: new Date(NOW.getTime() - 2 * HOUR_MS),
                endTime: undefined,
                lastEventAt: undefined,
            }),
            processFixture('queued-recent', {
                status: 'queued',
                startTime: new Date(NOW.getTime() - 10 * 60 * 1_000),
                endTime: undefined,
                lastEventAt: undefined,
            }),
            processFixture('loose', {
                conversationTurns: Array.from({ length: 6 }, (_, index) =>
                    turn(index, index % 2 === 0 ? 'user' : 'assistant')),
            }),
            processFixture('unread'),
            processFixture('read'),
            processFixture('low-confidence'),
            processFixture('archived', { archived: true }),
            processFixture('old', {
                startTime: new Date(NOW.getTime() - 9 * DAY_MS),
                endTime: new Date(NOW.getTime() - 8 * DAY_MS),
                lastEventAt: new Date(NOW.getTime() - 8 * DAY_MS),
            }),
        ];
        const judge = vi.fn<SentinelLooseEndJudge>(async candidates => {
            expect(candidates.map(candidate => candidate.processId).sort()).toEqual([
                'loose',
                'low-confidence',
                'read',
                'unread',
            ]);
            expect(candidates.find(candidate => candidate.processId === 'loose')?.finalTurns)
                .toEqual([
                    { role: 'user', content: 'turn 2', timestamp: turn(2, 'user').timestamp, turnIndex: 2 },
                    { role: 'assistant', content: 'turn 3', timestamp: turn(3, 'assistant').timestamp, turnIndex: 3 },
                    { role: 'user', content: 'turn 4', timestamp: turn(4, 'user').timestamp, turnIndex: 4 },
                    { role: 'assistant', content: 'turn 5', timestamp: turn(5, 'assistant').timestamp, turnIndex: 5 },
                ]);
            return [
                { processId: 'loose', verdict: 'loose-end', confidence: 0.9, reason: 'Promised a test run.' },
                { processId: 'low-confidence', verdict: 'loose-end', confidence: 0.69 },
                { processId: 'read', verdict: 'ignore', confidence: 1 },
                { processId: 'unread', verdict: 'ignore', confidence: 1 },
            ];
        });

        const result = await classifySentinelProcesses(
            processes,
            {
                read: NOW.toISOString(),
                'low-confidence': NOW.toISOString(),
            },
            judge,
            { sentinelProcessId: 'sentinel-owner', now: NOW },
        );

        expect(judge).toHaveBeenCalledTimes(1);
        expect(result.entries).toEqual([
            { processId: 'blocked', bucket: 'blocked-on-you', reason: 'Waiting for your answer: Choose a database?' },
            { processId: 'failed', bucket: 'failed', reason: 'Provider unavailable' },
            { processId: 'stale', bucket: 'failed', reason: 'The chat was marked stale.' },
            { processId: 'queued', bucket: 'stuck-in-queue', reason: 'The chat has remained queued longer than expected.' },
            { processId: 'loose', bucket: 'loose-ends', reason: 'Promised a test run.' },
            { processId: 'unread', bucket: 'done-unread', reason: 'The completed chat has not been read.' },
        ]);
        expect(result.excludedProcessIds).toEqual([
            'sentinel-child',
            'sentinel-grandchild',
            'sentinel-owner',
        ]);
    });

    it('uses lower surfacing thresholds for pinned chats', async () => {
        const result = await classifySentinelProcesses(
            [
                processFixture('pinned-queue', {
                    status: 'queued',
                    startTime: new Date(NOW.getTime() - 45 * 60 * 1_000),
                    endTime: undefined,
                    lastEventAt: undefined,
                    pinnedAt: NOW.toISOString(),
                }),
                processFixture('pinned-loose', { pinnedAt: NOW.toISOString() }),
                processFixture('unpinned-low'),
            ],
            {
                'pinned-loose': NOW.toISOString(),
                'unpinned-low': NOW.toISOString(),
            },
            async () => [
                { processId: 'pinned-loose', verdict: 'loose-end', confidence: 0.6 },
                { processId: 'unpinned-low', verdict: 'loose-end', confidence: 0.6 },
            ],
            { sentinelProcessId: 'sentinel-owner', now: NOW },
        );

        expect(result.entries.map(entry => [entry.processId, entry.bucket])).toEqual([
            ['pinned-queue', 'stuck-in-queue'],
            ['pinned-loose', 'loose-ends'],
        ]);
    });

    it('does not call the loose-end judge without completed conversation turns', async () => {
        const judge = vi.fn<SentinelLooseEndJudge>(async () => []);

        const result = await classifySentinelProcesses(
            [
                processFixture('failed', { status: 'failed' }),
                processFixture('empty-completed', { conversationTurns: undefined }),
            ],
            { 'empty-completed': NOW.toISOString() },
            judge,
            { sentinelProcessId: 'sentinel-owner', now: NOW },
        );

        expect(judge).not.toHaveBeenCalled();
        expect(result.entries).toEqual([
            { processId: 'failed', bucket: 'failed', reason: 'The chat failed.' },
        ]);
    });
});

describe('scanSentinelWorkspace', () => {
    it('queries and classifies only the requested workspace', async () => {
        const store = createMockProcessStore({
            initialProcesses: [
                processFixture('workspace-a-chat'),
                processFixture('workspace-b-chat', {
                    metadata: { type: 'chat', mode: 'ask', workspaceId: 'workspace-b' },
                }),
            ],
        });
        const seenStateReader = {
            getSeenMap: vi.fn(() => ({ 'workspace-a-chat': NOW.toISOString() })),
        };

        const result = await scanSentinelWorkspace({
            workspaceId: 'workspace-a',
            sentinelProcessId: 'sentinel-owner',
            processStore: store,
            seenStateReader,
            judgeLooseEnds: async candidates =>
                candidates.map(candidate => ({
                    processId: candidate.processId,
                    verdict: 'ignore',
                    confidence: 1,
                })),
            now: NOW,
        });

        expect(store.getAllProcesses).toHaveBeenCalledWith({ workspaceId: 'workspace-a' });
        expect(seenStateReader.getSeenMap).toHaveBeenCalledWith('workspace-a');
        expect(result.entries).toEqual([]);
    });
});
