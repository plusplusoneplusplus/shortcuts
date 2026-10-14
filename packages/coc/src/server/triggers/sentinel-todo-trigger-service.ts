import { randomUUID } from 'node:crypto';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import { z } from 'zod';
import type { SentinelTodoService } from '../sentinel-todos/sentinel-todo-service';
import type { SentinelTodoOwner, SentinelTodoStore } from '../sentinel-todos/sentinel-todo-store';
import type { TriggerManager, TriggerEventEmit, OneShotFirer } from './trigger-manager';
import { OneShotFireConflictError } from './trigger-manager';
import type { TriggerStore } from './trigger-store';
import { parsePullRequestUrl, type PrStatusFetcher, type PrStatusSnapshot } from './pr-status-fetcher';
import { DEFAULT_PR_MERGE_POLL_INTERVAL_MS, MAX_ACTIVE_TRIGGERS, type Trigger, type PrIdentity } from './trigger-types';

const id = z.string().trim().min(1).max(200);
const ruleInput = z.object({
    itemId: id,
    prUrl: z.string().trim().min(1).max(2_000),
    instruction: z.string().trim().max(8_000).optional(),
    /** Optional picker provenance; the URL remains the authority for provider identity. */
    workspaceId: id.optional(),
    originId: id.optional(),
}).strict();
const createInput = ruleInput.extend({
    runNow: z.boolean().optional(), confirmed: z.literal(true).optional(), idempotencyKey: id.optional(),
}).strict();
const editInput = ruleInput.extend({ expectedRevision: z.number().int().min(1) }).strict();
const revisionInput = z.object({ expectedRevision: z.number().int().min(1) }).strict();
const runInput = revisionInput.extend({ confirmed: z.literal(true) }).strict();

export class SentinelTodoTriggerError extends Error {
    constructor(readonly statusCode: number, message: string, readonly current?: Trigger) { super(message); }
}

export interface SentinelTodoTriggerServiceDeps {
    triggers: TriggerStore;
    todos: SentinelTodoStore;
    owners: Pick<SentinelTodoService, 'list'>;
    manager: Pick<TriggerManager, 'arm' | 'disarm'>;
    firer: OneShotFirer;
    fetchPr: PrStatusFetcher;
    enabled: boolean;
    emit?: TriggerEventEmit;
    now?: () => number;
}

/** One owner-scoped command surface for REST, Sentinel tools and the To-do editor. */
export class SentinelTodoTriggerService {
    constructor(private readonly deps: SentinelTodoTriggerServiceDeps) {}

    async list(owner: SentinelTodoOwner): Promise<Trigger[]> {
        await this.assertOwner(owner);
        return this.deps.triggers.getByWorkspace(owner.workspaceId).filter(trigger =>
            trigger.processId === owner.processId && trigger.binding && !trigger.binding.delegatedPr && !trigger.binding.removedAt);
    }

    async preview(owner: SentinelTodoOwner, input: unknown): Promise<{ pr: PrIdentity; snapshot: PrStatusSnapshot }> {
        await this.assertOwner(owner);
        const body = parse(z.object({ prUrl: ruleInput.shape.prUrl }).strict(), input);
        const pr = parsePr(body.prUrl);
        try { return { pr, snapshot: await this.deps.fetchPr(pr) }; }
        catch (error) { throw new SentinelTodoTriggerError(502, message(error)); }
    }

    async create(owner: SentinelTodoOwner, input: unknown, actor: 'user' | 'sentinel'): Promise<Trigger> {
        await this.assertOwner(owner);
        const body = parse(createInput, input);
        if (body.runNow && !body.confirmed) throw new SentinelTodoTriggerError(400, 'Run now requires confirmation');
        const replay = this.findCreation(owner, body.idempotencyKey);
        if (replay) return replay;
        const pr = parsePr(body.prUrl, body);
        this.assertEligible(owner, body.itemId);
        const snapshot = await this.readPr(pr);
        if (snapshot.status === 'closed') throw new SentinelTodoTriggerError(409, 'PR closed without merging');
        if (snapshot.status === 'merged' && !body.runNow) {
            throw new SentinelTodoTriggerError(409, 'PR already merged; use Run now');
        }
        await this.assertOwner(owner);
        const result = this.deps.triggers.transaction(() => {
            const replay = this.findCreation(owner, body.idempotencyKey);
            if (replay) return { trigger: replay, created: false };
            this.assertEligible(owner, body.itemId);
            this.assertCap();
            const at = this.timestamp();
            const candidate: Trigger = {
                id: `trigger_${randomUUID()}`, ...owner, status: 'active', revision: 1, inFlight: false,
                createdAt: at, expiresAt: null, lastTickAt: null,
                nextTickAt: new Date(this.now() + DEFAULT_PR_MERGE_POLL_INTERVAL_MS).toISOString(),
                event: {
                    type: 'condition-monitor', monitor: 'pr-merged', pr,
                    pollIntervalMs: DEFAULT_PR_MERGE_POLL_INTERVAL_MS, consecutiveErrors: 0,
                    lastSeenStatus: snapshot.status, lastSeenTitle: snapshot.title,
                    ...(snapshot.mergeCommit ? { mergeCommit: snapshot.mergeCommit } : {}),
                },
                binding: {
                    kind: 'sentinel-todo', itemId: body.itemId, instruction: body.instruction,
                    armedBy: actor, armedAt: at,
                    ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
                },
                action: { type: 'send-message', mode: 'inherit', processId: owner.processId, prompt: '' },
            };
            this.deps.triggers.insert(candidate);
            return { trigger: candidate, created: true };
        });
        const { trigger } = result;
        if (!result.created) return trigger;
        try { this.deps.manager.arm(trigger); }
        catch (error) {
            this.deps.triggers.delete(trigger.id);
            throw error;
        }
        this.emit('trigger-created', trigger);
        if (body.runNow) await this.deps.firer.fire(trigger.id, 'run-now');
        return this.deps.triggers.getById(trigger.id)!;
    }

