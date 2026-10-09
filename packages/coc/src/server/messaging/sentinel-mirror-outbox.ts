import * as fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getRepoDataPath } from '../paths';
import { atomicWriteJsonUnique } from '../shared/fs-utils';

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
    failure: z.enum(['not-attempted', 'rejected', 'unknown', 'cancelled', 'unbound', 'admission-rejected']).optional(),
}).strict().refine(row =>
    row.nextPart === row.outboundIds.length
    && row.nextPart <= row.chunks.length
    && (row.state === 'sending') === (row.attemptId !== undefined)
    && (row.state !== 'sending' || row.nextPart < row.chunks.length)
    && (row.state !== 'delivered' || (row.chunks.length > 0 && row.nextPart === row.chunks.length)),
{ message: 'Invalid Sentinel mirror delivery progress' });

export type SentinelMirrorIntent = z.infer<typeof intentSchema>;
export type SentinelMirrorEntry = z.infer<typeof entrySchema>;
export type SentinelMirrorDestination = z.infer<typeof destinationSchema>;

function eventId(intent: SentinelMirrorIntent): string {
    return createHash('sha256').update(JSON.stringify([
        intent.workspaceId, intent.processId, intent.requestId, intent.role,
    ])).digest('hex');
}

function conversationKey(destination: SentinelMirrorDestination): string {
    return JSON.stringify([destination.connector, destination.chatKey, destination.threadId ?? null]);
}

/**
 * Private, owning-server outbox. Staged intents cannot send until canonical admission
 * is confirmed. Detached reads and atomic writes keep failed writes from advancing state.
 * Network attempts without a durable acknowledgement are quarantined, not blindly replayed.
 */
export class SentinelMirrorOutbox {
    constructor(private readonly dataDir: string) {}

    list(workspaceId: string): SentinelMirrorEntry[] {
        const file = getRepoDataPath(this.dataDir, workspaceId, SENTINEL_MIRROR_OUTBOX_FILE);
        let raw: string;
        try {
            raw = fs.readFileSync(file, 'utf8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw error;
        }
        const parsed = z.array(entrySchema).safeParse(JSON.parse(raw));
        if (!parsed.success) throw new Error('Invalid Sentinel mirror outbox');
        const rows = parsed.data;
        if (rows.some(row => row.workspaceId !== workspaceId || row.eventId !== eventId(row))
            || new Set(rows.map(row => row.eventId)).size !== rows.length) {
            throw new Error('Invalid Sentinel mirror ownership or duplicate event identity');
        }
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
                || JSON.stringify(existing.destination) !== JSON.stringify(intent.destination)) {
                throw new Error('Sentinel mirror event conflicts with its captured intent');
            }
            return existing;
        }
        const entry: SentinelMirrorEntry = {
            ...intent, eventId: identity, createdAt: new Date().toISOString(),
            state: 'admitting', chunks: [], outboundIds: [], nextPart: 0, cancelRequested: false,
        };
        rows.push(entry);
        this.save(intent.workspaceId, rows);
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
        const seen = new Set<string>();
        return this.list(workspaceId).filter(row => {
            if (row.state === 'delivered' || row.state === 'cancelled') return false;
            const key = conversationKey(row.destination);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    beginPart(workspaceId: string, identity: string): string | undefined {
        const attempt = randomUUID();
        const changed = this.change(workspaceId, identity, row => {
            if (!this.heads(workspaceId).some(head => head.eventId === identity)
                || (row.state !== 'pending' && row.state !== 'retryable')
                || row.chunks.length === 0) return false;
            row.state = 'sending';
            row.attemptId = attempt;
            row.failure = undefined;
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
            row.attemptId = undefined;
            row.state = row.cancelRequested ? 'cancelled'
                : row.nextPart === row.chunks.length ? 'delivered' : 'pending';
            return true;
        });
    }

    failPart(
        workspaceId: string, identity: string, attempt: string,
        outcome: 'not-attempted' | 'rejected' | 'unknown',
    ): boolean {
        return this.change(workspaceId, identity, row => {
            if (row.state !== 'sending' || row.attemptId !== attempt) return false;
            row.attemptId = undefined;
            row.failure = outcome;
            row.state = outcome === 'unknown' ? 'ambiguous' : row.cancelRequested ? 'cancelled' : 'retryable';
            return true;
        });
    }

    cancel(
        workspaceId: string, processId: string,
        reason: 'cancelled' | 'unbound', bindingId?: string,
    ): void {
        const rows = this.list(workspaceId);
        let changed = false;
        for (const row of rows) {
            if (row.processId !== processId || (bindingId && row.destination.bindingId !== bindingId)
                || row.state === 'delivered' || row.state === 'cancelled') continue;
            row.cancelRequested = true;
            row.failure = reason;
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
        z.array(entrySchema).parse(rows);
        atomicWriteJsonUnique(getRepoDataPath(this.dataDir, workspaceId, SENTINEL_MIRROR_OUTBOX_FILE), rows);
    }
}
