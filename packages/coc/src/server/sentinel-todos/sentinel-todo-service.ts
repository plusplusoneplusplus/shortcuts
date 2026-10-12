import { isQueueProcessId, toTaskId, type ProcessStore, type TaskQueueManager } from '@plusplusoneplusplus/forge';
import { grillingResultJob, type DelegatedJob, type DelegatedJobStore } from '../delegation/delegated-job-store';
import { buildChatOpenLink } from '../servers/workspace-directory';
import { normalizeChatMode } from '../tasks/task-types';
import type { SentinelTodoDependencyEvaluation, SentinelTodoDependencyAction, SentinelTodoDependencyReadiness, SentinelTodoTrackedAdmission } from '@plusplusoneplusplus/coc-client';
import type { CreateTaskInput } from '@plusplusoneplusplus/forge';
import { parsePullRequestUrl, type PrStatusFetcher, type PrStatusSnapshot } from '../triggers/pr-status-fetcher';
import {
    parseEvidenceInput,
    evidenceAttribution, artifactKey, artifactVersion,
} from './sentinel-todo-evidence';
import {
    SentinelTodoError,
    prBindingInputSchema,
    artifactAcceptanceInputSchema,
    type SentinelTodoActor,
    type SentinelTodoCreate,
    type SentinelTodoDependency,
    type SentinelTodoItem,
    type SentinelTodoJobLink,
    type SentinelTodoJobLinkInput,
    type SentinelTodoLedger,
    type SentinelTodoOwner,
    type SentinelTodoPatch,
    type SentinelTodoStore,
} from './sentinel-todo-store';

export interface SentinelTodoChange {
    owner: SentinelTodoOwner;
    ledgerRevision: number;
    item: SentinelTodoItem;
}

/**
 * A linked job's execution state, derived on read and kept apart from the
 * item's fulfillment status. Remote jobs are `unavailable`: their results
 * never return here, so only an explicit reviewed outcome settles them.
 */
export type SentinelTodoJobExecution =
    | { state: 'queued' | 'running' | 'unknown' | 'unavailable' }
    | {
        state: 'completed' | 'failed' | 'cancelled' | 'capped';
        reason?: string;
        /** Delivery of the result review to this chat (not a fulfillment verdict). */
        review?: {
            state: 'pending' | 'queued' | 'delivered' | 'failed';
            assessment: 'pending' | 'reviewed' | 'superseded' | 'not_required';
            terminalEventId: string;
            reason?: string;
        };
    };
export type SentinelTodoJobMode = 'ask' | 'autopilot' | 'ralph';
export type SentinelTodoJobLinkView = SentinelTodoJobLink & { execution: SentinelTodoJobExecution; mode?: SentinelTodoJobMode };
export type SentinelTodoItemView = Omit<SentinelTodoItem, 'jobs'> & {
    jobs: SentinelTodoJobLinkView[];
    dependencyAction?: SentinelTodoDependencyAction;
    dependencyReadiness?: SentinelTodoDependencyReadiness;
};
export type SentinelTodoLedgerView = { revision: number; items: SentinelTodoItemView[] };

/**
 * The one command surface for Sentinel to-do bookkeeping, shared by REST and
 * the AI tools. Every call proves the owner is a Sentinel chat of the given
 * parent workspace before touching the ledger, and change events fire only
 * after the write committed. Nothing here starts, retries, or cancels a job.
 */
export class SentinelTodoService {
    /** Bound once by route composition; tools receive reads/admission, never approval actor selection. */
    dependencyActions?: {
        project(owner: SentinelTodoOwner, item: SentinelTodoItem): Pick<SentinelTodoItemView, 'dependencyAction' | 'dependencyReadiness'>;
        authorize(owner: SentinelTodoOwner, itemId: string, input: unknown, actor: 'user'): Promise<{ item: SentinelTodoItemView; ledgerRevision: number }>;
        revoke(owner: SentinelTodoOwner, itemId: string, input: unknown, actor: 'user'): Promise<{ item: SentinelTodoItemView; ledgerRevision: number }>;
        guard(input: CreateTaskInput, phase: 'enqueue' | 'check' | 'start'): Promise<void>;
        refresh(owner: SentinelTodoOwner): void;
        evaluated(owner: SentinelTodoOwner, evaluation: SentinelTodoDependencyEvaluation): string[];
        notify(owner: SentinelTodoOwner, itemIds: readonly string[]): void;
        context(owner: SentinelTodoOwner, itemId: string, requested?: unknown): Promise<SentinelTodoTrackedAdmission>;
    };
    constructor(private readonly deps: {
        todos: SentinelTodoStore;
        store: Pick<ProcessStore, 'getProcess'>;
        /** A Sentinel's first turn can still be queued, before its process exists. */
        getTask?: TaskQueueManager['getTask'];
        /** Delegation receipts, read only to show linked jobs' execution status. */
        jobs?: Pick<DelegatedJobStore, 'list'>;
        onChange?: (change: SentinelTodoChange) => void;
        getDependenciesEnabled?: () => boolean;
        fetchPr?: PrStatusFetcher;
        resolveWorkspaceRoot?: (workspaceId: string) => Promise<string | undefined>;
    }) {}

