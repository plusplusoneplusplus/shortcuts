import { getLogger, LogCategory, type ProcessStore } from '@plusplusoneplusplus/forge';
import type { DelegatedJobStore, DelegatedJob, DelegatedJobPullRequest } from '../delegation/delegated-job-store';
import type { SentinelTodoService } from '../sentinel-todos/sentinel-todo-service';
import { SentinelTodoError, type SentinelTodoOwner } from '../sentinel-todos/sentinel-todo-store';
import type { TriggerStore } from './trigger-store';
import type { TriggerManager, OneShotFirer, TriggerEventEmit, PrOutcomeRegistrationPolling } from './trigger-manager';
import { DEFAULT_PR_MERGE_POLL_INTERVAL_MS, MAX_ACTIVE_TRIGGERS, type Trigger } from './trigger-types';
import type { SentinelPrOutcomeControls } from './sentinel-pr-outcome-controls';
import type { SentinelPrOutcomesResponse, SentinelPrOutcome } from '@plusplusoneplusplus/coc-client';
import { z } from 'zod';

const controlInput = z.object({ expectedRevision: z.number().int().nonnegative() }).strict();

export type RegisterSentinelPrOutcome = (workspaceId: string, processId: string, prUrl: string) =>
    Promise<{ registered: boolean; triggerId?: string; warning?: string }>;

export type PrOutcomeReviewDisposition = 'execute' | 'defer' | 'skip';

export interface SentinelPrOutcomeServiceDeps {
    jobs: DelegatedJobStore;
    processes: Pick<ProcessStore, 'getWorkspaces' | 'getProcess'>;
    owners: Pick<SentinelTodoService, 'list' | 'findLinkedItem'>;
    triggers: TriggerStore;
    manager: Pick<TriggerManager, 'arm' | 'disarm' | 'schedulePendingDelivery' | 'checkOutcome'>;
    firer: OneShotFirer;
    controls: SentinelPrOutcomeControls;
    enabled: () => boolean;
    emit?: TriggerEventEmit;
    recoverPendingMessages?: (workspaceId: string, processId: string) => Promise<void>;
    onRegistrationPending?: () => void;
}

export class SentinelPrOutcomeError extends Error {
    constructor(readonly statusCode: number, message: string) { super(message); }
}

/** Exact successful submissions only: no transcript mining or newest-PR fallback. */
export class SentinelPrOutcomeService {
    private readonly admissions = new Map<string, Promise<void>>();
    private readonly knownWorkspaces = new Set<string>();
    private readonly registrationTicks = new Map<string, string | null>();
    constructor(private readonly deps: SentinelPrOutcomeServiceDeps) {}

    readonly registrationPolling: PrOutcomeRegistrationPolling = {
        entries: () => {
            if (!this.deps.enabled()) return [];
            return this.registrationRequests().filter(({ receipt }) => !receipt.outcomeWatchError?.permanent).map(({ job, receipt }) => {
                const id = registrationId(job, receipt);
                if (!this.registrationTicks.has(id)) {
                    this.registrationTicks.set(id, new Date(Date.now() + DEFAULT_PR_MERGE_POLL_INTERVAL_MS).toISOString());
                }
                return { id, status: 'active', nextTickAt: this.registrationTicks.get(id)!, registrationPoll: true as const };
            });
        },
        persist: entry => { this.registrationTicks.set(entry.id, entry.nextTickAt); },
        tick: async entry => {
            const request = this.registrationRequests().find(({ job, receipt }) => registrationId(job, receipt) === entry.id);
            if (request && this.deps.enabled()) await this.recoverRegistration(request.job, request.receipt);
        },
    };

    /** Pause and queue admission are ordered within an item, including asynchronous owner reads. */
    async withAdmission(owner: SentinelTodoOwner, itemId: string, run: () => Promise<void>): Promise<void> {
        const key = JSON.stringify([owner.workspaceId, owner.processId, itemId]);
        const previous = this.admissions.get(key) ?? Promise.resolve();
        const operation = previous.catch(() => {}).then(run);
        const settled = operation.then(() => {}, () => {});
        this.admissions.set(key, settled);
        try { await operation; }
        finally { if (this.admissions.get(key) === settled) this.admissions.delete(key); }
    }

