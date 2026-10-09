import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { z } from 'zod';
import { getRepoDataPath } from '../paths';
import { atomicWriteJsonUnique } from '../shared/fs-utils';

export const SENTINEL_TODOS_FILE = 'sentinel-todos.json';
export const MAX_TODO_ITEMS = 500;
export const MAX_TODO_JOB_LINKS = 50;

const id = z.string().min(1).max(200);
export const todoStatusSchema = z.enum(['todo', 'in_progress', 'needs_attention', 'done']);
/** `system` marks server-recorded job outcomes; it is never a caller-supplied actor. */
const actorSchema = z.enum(['user', 'sentinel', 'system']);
const targetRepoSchema = z.object({
    workspaceId: id, serverId: id.optional(), label: z.string().min(1).max(200).optional(),
});
const outcomeSchema = z.object({
    summary: z.string().min(1).max(4_000),
    recordedAt: z.iso.datetime(),
    recordedBy: actorSchema,
});
const jobOutcomeSchema = z.enum(['completed', 'failed', 'cancelled', 'capped']);
const jobResultSchema = z.object({
    terminalEventId: id,
    outcome: jobOutcomeSchema,
    reason: z.string().max(2_000).optional(),
    recordedAt: z.iso.datetime(),
});
/**
 * An explicit link from an item to one delegated job. `processId` is the
 * job's conversation on its own server; `result` is the first terminal
 * execution outcome recorded for a local job (remote jobs never get one).
 */
const jobLinkSchema = z.object({
    processId: id,
    workspaceId: id,
    serverId: id.optional(),
    kind: z.enum(['local', 'remote', 'ralph']),
    sessionId: id.optional(),
    openLink: z.string().min(1).max(2_000),
    title: z.string().max(200).optional(),
    linkedAt: z.iso.datetime(),
    result: jobResultSchema.optional(),
});
const itemSchema = z.object({
    id,
    title: z.string().trim().min(1).max(200),
    completionCondition: z.string().max(1_000),
    notes: z.string().max(8_000),
    targetRepo: targetRepoSchema.optional(),
    status: todoStatusSchema,
    statusReason: z.string().min(1).max(2_000).optional(),
    outcome: outcomeSchema.optional(),
    archived: z.boolean(),
    revision: z.number().int().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    createdBy: actorSchema,
    updatedBy: actorSchema,
    idempotencyKey: id.optional(),
    jobs: z.array(jobLinkSchema).max(MAX_TODO_JOB_LINKS).default([]),
    /** Last user edit; job outcomes recorded before it must not override it. */
    userEditedAt: z.iso.datetime().optional(),
});
const ledgerSchema = z.object({ revision: z.number().int().min(0), items: z.array(itemSchema) });
const fileSchema = z.object({ version: z.literal(1), ledgers: z.record(z.string(), ledgerSchema) });

export type SentinelTodoItem = z.infer<typeof itemSchema>;
export type SentinelTodoStatus = z.infer<typeof todoStatusSchema>;
export type SentinelTodoActor = z.infer<typeof actorSchema>;
export type SentinelTodoLedger = z.infer<typeof ledgerSchema>;
export type SentinelTodoOwner = { workspaceId: string; processId: string };
export type SentinelTodoJobLink = z.infer<typeof jobLinkSchema>;
export type SentinelTodoJobResult = z.infer<typeof jobResultSchema>;
export type SentinelTodoJobLinkInput = Omit<SentinelTodoJobLink, 'linkedAt' | 'result'>;

export const todoCreateSchema = z.object({
    title: itemSchema.shape.title,
    completionCondition: itemSchema.shape.completionCondition.optional(),
    notes: itemSchema.shape.notes.optional(),
    targetRepo: targetRepoSchema.optional(),
    status: todoStatusSchema.optional(),
    statusReason: itemSchema.shape.statusReason,
}).strict();
/** `null` clears an optional field; omitted fields are left unchanged. */
export const todoPatchSchema = z.object({
    title: itemSchema.shape.title.optional(),
    completionCondition: itemSchema.shape.completionCondition.optional(),
    notes: itemSchema.shape.notes.optional(),
    targetRepo: targetRepoSchema.nullable().optional(),
    status: todoStatusSchema.optional(),
    statusReason: itemSchema.shape.statusReason.nullable(),
    outcome: z.string().min(1).max(4_000).nullable().optional(),
    archived: z.boolean().optional(),
}).strict();
export type SentinelTodoCreate = z.infer<typeof todoCreateSchema>;
/**
 * Statuses an automated actor may only set with a reviewed reason. A person
 * (`user`, only ever assigned by the REST route) may mark Done without one.
 */
const REVIEW_REASON_REQUIRED: ReadonlySet<SentinelTodoStatus> = new Set(['done', 'needs_attention']);
export type SentinelTodoPatch = z.infer<typeof todoPatchSchema>;