    dependenciesEnabled(): boolean {
        return this.deps.getDependenciesEnabled?.() === true;
    }

    async bindPrOutput(owner: SentinelTodoOwner, itemId: string, input: unknown, actor: 'user' | 'sentinel') {
        await this.assertDependenciesOwner(owner);
        const body = parseEvidenceInput(prBindingInputSchema, input);
        const snapshot = this.deps.todos.get(owner);
        const item = this.requireEvidenceItem(snapshot, itemId, body.expectedRevision);
        const pr = parsePullRequestUrl(body.prUrl);
        if (!pr) throw new SentinelTodoError('invalid', 'A supported canonical GitHub or Azure DevOps PR URL is required');
        if (body.provenance.kind === 'tracked_job') {
            const provenance = body.provenance;
            const link = item.jobs.find(job => job.processId === provenance.processId && job.workspaceId === provenance.workspaceId
                && !job.serverId && job.kind !== 'remote');
            const job = this.deps.jobs?.list(owner.workspaceId).find(job => job.id === provenance.processId
                && job.parent.workspaceId === owner.workspaceId && job.parent.processId === owner.processId
                && job.child.processId === provenance.processId && job.child.workspaceId === provenance.workspaceId
                && !job.child.serverId && job.child.sessionId === link?.sessionId);
            if (!link || !job) {
                throw new SentinelTodoError('invalid', 'PR output provenance must name a tracked local job of this prerequisite');
            }
            const outputs = [...job.terminal?.result.links ?? [], ...job.grilling?.result.links ?? []];
            if (!outputs.some(url => {
                const produced = parsePullRequestUrl(url);
                return produced?.provider === pr.provider && produced.host === pr.host
                    && produced.repoPath.toLowerCase() === pr.repoPath.toLowerCase() && produced.number === pr.number;
            })) {
                throw new SentinelTodoError('invalid', 'Selected PR is not in the tracked job outputs; use explicit owner_selection with provenance');
            }
        }
        // Explicit selection records the owner's assertion of output provenance, not proof of merge.
        const result = this.deps.todos.recordEvidence(owner, itemId, body.expectedRevision, `pr:${body.outputSlot}`, {
            kind: 'pr_binding', outputSlot: body.outputSlot, pr, provenance: body.provenance,
            ...evidenceAttribution(actor, body.expectedRevision + 1),
        }, actor, () => {});
        this.emit({ owner, ...result });
        return result;
    }

    async acceptArtifact(owner: SentinelTodoOwner, itemId: string, input: unknown, actor: 'user' | 'sentinel') {
        await this.assertDependenciesOwner(owner);
        const body = parseEvidenceInput(artifactAcceptanceInputSchema, input);
        const snapshot = this.deps.todos.get(owner);
        this.requireEvidenceItem(snapshot, itemId, body.expectedRevision);
        const root = await this.deps.resolveWorkspaceRoot?.(owner.workspaceId);
        if (!root) throw new SentinelTodoError('not_found', 'Owning workspace content is unavailable');
        await this.assertDependenciesOwner(owner);
        const result = this.deps.todos.withCurrentEvidence(owner, snapshot, () =>
            this.deps.todos.recordEvidence(owner, itemId, body.expectedRevision, `artifact:${artifactKey(body.phase, body.reference)}`, {
                kind: 'artifact_acceptance', phase: body.phase, reference: body.reference, version: body.version,
                workspaceId: owner.workspaceId, ...evidenceAttribution(actor, body.expectedRevision + 1),
            }, actor, () => {
                if (artifactVersion(root, body.reference) !== body.version) {
                    throw new SentinelTodoError('conflict', 'Artifact content does not match the selected version');
                }
            }));
        this.emit({ owner, ...result });
        return result;
    }

