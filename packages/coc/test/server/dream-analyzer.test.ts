import { describe, expect, it, vi } from 'vitest';
import type { ISDKService } from '@plusplusoneplusplus/forge';
import type { DreamConversationSelection } from '../../src/server/dreams/dream-source-selector';
import type { DreamCard } from '../../src/server/dreams/types';
import {
    DEFAULT_DREAM_ANALYSIS_TIMEOUT_MS,
    analyzeDreamConversations,
    buildDreamCriticPrompt,
    normalizeDreamAnalysisCandidates,
    parseDreamCriticResponse,
} from '../../src/server/dreams/dream-analyzer';

const WORKSPACE_ID = 'ws-dream-analyzer';
const RUN_ID = 'dream-run-analyzer';

function selection(): DreamConversationSelection {
    return {
        workspaceId: WORKSPACE_ID,
        scannedProcessCount: 1,
        skipped: {
            wrongWorkspace: 0,
            nonCompleted: 0,
            archived: 0,
            missingProcess: 0,
            noVisibleTurns: 0,
            fullyCovered: 0,
        },
        conversations: [
            {
                processId: 'process-1',
                workspaceId: WORKSPACE_ID,
                title: 'Review repeated setup',
                promptPreview: 'Review repeated setup',
                startTime: '2026-06-10T00:00:00.000Z',
                endTime: '2026-06-10T00:02:00.000Z',
                activityAt: '2026-06-10T00:02:00.000Z',
                sourceRanges: [{ processId: 'process-1', startTurnIndex: 0, endTurnIndex: 4 }],
                turns: [
                    {
                        turnIndex: 0,
                        role: 'user',
                        content: 'Please review this with the strict no-style-comments policy again.',
                        timestamp: '2026-06-10T00:00:00.000Z',
                    },
                    {
                        turnIndex: 1,
                        role: 'assistant',
                        content: 'I will focus only on material defects.',
                        timestamp: '2026-06-10T00:01:00.000Z',
                    },
                ],
                uncoveredTurnCount: 2,
                visibleTurnCount: 2,
            },
        ],
    };
}

function rawCandidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        category: 'skill-or-prompt-improvement',
        sourceRanges: [{ processId: 'process-1', startTurnIndex: 0, endTurnIndex: 1 }],
        observedPattern: 'The user repeatedly restates code review constraints before asking for reviews.',
        whyItMatters: 'Repeated setup increases review friction and makes automated review behavior less consistent.',
        recommendation: 'Harden the code-review skill to include the recurring review constraints by default.',
        expectedImpact: 'Review requests become shorter while preserving high-signal review behavior.',
        confidence: 0.94,
        notAlreadyCoveredRationale: 'Existing review guidance does not encode this recurring setup pattern.',
        ...overrides,
    };
}

function mockAiService(...responses: string[]): ISDKService {
    const sendMessage = vi.fn();
    for (const response of responses) {
        sendMessage.mockResolvedValueOnce({ success: true, response });
    }
    return {
        sendMessage,
        isAvailable: vi.fn(),
        clearAvailabilityCache: vi.fn(),
        listModels: vi.fn(),
        transform: vi.fn(),
        forkSession: vi.fn(),
        abortSession: vi.fn(),
        softAbortSession: vi.fn(),
        loadSessionHistory: vi.fn(),
        checkSessionHealth: vi.fn(),
    } as unknown as ISDKService;
}

describe('normalizeDreamAnalysisCandidates', () => {
    it('keeps only candidates that pass deterministic prefilters, confidence, and source coverage', () => {
        const response = JSON.stringify({
            candidates: [
                rawCandidate(),
                rawCandidate({ confidence: 0.4 }),
                rawCandidate({ sourceRanges: [{ processId: 'process-2', startTurnIndex: 0, endTurnIndex: 1 }] }),
                rawCandidate({ category: 'unsupported-category' }),
            ],
        });

        const result = normalizeDreamAnalysisCandidates(response, {
            workspaceId: WORKSPACE_ID,
            runId: RUN_ID,
            allowedSourceRanges: [{ processId: 'process-1', startTurnIndex: 0, endTurnIndex: 4 }],
            confidenceThreshold: 0.85,
        });

        expect(result.rawCandidateCount).toBe(4);
        expect(result.candidates).toHaveLength(1);
        expect(result.candidates[0].candidate).toMatchObject({
            workspaceId: WORKSPACE_ID,
            runId: RUN_ID,
            category: 'skill-or-prompt-improvement',
            confidence: 0.94,
        });
        expect(result.candidates[0].candidate.dedupFingerprint).toMatch(/^dream:skill-or-prompt-improvement:/);
        expect(result.rejected.map(rejection => rejection.reason)).toEqual(expect.arrayContaining([
            expect.stringMatching(/below threshold/i),
            expect.stringMatching(/not in the eligible source selection/i),
            expect.stringMatching(/category must be one of/i),
        ]));
    });
});

describe('parseDreamCriticResponse', () => {
    it('requires duplicate verdicts to include a dedup rationale', () => {
        expect(() => parseDreamCriticResponse(JSON.stringify({
            decisions: [{ candidateIndex: 0, verdict: 'duplicate', rationale: 'Already covered.' }],
        }))).toThrow(/dedupRationale is required/i);
    });
});

