import { describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { getRepoDataPath } from '@plusplusoneplusplus/forge';
import {
    buildDreamDedupFingerprint,
    DreamCandidatePrefilterError,
    FileDreamStore,
    prefilterDreamCandidate,
} from '../../src/server/dreams/dream-store';
import type { CreateDreamCandidateInput } from '../../src/server/dreams/types';

const WORKSPACE_ID = 'ws-dream-store-test';
const OTHER_WORKSPACE_ID = 'ws-dream-store-other';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-dream-store-'));
    try {
        return await fn(dir);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}

function candidate(overrides: Partial<CreateDreamCandidateInput> = {}): CreateDreamCandidateInput {
    return {
        workspaceId: WORKSPACE_ID,
        runId: 'dream-run-1',
        category: 'skill-or-prompt-improvement',
        sourceRanges: [
            { processId: 'process-1', startTurnIndex: 2, endTurnIndex: 6 },
        ],
        observedPattern: 'The user repeatedly restates the same code review constraints across sessions.',
        whyItMatters: 'Repeated setup consumes review attention and makes later automation less consistent.',
        recommendation: 'Harden the code-review skill so it carries the recurring constraints by default.',
        expectedImpact: 'Review setup becomes shorter while preserving the same high-signal checks.',
        confidence: 0.92,
        notAlreadyCoveredRationale: 'Existing skills mention review focus but do not encode these repeated constraints.',
        ...overrides,
    };
}

describe('FileDreamStore', () => {
    it('persists candidates under repo-scoped dream storage', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileDreamStore({ dataDir });
            const created = await store.createCandidate(candidate());

            const cardsPath = path.join(getRepoDataPath(dataDir, WORKSPACE_ID, 'dreams'), 'cards.json');
            await expect(fs.stat(cardsPath)).resolves.toBeDefined();
            await expect(fs.stat(getRepoDataPath(dataDir, OTHER_WORKSPACE_ID, 'dreams'))).rejects.toMatchObject({ code: 'ENOENT' });

            const restartedStore = new FileDreamStore({ dataDir });
            const loaded = await restartedStore.getCard(WORKSPACE_ID, created.id);
            expect(loaded).toMatchObject({
                id: created.id,
                workspaceId: WORKSPACE_ID,
                runId: 'dream-run-1',
                status: 'candidate',
                category: 'skill-or-prompt-improvement',
                confidence: 0.92,
            });
            expect(loaded?.dedupFingerprint).toMatch(/^dream:skill-or-prompt-improvement:/);
            expect(loaded?.sourceRanges).toEqual([
                { processId: 'process-1', startTurnIndex: 2, endTurnIndex: 6 },
            ]);
        });
    });

    it('rejects candidates missing deterministic prefilter requirements', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileDreamStore({ dataDir });
            const invalid = {
                ...candidate(),
                category: 'random-thought',
                sourceRanges: [],
                recommendation: '  ',
                confidence: 1.2,
            } as unknown as CreateDreamCandidateInput;

            const result = prefilterDreamCandidate(invalid);
            expect(result.accepted).toBe(false);
            if (!result.accepted) {
                expect(result.reasons).toEqual(expect.arrayContaining([
                    expect.stringMatching(/category must be one of/i),
                    expect.stringMatching(/sourceRanges must include/i),
                    expect.stringMatching(/recommendation must contain actionable detail/i),
                    expect.stringMatching(/confidence must be a number between 0 and 1/i),
                ]));
            }

            await expect(store.createCandidate(invalid)).rejects.toBeInstanceOf(DreamCandidatePrefilterError);
        });
    });

    it('supports review lifecycle transitions while hiding non-visible cards by default', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileDreamStore({ dataDir });
            const first = await store.createCandidate(candidate());
            const visible = await store.promoteCandidate(WORKSPACE_ID, first.id, {
                criticRationale: 'Evidence is concrete and recommendation is actionable.',
            });
            expect(visible.status).toBe('visible');
            expect(visible.visibleAt).toBeDefined();
            expect(await store.listCards(WORKSPACE_ID)).toHaveLength(1);

            const approved = await store.approveCard(WORKSPACE_ID, first.id);
            expect(approved.status).toBe('approved');
            expect(approved.approvedAt).toBeDefined();
            expect(await store.listCards(WORKSPACE_ID)).toHaveLength(0);

            const converted = await store.convertCard(WORKSPACE_ID, first.id, {
                artifactType: 'skill-hardening-task',
                artifactId: 'task-123',
                artifactUrl: 'https://example.invalid/task-123',
            });
            expect(converted.status).toBe('converted');
            expect(converted.conversion).toMatchObject({
                artifactType: 'skill-hardening-task',
                artifactId: 'task-123',
            });

            const dismissible = await store.createCandidate(candidate({
                observedPattern: 'The user frequently asks for concise progress updates during long runs.',
                recommendation: 'Tune execution prompts to emit shorter progress updates at major milestones.',
            }));
            await store.promoteCandidate(WORKSPACE_ID, dismissible.id);
            const dismissed = await store.dismissCard(WORKSPACE_ID, dismissible.id, {
                dedupRationale: 'User dismissed this review card.',
            });
            expect(dismissed.status).toBe('dismissed');
            expect(dismissed.dedupRationale).toBe('User dismissed this review card.');

            const supersedable = await store.createCandidate(candidate({
                observedPattern: 'The user often asks to convert high-confidence dreams into work items.',
                recommendation: 'Add a product workflow that queues work-item creation only after confirmation.',
            }));
            await store.promoteCandidate(WORKSPACE_ID, supersedable.id);
            const superseded = await store.markSuperseded(WORKSPACE_ID, supersedable.id, {
                supersededByCardId: first.id,
                dedupRationale: 'Covered by the converted skill-hardening card.',
            });
            expect(superseded.status).toBe('superseded');

            const allCards = await store.listCards(WORKSPACE_ID, { includeHidden: true });
            expect(allCards.map(card => card.status).sort()).toEqual(['converted', 'dismissed', 'superseded']);
            await expect(store.dismissCard(WORKSPACE_ID, first.id)).rejects.toThrow(/only visible cards/i);
        });
    });

    it('deduplicates visible promotion against hidden history in the same workspace only', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileDreamStore({ dataDir });
            const original = await store.createCandidate(candidate());
            await store.promoteCandidate(WORKSPACE_ID, original.id);
            await store.dismissCard(WORKSPACE_ID, original.id);

            const duplicate = await store.createCandidate(candidate({
                runId: 'dream-run-2',
                sourceRanges: [{ processId: 'process-2', startTurnIndex: 0, endTurnIndex: 3 }],
            }));
            const superseded = await store.promoteCandidate(WORKSPACE_ID, duplicate.id, {
                dedupRationale: 'Same normalized recommendation as a dismissed dream card.',
            });
            expect(superseded.status).toBe('superseded');
            expect(superseded.supersededByCardId).toBe(original.id);
            expect(superseded.dedupRationale).toBe('Same normalized recommendation as a dismissed dream card.');
            expect(await store.listCards(WORKSPACE_ID)).toHaveLength(0);

            const sameIdeaElsewhere = await store.createCandidate(candidate({ workspaceId: OTHER_WORKSPACE_ID }));
            const otherVisible = await store.promoteCandidate(OTHER_WORKSPACE_ID, sameIdeaElsewhere.id);
            expect(otherVisible.status).toBe('visible');
            expect(await store.listCards(OTHER_WORKSPACE_ID)).toHaveLength(1);

            const fingerprintMatches = await store.findCardsByFingerprint(WORKSPACE_ID, original.dedupFingerprint);
            expect(fingerprintMatches.map(card => card.status).sort()).toEqual(['dismissed', 'superseded']);
        });
    });

    it('records completed dream run coverage for incremental future passes', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileDreamStore({ dataDir });
            const run = await store.createRun({
                workspaceId: WORKSPACE_ID,
                trigger: 'manual',
                provider: 'claude',
                model: 'claude-sonnet-4.6',
                reasoningEffort: 'high',
                timeoutMs: 3_600_000,
            });
            expect(run).toMatchObject({
                provider: 'claude',
                model: 'claude-sonnet-4.6',
                reasoningEffort: 'high',
                timeoutMs: 3_600_000,
            });
            const created = await store.createCandidate(candidate({
                runId: run.id,
                sourceRanges: [{ processId: 'process-card', startTurnIndex: 4, endTurnIndex: 7 }],
            }));

            const completed = await store.completeRun(WORKSPACE_ID, run.id, {
                sourceRanges: [
                    { processId: 'process-run', startTurnIndex: 0, endTurnIndex: 3 },
                    { processId: 'process-run', startTurnIndex: 0, endTurnIndex: 3 },
                ],
                candidateCardIds: [created.id, created.id],
            });
            expect(completed.status).toBe('completed');
            expect(completed).toMatchObject({
                provider: 'claude',
                model: 'claude-sonnet-4.6',
                reasoningEffort: 'high',
                timeoutMs: 3_600_000,
            });
            expect(completed.candidateCardIds).toEqual([created.id]);
            expect(completed.sourceRanges).toEqual([
                { processId: 'process-run', startTurnIndex: 0, endTurnIndex: 3 },
            ]);

            const failedRun = await store.createRun({ workspaceId: WORKSPACE_ID, trigger: 'idle' });
            await store.failRun(WORKSPACE_ID, failedRun.id, {
                error: 'critic failed',
                sourceRanges: [{ processId: 'process-failed', startTurnIndex: 0, endTurnIndex: 2 }],
            });

            const covered = await store.listCoveredSourceRanges(WORKSPACE_ID);
            expect(covered).toEqual([
                { processId: 'process-card', startTurnIndex: 4, endTurnIndex: 7 },
                { processId: 'process-run', startTurnIndex: 0, endTurnIndex: 3 },
            ]);

            const runs = await store.listRuns(WORKSPACE_ID);
            expect(runs.map(storedRun => storedRun.status).sort()).toEqual(['completed', 'failed']);
        });
    });

    it('builds stable fingerprints from normalized recommendation signals', () => {
        const first = buildDreamDedupFingerprint(candidate());
        const second = buildDreamDedupFingerprint(candidate({
            observedPattern: '  THE user repeatedly restates the same code review constraints across sessions!!! ',
            recommendation: 'Harden the code review skill so it carries the recurring constraints by default.',
        }));

        expect(first).toBe(second);
    });
});