    async list(owner: SentinelTodoOwner, itemId: string): Promise<SentinelPrOutcomesResponse> {
        await this.assertItem(owner, itemId);
        const registrationErrors = new Map(this.requestedReceipts(owner).map(({ job, receipt }) =>
            [JSON.stringify([job.id, receipt.id]), receipt.outcomeWatchError?.message] as const));
        return {
            ...this.deps.controls.get(owner, itemId),
            outcomes: [...this.rules(owner, itemId).map<SentinelPrOutcome>(trigger => {
                if (trigger.event.monitor !== 'pr-merged') throw new Error('Invalid PR outcome monitor');
                const registrationError = registrationErrors.get(JSON.stringify([
                    trigger.binding!.delegatedPr!.jobId, trigger.binding!.delegatedPr!.receiptId,
                ]));
                return {
                    id: trigger.id, ...trigger.binding!.delegatedPr!, pr: trigger.event.pr,
                    status: trigger.event.terminalObservation?.status
                        ?? (trigger.event.lastSeenStatus === 'draft' ? 'draft' : 'watching'),
                    delivery: registrationError && !trigger.delivery ? 'error' : trigger.outcome === 'skipped' ? 'skipped' : trigger.outcome === 'error'
                        || trigger.delivery?.state === 'failed' ? 'error' : trigger.delivery?.state ?? 'none',
                    ...(trigger.outcomeReason || registrationError || trigger.event.lastError
                        ? { error: trigger.outcomeReason ?? registrationError ?? trigger.event.lastError!.message } : {}),
                    ...(trigger.event.terminalObservation ? { observedAt: trigger.event.terminalObservation.observedAt } : {}),
                };
            }), ...this.missingRegistrations(owner).filter(({ receipt }) => receipt.itemId === itemId).map(({ job, receipt }) => ({
                id: watchId(receipt), jobId: job.id, receiptId: receipt.id, pr: receipt.pr,
                status: 'watching' as const, delivery: 'error' as const,
                error: receipt.outcomeWatchError?.message ?? 'Native PR outcome monitor is unavailable; Check outcome to retry registration.',
            }))],
        };
    }

    async control(owner: SentinelTodoOwner, itemId: string, action: 'pause' | 'resume' | 'check', input: unknown): Promise<SentinelPrOutcomesResponse> {
        await this.assertItem(owner, itemId);
        const parsed = controlInput.safeParse(input);
        if (!parsed.success) throw new SentinelPrOutcomeError(400, 'Invalid expectedRevision or unknown fields');
        await this.withAdmission(owner, itemId, async () => {
            await this.assertItem(owner, itemId);
            this.deps.triggers.transaction(() => {
                if (this.deps.controls.get(owner, itemId).revision !== parsed.data.expectedRevision) {
                    throw new SentinelPrOutcomeError(409, 'PR outcome notification preference changed');
                }
                if (action !== 'check') this.deps.controls.set(owner, itemId, action === 'pause');
            });
            if (action === 'check') {
                for (const request of this.registrationRequests(owner).filter(({ receipt }) => receipt.itemId === itemId)) {
                    await this.recoverRegistration(request.job, request.receipt);
                }
            }
        });
        for (const trigger of this.rules(owner, itemId)) {
            if (action === 'pause' && trigger.delivery?.state === 'pending') this.deps.manager.disarm(trigger.id);
            if (action === 'resume' && trigger.delivery?.state === 'pending') {
                await this.deps.firer.deliverPending?.(trigger.id);
                const current = this.deps.triggers.getById(trigger.id);
                if (current) this.deps.manager.schedulePendingDelivery(current);
            }
            if (action === 'check') await this.deps.manager.checkOutcome(trigger.id);
        }
        if (action === 'resume') await this.deps.recoverPendingMessages?.(owner.workspaceId, owner.processId);
        return this.list(owner, itemId);
    }

