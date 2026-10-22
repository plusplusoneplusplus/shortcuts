import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { isValidWorkspaceId } from '../tasks/comments/base-comments-manager';

const id = z.string().min(1).max(512).refine(value => !!value.trim());
export const remoteDelegationBindingSchema = z.object({
    version: z.literal(1),
    requestId: z.uuid(),
    originServerIdentity: id,
    parent: z.object({ workspaceId: id.refine(isValidWorkspaceId), processId: id }).strict(),
    destination: z.object({ serverIdentity: id, workspaceId: id.refine(isValidWorkspaceId) }).strict(),
    kind: z.enum(['launch', 'follow-up', 'ralph']),
    targetProcessId: id.optional(),
    intentDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type RemoteDelegationBinding = z.infer<typeof remoteDelegationBindingSchema>;

/** Private per-request receipt secret: POST bodies only, never tool replies, query strings or logs. */
export const remoteDelegationClaimSchema = remoteDelegationBindingSchema.extend({
    proofToken: z.string().regex(/^[a-f0-9]{64}$/),
}).superRefine((claim, context) => {
    if ((claim.kind === 'follow-up') !== !!claim.targetProcessId) {
        context.addIssue({ code: 'custom', message: 'Only follow-ups require a target process' });
    }
});
export type RemoteDelegationClaim = z.infer<typeof remoteDelegationClaimSchema>;

/** Compare explicit fields so JSON property order cannot change correlation. */
export function sameRemoteDelegationBinding(a: RemoteDelegationBinding, b: RemoteDelegationBinding): boolean {
    return a.version === b.version && a.requestId === b.requestId
        && a.originServerIdentity === b.originServerIdentity
        && a.parent.workspaceId === b.parent.workspaceId && a.parent.processId === b.parent.processId
        && a.destination.serverIdentity === b.destination.serverIdentity && a.destination.workspaceId === b.destination.workspaceId
        && a.kind === b.kind && a.targetProcessId === b.targetProcessId && a.intentDigest === b.intentDigest;
}

/** Refused before any durable destination claim: no work was admitted by this request. */
export class RemoteDelegationRefusedError extends Error {}

/** Store only a digest; the private secret itself never persists at the destination. */
export function remoteDelegationTokenDigest(token: string): string {
    return createHash('sha256').update(token, 'hex').digest('hex');
}

/** Constant-time ownership check. Rows without a digest (legacy reverse-proof receipts) never match. */
export function ownsRemoteDelegationReceipt(digest: string | undefined, token: string): boolean {
    if (!digest) return false;
    return timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(remoteDelegationTokenDigest(token), 'hex'));
}

/**
 * Sender-only trust model; the destination never contacts the origin.
 * - Transport authorization: reaching this API at all (loopback, SSH or DevTunnel
 *   account access), the same boundary as ordinary remote `POST /api/queue`.
 * - Origin attribution: `originServerIdentity` is a caller-claimed label. It scopes
 *   receipt keys and result event IDs, never grants authority.
 * - Receipt ownership: the first durable claim binds a digest of the caller's private
 *   per-request secret. Later admission replays and receipt reads must present it.
 */
export function parseRemoteDelegationClaim(input: unknown, serverIdentity: string): RemoteDelegationClaim {
    const parsed = remoteDelegationClaimSchema.safeParse(input);
    if (!parsed.success || parsed.data.destination.serverIdentity !== serverIdentity
        || parsed.data.originServerIdentity === serverIdentity) {
        throw new RemoteDelegationRefusedError('Invalid remote delegation claim');
    }
    return parsed.data;
}
