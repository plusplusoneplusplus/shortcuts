import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { resolveModelForProvider, toQueueProcessId, type CreateTaskInput } from '@plusplusoneplusplus/forge';
import type { SentinelTodoTrackedAdmission } from '@plusplusoneplusplus/coc-client';
import { processOperationAdmission } from '../processes/process-operation-admission';
import type { ProcessMessageDeliveryService } from '../processes/process-message-delivery-service';
import type { ChatProvider } from '../tasks/task-types';
import type { RalphLaunchInput } from '../ralph/ralph-launch-service';
import { buildRalphIterationTask } from '../ralph/enqueue-iteration';
import { SentinelTodoError, type SentinelTodoItem, type SentinelTodoLedger, type SentinelTodoOwner } from './sentinel-todo-store';
import type { SentinelTodoService } from './sentinel-todo-service';
import { SentinelDependencyStore, type DependencyActionRecord, type DependencyWake } from './sentinel-dependency-store';

const text = z.string().trim().min(1);
const settings = z.object({
    mode: z.enum(['ask', 'autopilot', 'ralph']),
    provider: z.enum(['copilot', 'codex', 'claude', 'opencode']),
    model: text.max(200), targetWorkspaceId: text.max(200),
    prompt: text.max(100_000), scope: text.max(4_000),
}).strict();
const approval = z.object({ expectedRevision: z.number().int().positive(), confirmed: z.literal(true), action: settings }).strict();
const revocation = z.object({ expectedRevision: z.number().int().positive() }).strict();
const tracking = z.object({
    owner: z.object({ workspaceId: text.max(200), processId: text.max(200) }).strict(),
    itemId: text.max(200), actionRevision: z.number().int().positive().optional(),
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

function generation(item: Pick<SentinelTodoItem, 'dependsOn'>, record?: DependencyActionRecord, graphRevision = record?.graphRevision ?? 0): string {
    const parts = [item.dependsOn, record?.generationRevision ?? record?.action.revision ?? 0];
    if (graphRevision) parts.push(graphRevision);
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/** Wakes transport evidence only. Admission consumes explicit user authority before any queue side effect. */
export class SentinelDependencyActions {
    constructor(private readonly deps: {
        receipts: SentinelDependencyStore;
        dataDir: string;
        service: SentinelTodoService;
        delivery: Pick<ProcessMessageDeliveryService, 'deliverOnce'>;
        validateProvider: (provider: ChatProvider) => Promise<void>;
        validateTarget: (workspaceId: string) => Promise<void>;
        validateOwner?: (owner: SentinelTodoOwner) => void;
        /** Live synchronous capability recheck inside the native writer transaction. */
        validateCurrent: (provider: ChatProvider, workspaceId: string, mode: 'ask' | 'autopilot' | 'ralph', owner: SentinelTodoOwner) => string | void;
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
        lineage?: DependencyActionRecord['lineage']): string | undefined {
        const item = ledger.items.find(item => item.id === itemId);
        if (!item || item.archived) return 'Dependent item is missing or archived';
        const currentGraphRevision = this.deps.receipts.todos.dependencyRevision(owner, itemId);
        if (JSON.stringify(item.dependsOn) !== dependencies
            || (graphRevision !== undefined ? currentGraphRevision !== graphRevision : currentGraphRevision > boundRevision)) {
            return 'Dependency/action revision changed: prerequisite graph was edited';
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
        for (const admissions of [false, true]) {
            for (const { itemId, record } of this.deps.receipts.records(owner, admissions)) {
                const wake = wakes.find(wake => wake.itemId === itemId
                    && wake.generation === generation({ dependsOn: JSON.parse(record.dependencies) }, record));
                const edges = record.evidence ? JSON.parse(record.evidence) as DependencyWake['evidence']['edges'] : wake?.evidence.edges;
                const item = ledger.items.find(item => item.id === itemId);
                const reason = unavailable ?? this.staleReason(owner, ledger, itemId, record.dependencies,
                    record.graphRevision, record.itemRevision, edges, evaluation, record.lineage ?? wake?.lineage)
                    ?? (!record.started && item?.status === 'done' ? 'Dependent has an explicit current Done verdict' : undefined);
                if (!reason || (record.started ? record.action.requiresReview
                    : !['authorized', 'consumed'].includes(record.action.state))) continue;
                const updated = { ...record, action: record.started
                    ? { ...record.action, requiresReview: true, error: record.action.error ?? reason }
                    : { ...record.action, state: 'blocked' as const, error: reason } };
                changed.add(itemId);
                if (admissions) this.deps.receipts.saveAdmission(owner, itemId, updated);
                const current = this.deps.receipts.action(owner, itemId);
                if (!admissions || (current?.action.taskId === record.action.taskId && current.action.revision === record.action.revision)) {
                    this.deps.receipts.saveAction(owner, itemId, updated);
                }
            }
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

    private lineage(owner: SentinelTodoOwner, ledger: SentinelTodoLedger, item: SentinelTodoItem): NonNullable<DependencyActionRecord['lineage']> {
        const sources = new Map(ledger.items.map(source => [source.id, source]));
        const visited = new Set<string>();
        const pending = item.dependsOn.map(edge => edge.itemId);
        const result: NonNullable<DependencyActionRecord['lineage']> = [];
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

    async authorize(owner: SentinelTodoOwner, itemId: string, input: unknown, actor: 'user') {
        if (actor !== 'user') throw new SentinelTodoError('invalid', 'Only explicit owner-user approval may authorize an action');
        const body = parse(approval, input);
        await this.owner(owner);
        await this.available(body.action);
        await this.owner(owner);
        const result = this.deps.receipts.transaction(owner, () => {
            const item = this.item(owner, itemId);
            this.eligible(item);
            const targetVersion = this.deps.validateCurrent(body.action.provider, body.action.targetWorkspaceId, body.action.mode, owner);
            const previous = this.deps.receipts.action(owner, itemId);
            const result = this.deps.receipts.todos.update(owner, itemId, body.expectedRevision, {}, 'user');
            const record: DependencyActionRecord = {
                action: { ...body.action, revision: (previous?.action.revision ?? 0) + 1,
                    state: 'authorized', authorizedAt: new Date().toISOString(), authorizedBy: 'user', taskId: randomUUID() },
                itemRevision: result.item.revision, dependencies: JSON.stringify(result.item.dependsOn),
                graphRevision: this.deps.receipts.todos.dependencyRevision(owner, itemId),
                generationRevision: (previous?.action.revision ?? 0) + 1,
                ...(targetVersion ? { targetVersion } : {}),
            };
            this.deps.receipts.saveAction(owner, itemId, record);
            return { ...result, item: { ...result.item, ...this.project(owner, result.item),
                jobs: result.item.jobs.map(job => ({ ...job, execution: { state: 'unknown' as const } })) } };
        });
        this.changed(owner, itemId);
        return result;
    }

    async revoke(owner: SentinelTodoOwner, itemId: string, input: unknown, actor: 'user') {
        if (actor !== 'user') throw new SentinelTodoError('invalid', 'Only the owner user may revoke authority');
        const body = parse(revocation, input);
        await this.owner(owner);
        const result = this.deps.receipts.transaction(owner, () => {
            const record = this.deps.receipts.requireAction(owner, itemId);
            const result = this.deps.receipts.todos.update(owner, itemId, body.expectedRevision, {}, 'user');
            this.deps.receipts.saveAction(owner, itemId, { ...record,
                action: { ...record.action, state: 'revoked', revision: record.action.revision + 1 } });
            return { ...result, item: { ...result.item, ...this.project(owner, result.item),
                jobs: result.item.jobs.map(job => ({ ...job, execution: { state: 'unknown' as const } })) } };
        });
        this.changed(owner, itemId);
        return result;
    }

    project(owner: SentinelTodoOwner, item: SentinelTodoItem) {
        const record = this.deps.receipts.action(owner, item.id);
        const evaluation = this.deps.receipts.evaluation(owner, item.id);
        const wake = this.deps.receipts.wakes(owner, item.id).find(wake => wake.generation === generation(item, record,
            this.deps.receipts.todos.dependencyRevision(owner, item.id)));
        const warned = this.deps.receipts.records(owner, true).some(candidate =>
            candidate.itemId === item.id && candidate.record.action.requiresReview);
        const sources = evaluation ? new Map(this.deps.receipts.todos.get(owner).items.map(source => [source.id, source])) : undefined;
        const current = evaluation?.itemRevision === item.revision && evaluation.edges.every(edge =>
            sources?.get(edge.dependency.itemId)?.revision === edge.sourceRevision);
        const ready = current && evaluation?.state === 'ready';
        return {
            ...(record ? { dependencyAction: { ...record.action, ...(warned ? { requiresReview: true } : {}) } } : {}),
            ...(item.dependsOn.length ? { dependencyReadiness: {
                state: !ready ? 'waiting' as const : item.type === 'manual' || record?.action.state === 'authorized' || record?.action.state === 'consumed'
                    ? 'ready' as const : 'needs_approval' as const,
                evaluation, ...(wake ? { activationId: wake.id, delivery: wake.delivery, error: wake.invalidatedReason ?? wake.error,
                    transportTriggerId: wake.transportTriggerId } : {}),
            } } : {}),
        };
    }

    async context(owner: SentinelTodoOwner, itemId: string, requested?: unknown): Promise<SentinelTodoTrackedAdmission> {
        await this.owner(owner);
        const item = this.item(owner, itemId);
        if (item.type === 'manual' || item.archived) throw new SentinelTodoError('invalid', 'Manual or archived items cannot be delegated');
        const record = this.deps.receipts.action(owner, itemId);
        if (requested && (item.dependsOn.length || record)) {
            if (!record || record.action.state !== 'authorized') throw new SentinelTodoError('invalid', 'Needs approval: missing, revoked or consumed authority');
            const args = requested as { content?: string; mode?: string; provider?: string; model?: string; workspaceId?: string; effortTier?: string; entryPoint?: string; processId?: string };
            if (args.content !== record.action.prompt || args.mode !== record.action.mode || args.provider !== record.action.provider
                || args.model !== record.action.model || args.workspaceId !== record.action.targetWorkspaceId
                || args.effortTier || args.entryPoint === 'grill' || args.processId) {
                const error = new SentinelTodoError('invalid', 'Explicit launch settings must exactly match the saved action; defaults/Auto and post mode cannot substitute');
                this.block(owner, itemId, record.action.revision, error);
                throw error;
            }
            try {
                await this.available(record.action);
                const targetVersion = this.deps.receipts.transaction(owner, () =>
                    this.deps.validateCurrent(record.action.provider, record.action.targetWorkspaceId, record.action.mode, owner));
                if (targetVersion !== record.targetVersion) throw new Error('Saved target registration changed');
            } catch (error) {
                this.block(owner, itemId, record.action.revision, error);
                throw error;
            }
        }
        return { owner, itemId, ...(record ? { actionRevision: record.action.revision } : {}) };
    }

    async preflightRalph(input: RalphLaunchInput): Promise<void> {
        if (!input.sentinelTodoTracking) return;
        const token = parse(tracking, input.sentinelTodoTracking);
        await this.owner(token.owner);
        const record = this.deps.receipts.action(token.owner, token.itemId);
        if (!this.item(token.owner, token.itemId).dependsOn.length && !record) return;
        try {
            if (!record || record.action.state !== 'authorized') throw new Error('Needs fresh explicit dependency action approval');
            const selection = input.aiSelection as { provider?: string; config?: { model?: string; reasoningEffort?: string; effortTier?: string }; autoProviderRouting?: boolean } | undefined;
            if (record.action.mode !== 'ralph' || token.actionRevision !== record.action.revision
                || input.requestId !== record.action.taskId || input.goalSpec !== record.action.prompt
                || input.workspaceId !== record.action.targetWorkspaceId || selection?.provider !== record.action.provider
                || selection?.config?.model !== record.action.model || selection.autoProviderRouting
                || selection.config.reasoningEffort || selection.config.effortTier || input.worktree
                || input.workingDirectory || input.folderPath || input.entryPoint === 'grill'
                || input.spawnedFromProcessId !== token.owner.processId) throw new Error('Ralph launch parameters do not match the saved action');
            await this.available(record.action);
            const targetVersion = this.deps.receipts.transaction(token.owner, () => this.deps.validateCurrent(
                record.action.provider, record.action.targetWorkspaceId, record.action.mode, token.owner));
            if (record.targetVersion !== targetVersion) throw new Error('Saved target registration changed');
        } catch (error) {
            this.block(token.owner, token.itemId, token.actionRevision, error);
            throw error;
        }

    }

    assertToolPostAllowed(processId: string, sessionId?: string): void {
        if (this.deps.receipts.tracksJob(processId, sessionId)) {
            throw new SentinelTodoError('invalid', 'Dependency-tracked actions cannot be retried or escalated through tool post mode; request fresh explicit authority and use a new tracked launch');
        }
    }

    /** Uses only local owners enumerated from native rows; unavailable owners never route elsewhere. */
    async poll(owner: SentinelTodoOwner): Promise<void> {
        await this.owner(owner);
        this.refresh(owner);
        const attempted = new Set<string>();
        const items = this.deps.receipts.todos.get(owner).items.filter(item => item.dependsOn.length && !item.archived);
        for (const item of items) {
            if (item.type === 'manual') continue;
            const action = this.deps.receipts.action(owner, item.id);
            if (action?.action.state === 'consumed' && !action.started && this.deps.hasTask && !this.deps.hasTask(action.action.taskId)) {
                this.block(owner, item.id, action.action.revision, 'Admission outcome is unknown after interruption; no work retry was attempted. Fresh explicit approval is required.');
            }
            let wake: DependencyWake | undefined;
            await this.deps.service.evaluateDependencies(owner, item.id, (evaluation, ledger) => {
                if (evaluation.state !== 'ready') return;
                const current = ledger.items.find(candidate => candidate.id === item.id)!;
                const record = this.deps.receipts.action(owner, item.id);
                if (current.status === 'done' || (record && record.action.state !== 'authorized')) return;
                const transport = this.deps.coexistingTransport?.(owner, item.id, evaluation);
                const graphRevision = this.deps.receipts.todos.dependencyRevision(owner, item.id);
                wake = this.deps.receipts.reserveWake(owner, evaluation, generation(current, record, graphRevision), id => [
                    'Native Sentinel dependencies are satisfied. This receipt grants no execution authority.',
                    'Read the current item, dependency evidence and saved dependencyAction before deciding.',
                    'Only delegate the already explicitly user-authorized saved prompt, mode, provider, model, target and scope.',
                    'Missing/revoked authority needs approval. Do not retry consumed, blocked or uncertain work.',
                    'Use send_to_conversation with todoItemId. Fulfillment remains unchanged.',
                    `Receipt: ${id}; item: ${item.id}.`,
                ].join('\n'), transport?.triggerId, graphRevision, this.lineage(owner, ledger, current));
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
        const raw = context?.sentinelTodoTracking;
        if (!raw) return;
        const token = parse(tracking, raw);
        if (input.type !== 'chat' || input.payload.kind !== 'chat' || input.payload.processId) {
            throw new SentinelTodoError('invalid', 'Tracked authority admits only a new native chat/Ralph action');
        }
        const { owner, itemId } = token;
        const continuation = context?.ralph as { currentIteration?: number; sessionId?: string; originalGoal?: string; phase?: string;
            finalCheck?: { kind?: string; checkIndex?: number } } | undefined;
        if (input.continuationOfSessionId) {
            const taskId = continuation?.sessionId?.replace(/^ralph-approved-/, '');
            const admitted = taskId && this.deps.receipts.admission(owner, itemId, taskId);
            if (!admitted || !admitted.started || admitted.action.mode !== 'ralph' || input.payload.mode !== 'ralph'
                || token.actionRevision !== admitted.action.revision
                || input.continuationOfSessionId !== continuation?.sessionId
                || continuation?.phase !== 'executing'
                || continuation?.originalGoal !== admitted.action.prompt
                || input.payload.provider !== admitted.action.provider || input.config?.model !== admitted.action.model
                || input.payload.workspaceId !== admitted.action.targetWorkspaceId
                || (input.repoId && input.repoId !== admitted.action.targetWorkspaceId)
                || context?.autoProviderRouting || input.config?.retryOnFailure || (input.config?.retryAttempts ?? 0) > 0
                || input.config?.reasoningEffort || (input.config as { effortTier?: string })?.effortTier
                || (admitted.targetVersion && [input.folderPath, input.payload.folderPath, input.payload.workingDirectory]
                    .some(folder => typeof folder === 'string' && path.resolve(folder) !== path.resolve(admitted.targetVersion!)))) {
                throw new SentinelTodoError('invalid', 'Ralph continuation has no matching started native admission');
            }
            // A running whole-session action continues independently of later graph edits/revocation.
            this.refresh(owner);
            if (phase === 'start') {
                const index = continuation.finalCheck ? continuation.finalCheck.checkIndex : continuation.currentIteration;
                if (!Number.isInteger(index) || index! < 1
                    || (continuation.finalCheck && continuation.finalCheck.kind !== 'goal-gap-check')) {
                    throw new SentinelTodoError('invalid', 'Ralph continuation requires an exact native step identity');
                }
                this.deps.receipts.transaction(owner, () => this.deps.receipts.startRalphStep(
                    admitted.action.taskId, `${continuation.finalCheck ? 'check' : 'iteration'}:${index}`, input.id!));
            }
            this.applyScope(input, admitted);
            input.config = { ...input.config, respectQueueBarriers: true, retryOnFailure: false };
            return;
        }
        await processOperationAdmission.runExclusive(owner.processId, async () => {
            try {
                await this.owner(owner);
                this.refresh(owner);
            }
            catch (error) {
                this.block(owner, itemId, token.actionRevision, error);
                throw error;
            }
            const item = this.item(owner, itemId);
            if (item.type === 'manual' || item.archived || item.status === 'done') {
                throw new SentinelTodoError('invalid', 'Manual, archived or Done items cannot be delegated');
            }
            const initial = this.deps.receipts.action(owner, itemId);
            if (!item.dependsOn.length && !initial) return;
            if (!initial) throw new SentinelTodoError('invalid', 'Needs approval: no saved action');
            if (phase === 'enqueue' && initial.action.state !== 'authorized') {
                throw new SentinelTodoError('invalid', `Action is revoked, consumed or blocked; fresh explicit approval is required. ${initial.action.error ?? ''}`);
            }
            try {
                await this.available(initial.action);
                await this.owner(owner);
                const wake = this.deps.receipts.wakes(owner, itemId).find(wake =>
                    wake.generation === generation({ dependsOn: JSON.parse(initial.dependencies) }, initial));
                for (const source of initial.lineage ?? wake?.lineage ?? []) {
                    if (source.evidence !== undefined) await this.deps.service.evaluateDependencies(owner, source.itemId);
                }
                await this.deps.service.evaluateDependencies(owner, itemId, (evaluation, ledger) => {
                    const record = this.deps.receipts.requireAction(owner, itemId);
                    const current = ledger.items.find(item => item.id === itemId)!;
                    const targetVersion = this.deps.validateCurrent(record.action.provider, record.action.targetWorkspaceId, record.action.mode, owner);
                    if (record.targetVersion !== targetVersion) throw new Error('Saved target registration changed');
                    if (token.actionRevision !== record.action.revision || current.revision !== record.itemRevision
                        || JSON.stringify(current.dependsOn) !== record.dependencies
                        || (record.graphRevision !== undefined && record.graphRevision !== this.deps.receipts.todos.dependencyRevision(owner, itemId))) {
                        throw new Error('Dependency/action revision changed');
                    }
                    if (evaluation.state !== 'ready') throw new Error('Current prerequisite evidence is not ready');
                    if (context?.spawnedFromProcessId !== owner.processId) throw new Error('Tracked launch parent mismatch');
                    const action = record.action;
                    if (phase !== 'enqueue' && record.started) throw new Error('Action was already started');
                    const ralph = context?.ralph as { originalGoal?: string; currentIteration?: number; sessionId?: string; phase?: string; maxIterations?: number } | undefined;
                    const mode = input.payload.mode;
                    const executionPrompt = phase === 'enqueue' ? input.payload.prompt : this.unscopedPrompt(input, record);
                    const prompt = ralph ? ralph.originalGoal : executionPrompt;
                    if (mode !== action.mode || input.payload.provider !== action.provider || input.config?.model !== action.model
                        || input.payload.workspaceId !== action.targetWorkspaceId || prompt !== action.prompt
                        || (input.repoId && input.repoId !== action.targetWorkspaceId)
                        || context?.autoProviderRouting || input.config?.reasoningEffort
                        || (input.config as { effortTier?: string })?.effortTier
                        || input.folderPath || input.payload.folderPath || input.payload.workingDirectory
                        || input.config?.retryOnFailure || (input.config?.retryAttempts ?? 0) > 0
                        || ((action.mode === 'ralph') !== !!ralph)
                        || (ralph && (ralph.currentIteration !== 1 || ralph.phase !== 'executing'
                            || ralph.sessionId !== `ralph-approved-${action.taskId}`))) {
                        throw new Error('Launch parameters do not match the saved authorization snapshot');
                    }
                    if (ralph && (!Number.isInteger(ralph.maxIterations) || ralph.maxIterations! < 1
                        || executionPrompt !== buildRalphIterationTask({
                            workspaceId: action.targetWorkspaceId, sessionId: ralph.sessionId!, originalGoal: action.prompt,
                            iteration: 1, maxIterations: ralph.maxIterations!, dataDir: this.deps.dataDir,
                        }).payload.prompt)) {
                        throw new Error('Ralph execution prompt must match the canonical saved goal envelope');
                    }
                    const wake = this.deps.receipts.wakes(owner, itemId).find(wake => wake.generation === generation(current, record));
                    if (!wake || wake.invalidatedAt || evidenceKey(wake.evidence) !== evidenceKey(evaluation)) throw new Error('Committed readiness evidence is missing or stale');
                    if (phase !== 'enqueue') {
                        if (record.action.state !== 'consumed' || input.id !== action.taskId || record.started
                            || record.evidence !== evidenceKey(evaluation)) throw new Error('Action admission is absent, stale or already started');
                        if (phase === 'check') {
                            this.applyScope(input, record);
                            return;
                        }
                        const started = { ...record, started: true };
                        if (ralph) this.deps.receipts.startRalphStep(action.taskId, 'iteration:1', input.id!);
                        this.deps.receipts.saveAction(owner, itemId, started);
                        this.deps.receipts.saveAdmission(owner, itemId, started);
                        this.applyScope(input, started);
                        return;
                    }
                    if (record.action.state !== 'authorized') throw new Error('Action was already consumed or revoked');
                    if (input.id && input.id !== action.taskId) throw new Error('Launch identity does not match the saved action');
                    input.id = action.taskId;
                    const linked = this.deps.receipts.todos.linkJob(owner, itemId, {
                        processId: toQueueProcessId(action.taskId), workspaceId: action.targetWorkspaceId,
                        kind: ralph ? 'ralph' : 'local', openLink: `#/process/${toQueueProcessId(action.taskId)}`,
                        ...(ralph ? { sessionId: `ralph-approved-${action.taskId}` } : {}),
                    });
                    const admitted: DependencyActionRecord = { ...record, itemRevision: linked.item.revision,
                        action: { ...action, state: 'consumed' }, evidence: evidenceKey(evaluation), lineage: wake.lineage };
                    this.deps.receipts.saveAction(owner, itemId, admitted);
                    this.deps.receipts.saveAdmission(owner, itemId, admitted);
                    context!.respectQueueBarriers = true;
                    input.config = { ...input.config, respectQueueBarriers: true, retryOnFailure: false };
                });
            } catch (error) {
                this.block(owner, itemId, token.actionRevision, error);
                throw error;
            }
            this.changed(owner, itemId);
        });
    }

    /** Queue errors never re-arm work; deterministic identity reconciles accepted jobs separately. */
    block(owner: SentinelTodoOwner, itemId: string, revision: number | undefined, error: unknown): void {
        this.deps.receipts.transaction(owner, () => {
            const record = this.deps.receipts.action(owner, itemId);
            if (!record || record.action.revision !== revision || record.started
                || record.action.state === 'revoked' || record.action.state === 'blocked') return;
            this.deps.receipts.saveAction(owner, itemId, { ...record,
                action: { ...record.action, state: 'blocked', error: error instanceof Error ? error.message : String(error) } });
        });
        this.changed(owner, itemId);
    }

    private eligible(item: SentinelTodoItem): void {
        if (item.type === 'manual' || item.archived || item.status === 'done' || !item.dependsOn.length) {
            throw new SentinelTodoError('invalid', 'Action approval requires an active normal dependent item');
        }
    }

    private async available(action: z.infer<typeof settings>): Promise<void> {
        try {
            await this.deps.validateTarget(action.targetWorkspaceId);
            await this.deps.validateProvider(action.provider);
        } catch (error) {
            throw new SentinelTodoError('invalid', error instanceof Error ? error.message : String(error));
        }

        const resolved = resolveModelForProvider(action.provider, action.model);
        if (resolved.coerced || resolved.model !== action.model) {
            throw new SentinelTodoError('invalid', 'Saved model is not valid for the concrete provider');
        }
    }

    private applyScope(input: CreateTaskInput, record: DependencyActionRecord): void {
        const directive = this.scopeDirective(record);
        if (typeof input.payload.prompt === 'string' && !input.payload.prompt.startsWith(directive)) {
            input.payload.prompt = directive + input.payload.prompt;
        }

    }

    private scopeDirective(record: DependencyActionRecord): string {
        return `Owner-authorized scope for this saved ${record.action.mode} action:\n${record.action.scope}\nStay within this scope; prerequisite satisfaction grants no additional authority.\n\n`;
    }

    private unscopedPrompt(input: CreateTaskInput, record: DependencyActionRecord): unknown {
        const prompt = input.payload.prompt;
        const prefix = this.scopeDirective(record);
        return typeof prompt === 'string' && prompt !== record.action.prompt && prompt.startsWith(prefix)
            ? prompt.slice(prefix.length) : prompt;
    }

    private changed(owner: SentinelTodoOwner, itemId: string) {
        try {
            this.deps.onChange?.(owner, itemId);
        } catch {
            // Operational state committed; notification failure cannot cancel running work.
        }
    }
}
