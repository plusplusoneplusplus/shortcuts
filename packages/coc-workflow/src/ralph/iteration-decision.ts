import { parseRalphSignal } from './signal-parser';
import { classifyRalphProgressStagnation } from './progress-classifier';
import type { ParsedProgressSection, RalphExitSignal, RalphTerminalReason } from './types';
import type { RalphProgressStagnationClassification } from './progress-classifier';

export type RalphIterationCompletionReason = 'signal' | 'manual-verification-only' | 'cap';

export interface DecideRalphIterationActionsInput<TAdapterContext = Record<string, unknown>> {
    /** Raw assistant response from one completed Ralph execution iteration. */
    responseText: string;
    /** Queue/task identifier of the completed iteration in the host adapter. */
    taskId: string;
    /** Process/conversation identifier associated with the completed iteration. */
    processId: string;
    /** Workspace/session fields are opaque to this pure helper and passed through for adapters. */
    workspaceId?: string;
    sessionId?: string;
    originalGoal?: string;
    /** 1-based iteration counter. Defaults match the CoC Ralph adapter. */
    currentIteration?: number;
    maxIterations?: number;
    /**
     * Optional host-owned context that should be carried to follow-on intents
     * (for example schedule metadata). This module does not inspect it.
     */
    adapterContext?: TAdapterContext;
    /** Optional host-provided recent journal sections for conservative stagnation classification. */
    recentProgressSections?: Pick<ParsedProgressSection, 'signal' | 'body'>[];
    /** Optional iteration-start timestamp to pass through to the record intent. */
    iterationStartMs?: number;
}

export interface RalphIterationDecision<TAdapterContext = Record<string, unknown>> {
    signal: RalphExitSignal;
    progress: string;
    currentIteration: number;
    maxIterations: number;
    shouldContinue: boolean;
    terminalReason?: RalphTerminalReason;
    completionReason?: RalphIterationCompletionReason;
    progressClassification: RalphProgressStagnationClassification;
    actions: RalphIterationAction<TAdapterContext>[];
}

interface RalphActionBase<TAdapterContext> {
    workspaceId?: string;
    sessionId?: string;
    adapterContext?: TAdapterContext;
}

export interface RalphRecordIterationAction<TAdapterContext = Record<string, unknown>>
    extends RalphActionBase<TAdapterContext> {
    type: 'recordIteration';
    iteration: number;
    maxIterations: number;
    signal: RalphExitSignal;
    progressBody: string;
    taskId: string;
    processId: string;
    shouldContinue: boolean;
    originalGoal?: string;
    terminalReason?: RalphTerminalReason;
    iterationStartMs?: number;
}

export interface RalphEnqueueNextIterationAction<TAdapterContext = Record<string, unknown>>
    extends RalphActionBase<TAdapterContext> {
    type: 'enqueueNextIteration';
    iteration: number;
    maxIterations: number;
    originalGoal: string;
    continuationOfSessionId: string;
    displayName: string;
}

export interface RalphEnqueueFinalCheckAction<TAdapterContext = Record<string, unknown>>
    extends RalphActionBase<TAdapterContext> {
    type: 'enqueueFinalCheck';
    sourceIteration: number;
    maxIterations: number;
    originalGoal: string;
    continuationOfSessionId: string;
    terminalReason: Extract<RalphTerminalReason, 'RALPH_COMPLETE' | 'MANUAL_VERIFICATION_ONLY'>;
    completionReason: Extract<RalphIterationCompletionReason, 'signal' | 'manual-verification-only'>;
}

export interface RalphCompleteSessionAction<TAdapterContext = Record<string, unknown>>
    extends RalphActionBase<TAdapterContext> {
    type: 'completeSession';
    processId: string;
    totalIterations: number;
    terminalReason: Exclude<RalphTerminalReason, 'RALPH_COMPLETE' | 'MANUAL_VERIFICATION_ONLY'>;
    completionReason: 'cap';
}

export interface RalphSurfaceTerminalReasonAction<TAdapterContext = Record<string, unknown>>
    extends RalphActionBase<TAdapterContext> {
    type: 'surfaceTerminalReason';
    iteration: number;
    signal: RalphExitSignal;
    terminalReason: RalphTerminalReason;
    completionReason: RalphIterationCompletionReason;
}

export type RalphIterationAction<TAdapterContext = Record<string, unknown>> =
    | RalphRecordIterationAction<TAdapterContext>
    | RalphEnqueueNextIterationAction<TAdapterContext>
    | RalphEnqueueFinalCheckAction<TAdapterContext>
    | RalphCompleteSessionAction<TAdapterContext>
    | RalphSurfaceTerminalReasonAction<TAdapterContext>;

