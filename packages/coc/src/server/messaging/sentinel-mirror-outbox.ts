import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { initializeDatabase } from '@plusplusoneplusplus/forge';
import { getRepoDataPath } from '../paths';
import { mirrorAttachmentSchema } from './sentinel-mirror-attachments';
import { MAX_ATTACHMENT_SIZE } from '../core/attachment-utils';

/** Legacy JSON ledger; imported once per workspace and never read again after import. */
export const SENTINEL_MIRROR_OUTBOX_FILE = 'sentinel-mirror-outbox.json';
const id = z.string().min(1).refine(value => value.trim().length > 0);
const destinationSchema = z.object({
    connector: z.enum(['whatsapp', 'teams']),
    chatKey: id,
    threadId: id.optional(),
    /** The authoritative binding captured at admission, not mutable topic selection. */
    bindingId: id,
}).strict();
const intentSchema = z.object({
    workspaceId: id,
    processId: id,
    requestId: id,
    role: z.enum(['user', 'assistant']),
    destination: destinationSchema,
    content: z.string(),
    attachments: z.array(mirrorAttachmentSchema).max(10).optional(),
}).strict();
const failureSchema = z.enum(['not-attempted', 'rejected', 'unknown', 'cancelled', 'unbound', 'admission-rejected', 'attachment-invalid']);
const entrySchema = intentSchema.extend({
    eventId: id,
    createdAt: z.iso.datetime(),
    state: z.enum(['admitting', 'pending', 'sending', 'retryable', 'delivered', 'ambiguous', 'cancelled']),
    chunks: z.array(z.string().min(1)),
    outboundIds: z.array(id),
    nextPart: z.number().int().nonnegative(),
    attemptId: id.optional(),
    cancelRequested: z.boolean(),
    failure: failureSchema.optional(),
    retryCount: z.number().int().nonnegative().optional(),
    nextAttemptAt: z.iso.datetime().optional(),
    attemptedPartCount: z.number().int().nonnegative().optional(),
}).strict().refine(row =>
    row.nextPart === row.outboundIds.length
    && row.nextPart <= row.chunks.length
    && (row.attemptedPartCount === undefined || row.attemptedPartCount <= row.chunks.length)
    && (row.state === 'sending') === (row.attemptId !== undefined)
    && (row.state !== 'sending' || row.nextPart < row.chunks.length)
    && (!(row.attachments?.length) || (row.role === 'user' && row.destination.connector === 'whatsapp'
        && row.attachments.reduce((total, attachment) => total + attachment.size, 0) <= MAX_ATTACHMENT_SIZE
        && (!row.chunks.length || row.chunks.length >= row.attachments.length)))
    && (row.state !== 'delivered' || (row.chunks.length > 0 && row.nextPart === row.chunks.length)),
{ message: 'Invalid Sentinel mirror delivery progress' });

export type SentinelMirrorIntent = z.infer<typeof intentSchema>;
export type SentinelMirrorEntry = z.infer<typeof entrySchema>;
export type SentinelMirrorDestination = z.infer<typeof destinationSchema>;
export type SentinelMirrorFailure = z.infer<typeof failureSchema>;

/** Physical outbound receipt, used to restore connector echo ownership. */
export interface SentinelMirrorReceipt {
    workspaceId: string;
    eventId: string;
    partIndex: number;
    outboundId: string;
    destination: Pick<SentinelMirrorDestination, 'connector' | 'chatKey' | 'threadId'>;
}

/** Thrown when a legacy JSON ledger cannot be imported; the source file is left untouched. */
export class SentinelMirrorImportError extends Error {
    constructor(readonly workspaceId: string) {
        super('Sentinel mirror legacy ledger import failed. The original file was preserved; repair or remove it explicitly.');
    }
}

/** Immutable media captions form the final ordered parts; a negative index identifies text. */
export function mirrorAttachmentPartIndex(
    row: Pick<SentinelMirrorEntry, 'chunks' | 'attachments'>, partIndex: number,
): number {
    return partIndex - (row.chunks.length - (row.attachments?.length ?? 0));
}

function eventId(intent: Pick<SentinelMirrorIntent, 'workspaceId' | 'processId' | 'requestId' | 'role'>): string {
    return createHash('sha256').update(JSON.stringify([
        intent.workspaceId, intent.processId, intent.requestId, intent.role,
    ])).digest('hex');
}