    /** Queued admission is not execution: deferred messages retain their original receipt. */
    async reviewExecutionDisposition(owner: SentinelTodoOwner, triggerId: string, deliveryId: string): Promise<PrOutcomeReviewDisposition> {
        const initial = this.deps.triggers.getById(triggerId);
        if (!initial?.binding?.delegatedPr || initial.workspaceId !== owner.workspaceId
            || initial.processId !== owner.processId || initial.delivery?.deliveryId !== deliveryId) return 'skip';
        let disposition: PrOutcomeReviewDisposition = 'skip';
        // Drain callers hold the process lock; never invert admission's item → process lock order.
        await (async () => {
            const current = this.deps.triggers.getById(triggerId);
            if (!current?.binding?.delegatedPr || current.delivery?.deliveryId !== deliveryId
                || current.delivery.state === 'failed' || current.outcome === 'skipped' || current.outcome === 'error') return;
            let reason: string | undefined;
            let skipped = false;
            try {
                const ledger = await this.deps.owners.list(owner);
                const item = ledger.items.find(item => item.id === current.binding!.itemId);
                skipped = !item || item.type !== 'normal' || !!item.archived || item.status === 'done';
                if (skipped) reason = 'Current item is missing, manual, done or archived';
                else if (!this.validate(current)) reason = 'Exact delegated PR owner or job link is unavailable';
            } catch {
                reason = 'Sentinel PR outcome owner is unavailable';
            }
            if (reason) {
                const next: Trigger = {
                    ...current, revision: current.revision + 1, nextTickAt: null,
                    outcome: skipped ? 'skipped' : 'error', outcomeReason: reason,
                    delivery: { ...current.delivery, state: 'failed' },
                };
                this.deps.triggers.update(next);
                this.deps.emit?.({ type: 'trigger-updated', trigger: next });
                return;
            }
            disposition = this.canDeliver(current) ? 'execute' : 'defer';
        })();
        return disposition;
    }

    private rules(owner: SentinelTodoOwner, itemId: string): Trigger[] {
        return this.deps.triggers.getByWorkspace(owner.workspaceId).filter(trigger =>
            trigger.processId === owner.processId && trigger.binding?.itemId === itemId
            && !!trigger.binding.delegatedPr);
    }

    private async assertItem(owner: SentinelTodoOwner, itemId: string): Promise<void> {
        const ledger = await this.deps.owners.list(owner);
        const item = ledger.items.find(item => item.id === itemId);
        if (!item || item.type !== 'normal') throw new SentinelPrOutcomeError(404, 'Normal owner-scoped item not found');
    }

    registerSubmission: RegisterSentinelPrOutcome = async (workspaceId, processId, prUrl) => {
        if (!this.deps.enabled()) return { registered: false };
        const matches = (await this.deps.processes.getWorkspaces()).flatMap(workspace =>
            this.deps.jobs.list(workspace.id).filter(job => job.parent.workspaceId === workspace.id
                && job.child.workspaceId === workspaceId && job.child.processId === processId));
        if (matches.length > 1) throw new Error('Delegated PR parent is ambiguous');
        const job = matches[0];
        if (job) {
            if (job.child.serverId) throw new Error('Remote delegated PR outcome transport is unavailable');
            await this.deps.owners.list(job.parent);
            const item = this.deps.owners.findLinkedItem(job);
            if (!item || item.type !== 'normal') throw new Error('An exact tracked normal to-do job link is required');
            const receipt = this.deps.jobs.recordPullRequest(job.parent.workspaceId, job.id, item.id, prUrl, true);
            return this.registerRequestedWatch(job, receipt);
        }
        // Untracked ordinary submissions are not outcome watches.
        const child = await this.deps.processes.getProcess(processId, workspaceId);
        if (child?.parentProcessId) return {
            registered: false,
            warning: 'No exact local tracked Sentinel job is available. Remote PR outcome transport is unavailable.',
        };
        return { registered: false };
    };

