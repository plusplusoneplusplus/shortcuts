import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { toQueueProcessId, type CreateTaskInput } from '@plusplusoneplusplus/forge';
import type { SentinelTodoTrackedAdmission } from '@plusplusoneplusplus/coc-client';
import { processOperationAdmission } from '../processes/process-operation-admission';
import type { ProcessMessageDeliveryService } from '../processes/process-message-delivery-service';
import type { ChatProvider } from '../tasks/task-types';
import type { RalphLaunchInput } from '../ralph/ralph-launch-service';
import { SentinelTodoError, type SentinelTodoItem, type SentinelTodoLedger, type SentinelTodoOwner } from './sentinel-todo-store';
import type { SentinelTodoItemView, SentinelTodoService } from './sentinel-todo-service';
import { SentinelDependencyStore, dependencyWakePrompt, type DependencyAdmissionRecord, type DependencyWake } from './sentinel-dependency-store';

const text = z.string().trim().min(1);
const tracking = z.object({
    owner: z.object({ workspaceId: text.max(200), processId: text.max(200) }).strict(),
    itemId: text.max(200),
}).strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new SentinelTodoError('invalid', result.error.issues.map(issue => issue.message).join('; '));
    return result.data;
}

function evidenceKey(evaluation: DependencyWake['evidence']): string {
    return JSON.stringify(evaluation.edges);
}

function inputEvidenceKey(evaluation: DependencyWake['evidence']): string {
    return JSON.stringify([evaluation.state, evaluation.edges]);
}

function generation(item: Pick<SentinelTodoItem, 'dependsOn'>, graphRevision = 0): string {
    return createHash('sha256').update(JSON.stringify([item.dependsOn, graphRevision])).digest('hex');
}

/** Wakes transport evidence only; dispatch uses ordinary Sentinel user authorization. */
export class SentinelDependencyActions {
    constructor(private readonly deps: {
        receipts: SentinelDependencyStore;
        service: SentinelTodoService;
        delivery: Pick<ProcessMessageDeliveryService, 'deliverOnce'>;
        validateProvider: (provider: ChatProvider) => Promise<void>;
        validateTarget: (workspaceId: string) => Promise<void>;
        validateOwner?: (owner: SentinelTodoOwner) => void;
        /** Live synchronous capability recheck inside the native writer transaction. */
        validateCurrent: (provider: ChatProvider | undefined, workspaceId: string, mode: 'ask' | 'autopilot' | 'ralph', owner: SentinelTodoOwner) => string | void;
        hasTask?: (taskId: string) => boolean;
        coexistingTransport?: (owner: SentinelTodoOwner, itemId: string, evaluation: DependencyWake['evidence'],
            triggerId?: string) => { triggerId: string; state: 'waiting' | 'delivered' } | undefined;
        onChange?: (owner: SentinelTodoOwner, itemId: string) => void;
    }) {
        deps.receipts.todos.onDependencyMutation = owner => this.invalidate(owner);
    }

    private async owner(owner: SentinelTodoOwner): Promise<void> {
        if (!this.deps.service.dependenciesEnabled()) throw new SentinelTodoError('not_found', 'Sentinel dependencies are disabled');
        try {
            await this.deps.service.assertOwner(owner);
            this.deps.validateOwner?.(owner);
        }
        catch (error) {
            this.deps.receipts.transaction(owner, () => this.invalidate(owner, undefined, 'Sentinel owner is unavailable'));
            throw error;
        }
    }

    refresh(owner: SentinelTodoOwner): void {
        const changed = this.deps.receipts.transaction(owner, () => this.invalidate(owner));
        this.notify(owner, changed);
    }

    evaluated(owner: SentinelTodoOwner, evaluation: DependencyWake['evidence']): string[] {
        return this.invalidate(owner, evaluation);
    }

    notify(owner: SentinelTodoOwner, itemIds: readonly string[]): void {
        for (const itemId of itemIds) this.changed(owner, itemId);
    }

