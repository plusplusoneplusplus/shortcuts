/**
 * Admit a target-owned native Ralph interview or direct execution session.
 * Omitted entryPoint preserves execution. Stable admission identities recover
 * accepted children without relaunching uncertain queue requests.
 *
 * Shared by `POST /api/ralph-launch` and the `ralph` mode of the
 * `send_to_conversation` LLM tool so both launch through one code path.
 */

import type { ProcessStore, CreateTaskInput } from '@plusplusoneplusplus/forge';
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
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { getRepoDataPath } from '../paths';
import { atomicWriteJsonUnique } from '../shared/fs-utils';
import { processOperationAdmission } from '../processes/process-operation-admission';
import { buildRalphGrillingSubmission } from './grilling-submission';
import { prepareRalphGrilling } from './grilling-state';
import type { WorktreeMetadata, SentinelTodoTrackedAdmission } from '@plusplusoneplusplus/coc-client';

export interface RalphLaunchDeps {
    guardTrackedLaunch?: (input: RalphLaunchInput) => Promise<void>;
    onTrackedLaunchFailure?: (input: RalphLaunchInput, error: unknown) => void;
    getRalphEnabled?: () => boolean;
    bridge: MultiRepoQueueRouter;
    /** Repo-scoped data root (`~/.coc` or override). Used for the per-session journal. */
    dataDir?: string;
    /** Process store — resolves the workspace's local checkout for worktree execution. */
    store?: ProcessStore;
    /** Whether the opt-in Git worktree execution feature flag is enabled on this server. */
    getGitWorktreeExecutionEnabled?: () => boolean;
}

export interface RalphLaunchInput {
    sentinelTodoTracking?: SentinelTodoTrackedAdmission;
    /** Stable source-approved admission identity; execution retries never mint a new child. */
    requestId?: string;
    entryPoint?: 'grill' | 'execute';
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
        phase?: 'grilling' | 'executing';
        workspaceId?: string;
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
    try {
        const result = await launchRalphSessionAdmitted(input, deps);
        if (!result.ok) deps.onTrackedLaunchFailure?.(input, result.error);
        return result;
    } catch (error) {
        deps.onTrackedLaunchFailure?.(input, error);
        throw error;
    }
}

async function launchRalphSessionAdmitted(input: RalphLaunchInput, deps: RalphLaunchDeps): Promise<RalphLaunchResult> {
    if (input.requestId === undefined) {
        await deps.guardTrackedLaunch?.(input);
        return launchRalphSessionOnce(input, deps);
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId)
        || !deps.dataDir || !input.workspaceId || !deps.store) return { ok: false, error: 'Invalid or unavailable Ralph admission identity' };
    const sessionId = `ralph-approved-${input.requestId}`;
    const file = getRepoDataPath(deps.dataDir, input.workspaceId, `ralph-sessions/${sessionId}/admission.json`);
    const trackedFingerprint = input.sentinelTodoTracking ? JSON.stringify({
        tracking: input.sentinelTodoTracking, workspaceId: input.workspaceId, aiSelection: input.aiSelection,
        folderPath: input.folderPath, workingDirectory: input.workingDirectory, worktree: input.worktree,
        parent: input.spawnedFromProcessId,
    }) : undefined;
    return processOperationAdmission.runExclusive(toQueueProcessId(input.requestId), async () => {
        let prior: { goalSpec: unknown; entryPoint?: string; trackedFingerprint?: string; status: string; result?: RalphLaunchResult } | undefined;
        try { prior = JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (prior && (prior.goalSpec !== input.goalSpec || prior.entryPoint !== input.entryPoint || prior.trackedFingerprint !== trackedFingerprint)) {
            return { ok: false, error: 'Ralph admission identity already belongs to another goal, entry point or tracked settings' };
        }
        if (prior?.result?.ok) return prior.result;
        // A rejected delegation has already settled its tracking receipt. A
        // separate explicit tool call can create a new job, never this replay.
        if (input.entryPoint === 'grill' && prior?.status === 'rejected') {
            return prior.result ?? { ok: false, error: 'The native grilling request was rejected; create a new delegation to retry.' };
        }
        if (prior?.status === 'admitting') {
            if (deps.bridge.getTask(input.requestId!)) {
                const result: RalphLaunchResult = { ok: true, processId: toQueueProcessId(input.requestId!), sessionId,
                    phase: input.entryPoint === 'grill' ? 'grilling' : 'executing', workspaceId: input.workspaceId };
                atomicWriteJsonUnique(file, { ...prior, status: 'admitted', result });
                return result;
            }
            return { ok: false, error: 'Ralph admission is uncertain; inspect the target session before retrying. No new launch was attempted.' };
        }
        await deps.guardTrackedLaunch?.(input);
        if (deps.getRalphEnabled?.() !== true) return { ok: false, error: 'Native Ralph admission is disabled (ralph.enabled)' };
        if (!(await deps.store!.getWorkspaces()).some(workspace => workspace.id === input.workspaceId)) {
            return { ok: false, error: 'Native Ralph admission requires a registered owning workspace' };
        }
        atomicWriteJsonUnique(file, { goalSpec: input.goalSpec, entryPoint: input.entryPoint, trackedFingerprint, status: 'admitting' });
        try {
            let result = await launchRalphSessionOnce(input, deps);
            // Queue observers can fail after acceptance. Preserve the admitted
            // identity instead of retrying an already accepted interview.
            if (!result.ok && deps.bridge.getTask(input.requestId!)) {
                result = { ok: true, processId: toQueueProcessId(input.requestId!), sessionId,
                    phase: input.entryPoint === 'grill' ? 'grilling' : 'executing', workspaceId: input.workspaceId };
            }
            atomicWriteJsonUnique(file, { goalSpec: input.goalSpec, entryPoint: input.entryPoint, trackedFingerprint, status: result.ok ? 'admitted' : 'rejected', result });
            return result;
        } catch (error) {
            if (!deps.bridge.getTask(input.requestId!)) atomicWriteJsonUnique(file, { goalSpec: input.goalSpec, entryPoint: input.entryPoint, trackedFingerprint, status: 'rejected' });
            throw error;
        }
    });
}