/** One physical messaging conversation; Teams threads are separate conversations, WhatsApp quotes are not. */
export function mirrorDestinationKey(destination: SentinelMirrorDestination): string {
    return JSON.stringify([
        destination.connector, destination.chatKey,
        destination.connector === 'teams' ? destination.threadId ?? null : null,
    ]);
}

const UNFINISHED = `state NOT IN ('delivered', 'cancelled')`;
const ACTIVE_REQUEST = `(admission = 'staged' OR (admission = 'accepted' AND answer = 'awaiting'))`;
const UNREPORTED = `failure IS NOT NULL AND failure <> 'admission-rejected' AND (reported_failure IS NULL OR reported_failure <> failure)`;

interface DeliveryRow {
    event_id: string;
    workspace_id: string;
    process_id: string;
    request_id: string;
    role: string;
    connector: string;
    chat_key: string;
    thread_id: string | null;
    binding_id: string;
    content: string;
    attachments: string | null;
    chunks: string;
    state: string;
    next_part: number;
    attempt_id: string | null;
    attempted_part_count: number;
    cancel_requested: number;
    failure: string | null;
    retry_count: number | null;
    next_attempt_at: string | null;
    seq: number;
    created_at: string;
}

/**
 * Durable, owning-server mirror ledger in the shared `processes.db`.
 *
 * Requests track answer obligations; deliveries track physical message parts;
 * receipts keep confirmed outbound IDs. Every transition is one SQLite
 * transaction with its precondition checked inside it, so failed writes never
 * advance state. Active queries use partial indexes and never touch finished
 * history. Staged intents cannot send until canonical admission is confirmed;
 * network attempts without a durable acknowledgement are quarantined.
 */
export class SentinelMirrorOutbox {
    private readonly db: NativeDatabase;
    private readonly ownsDb: boolean;

    constructor(private readonly dataDir: string, db?: NativeDatabase) {
        if (db) {
            this.db = db;
            this.ownsDb = false;
        } else {
            fs.mkdirSync(dataDir, { recursive: true });
            this.db = new NativeDatabase(path.join(dataDir, 'processes.db'));
            this.ownsDb = true;
        }
        initializeDatabase(this.db);
    }

    close(): void {
        if (this.ownsDb) this.db.close();
    }

    /** Diagnostic/test view of one workspace's full ledger. Routine scheduling never calls this. */
    list(workspaceId: string): SentinelMirrorEntry[] {
        const rows = this.db.prepare('SELECT * FROM sentinel_mirror_deliveries WHERE workspace_id = ? ORDER BY seq, rowid')
            .all(workspaceId) as DeliveryRow[];
        return rows.map(row => this.toEntry(row, true));
    }

    /** Full entry, including stored attachment bytes, for the one row about to be sent. */
    get(workspaceId: string, identity: string): SentinelMirrorEntry {
        const row = this.row(workspaceId, identity);
        if (!row) throw new Error('Sentinel mirror event is unavailable in its owning workspace');
        return this.toEntry(row, true);
    }

    find(workspaceId: string, processId: string, requestId: string, role: SentinelMirrorEntry['role']): SentinelMirrorEntry | undefined {
        const row = this.row(workspaceId, eventId({ workspaceId, processId, requestId, role }));
        return row ? this.toEntry(row, false) : undefined;
    }

    /** All roles recorded for one request, in admission order. */
    request(workspaceId: string, processId: string, requestId: string): SentinelMirrorEntry[] {
        const rows = this.db.prepare(`
            SELECT * FROM sentinel_mirror_deliveries
            WHERE workspace_id = ? AND process_id = ? AND request_id = ? ORDER BY seq, rowid
        `).all(workspaceId, processId, requestId) as DeliveryRow[];
        return rows.map(row => this.toEntry(row, false));
    }

    /** Answer tracking state for one request, independent of its user delivery state. */
    requestState(workspaceId: string, processId: string, requestId: string):
        { admission: 'staged' | 'accepted' | 'rejected'; answer: 'awaiting' | 'materialized' | 'suppressed' } | undefined {
        return this.db.prepare(`
            SELECT admission, answer FROM sentinel_mirror_requests
            WHERE workspace_id = ? AND process_id = ? AND request_id = ?
        `).get(workspaceId, processId, requestId) as never;
    }