    async edit(owner: SentinelTodoOwner, triggerId: string, input: unknown): Promise<Trigger> {
        await this.assertOwner(owner);
        const body = parse(editInput, input);
        this.requireMutable(owner, triggerId, body.expectedRevision);
        this.assertEligible(owner, body.itemId);
        const pr = parsePr(body.prUrl, body);
        const snapshot = await this.readPr(pr);
        if (snapshot.status === 'merged' || snapshot.status === 'closed') {
            throw new SentinelTodoTriggerError(409, snapshot.status === 'merged'
                ? 'PR already merged; use Run now' : 'PR closed without merging');
        }
        await this.assertOwner(owner);
        const updated = this.deps.triggers.transaction(() => {
            const current = this.requireMutable(owner, triggerId, body.expectedRevision);
            this.assertEligible(owner, body.itemId);
            const next: Trigger = {
                ...current, revision: current.revision + 1,
                binding: { ...current.binding!, itemId: body.itemId, instruction: body.instruction },
                event: {
                    type: 'condition-monitor', monitor: 'pr-merged', pr,
                    pollIntervalMs: DEFAULT_PR_MERGE_POLL_INTERVAL_MS, consecutiveErrors: 0,
                    lastSeenStatus: snapshot.status, lastSeenTitle: snapshot.title,
                },
                nextTickAt: current.status === 'active'
                    ? new Date(this.now() + DEFAULT_PR_MERGE_POLL_INTERVAL_MS).toISOString() : null,
            };
            this.deps.triggers.update(next);
            return next;
        });
        this.deps.manager.disarm(triggerId);
        if (updated.status === 'active') this.deps.manager.arm(updated);
        this.emit('trigger-updated', updated);
        return updated;
    }

    async setPaused(owner: SentinelTodoOwner, triggerId: string, input: unknown, paused: boolean): Promise<Trigger> {
        await this.assertOwner(owner);
        const body = parse(revisionInput, input);
        const updated = this.deps.triggers.transaction(() => {
            const current = this.requireMutable(owner, triggerId, body.expectedRevision);
            if (!paused) {
                this.assertEligible(owner, current.binding!.itemId);
                if (current.status !== 'active') this.assertCap();
            }
            const next: Trigger = {
                ...current, revision: current.revision + 1, status: paused ? 'paused' : 'active',
                nextTickAt: paused ? null : this.timestamp(),
            };
            this.deps.triggers.update(next);
            return next;
        });
        this.deps.manager.disarm(triggerId);
        if (!paused) this.deps.manager.arm(updated);
        this.emit(paused ? 'trigger-paused' : 'trigger-updated', updated);
        return updated;
    }

    async remove(owner: SentinelTodoOwner, triggerId: string, input: unknown): Promise<Trigger> {
        await this.assertOwner(owner);
        const body = parse(revisionInput, input);
        const removed = this.deps.triggers.transaction(() =>
            this.retire(this.requireRule(owner, triggerId, body.expectedRevision)));
        this.released(removed);
        return removed;
    }

    /**
     * Retires every live rule bound to `itemId` inside the caller's database
     * transaction, so closing the item and disarming its rules commit
     * together. Run the returned callback after that transaction commits.
     */
    retireItemRules(owner: SentinelTodoOwner, itemId: string): () => void {
        const removed = this.deps.triggers.getByWorkspace(owner.workspaceId)
            .filter(trigger => trigger.processId === owner.processId && trigger.binding?.itemId === itemId
                && !trigger.binding.removedAt)
            .map(trigger => this.retire(trigger));
        return () => removed.forEach(trigger => this.released(trigger));
    }