    /** Fresh conjunctive evidence only. Never changes fulfillment, grants authority or dispatches work. */
    async evaluateDependencies(owner: SentinelTodoOwner, itemId: string,
        commit?: (evaluation: SentinelTodoDependencyEvaluation, ledger: SentinelTodoLedger) => void): Promise<SentinelTodoDependencyEvaluation> {
        await this.assertDependenciesOwner(owner);
        const snapshot = this.deps.todos.get(owner);
        const item = this.requireEvidenceItem(snapshot, itemId);
        const reads = new Map<string, PrStatusSnapshot | Error>();
        for (const edge of item.dependsOn) {
            if (edge.condition.kind !== 'pr_merge') continue;
            const slot = edge.condition.outputSlot;
            const source = snapshot.items.find(source => source.id === edge.itemId);
            const binding = source?.evidence.find(receipt => receipt.kind === 'pr_binding' && receipt.outputSlot === slot);
            if (!source || source.archived || binding?.kind !== 'pr_binding') continue;
            try {
                if (!this.deps.fetchPr) throw new Error('Authoritative PR reader unavailable');
                const value = await this.deps.fetchPr(binding.pr);
                const identity = parsePullRequestUrl(value.url);
                if (!identity || identity.provider !== binding.pr.provider || identity.host !== binding.pr.host
                    || identity.repoPath.toLowerCase() !== binding.pr.repoPath.toLowerCase() || identity.number !== binding.pr.number) {
                    throw new Error('Provider returned evidence for a different PR');
                }
                reads.set(binding.receiptId, value);
            } catch (error) { reads.set(binding.receiptId, error instanceof Error ? error : new Error(String(error))); }
        }
        const root = await this.deps.resolveWorkspaceRoot?.(owner.workspaceId);
        await this.assertDependenciesOwner(owner);
        let invalidated: string[] = [];
        const committed = this.deps.todos.recordEvaluation(owner, snapshot, ledger => {
            const edges: SentinelTodoDependencyEvaluation['edges'] = item.dependsOn.map(dependency => {
                const source = ledger.items.find(source => source.id === dependency.itemId);
                const result: SentinelTodoDependencyEvaluation['edges'][number] = {
                    dependency, sourceRevision: source?.revision, satisfied: false,
                };
                if (!source || source.archived) return { ...result, blocker: 'Prerequisite is missing or archived' };
                const condition = dependency.condition;
                if (condition.kind === 'done') {
                    return source.status === 'done' ? { ...result, satisfied: true }
                        : { ...result, blocker: 'Prerequisite needs an explicit current Done verdict' };
                }
                if (condition.kind === 'pr_merge') {
                    const binding = source.evidence.find(receipt => receipt.kind === 'pr_binding' && receipt.outputSlot === condition.outputSlot);
                    if (binding?.kind !== 'pr_binding') return { ...result, blocker: 'Future PR output needs an explicit binding' };
                    const observed = reads.get(binding.receiptId);
                    const linked = { ...result, evidenceLink: binding.pr.url, receiptId: binding.receiptId,
                        evidenceRevision: binding.recordedRevision, pr: binding.pr };
                    if (!observed || observed instanceof Error) {
                        return { ...linked, blocker: observed instanceof Error ? `PR evidence unavailable: ${observed.message.slice(0, 1_000)}` : 'PR evidence unavailable' };
                    }
                    return observed.status === 'merged'
                        ? { ...linked, satisfied: true, mergedAt: observed.mergedAt, mergeCommit: observed.mergeCommit }
                        : { ...linked, blocker: `PR is ${observed.status}; authoritative merge required` };
                }
                const receipt = source.evidence.find(receipt => receipt.kind === 'artifact_acceptance'
                    && receipt.phase === condition.phase && receipt.reference === condition.reference && receipt.version === condition.version);
                if (receipt?.kind !== 'artifact_acceptance' || receipt.workspaceId !== owner.workspaceId) {
                    return { ...result, blocker: 'Selected phase and artifact version need explicit acceptance' };
                }
                const linked = { ...result, receiptId: receipt.receiptId, evidenceRevision: receipt.recordedRevision, evidenceLink: receipt.reference };
                if (!root) return { ...linked, blocker: 'Owning workspace content is unavailable' };
                try {
                    return artifactVersion(root, condition.reference) === condition.version
                        ? { ...linked, satisfied: true } : { ...linked, blocker: 'Artifact content changed; fresh acceptance required' };
                } catch (error) {
                    return { ...linked, blocker: `Artifact evidence unavailable: ${error instanceof Error ? error.message : String(error)}` };
                }
            });
            const evaluation: SentinelTodoDependencyEvaluation = {
                itemId, itemRevision: item.revision, ledgerRevision: ledger.revision, evaluatedAt: new Date().toISOString(),
                state: !item.archived && edges.every(edge => edge.satisfied) ? 'ready' : 'waiting', edges,
                ...(item.archived ? { blocker: 'Dependent item is archived' } : {}),
            };
            invalidated = this.dependencyActions?.evaluated(owner, evaluation) ?? [];
            commit?.(evaluation, ledger);
            return evaluation;
        });
        this.dependencyActions?.notify(owner, invalidated);
        return committed;
    }