    /**
     * Unfinished requests (staged admission or awaiting answer), oldest first,
     * as their user entries without attachment bytes. Finished requests never appear.
     */
    activeRequests(afterSeq: number, limit: number): Array<SentinelMirrorEntry & { seq: number }> {
        const rows = this.db.prepare(`
            SELECT d.* FROM sentinel_mirror_requests r
            JOIN sentinel_mirror_deliveries d
              ON d.workspace_id = r.workspace_id AND d.process_id = r.process_id
             AND d.request_id = r.request_id AND d.role = 'user'
            WHERE (r.admission = 'staged' OR (r.admission = 'accepted' AND r.answer = 'awaiting')) AND r.seq > ?
            ORDER BY r.seq LIMIT ?
        `).all(afterSeq, limit) as DeliveryRow[];
        return rows.map(row => Object.assign(this.toEntry(row, false), { seq: row.seq }));
    }

    /** Unfinished deliveries with an unrecorded network attempt. */
    sending(): SentinelMirrorEntry[] {
        const rows = this.db.prepare(`
            SELECT * FROM sentinel_mirror_deliveries WHERE ${UNFINISHED} AND state = 'sending' ORDER BY seq
        `).all() as DeliveryRow[];
        return rows.map(row => this.toEntry(row, false));
    }

    /** Every unfinished delivery on one connector (binding removal). */
    unfinished(connector: SentinelMirrorDestination['connector']): SentinelMirrorEntry[] {
        const rows = this.db.prepare(`SELECT * FROM sentinel_mirror_deliveries WHERE ${UNFINISHED} AND connector = ? ORDER BY seq`)
            .all(connector) as DeliveryRow[];
        return rows.map(row => this.toEntry(row, false));
    }

    /** Failures whose fixed chat notice has not been recorded yet. */
    unreported(limit: number): SentinelMirrorEntry[] {
        const rows = this.db.prepare(`SELECT * FROM sentinel_mirror_deliveries WHERE ${UNREPORTED} ORDER BY seq LIMIT ?`)
            .all(limit) as DeliveryRow[];
        return rows.map(row => this.toEntry(row, false));
    }

    markReported(workspaceId: string, identity: string, failure: SentinelMirrorFailure): void {
        this.transact(() => {
            this.db.prepare(`
                UPDATE sentinel_mirror_deliveries SET reported_failure = ?
                WHERE workspace_id = ? AND event_id = ? AND failure = ?
            `).run(failure, workspaceId, identity, failure);
        });
    }

    /** Earliest durable retry deadline (epoch ms), if any retry is scheduled. */
    nextRetryAt(): number | undefined {
        const row = this.db.prepare(`
            SELECT MIN(next_attempt_at) AS at FROM sentinel_mirror_deliveries
            WHERE state = 'retryable' AND next_attempt_at IS NOT NULL
        `).get() as { at: string | null };
        return row.at ? Date.parse(row.at) : undefined;
    }

    /** Candidate deliveries for an echo marker; indexed by request and role. */
    echoCandidates(requestId: string, role: SentinelMirrorEntry['role'], connector: SentinelMirrorDestination['connector'], chatKey: string): SentinelMirrorEntry[] {
        const rows = this.db.prepare(`
            SELECT * FROM sentinel_mirror_deliveries
            WHERE request_id = ? AND role = ? AND connector = ? AND chat_key = ? ORDER BY seq
        `).all(requestId, role, connector, chatKey) as DeliveryRow[];
        return rows.map(row => this.toEntry(row, false));
    }

    /** Pages confirmed receipts in a stable order to restore connector echo guards. */
    receipts(afterRowId: number, limit: number): Array<SentinelMirrorReceipt & { rowId: number }> {
        const rows = this.db.prepare(`
            SELECT r.rowid AS rowid, d.workspace_id, r.event_id, r.part_index, r.outbound_id, r.connector, r.chat_key, r.thread_id
            FROM sentinel_mirror_receipts r JOIN sentinel_mirror_deliveries d ON d.event_id = r.event_id
            WHERE r.rowid > ? ORDER BY r.rowid LIMIT ?
        `).all(afterRowId, limit) as Array<{ rowid: number; workspace_id: string; event_id: string; part_index: number; outbound_id: string;
            connector: SentinelMirrorDestination['connector']; chat_key: string; thread_id: string | null }>;
        return rows.map(row => ({
            rowId: row.rowid, workspaceId: row.workspace_id, eventId: row.event_id, partIndex: row.part_index, outboundId: row.outbound_id,
            destination: { connector: row.connector, chatKey: row.chat_key, ...(row.thread_id !== null ? { threadId: row.thread_id } : {}) },
        }));
    }