describe('buildDreamCriticPrompt', () => {
    it('includes hidden dream cards as dedup context', () => {
        const existingCard: DreamCard = {
            id: 'dream-prior',
            workspaceId: WORKSPACE_ID,
            category: 'skill-or-prompt-improvement',
            status: 'dismissed',
            sourceRanges: [{ processId: 'old-process', startTurnIndex: 0, endTurnIndex: 2 }],
            observedPattern: 'Prior repeated review setup pattern.',
            whyItMatters: 'Prior rationale.',
            recommendation: 'Prior recommendation.',
            expectedImpact: 'Prior impact.',
            confidence: 0.9,
            dedupFingerprint: 'dream:skill-or-prompt-improvement:prior',
            notAlreadyCoveredRationale: 'Prior coverage rationale.',
            createdAt: '2026-06-10T00:00:00.000Z',
            updatedAt: '2026-06-10T00:00:00.000Z',
        };
        const normalized = normalizeDreamAnalysisCandidates(JSON.stringify({ candidates: [rawCandidate()] }), {
            workspaceId: WORKSPACE_ID,
            runId: RUN_ID,
            allowedSourceRanges: [{ processId: 'process-1', startTurnIndex: 0, endTurnIndex: 4 }],
        });

        const prompt = buildDreamCriticPrompt({
            candidates: normalized.candidates,
            existingCards: [existingCard],
        });

        expect(prompt).toContain('status: dismissed');
        expect(prompt).toContain('dream-prior');
        expect(prompt).toContain('dream:skill-or-prompt-improvement:prior');
    });
});

describe('analyzeDreamConversations', () => {
    it('runs analyzer and critic as read-only Ask-mode AI calls', async () => {
        const service = mockAiService(
            JSON.stringify({ candidates: [rawCandidate()] }),
            JSON.stringify({
                decisions: [{
                    candidateIndex: 0,
                    verdict: 'accept',
                    rationale: 'Evidence is repeated, source-linked, and actionable.',
                }],
            }),
        );

        const result = await analyzeDreamConversations({
            aiService: service,
            workspaceId: WORKSPACE_ID,
            runId: RUN_ID,
            selection: selection(),
            model: 'claude-sonnet-4.6',
            reasoningEffort: 'high',
        });

        expect(result.candidates).toHaveLength(1);
        expect(result.candidates[0].criticRationale).toContain('source-linked');
        expect(result.rejected).toHaveLength(0);
        expect((service.sendMessage as any).mock.calls).toHaveLength(2);
        for (const [options] of (service.sendMessage as any).mock.calls) {
            expect(options).toMatchObject({
                model: 'claude-sonnet-4.6',
                reasoningEffort: 'high',
                mode: 'interactive',
                streaming: false,
                loadDefaultMcpConfig: false,
                mcpServers: {},
                availableTools: [],
                tools: [],
                timeoutMs: 3_600_000,
                systemMessage: { mode: 'replace' },
            });
            expect(options.onPermissionRequest).toBeTypeOf('function');
        }
        expect((service.sendMessage as any).mock.calls[0][0].systemMessage.content).toContain('Dream analyzer');
        expect((service.sendMessage as any).mock.calls[1][0].systemMessage.content).toContain('Dream critic');
    });

    it('honors per-request timeout overrides for analyzer and critic calls', async () => {
        const service = mockAiService(
            JSON.stringify({ candidates: [rawCandidate()] }),
            JSON.stringify({
                decisions: [{
                    candidateIndex: 0,
                    verdict: 'accept',
                    rationale: 'Evidence is repeated, source-linked, and actionable.',
                }],
            }),
        );

        await analyzeDreamConversations({
            aiService: service,
            workspaceId: WORKSPACE_ID,
            runId: RUN_ID,
            selection: selection(),
            timeoutMs: 45_000,
        });

        for (const [options] of (service.sendMessage as any).mock.calls) {
            expect(options.timeoutMs).toBe(45_000);
        }
        expect(DEFAULT_DREAM_ANALYSIS_TIMEOUT_MS).toBe(3_600_000);
    });

    it('rejects critic duplicates before they become accepted candidates', async () => {
        const service = mockAiService(
            JSON.stringify({ candidates: [rawCandidate()] }),
            JSON.stringify({
                decisions: [{
                    candidateIndex: 0,
                    verdict: 'duplicate',
                    rationale: 'This repeats a dismissed dream card.',
                    dedupRationale: 'Covered by dismissed dream-prior.',
                    duplicateOfCardId: 'dream-prior',
                }],
            }),
        );

        const result = await analyzeDreamConversations({
            aiService: service,
            workspaceId: WORKSPACE_ID,
            runId: RUN_ID,
            selection: selection(),
            existingCards: [],
        });

        expect(result.candidates).toHaveLength(0);
        expect(result.rejected).toEqual([
            expect.objectContaining({
                stage: 'critic',
                candidateIndex: 0,
                reason: 'This repeats a dismissed dream card.',
                duplicateOfCardId: 'dream-prior',
            }),
        ]);
    });

    it('does not call AI when there are no eligible source conversations', async () => {
        const service = mockAiService();
        const emptySelection = {
            ...selection(),
            conversations: [],
            scannedProcessCount: 0,
        };

        const result = await analyzeDreamConversations({
            aiService: service,
            workspaceId: WORKSPACE_ID,
            selection: emptySelection,
        });

        expect(result).toMatchObject({
            candidates: [],
            rejected: [],
            rawCandidateCount: 0,
            deterministicCandidateCount: 0,
            sourceRanges: [],
        });
        expect((service.sendMessage as any).mock.calls).toHaveLength(0);
    });
});
