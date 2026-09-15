import type {
    QueuedTask,
    TaskExecutionResult,
    TaskQueueManager,
} from '@plusplusoneplusplus/forge';
import { execGitAsync } from '@plusplusoneplusplus/forge';
import { gitHeadSha } from '../ralph/capture-baseline-sha';
import {
    buildImplementPlanPrSubmitPrompt,
    getImplementPlanReference,
    parseImplementPlanPrSubmitResult,
} from './implement-plan-pr-submit';

const FULL_SHA_RE = /^[0-9a-f]{40}$/i;

export type CaptureHeadSha = (workingDirectory: string) => Promise<string | undefined>;
export type ListCommitShas = (
    workingDirectory: string,
    baselineSha: string,
    endSha: string,
) => Promise<string[]>;

export interface ExecuteImplementPlanWithPrGateInput {
    task: QueuedTask;
    queueManager?: TaskQueueManager;
    workingDirectory?: string;
    execute: () => Promise<TaskExecutionResult>;
    captureHeadSha?: CaptureHeadSha;
    listCommitShas?: ListCommitShas;
}

/** Return the exact oldest-first commits in the closed baseline-to-end range. */
export async function listImplementPlanCommitShas(
    workingDirectory: string,
    baselineSha: string,
    endSha: string,
): Promise<string[]> {
    const output = await execGitAsync(
        ['rev-list', '--reverse', `${baselineSha}..${endSha}`],
        workingDirectory,
        { timeout: 10_000 },
    );
    const shas = output.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    if (shas.some(sha => !FULL_SHA_RE.test(sha))) {
        throw new Error('git returned an invalid commit SHA for the implement-plan range');
    }
    return shas;
}

/**
 * Capture the commit range around only the first task in an implement-plan
 * chain. Same-chain follow-up tasks bypass this wrapper.
 */
export async function executeImplementPlanWithPrGate(
    input: ExecuteImplementPlanWithPrGateInput,
): Promise<TaskExecutionResult> {
    const marker = input.task.config?.prGate;
    const repoId = input.task.repoId;
    const gate = repoId ? input.queueManager?.getRepoGate(repoId) : undefined;
    if (!marker || !repoId || !gate || gate.chainId !== marker.chainId) {
        return input.execute();
    }
    if (marker.taskKind === 'pr-submit') {
        return executePrSubmitTask(input, repoId, marker.chainId);
    }
    if (gate.implementTaskId !== input.task.id) {
        return input.execute();
    }

    const startedAt = Date.now();
    if (!input.workingDirectory) {
        return captureFailure(startedAt, 'Cannot capture the implement-plan baseline: no working directory');
    }

    const captureHead = input.captureHeadSha ?? gitHeadSha;
    const listCommits = input.listCommitShas ?? listImplementPlanCommitShas;
    let baselineSha: string | undefined;
    try {
        baselineSha = await captureHead(input.workingDirectory);
    } catch (error) {
        return captureFailure(startedAt, `Cannot capture the implement-plan baseline: ${errorMessage(error)}`);
    }
    if (!baselineSha) {
        return captureFailure(startedAt, 'Cannot capture the implement-plan baseline HEAD');
    }

    input.queueManager!.recordRepoGateBaseline(repoId, marker.chainId, input.task.id, baselineSha);
    marker.baselineSha = baselineSha;

    const result = await input.execute();
    if (!result.success) {
        return result;
    }

    let endSha: string | undefined;
    let commitShas: string[];
    try {
        endSha = await captureHead(input.workingDirectory);
        if (!endSha) {
            return captureFailure(startedAt, 'Cannot capture the implement-plan ending HEAD');
        }
        commitShas = baselineSha === endSha
            ? []
            : await listCommits(input.workingDirectory, baselineSha, endSha);
    } catch (error) {
        return captureFailure(startedAt, `Cannot capture the implement-plan commit range: ${errorMessage(error)}`);
    }

    if (baselineSha !== endSha && commitShas.length === 0) {
        return captureFailure(startedAt, `No commits found in exact range ${baselineSha}..${endSha}`);
    }

    const noCommits = commitShas.length === 0;
    const completion = {
        endSha,
        commitShas,
        outcome: noCommits ? 'no-commits' as const : 'commits-recorded' as const,
        ...(noCommits ? { reason: 'no commits produced' } : {}),
    };
    input.queueManager!.recordRepoGateCompletion(
        repoId,
        marker.chainId,
        input.task.id,
        completion,
    );
    Object.assign(marker, completion);

    if (noCommits) {
        input.queueManager!.releaseRepoGate(repoId, marker.chainId);
    } else {
        enqueuePrSubmitTask(input.task, input.queueManager!, repoId, baselineSha, endSha, commitShas);
    }
    return result;
}

async function executePrSubmitTask(
    input: ExecuteImplementPlanWithPrGateInput,
    repoId: string,
    chainId: string,
): Promise<TaskExecutionResult> {
    const result = await input.execute();
    if (!result.success) {
        return result;
    }

    const parsed = parseImplementPlanPrSubmitResult(responseText(result.result));
    input.queueManager!.recordRepoGateSubmission(repoId, chainId, {
        submissionStatus: parsed.status,
        ...(parsed.prUrl ? { prUrl: parsed.prUrl } : {}),
        ...(parsed.prNumber !== undefined ? { prNumber: parsed.prNumber } : {}),
        ...(parsed.error ? { reason: parsed.error } : {}),
    });
    if (parsed.status === 'failed') {
        input.queueManager!.pauseRepo(repoId, {
            taskId: input.task.id,
            displayName: `PR submission failed: ${parsed.error ?? 'unknown error'}`,
            failedAt: new Date().toISOString(),
        });
    }
    return result;
}

function enqueuePrSubmitTask(
    task: QueuedTask,
    queueManager: TaskQueueManager,
    repoId: string,
    baselineSha: string,
    endSha: string,
    commitShas: string[],
): void {
    const marker = task.config.prGate!;
    const prompt = buildImplementPlanPrSubmitPrompt({
        baselineSha,
        endSha,
        commitShas,
        planReference: getImplementPlanReference(task),
    });
    queueManager.enqueue({
        type: 'chat',
        priority: task.priority,
        repoId,
        folderPath: task.folderPath,
        displayName: 'Submit implementation PR',
        payload: {
            kind: 'chat',
            mode: 'autopilot',
            prompt,
            ...copyPayloadSelection(task.payload),
        },
        config: {
            ...task.config,
            pauseOnFailure: true,
            prGate: {
                ...marker,
                baselineSha,
                endSha,
                commitShas,
                taskKind: 'pr-submit',
            },
        },
    });
    queueManager.recordRepoGateSubmission(repoId, marker.chainId, {
        submissionStatus: 'pending',
    });
}

function copyPayloadSelection(payload: Record<string, unknown>): Record<string, unknown> {
    const keys = ['provider', 'model', 'reasoningEffort', 'workingDirectory', 'workspaceId', 'folderPath'] as const;
    return Object.fromEntries(
        keys.flatMap(key => payload[key] === undefined ? [] : [[key, payload[key]]]),
    );
}

function responseText(result: unknown): string {
    if (typeof result === 'string') {
        return result;
    }
    if (result && typeof result === 'object' && !Array.isArray(result)) {
        const response = (result as Record<string, unknown>).response;
        return typeof response === 'string' ? response : '';
    }
    return '';
}

function captureFailure(startedAt: number, message: string): TaskExecutionResult {
    return {
        success: false,
        error: new Error(message),
        durationMs: Date.now() - startedAt,
    };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
