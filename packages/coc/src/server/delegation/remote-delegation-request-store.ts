import * as fs from 'node:fs';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { getRepoDataPath } from '../paths';
import { atomicWriteJsonUnique } from '../shared/fs-utils';
import { DelegatedJobStore, type DelegatedJob } from './delegated-job-store';
import { remoteDelegationClaimSchema, sameRemoteDelegationBinding, type RemoteDelegationProof } from './remote-delegation-auth';

export const REMOTE_DELEGATION_REQUESTS_FILE = 'remote-delegation-requests.json';
const id = z.string().min(1).max(512).refine(value => !!value.trim());
const childSchema = z.object({ processId: id, sessionId: id.optional() }).strict();
const admissionSchema = z.discriminatedUnion('state', [
    z.object({ state: z.literal('reserved') }).strict(),
    z.object({ state: z.literal('dispatching') }).strict(),
    z.object({ state: z.literal('uncertain'), reason: z.string().min(1).max(2_000) }).strict(),
    z.object({ state: z.literal('rejected'), reason: z.string().min(1).max(2_000) }).strict(),
    z.object({ state: z.literal('accepted'), child: childSchema }).strict(),
]);
const requestSchema = z.object({
    requestId: z.uuid(),
    originServerIdentity: id,
    parent: z.object({ workspaceId: id, processId: id }).strict(),
    destination: z.object({ serverId: id, serverIdentity: id, workspaceId: id }).strict(),
    kind: z.enum(['launch', 'follow-up', 'ralph']),
    targetProcessId: id.optional(),
    /** SHA-256 of the exact execution request; prompt text is not stored here. */
    intentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    /** Private per-request credential; absent historical reservations cannot prove origin. */
    proofToken: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    title: z.string().min(1).max(80),
    messagingOrigin: z.object({
        connector: z.enum(['whatsapp', 'teams']), chatKey: id, threadId: id.optional(),
        desktopMirror: z.object({ workspaceId: id, processId: id, requestId: id, bindingId: id }).strict().optional(),
    }).strict().optional(),
    createdAt: z.iso.datetime(),
    admission: admissionSchema,
    transfer: z.object({
        attempts: z.number().int().nonnegative(),
        nextAttemptAt: z.number().nonnegative(),
        error: z.string().max(500).optional(),
    }).strict().optional(),
}).strict().superRefine((request, context) => {
    if ((request.kind === 'follow-up') !== !!request.targetProcessId) {
        context.addIssue({ code: 'custom', message: 'Only follow-ups require an exact target process' });
    }
    if (request.admission.state !== 'accepted') return;
    const { child } = request.admission;
    if ((request.kind === 'ralph') !== !!child.sessionId
        || (request.kind === 'follow-up' && child.processId !== request.targetProcessId)) {
        context.addIssue({ code: 'custom', message: 'Accepted child must match the reserved turn or whole Ralph session' });
    }
});

export type RemoteDelegationRequest = z.infer<typeof requestSchema>;
export type RemoteDelegationReservation = Omit<RemoteDelegationRequest,
    'requestId' | 'originServerIdentity' | 'createdAt' | 'admission' | 'proofToken' | 'transfer'> & { requestId?: string };

/**
 * Origin-owned admission journal, separate from terminal-result delivery.
 * Persist a dispatch claim before I/O. A claimed request is reconciliation-only,
 * even if the process dies before sending: an absent reply never permits replay.
 * Identities and digests are correlation data; callers must authenticate receipts.
 */
export class RemoteDelegationRequestStore {
    constructor(private readonly dataDir: string, private readonly jobs = new DelegatedJobStore(dataDir)) {}

