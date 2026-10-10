import * as fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getRepoDataPath } from '../paths';
import { atomicWriteJsonUnique } from '../shared/fs-utils';
import { mirrorAttachmentSchema } from './sentinel-mirror-attachments';
import { MAX_ATTACHMENT_SIZE } from '../core/attachment-utils';

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
const entrySchema = intentSchema.extend({
    eventId: id,
    createdAt: z.iso.datetime(),
    state: z.enum(['admitting', 'pending', 'sending', 'retryable', 'delivered', 'ambiguous', 'cancelled']),
    chunks: z.array(z.string().min(1)),
    outboundIds: z.array(id),
    nextPart: z.number().int().nonnegative(),
    attemptId: id.optional(),
    cancelRequested: z.boolean(),
    failure: z.enum(['not-attempted', 'rejected', 'unknown', 'cancelled', 'unbound', 'admission-rejected', 'attachment-invalid']).optional(),
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

/** Immutable media captions form the final ordered parts; a negative index identifies text. */
export function mirrorAttachmentPartIndex(
    row: Pick<SentinelMirrorEntry, 'chunks' | 'attachments'>, partIndex: number,
): number {
    return partIndex - (row.chunks.length - (row.attachments?.length ?? 0));
}

function eventId(intent: SentinelMirrorIntent): string {
    return createHash('sha256').update(JSON.stringify([
        intent.workspaceId, intent.processId, intent.requestId, intent.role,
    ])).digest('hex');
}

function conversationKey(destination: SentinelMirrorDestination): string {
    return JSON.stringify([
        destination.connector, destination.chatKey,
        destination.connector === 'teams' ? destination.threadId ?? null : null,
    ]);
}

/**
 * Private, owning-server outbox. Staged intents cannot send until canonical admission
 * is confirmed. Detached reads and atomic writes keep failed writes from advancing state.
 * Network attempts without a durable acknowledgement are quarantined, not blindly replayed.
 */
export class SentinelMirrorOutbox {
    private lastCreatedAt = 0;
    private readonly workspaceIds = new Set<string>();

    constructor(private readonly dataDir: string) {}

    list(workspaceId: string): SentinelMirrorEntry[] {
        this.workspaceIds.add(workspaceId);
        const file = getRepoDataPath(this.dataDir, workspaceId, SENTINEL_MIRROR_OUTBOX_FILE);
        let raw: string;
        try {
            raw = fs.readFileSync(file, 'utf8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw error;
        }
        let decoded: unknown;
        try {
            decoded = JSON.parse(raw);
        } catch (error) {
            if (error instanceof SyntaxError) throw new Error('Invalid Sentinel mirror outbox');
            throw error;
        }
        const parsed = z.array(entrySchema).safeParse(decoded);
        if (!parsed.success) throw new Error('Invalid Sentinel mirror outbox');
        const rows = parsed.data;
        if (rows.some(row => row.workspaceId !== workspaceId || row.eventId !== eventId(row))
            || new Set(rows.map(row => row.eventId)).size !== rows.length) {
            throw new Error('Invalid Sentinel mirror ownership or duplicate event identity');
        }
        for (const row of rows) this.lastCreatedAt = Math.max(this.lastCreatedAt, Date.parse(row.createdAt));
        return rows;
    }

    /** Only explicit, newly captured intents enter the ledger; never scan chat history. */
    stage(input: SentinelMirrorIntent): SentinelMirrorEntry {
        const intent = intentSchema.parse(input);
        const rows = this.list(intent.workspaceId);
        const identity = eventId(intent);
        const existing = rows.find(row => row.eventId === identity);
        if (existing) {
            if (existing.content !== intent.content
                || JSON.stringify(existing.attachments?.map(({ data: _data, ...meta }) => meta))
                    !== JSON.stringify(intent.attachments?.map(({ data: _data, ...meta }) => meta))
                || JSON.stringify(existing.destination) !== JSON.stringify(intent.destination)) {
                throw new Error('Sentinel mirror event conflicts with its captured intent');
            }
            return existing;
        }
        // One owning-server outbox observes restored ledgers before admission. Monotonic
        // timestamps preserve destination order across workspace files and clock changes.
        const createdAt = Math.max(Date.now(), this.lastCreatedAt + 1);
        const entry: SentinelMirrorEntry = {
            ...intent, eventId: identity, createdAt: new Date(createdAt).toISOString(),
            state: 'admitting', chunks: [], outboundIds: [], nextPart: 0, cancelRequested: false,
            attemptedPartCount: 0,
        };
        rows.push(entry);
        this.save(intent.workspaceId, rows);
        this.lastCreatedAt = createdAt;
        return entry;
    }

    accept(workspaceId: string, identity: string): boolean {
        return this.change(workspaceId, identity, row => {
            if (row.state !== 'admitting') return false;
            row.state = 'pending';
            return true;
        });
    }

    reject(workspaceId: string, identity: string): boolean {
        return this.change(workspaceId, identity, row => {
            if (row.state !== 'admitting') return false;
            row.state = 'cancelled';
            row.failure = 'admission-rejected';
            row.cancelRequested = true;
            return true;
        });
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

    /** A physical messaging conversation can have intents in multiple workspace ledgers. */
    headsAcrossWorkspaces(workspaceIds: readonly string[]): SentinelMirrorEntry[] {
        const seen = new Set<string>();
        return [...new Set(workspaceIds)].flatMap(workspaceId => this.list(workspaceId))
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .filter(row => {
                if (row.state === 'delivered' || row.state === 'cancelled') return false;
                const key = conversationKey(row.destination);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    }

    beginPart(workspaceId: string, identity: string, activeWorkspaceIds?: readonly string[]): string | undefined {
        const scopes = activeWorkspaceIds ?? [...this.workspaceIds];
        if (!scopes.includes(workspaceId)) throw new Error('Sentinel mirror owner is outside the active workspace scope');
        const attempt = randomUUID();
        const changed = this.change(workspaceId, identity, row => {
            if (!this.headsAcrossWorkspaces(scopes).some(head => head.eventId === identity)
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
        return this.change(workspaceId, identity, row => {
            if (row.state !== 'sending' || row.attemptId !== attempt) return false;
            row.outboundIds.push(outboundId);
            row.nextPart++;
            const mediaIndex = mirrorAttachmentPartIndex(row, row.nextPart - 1);
            if (mediaIndex >= 0 && row.attachments?.[mediaIndex]) delete row.attachments[mediaIndex].data;
            row.attemptId = undefined;
            row.state = row.cancelRequested ? 'cancelled'
                : row.nextPart === row.chunks.length ? 'delivered' : 'pending';
            return true;
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

    cancel(
        workspaceId: string, processId: string,
        reason: 'cancelled' | 'unbound', bindingId?: string, requestId?: string,
    ): void {
        id.parse(processId);
        if (bindingId !== undefined) id.parse(bindingId);
        if (requestId !== undefined) id.parse(requestId);
        const rows = this.list(workspaceId);
        let changed = false;
        for (const row of rows) {
            if (row.processId !== processId || (bindingId !== undefined && row.destination.bindingId !== bindingId)
                || (requestId !== undefined && row.requestId !== requestId)
                || row.state === 'delivered' || row.state === 'cancelled') continue;
            row.cancelRequested = true;
            if (row.failure !== 'unknown') row.failure = reason;
            // An in-flight operation cannot be unsent; retain its acknowledgement authority.
            if (row.state !== 'sending') row.state = 'cancelled';
            changed = true;
        }
        if (changed) this.save(workspaceId, rows);
    }

    /** Reconcile only explicitly staged events; accepted unsent parts remain retryable. */
    recover(workspaceId: string): void {
        const rows = this.list(workspaceId);
        let changed = false;
        for (const row of rows) {
            if (row.state !== 'sending') continue;
            row.state = 'ambiguous';
            row.attemptId = undefined;
            row.failure = 'unknown';
            changed = true;
        }
        if (changed) this.save(workspaceId, rows);
    }

    private change(workspaceId: string, identity: string, update: (row: SentinelMirrorEntry) => boolean): boolean {
        const rows = this.list(workspaceId);
        const row = rows.find(entry => entry.eventId === identity);
        if (!row) throw new Error('Sentinel mirror event is unavailable in its owning workspace');
        if (!update(row)) return false;
        this.save(workspaceId, rows);
        return true;
    }

    private save(workspaceId: string, rows: SentinelMirrorEntry[]): void {
        // Terminal receipts retain identity/part captions, not private upload bytes.
        for (const row of rows) if (row.state === 'delivered' || row.state === 'cancelled') {
            for (const attachment of row.attachments ?? []) delete attachment.data;
        }
        z.array(entrySchema).parse(rows);
        atomicWriteJsonUnique(getRepoDataPath(this.dataDir, workspaceId, SENTINEL_MIRROR_OUTBOX_FILE), rows);
    }
}
