import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { z } from 'zod';
import { getRepoDataPath } from '../paths';
import { atomicWriteJsonUnique } from '../shared/fs-utils';

export const SENTINEL_TODOS_FILE = 'sentinel-todos.json';
export const MAX_TODO_ITEMS = 500;

const id = z.string().min(1).max(200);
export const todoStatusSchema = z.enum(['todo', 'in_progress', 'needs_attention', 'done']);
const actorSchema = z.enum(['user', 'sentinel']);
const targetRepoSchema = z.object({
    workspaceId: id, serverId: id.optional(), label: z.string().min(1).max(200).optional(),
});
const outcomeSchema = z.object({
    summary: z.string().min(1).max(4_000),
    recordedAt: z.iso.datetime(),
    recordedBy: actorSchema,
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
});
const ledgerSchema = z.object({ revision: z.number().int().min(0), items: z.array(itemSchema) });
const fileSchema = z.object({ version: z.literal(1), ledgers: z.record(z.string(), ledgerSchema) });

export type SentinelTodoItem = z.infer<typeof itemSchema>;
export type SentinelTodoStatus = z.infer<typeof todoStatusSchema>;
export type SentinelTodoActor = z.infer<typeof actorSchema>;
export type SentinelTodoLedger = z.infer<typeof ledgerSchema>;
export type SentinelTodoOwner = { workspaceId: string; processId: string };

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
        if (fields.outcome === null) delete next.outcome;
        else if (fields.outcome !== undefined) next.outcome = { summary: fields.outcome, recordedAt: now, recordedBy: actor };
        const item = parse(itemSchema, { ...next, revision: current.revision + 1, updatedAt: now, updatedBy: actor });
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

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) {
        throw new SentinelTodoError('invalid', result.error.issues.map(issue =>
            `${issue.path.join('.') || 'value'}: ${issue.message}`).join('; '));
    }
    return result.data;
}