async function launchRalphSessionOnce(input: RalphLaunchInput, deps: RalphLaunchDeps): Promise<RalphLaunchResult> {
    const { bridge, dataDir, store, getGitWorktreeExecutionEnabled } = deps;
    const { workspaceId, folderPath, workingDirectory } = input;
    if (input.entryPoint !== undefined && !['grill', 'execute'].includes(input.entryPoint)) {
        return { ok: false, error: 'Invalid entryPoint: expected grill or execute' };
    }

    const goalSpec = typeof input.goalSpec === 'string' ? input.goalSpec.trim() : '';
    if (!goalSpec) {
        return { ok: false, error: 'Missing or empty field: goalSpec' };
    }

    const aiSelection = parseRalphAiSelection(input.aiSelection);
    if ('error' in aiSelection) {
        return { ok: false, error: aiSelection.error };
    }
    const { provider, model, reasoningEffort, effortTier, autoProviderRouting } = aiSelection.value;

    if (input.entryPoint === 'grill') {
        if (!dataDir || !store || !workspaceId) return { ok: false, error: 'Native Ralph grilling admission is unavailable' };
        if (input.worktree !== undefined) return { ok: false, error: 'Worktree execution requires Start Ralph approval' };
        const sessionId = input.requestId ? `ralph-approved-${input.requestId}` : mintSessionId();
        const submission = buildRalphGrillingSubmission({ prompt: goalSpec, sessionId });
        const task = {
            id: input.requestId ?? randomUUID(), type: 'chat' as const, priority: 'normal' as const,
            displayName: input.title ?? 'Ralph interview',
            payload: {
                kind: 'chat', workspaceId, mode: submission.mode, prompt: submission.prompt,
                ...(provider ? { provider } : {}),
                ...(input.title ? { customTitle: input.title } : {}),
                context: {
                    ...submission.context,
                    ...(autoProviderRouting ? { autoProviderRouting: { requested: true } } : {}),
                    ...(input.spawnedFromProcessId ? { spawnedFromProcessId: input.spawnedFromProcessId } : {}),
                    ...(input.sentinelTodoTracking ? { sentinelTodoTracking: input.sentinelTodoTracking } : {}),
                    ...(input.messagingOrigin ? { messagingOrigin: input.messagingOrigin } : {}),
                },
            },
            config: { ...(model ? { model } : {}), ...(reasoningEffort ? { reasoningEffort } : {}), ...(effortTier ? { effortTier } : {}) },
        };
        try {
            await prepareRalphGrilling(task, { dataDir, store, enabled: deps.getRalphEnabled?.() === true });
            const taskId = await bridge.enqueue(task);
            return { ok: true, processId: toQueueProcessId(taskId), sessionId, phase: 'grilling', workspaceId };
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

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

    const sessionId = input.requestId ? `ralph-approved-${input.requestId}` : mintSessionId();

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
    const task: CreateTaskInput = buildRalphIterationTask({
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
            ...(input.sentinelTodoTracking ? { sentinelTodoTracking: input.sentinelTodoTracking } : {}),
            ...(input.spawnedFromProcessId ? { spawnedFromProcessId: input.spawnedFromProcessId } : {}),
            ...(input.messagingOrigin ? { messagingOrigin: input.messagingOrigin } : {}),
        },
    });
    if (input.requestId) task.id = input.requestId;
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
