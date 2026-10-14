import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getRepoDataPath } from '../paths';
import { atomicWriteJsonUnique } from '../shared/fs-utils';
import { parsePullRequestUrl } from '../triggers/pr-status-fetcher';

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
const prIdentitySchema = z.object({
    provider: z.enum(['github', 'ado']),
    host: z.string().min(1).max(200),
    repoPath: z.string().min(1).max(2_000),
    number: z.number().int().positive().safe(),
    url: z.string().min(1).max(2_000),
}).strict().refine(pr => {
    const canonical = parsePullRequestUrl(pr.url);
    return canonical !== null && canonical.provider === pr.provider && canonical.host === pr.host
        && canonical.repoPath === pr.repoPath && canonical.number === pr.number && canonical.url === pr.url;
}, 'Pull request identity must match its canonical URL');
const pullRequestSchema = z.object({
    id,
    itemId: z.string().min(1).max(200),
    pr: prIdentitySchema,
    recordedAt: z.iso.datetime(),
}).strict();
const jobSchema = z.object({
    id,
    parent: parentSchema,
    child: childSchema,
    title: z.string().min(1).max(80),
    messagingOrigin: z.object({
        connector: z.enum(['whatsapp', 'teams']), chatKey: id, threadId: id.optional(),
        desktopMirror: z.object({ workspaceId: id, processId: id, requestId: id, bindingId: id }).optional(),
    }).optional(),
    createdAt: z.iso.datetime(),
    terminal: z.object({ result: resultSchema, delivery: deliverySchema }).optional(),
    grilling: z.object({ result: resultSchema, delivery: deliverySchema }).optional(),
    boundary: z.literal('grill').optional(),
    pullRequests: z.array(pullRequestSchema).optional(),
});

export type DelegatedJobPullRequest = z.infer<typeof pullRequestSchema>;
export type DelegatedJob = z.infer<typeof jobSchema>;
export type DelegatedJobResult = z.infer<typeof resultSchema>;
export type DelegatedJobDelivery = z.infer<typeof deliverySchema>;
export type DelegatedJobRegistration = Omit<DelegatedJob, 'createdAt' | 'terminal' | 'grilling' | 'boundary' | 'pullRequests'>;

function pullRequestKey(pr: DelegatedJobPullRequest['pr']): string {
    return JSON.stringify([pr.provider, pr.host, pr.repoPath.toLowerCase(), pr.number]);
}

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
        const receiptIds = new Set<string>();
        for (const row of rows) {
            const outputs = row.pullRequests ?? [];
            if (new Set(outputs.map(output => pullRequestKey(output.pr))).size !== outputs.length) {
                throw new Error(`Duplicate delegated pull request identity in ${row.id}`);
            }
            for (const output of outputs) {
                if (receiptIds.has(output.id)) throw new Error(`Duplicate delegated pull request receipt in ${workspaceId}`);
                receiptIds.add(output.id);
            }
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
                || JSON.stringify(existing.child) !== JSON.stringify(job.child)
                || JSON.stringify(existing.messagingOrigin) !== JSON.stringify(job.messagingOrigin)) {
                throw new Error(`Delegated job ${job.id} already belongs to another parent or child`);
            }
            return existing;
        }
        rows.push(job);
        this.save(job.parent.workspaceId, rows);
        return job;
    }

    /**
     * Called with the exact successful submission, never URLs inferred from prose.
     * This records provenance only; item eligibility and monitoring belong to callers.
     */
    recordPullRequest(workspaceId: string, jobId: string, itemId: string, prUrl: string): DelegatedJobPullRequest {
        const rows = this.list(workspaceId);
        const job = rows.find(row => row.id === jobId);
        if (!job) throw new Error(`Delegated job ${jobId} is not registered in ${workspaceId}`);
        const pr = parsePullRequestUrl(prUrl);
        if (!pr) throw new Error('A supported GitHub or Azure DevOps pull request URL is required');
        const candidate = pullRequestSchema.parse({
            id: `delegated-pr-${randomUUID()}`, itemId, pr, recordedAt: new Date().toISOString(),
        });
        const existing = job.pullRequests?.find(output => pullRequestKey(output.pr) === pullRequestKey(candidate.pr));
        if (existing) {
            if (existing.itemId !== itemId) throw new Error('Delegated pull request already belongs to another to-do item');
            return existing;
        }
        (job.pullRequests ??= []).push(candidate);
        this.save(workspaceId, rows);
        return candidate;
    }

    /** First terminal result wins, including duplicate events with different IDs. */
    recordResult(
        workspaceId: string,
        jobId: string,
        result: DelegatedJobResult,
        initialDelivery: Extract<DelegatedJobDelivery, { state: 'pending' | 'failed' }> = { state: 'pending' },
        boundary?: 'grill',
    ): boolean {
        const rows = this.list(workspaceId);
        const job = rows.find(row => row.id === jobId);
        const field = boundary === 'grill' ? 'grilling' : 'terminal';
        if (!job || job[field]) return false;
        job[field] = {
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
        boundary?: 'grill',
    ): boolean {
        const rows = this.list(workspaceId);
        const terminal = rows.find(row => row.id === jobId)?.[boundary === 'grill' ? 'grilling' : 'terminal'];
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

/** Reuse result delivery without consuming the whole execution-session receipt. */
export function grillingResultJob(job: DelegatedJob): DelegatedJob | undefined {
    return job.grilling ? { ...job, boundary: 'grill', terminal: job.grilling } : undefined;
}