    /** Only explicit, newly captured intents enter the ledger; never scan chat history. */
    stage(input: SentinelMirrorIntent): SentinelMirrorEntry {
        const intent = intentSchema.parse(input);
        const identity = eventId(intent);
        return this.transact(() => {
            const existing = this.row(intent.workspaceId, identity);
            if (existing) {
                const entry = this.toEntry(existing, true);
                if (entry.content !== intent.content
                    || JSON.stringify(entry.attachments?.map(({ data: _data, ...meta }) => meta))
                        !== JSON.stringify(intent.attachments?.map(({ data: _data, ...meta }) => meta))
                    || JSON.stringify(entry.destination) !== JSON.stringify(intent.destination)) {
                    throw new Error('Sentinel mirror event conflicts with its captured intent');
                }
                return entry;
            }
            const seq = this.nextSeq();
            this.insert(intent, identity, seq, 'admitting');
            if (intent.role === 'user') this.insertRequest(intent, seq, 'staged', 'awaiting');
            else this.materialize(intent);
            return this.toEntry(this.row(intent.workspaceId, identity)!, true);
        });
    }

    /**
     * Inserts an admitted assistant delivery and closes its request's answer
     * obligation in one transaction. A repeated completion is a no-op.
     */
    materializeAnswer(user: Pick<SentinelMirrorEntry, 'workspaceId' | 'processId' | 'requestId' | 'destination'>, content: string): SentinelMirrorEntry {
        const intent = intentSchema.parse({
            workspaceId: user.workspaceId, processId: user.processId, requestId: user.requestId,
            role: 'assistant', destination: user.destination, content,
        });
        const identity = eventId(intent);
        return this.transact(() => {
            const existing = this.row(intent.workspaceId, identity);
            if (existing) return this.toEntry(existing, false);
            this.insert(intent, identity, this.nextSeq(), 'pending');
            this.materialize(intent);
            return this.toEntry(this.row(intent.workspaceId, identity)!, false);
        });
    }

    accept(workspaceId: string, identity: string): boolean {
        return this.change(workspaceId, identity, row => {
            if (row.state !== 'admitting') return false;
            row.state = 'pending';
            return true;
        }, row => this.setAdmission(row, 'accepted'));
    }

    reject(workspaceId: string, identity: string): boolean {
        return this.change(workspaceId, identity, row => {
            if (row.state !== 'admitting') return false;
            row.state = 'cancelled';
            row.failure = 'admission-rejected';
            row.cancelRequested = true;
            return true;
        }, row => this.setAdmission(row, 'rejected'));
    }

    invalidateAttachments(workspaceId: string, identity: string): void {
        this.change(workspaceId, identity, row => {
            if (row.state !== 'pending' && row.state !== 'retryable') return false;
            row.state = 'cancelled';
            row.cancelRequested = true;
            row.failure = 'attachment-invalid';
            return true;
        });
    }

    /** Persist exact connector-formatted boundaries before the first network attempt. */
    prepare(workspaceId: string, identity: string, chunks: string[]): boolean {
        const prepared = z.array(z.string().min(1)).min(1).parse(chunks);
        return this.change(workspaceId, identity, row => {
            if (row.chunks.length) {
                if (JSON.stringify(row.chunks) !== JSON.stringify(prepared)) {
                    throw new Error('Sentinel mirror chunk boundaries cannot change');
                }
                return false;
            }
            if (row.state !== 'pending') throw new Error('Sentinel mirror event is not admitted');
            row.chunks = prepared;
            return true;
        });
    }

    /** One unresolved head per destination; ambiguous/admitting heads block later sends. */
    heads(workspaceId: string): SentinelMirrorEntry[] {
        return this.headsAcrossWorkspaces([workspaceId]);
    }

    /**
     * A physical messaging conversation can hold intents from multiple workspaces.
     * Returns one unfinished head per destination, oldest first, without attachment bytes.
     */
    headsAcrossWorkspaces(workspaceIds?: readonly string[]): SentinelMirrorEntry[] {
        return this.headRows(workspaceIds).map(row => this.toEntry(row, false));
    }

    /** The unfinished head of one physical destination, without attachment bytes. */
    destinationHead(destinationKey: string, workspaceIds?: readonly string[]): SentinelMirrorEntry | undefined {
        const row = this.headRows(workspaceIds, destinationKey)[0];
        return row ? this.toEntry(row, false) : undefined;
    }

