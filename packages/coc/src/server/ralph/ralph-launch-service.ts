/**
 * Launch a Ralph execution loop directly from a goal spec, skipping the
 * grilling/synthesis phase. Mints a new session, initialises the journal, and
 * enqueues the first Ralph execution task.
 *
 * Shared by `POST /api/ralph-launch` and the `ralph` mode of the
 * `send_to_conversation` LLM tool so both launch through one code path.
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { toQueueProcessId, getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import { RalphSessionStore } from './ralph-session-store';
import { buildRalphIterationTask } from './enqueue-iteration';
import { RALPH_DEFAULT_MAX_ITERATIONS, readRepoPreferences } from '../preferences-handler';
import { parseRalphAiSelection } from '../routes/ralph-route-utils';
import { parseWorktreeExecutionRequest } from '../worktree/worktree-request';
import { createRalphLaunchWorktree, attachWorktreeToRalphSession } from './ralph-worktree-launch';
import { captureRalphBaselineSha } from './capture-baseline-sha';
import type { MessagingJobOrigin } from '../messaging/job-notices';
import type { WorktreeMetadata } from '@plusplusoneplusplus/coc-client';

export interface RalphLaunchDeps {
    bridge: MultiRepoQueueRouter;
    /** Repo-scoped data root (`~/.coc` or override). Used for the per-session journal. */
    dataDir?: string;
    /** Process store — resolves the workspace's local checkout for worktree execution. */
    store?: ProcessStore;
    /** Whether the opt-in Git worktree execution feature flag is enabled on this server. */
    getGitWorktreeExecutionEnabled?: () => boolean;
}

export interface RalphLaunchInput {
    /** Goal spec; trimmed, must be non-empty. */
    goalSpec: unknown;
    workspaceId?: string;
    folderPath?: string;
    workingDirectory?: string;
    /**
     * Raw AI selection (`provider`, `config.{model,reasoningEffort,effortTier}`,
     * `reasoningEffort`, `effortTier`, `autoProviderRouting`), validated by
     * `parseRalphAiSelection`.
     */
    aiSelection?: unknown;
    /** Raw opt-in worktree request, validated by `parseWorktreeExecutionRequest`. */
    worktree?: unknown;
    /** Persistent custom title applied to the first iteration's conversation. */
    title?: string;
    /** The chat that spawned this session; nests iteration 1 under it in the chat list. */
    spawnedFromProcessId?: string;
    /** Captured connector route for the delegated whole-session result. */
    messagingOrigin?: MessagingJobOrigin;
}

export type RalphLaunchResult =
    | {
        ok: true;
        processId: string;
        sessionId: string;
        worktree?: WorktreeMetadata;
        worktreeWarning?: string;
    }
    | { ok: false; error: string };

/** Bound launch capability (deps applied); see {@link launchRalphSession}. */
export type LaunchRalphFn = (input: RalphLaunchInput) => Promise<RalphLaunchResult>;

function mintSessionId(): string {
    return `ralph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function launchRalphSession(input: RalphLaunchInput, deps: RalphLaunchDeps): Promise<RalphLaunchResult> {
    const { bridge, dataDir, store, getGitWorktreeExecutionEnabled } = deps;
    const { workspaceId, folderPath, workingDirectory } = input;

    const goalSpec = typeof input.goalSpec === 'string' ? input.goalSpec.trim() : '';
    if (!goalSpec) {
        return { ok: false, error: 'Missing or empty field: goalSpec' };
    }

    const aiSelection = parseRalphAiSelection(input.aiSelection);
    if ('error' in aiSelection) {
        return { ok: false, error: aiSelection.error };
    }
    const { provider, model, reasoningEffort, effortTier, autoProviderRouting } = aiSelection.value;

    // Opt-in Git worktree request. Shape is validated here; the worktree
    // itself is created below (flag-gated) before anything is queued.
    // Omitting it preserves existing behavior.
    const worktree = parseWorktreeExecutionRequest(input.worktree);
    if (!worktree.ok) {
        return { ok: false, error: worktree.error };
    }

    // Resolve max iterations: per-repo preference > hardcoded default.
    let prefMax: number | undefined;
    if (dataDir && workspaceId) {
        try {
            prefMax = readRepoPreferences(dataDir, workspaceId).maxRalphIterations;
        } catch {
            // Preferences are optional
        }
    }
    const maxIterations = prefMax ?? RALPH_DEFAULT_MAX_ITERATIONS;

    const sessionId = mintSessionId();

    // Opt-in isolated Git worktree. Created BEFORE the journal is seeded
    // and BEFORE the first iteration is queued, so a Git failure aborts
    // the launch cleanly (no session record, no enqueue). The first
    // iteration then runs in the worktree checkout instead of the source.
    const worktreeResult = await createRalphLaunchWorktree({
        request: worktree.value,
        getGitWorktreeExecutionEnabled,
        dataDir,
        store,
        workspaceId,
        sessionId,
        goalSpec,
    });
    if (!worktreeResult.ok) {
        return { ok: false, error: worktreeResult.error };
    }
    const worktreeMetadata = worktreeResult.worktree;
    const executionWorkingDirectory = worktreeResult.workingDirectory ?? workingDirectory;
    const executionFolderPath = worktreeMetadata ? worktreeMetadata.path : folderPath;

    // Initialise the per-session journal (idempotent). Non-worktree
    // sessions record the checkout's HEAD as the PR-submit baseline;
    // worktree sessions already carry worktree.baseSha.
    if (dataDir && workspaceId) {
        try {
            const baselineSha = worktreeMetadata
                ? undefined
                : await captureRalphBaselineSha({
                    workingDirectory: workingDirectory ?? folderPath,
                    store,
                    workspaceId,
                });
            const journal = new RalphSessionStore({ dataDir });
            await journal.initSession(workspaceId, sessionId, {
                originalGoal: goalSpec,
                maxIterations,
                baselineSha,
            });
            // Persist the worktree onto the record now that it carries the
            // correct goal/iteration fields (initSession is a no-op if the
            // record already exists).
            if (worktreeMetadata) {
                await attachWorktreeToRalphSession(dataDir, workspaceId, sessionId, worktreeMetadata);
            }
        } catch (err) {
            getLogger().debug(
                LogCategory.AI,
                `[Ralph launch] initSession failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    // Enqueue the first Ralph execution task
    const task = buildRalphIterationTask({
        workspaceId,
        workingDirectory: executionWorkingDirectory,
        folderPath: executionFolderPath,
        sessionId,
        originalGoal: goalSpec,
        iteration: 1,
        maxIterations,
        dataDir,
        provider,
        model,
        reasoningEffort,
        effortTier,
        autoProviderRouting,
        ...(input.title ? { displayName: input.title } : {}),
        extraContext: {
            ...(input.spawnedFromProcessId ? { spawnedFromProcessId: input.spawnedFromProcessId } : {}),
            ...(input.messagingOrigin ? { messagingOrigin: input.messagingOrigin } : {}),
        },
    });
    const taskId = await bridge.enqueue(
        input.title ? { ...task, payload: { ...task.payload, customTitle: input.title } } : task,
    );

    return {
        ok: true,
        processId: toQueueProcessId(taskId),
        sessionId,
        ...(worktreeMetadata ? { worktree: worktreeMetadata } : {}),
        ...(worktreeResult.warning ? { worktreeWarning: worktreeResult.warning } : {}),
    };
}