    private requireEvidenceItem(ledger: SentinelTodoLedger, itemId: string, revision?: number): SentinelTodoItem {
        const item = ledger.items.find(item => item.id === itemId);
        if (!item) throw new SentinelTodoError('not_found', 'To-do item not found');
        if (revision !== undefined && item.revision !== revision) throw new SentinelTodoError('conflict', 'The item changed since it was loaded', item);
        return item;
    }

    private async assertDependenciesOwner(owner: SentinelTodoOwner): Promise<void> {
        await this.assertOwner(owner);
        if (!this.dependenciesEnabled()) throw new SentinelTodoError('not_found', 'Sentinel dependencies are disabled');
    }

    async setDependencies(
        owner: SentinelTodoOwner, itemId: string, expectedRevision: number,
        dependencies: SentinelTodoDependency[], actor: SentinelTodoActor,
    ): Promise<{ item: SentinelTodoItem; ledgerRevision: number }> {
        await this.assertOwner(owner);
        if (!this.dependenciesEnabled()) {
            throw new SentinelTodoError('not_found', 'Sentinel dependencies are disabled');
        }
        const result = this.deps.todos.setDependencies(owner, itemId, expectedRevision, dependencies, actor);
        this.emit({ owner, ...result });
        return result;
    }

    async list(owner: SentinelTodoOwner): Promise<SentinelTodoLedgerView> {
        await this.assertOwner(owner);
        this.dependencyActions?.refresh(owner);
        const ledger: SentinelTodoLedger = this.deps.todos.get(owner);
        let delegated: DelegatedJob[] = [];
        if (ledger.items.some(item => item.jobs.some(job => !job.serverId && job.kind !== 'remote'))) {
            try { delegated = this.deps.jobs?.list(owner.workspaceId) ?? []; }
            catch { /* Execution status degrades to the recorded link result. */ }
        }
        const modes = this.deps.todos.getJobModeProjections(owner);
        return {
            revision: ledger.revision,
            items: ledger.items.map(item => ({
                ...item,
                ...this.dependencyActions?.project(owner, item),
                jobs: item.jobs.map(link => ({ ...link,
                    mode: this.jobMode(link, modes),
                    execution: this.execution(link, owner, delegated, item.userVerdictRevision),
                })),
            })),
        };
    }

    /** Links an admitted job to the invoking Sentinel's item; never launches anything. */
    async linkJob(
        owner: SentinelTodoOwner,
        itemId: string,
        link: SentinelTodoJobLinkInput,
    ): Promise<{ item: SentinelTodoItem; ledgerRevision: number }> {
        await this.assertOwner(owner);
        const result = this.deps.todos.linkJob(owner, itemId, link);
        if (result.changed) this.emit({ owner, item: result.item, ledgerRevision: result.ledgerRevision });
        const delegated = this.deps.jobs?.list(owner.workspaceId).find(job => job.id === link.processId);
        const milestone = delegated && grillingResultJob(delegated);
        if (milestone) this.recordJobResult(milestone);
        if (delegated?.terminal) this.recordJobResult(delegated);
        const current = this.deps.todos.get(owner);
        return { item: current.items.find(item => item.id === itemId)!, ledgerRevision: current.revision };
    }