export class SentinelTodoError extends Error {
    constructor(
        readonly code: 'not_found' | 'conflict' | 'invalid' | 'limit',
        message: string,
        /** For conflicts: the accepted current version the caller must reload. */
        readonly current?: SentinelTodoItem,
    ) {
        super(message);
    }
}

type FileShape = z.infer<typeof fileSchema>;

/**
 * Per-workspace ledger file, partitioned by parent Sentinel process ID.
 * Every mutation is a synchronous read-modify-atomic-rename, so writes to one
 * ledger are serialized and a failed write never changes the accepted state.
 * Item revisions reject stale writers instead of overwriting newer edits.
 */
export class SentinelTodoStore {
    constructor(
        private readonly dataDir: string,
        private readonly write: (file: string, data: unknown) => void = atomicWriteJsonUnique,
    ) {}

    get(owner: SentinelTodoOwner): SentinelTodoLedger {
        return this.read(owner.workspaceId).ledgers[owner.processId] ?? { revision: 0, items: [] };
    }

    /** Retried creation with the same idempotency key returns the original item. */
    create(
        owner: SentinelTodoOwner,
        input: SentinelTodoCreate,
        opts: { actor: SentinelTodoActor; idempotencyKey?: string },
    ): { item: SentinelTodoItem; created: boolean; ledgerRevision: number } {
        const data = this.read(owner.workspaceId);
        const ledger = data.ledgers[owner.processId] ?? { revision: 0, items: [] };
        const replay = opts.idempotencyKey
            ? ledger.items.find(item => item.idempotencyKey === opts.idempotencyKey) : undefined;
        if (replay) return { item: replay, created: false, ledgerRevision: ledger.revision };
        if (ledger.items.length >= MAX_TODO_ITEMS) {
            throw new SentinelTodoError('limit', `A ledger holds at most ${MAX_TODO_ITEMS} items`);
        }
        const now = new Date().toISOString();
        const fields = parse(todoCreateSchema, input);
        assertReviewReason(opts.actor, fields.status, fields.statusReason);
        const item = parse(itemSchema, {
            id: randomUUID(),
            title: fields.title,
            completionCondition: fields.completionCondition ?? '',
            notes: fields.notes ?? '',
            ...(fields.targetRepo ? { targetRepo: fields.targetRepo } : {}),
            status: fields.status ?? 'todo',
            ...(fields.statusReason ? { statusReason: fields.statusReason } : {}),
            archived: false,
            revision: 1,
            createdAt: now,
            updatedAt: now,
            createdBy: opts.actor,
            updatedBy: opts.actor,
            ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
        });
        ledger.items.push(item);
        ledger.revision += 1;
        data.ledgers[owner.processId] = ledger;
        this.save(owner.workspaceId, data);
        return { item, created: true, ledgerRevision: ledger.revision };
    }

    /** Applies a patch only when `expectedRevision` matches the accepted item. */
    update(
        owner: SentinelTodoOwner,
        itemId: string,
        expectedRevision: number,
        patch: SentinelTodoPatch,
        actor: SentinelTodoActor,
    ): { item: SentinelTodoItem; ledgerRevision: number } {
        const fields = parse(todoPatchSchema, patch);
        assertReviewReason(actor, fields.status, fields.statusReason);
        const data = this.read(owner.workspaceId);
        const ledger = data.ledgers[owner.processId];
        const index = ledger?.items.findIndex(item => item.id === itemId) ?? -1;
        if (!ledger || index < 0) throw new SentinelTodoError('not_found', `To-do item ${itemId} not found`);
        const current = ledger.items[index];
        if (current.revision !== expectedRevision) {
            throw new SentinelTodoError('conflict', 'The item changed since it was loaded', current);
        }
        const now = new Date().toISOString();
        const next: Record<string, unknown> = { ...current };
        for (const key of ['title', 'completionCondition', 'notes', 'status', 'archived'] as const) {
            if (fields[key] !== undefined) next[key] = fields[key];
        }
        for (const key of ['targetRepo', 'statusReason'] as const) {
            if (fields[key] === null) delete next[key];
            else if (fields[key] !== undefined) next[key] = fields[key];
        }
        // A status change without a fresh reason must not keep the old one.
        if (fields.status !== undefined && fields.status !== current.status && fields.statusReason === undefined) {
            delete next.statusReason;
        }
        // A new Done without a fresh outcome must not show an earlier review as this one's.
        if (fields.status === 'done' && current.status !== 'done' && fields.outcome === undefined) {
            delete next.outcome;
        }
        if (fields.outcome === null) delete next.outcome;
        else if (fields.outcome !== undefined) next.outcome = { summary: fields.outcome, recordedAt: now, recordedBy: actor };
        if (actor === 'user') next.userEditedAt = now;
        return this.commit(owner, data, ledger, index, next, actor, now);
    }