    list(workspaceId: string): RemoteDelegationRequest[] {
        let raw: string;
        try { raw = fs.readFileSync(getRepoDataPath(this.dataDir, workspaceId, REMOTE_DELEGATION_REQUESTS_FILE), 'utf8'); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw error;
        }
        const rows = z.array(requestSchema).parse(JSON.parse(raw));
        if (rows.some(row => row.parent.workspaceId !== workspaceId || row.originServerIdentity !== this.jobs.serverIdentity)
            || new Set(rows.map(row => row.requestId)).size !== rows.length) {
            throw new Error('Invalid remote request ownership or duplicate request identity');
        }
        return rows;
    }

    reserve(input: RemoteDelegationReservation): RemoteDelegationRequest {
        return this.reserveClaim(input, false).request;
    }

    /** Atomically publish a consumed dispatch claim before the only execution POST. */
    reserveDispatch(input: RemoteDelegationReservation): { request: RemoteDelegationRequest; execute: boolean } {
        return this.reserveClaim(input, true);
    }

    private reserveClaim(input: RemoteDelegationReservation, dispatch: boolean): { request: RemoteDelegationRequest; execute: boolean } {
        const request = requestSchema.parse({ ...input, proofToken: randomBytes(32).toString('hex'),
            requestId: input.requestId === undefined ? randomUUID() : input.requestId,
            originServerIdentity: this.jobs.serverIdentity, createdAt: new Date().toISOString(), admission: { state: dispatch ? 'dispatching' : 'reserved' } });
        const rows = this.list(request.parent.workspaceId);
        const existing = rows.find(row => row.requestId === request.requestId);
        if (existing) {
            const identity = (row: RemoteDelegationRequest) => JSON.stringify({
                parent: row.parent, destination: row.destination, kind: row.kind, targetProcessId: row.targetProcessId,
                intentDigest: row.intentDigest, title: row.title, messagingOrigin: row.messagingOrigin,
            });
            if (identity(existing) !== identity(request)) throw new Error('Remote request identity cannot be reassigned');
            return { request: existing, execute: false };
        }
        rows.push(request);
        this.save(request.parent.workspaceId, rows);
        return { request, execute: dispatch };
    }

    rejectReserved(workspaceId: string, requestId: string): void {
        const rows = this.list(workspaceId);
        const request = this.require(rows, requestId);
        if (request.admission.state !== 'reserved') return;
        request.admission = { state: 'rejected', reason: 'Origin stopped before dispatch; no remote work was sent.' };
        this.save(workspaceId, rows);
    }

    /** Read-only proof, available after the durable dispatch claim, including recovery. */
    proveOrigin(input: unknown): RemoteDelegationProof | undefined {
        const parsed = remoteDelegationClaimSchema.safeParse(input);
        if (!parsed.success) return undefined;
        const claim = parsed.data;
        const request = this.list(claim.parent.workspaceId).find(row => row.requestId === claim.requestId);
        if (!request?.proofToken || !timingSafeEqual(Buffer.from(request.proofToken, 'hex'), Buffer.from(claim.proofToken, 'hex'))
            || request.admission.state === 'reserved' || request.admission.state === 'rejected') return undefined;
        const proof: RemoteDelegationProof = {
            version: 1, requestId: request.requestId, originServerIdentity: request.originServerIdentity,
            parent: request.parent,
            destination: { serverIdentity: request.destination.serverIdentity, workspaceId: request.destination.workspaceId },
            kind: request.kind, ...(request.targetProcessId ? { targetProcessId: request.targetProcessId } : {}),
            intentDigest: request.intentDigest, admission: request.admission.state,
        };
        return sameRemoteDelegationBinding(claim, proof) ? proof : undefined;
    }

    /** The only transition that permits one execution POST. False means do not send. */
    beginDispatch(workspaceId: string, requestId: string): boolean {
        const rows = this.list(workspaceId);
        const request = this.require(rows, requestId);
        if (request.admission.state !== 'reserved') return false;
        request.admission = { state: 'dispatching' };
        this.save(workspaceId, rows);
        return true;
    }

