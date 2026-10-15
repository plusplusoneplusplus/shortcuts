import { randomUUID } from 'node:crypto';
import type { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { z } from 'zod';
import type { SentinelTodoDependencyEvaluation, SentinelTodoTagLibrary } from '@plusplusoneplusplus/coc-client';
import { externalReferenceSchema, externalReferencesSchema, MAX_TODO_EXTERNAL_REFERENCES } from './sentinel-todo-external-references';

export const MAX_TODO_ITEMS = 500;
export const MAX_TODO_JOB_LINKS = 50;
export const MAX_TODO_REFERENCES = 20;
export const MAX_TODO_DEPENDENCIES = 50;
export const MAX_TODO_TAGS = 50;
const tagIdsSchema = z.array(z.string().min(1).max(200)).max(MAX_TODO_TAGS)
    .refine(ids => new Set(ids).size === ids.length, 'Duplicate tag IDs');
const tagMatchSchema = z.object({
    state: z.enum(['matched', 'no_match', 'unavailable', 'failed']),
    message: z.string().max(1_000).optional(),
}).strict();
const tagWriteSchema = z.object({
    expectedRevision: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(80),
    color: z.enum(['gray', 'blue', 'violet', 'teal', 'amber']),
    description: z.string().trim().max(1_000).optional(),
}).strict();
const tagDeleteSchema = z.object({
    expectedRevision: z.number().int().nonnegative(), confirmed: z.literal(true),
}).strict();

const id = z.string().min(1).max(200);
export const todoTypeSchema = z.enum(['normal', 'manual']);
export const todoStatusSchema = z.enum(['todo', 'in_progress', 'needs_attention', 'done']);
/** Ledger metadata only, independent of status; it never affects job queue priority. */
export const todoPrioritySchema = z.enum(['high', 'regular']);
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
    reviewed: z.object({ recordedAt: z.iso.datetime(), recordedBy: actorSchema }).optional(),
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
    linkedRevision: z.number().int().min(1),
    result: jobResultSchema.optional(),
    specReady: z.object({ eventId: id, recordedAt: z.iso.datetime() }).optional(),
});
/**
 * A reference-only link from an item to an existing local conversation
 * (design notes, specs, prior discussion). It carries no execution state, is
 * never reviewed, and never changes the item's status.
 */
const referenceSchema = z.object({
    kind: z.literal('conversation').optional(),
    processId: id,
    workspaceId: id,
    openLink: z.string().min(1).max(2_000),
    title: z.string().max(200).optional(),
    attachedAt: z.iso.datetime(),
    attachedBy: actorSchema,
});
export const todoDependencySchema = z.object({
    itemId: id,
    condition: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('done') }).strict(),
        z.object({ kind: z.literal('pr_merge'), outputSlot: id }).strict(),
        z.object({
            kind: z.literal('accepted_artifact'), phase: id,
            reference: z.string().min(1).max(2_000), version: id,
        }).strict(),
    ]),
}).strict();
const dependenciesSchema = z.array(todoDependencySchema).max(MAX_TODO_DEPENDENCIES);
const evidenceText = z.string().trim().min(1).max(200);
export const prBindingInputSchema = z.object({
    expectedRevision: z.number().int().positive(),
    outputSlot: evidenceText,
    prUrl: z.string().trim().min(1).max(2_000),
    provenance: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('tracked_job'), processId: evidenceText, workspaceId: evidenceText, reason: z.string().trim().min(1).max(2_000) }).strict(),
        z.object({ kind: z.literal('owner_selection'), reason: z.string().trim().min(1).max(2_000) }).strict(),
    ]),
}).strict();
export const artifactAcceptanceInputSchema = z.object({
    expectedRevision: z.number().int().positive(),
    phase: evidenceText,
    reference: z.string().min(1).max(2_000),
    version: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();
const evidenceAttributionSchema = {
    receiptId: evidenceText, recordedRevision: z.number().int().positive(),
    recordedAt: z.iso.datetime(), recordedBy: z.enum(['user', 'sentinel']),
};
const evidenceSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('pr_binding'), ...evidenceAttributionSchema,
        outputSlot: evidenceText,
        pr: z.object({
            provider: z.enum(['github', 'ado']), host: evidenceText, repoPath: z.string().min(1).max(2_000),
            number: z.number().int().positive(), url: z.string().min(1).max(2_000),
        }).strict(),
        provenance: prBindingInputSchema.shape.provenance,
    }).strict(),
    z.object({
        kind: z.literal('artifact_acceptance'), ...evidenceAttributionSchema,
        phase: evidenceText, reference: artifactAcceptanceInputSchema.shape.reference,
        version: artifactAcceptanceInputSchema.shape.version, workspaceId: evidenceText,
    }).strict(),
]);
export type SentinelTodoEvidence = z.infer<typeof evidenceSchema>;
const itemSchema = z.object({
    tagRevision: z.number().int().nonnegative().optional(),
    tagIds: tagIdsSchema.optional(),
    tagOrigin: z.enum(['manual', 'suggested']).optional(),
    tagMatch: tagMatchSchema.optional(),
    id,
    type: todoTypeSchema,
    title: z.string().trim().min(1).max(200),
    completionCondition: z.string().max(1_000),
    notes: z.string().max(8_000),
    targetRepo: targetRepoSchema.optional(),
    status: todoStatusSchema,
    statusReason: z.string().min(1).max(2_000).optional(),
    priority: todoPrioritySchema,
    outcome: outcomeSchema.optional(),
    archived: z.boolean(),
    revision: z.number().int().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    createdBy: actorSchema,
    updatedBy: actorSchema,
    idempotencyKey: id.optional(),
    jobs: z.array(jobLinkSchema).max(MAX_TODO_JOB_LINKS),
    references: z.array(z.union([referenceSchema, externalReferenceSchema])).max(MAX_TODO_REFERENCES + MAX_TODO_EXTERNAL_REFERENCES),
    dependsOn: dependenciesSchema.default([]),
    evidence: z.array(evidenceSchema).default([]),
    /** Last user edit; job outcomes recorded before it must not override it. */
    userEditedAt: z.iso.datetime().optional(),
    /** Explicit user verdicts protect against reviews of already-linked work. */
    userVerdictRevision: z.number().int().min(1).optional(),
});
const ledgerSchema = z.object({ revision: z.number().int().min(0), items: z.array(itemSchema) });

export type SentinelTodoItem = z.infer<typeof itemSchema>;
export type SentinelTodoType = z.infer<typeof todoTypeSchema>;
export type SentinelTodoStatus = z.infer<typeof todoStatusSchema>;
export type SentinelTodoPriority = z.infer<typeof todoPrioritySchema>;
export type SentinelTodoActor = z.infer<typeof actorSchema>;
export type SentinelTodoLedger = z.infer<typeof ledgerSchema>;
export type SentinelTodoOwner = { workspaceId: string; processId: string };
export type SentinelTodoJobLink = z.infer<typeof jobLinkSchema>;
export type SentinelTodoJobResult = z.infer<typeof jobResultSchema>;
export type SentinelTodoJobLinkInput = Omit<SentinelTodoJobLink, 'linkedAt' | 'linkedRevision' | 'result' | 'specReady'>;
export type SentinelTodoReference = z.infer<typeof referenceSchema>;
export type SentinelTodoReferenceInput = Omit<SentinelTodoReference, 'attachedAt' | 'attachedBy'>;
export type SentinelTodoDependency = z.infer<typeof todoDependencySchema>;

