import { parseFinalCheckResult } from './final-check-result-parser';
import type {
    FinalCheckResult,
    RalphFinalCheckRecord,
    RalphSessionCompleteReason,
    RalphSessionRecord,
} from './types';

export interface FormatFinalCheckProgressSectionInput {
    checkIndex: number;
    loopIndex: number;
    result: FinalCheckResult;
    timestamp: string;
}

export interface DecideRalphFinalCheckActionsInput<TAdapterContext = Record<string, unknown>> {
    /** Raw assistant response from the completed read-only final-check task. */
    responseText: string;
    taskId: string;
    processId: string;
    workspaceId?: string;
    sessionId?: string;
    checkIndex: number;
    loopIndex: number;
    sourceIteration: number;
    /** Explicit host-resolved cap for automated gap-fix loops. */
    maxGapFixLoops: number;
    /** Explicit session snapshot supplied by the host adapter. */
    session?: Pick<RalphSessionRecord, 'finalChecks'> | null;
    /** Optional final-check start timestamp; falls back to session metadata or nowIso. */
    startedAt?: string;
    /** Optional deterministic clock value for tests/adapters. */
    nowIso?: string;
    /** Host-owned context passed through without inspection. */
    adapterContext?: TAdapterContext;
}

export interface RalphFinalCheckDecision<TAdapterContext = Record<string, unknown>> {
    result: FinalCheckResult;
    progressSection: string;
    existingGapFixLoops: number;
    maxGapFixLoops: number;
    actions: RalphFinalCheckAction<TAdapterContext>[];
}

export type RalphFinalCheckRecordPatch =
    Partial<RalphFinalCheckRecord> & Pick<RalphFinalCheckRecord, 'status'>;

interface RalphFinalCheckActionBase<TAdapterContext> {
    workspaceId?: string;
    sessionId?: string;
    adapterContext?: TAdapterContext;
    checkIndex: number;
    loopIndex: number;
    sourceIteration: number;
    taskId: string;
    processId: string;
}

export interface RalphAppendFinalCheckSectionAction<TAdapterContext = Record<string, unknown>>
    extends RalphFinalCheckActionBase<TAdapterContext> {
    type: 'appendFinalCheckSection';
    section: string;
}

export interface RalphUpsertFinalCheckRecordAction<TAdapterContext = Record<string, unknown>>
    extends RalphFinalCheckActionBase<TAdapterContext> {
    type: 'upsertFinalCheckRecord';
    record: RalphFinalCheckRecordPatch;
}

export interface RalphBroadcastSessionCompleteAction<TAdapterContext = Record<string, unknown>>
    extends RalphFinalCheckActionBase<TAdapterContext> {
    type: 'broadcastSessionComplete';
    totalIterations: number;
    reason: RalphSessionCompleteReason;
}

export interface RalphStartGapFixLoopAction<TAdapterContext = Record<string, unknown>>
    extends RalphFinalCheckActionBase<TAdapterContext> {
    type: 'startGapFixLoop';
    gapFixGoal: string;
    gapCount: number;
    goalSynthesized: boolean;
    existingGapFixLoops: number;
    maxGapFixLoops: number;
    startFailureReason: Extract<RalphSessionCompleteReason, 'final-check-gap-loop-start-failed'>;
    enqueueFailureReason: Extract<RalphSessionCompleteReason, 'final-check-gap-enqueue-failed'>;
    /** Record patch to use if starting the gap loop or enqueueing its task fails. */
    failureRecord: RalphFinalCheckRecordPatch;
    /** Record patch to use after the adapter fills in the host-created gapLoopIndex. */
    successRecordBase: RalphFinalCheckRecordPatch;
}

export type RalphFinalCheckAction<TAdapterContext = Record<string, unknown>> =
    | RalphAppendFinalCheckSectionAction<TAdapterContext>
    | RalphUpsertFinalCheckRecordAction<TAdapterContext>
    | RalphBroadcastSessionCompleteAction<TAdapterContext>
    | RalphStartGapFixLoopAction<TAdapterContext>;

export function formatFinalCheckProgressSection(input: FormatFinalCheckProgressSectionInput): string {
    const { checkIndex, loopIndex, result, timestamp } = input;
    if (result.status === 'unparseable' || result.status === 'invalid') {
        return [
            '---',
            `## Final Check ${checkIndex} - FAILED - ${timestamp}`,
            `Loop: ${loopIndex}`,
            '',
            'The final-check task completed but produced no parseable RALPH_FINAL_CHECK_RESULT block.',
            'Automation stopped. Manual review required.',
            ...(result.error ? [`Error: ${result.error}`] : []),
        ].join('\n');
    }

    if (!result.hasGaps) {
        return [
            '---',
            `## Final Check ${checkIndex} - CLEAN - ${timestamp}`,
            `Loop: ${loopIndex}`,
            '',
            result.summary,
        ].join('\n');
    }

    const gapLines = result.gaps.map((gap) =>
        `- **${gap.id}**: ${gap.title}\n  Evidence: ${gap.evidence}\n  Action: ${gap.recommendedAction}${gap.validation ? `\n  Validation: \`${gap.validation}\`` : ''}`,
    ).join('\n');

    return [
        '---',
        `## Final Check ${checkIndex} - GAPS - ${timestamp}`,
        `Loop: ${loopIndex}`,
        '',
        result.summary,
        '',
        `### Gaps (${result.gaps.length})`,
        gapLines,
        '',
        '### Gap-fix goal',
        result.gapFixGoal ?? '*(synthesized)*',
    ].join('\n');
}