export function decideRalphIterationActions<TAdapterContext = Record<string, unknown>>(
    input: DecideRalphIterationActionsInput<TAdapterContext>,
): RalphIterationDecision<TAdapterContext> {
    const { signal, progress } = parseRalphSignal(input.responseText);
    const currentIteration = input.currentIteration ?? 1;
    const maxIterations = input.maxIterations ?? 20;
    const progressClassification = classifyRalphProgressStagnation({
        progress,
        recentSections: input.recentProgressSections,
    });
    const manualVerificationOnly = signal === 'RALPH_NEXT'
        && progressClassification === 'manualVerificationOnly';
    const shouldContinue = signal === 'RALPH_NEXT' && currentIteration < maxIterations && !manualVerificationOnly;
    const terminalReason = shouldContinue ? undefined : getTerminalReason(signal, manualVerificationOnly);
    const completionReason = terminalReason ? getCompletionReason(terminalReason) : undefined;

    const recordAction: RalphRecordIterationAction<TAdapterContext> = {
        type: 'recordIteration',
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        adapterContext: input.adapterContext,
        iteration: currentIteration,
        maxIterations,
        signal,
        progressBody: progress,
        taskId: input.taskId,
        processId: input.processId,
        shouldContinue,
        originalGoal: input.originalGoal,
        terminalReason,
        iterationStartMs: input.iterationStartMs,
    };

    const actions: RalphIterationAction<TAdapterContext>[] = [recordAction];
    const effectiveSessionId = input.sessionId ?? input.processId;

    if (shouldContinue) {
        const nextIteration = currentIteration + 1;
        actions.push({
            type: 'enqueueNextIteration',
            workspaceId: input.workspaceId,
            sessionId: effectiveSessionId,
            adapterContext: input.adapterContext,
            iteration: nextIteration,
            maxIterations,
            originalGoal: input.originalGoal ?? '',
            continuationOfSessionId: effectiveSessionId,
            displayName: `Ralph iteration ${nextIteration}${input.sessionId ? ` (${input.sessionId})` : ''}`,
        });

        return { signal, progress, currentIteration, maxIterations, shouldContinue, progressClassification, actions };
    }

    const finalTerminalReason = terminalReason ?? getTerminalReason(signal);
    const finalCompletionReason = getCompletionReason(finalTerminalReason);

    actions.push({
        type: 'surfaceTerminalReason',
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        adapterContext: input.adapterContext,
        iteration: currentIteration,
        signal,
        terminalReason: finalTerminalReason,
        completionReason: finalCompletionReason,
    });

    if (signal === 'RALPH_COMPLETE' || finalTerminalReason === 'MANUAL_VERIFICATION_ONLY') {
        actions.push({
            type: 'enqueueFinalCheck',
            workspaceId: input.workspaceId,
            sessionId: input.sessionId,
            adapterContext: input.adapterContext,
            sourceIteration: currentIteration,
            maxIterations,
            originalGoal: input.originalGoal ?? '',
            continuationOfSessionId: effectiveSessionId,
            terminalReason: finalTerminalReason as Extract<RalphTerminalReason, 'RALPH_COMPLETE' | 'MANUAL_VERIFICATION_ONLY'>,
            completionReason: finalCompletionReason as Extract<RalphIterationCompletionReason, 'signal' | 'manual-verification-only'>,
        });
    } else {
        actions.push({
            type: 'completeSession',
            workspaceId: input.workspaceId,
            sessionId: input.sessionId,
            adapterContext: input.adapterContext,
            processId: input.processId,
            totalIterations: currentIteration,
            terminalReason: terminalReason as Exclude<RalphTerminalReason, 'RALPH_COMPLETE' | 'MANUAL_VERIFICATION_ONLY'>,
            completionReason: 'cap',
        });
    }

    return {
        signal,
        progress,
        currentIteration,
        maxIterations,
        shouldContinue,
        terminalReason: finalTerminalReason,
        completionReason: finalCompletionReason,
        progressClassification,
        actions,
    };
}

function getTerminalReason(signal: RalphExitSignal, manualVerificationOnly = false): RalphTerminalReason {
    if (manualVerificationOnly) {
        return 'MANUAL_VERIFICATION_ONLY';
    }
    if (signal === 'RALPH_COMPLETE') {
        return 'RALPH_COMPLETE';
    }
    if (signal === 'NONE') {
        return 'NO_SIGNAL';
    }
    return 'CAP_REACHED';
}

function getCompletionReason(terminalReason: RalphTerminalReason): RalphIterationCompletionReason {
    if (terminalReason === 'RALPH_COMPLETE') {
        return 'signal';
    }
    if (terminalReason === 'MANUAL_VERIFICATION_ONLY') {
        return 'manual-verification-only';
    }
    return 'cap';
}