    private async registerRequestedWatch(job: DelegatedJob, receipt: DelegatedJobPullRequest) {
        if (!this.deps.enabled()) return { registered: false };
        this.knownWorkspaces.add(job.parent.workspaceId);
        try {
            if (job.child.serverId || !receipt.outcomeWatchRequestedAt) throw new SentinelTodoError('invalid', 'Exact local requested PR receipt is unavailable');
            const existing = this.deps.triggers.getByWorkspace(job.parent.workspaceId).find(trigger =>
                trigger.processId === job.parent.processId && trigger.binding?.delegatedPr?.receiptId === receipt.id);
            if (existing) {
                if (receipt.outcomeWatchError) {
                    if (existing.status === 'active') this.deps.manager.arm(existing);
                    this.deps.jobs.recordPullRequestOutcomeWatchError(job.parent.workspaceId, job.id, receipt.id);
                }
                return { registered: true, triggerId: existing.id };
            }
            await this.deps.owners.list(job.parent);
            if (!this.deps.enabled()) return { registered: false };
            const item = this.deps.owners.findLinkedItem(job);
            if (!item || item.type !== 'normal' || item.id !== receipt.itemId) {
                throw new SentinelTodoError('invalid', 'Exact tracked normal PR outcome item is unavailable');
            }
            const concurrent = this.deps.triggers.getById(watchId(receipt));
            if (concurrent) {
                if (concurrent.workspaceId !== job.parent.workspaceId || concurrent.processId !== job.parent.processId
                    || concurrent.binding?.delegatedPr?.receiptId !== receipt.id) {
                    throw new SentinelTodoError('invalid', 'Exact PR outcome watch identity conflicts with another owner');
                }
                return { registered: true, triggerId: concurrent.id };
            }
            const at = new Date().toISOString();
            const skipped = item.archived || item.status === 'done';
            if (!skipped && this.deps.triggers.getActive().length >= MAX_ACTIVE_TRIGGERS) {
                throw new Error('Native PR outcome monitor capacity reached; submission evidence retained');
            }
            const trigger: Trigger = {
                id: watchId(receipt), ...job.parent, status: skipped ? 'disarmed' : 'active',
                revision: 1, inFlight: false, createdAt: at, expiresAt: null, lastTickAt: null,
                nextTickAt: skipped ? null : new Date(Date.now() + DEFAULT_PR_MERGE_POLL_INTERVAL_MS).toISOString(),
                event: { type: 'condition-monitor', monitor: 'pr-merged', pr: receipt.pr,
                    pollIntervalMs: DEFAULT_PR_MERGE_POLL_INTERVAL_MS, consecutiveErrors: 0 },
                binding: { kind: 'sentinel-todo', itemId: item.id, armedBy: 'sentinel', armedAt: at,
                    delegatedPr: { jobId: job.id, receiptId: receipt.id } },
                action: { type: 'send-message', mode: 'inherit', processId: job.parent.processId, prompt: '' },
                ...(skipped ? { outcome: 'skipped' as const, outcomeReason: 'Item done or archived' } : {}),
            };

            this.deps.triggers.insert(trigger);
            if (receipt.outcomeWatchError) this.deps.jobs.recordPullRequestOutcomeWatchError(job.parent.workspaceId, job.id, receipt.id);
            this.registrationTicks.delete(registrationId(job, receipt));
            if (!skipped) this.deps.manager.arm(trigger);
            this.deps.emit?.({ type: 'trigger-created', trigger });
            return { registered: true, triggerId: trigger.id };
        } catch (error) {
            try {
                this.deps.jobs.recordPullRequestOutcomeWatchError(job.parent.workspaceId, job.id, receipt.id, {
                    message: error instanceof Error ? error.message : String(error),
                    permanent: error instanceof SentinelTodoError && (error.code === 'not_found' || error.code === 'invalid'),
                });
            } catch (writeError) {
                getLogger().warn(LogCategory.AI, `[SentinelPrOutcome] Registration error persistence failed: ${String(writeError)}`);
            }
            this.deps.onRegistrationPending?.();
            throw error;
        }
    }