    /**
     * Links an admitted job to an item and marks the item in progress.
     * Relinking the same job is a no-op, so a retried bookkeeping call is safe.
     */
    linkJob(
        owner: SentinelTodoOwner,
        itemId: string,
        input: SentinelTodoJobLinkInput,
    ): { item: SentinelTodoItem; ledgerRevision: number; changed: boolean } {
        const data = this.read(owner.workspaceId);
        const ledger = data.ledgers[owner.processId];
        const index = ledger?.items.findIndex(item => item.id === itemId) ?? -1;
        if (!ledger || index < 0) throw new SentinelTodoError('not_found', `To-do item ${itemId} not found`);
        const current = ledger.items[index];
        if (current.jobs.some(job => job.processId === input.processId && job.serverId === input.serverId)) {
            return { item: current, ledgerRevision: ledger.revision, changed: false };
        }
        if (current.jobs.length >= MAX_TODO_JOB_LINKS) {
            throw new SentinelTodoError('limit', `An item links at most ${MAX_TODO_JOB_LINKS} jobs`);
        }
        const now = new Date().toISOString();
        const next: Record<string, unknown> = {
            ...current, status: 'in_progress', jobs: [...current.jobs, { ...input, linkedAt: now }],
        };
        delete next.statusReason;
        return { ...this.commit(owner, data, ledger, index, next, 'sentinel', now), changed: true };
    }

    /**
     * Records a local job's first terminal outcome on its link. Failed,
     * cancelled, and capped outcomes move the item to Needs attention unless
     * the item is archived or done, the user edited it after the job was
     * linked, or a newer linked attempt already completed. Completion alone
     * never marks an item done. Replays return `undefined`.
     */
    recordJobResult(
        owner: SentinelTodoOwner,
        processId: string,
        result: Omit<SentinelTodoJobResult, 'recordedAt'>,
        describe: (link: SentinelTodoJobLink) => string,
    ): { item: SentinelTodoItem; ledgerRevision: number } | undefined {
        const data = this.read(owner.workspaceId);
        const ledger = data.ledgers[owner.processId];
        const index = ledger?.items.findIndex(item =>
            item.jobs.some(job => job.processId === processId && !job.serverId)) ?? -1;
        if (!ledger || index < 0) return undefined;
        const current = ledger.items[index];
        const link = current.jobs.find(job => job.processId === processId && !job.serverId)!;
        if (link.result) return undefined;
        const now = new Date().toISOString();
        const recorded = { ...link, result: { ...result, recordedAt: now } };
        const next: Record<string, unknown> = {
            ...current, jobs: current.jobs.map(job => job === link ? recorded : job),
        };
        const supersededByUser = !!current.userEditedAt && current.userEditedAt > link.linkedAt;
        const supersededByAttempt = current.jobs.some(job =>
            job !== link && job.linkedAt > link.linkedAt && job.result?.outcome === 'completed');
        if (result.outcome !== 'completed' && !current.archived && current.status !== 'done'
            && !supersededByUser && !supersededByAttempt) {
            next.status = 'needs_attention';
            next.statusReason = describe(recorded).slice(0, 2_000);
        }
        return this.commit(owner, data, ledger, index, next, 'system', now);
    }

    private commit(
        owner: SentinelTodoOwner,
        data: FileShape,
        ledger: SentinelTodoLedger,
        index: number,
        next: Record<string, unknown>,
        actor: SentinelTodoActor,
        now: string,
    ): { item: SentinelTodoItem; ledgerRevision: number } {
        const item = parse(itemSchema, {
            ...next, revision: ledger.items[index].revision + 1, updatedAt: now, updatedBy: actor,
        });
        ledger.items[index] = item;
        ledger.revision += 1;
        this.save(owner.workspaceId, data);
        return { item, ledgerRevision: ledger.revision };
    }

    private read(workspaceId: string): FileShape {
        let raw: string;
        try {
            raw = fs.readFileSync(this.file(workspaceId), 'utf8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, ledgers: {} };
            throw error;
        }
        return fileSchema.parse(JSON.parse(raw));
    }

    private save(workspaceId: string, data: FileShape): void {
        this.write(this.file(workspaceId), data);
    }

    private file(workspaceId: string): string {
        return getRepoDataPath(this.dataDir, workspaceId, SENTINEL_TODOS_FILE);
    }
}

function assertReviewReason(actor: SentinelTodoActor, status: SentinelTodoStatus | undefined, reason: string | null | undefined): void {
    if (actor !== 'user' && status && REVIEW_REASON_REQUIRED.has(status) && !reason?.trim()) {
        throw new SentinelTodoError('invalid', `status ${status} requires a short reason`);
    }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) {
        throw new SentinelTodoError('invalid', result.error.issues.map(issue =>
            `${issue.path.join('.') || 'value'}: ${issue.message}`).join('; '));
    }
    return result.data;
}