export const todoCreateSchema = z.object({
    externalReferences: externalReferencesSchema.optional(),
    tagIds: tagIdsSchema.optional(),
    matchMultiple: z.boolean().optional(),
    type: todoTypeSchema.optional(),
    title: itemSchema.shape.title,
    completionCondition: itemSchema.shape.completionCondition.optional(),
    notes: itemSchema.shape.notes.optional(),
    targetRepo: targetRepoSchema.optional(),
    status: todoStatusSchema.optional(),
    statusReason: itemSchema.shape.statusReason,
    priority: todoPrioritySchema.optional(),
}).strict();
/** `null` clears an optional field; omitted fields are left unchanged. */
export const todoPatchSchema = z.object({
    externalReferences: externalReferencesSchema.optional(),
    expectedTagRevision: z.number().int().nonnegative().optional(),
    tagIds: tagIdsSchema.optional(),
    matchMultiple: z.boolean().optional(),
    title: itemSchema.shape.title.optional(),
    completionCondition: itemSchema.shape.completionCondition.optional(),
    notes: itemSchema.shape.notes.optional(),
    targetRepo: targetRepoSchema.nullable().optional(),
    status: todoStatusSchema.optional(),
    statusReason: itemSchema.shape.statusReason.nullable(),
    priority: todoPrioritySchema.optional(),
    outcome: z.string().min(1).max(4_000).nullable().optional(),
    archived: z.boolean().optional(),
    /** Exact terminal evidence assessed by this verdict; unrelated edits never acknowledge results. */
    reviewedJobs: z.array(z.object({ processId: id, terminalEventId: id }).strict()).min(1).max(MAX_TODO_JOB_LINKS).optional(),
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

/**
 * Owner-scoped ledgers in the shared processes database. SQLite serializes
 * writers before they read; item and ledger revisions protect accepted state.
 * The caller owns the database lifetime.
 */
export class SentinelTodoStore {
    getTags(owner: SentinelTodoOwner): SentinelTodoTagLibrary {
        assertOwner(owner);
        const row = this.db.prepare(`SELECT revision, tags FROM sentinel_todo_tag_libraries
            WHERE workspace_id = ? AND parent_process_id = ?`)
            .get<{ revision: number; tags: string }>(owner.workspaceId, owner.processId);
        return row ? { revision: row.revision, tags: JSON.parse(row.tags) } : { revision: 0, tags: [] };
    }

    writeTag(owner: SentinelTodoOwner, tagId: string | undefined, input: unknown): SentinelTodoTagLibrary {
        const body = parse(tagWriteSchema, input);
        return this.mutate(owner, () => {
            const library = this.getTags(owner);
            if (library.revision !== body.expectedRevision) throw new SentinelTodoError('conflict', 'The tag library changed; reload it');
            const index = tagId === undefined ? -1 : library.tags.findIndex(tag => tag.id === tagId);
            if (tagId !== undefined && index < 0) throw new SentinelTodoError('not_found', 'Tag not found');
            if (library.tags.some(tag => tag.id !== tagId && tag.name.toLowerCase() === body.name.toLowerCase())) {
                throw new SentinelTodoError('invalid', 'Tag names must be unique, ignoring case');
            }
            if (tagId === undefined && library.tags.length >= MAX_TODO_TAGS) throw new SentinelTodoError('limit', `At most ${MAX_TODO_TAGS} tags per ledger`);
            const tag = { id: tagId ?? randomUUID(), name: body.name, color: body.color,
                ...(body.description ? { description: body.description } : {}) };
            if (index < 0) library.tags.push(tag);
            else library.tags[index] = tag;
            return this.saveTagLibrary(owner, library);
        }, false);
    }

    deleteTag(owner: SentinelTodoOwner, tagId: string, input: unknown): SentinelTodoTagLibrary {
        const body = parse(tagDeleteSchema, input);
        return this.mutate(owner, () => {
            const library = this.getTags(owner);
            if (library.revision !== body.expectedRevision) throw new SentinelTodoError('conflict', 'The tag library changed; reload it');
            if (!library.tags.some(tag => tag.id === tagId)) throw new SentinelTodoError('not_found', 'Tag not found');
            library.tags = library.tags.filter(tag => tag.id !== tagId);
            const ledger = this.read(owner);
            for (let index = 0; index < ledger.items.length; index++) {
                const item = ledger.items[index];
                if (!item.tagIds?.includes(tagId)) continue;
                // A removed tag cannot turn a manual selection (including empty) into an automatic one.
                const next = { ...item, tagIds: item.tagIds.filter(id => id !== tagId) };
                delete next.tagMatch;
                const result = this.commit(owner, ledger, index, next, 'system', item.updatedAt, true);
                ledger.items[index] = result.item;
                ledger.revision = result.ledgerRevision;
            }
            return this.saveTagLibrary(owner, library);
        }, false);
    }

    setSuggestedTags(owner: SentinelTodoOwner, itemId: string, expectedRevision: number, libraryRevision: number, expectedTagRevision: number,
        metadata: { tagIds: string[]; tagMatch: z.infer<typeof tagMatchSchema> }, confirmed = false) {
        return this.mutate(owner, () => {
            const ledger = this.read(owner);
            const index = ledger.items.findIndex(item => item.id === itemId);
            if (index < 0) throw new SentinelTodoError('not_found', 'To-do item not found');
            const item = ledger.items[index];
            if (item.revision !== expectedRevision || (item.tagRevision ?? 0) !== expectedTagRevision
                || this.getTags(owner).revision !== libraryRevision) {
                throw new SentinelTodoError('conflict', 'The item or tag library changed during classification', item);
            }
            if (item.tagOrigin === 'manual' && !confirmed) throw new SentinelTodoError('invalid', 'Confirm replacing manual tag assignments');
            this.validateTagIds(owner, metadata.tagIds);
            const failed = metadata.tagMatch.state === 'failed' || metadata.tagMatch.state === 'unavailable';
            const next = failed ? { ...item, tagMatch: metadata.tagMatch }
                : { ...item, ...metadata, tagOrigin: 'suggested' };
            return this.commit(owner, ledger, index, next,
                'system', item.updatedAt, true);
        }, false);
    }

    private saveTagLibrary(owner: SentinelTodoOwner, library: SentinelTodoTagLibrary): SentinelTodoTagLibrary {
        this.db.prepare(`INSERT INTO sentinel_todo_ledgers VALUES (?, ?, 0) ON CONFLICT DO NOTHING`)
            .run(owner.workspaceId, owner.processId);
        const next = { ...library, revision: library.revision + 1 };
        this.db.prepare(`INSERT INTO sentinel_todo_tag_libraries VALUES (?, ?, ?, ?)
            ON CONFLICT (workspace_id, parent_process_id) DO UPDATE SET revision = excluded.revision, tags = excluded.tags`)
            .run(owner.workspaceId, owner.processId, next.revision, JSON.stringify(next.tags));
        return next;
    }

    private validateTagIds(owner: SentinelTodoOwner, ids: string[]): void {
        parse(tagIdsSchema, ids);
        const library = this.getTags(owner);
        if (ids.some(id => !library.tags.some(tag => tag.id === id))) {
            throw new SentinelTodoError('invalid', 'Tag IDs must belong to this parent ledger');
        }
    }

    private writeTags(owner: SentinelTodoOwner, item: SentinelTodoItem): void {
        if (item.tagIds === undefined && item.tagOrigin === undefined && item.tagMatch === undefined) return;
        this.db.prepare(`INSERT INTO sentinel_todo_tag_assignments VALUES (?, ?, ?, ?)
            ON CONFLICT (workspace_id, parent_process_id, item_id) DO UPDATE SET metadata = excluded.metadata`)
            .run(owner.workspaceId, owner.processId, item.id, JSON.stringify({
                tagIds: item.tagIds, tagOrigin: item.tagOrigin, tagMatch: item.tagMatch, tagRevision: item.tagRevision,
            }));
    }

    constructor(private readonly db: NativeDatabase) {
        db.transaction(() => db.exec(`
            CREATE TABLE IF NOT EXISTS sentinel_todo_ledgers (
                workspace_id TEXT NOT NULL,
                parent_process_id TEXT NOT NULL,
                revision INTEGER NOT NULL CHECK (revision >= 0),
                PRIMARY KEY (workspace_id, parent_process_id)
            );
            CREATE TABLE IF NOT EXISTS sentinel_todo_items (
                workspace_id TEXT NOT NULL,
                parent_process_id TEXT NOT NULL,
                id TEXT NOT NULL,
                item_order INTEGER NOT NULL CHECK (item_order >= 0),
                type TEXT NOT NULL CHECK (type IN ('normal', 'manual')),
                title TEXT NOT NULL,
                completion_condition TEXT NOT NULL,
                notes TEXT NOT NULL,
                target_repo TEXT,
                status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'needs_attention', 'done')),
                status_reason TEXT,
                priority TEXT NOT NULL CHECK (priority IN ('high', 'regular')),
                outcome TEXT,
                archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
                revision INTEGER NOT NULL CHECK (revision >= 1),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                created_by TEXT NOT NULL CHECK (created_by IN ('user', 'sentinel')),
                updated_by TEXT NOT NULL CHECK (updated_by IN ('user', 'sentinel', 'system')),
                idempotency_key TEXT,
                user_edited_at TEXT,
                user_verdict_revision INTEGER,
                PRIMARY KEY (workspace_id, parent_process_id, id),
                UNIQUE (workspace_id, parent_process_id, item_order),
                FOREIGN KEY (workspace_id, parent_process_id)
                    REFERENCES sentinel_todo_ledgers (workspace_id, parent_process_id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS sentinel_todo_tag_libraries (
                workspace_id TEXT NOT NULL,
                parent_process_id TEXT NOT NULL,
                revision INTEGER NOT NULL,
                tags TEXT NOT NULL,
                PRIMARY KEY (workspace_id, parent_process_id),
                FOREIGN KEY (workspace_id, parent_process_id)
                    REFERENCES sentinel_todo_ledgers (workspace_id, parent_process_id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS sentinel_todo_tag_assignments (
                workspace_id TEXT NOT NULL,
                parent_process_id TEXT NOT NULL,
                item_id TEXT NOT NULL,
                metadata TEXT NOT NULL,
                PRIMARY KEY (workspace_id, parent_process_id, item_id),
                FOREIGN KEY (workspace_id, parent_process_id, item_id)
                    REFERENCES sentinel_todo_items (workspace_id, parent_process_id, id) ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS sentinel_todo_items_idempotency
                ON sentinel_todo_items (workspace_id, parent_process_id, idempotency_key)
                WHERE idempotency_key IS NOT NULL;
            CREATE TABLE IF NOT EXISTS sentinel_todo_jobs (
                workspace_id TEXT NOT NULL,
                parent_process_id TEXT NOT NULL,
                item_id TEXT NOT NULL,
                server_key TEXT NOT NULL,
                process_id TEXT NOT NULL,
                job_order INTEGER NOT NULL CHECK (job_order >= 0),
                job_workspace_id TEXT NOT NULL,
                server_id TEXT,
                kind TEXT NOT NULL CHECK (kind IN ('local', 'remote', 'ralph')),
                session_id TEXT,
                open_link TEXT NOT NULL,
                title TEXT,
                linked_at TEXT NOT NULL,
                linked_revision INTEGER NOT NULL CHECK (linked_revision >= 1),
                result TEXT,
                PRIMARY KEY (workspace_id, parent_process_id, item_id, server_key, process_id),
                UNIQUE (workspace_id, parent_process_id, item_id, job_order),
                FOREIGN KEY (workspace_id, parent_process_id, item_id)
                    REFERENCES sentinel_todo_items (workspace_id, parent_process_id, id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS sentinel_todo_jobs_process
                ON sentinel_todo_jobs (workspace_id, parent_process_id, process_id, server_key);
            CREATE INDEX IF NOT EXISTS sentinel_todo_jobs_local_process
                ON sentinel_todo_jobs (process_id, job_workspace_id)
                WHERE server_key = '' AND kind = 'local' AND session_id IS NULL;
            CREATE TABLE IF NOT EXISTS sentinel_todo_references (
                workspace_id TEXT NOT NULL,
                parent_process_id TEXT NOT NULL,
                item_id TEXT NOT NULL,
                process_id TEXT NOT NULL,
                reference_order INTEGER NOT NULL CHECK (reference_order >= 0),
                reference_workspace_id TEXT NOT NULL,
                open_link TEXT NOT NULL,
                title TEXT,
                attached_at TEXT NOT NULL,
                attached_by TEXT NOT NULL CHECK (attached_by IN ('user', 'sentinel')),
                PRIMARY KEY (workspace_id, parent_process_id, item_id, process_id),
                UNIQUE (workspace_id, parent_process_id, item_id, reference_order),
                FOREIGN KEY (workspace_id, parent_process_id, item_id)
                    REFERENCES sentinel_todo_items (workspace_id, parent_process_id, id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS sentinel_todo_dependencies (
                workspace_id TEXT NOT NULL,
                parent_process_id TEXT NOT NULL,
                item_id TEXT NOT NULL,
                prerequisite_id TEXT NOT NULL,
                edge_order INTEGER NOT NULL CHECK (edge_order >= 0),
                condition TEXT NOT NULL,
                PRIMARY KEY (workspace_id, parent_process_id, item_id, prerequisite_id),
                UNIQUE (workspace_id, parent_process_id, item_id, edge_order),
                CHECK (item_id <> prerequisite_id),
                FOREIGN KEY (workspace_id, parent_process_id, item_id)
                    REFERENCES sentinel_todo_items (workspace_id, parent_process_id, id) ON DELETE CASCADE,
                FOREIGN KEY (workspace_id, parent_process_id, prerequisite_id)
                    REFERENCES sentinel_todo_items (workspace_id, parent_process_id, id)
            );
            CREATE TABLE IF NOT EXISTS sentinel_todo_evidence (
                workspace_id TEXT NOT NULL,
                parent_process_id TEXT NOT NULL,
                item_id TEXT NOT NULL,
                evidence_key TEXT NOT NULL,
                receipt TEXT NOT NULL,
                PRIMARY KEY (workspace_id, parent_process_id, item_id, evidence_key),
                FOREIGN KEY (workspace_id, parent_process_id, item_id)
                    REFERENCES sentinel_todo_items (workspace_id, parent_process_id, id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS sentinel_todo_evaluations (
                workspace_id TEXT NOT NULL,
                parent_process_id TEXT NOT NULL,
                item_id TEXT NOT NULL,
                evaluation TEXT NOT NULL,
                PRIMARY KEY (workspace_id, parent_process_id, item_id),
                FOREIGN KEY (workspace_id, parent_process_id, item_id)
                    REFERENCES sentinel_todo_items (workspace_id, parent_process_id, id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS sentinel_todo_dependency_generations (
                workspace_id TEXT NOT NULL, parent_process_id TEXT NOT NULL, item_id TEXT NOT NULL,
                revision INTEGER NOT NULL,
                PRIMARY KEY (workspace_id, parent_process_id, item_id),
                FOREIGN KEY (workspace_id, parent_process_id, item_id)
                    REFERENCES sentinel_todo_items (workspace_id, parent_process_id, id) ON DELETE CASCADE
            );
        `))();
        db.transaction(() => {
            const columns = db.prepare('PRAGMA table_info(sentinel_todo_items)').all<{ name: string }>();
            if (!columns.some(column => column.name === 'external_references')) {
                db.exec("ALTER TABLE sentinel_todo_items ADD COLUMN external_references TEXT NOT NULL DEFAULT '[]'");
            }
        })();
    }

    get(owner: SentinelTodoOwner): SentinelTodoLedger {
        assertOwner(owner);
        return this.db.transaction(() => this.read(owner))();
    }

    /** Revalidate an external-I/O snapshot under the shared native writer mutex. */
    withCurrentEvidence<T>(owner: SentinelTodoOwner, snapshot: SentinelTodoLedger,
        read: (ledger: SentinelTodoLedger) => T): T {
        return this.mutate(owner, () => {
            const current = this.read(owner);
            if (current.revision !== snapshot.revision
                || snapshot.items.some(item => current.items.find(source => source.id === item.id)?.revision !== item.revision)) {
                throw new SentinelTodoError('conflict', 'Dependency sources changed while reading evidence');
            }

            return read(current);
        });
    }

    /** A diagnostic snapshot only; consumers must always evaluate fresh before admission. */
    recordEvaluation(owner: SentinelTodoOwner, snapshot: SentinelTodoLedger,
        evaluate: (ledger: SentinelTodoLedger) => SentinelTodoDependencyEvaluation): SentinelTodoDependencyEvaluation {
        return this.withCurrentEvidence(owner, snapshot, ledger => {
            const evaluation = evaluate(ledger);
            this.db.prepare(`INSERT INTO sentinel_todo_evaluations
                (workspace_id, parent_process_id, item_id, evaluation) VALUES (?, ?, ?, ?)
                ON CONFLICT (workspace_id, parent_process_id, item_id) DO UPDATE SET evaluation = excluded.evaluation`)
                .run(owner.workspaceId, owner.processId, evaluation.itemId, JSON.stringify(evaluation));
            return evaluation;
        });
    }

    recordEvidence(owner: SentinelTodoOwner, itemId: string, expectedRevision: number,
        key: string, receipt: SentinelTodoEvidence, actor: SentinelTodoActor,
        validate: () => void): { item: SentinelTodoItem; ledgerRevision: number } {
        assertCaller(actor);
        const evidence = parse(evidenceSchema, receipt);
        if (evidence.recordedBy !== actor) throw new SentinelTodoError('invalid', 'Evidence attribution must match the validated actor');
        if (evidence.recordedRevision !== expectedRevision + 1) {
            throw new SentinelTodoError('invalid', 'Evidence recording revision must match the committing item revision');
        }
        return this.mutate(owner, () => {
            const ledger = this.read(owner);
            const index = ledger.items.findIndex(item => item.id === itemId);
            if (index < 0) throw new SentinelTodoError('not_found', 'To-do item not found');
            const current = ledger.items[index];
            if (current.revision !== expectedRevision) throw new SentinelTodoError('conflict', 'The item changed since it was loaded', current);
            if (current.archived) throw new SentinelTodoError('invalid', 'Archived items cannot accept evidence');
            validate();
            this.db.prepare(`INSERT INTO sentinel_todo_evidence
                (workspace_id, parent_process_id, item_id, evidence_key, receipt) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (workspace_id, parent_process_id, item_id, evidence_key) DO UPDATE SET receipt = excluded.receipt`)
                .run(owner.workspaceId, owner.processId, itemId, key, JSON.stringify(evidence));
            const committed = this.commit(owner, ledger, index, current, actor, new Date().toISOString());
            return { ...committed, item: this.read(owner).items[index] };
        });
    }

    /** Retried creation with the same idempotency key returns the original item. */
    create(
        owner: SentinelTodoOwner,
        input: SentinelTodoCreate,
        opts: { actor: SentinelTodoActor; idempotencyKey?: string },
    ): { item: SentinelTodoItem; created: boolean; ledgerRevision: number } {
        assertCaller(opts.actor);
        if (opts.idempotencyKey !== undefined) parse(id, opts.idempotencyKey);
        return this.mutate(owner, () => {
            const ledger = this.read(owner);
            const replay = opts.idempotencyKey
                ? ledger.items.find(item => item.idempotencyKey === opts.idempotencyKey) : undefined;
            if (replay) return { item: replay, created: false, ledgerRevision: ledger.revision };
            if (ledger.items.length >= MAX_TODO_ITEMS) {
                throw new SentinelTodoError('limit', `A ledger holds at most ${MAX_TODO_ITEMS} items`);
            }
            const now = new Date().toISOString();
            const fields = parse(todoCreateSchema, input);
            if (fields.tagIds !== undefined) this.validateTagIds(owner, fields.tagIds);
            assertReviewReason(opts.actor, fields.status, fields.statusReason);
            const item = parse(itemSchema, {
                id: randomUUID(),
                type: fields.type ?? 'normal',
                title: fields.title,
                completionCondition: fields.completionCondition ?? '',
                notes: fields.notes ?? '',
                ...(fields.targetRepo ? { targetRepo: fields.targetRepo } : {}),
                status: fields.status ?? 'todo',
                ...(fields.statusReason ? { statusReason: fields.statusReason } : {}),
                priority: fields.priority ?? 'regular',
                archived: false,
                revision: 1,
                createdAt: now,
                updatedAt: now,
                createdBy: opts.actor,
                updatedBy: opts.actor,
                jobs: [],
                references: fields.externalReferences ?? [],
                ...(fields.tagIds !== undefined ? { tagIds: fields.tagIds, tagOrigin: 'manual', tagRevision: 1 } : {}),
                ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
            });
            this.db.prepare(`INSERT INTO sentinel_todo_ledgers (workspace_id, parent_process_id, revision)
                VALUES (?, ?, 0) ON CONFLICT DO NOTHING`).run(owner.workspaceId, owner.processId);
            this.insertItem(owner, item, ledger.items.length);
            this.writeTags(owner, item);
            this.advanceLedger(owner, ledger.revision);
            return { item, created: true, ledgerRevision: ledger.revision + 1 };
        });
    }

    /** Internal graph command; callers must gate authoring and prove the Sentinel owner. */
    setDependencies(
        owner: SentinelTodoOwner,
        itemId: string,
        expectedRevision: number,
        dependencies: SentinelTodoDependency[],
        actor: SentinelTodoActor,
    ): { item: SentinelTodoItem; ledgerRevision: number } {
        assertCaller(actor);
        const edges = parse(dependenciesSchema, dependencies);
        return this.mutate(owner, () => {
            const ledger = this.read(owner);
            const index = ledger.items.findIndex(item => item.id === itemId);
            if (index < 0) throw new SentinelTodoError('not_found', 'To-do item not found');
            const current = ledger.items[index];
            if (current.revision !== expectedRevision) {
                throw new SentinelTodoError('conflict', 'The item changed since it was loaded', current);
            }
            const items = new Map(ledger.items.map(item => [item.id, item]));
            const selected = new Set<string>();
            for (const edge of edges) {
                if (edge.itemId === itemId || selected.has(edge.itemId)) {
                    throw new SentinelTodoError('invalid', 'Dependencies cannot contain self-edges or duplicate prerequisites');
                }
                const prerequisite = items.get(edge.itemId);
                if (!prerequisite || prerequisite.archived) {
                    throw new SentinelTodoError('invalid', 'Prerequisite unavailable in this parent ledger');
                }
                selected.add(edge.itemId);
            }
            // Only this item's outgoing edges change; any new cycle must return to it.
            const pending = [...selected];
            const visited = new Set<string>();
            while (pending.length) {
                const next = pending.pop()!;
                if (next === itemId) throw new SentinelTodoError('invalid', 'Dependencies cannot contain cycles');
                if (visited.has(next)) continue;
                visited.add(next);
                for (const edge of items.get(next)?.dependsOn ?? []) pending.push(edge.itemId);
            }
            this.db.prepare(`DELETE FROM sentinel_todo_dependencies
                WHERE workspace_id = ? AND parent_process_id = ? AND item_id = ?`)
                .run(owner.workspaceId, owner.processId, itemId);
            const insert = this.db.prepare(`INSERT INTO sentinel_todo_dependencies
                (workspace_id, parent_process_id, item_id, prerequisite_id, edge_order, condition)
                VALUES (?, ?, ?, ?, ?, ?)`);
            edges.forEach((edge, order) => insert.run(
                owner.workspaceId, owner.processId, itemId, edge.itemId, order, JSON.stringify(edge.condition),
            ));
            const result = this.commit(owner, ledger, index, { ...current, dependsOn: edges }, actor, new Date().toISOString());
            this.db.prepare(`INSERT INTO sentinel_todo_dependency_generations VALUES (?, ?, ?, ?)
                ON CONFLICT(workspace_id, parent_process_id, item_id) DO UPDATE SET revision = excluded.revision`)
                .run(owner.workspaceId, owner.processId, itemId, result.item.revision);
            return result;
        });
    }

    /** Applies a patch only when `expectedRevision` matches the accepted item. */
    update(
        owner: SentinelTodoOwner,
        itemId: string,
        expectedRevision: number,
        patch: SentinelTodoPatch,
        actor: SentinelTodoActor,
    ): { item: SentinelTodoItem; ledgerRevision: number } {
        assertCaller(actor);
        const fields = parse(todoPatchSchema, patch);
        if (fields.expectedTagRevision !== undefined && fields.tagIds === undefined) {
            throw new SentinelTodoError('invalid', 'expectedTagRevision requires tagIds');
        }
        if (fields.matchMultiple !== undefined && Object.entries(fields)
            .every(([key, value]) => value === undefined || ['matchMultiple', 'expectedTagRevision'].includes(key))) {
            throw new SentinelTodoError('invalid', 'Matching options require an item field or tagIds');
        }
        const metadataOnly = fields.tagIds !== undefined && Object.keys(fields).every(key =>
            ['tagIds', 'matchMultiple', 'expectedTagRevision'].includes(key) || fields[key as keyof SentinelTodoPatch] === undefined);
        assertReviewReason(actor, fields.status, fields.statusReason);
        return this.mutate(owner, () => {
            const ledger = this.read(owner);
            const index = ledger.items.findIndex(item => item.id === itemId);
            if (index < 0) throw new SentinelTodoError('not_found', `To-do item ${itemId} not found`);
            const current = ledger.items[index];
            if (current.revision !== expectedRevision) {
                throw new SentinelTodoError('conflict', 'The item changed since it was loaded', current);
            }
            if (current.type === 'manual' && actor !== 'user' && fields.archived !== undefined) {
                throw new SentinelTodoError('invalid', 'Only the user may archive or restore manual items');
            }
            const latestLinkedRevision = Math.max(0, ...current.jobs.map(link => link.linkedRevision));
            const changesVerdict = (fields.status !== undefined && fields.status !== current.status)
                || fields.statusReason !== undefined || fields.outcome !== undefined
                || (fields.archived !== undefined && fields.archived !== current.archived);
            if (actor !== 'user' && current.type === 'normal' && changesVerdict
                && current.jobs.some(link => !link.serverId && link.result)
                && (current.userVerdictRevision ?? 0) > latestLinkedRevision) {
                throw new SentinelTodoError('invalid', 'A newer user verdict supersedes this work; preserve it rather than applying a stale review');
            }
            const reviewedLinks = fields.reviewedJobs?.map(evidence => {
                const link = current.jobs.find(job => !job.serverId && job.kind !== 'remote' && job.processId === evidence.processId
                    && job.result?.terminalEventId === evidence.terminalEventId);
                if (current.type !== 'normal' || !link) {
                    throw new SentinelTodoError('invalid', 'Review evidence must match a local terminal result on this item');
                }
                return link;
            }) ?? [];
            if (reviewedLinks.length && (fields.status === undefined || (actor !== 'user' && !fields.statusReason?.trim()))) {
                throw new SentinelTodoError('invalid', 'Acknowledging results requires an explicit status verdict and a short reason');
            }
            if (actor !== 'user' && reviewedLinks.some(link =>
                (current.userVerdictRevision ?? 0) > link.linkedRevision)) {
                throw new SentinelTodoError('invalid', 'A newer user verdict supersedes this job; preserve it rather than applying a stale review');
            }
            if (actor !== 'user' && reviewedLinks.length && (current.archived || current.status === 'done')
                && fields.status !== current.status) {
                throw new SentinelTodoError('invalid', 'A result review cannot reopen an archived or Done item');
            }
            const now = new Date().toISOString();
            const next: Record<string, unknown> = { ...current };
            if (fields.externalReferences !== undefined) {
                next.references = [...current.references.filter(isConversationReference),
                    ...fields.externalReferences];
            }
            if (fields.tagIds !== undefined) {
                this.validateTagIds(owner, fields.tagIds);
                if (fields.expectedTagRevision === undefined) throw new SentinelTodoError('invalid', 'Tag assignments require expectedTagRevision');
                if (fields.expectedTagRevision !== (current.tagRevision ?? 0)) {
                    throw new SentinelTodoError('conflict', 'Tag assignments changed since they were loaded', current);
                }
                if (actor !== 'user' && current.tagOrigin === 'manual') {
                    throw new SentinelTodoError('invalid', 'Manual tag assignments require user confirmation to replace');
                }
                next.tagIds = fields.tagIds;
                next.tagOrigin = 'manual';
                next.tagRevision = (current.tagRevision ?? 0) + 1;
                delete next.tagMatch;
            }
            for (const key of ['title', 'completionCondition', 'notes', 'status', 'priority', 'archived'] as const) {
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
            // Priority is metadata: a priority-only edit must not supersede a linked job's result.
            if (actor === 'user' && Object.keys(fields).some(key => !['priority', 'externalReferences', 'tagIds', 'matchMultiple', 'expectedTagRevision'].includes(key) && fields[key as keyof SentinelTodoPatch] !== undefined)) {
                next.userEditedAt = now;
            }
            if (actor === 'user' && (fields.status !== undefined || fields.statusReason !== undefined
                || fields.outcome !== undefined || fields.archived !== undefined)) {
                next.userVerdictRevision = current.revision + 1;
            }
            next.jobs = current.jobs.map(link => link.result && !link.result.reviewed
                && reviewedLinks.includes(link)
                ? { ...link, result: { ...link.result, reviewed: { recordedAt: now, recordedBy: actor } } }
                : link);
            return this.commit(owner, ledger, index, next, actor, metadataOnly ? current.updatedAt : now, metadataOnly);
        }, !metadataOnly);
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
        return this.mutate(owner, () => {
            const ledger = this.read(owner);
            const index = ledger.items.findIndex(item => item.id === itemId);
            if (index < 0) throw new SentinelTodoError('not_found', `To-do item ${itemId} not found`);
            const current = ledger.items[index];
            if (current.type === 'manual') {
                throw new SentinelTodoError('invalid', 'Manual items cannot link jobs or authorize execution; ask the user for clarification');
            }
            if (current.jobs.some(job => job.processId === input.processId && job.serverId === input.serverId)) {
                return { item: current, ledgerRevision: ledger.revision, changed: false };
            }
            if (current.jobs.length >= MAX_TODO_JOB_LINKS) {
                throw new SentinelTodoError('limit', `An item links at most ${MAX_TODO_JOB_LINKS} jobs`);
            }
            const now = new Date().toISOString();
            const next: Record<string, unknown> = {
                ...current, status: 'in_progress',
                jobs: [...current.jobs, { ...input, linkedAt: now, linkedRevision: current.revision + 1 }],
            };
            delete next.statusReason;
            return { ...this.commit(owner, ledger, index, next, 'sentinel', now), changed: true };
        });
    }

    /**
     * Attaches a reference-only conversation link. Unlike {@link linkJob} it
     * never changes status, records no execution, and creates nothing to
     * review. Re-attaching the same conversation is an idempotent no-op;
     * otherwise `expectedRevision` must match the accepted item.
     */
    attachReference(
        owner: SentinelTodoOwner,
        itemId: string,
        expectedRevision: number,
        input: SentinelTodoReferenceInput,
        actor: SentinelTodoActor,
    ): { item: SentinelTodoItem; ledgerRevision: number; changed: boolean } {
        assertCaller(actor);
        const reference = parse(referenceSchema.omit({ attachedAt: true, attachedBy: true }).strict(), input);
        return this.mutate(owner, () => {
            const ledger = this.read(owner);
            const index = ledger.items.findIndex(item => item.id === itemId);
            if (index < 0) throw new SentinelTodoError('not_found', `To-do item ${itemId} not found`);
            const current = ledger.items[index];
            if (current.type === 'manual') {
                throw new SentinelTodoError('invalid', 'Conversation references attach to normal items only');
            }
            const conversations = current.references.filter(isConversationReference);
            if (conversations.some(ref => ref.processId === reference.processId)) {
                return { item: current, ledgerRevision: ledger.revision, changed: false };
            }
            if (current.revision !== expectedRevision) {
                throw new SentinelTodoError('conflict', 'The item changed since it was loaded', current);
            }
            if (conversations.length >= MAX_TODO_REFERENCES) {
                throw new SentinelTodoError('limit', `An item references at most ${MAX_TODO_REFERENCES} conversations`);
            }
            const now = new Date().toISOString();
            const next: Record<string, unknown> = {
                ...current, references: [...conversations, { ...reference, attachedAt: now, attachedBy: actor },
                    ...current.references.filter(ref => !isConversationReference(ref))],
            };
            return { ...this.commit(owner, ledger, index, next, actor, now), changed: true };
        });
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
        return this.mutate(owner, () => {
            const ledger = this.read(owner);
            const index = ledger.items.findIndex(item =>
                item.type === 'normal' && item.jobs.some(job => job.processId === processId && !job.serverId));
            if (index < 0) return undefined;
            const current = ledger.items[index];
            const link = current.jobs.find(job => job.processId === processId && !job.serverId)!;
            if (link.result) return undefined;
            const now = new Date().toISOString();
            const recorded = { ...link, result: { ...result, recordedAt: now } };
            const next: Record<string, unknown> = {
                ...current, jobs: current.jobs.map(job => job === link ? recorded : job),
            };
            const supersededByUser = (current.userVerdictRevision ?? 0) > link.linkedRevision
                || (!!current.userEditedAt && current.userEditedAt > link.linkedAt);
            const supersededByAttempt = current.jobs.slice(current.jobs.indexOf(link) + 1)
                .some(job => job.result?.outcome === 'completed');
            if (result.outcome !== 'completed' && !current.archived && current.status !== 'done'
                && !supersededByUser && !supersededByAttempt) {
                next.status = 'needs_attention';
                next.statusReason = describe(recorded).slice(0, 2_000);
            }
            return this.commit(owner, ledger, index, next, 'system', now);
        });
    }

    /**
     * Marks a normal item Done for the To-do scrubber as `system`. The caller
     * owns the authority checks; this write never records a user verdict.
     */
    recordScrubberDone(
        owner: SentinelTodoOwner,
        itemId: string,
        expectedRevision: number,
        outcome: string,
    ): { item: SentinelTodoItem; ledgerRevision: number } {
        const summary = parse(todoPatchSchema.shape.outcome.unwrap().unwrap(), outcome);
        return this.mutate(owner, () => {
            const ledger = this.read(owner);
            const index = ledger.items.findIndex(item => item.id === itemId);
            if (index < 0) throw new SentinelTodoError('not_found', `To-do item ${itemId} not found`);
            const current = ledger.items[index];
            if (current.revision !== expectedRevision) {
                throw new SentinelTodoError('conflict', 'The item changed since it was loaded', current);
            }
            if (current.type === 'manual') throw new SentinelTodoError('invalid', 'Manual items accept proposals only');
            const now = new Date().toISOString();
            const next: Record<string, unknown> = {
                ...current, status: 'done', outcome: { summary, recordedAt: now, recordedBy: 'system' },
            };
            delete next.statusReason;
            return this.commit(owner, ledger, index, next, 'system', now);
        });
    }

    /** A spec-ready milestone never consumes the execution outcome on the job link. */
    recordGrillingResult(owner: SentinelTodoOwner, processId: string, eventId: string, links: string[]):
        { item: SentinelTodoItem; ledgerRevision: number } | undefined {
        return this.mutate(owner, () => {
            const ledger = this.read(owner);
            const index = ledger.items.findIndex(item => item.type === 'normal'
                && item.jobs.some(job => job.processId === processId && !job.serverId));
            if (index < 0) return undefined;
            const current = ledger.items[index];
            const marker = `[${eventId}]`;
            const link = current.jobs.find(job => job.processId === processId)!;
            if (link.specReady) return undefined;
            const note = `\n${marker} Spec ready; awaiting implementation approval. ${links.join(' ').slice(0, 2_000)}`;
            const next: Record<string, unknown> = { ...current,
                jobs: current.jobs.map(job => job === link ? { ...job, specReady: { eventId, recordedAt: new Date().toISOString() } } : job),
                notes: current.notes.length + note.length <= 8_000 ? current.notes + note : current.notes,
            };
            const superseded = (current.userVerdictRevision ?? 0) > link.linkedRevision
                || (!!current.userEditedAt && current.userEditedAt > link.linkedAt)
                || current.jobs.indexOf(link) !== current.jobs.length - 1;
            if (!current.archived && current.status !== 'done' && !superseded) {
                next.status = 'todo';
                next.statusReason = 'Spec ready; awaiting implementation approval';
            }
            return this.commit(owner, ledger, index, next, 'system', new Date().toISOString());
        });
    }

    private commit(
        owner: SentinelTodoOwner,
        ledger: SentinelTodoLedger,
        index: number,
        next: Record<string, unknown>,
        actor: SentinelTodoActor,
        now: string,
        metadataOnly = false,
    ): { item: SentinelTodoItem; ledgerRevision: number } {
        if (metadataOnly) {
            const item = parse(itemSchema, { ...next, tagRevision: (ledger.items[index].tagRevision ?? 0) + 1 });
            this.writeTags(owner, item);
            return { item, ledgerRevision: ledger.revision };
        }
        const item = parse(itemSchema, {
            ...next, revision: ledger.items[index].revision + 1, updatedAt: now, updatedBy: actor,
        });
        const row = itemRow(owner, item);
        const changed = this.db.prepare(`UPDATE sentinel_todo_items SET
            ${ITEM_FIELDS.map(field => `${field} = @${field}`).join(', ')}
            WHERE workspace_id = @workspace_id AND parent_process_id = @parent_process_id
                AND id = @id AND revision = @expected_revision`)
            .run({ ...row, expected_revision: ledger.items[index].revision }).changes;
        if (changed !== 1) throw new SentinelTodoError('conflict', 'The item changed since it was loaded');
        this.writeJobs(owner, item);
        this.writeReferences(owner, item);
        this.writeTags(owner, item);
        this.advanceLedger(owner, ledger.revision);
        return { item, ledgerRevision: ledger.revision + 1 };
    }

    /** One transcript-free query for local linked conversations, including completed jobs. */
    getJobModeProjections(owner: SentinelTodoOwner): Map<string, { workspaceId: unknown; mode: unknown }> {
        const rows = this.db.prepare(`SELECT DISTINCT p.id,
            CASE WHEN json_valid(p.metadata) THEN json_extract(p.metadata, '$.workspaceId') END AS workspaceId,
            CASE WHEN json_valid(p.metadata) THEN json_extract(p.metadata, '$.mode') END AS mode
            FROM sentinel_todo_jobs j JOIN processes p ON p.id = j.process_id
            WHERE j.workspace_id = ? AND j.parent_process_id = ?
                AND j.server_key = '' AND j.kind = 'local' AND j.session_id IS NULL`)
            .all<{ id: string; workspaceId: unknown; mode: unknown }>(owner.workspaceId, owner.processId);
        return new Map(rows.map(row => [row.id, row]));
    }

    /** Exact local owners to invalidate when a linked conversation changes mode. */
    getJobOwners(processId: string, workspaceId: string): SentinelTodoOwner[] {
        return this.db.prepare(`SELECT DISTINCT workspace_id AS workspaceId, parent_process_id AS processId
            FROM sentinel_todo_jobs WHERE process_id = ? AND job_workspace_id = ?
                AND server_key = '' AND kind = 'local' AND session_id IS NULL`)
            .all<SentinelTodoOwner>(processId, workspaceId);
    }

    private read(owner: SentinelTodoOwner): SentinelTodoLedger {
        const scope = [owner.workspaceId, owner.processId];
        const ledger = this.db.prepare(`SELECT revision FROM sentinel_todo_ledgers
            WHERE workspace_id = ? AND parent_process_id = ?`).get<{ revision: number }>(...scope);
        if (!ledger) return { revision: 0, items: [] };
        const jobs = this.db.prepare(`SELECT * FROM sentinel_todo_jobs
            WHERE workspace_id = ? AND parent_process_id = ? ORDER BY job_order`).all<JobRow>(...scope);
        const byItem = new Map<string, SentinelTodoJobLink[]>();
        for (const row of jobs) {
            const links = byItem.get(row.item_id) ?? [];
            links.push(parse(jobLinkSchema, {
                processId: row.process_id, workspaceId: row.job_workspace_id, kind: row.kind,
                openLink: row.open_link, linkedAt: row.linked_at, linkedRevision: row.linked_revision,
                ...optional('serverId', row.server_id), ...optional('sessionId', row.session_id),
                ...optional('title', row.title), ...jobReceipts(row.result),
            }));
            byItem.set(row.item_id, links);
        }
        const references = new Map<string, SentinelTodoReference[]>();
        for (const row of this.db.prepare(`SELECT * FROM sentinel_todo_references
            WHERE workspace_id = ? AND parent_process_id = ? ORDER BY reference_order`).all<ReferenceRow>(...scope)) {
            references.set(row.item_id, [...references.get(row.item_id) ?? [], parse(referenceSchema, {
                processId: row.process_id, workspaceId: row.reference_workspace_id, openLink: row.open_link,
                attachedAt: row.attached_at, attachedBy: row.attached_by, ...optional('title', row.title),
            })]);
        }
        const dependencies = new Map<string, SentinelTodoDependency[]>();
        for (const row of this.db.prepare(`SELECT item_id, prerequisite_id, condition FROM sentinel_todo_dependencies
            WHERE workspace_id = ? AND parent_process_id = ? ORDER BY edge_order`)
            .all<{ item_id: string; prerequisite_id: string; condition: string }>(...scope)) {
            dependencies.set(row.item_id, [...dependencies.get(row.item_id) ?? [], parse(todoDependencySchema, {
                itemId: row.prerequisite_id, condition: JSON.parse(row.condition),
            })]);
        }
        const evidence = new Map<string, SentinelTodoEvidence[]>();
        for (const row of this.db.prepare(`SELECT item_id, receipt FROM sentinel_todo_evidence
            WHERE workspace_id = ? AND parent_process_id = ? ORDER BY evidence_key`)
            .all<{ item_id: string; receipt: string }>(...scope)) {
            evidence.set(row.item_id, [...evidence.get(row.item_id) ?? [], parse(evidenceSchema, JSON.parse(row.receipt))]);
        }
        const items = this.db.prepare(`SELECT * FROM sentinel_todo_items
            WHERE workspace_id = ? AND parent_process_id = ? ORDER BY item_order`).all<ItemRow>(...scope);
        const tags = new Map(this.db.prepare(`SELECT item_id, metadata FROM sentinel_todo_tag_assignments
            WHERE workspace_id = ? AND parent_process_id = ?`)
            .all<{ item_id: string; metadata: string }>(...scope).map(row => [row.item_id, JSON.parse(row.metadata)]));
        return parse(ledgerSchema, { revision: ledger.revision, items: items.map(row => ({
            ...tags.get(row.id),
            id: row.id, type: row.type, title: row.title, completionCondition: row.completion_condition,
            notes: row.notes, status: row.status, priority: row.priority, archived: row.archived === 1,
            revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
            createdBy: row.created_by, updatedBy: row.updated_by, jobs: byItem.get(row.id) ?? [],
            references: [...references.get(row.id) ?? [], ...parse(externalReferencesSchema, JSON.parse(row.external_references))],
            dependsOn: dependencies.get(row.id) ?? [],
            evidence: evidence.get(row.id) ?? [],
            ...jsonField('targetRepo', row.target_repo), ...jsonField('outcome', row.outcome),
            ...optional('statusReason', row.status_reason), ...optional('idempotencyKey', row.idempotency_key),
            ...optional('userEditedAt', row.user_edited_at), ...optional('userVerdictRevision', row.user_verdict_revision),
        })) });
    }

    private insertItem(owner: SentinelTodoOwner, item: SentinelTodoItem, order: number): void {
        const columns = ['workspace_id', 'parent_process_id', 'id', 'item_order', ...ITEM_FIELDS];
        this.db.prepare(`INSERT INTO sentinel_todo_items (${columns.join(', ')})
            VALUES (${columns.map(column => `@${column}`).join(', ')})`)
            .run({ ...itemRow(owner, item), item_order: order });
    }

    private writeJobs(owner: SentinelTodoOwner, item: SentinelTodoItem): void {
        const statement = this.db.prepare(`INSERT INTO sentinel_todo_jobs (
            workspace_id, parent_process_id, item_id, server_key, process_id, job_order,
            job_workspace_id, server_id, kind, session_id, open_link, title, linked_at, linked_revision, result
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (workspace_id, parent_process_id, item_id, server_key, process_id)
        DO UPDATE SET result = excluded.result`);
        item.jobs.forEach((job, order) => statement.run(
            owner.workspaceId, owner.processId, item.id, job.serverId ?? '', job.processId, order,
            job.workspaceId, job.serverId ?? null, job.kind, job.sessionId ?? null, job.openLink,
            job.title ?? null, job.linkedAt, job.linkedRevision, encode(job.specReady ? { execution: job.result, specReady: job.specReady } : job.result),
        ));
    }

    private writeReferences(owner: SentinelTodoOwner, item: SentinelTodoItem): void {
        const statement = this.db.prepare(`INSERT INTO sentinel_todo_references (
            workspace_id, parent_process_id, item_id, process_id, reference_order,
            reference_workspace_id, open_link, title, attached_at, attached_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (workspace_id, parent_process_id, item_id, process_id) DO NOTHING`);
        item.references.filter(isConversationReference).forEach((ref, order) => statement.run(
            owner.workspaceId, owner.processId, item.id, ref.processId, order,
            ref.workspaceId, ref.openLink, ref.title ?? null, ref.attachedAt, ref.attachedBy,
        ));
    }

    private advanceLedger(owner: SentinelTodoOwner, expectedRevision: number): void {
        const changed = this.db.prepare(`UPDATE sentinel_todo_ledgers SET revision = revision + 1
            WHERE workspace_id = ? AND parent_process_id = ? AND revision = ?`)
            .run(owner.workspaceId, owner.processId, expectedRevision).changes;
        if (changed !== 1) throw new SentinelTodoError('conflict', 'The ledger changed since it was loaded');
    }

    /** Operational invalidation commits with the ledger mutation, without changing fulfillment. */
    onDependencyMutation?: (owner: SentinelTodoOwner) => void;

    dependencyRevision(owner: SentinelTodoOwner, itemId: string): number {
        return this.db.prepare(`SELECT revision FROM sentinel_todo_dependency_generations
            WHERE workspace_id = ? AND parent_process_id = ? AND item_id = ?`)
            .get<{ revision: number }>(owner.workspaceId, owner.processId, itemId)?.revision ?? 0;
    }

    private mutate<T>(owner: SentinelTodoOwner, mutation: () => T, invalidateDependencies = true): T {
        assertOwner(owner);
        return this.db.transaction(() => {
            // Native transactions begin deferred. A zero-row write reserves the
            // SQLite writer before reads while the native mutex stays held.
            this.db.prepare('UPDATE sentinel_todo_ledgers SET revision = revision WHERE 0').run();
            const result = mutation();
            if (invalidateDependencies) this.onDependencyMutation?.(owner);
            return result;
        })();
    }
}

const ITEM_FIELDS = [
    'type', 'title', 'completion_condition', 'notes', 'target_repo', 'status', 'status_reason',
    'priority', 'outcome', 'archived', 'revision', 'created_at', 'updated_at', 'created_by',
    'updated_by', 'idempotency_key', 'user_edited_at', 'user_verdict_revision', 'external_references',
] as const;

interface ItemRow {
    id: string; type: string; title: string; completion_condition: string; notes: string;
    target_repo: string | null; status: string; status_reason: string | null; priority: string;
    outcome: string | null; archived: number; revision: number; created_at: string; updated_at: string;
    created_by: string; updated_by: string; idempotency_key: string | null; user_edited_at: string | null;
    user_verdict_revision: number | null;
    external_references: string;
}

interface ReferenceRow {
    item_id: string; process_id: string; reference_workspace_id: string; open_link: string;
    title: string | null; attached_at: string; attached_by: string;
}

interface JobRow {
    item_id: string; process_id: string; job_workspace_id: string; server_id: string | null;
    kind: string; session_id: string | null; open_link: string; title: string | null;
    linked_at: string; linked_revision: number; result: string | null;
}

function itemRow(owner: SentinelTodoOwner, item: SentinelTodoItem) {
    return {
        workspace_id: owner.workspaceId, parent_process_id: owner.processId, id: item.id,
        type: item.type, title: item.title, completion_condition: item.completionCondition, notes: item.notes,
        target_repo: encode(item.targetRepo), status: item.status, status_reason: item.statusReason ?? null,
        priority: item.priority, outcome: encode(item.outcome), archived: Number(item.archived), revision: item.revision,
        created_at: item.createdAt, updated_at: item.updatedAt, created_by: item.createdBy, updated_by: item.updatedBy,
        idempotency_key: item.idempotencyKey ?? null, user_edited_at: item.userEditedAt ?? null,
        user_verdict_revision: item.userVerdictRevision ?? null,
        external_references: JSON.stringify(item.references.filter(ref => ref.kind !== undefined && ref.kind !== 'conversation')),
    };
}

function encode(value: unknown): string | null {
    return value === undefined ? null : JSON.stringify(value);
}

function isConversationReference(reference: SentinelTodoItem['references'][number]): reference is SentinelTodoReference {
    return reference.kind === undefined || reference.kind === 'conversation';
}

function optional(key: string, value: string | number | null): Record<string, unknown> {
    return value === null ? {} : { [key]: value };
}

function jsonField(key: string, value: string | null): Record<string, unknown> {
    return value === null ? {} : { [key]: JSON.parse(value) };
}

function assertOwner(owner: SentinelTodoOwner): void {
    parse(z.object({ workspaceId: id, processId: id }).strict(), owner);
}

function assertCaller(actor: SentinelTodoActor): void {
    parse(z.enum(['user', 'sentinel']), actor);
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

function jobReceipts(value: string | null): Record<string, unknown> {
    if (!value) return {};
    const parsed = JSON.parse(value);
    return parsed.specReady ? { result: parsed.execution, specReady: parsed.specReady } : { result: parsed };
}
