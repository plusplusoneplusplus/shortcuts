import { onTaskTerminal } from '../messaging/chat-target';
import type { RemoteDelegationFindChild } from './remote-delegation-admission';
import { RemoteDelegationAdmissionStore, type RemoteDelegationAdmission } from './remote-delegation-admission-store';
import { DelegatedJobResults } from './delegated-job-results';
import type { DelegatedJob } from './delegated-job-store';
import { buildDashboardArtifactReference, isDashboardArtifactPath, parseDashboardChatReference } from '../shared/chat-reference';

type RecorderOptions = ConstructorParameters<typeof DelegatedJobResults>[0];

/** Destination capture only. Origin review/delivery never runs through this projection. */
export class RemoteDelegationResults {
    private readonly recorder: DelegatedJobResults;
    private readonly unsubscribe: () => void;
    private readonly sessionListener: () => void;
    private pending: Promise<void> = Promise.resolve();
    private disposed = false;

    constructor(private readonly deps: Omit<RecorderOptions, 'jobs' | 'onResult' | 'wholeSessionOnly'> & {
        admissions: RemoteDelegationAdmissionStore;
        findChild: RemoteDelegationFindChild;
    }) {
        this.recorder = new DelegatedJobResults({ ...deps, wholeSessionOnly: true, jobs: {
            serverIdentity: deps.admissions.serverIdentity,
            list: workspaceId => deps.admissions.list(workspaceId).flatMap(row => {
                if (row.admission.state !== 'accepted') return [];
                return [this.project(row)];
            }),
            recordResult: (workspaceId, executionId, result, _delivery, boundary) => {
                if (this.disposed || boundary === 'grill') return false;
                const row = deps.admissions.list(workspaceId).find(candidate => candidate.executionId === executionId);
                if (!row) throw new Error('Remote result has no destination execution claim');
                // Ralph's terminal chat can belong to its execution workspace, not the launch workspace.
                const owner = result.links.map(parseDashboardChatReference).find(reference =>
                    reference?.serverIdentity === deps.admissions.serverIdentity && reference.artifactPath === undefined);
                if (!owner) throw new Error('Remote result has no owning chat reference');
                const links = result.links.flatMap(link => {
                    const reference = parseDashboardChatReference(link);
                    if (reference) return reference.serverIdentity === owner.serverIdentity
                        && reference.workspaceId === owner.workspaceId && reference.processId === owner.processId ? [link] : [];
                    if (!isDashboardArtifactPath(link)) return [];
                    try {
                        return [buildDashboardArtifactReference(owner.serverIdentity, owner.workspaceId, owner.processId, link)];
                    } catch {
                        // Oversized/malformed paths must not escape as origin-local links.
                        return [];
                    }
                });
                return deps.admissions.recordResult(row, { ...result, links });
            },
        } });
        // A result can beat the acceptance write, including when that write failed.
        // Inspect durable admission evidence; never repeat the execution adapter.
        const reconcile = () => { void this.restore().catch(() =>
            console.error('[remote-delegation-results] Could not reconcile destination results.')); };
        this.unsubscribe = onTaskTerminal(deps.queue, reconcile);
        this.sessionListener = reconcile;
        deps.queue.on('ralphSessionComplete', this.sessionListener);
    }

    /** Restore stopped queues before activation; also used after admission/receipt repair. */
    restore(): Promise<void> {
        const next = this.pending.then(async () => {
            for (const workspace of await this.deps.store.getWorkspaces()) {
                if (this.disposed) return;
                try {
                    for (const row of this.deps.admissions.list(workspace.id)) {
                        if (this.disposed) return;
                        if (!['dispatching', 'uncertain'].includes(row.admission.state)) continue;
                        try {
                            const child = await this.deps.findChild(row);
                            if (this.disposed) return;
                            if (child) this.deps.admissions.accept(row, child);
                        } catch {
                            // Missing/conflicting evidence or storage failure retains uncertainty.
                            console.error('[remote-delegation-results] Could not reconcile destination admission.');
                        }
                    }
                } catch {
                    console.error('[remote-delegation-results] Could not read destination admissions.');
                }
            }
            if (!this.disposed) await this.recorder.restore();
        });
        this.pending = next.catch(() => {});
        return next;
    }

    dispose(): void {
        this.disposed = true;
        this.unsubscribe();
        this.deps.queue.off('ralphSessionComplete', this.sessionListener);
        this.recorder.dispose();
    }

    private project(row: RemoteDelegationAdmission): DelegatedJob {
        if (row.admission.state !== 'accepted') throw new Error('Remote child is not accepted');
        return {
            id: row.executionId, title: 'Remote delegated work', createdAt: row.createdAt,
            // The recorder enumerates the destination ledger, not origin workspaces.
            // This private projection is never registered as a local delegated job.
            parent: { workspaceId: row.destination.workspaceId, processId: row.parent.processId },
            child: { workspaceId: row.destination.workspaceId, ...row.admission.child,
                ...(row.kind !== 'ralph' ? { requestId: row.executionId } : {}) },
            ...(row.terminal ? { terminal: { result: row.terminal.result, delivery: { state: 'pending' } } } : {}),
        };
    }
}