export function decideRalphFinalCheckActions<TAdapterContext = Record<string, unknown>>(
    input: DecideRalphFinalCheckActionsInput<TAdapterContext>,
): RalphFinalCheckDecision<TAdapterContext> {
    const result = parseFinalCheckResult(input.responseText);
    const nowIso = input.nowIso ?? new Date().toISOString();
    const progressSection = formatFinalCheckProgressSection({
        checkIndex: input.checkIndex,
        loopIndex: input.loopIndex,
        result,
        timestamp: nowIso,
    });
    const existingGapFixLoops = countStartedGapFixLoops(input.session);
    const startedAt = input.startedAt
        ?? input.session?.finalChecks?.find(check => check.checkIndex === input.checkIndex)?.startedAt
        ?? nowIso;

    const base = makeActionBase(input);
    const baseRecord = makeBaseCheckRecord(input, startedAt, nowIso);
    const actions: RalphFinalCheckAction<TAdapterContext>[] = [{
        type: 'appendFinalCheckSection',
        ...base,
        section: progressSection,
    }];

    if (result.status === 'unparseable' || result.status === 'invalid') {
        actions.push(upsert(base, {
            status: 'failed',
            ...baseRecord,
            hasGaps: false,
            gapCount: 0,
        }));
        actions.push(broadcast(base, input.sourceIteration, 'final-check-failed'));
        return { result, progressSection, existingGapFixLoops, maxGapFixLoops: input.maxGapFixLoops, actions };
    }

    if (!result.hasGaps || result.gaps.length === 0) {
        actions.push(upsert(base, {
            status: 'completed',
            ...baseRecord,
            hasGaps: false,
            gapCount: 0,
            gapLoopStarted: false,
        }));
        actions.push(broadcast(base, input.sourceIteration, 'signal'));
        return { result, progressSection, existingGapFixLoops, maxGapFixLoops: input.maxGapFixLoops, actions };
    }

    if (existingGapFixLoops >= input.maxGapFixLoops) {
        actions.push(upsert(base, {
            status: 'completed',
            ...baseRecord,
            hasGaps: true,
            gapCount: result.gaps.length,
            gapLoopStarted: false,
            capReached: true,
        }));
        actions.push(broadcast(base, input.sourceIteration, 'cap'));
        return { result, progressSection, existingGapFixLoops, maxGapFixLoops: input.maxGapFixLoops, actions };
    }

    const goalSynthesized = result.goalSynthesized ?? false;
    actions.push({
        type: 'startGapFixLoop',
        ...base,
        gapFixGoal: result.gapFixGoal ?? '',
        gapCount: result.gaps.length,
        goalSynthesized,
        existingGapFixLoops,
        maxGapFixLoops: input.maxGapFixLoops,
        startFailureReason: 'final-check-gap-loop-start-failed',
        enqueueFailureReason: 'final-check-gap-enqueue-failed',
        failureRecord: {
            status: 'completed',
            ...baseRecord,
            hasGaps: true,
            gapCount: result.gaps.length,
            gapLoopStarted: false,
            goalSynthesized,
        },
        successRecordBase: {
            status: 'completed',
            ...baseRecord,
            hasGaps: true,
            gapCount: result.gaps.length,
            gapLoopStarted: true,
            goalSynthesized: goalSynthesized || undefined,
        },
    });

    return { result, progressSection, existingGapFixLoops, maxGapFixLoops: input.maxGapFixLoops, actions };
}

export function countStartedGapFixLoops(
    session?: Pick<RalphSessionRecord, 'finalChecks'> | null,
): number {
    return (session?.finalChecks ?? []).filter(check => check.gapLoopStarted === true).length;
}

function makeActionBase<TAdapterContext>(
    input: DecideRalphFinalCheckActionsInput<TAdapterContext>,
): RalphFinalCheckActionBase<TAdapterContext> {
    return {
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        adapterContext: input.adapterContext,
        checkIndex: input.checkIndex,
        loopIndex: input.loopIndex,
        sourceIteration: input.sourceIteration,
        taskId: input.taskId,
        processId: input.processId,
    };
}

function makeBaseCheckRecord(
    input: Pick<DecideRalphFinalCheckActionsInput, 'loopIndex' | 'sourceIteration' | 'taskId' | 'processId'>,
    startedAt: string,
    completedAt: string,
): Pick<RalphFinalCheckRecord, 'loopIndex' | 'sourceIteration' | 'taskId' | 'processId' | 'startedAt' | 'completedAt'> {
    return {
        loopIndex: input.loopIndex,
        sourceIteration: input.sourceIteration,
        taskId: input.taskId,
        processId: input.processId,
        startedAt,
        completedAt,
    };
}

function upsert<TAdapterContext>(
    base: RalphFinalCheckActionBase<TAdapterContext>,
    record: RalphFinalCheckRecordPatch,
): RalphUpsertFinalCheckRecordAction<TAdapterContext> {
    return {
        type: 'upsertFinalCheckRecord',
        ...base,
        record,
    };
}

function broadcast<TAdapterContext>(
    base: RalphFinalCheckActionBase<TAdapterContext>,
    totalIterations: number,
    reason: RalphSessionCompleteReason,
): RalphBroadcastSessionCompleteAction<TAdapterContext> {
    return {
        type: 'broadcastSessionComplete',
        ...base,
        totalIterations,
        reason,
    };
}