    private staleReason(owner: SentinelTodoOwner, ledger: SentinelTodoLedger, itemId: string,
        dependencies: string, graphRevision: number | undefined, boundRevision: number,
        edges?: DependencyWake['evidence']['edges'], evaluation?: DependencyWake['evidence'],
        lineage?: DependencyAdmissionRecord['lineage']): string | undefined {
        const item = ledger.items.find(item => item.id === itemId);
        if (!item || item.archived) return 'Dependent item is missing or archived';
        const currentGraphRevision = this.deps.receipts.todos.dependencyRevision(owner, itemId);
        if (JSON.stringify(item.dependsOn) !== dependencies
            || (graphRevision !== undefined ? currentGraphRevision !== graphRevision : currentGraphRevision > boundRevision)) {
            return 'Dependency revision changed: prerequisite graph was edited';
        }
        for (const edge of item.dependsOn) {
            const source = ledger.items.find(item => item.id === edge.itemId);
            if (!source || source.archived) return 'Prerequisite is missing or archived';
        }
        if (edges?.some(edge => ledger.items.find(item => item.id === edge.dependency.itemId)?.revision !== edge.sourceRevision)) {
            return 'Required prerequisite evidence generation changed; committed readiness is stale';
        }
        if (lineage?.some(source => {
            if (ledger.items.find(item => item.id === source.itemId)?.revision !== source.revision) return true;
            const current = this.deps.receipts.evaluation(owner, source.itemId);
            return source.evidence !== undefined && (!current || inputEvidenceKey(current) !== source.evidence);
        })) {
            return 'Upstream prerequisite evidence generation changed; committed readiness is stale';
        }
        if (edges && evaluation?.itemId === itemId
            && (evaluation.state !== 'ready' || JSON.stringify(edges) !== evidenceKey(evaluation))) {
            return evaluation.blocker ?? evaluation.edges.find(edge => !edge.satisfied)?.blocker
                ?? 'Required prerequisite evidence changed';
        }
    }

    /** Called under the shared writer; warnings and invalidation never mutate item verdicts. */
    private invalidate(owner: SentinelTodoOwner, evaluation?: DependencyWake['evidence'], unavailable?: string): string[] {
        const ledger = this.deps.receipts.todos.get(owner);
        const wakes = this.deps.receipts.wakes(owner);
        const changed = new Set<string>();
        for (const wake of wakes) {
            const reason = unavailable ?? this.staleReason(owner, ledger, wake.itemId,
                JSON.stringify(wake.evidence.edges.map(edge => edge.dependency)), wake.graphRevision,
                wake.evidence.itemRevision, wake.evidence.edges, evaluation, wake.lineage);
            if (reason && !wake.invalidatedAt) {
                this.deps.receipts.invalidateWake(owner, wake, reason);
                changed.add(wake.itemId);
            }
        }
        for (const { itemId, record } of this.deps.receipts.records(owner)) {
            const reason = unavailable ?? this.staleReason(owner, ledger, itemId, record.dependencies,
                record.graphRevision, record.itemRevision,
                record.evidence ? JSON.parse(record.evidence) : undefined, evaluation, record.lineage)
                ?? (!record.started && ledger.items.find(item => item.id === itemId)?.status === 'done'
                    ? 'Dependent has an explicit current Done verdict' : undefined);
            if (!reason || (record.started ? record.requiresReview : record.error)) continue;
            this.deps.receipts.saveAdmission(owner, itemId, { ...record, error: record.error ?? reason,
                ...(record.started ? { requiresReview: true } : {}) });
            changed.add(itemId);
        }
        for (const item of ledger.items) {
            const prior = this.deps.receipts.evaluation(owner, item.id);
            if (prior?.state !== 'ready') continue;
            const wake = changed.has(item.id) ? wakes.find(wake => wake.itemId === item.id
                && evidenceKey(wake.evidence) === evidenceKey(prior)) : undefined;
            const reason = unavailable ?? this.staleReason(owner, ledger, item.id,
                JSON.stringify(prior.edges.map(edge => edge.dependency)), undefined, prior.itemRevision,
                prior.edges, evaluation, wake?.lineage);
            if (reason) {
                this.deps.receipts.invalidateEvaluation(owner, prior, reason);
                changed.add(item.id);
            }
        }
        return [...changed];
    }

    private lineage(owner: SentinelTodoOwner, ledger: SentinelTodoLedger, item: SentinelTodoItem): NonNullable<DependencyAdmissionRecord['lineage']> {
        const sources = new Map(ledger.items.map(source => [source.id, source]));
        const visited = new Set<string>();
        const pending = item.dependsOn.map(edge => edge.itemId);
        const result: NonNullable<DependencyAdmissionRecord['lineage']> = [];
        while (pending.length) {
            const itemId = pending.pop()!;
            if (visited.has(itemId)) continue;
            visited.add(itemId);
            const source = sources.get(itemId);
            const evidence = source?.dependsOn.length ? this.deps.receipts.evaluation(owner, itemId) : undefined;
            result.push({ itemId, revision: source?.revision, ...(evidence ? { evidence: inputEvidenceKey(evidence) } : {}) });
            pending.push(...source?.dependsOn.map(edge => edge.itemId) ?? []);
        }
        return result;
    }