    async runNow(owner: SentinelTodoOwner, triggerId: string, input: unknown): Promise<Trigger> {
        await this.assertOwner(owner);
        const body = parse(runInput, input);
        this.requireMutable(owner, triggerId, body.expectedRevision);
        try { await this.deps.firer.fire(triggerId, 'run-now', body.expectedRevision); }
        catch (error) {
            if (error instanceof OneShotFireConflictError) {
                throw new SentinelTodoTriggerError(409, error.message, this.deps.triggers.getById(triggerId) ?? undefined);
            }
            throw error;
        }
        const result = this.deps.triggers.getById(triggerId);
        if (!result || !result.outcome) throw new SentinelTodoTriggerError(409, 'Rule changed before Run now', result ?? undefined);
        this.deps.manager.disarm(triggerId);
        if (result.delivery?.state === 'pending') this.deps.manager.arm(result);
        return result;
    }

    private async assertOwner(owner: SentinelTodoOwner): Promise<void> {
        if (!this.deps.enabled) throw new SentinelTodoTriggerError(403, 'Triggers are disabled (triggers.enabled is off)');
        await this.deps.owners.list(owner);
    }

    private retire(current: Trigger): Trigger {
        const next: Trigger = {
            ...current, status: 'disarmed', revision: current.revision + 1,
            binding: { ...current.binding!, removedAt: this.timestamp() },
            nextTickAt: current.delivery?.state === 'pending' ? current.nextTickAt : null,
        };
        // Delivery and authoring receipts survive Clear so stale retries cannot revive work.
        if (current.delivery || current.binding?.idempotencyKey) this.deps.triggers.update(next);
        else this.deps.triggers.delete(current.id);
        return next;
    }

    private released(removed: Trigger): void {
        if (removed.delivery?.state !== 'pending') this.deps.manager.disarm(removed.id);
        this.emit('trigger-disarmed', removed);
    }

    private assertEligible(owner: SentinelTodoOwner, itemId: string): void {
        const item = this.deps.todos.get(owner).items.find(item => item.id === itemId);
        if (!item) throw new SentinelTodoTriggerError(404, 'To-do item not found');
        if (item.type === 'manual') throw new SentinelTodoTriggerError(400, 'Manual items cannot have executable rules');
        if (item.archived || item.status === 'done') throw new SentinelTodoTriggerError(409, 'Item is Done or archived');
    }

    private assertCap(): void {
        if (this.deps.triggers.countActive() >= MAX_ACTIVE_TRIGGERS) {
            throw new SentinelTodoTriggerError(409, `Server-wide active trigger limit reached (${MAX_ACTIVE_TRIGGERS})`);
        }
    }

    private findCreation(owner: SentinelTodoOwner, key: string | undefined): Trigger | undefined {
        if (!key) return;
        const existing = this.deps.triggers.getByWorkspace(owner.workspaceId).find(trigger =>
            trigger.processId === owner.processId && trigger.binding?.idempotencyKey === key);
        if (existing?.binding?.removedAt) throw new SentinelTodoTriggerError(409, 'Rule was removed', existing);
        return existing;
    }

    private requireRule(owner: SentinelTodoOwner, triggerId: string, revision: number): Trigger {
        const current = this.deps.triggers.getById(triggerId);
        if (!current?.binding || current.binding.delegatedPr || current.binding.removedAt
            || current.workspaceId !== owner.workspaceId || current.processId !== owner.processId) {
            throw new SentinelTodoTriggerError(404, 'Trigger not found');
        }
        if (current.revision !== revision) throw new SentinelTodoTriggerError(409, 'Rule revision conflict', current);
        return current;
    }

    private requireMutable(owner: SentinelTodoOwner, triggerId: string, revision: number): Trigger {
        const current = this.requireRule(owner, triggerId, revision);
        if (current.outcome || current.delivery || (current.status !== 'active' && current.status !== 'paused')) {
            throw new SentinelTodoTriggerError(409, 'Terminal rules cannot be edited, resumed or run again', current);
        }
        return current;
    }

    private async readPr(pr: PrIdentity): Promise<PrStatusSnapshot> {
        try { return await this.deps.fetchPr(pr); }
        catch (error) { throw new SentinelTodoTriggerError(502, message(error)); }
    }
    private now(): number { return (this.deps.now ?? Date.now)(); }
    private timestamp(): string { return new Date(this.now()).toISOString(); }
    private emit(type: Parameters<TriggerEventEmit>[0]['type'], trigger: Trigger): void {
        try { this.deps.emit?.({ type, trigger }); }
        catch (error) { getLogger().warn(LogCategory.AI, `[SentinelTodoTriggerService] Notification failed: ${message(error)}`); }
    }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new SentinelTodoTriggerError(400, result.error.issues.map(issue => issue.message).join('; '));
    return result.data;
}
function parsePr(url: string, provenance?: { workspaceId?: string; originId?: string }): PrIdentity {
    const pr = parsePullRequestUrl(url);
    if (!pr) throw new SentinelTodoTriggerError(400, 'A supported GitHub or Azure DevOps PR URL is required');
    return { ...pr, ...(provenance?.workspaceId ? { workspaceId: provenance.workspaceId } : {}),
        ...(provenance?.originId ? { originId: provenance.originId } : {}) };
}
function message(error: unknown): string { return (error instanceof Error ? error.message : String(error)).slice(0, 1_000); }