    private requestedReceipts(owner?: SentinelTodoOwner) {
        return [...(owner ? [owner.workspaceId] : this.knownWorkspaces)].flatMap(workspaceId =>
            this.deps.jobs.list(workspaceId).filter(job => job.parent.workspaceId === workspaceId
                && (!owner || job.parent.processId === owner.processId)).flatMap(job =>
                (job.pullRequests ?? []).filter(receipt => receipt.outcomeWatchRequestedAt).map(receipt => ({ job, receipt }))));
    }

    private missingRegistrations(owner?: SentinelTodoOwner) {
        return this.requestedReceipts(owner).filter(({ job, receipt }) =>
            !this.deps.triggers.getByWorkspace(job.parent.workspaceId).some(trigger =>
                trigger.processId === job.parent.processId && trigger.binding?.delegatedPr?.receiptId === receipt.id));
    }

    private registrationRequests(owner?: SentinelTodoOwner) {
        const missing = new Set(this.missingRegistrations(owner).map(({ job, receipt }) => registrationId(job, receipt)));
        return this.requestedReceipts(owner).filter(({ job, receipt }) =>
            !!receipt.outcomeWatchError || missing.has(registrationId(job, receipt)));
    }

    private async recoverRegistration(job: DelegatedJob, receipt: DelegatedJobPullRequest): Promise<void> {
        try { await this.registerRequestedWatch(job, receipt); }
        catch (error) { getLogger().warn(LogCategory.AI, `[SentinelPrOutcome] Native watch recovery failed: ${String(error)}`); }
    }

    /** Reconcile only durably requested exact watches, never historical unselected PRs. */
    async restore(): Promise<void> {
        if (!this.deps.enabled()) return;
        for (const workspace of await this.deps.processes.getWorkspaces()) {
            this.knownWorkspaces.add(workspace.id);
        }
        for (const { job, receipt } of this.registrationRequests()) {
            if (!receipt.outcomeWatchError?.permanent) await this.recoverRegistration(job, receipt);
        }
        this.deps.onRegistrationPending?.();
        const owners = new Map<string, SentinelTodoOwner>();
        for (const trigger of this.deps.triggers.getAll()) {
            if (!trigger.binding?.delegatedPr || trigger.delivery?.state !== 'delivered'
                || !this.canDeliver(trigger)) continue;
            const owner = { workspaceId: trigger.workspaceId, processId: trigger.processId };
            owners.set(JSON.stringify(owner), owner);
        }

        for (const owner of owners.values()) {
            await this.deps.recoverPendingMessages?.(owner.workspaceId, owner.processId);
        }
    }

    /** Called again at admission, not just at registration. */
    validate(trigger: Trigger): boolean {
        const binding = trigger.binding?.delegatedPr;
        if (!binding || trigger.event.monitor !== 'pr-merged') return false;
        const job = this.deps.jobs.list(trigger.workspaceId).find(job => job.id === binding.jobId);
        if (!job || job.child.serverId || job.parent.processId !== trigger.processId) return false;
        const item = this.deps.owners.findLinkedItem(job);
        const receipt = job.pullRequests?.find(receipt => receipt.id === binding.receiptId);
        return !!item && item.id === trigger.binding?.itemId && receipt?.itemId === item.id
            && JSON.stringify(receipt.pr) === JSON.stringify(trigger.event.pr);
    }

    canDeliver(trigger: Trigger): boolean {
        return this.deps.enabled() && !!trigger.binding
            && !this.deps.controls.get(trigger, trigger.binding.itemId).paused;
    }
}

function watchId(receipt: DelegatedJobPullRequest): string { return `trigger_${receipt.id}`; }
function registrationId(job: DelegatedJob, receipt: DelegatedJobPullRequest): string {
    return `sentinel-pr-registration:${JSON.stringify([job.parent.workspaceId, job.id, receipt.id])}`;
}