    private item(owner: SentinelTodoOwner, itemId: string) {
        const item = this.deps.receipts.todos.get(owner).items.find(item => item.id === itemId);
        if (!item) throw new SentinelTodoError('not_found', 'To-do item not found in the parent ledger');
        return item;
    }

    /** Projects items of one ledger snapshot; owner admission rows are read once, not per item. */
    project(owner: SentinelTodoOwner, ledger: SentinelTodoLedger) {
        const admissions = this.deps.receipts.records(owner);
        const sources = new Map(ledger.items.map(source => [source.id, source]));
        return (item: SentinelTodoItem): Pick<SentinelTodoItemView, 'dependencyReadiness'> => {
            const records = admissions.filter(candidate => candidate.itemId === item.id);
            if (!item.dependsOn.length && !records.length) return {};
            const evaluation = this.deps.receipts.evaluation(owner, item.id);
            const graphRevision = this.deps.receipts.todos.dependencyRevision(owner, item.id);
            const wake = this.deps.receipts.currentWake(owner, item.id, generation(item, graphRevision), graphRevision, item.dependsOn);
            const current = evaluation?.itemRevision === item.revision && evaluation.edges.every(edge =>
                sources.get(edge.dependency.itemId)?.revision === edge.sourceRevision);
            return { dependencyReadiness: {
                state: current && evaluation?.state === 'ready' ? 'ready' : 'waiting',
                evaluation, requiresReview: records.some(candidate => candidate.record.requiresReview),
                error: records.find(candidate => candidate.record.error)?.record.error ?? wake?.invalidatedReason ?? wake?.error,
                ...(wake ? { activationId: wake.id, delivery: wake.delivery, transportTriggerId: wake.transportTriggerId } : {}),
            } };
        };
    }

    async context(owner: SentinelTodoOwner, itemId: string): Promise<SentinelTodoTrackedAdmission> {
        await this.owner(owner);
        this.eligible(this.item(owner, itemId));
        return { owner, itemId };
    }

    async preflightRalph(input: RalphLaunchInput): Promise<void> {
        if (!input.sentinelTodoTracking) return;
        const token = parse(tracking, input.sentinelTodoTracking);
        await this.owner(token.owner);
        this.eligible(this.item(token.owner, token.itemId));
        if (input.spawnedFromProcessId !== token.owner.processId) throw new SentinelTodoError('invalid', 'Tracked launch parent mismatch');
        await this.deps.service.evaluateDependencies(token.owner, token.itemId, evaluation => {
            if (evaluation.state !== 'ready') throw new SentinelTodoError('invalid', 'Current prerequisite evidence is not ready');
            if (this.deps.receipts.records(token.owner).some(row => row.itemId === token.itemId)) {
                throw new SentinelTodoError('invalid', 'Item already has a durable launch admission');
            }
        });
    }

    /** Uses only local owners enumerated from native rows; unavailable owners never route elsewhere. */
    async poll(owner: SentinelTodoOwner): Promise<void> {
        await this.owner(owner);
        this.refresh(owner);
        const attempted = new Set<string>();
        const items = this.deps.receipts.todos.get(owner).items.filter(item => item.dependsOn.length && !item.archived);
        for (const item of items) {
            if (item.type === 'manual') continue;
            for (const { record } of this.deps.receipts.records(owner).filter(row => row.itemId === item.id)) {
                if (!record.started && !record.error && this.deps.hasTask && !this.deps.hasTask(record.taskId)) {
                    this.block(owner, item.id, 'Admission outcome is unknown after interruption; no work retry was attempted.', record.taskId);
                }
            }
            let wake: DependencyWake | undefined;
            await this.deps.service.evaluateDependencies(owner, item.id, (evaluation, ledger) => {
                if (evaluation.state !== 'ready') return;
                const current = ledger.items.find(candidate => candidate.id === item.id)!;
                if (current.status === 'done' || this.deps.receipts.records(owner).some(row => row.itemId === item.id)) return;
                const transport = this.deps.coexistingTransport?.(owner, item.id, evaluation);
                const graphRevision = this.deps.receipts.todos.dependencyRevision(owner, item.id);
                wake = this.deps.receipts.reserveWake(owner, evaluation, generation(current, graphRevision), id => dependencyWakePrompt(id, item.id), transport?.triggerId, graphRevision, this.lineage(owner, ledger, current));
            });
            if (wake?.delivery === 'pending') {
                attempted.add(wake.id);
                await this.deliver(owner, wake);
            }
        }
        // Transport recovery preserves the original prompt/evidence even if sources subsequently change.
        for (const wake of this.deps.receipts.wakes(owner).filter(wake => wake.delivery === 'pending' && !attempted.has(wake.id))) await this.deliver(owner, wake);
    }

