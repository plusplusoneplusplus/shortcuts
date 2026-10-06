import * as fs from 'node:fs';
import { z } from 'zod';
import { getRepoDataPath } from '../paths';
import { atomicWriteJsonUnique } from '../shared/fs-utils';

export const DELEGATED_JOBS_FILE = 'delegated-jobs.json';
export const MAX_RESULT_SUMMARY = 8_000;
const id = z.string().min(1);
const parentSchema = z.object({ workspaceId: id, processId: id });
const childSchema = z.object({
    workspaceId: id, processId: id, serverId: id.optional(), sessionId: id.optional(),
});
const resultSchema = z.object({
    terminalEventId: id,
    outcome: z.enum(['completed', 'failed', 'cancelled', 'capped']),
    reason: z.string().max(2_000).optional(),
    summary: z.string().max(MAX_RESULT_SUMMARY),
    links: z.array(z.string().min(1).max(2_000)).max(20),
});
const deliverySchema = z.discriminatedUnion('state', [
    z.object({ state: z.literal('pending') }),
    z.object({ state: z.literal('queued'), receiptId: id }),
    z.object({ state: z.literal('delivered'), receiptId: id }),
    z.object({ state: z.literal('failed'), reason: z.string().min(1).max(2_000) }),
]);
const jobSchema = z.object({
    id,
    parent: parentSchema,
    child: childSchema,
    title: z.string().min(1).max(80),
    createdAt: z.iso.datetime(),
    terminal: z.object({ result: resultSchema, delivery: deliverySchema }).optional(),
});

export type DelegatedJob = z.infer<typeof jobSchema>;
export type DelegatedJobResult = z.infer<typeof resultSchema>;
export type DelegatedJobDelivery = z.infer<typeof deliverySchema>;
export type DelegatedJobRegistration = Omit<DelegatedJob, 'createdAt' | 'terminal'>;

/**
 * One ledger per originating workspace, written synchronously with atomic rename.
 * Reads return detached snapshots; failed writes never advance in-memory state.
 * The server owns the ledger. Child output is data, never routing authority.
 */
export class DelegatedJobStore {
    constructor(private readonly dataDir: string) {}

    list(workspaceId: string): DelegatedJob[] {
        const file = getRepoDataPath(this.dataDir, workspaceId, DELEGATED_JOBS_FILE);
        let raw: string;
        try {
            raw = fs.readFileSync(file, 'utf8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw error;
        }
        const rows = z.array(jobSchema).parse(JSON.parse(raw));
        if (rows.some(row => row.parent.workspaceId !== workspaceId)
            || new Set(rows.map(row => row.id)).size !== rows.length) {
            throw new Error(`Invalid delegated job ownership or duplicate identity in ${workspaceId}`);
        }
        return rows;
    }

    /** Register only new delegations; callers never backfill unrelated historical jobs. */
    register(registration: DelegatedJobRegistration): DelegatedJob {
        const job = jobSchema.parse({ ...registration, createdAt: new Date().toISOString() });
        const rows = this.list(job.parent.workspaceId);
        const existing = rows.find(row => row.id === job.id);
        if (existing) {
            if (JSON.stringify(existing.parent) !== JSON.stringify(job.parent)
                || JSON.stringify(existing.child) !== JSON.stringify(job.child)) {
                throw new Error(`Delegated job ${job.id} already belongs to another parent or child`);
            }
            return existing;
        }
        rows.push(job);
        this.save(job.parent.workspaceId, rows);
        return job;
    }

    /** First terminal result wins, including duplicate events with different IDs. */
    recordResult(
        workspaceId: string,
        jobId: string,
        result: DelegatedJobResult,
        initialDelivery: Extract<DelegatedJobDelivery, { state: 'pending' | 'failed' }> = { state: 'pending' },
    ): boolean {
        const rows = this.list(workspaceId);
        const job = rows.find(row => row.id === jobId);
        if (!job || job.terminal) return false;
        job.terminal = {
            result: resultSchema.parse({
                ...result,
                summary: result.summary.slice(0, MAX_RESULT_SUMMARY),
                ...(result.reason !== undefined ? { reason: result.reason.slice(0, 2_000) } : {}),
                links: result.links.slice(0, 20),
            }),
            delivery: deliverySchema.parse(initialDelivery),
        };
        this.save(workspaceId, rows);
        return true;
    }

    /** Conditional transitions prevent stale workers from reopening settled results. */
    updateDelivery(
        workspaceId: string,
        jobId: string,
        expected: DelegatedJobDelivery['state'],
        next: DelegatedJobDelivery,
    ): boolean {
        const rows = this.list(workspaceId);
        const terminal = rows.find(row => row.id === jobId)?.terminal;
        if (!terminal || terminal.delivery.state !== expected) return false;
        const delivery = deliverySchema.parse(next);
        const allowed = expected === 'pending'
            ? delivery.state === 'queued' || delivery.state === 'failed'
            : expected === 'queued' && (delivery.state === 'delivered' || delivery.state === 'failed');
        if (!allowed) throw new Error(`Invalid delegated result transition: ${expected} -> ${delivery.state}`);
        if (terminal.delivery.state === 'queued' && delivery.state === 'delivered'
            && terminal.delivery.receiptId !== delivery.receiptId) {
            throw new Error('Delegated result delivery receipt does not match queue admission');
        }
        terminal.delivery = delivery;
        this.save(workspaceId, rows);
        return true;
    }

    private save(workspaceId: string, rows: DelegatedJob[]): void {
        atomicWriteJsonUnique(getRepoDataPath(this.dataDir, workspaceId, DELEGATED_JOBS_FILE), rows);
    }
}