    /** Safe diagnostic text only; never persist raw transport bodies or credentials. */
    settleDispatch(workspaceId: string, requestId: string, state: 'uncertain' | 'rejected', reason: string): void {
        const rows = this.list(workspaceId);
        const request = this.require(rows, requestId);
        if (request.admission.state === 'accepted' || request.admission.state === 'rejected') return;
        if (request.admission.state === 'reserved') throw new Error('Remote request has not been dispatched');
        request.admission = { state, reason: reason.slice(0, 2_000) };
        this.save(workspaceId, rows);
    }

    /**
     * Called only after the transport verifies the receipt's owner and request.
     * Publish admission before the delegated job: recovery repairs a failed second
     * write, without submitting execution again or inventing an unknown child ID.
     */
    accept(workspaceId: string, receipt: {
        requestId: string; originServerIdentity: string; serverIdentity: string; workspaceId: string;
        intentDigest: string; kind: RemoteDelegationRequest['kind']; child: z.infer<typeof childSchema>;
    }): DelegatedJob {
        const rows = this.list(workspaceId);
        const request = this.require(rows, receipt.requestId);
        if (receipt.originServerIdentity !== request.originServerIdentity
            || receipt.serverIdentity !== request.destination.serverIdentity || receipt.workspaceId !== request.destination.workspaceId
            || receipt.intentDigest !== request.intentDigest || receipt.kind !== request.kind) {
            throw new Error('Remote admission receipt does not match the reserved owner and request');
        }
        const next = requestSchema.parse({ ...request, admission: { state: 'accepted', child: receipt.child } });
        if (request.admission.state === 'accepted') {
            if (JSON.stringify(request.admission) !== JSON.stringify(next.admission)) throw new Error('Accepted remote child cannot be reassigned');
        } else {
            if (request.admission.state === 'reserved' || request.admission.state === 'rejected') {
                throw new Error('Remote request cannot accept a receipt in its current state');
            }
            rows[rows.indexOf(request)] = next;
            this.save(workspaceId, rows);
        }
        return this.registerAccepted(next);
    }

    /** Recovery may repair registration; it must never call remote execution. */
    recoverAccepted(workspaceId: string): DelegatedJob[] {
        return this.list(workspaceId).filter(row => row.admission.state === 'accepted').map(row => this.registerAccepted(row));
    }

    recordTransfer(workspaceId: string, requestId: string, error?: string): void {
        const rows = this.list(workspaceId);
        const request = this.require(rows, requestId);
        const attempts = Math.min((request.transfer?.attempts ?? 0) + 1, 30);
        request.transfer = { attempts, nextAttemptAt: Date.now() + Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6)),
            ...(error ? { error: error.slice(0, 500) } : {}) };
        this.save(workspaceId, rows);
    }

    private registerAccepted(request: RemoteDelegationRequest): DelegatedJob {
        if (request.admission.state !== 'accepted') throw new Error('Remote request is not accepted');
        return this.jobs.register({
            id: `remote:${request.requestId}`, parent: request.parent, title: request.title,
            child: { ...request.admission.child, workspaceId: request.destination.workspaceId,
                serverId: request.destination.serverId,
                ...(request.kind === 'follow-up' ? { requestId: request.requestId } : {}) },
            remote: { originServerIdentity: request.originServerIdentity, serverIdentity: request.destination.serverIdentity,
                requestId: request.requestId, kind: request.kind },
            ...(request.messagingOrigin ? { messagingOrigin: request.messagingOrigin } : {}),
        });
    }

    private require(rows: RemoteDelegationRequest[], requestId: string): RemoteDelegationRequest {
        const request = rows.find(row => row.requestId === requestId);
        if (!request) throw new Error('Remote request is not reserved in this workspace');
        return request;
    }

    private save(workspaceId: string, rows: RemoteDelegationRequest[]): void {
        atomicWriteJsonUnique(getRepoDataPath(this.dataDir, workspaceId, REMOTE_DELEGATION_REQUESTS_FILE), z.array(requestSchema).parse(rows), 0o600);
    }
}
