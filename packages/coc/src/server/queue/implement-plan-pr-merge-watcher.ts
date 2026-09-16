import type {
    ProcessStore,
    ProviderPullRequestAutoMerge,
    ProviderPullRequestCheck,
    ProviderPullRequestStatus,
    TaskQueueManager,
} from '@plusplusoneplusplus/forge';
import { resolveWorkspaceOriginId } from '../repos/origin-scope';
import { fetchOriginPullRequestChecksHeadless } from '../repos/pr-routes';
import { recordImplementationPrAnnotation } from './implement-plan-pr-record';

export const IMPLEMENT_PLAN_PR_MERGE_POLL_INTERVAL_MS = 60_000;

export interface ImplementPlanPrMergeSnapshot {
    status: ProviderPullRequestStatus;
    autoMerge?: ProviderPullRequestAutoMerge;
    checks: ProviderPullRequestCheck[];
}

export type FetchImplementPlanPrMergeStatus = (input: {
    workspaceId: string;
    prNumber: number;
}) => Promise<ImplementPlanPrMergeSnapshot>;

interface ActiveWatch {
    chainId: string;
    timer: NodeJS.Timeout;
}

export class ImplementPlanPrMergeWatcher {
    private readonly watches = new Map<string, ActiveWatch>();
    private readonly fetchStatus: FetchImplementPlanPrMergeStatus;
    private readonly pollIntervalMs: number;
    private disposed = false;

    constructor(
        fetchStatus: FetchImplementPlanPrMergeStatus,
        pollIntervalMs = IMPLEMENT_PLAN_PR_MERGE_POLL_INTERVAL_MS,
        private readonly processStore?: ProcessStore,
    ) {
        this.fetchStatus = fetchStatus;
        this.pollIntervalMs = pollIntervalMs;
    }

    sync(repoId: string, queueManager: TaskQueueManager): void {
        const gate = queueManager.getRepoGate(repoId);
        if (this.disposed || gate?.submissionStatus !== 'submitted' || gate.prNumber === undefined) {
            this.stop(repoId);
            return;
        }

        const active = this.watches.get(repoId);
        if (active?.chainId === gate.chainId) {
            return;
        }
        this.stop(repoId);
        this.schedule(repoId, gate.chainId, gate.prNumber, queueManager);
    }

    dispose(): void {
        this.disposed = true;
        for (const repoId of this.watches.keys()) {
            this.stop(repoId);
        }
    }

    private schedule(
        repoId: string,
        chainId: string,
        prNumber: number,
        queueManager: TaskQueueManager,
    ): void {
        if (this.disposed) return;
        const timer = setTimeout(() => {
            void this.poll(repoId, chainId, prNumber, queueManager);
        }, this.pollIntervalMs);
        timer.unref?.();
        this.watches.set(repoId, { chainId, timer });
    }

    private async poll(
        repoId: string,
        chainId: string,
        prNumber: number,
        queueManager: TaskQueueManager,
    ): Promise<void> {
        const active = this.watches.get(repoId);
        if (!active || active.chainId !== chainId) return;
        this.watches.delete(repoId);

        const gate = queueManager.getRepoGate(repoId);
        if (gate?.chainId !== chainId || gate.submissionStatus !== 'submitted') {
            return;
        }

        try {
            const snapshot = await this.fetchStatus({ workspaceId: repoId, prNumber });
            if (snapshot.status === 'merged') {
                if (this.processStore && gate.prUrl) {
                    await recordImplementationPrAnnotation(this.processStore, gate.implementProcessId, {
                        chainId,
                        prUrl: gate.prUrl,
                        prNumber,
                        prState: 'merged',
                    });
                }
                queueManager.releaseRepoGate(repoId, chainId);
                queueManager.resumeRepo(repoId);
                return;
            }

            const blockedState = describeBlockedState(snapshot);
            if (blockedState) {
                queueManager.pauseRepo(repoId, {
                    taskId: gate.implementTaskId,
                    displayName: `Holding for PR #${prNumber}: ${blockedState}`,
                    failedAt: new Date().toISOString(),
                });
            }
        } catch (error) {
            queueManager.pauseRepo(repoId, {
                taskId: gate.implementTaskId,
                displayName: `Holding for PR #${prNumber}: status unavailable (${errorMessage(error)})`,
                failedAt: new Date().toISOString(),
            });
        }

        this.schedule(repoId, chainId, prNumber, queueManager);
    }

    private stop(repoId: string): void {
        const active = this.watches.get(repoId);
        if (!active) return;
        clearTimeout(active.timer);
        this.watches.delete(repoId);
    }
}

export function createImplementPlanPrMergeStatusFetcher(
    dataDir: string,
    store: ProcessStore,
): FetchImplementPlanPrMergeStatus {
    return async ({ workspaceId, prNumber }) => {
        const workspace = (await store.getWorkspaces()).find(candidate => candidate.id === workspaceId);
        if (!workspace) {
            throw new Error(`Workspace ${workspaceId} not found`);
        }
        const originId = await resolveWorkspaceOriginId(workspace, store);
        const snapshot = await fetchOriginPullRequestChecksHeadless({
            dataDir,
            workspaceId,
            originId,
            prId: String(prNumber),
            store,
        });
        return {
            status: snapshot.prStatus,
            autoMerge: snapshot.autoMerge,
            checks: snapshot.checks,
        };
    };
}

function describeBlockedState(snapshot: ImplementPlanPrMergeSnapshot): string | undefined {
    if (snapshot.status === 'closed') return 'closed without merging';
    if (snapshot.status === 'draft') return 'PR is still a draft';
    if (!snapshot.autoMerge?.enabled || snapshot.autoMerge.state === 'not-enabled') {
        return 'auto-merge is not enabled';
    }
    if (snapshot.autoMerge.state === 'blocked') {
        return snapshot.autoMerge.blockedReason
            ? `auto-merge blocked (${snapshot.autoMerge.blockedReason})`
            : 'auto-merge blocked';
    }
    if (snapshot.checks.some(check => check.status === 'failure')) {
        return 'failing checks';
    }
    return undefined;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