    /**
     * Attaches an existing local conversation as a reference-only link. The
     * conversation must exist in the named workspace on this server; the link
     * and title are server-derived. Nothing is sent to that conversation, and
     * the item's status and job bookkeeping stay untouched.
     */
    async attachReference(
        owner: SentinelTodoOwner,
        itemId: string,
        expectedRevision: number,
        conversation: { processId: string; workspaceId: string },
        actor: SentinelTodoActor,
    ): Promise<{ item: SentinelTodoItem; ledgerRevision: number; attached: boolean }> {
        await this.assertOwner(owner);
        const { processId, workspaceId } = conversation ?? {};
        if (typeof processId !== 'string' || !processId || typeof workspaceId !== 'string' || !workspaceId) {
            throw new SentinelTodoError('invalid', 'A reference needs the conversation processId and workspaceId');
        }
        if (processId === owner.processId) {
            throw new SentinelTodoError('invalid', 'A Sentinel chat cannot reference itself');
        }
        const process = await this.deps.store.getProcess(processId);
        if (!process || process.id !== processId || process.metadata?.workspaceId !== workspaceId) {
            throw new SentinelTodoError('not_found', 'Conversation not found in that workspace');
        }
        const title = (process.customTitle || process.title || process.promptPreview || '').trim().slice(0, 200);
        const result = this.deps.todos.attachReference(owner, itemId, expectedRevision, {
            processId, workspaceId, openLink: buildChatOpenLink(workspaceId, processId), ...(title ? { title } : {}),
        }, actor);
        if (result.changed) this.emit({ owner, item: result.item, ledgerRevision: result.ledgerRevision });
        return { item: result.item, ledgerRevision: result.ledgerRevision, attached: result.changed };
    }

    /**
     * Records a server-observed terminal result of a registered delegation on
     * the item that links it. The owner comes from the server-authored
     * delegation receipt, never from child output.
     */
    recordJobResult(job: DelegatedJob): SentinelTodoItem | undefined {
        const terminal = job.terminal?.result;
        if (!terminal || job.child.serverId || !this.findLinkedItem(job)) return undefined;
        const owner = { workspaceId: job.parent.workspaceId, processId: job.parent.processId };
        if (job.boundary === 'grill') {
            if (terminal.reason !== 'spec-ready') return undefined;
            const milestone = this.deps.todos.recordGrillingResult(owner, job.id, terminal.terminalEventId, terminal.links);
            if (milestone) this.emit({ owner, ...milestone });
            return milestone?.item;
        }
        const result = this.deps.todos.recordJobResult(owner, job.id, {
            terminalEventId: terminal.terminalEventId,
            outcome: terminal.outcome,
            ...(terminal.reason ? { reason: terminal.reason.slice(0, 2_000) } : {}),
        }, link => `Job ${JSON.stringify(link.title ?? job.title)} ${terminal.outcome}`
            + (terminal.reason ? `: ${terminal.reason}` : '.'));
        if (result) this.emit({ owner, ...result });
        return result?.item;
    }

    /** The item linking a local delegated job, for its parent review prompt. */
    findLinkedItem(job: DelegatedJob): SentinelTodoItem | undefined {
        return this.deps.todos.get(job.parent).items
            .find(item => item.type === 'normal' && item.jobs.some(link => link.processId === job.id
                && link.processId === job.child.processId && link.workspaceId === job.child.workspaceId
                && link.sessionId === job.child.sessionId && link.kind !== 'remote' && !link.serverId && !job.child.serverId));
    }

    /** Invalidate derived delivery state only after the delegation receipt commits. */
    notifyReviewDelivery(job: DelegatedJob): void {
        const item = this.findLinkedItem(job);
        if (!item) return;
        const owner = job.parent;
        this.emit({ owner, item, ledgerRevision: this.deps.todos.get(owner).revision });
    }

    /** Mode is derived presentation; notifications never advance ledger/item revisions. */
    notifyJobModeChanged(processId: string, workspaceId: string): void {
        for (const owner of this.deps.todos.getJobOwners(processId, workspaceId)) {
            const ledger = this.deps.todos.get(owner);
            const item = ledger.items.find(item => item.jobs.some(link => link.processId === processId
                && link.workspaceId === workspaceId && link.kind === 'local' && !link.serverId && !link.sessionId));
            if (item) this.emit({ owner, item, ledgerRevision: ledger.revision });
        }
    }