    beginPart(workspaceId: string, identity: string, activeWorkspaceIds?: readonly string[]): string | undefined {
        if (activeWorkspaceIds && !activeWorkspaceIds.includes(workspaceId)) {
            throw new Error('Sentinel mirror owner is outside the active workspace scope');
        }
        const attempt = randomUUID();
        const changed = this.change(workspaceId, identity, row => {
            if (!this.headRows(activeWorkspaceIds, mirrorDestinationKey(row.destination)).some(head => head.event_id === identity)
                || (row.state !== 'pending' && row.state !== 'retryable')
                || (row.nextAttemptAt && Date.parse(row.nextAttemptAt) > Date.now())
                || row.chunks.length === 0) return false;
            row.state = 'sending';
            row.attemptId = attempt;
            row.attemptedPartCount = Math.max(row.attemptedPartCount ?? 0, row.nextPart + 1);
            row.failure = undefined;
            row.nextAttemptAt = undefined;
            return true;
        });
        return changed ? attempt : undefined;
    }

    acknowledgePart(workspaceId: string, identity: string, attempt: string, messageId: string): boolean {
        const outboundId = id.parse(messageId);
        let partIndex = -1;
        return this.change(workspaceId, identity, row => {
            if (row.state !== 'sending' || row.attemptId !== attempt) return false;
            partIndex = row.nextPart;
            row.outboundIds.push(outboundId);
            row.nextPart++;
            const mediaIndex = mirrorAttachmentPartIndex(row, row.nextPart - 1);
            if (mediaIndex >= 0 && row.attachments?.[mediaIndex]) delete row.attachments[mediaIndex].data;
            row.attemptId = undefined;
            row.state = row.cancelRequested ? 'cancelled'
                : row.nextPart === row.chunks.length ? 'delivered' : 'pending';
            return true;
        }, row => {
            this.db.prepare(`
                INSERT INTO sentinel_mirror_receipts
                    (event_id, part_index, outbound_id, connector, chat_key, thread_id, acknowledged_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(identity, partIndex, outboundId, row.destination.connector, row.destination.chatKey,
                row.destination.threadId ?? null, new Date().toISOString());
        });
    }

    failPart(
        workspaceId: string, identity: string, attempt: string,
        outcome: 'not-attempted' | 'rejected' | 'unknown', retryAfterMs?: number,
    ): boolean {
        return this.change(workspaceId, identity, row => {
            if (row.state !== 'sending' || row.attemptId !== attempt) return false;
            row.attemptId = undefined;
            row.failure = outcome;
            row.state = outcome === 'unknown' ? 'ambiguous' : row.cancelRequested ? 'cancelled' : 'retryable';
            if (row.state === 'retryable' && retryAfterMs !== undefined) {
                if (!Number.isFinite(retryAfterMs) || retryAfterMs < 0) throw new Error('Invalid Sentinel mirror retry delay');
                row.retryCount = (row.retryCount ?? 0) + 1;
                const delay = Math.max(Math.min(retryAfterMs, 2_147_483_647),
                    Math.min(60_000, 1_000 * 2 ** Math.min(row.retryCount - 1, 6)));
                row.nextAttemptAt = new Date(Date.now() + delay).toISOString();
            }
            return true;
        });
    }

    /**
     * Cancels unsent parts and suppresses unanswered requests for one process,
     * optionally narrowed to one binding/request. Captured owners never change.
     */
    cancel(
        workspaceId: string, processId: string,
        reason: 'cancelled' | 'unbound', bindingId?: string, requestId?: string,
    ): void {
        id.parse(processId);
        if (bindingId !== undefined) id.parse(bindingId);
        if (requestId !== undefined) id.parse(requestId);
        this.transact(() => {
            const rows = (this.db.prepare(`
                SELECT * FROM sentinel_mirror_deliveries
                WHERE workspace_id = ? AND process_id = ? AND ${UNFINISHED}
                  AND (? IS NULL OR binding_id = ?) AND (? IS NULL OR request_id = ?)
            `).all(workspaceId, processId, bindingId ?? null, bindingId ?? null, requestId ?? null, requestId ?? null) as DeliveryRow[])
                .map(row => this.toEntry(row, true));
            for (const row of rows) {
                row.cancelRequested = true;
                if (row.failure !== 'unknown') row.failure = reason;
                // An in-flight operation cannot be unsent; retain its acknowledgement authority.
                if (row.state !== 'sending') row.state = 'cancelled';
                this.update(row);
            }
            this.db.prepare(`
                UPDATE sentinel_mirror_requests SET answer = 'suppressed'
                WHERE workspace_id = ? AND process_id = ? AND answer = 'awaiting'
                  AND (? IS NULL OR binding_id = ?) AND (? IS NULL OR request_id = ?)
            `).run(workspaceId, processId, bindingId ?? null, bindingId ?? null, requestId ?? null, requestId ?? null);
        });
    }

    /** Process/workspace removal: targeted terminal transitions for every unfinished record. */
    cancelWorkspace(workspaceId: string): void {
        const processes = this.db.prepare(`
            SELECT DISTINCT process_id FROM sentinel_mirror_requests WHERE workspace_id = ? AND ${ACTIVE_REQUEST}
            UNION SELECT DISTINCT process_id FROM sentinel_mirror_deliveries WHERE workspace_id = ? AND ${UNFINISHED}
        `).all(workspaceId, workspaceId) as Array<{ process_id: string }>;
        for (const row of processes) this.cancel(workspaceId, row.process_id, 'unbound');
    }

    /** A persisted sending attempt without durable acknowledgement becomes ambiguous; never replayed. */
    recover(workspaceId?: string): void {
        this.transact(() => {
            this.db.prepare(`
                UPDATE sentinel_mirror_deliveries SET state = 'ambiguous', attempt_id = NULL, failure = 'unknown'
                WHERE ${UNFINISHED} AND state = 'sending' AND (? IS NULL OR workspace_id = ?)
            `).run(workspaceId ?? null, workspaceId ?? null);
        });
    }

    /** True once a workspace's legacy JSON ledger was imported (or there was none to import). */
    isImported(workspaceId: string): boolean {
        return !!this.db.prepare('SELECT 1 FROM sentinel_mirror_imports WHERE workspace_id = ?').get(workspaceId);
    }

    /**
     * One-time, idempotent import of a workspace's legacy JSON ledger. Validates
     * the whole file first; corrupt input throws {@link SentinelMirrorImportError}
     * and is left intact. Unresolved sending attempts become ambiguous. Delivered
     * users without an answer remain unfinished requests. Nothing is sent here.
     */
    importLegacy(workspaceId: string): number {
        if (this.isImported(workspaceId)) return 0;
        const file = getRepoDataPath(this.dataDir, workspaceId, SENTINEL_MIRROR_OUTBOX_FILE);
        let rows: SentinelMirrorEntry[] = [];
        let raw: string | undefined;
        try {
            raw = fs.readFileSync(file, 'utf8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new SentinelMirrorImportError(workspaceId);
        }
        if (raw !== undefined) {
            let decoded: unknown;
            try { decoded = JSON.parse(raw); } catch { throw new SentinelMirrorImportError(workspaceId); }
            const parsed = z.array(entrySchema).safeParse(decoded);
            if (!parsed.success) throw new SentinelMirrorImportError(workspaceId);
            rows = parsed.data;
            if (rows.some(row => row.workspaceId !== workspaceId || row.eventId !== eventId(row))
                || new Set(rows.map(row => row.eventId)).size !== rows.length) {
                throw new SentinelMirrorImportError(workspaceId);
            }
        }
        this.transact(() => {
            if (this.isImported(workspaceId)) return;
            for (const row of rows) {
                if (this.row(workspaceId, row.eventId)) continue;
                const seq = Math.max(Date.parse(row.createdAt), 1);
                const imported: SentinelMirrorEntry = row.state === 'sending'
                    ? { ...row, state: 'ambiguous', attemptId: undefined, failure: 'unknown' } : row;
                this.insertEntry(imported, seq);
                row.outboundIds.forEach((outboundId, partIndex) => this.db.prepare(`
                    INSERT OR IGNORE INTO sentinel_mirror_receipts
                        (event_id, part_index, outbound_id, connector, chat_key, thread_id, acknowledged_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(row.eventId, partIndex, outboundId, row.destination.connector, row.destination.chatKey,
                    row.destination.threadId ?? null, row.createdAt));
            }
            for (const user of rows.filter(row => row.role === 'user')) {
                const answer = rows.find(row => row.role === 'assistant'
                    && row.processId === user.processId && row.requestId === user.requestId);
                const admission = user.state === 'admitting' ? 'staged'
                    : user.failure === 'admission-rejected' ? 'rejected' : 'accepted';
                // Do not infer final answers from delivery state: only a recorded answer closes the request.
                const answerState = answer ? 'materialized' : user.cancelRequested ? 'suppressed' : 'awaiting';
                this.insertRequest(user, Math.max(Date.parse(user.createdAt), 1), admission, answerState, true);
            }
            this.db.prepare('INSERT INTO sentinel_mirror_imports (workspace_id, imported_at, row_count) VALUES (?, ?, ?)')
                .run(workspaceId, new Date().toISOString(), rows.length);
        });
        return rows.length;
    }