    private async deliver(owner: SentinelTodoOwner, wake: DependencyWake): Promise<void> {
        try {
            await this.owner(owner);
            this.refresh(owner);
            if (this.deps.receipts.wakes(owner, wake.itemId).find(current => current.id === wake.id)?.invalidatedAt) return;
            if (wake.transportTriggerId) {
                const transport = this.deps.coexistingTransport?.(owner, wake.itemId, wake.evidence, wake.transportTriggerId);
                if (transport?.state === 'waiting') {
                    this.deps.receipts.delivery(owner, wake, 'Existing owner-bound merge rule owns wake transport; waiting for its durable delivery');
                    return;
                }
                if (transport?.state === 'delivered') {
                    this.deps.receipts.delivery(owner, wake);
                    return;
                }
            }
            await this.deps.delivery.deliverOnce(owner.workspaceId, owner.processId, wake.id, {
                content: wake.prompt, displayContent: wake.prompt, respectQueueBarriers: true,
                turnSource: { source: 'trigger', triggerId: `sentinel-dependency:${wake.id}`, deliveryId: wake.id },
            });
            this.deps.receipts.delivery(owner, wake);
        } catch (error) {
            this.deps.receipts.delivery(owner, wake, error instanceof Error ? error.message : String(error));
        } finally { this.changed(owner, wake.itemId); }
    }

