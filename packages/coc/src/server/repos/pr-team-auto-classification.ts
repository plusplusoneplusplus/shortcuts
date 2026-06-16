/**
 * Pull Requests Team auto-classification.
 *
 * This helper is intentionally server-side so PR list refreshes and background
 * cache warming share the same cap, cache/pending checks, queue priority, and
 * stale-pending self-healing behavior.
 */

import type { CreateTaskInput, ProcessStore } from '@plusplusoneplusplus/forge';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import { RepoTreeService } from './tree-service';
import {
    enqueueGenericClassification,
    type EnqueueGenericClassificationResult,
} from './generic-classification-handler';
import {
    listTeamEligiblePullRequests,
    type TeamEligiblePullRequest,
} from './pr-team-eligibility';
import type { PullRequestStorageScopeInput } from './pr-origin-scope';

export const TEAM_PR_AUTO_CLASSIFICATION_ENQUEUE_LIMIT = 10;

export interface TeamAutoClassifiablePullRequest extends TeamEligiblePullRequest {
    number?: string | number;
    headSha?: string;
}

export interface TeamPrAutoClassificationOptions {
    dataDir: string;
    store: ProcessStore;
    bridge: MultiRepoQueueRouter;
    repoTreeService?: RepoTreeService;
    prepareTaskForEnqueue?: (input: CreateTaskInput) => Promise<void>;
    workspaceId: string;
    repoId: string;
    pullRequests: readonly TeamAutoClassifiablePullRequest[];
    maxEnqueues?: number;
    storageScope?: PullRequestStorageScopeInput;
}

export interface TeamPrAutoClassificationResult {
    eligible: number;
    considered: number;
    skippedMissingHeadSha: number;
    skippedMissingNumber: number;
    ready: number;
    running: number;
    started: number;
    notFound: number;
    errors: Array<{ identifier?: string; message: string }>;
}

export async function autoClassifyTeamPullRequests(
    options: TeamPrAutoClassificationOptions,
): Promise<TeamPrAutoClassificationResult> {
    const result: TeamPrAutoClassificationResult = {
        eligible: 0,
        considered: 0,
        skippedMissingHeadSha: 0,
        skippedMissingNumber: 0,
        ready: 0,
        running: 0,
        started: 0,
        notFound: 0,
        errors: [],
    };
    const maxEnqueues = Math.max(0, options.maxEnqueues ?? TEAM_PR_AUTO_CLASSIFICATION_ENQUEUE_LIMIT);
    if (maxEnqueues === 0) return result;

    const { pullRequests } = listTeamEligiblePullRequests(
        options.dataDir,
        options.workspaceId,
        options.repoId,
        options.pullRequests,
        options.storageScope,
    );
    result.eligible = pullRequests.length;

    for (const pr of pullRequests) {
        if (result.started >= maxEnqueues) break;

        const prNumber = getPrNumber(pr);
        if (!prNumber) {
            result.skippedMissingNumber++;
            continue;
        }

        const headSha = typeof pr.headSha === 'string' ? pr.headSha.trim() : '';
        if (!headSha) {
            result.skippedMissingHeadSha++;
            continue;
        }

        const identifier = `${prNumber}:${headSha}`;
        result.considered++;

        let enqueueResult: EnqueueGenericClassificationResult;
        try {
            enqueueResult = await enqueueGenericClassification({
                dataDir: options.dataDir,
                store: options.store,
                bridge: options.bridge,
                repoTreeService: options.repoTreeService,
                prepareTaskForEnqueue: options.prepareTaskForEnqueue,
                workspaceId: options.workspaceId,
                repoId: options.repoId,
                type: 'pr',
                identifier,
                priority: 'low',
            });
        } catch (error) {
            result.errors.push({ identifier, message: error instanceof Error ? error.message : String(error) });
            continue;
        }

        switch (enqueueResult.status) {
            case 'ready':
                result.ready++;
                break;
            case 'running':
                result.running++;
                break;
            case 'started':
                result.started++;
                break;
            case 'not-found':
                result.notFound++;
                result.errors.push({ identifier, message: enqueueResult.message });
                break;
        }
    }

    return result;
}

function getPrNumber(pr: TeamAutoClassifiablePullRequest): string | undefined {
    if (typeof pr.number === 'number') {
        return Number.isSafeInteger(pr.number) && pr.number > 0 ? String(pr.number) : undefined;
    }
    if (typeof pr.number === 'string') {
        const trimmed = pr.number.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    return undefined;
}