    private jobMode(link: SentinelTodoJobLink,
        modes: ReturnType<SentinelTodoStore['getJobModeProjections']>): SentinelTodoJobMode | undefined {
        // Session identity describes the whole Ralph run, including its Ask/grilling turns.
        if (link.kind === 'ralph' || link.sessionId) return 'ralph';
        // Remote ordinary conversations cannot be verified on this server.
        if (link.serverId || link.kind === 'remote') return undefined;
        const process = modes.get(link.processId);
        const task = !process && isQueueProcessId(link.processId)
            ? this.deps.getTask?.(toTaskId(link.processId)) : undefined;
        const live = task?.type === 'chat' && (task.status === 'queued' || task.status === 'running') ? task : undefined;
        const workspaceId = process ? process.workspaceId : live?.payload.workspaceId ?? live?.repoId;
        if (workspaceId !== link.workspaceId) return undefined;
        const mode = normalizeChatMode(process ? process.mode : live?.payload.mode);
        return mode === 'ask' || mode === 'autopilot' || mode === 'ralph' ? mode : undefined;
    }

    private execution(link: SentinelTodoJobLink, owner: SentinelTodoOwner, delegated: DelegatedJob[],
        userVerdictRevision?: number): SentinelTodoJobExecution {
        if (link.serverId || link.kind === 'remote') return { state: 'unavailable' };
        const terminal = delegated.find(job => job.id === link.processId
            && job.parent.processId === owner.processId && job.parent.workspaceId === owner.workspaceId
            && job.child.workspaceId === link.workspaceId && job.child.processId === link.processId
            && job.child.sessionId === link.sessionId && !job.child.serverId)?.terminal;
        const result = terminal?.result ?? link.result;
        if (result) {
            const delivery = terminal?.delivery ?? { state: 'pending' as const };
            const assessment = result.outcome === 'cancelled' ? 'not_required'
                : link.result?.terminalEventId === result.terminalEventId && link.result.reviewed
                    ? 'reviewed' : (userVerdictRevision ?? 0) > (link.linkedRevision ?? 0) ? 'superseded' : 'pending';
            return {
                state: result.outcome,
                ...(result.reason ? { reason: result.reason } : {}),
                review: { state: delivery.state, assessment, terminalEventId: result.terminalEventId,
                    ...(delivery.state === 'failed' ? { reason: delivery.reason } : {}) },
            };
        }
        // A Ralph session spans many queue tasks; only its whole-session result settles it.
        if (link.kind === 'ralph') return { state: 'running' };
        const task = isQueueProcessId(link.processId) ? this.deps.getTask?.(toTaskId(link.processId)) : undefined;
        const taskWorkspaceId = task?.payload?.workspaceId ?? task?.repoId;
        if (taskWorkspaceId !== undefined && taskWorkspaceId !== link.workspaceId) return { state: 'unknown' };
        if (task?.status === 'queued' || task?.status === 'running') return { state: task.status };
        return { state: 'unknown' };
    }

    async create(
        owner: SentinelTodoOwner,
        input: SentinelTodoCreate,
        opts: { actor: SentinelTodoActor; idempotencyKey?: string },
    ): Promise<{ item: SentinelTodoItem; created: boolean; ledgerRevision: number }> {
        await this.assertOwner(owner);
        const result = this.deps.todos.create(owner, input, opts);
        if (result.created) this.emit({ owner, ledgerRevision: result.ledgerRevision, item: result.item });
        return result;
    }

    async update(
        owner: SentinelTodoOwner,
        itemId: string,
        expectedRevision: number,
        patch: SentinelTodoPatch,
        actor: SentinelTodoActor,
    ): Promise<{ item: SentinelTodoItem; ledgerRevision: number }> {
        await this.assertOwner(owner);
        const result = this.deps.todos.update(owner, itemId, expectedRevision, patch, actor);
        this.emit({ owner, ...result });
        return result;
    }

    private emit(change: SentinelTodoChange): void {
        try {
            this.deps.onChange?.(change);
        } catch {
            // The write already committed; a failed notification must not report failure.
        }
    }

    async assertOwner(owner: SentinelTodoOwner): Promise<void> {
        const process = await this.deps.store.getProcess(owner.processId);
        const task = !process && isQueueProcessId(owner.processId)
            ? this.deps.getTask?.(toTaskId(owner.processId)) : undefined;
        const live = task?.type === 'chat' && (task.status === 'queued' || task.status === 'running') ? task : undefined;
        const mode = process ? process.metadata?.mode : (live?.payload as { mode?: unknown } | undefined)?.mode;
        const workspaceId = process ? process.metadata?.workspaceId : live?.repoId;
        if (normalizeChatMode(mode) !== 'sentinel' || workspaceId !== owner.workspaceId) {
            throw new SentinelTodoError('not_found', 'Sentinel chat not found in this workspace');
        }
    }
}