    async guard(input: CreateTaskInput, phase: 'enqueue' | 'check' | 'start'): Promise<void> {
        const context = input.payload.context as Record<string, unknown> | undefined;
        if (!context?.sentinelTodoTracking) return;
        const { owner, itemId } = parse(tracking, context.sentinelTodoTracking);
        if (input.type !== 'chat' || input.payload.kind !== 'chat' || input.payload.processId) {
            throw new SentinelTodoError('invalid', 'Tracked admission requires a new native chat/Ralph launch');
        }
        const ralph = context.ralph as { sessionId?: string; currentIteration?: number; phase?: string;
            finalCheck?: { kind?: string; checkIndex?: number } } | undefined;
        if (input.continuationOfSessionId) {
            // Running whole sessions continue independently of subsequent prerequisite edits.
            const record = this.deps.receipts.records(owner).find(row => row.itemId === itemId
                && row.record.sessionId === input.continuationOfSessionId)?.record;
            if (!record?.started || record.mode !== 'ralph' || input.payload.mode !== 'ralph'
                || input.payload.workspaceId !== record.workspaceId || (input.repoId && input.repoId !== record.workspaceId)
                || ralph?.sessionId !== record.sessionId || ralph?.phase !== 'executing'
                || context.spawnedFromProcessId !== owner.processId) {
                throw new SentinelTodoError('invalid', 'Ralph continuation has no matching started native admission');
            }
            await this.deps.service.assertOwner(owner);
            this.refresh(owner);
            if (phase === 'start') {
                const index = ralph.finalCheck ? ralph.finalCheck.checkIndex : ralph.currentIteration;
                if (!Number.isInteger(index) || index! < 1 || (ralph.finalCheck && ralph.finalCheck.kind !== 'goal-gap-check')) {
                    throw new SentinelTodoError('invalid', 'Ralph continuation requires an exact native step identity');
                }
                this.deps.receipts.transaction(owner, () => this.deps.receipts.startRalphStep(
                    record.taskId, `${ralph.finalCheck ? 'check' : 'iteration'}:${index}`, input.id!));
            }
            input.config = { ...input.config, respectQueueBarriers: true, retryOnFailure: false };
            return;
        }
        await processOperationAdmission.runExclusive(owner.processId, async () => {
            await this.owner(owner);
            this.refresh(owner);
            const item = this.item(owner, itemId);
            this.eligible(item);
            const existing = this.deps.receipts.records(owner).filter(row => row.itemId === itemId);
            if (!item.dependsOn.length && !existing.length) return;
            if (context.spawnedFromProcessId !== owner.processId) throw new SentinelTodoError('invalid', 'Tracked launch parent mismatch');
            const target = input.payload.workspaceId;
            if (typeof target !== 'string' || (input.repoId && input.repoId !== target)) {
                throw new SentinelTodoError('invalid', 'Tracked launch requires its concrete local target workspace');
            }
            await this.deps.validateTarget(target);
            if (input.payload.provider) await this.deps.validateProvider(input.payload.provider as ChatProvider);
            const record = input.id ? this.deps.receipts.admission(owner, itemId, input.id) : undefined;
            if (phase === 'enqueue' && existing.length) throw new SentinelTodoError('invalid', 'Item already has a durable launch admission');
            if (phase !== 'enqueue' && (!record || record.started || record.error)) {
                throw new SentinelTodoError('invalid', 'Launch admission is absent, blocked or already started');
            }
            for (const source of record?.lineage ?? []) {
                if (source.evidence !== undefined) await this.deps.service.evaluateDependencies(owner, source.itemId);
            }
            await this.deps.service.evaluateDependencies(owner, itemId, (evaluation, ledger) => {
                const current = ledger.items.find(candidate => candidate.id === itemId)!;
                this.eligible(current);
                this.deps.validateCurrent(input.payload.provider as ChatProvider | undefined, target, input.payload.mode as 'ask' | 'autopilot' | 'ralph', owner);
                if (evaluation.state !== 'ready') throw new SentinelTodoError('invalid', 'Current prerequisite evidence is not ready');
                if (record) {
                    if (target !== record.workspaceId || input.payload.mode !== record.mode) {
                        throw new SentinelTodoError('invalid', 'Launch does not match its admitted workspace/mode');
                    }
                    const reason = record.error ?? this.staleReason(owner, ledger, itemId, record.dependencies,
                        record.graphRevision, record.itemRevision, record.evidence ? JSON.parse(record.evidence) : undefined,
                        evaluation, record.lineage);
                    if (reason) throw new SentinelTodoError('invalid', reason);
                    if (phase === 'start') {
                        if (record.mode === 'ralph') this.deps.receipts.startRalphStep(record.taskId, 'iteration:1', input.id!);
                        this.deps.receipts.saveAdmission(owner, itemId, { ...record, started: true });
                    }
                    return;
                }
                input.id ??= randomUUID();
                const linked = this.deps.receipts.todos.linkJob(owner, itemId, {
                    processId: toQueueProcessId(input.id), workspaceId: target,
                    kind: ralph ? 'ralph' : 'local', openLink: this.deps.service.jobOpenLink(target, toQueueProcessId(input.id)),
                    ...(ralph?.sessionId ? { sessionId: ralph.sessionId } : {}),
                });
                this.deps.receipts.reserveAdmission(owner, itemId, {
                    taskId: input.id, workspaceId: target, mode: typeof input.payload.mode === 'string' ? input.payload.mode : 'autopilot', sessionId: ralph?.sessionId,
                    itemRevision: linked.item.revision, dependencies: JSON.stringify(current.dependsOn),
                    graphRevision: this.deps.receipts.todos.dependencyRevision(owner, itemId),
                    evidence: evidenceKey(evaluation), lineage: this.lineage(owner, ledger, current),
                });
            });
            context.respectQueueBarriers = true;
            input.config = { ...input.config, respectQueueBarriers: true, retryOnFailure: false };
            this.changed(owner, itemId);
        });
    }

    /** Queue errors never re-arm work; acceptance uncertainty retains its duplicate guard. */
    block(owner: SentinelTodoOwner, itemId: string, error: unknown, taskId?: string): void {
        if (!taskId) return;
        this.deps.receipts.transaction(owner, () => {
            for (const { record } of this.deps.receipts.records(owner).filter(row => row.itemId === itemId && row.record.taskId === taskId)) {
                if (record.started || record.error) continue;
                this.deps.receipts.saveAdmission(owner, itemId, { ...record,
                    error: error instanceof Error ? error.message : String(error) });
            }
        });
        this.changed(owner, itemId);
    }

    private eligible(item: SentinelTodoItem): void {
        if (item.type === 'manual' || item.archived || item.status === 'done') {
            throw new SentinelTodoError('invalid', 'Manual, archived or Done items cannot be delegated');
        }
    }

    private changed(owner: SentinelTodoOwner, itemId: string) {
        try { this.deps.onChange?.(owner, itemId); }
        catch { /* Notification failure cannot cancel committed work. */ }
    }
}
