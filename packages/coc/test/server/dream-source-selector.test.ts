import { describe, expect, it, vi } from 'vitest';
import type {
    AIProcess,
    ConversationTurn,
    ProcessIndexEntry,
    ProcessStore,
} from '@plusplusoneplusplus/forge';
import { selectEligibleDreamConversations } from '../../src/server/dreams/dream-source-selector';

const WORKSPACE_ID = 'ws-dream-selector';
const OTHER_WORKSPACE_ID = 'ws-dream-selector-other';

function turn(overrides: Partial<ConversationTurn> = {}): ConversationTurn {
    return {
        role: 'user',
        content: 'visible turn',
        timestamp: new Date('2026-06-10T01:00:00.000Z'),
        turnIndex: 0,
        timeline: [],
        ...overrides,
    };
}

function entry(overrides: Partial<ProcessIndexEntry> = {}): ProcessIndexEntry {
    return {
        id: 'process-1',
        workspaceId: WORKSPACE_ID,
        status: 'completed',
        type: 'chat',
        startTime: '2026-06-10T00:00:00.000Z',
        endTime: '2026-06-10T00:01:00.000Z',
        promptPreview: 'Investigate tests',
        lastEventAt: '2026-06-10T00:01:00.000Z',
        activityAt: '2026-06-10T00:01:00.000Z',
        ...overrides,
    };
}

function process(overrides: Partial<AIProcess> = {}): AIProcess {
    return {
        id: 'process-fallback',
        type: 'chat',
        promptPreview: 'Fallback process',
        fullPrompt: 'Fallback process full prompt',
        status: 'completed',
        startTime: new Date('2026-06-10T00:00:00.000Z'),
        endTime: new Date('2026-06-10T00:01:00.000Z'),
        metadata: { type: 'chat', workspaceId: WORKSPACE_ID },
        conversationTurns: [turn({ turnIndex: 0, content: 'Fallback user request' })],
        ...overrides,
    };
}

describe('selectEligibleDreamConversations', () => {
    it('selects only uncovered visible turns from completed conversations in the workspace', async () => {
        const entries = [
            entry({ id: 'process-running', status: 'running' }),
            entry({ id: 'process-archived', archived: true }),
            entry({ id: 'process-other-workspace', workspaceId: OTHER_WORKSPACE_ID }),
            entry({ id: 'process-empty' }),
            entry({ id: 'process-covered' }),
            entry({ id: 'process-good', title: 'Good process' }),
        ];
        const turnsByProcess = new Map<string, ConversationTurn[]>([
            ['process-empty', [
                turn({ turnIndex: 0, content: 'deleted', deletedAt: new Date('2026-06-10T02:00:00.000Z') }),
                turn({ turnIndex: 1, content: 'archived', archived: true }),
            ]],
            ['process-covered', [
                turn({ turnIndex: 0, content: 'covered user' }),
                turn({ role: 'assistant', turnIndex: 1, content: 'covered assistant' }),
            ]],
            ['process-good', [
                turn({ turnIndex: 0, content: 'already covered' }),
                turn({ role: 'assistant', turnIndex: 1, content: ' first uncovered assistant ' }),
                turn({ turnIndex: 2, content: 'deleted', deletedAt: new Date('2026-06-10T02:00:00.000Z') }),
                turn({ turnIndex: 3, content: 'archived', archived: true }),
                turn({ role: 'assistant', turnIndex: 4, content: 'streaming', streaming: true }),
                turn({ role: 'assistant', turnIndex: 5, content: 'interrupted', interrupted: true }),
                turn({ turnIndex: 6, content: 'second uncovered user' }),
                turn({ role: 'assistant', turnIndex: 7, content: 'second uncovered assistant' }),
            ]],
        ]);
        const getProcessSummaries = vi.fn<NonNullable<ProcessStore['getProcessSummaries']>>(async () => ({
            entries,
            total: entries.length,
        }));
        const getConversationTurns = vi.fn<NonNullable<ProcessStore['getConversationTurns']>>(async (processId: string) =>
            turnsByProcess.get(processId) ?? []
        );
        const store = {
            getProcessSummaries,
            getConversationTurns,
            getAllProcesses: vi.fn(),
            getProcess: vi.fn(),
        } as unknown as ProcessStore;

        const result = await selectEligibleDreamConversations({
            store,
            workspaceId: WORKSPACE_ID,
            coveredRanges: [
                { processId: 'process-covered', startTurnIndex: 0, endTurnIndex: 10 },
                { processId: 'process-good', startTurnIndex: 0, endTurnIndex: 0 },
            ],
            limit: 10,
        });

        expect(getProcessSummaries).toHaveBeenCalledWith(expect.objectContaining({
            workspaceId: WORKSPACE_ID,
            status: 'completed',
        }));
        expect(getConversationTurns).toHaveBeenCalledTimes(3);
        expect(result.conversations).toHaveLength(1);
        expect(result.conversations[0]).toMatchObject({
            processId: 'process-good',
            title: 'Good process',
            sourceRanges: [
                { processId: 'process-good', startTurnIndex: 1, endTurnIndex: 1 },
                { processId: 'process-good', startTurnIndex: 6, endTurnIndex: 7 },
            ],
            uncoveredTurnCount: 3,
            visibleTurnCount: 4,
        });
        expect(result.conversations[0].turns.map(selectedTurn => selectedTurn.content)).toEqual([
            'first uncovered assistant',
            'second uncovered user',
            'second uncovered assistant',
        ]);
        expect(result.skipped).toEqual({
            wrongWorkspace: 1,
            nonCompleted: 1,
            archived: 1,
            missingProcess: 0,
            noVisibleTurns: 1,
            fullyCovered: 1,
        });
    });

    it('falls back to full process reads when lightweight turn retrieval is unavailable', async () => {
        const listRecentProcesses = vi.fn<NonNullable<ProcessStore['listRecentProcesses']>>(async () => [
            entry({ id: 'process-fallback', promptPreview: 'Fallback process' }),
        ]);
        const getProcess = vi.fn<ProcessStore['getProcess']>(async () => process());
        const store = {
            listRecentProcesses,
            getProcess,
            getAllProcesses: vi.fn(),
        } as unknown as ProcessStore;

        const result = await selectEligibleDreamConversations({
            store,
            workspaceId: WORKSPACE_ID,
            limit: 1,
        });

        expect(listRecentProcesses).toHaveBeenCalledWith(expect.objectContaining({
            workspaceId: WORKSPACE_ID,
            limit: 3,
        }));
        expect(getProcess).toHaveBeenCalledWith('process-fallback', WORKSPACE_ID);
        expect(result.conversations).toHaveLength(1);
        expect(result.conversations[0].sourceRanges).toEqual([
            { processId: 'process-fallback', startTurnIndex: 0, endTurnIndex: 0 },
        ]);
    });
});