    /** Test/diagnostic seam: every mutation runs through one SQLite transaction. */
    protected transact<T>(mutation: () => T): T {
        return this.db.transaction(mutation)();
    }

    private row(workspaceId: string, identity: string): DeliveryRow | undefined {
        return this.db.prepare('SELECT * FROM sentinel_mirror_deliveries WHERE event_id = ? AND workspace_id = ?')
            .get(identity, workspaceId) as DeliveryRow | undefined;
    }

    private headRows(workspaceIds?: readonly string[], destinationKey?: string): DeliveryRow[] {
        const scopes = workspaceIds ? [...new Set(workspaceIds)] : undefined;
        if (scopes && !scopes.length) return [];
        const scope = scopes ? `AND workspace_id IN (${scopes.map(() => '?').join(',')})` : '';
        const args = [...(destinationKey ? [destinationKey] : []), ...(scopes ?? [])];
        const filter = destinationKey ? 'AND destination_key = ?' : '';
        const rows = this.db.prepare(`
            SELECT * FROM sentinel_mirror_deliveries
            WHERE ${UNFINISHED} ${filter} ${scope}
            ORDER BY seq, rowid
        `).all(...args) as DeliveryRow[];
        const seen = new Set<string>();
        return rows.filter(row => {
            const key = this.destinationKeyOf(row);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    private destinationKeyOf(row: DeliveryRow): string {
        return JSON.stringify([row.connector, row.chat_key, row.connector === 'teams' ? row.thread_id : null]);
    }

    private nextSeq(): number {
        // Monotonic across workspaces and clock regressions; preserves physical destination order.
        const row = this.db.prepare('SELECT MAX(seq) AS seq FROM sentinel_mirror_deliveries').get() as { seq: number | null };
        return Math.max(Date.now(), (row.seq ?? 0) + 1);
    }

    private insert(intent: SentinelMirrorIntent, identity: string, seq: number, state: SentinelMirrorEntry['state']): void {
        this.insertEntry({
            ...intent, eventId: identity, createdAt: new Date(seq).toISOString(), state,
            chunks: [], outboundIds: [], nextPart: 0, cancelRequested: false, attemptedPartCount: 0,
        }, seq);
    }

    private insertEntry(entry: SentinelMirrorEntry, seq: number): void {
        entrySchema.parse(entry);
        this.db.prepare(`
            INSERT INTO sentinel_mirror_deliveries (
                event_id, workspace_id, process_id, request_id, role, connector, chat_key, thread_id, binding_id,
                destination_key, content, attachments, chunks, state, next_part, attempt_id, attempted_part_count,
                cancel_requested, failure, retry_count, next_attempt_at, seq, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            entry.eventId, entry.workspaceId, entry.processId, entry.requestId, entry.role,
            entry.destination.connector, entry.destination.chatKey, entry.destination.threadId ?? null,
            entry.destination.bindingId, mirrorDestinationKey(entry.destination), entry.content,
            entry.attachments ? JSON.stringify(this.terminalAttachments(entry)) : null,
            JSON.stringify(entry.chunks), entry.state, entry.nextPart, entry.attemptId ?? null,
            entry.attemptedPartCount ?? 0, entry.cancelRequested ? 1 : 0, entry.failure ?? null,
            entry.retryCount ?? null, entry.nextAttemptAt ?? null, seq, entry.createdAt,
        );
    }

    private insertRequest(
        intent: Pick<SentinelMirrorIntent, 'workspaceId' | 'processId' | 'requestId' | 'destination'>, seq: number,
        admission: 'staged' | 'accepted' | 'rejected', answer: 'awaiting' | 'materialized' | 'suppressed', ignoreExisting = false,
    ): void {
        this.db.prepare(`
            INSERT ${ignoreExisting ? 'OR IGNORE' : ''} INTO sentinel_mirror_requests (
                workspace_id, process_id, request_id, connector, chat_key, thread_id, binding_id,
                admission, answer, seq, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(intent.workspaceId, intent.processId, intent.requestId, intent.destination.connector,
            intent.destination.chatKey, intent.destination.threadId ?? null, intent.destination.bindingId,
            admission, answer, seq, new Date(seq).toISOString());
    }

    private materialize(intent: Pick<SentinelMirrorIntent, 'workspaceId' | 'processId' | 'requestId'>): void {
        this.db.prepare(`
            UPDATE sentinel_mirror_requests SET answer = 'materialized'
            WHERE workspace_id = ? AND process_id = ? AND request_id = ? AND answer = 'awaiting'
        `).run(intent.workspaceId, intent.processId, intent.requestId);
    }

    private setAdmission(row: SentinelMirrorEntry, admission: 'accepted' | 'rejected'): void {
        if (row.role !== 'user') return;
        this.db.prepare(`
            UPDATE sentinel_mirror_requests SET admission = ?
            WHERE workspace_id = ? AND process_id = ? AND request_id = ? AND admission = 'staged'
        `).run(admission, row.workspaceId, row.processId, row.requestId);
    }

    private change(
        workspaceId: string, identity: string, update: (row: SentinelMirrorEntry) => boolean,
        after?: (row: SentinelMirrorEntry) => void,
    ): boolean {
        return this.transact(() => {
            const stored = this.row(workspaceId, identity);
            if (!stored) throw new Error('Sentinel mirror event is unavailable in its owning workspace');
            const row = this.toEntry(stored, true);
            if (!update(row)) return false;
            this.update(row);
            after?.(row);
            return true;
        });
    }

    private update(row: SentinelMirrorEntry): void {
        entrySchema.parse(row);
        this.db.prepare(`
            UPDATE sentinel_mirror_deliveries SET
                attachments = ?, chunks = ?, state = ?, next_part = ?, attempt_id = ?, attempted_part_count = ?,
                cancel_requested = ?, failure = ?, retry_count = ?, next_attempt_at = ?
            WHERE event_id = ? AND workspace_id = ?
        `).run(
            row.attachments ? JSON.stringify(this.terminalAttachments(row)) : null,
            JSON.stringify(row.chunks), row.state, row.nextPart, row.attemptId ?? null,
            row.attemptedPartCount ?? 0, row.cancelRequested ? 1 : 0, row.failure ?? null,
            row.retryCount ?? null, row.nextAttemptAt ?? null, row.eventId, row.workspaceId,
        );
    }

    /** Terminal receipts retain identity/part captions, not private upload bytes. */
    private terminalAttachments(row: SentinelMirrorEntry): SentinelMirrorEntry['attachments'] {
        if (row.state !== 'delivered' && row.state !== 'cancelled') return row.attachments;
        return row.attachments?.map(({ data: _data, ...meta }) => meta);
    }

    private toEntry(row: DeliveryRow, withPayload: boolean): SentinelMirrorEntry {
        try {
            const outboundIds = (this.db.prepare(
                'SELECT outbound_id FROM sentinel_mirror_receipts WHERE event_id = ? ORDER BY part_index',
            ).all(row.event_id) as Array<{ outbound_id: string }>).map(receipt => receipt.outbound_id);
            const attachments = row.attachments === null ? undefined
                : (JSON.parse(row.attachments) as NonNullable<SentinelMirrorEntry['attachments']>)
                    .map(attachment => withPayload ? attachment : (({ data: _data, ...meta }) => meta)(attachment));
            const entry: SentinelMirrorEntry = {
                workspaceId: row.workspace_id, processId: row.process_id, requestId: row.request_id,
                role: row.role as SentinelMirrorEntry['role'],
                destination: {
                    connector: row.connector as SentinelMirrorDestination['connector'], chatKey: row.chat_key,
                    ...(row.thread_id !== null ? { threadId: row.thread_id } : {}), bindingId: row.binding_id,
                },
                content: row.content,
                ...(attachments ? { attachments } : {}),
                eventId: row.event_id, createdAt: row.created_at,
                state: row.state as SentinelMirrorEntry['state'],
                chunks: JSON.parse(row.chunks) as string[],
                outboundIds, nextPart: row.next_part,
                ...(row.attempt_id !== null ? { attemptId: row.attempt_id } : {}),
                cancelRequested: row.cancel_requested === 1,
                ...(row.failure !== null ? { failure: row.failure as SentinelMirrorFailure } : {}),
                ...(row.retry_count !== null ? { retryCount: row.retry_count } : {}),
                ...(row.next_attempt_at !== null ? { nextAttemptAt: row.next_attempt_at } : {}),
                attemptedPartCount: row.attempted_part_count,
            };
            if (entry.eventId !== eventId(entry)) throw new Error('identity');
            return entrySchema.parse(entry);
        } catch {
            throw new Error('Invalid Sentinel mirror outbox');
        }
    }
}
