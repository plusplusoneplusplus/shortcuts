/**
 * Pure helpers for building Ralph iteration enqueue payloads.
 *
 * Used by:
 *   - the initial ralph-start route (iteration 1),
 *   - the queue-executor bridge (iteration N+1 after RALPH_NEXT),
 *   - the ralph-continue route (resume after CAP_REACHED / NO_SIGNAL at cap).
 */

import { buildRalphIterationPrompt } from './iteration-prompt';
import { getPromptOverride } from '../admin/ralph-prompt-overrides';
import type { ChatProvider } from '../tasks/task-types';

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
    /** Repo-scoped data root; used to resolve admin prompt overrides. */
    dataDir?: string;
    /** Optional carry-over context (e.g. previous attachments, additional ralph fields). */
    extraContext?: Record<string, unknown>;
    /** Display name for the queued task. Defaults to "Ralph iteration N (sessionId)". */
    displayName?: string;
    /** Priority for the enqueued task. Defaults to 'normal'. */
    priority?: 'normal' | 'low' | 'high';
    /** AI provider to use for this Ralph execution task. */
    provider?: ChatProvider;
}

export function buildRalphIterationTask(input: BuildRalphIterationTaskInput) {
    const promptOverride = input.dataDir
        ? (getPromptOverride('ralph-iteration-user', input.dataDir) ?? undefined)
        : undefined;
    const prompt = input.prompt ?? buildRalphIterationPrompt({
        originalGoal: input.originalGoal,
        promptOverride,
    });
    const displayName = input.displayName
        ?? `Ralph iteration ${input.iteration} (${input.sessionId})`;
    return {
        type: 'chat' as const,
        priority: input.priority ?? ('normal' as const),
        repoId: input.workspaceId,
        folderPath: input.folderPath,
        displayName,
        config: {},
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
