/**
 * Pure helpers for building Ralph iteration enqueue payloads.
 *
 * Used by:
 *   - the initial ralph-start route (iteration 1),
 *   - the queue-executor bridge (iteration N+1 after RALPH_NEXT),
 *   - the ralph-continue route (resume after CAP_REACHED / NO_SIGNAL at cap).
 */

import { buildRalphIterationPrompt } from '@plusplusoneplusplus/coc-workflow/ralph';
import { RalphSessionStore } from './ralph-session-store';
import type { ChatContext, ChatProvider, ReasoningEffort } from '../tasks/task-types';

export type RalphEffortTier = 'very-low' | 'low' | 'medium' | 'high';

export interface BuildRalphIterationTaskInput {
    workspaceId?: string;
    workingDirectory?: string;
    folderPath?: string;
    sessionId: string;
    originalGoal: string;
    iteration: number;
    maxIterations: number;
    /** Optional pre-built prompt; when omitted, uses {@link buildRalphIterationPrompt}. */
    prompt?: string;
    /** Repo-scoped data root; used to resolve the progress-journal path. */
    dataDir?: string;
    /** Optional carry-over context (e.g. previous attachments, additional ralph fields). */
    extraContext?: ChatContext | Record<string, unknown>;
    /** Display name for the queued task. Defaults to "Ralph iteration N (sessionId)". */
    displayName?: string;
    /** Priority for the enqueued task. Defaults to 'normal'. */
    priority?: 'normal' | 'low' | 'high';
    /** AI provider to use for this Ralph execution task. */
    provider?: ChatProvider;
    /** Optional model override for this Ralph execution task. */
    model?: string;
    /** Optional reasoning-effort override for this Ralph execution task. */
    reasoningEffort?: ReasoningEffort;
    /** Optional effort tier to expand after provider resolution. */
    effortTier?: RalphEffortTier;
    /**
     * When set, the enqueued task is tagged as a continuation of this Ralph
     * session, allowing the queue manager to admit it ahead of unrelated
     * exclusive backlog. Should be the session's `sessionId`.
     */
    continuationOfSessionId?: string;
}

export function buildRalphIterationTask(input: BuildRalphIterationTaskInput) {
    const progressPath = (input.dataDir && input.workspaceId)
        ? new RalphSessionStore({ dataDir: input.dataDir }).getProgressPath(input.workspaceId, input.sessionId)
        : undefined;

    const prompt = input.prompt ?? buildRalphIterationPrompt({
        originalGoal: input.originalGoal,
        progressPath,
        currentIteration: input.iteration,
        maxIterations: input.maxIterations,
    });
    const displayName = input.displayName
        ?? `Ralph iteration ${input.iteration} (${input.sessionId})`;
    const extraRalphContext = normaliseExtraRalphContext(input.extraContext?.ralph);
    return {
        type: 'chat' as const,
        priority: input.priority ?? ('normal' as const),
        repoId: input.workspaceId,
        folderPath: input.folderPath,
        continuationOfSessionId: input.continuationOfSessionId,
        displayName,
        config: {
            ...(input.model ? { model: input.model } : {}),
            ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
            ...(input.effortTier ? { effortTier: input.effortTier } : {}),
        },
        payload: {
            kind: 'chat' as const,
            mode: 'ralph' as const,
            prompt,
            workspaceId: input.workspaceId,
            workingDirectory: input.workingDirectory,
            folderPath: input.folderPath,
            provider: input.provider,
            context: {
                ...(input.extraContext ?? {}),
                ralph: {
                    ...extraRalphContext,
                    phase: 'executing' as const,
                    sessionId: input.sessionId,
                    originalGoal: input.originalGoal,
                    currentIteration: input.iteration,
                    maxIterations: input.maxIterations,
                },
            },
        },
    };
}

function normaliseExtraRalphContext(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    const rest = { ...(value as Record<string, unknown>) };
    delete rest.currentIteration;
    delete rest.finalCheck;
    delete rest.maxIterations;
    delete rest.originalGoal;
    delete rest.phase;
    delete rest.sessionId;
    return rest;
}
