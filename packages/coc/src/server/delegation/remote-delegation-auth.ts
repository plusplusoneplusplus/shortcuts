import { z } from 'zod';
import type { RemoteServerSource } from '../servers/workspace-directory';
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

/** Private wire credential: never include in tool replies, query strings or logs. */
export const remoteDelegationClaimSchema = remoteDelegationBindingSchema.extend({
    proofToken: z.string().regex(/^[a-f0-9]{64}$/),
}).superRefine((claim, context) => {
    if ((claim.kind === 'follow-up') !== !!claim.targetProcessId) {
        context.addIssue({ code: 'custom', message: 'Only follow-ups require a target process' });
    }
});
export type RemoteDelegationClaim = z.infer<typeof remoteDelegationClaimSchema>;
export const remoteDelegationProofSchema = remoteDelegationBindingSchema.extend({
    admission: z.enum(['dispatching', 'uncertain', 'accepted']),
});
export type RemoteDelegationProof = z.infer<typeof remoteDelegationProofSchema>;
export const REMOTE_DELEGATION_PROOF_PATH = '/api/remote-delegations/proof';

/** Compare explicit fields so JSON property order cannot change correlation. */
export function sameRemoteDelegationBinding(a: RemoteDelegationBinding, b: RemoteDelegationBinding): boolean {
    return a.version === b.version && a.requestId === b.requestId
        && a.originServerIdentity === b.originServerIdentity
        && a.parent.workspaceId === b.parent.workspaceId && a.parent.processId === b.parent.processId
        && a.destination.serverIdentity === b.destination.serverIdentity && a.destination.workspaceId === b.destination.workspaceId
        && a.kind === b.kind && a.targetProcessId === b.targetProcessId && a.intentDigest === b.intentDigest;
}

/**
 * Authenticate an origin reservation through its existing registered connection.
 * A public health UUID or payload-selected callback is never proof of origin.
 * This read is retryable; it does not authorize replaying execution. The caller
 * must check the execution digest and durably deduplicate before admitting work.
 */
export async function verifyRemoteDelegationOrigin(input: unknown, options: {
    serverIdentity: string;
    remotes: RemoteServerSource;
    signal?: AbortSignal;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
}): Promise<RemoteDelegationProof> {
    const failure = () => new Error('Remote origin reservation could not be authenticated.');
    const parsed = remoteDelegationClaimSchema.safeParse(input);
    if (!parsed.success || parsed.data.destination.serverIdentity !== options.serverIdentity
        || parsed.data.originServerIdentity === options.serverIdentity) throw failure();
    const claim = parsed.data;
    const source = options.remotes.list().find(server => server.status === 'online'
        && server.serverIdentity === claim.originServerIdentity && server.effectiveUrl);
    if (!source) throw failure();
    const target = { ...source };
    const controller = new AbortController();
    const assertCurrent = () => {
        options.signal?.throwIfAborted();
        if (controller.signal.aborted) throw failure();
        const current = options.remotes.list().find(server => server.id === target.id);
        if (!current || current.status !== 'online' || current.effectiveUrl !== target.effectiveUrl
            || current.serverIdentity !== target.serverIdentity || current.updatedAt !== target.updatedAt
            || current.kind !== target.kind) throw failure();
    };
    let rejectCancelled!: (reason: unknown) => void;
    const cancelled = new Promise<never>((_, reject) => { rejectCancelled = reject; });
    const cancel = () => { controller.abort(); rejectCancelled(failure()); };
    const timer = setTimeout(cancel, options.timeoutMs ?? 4_000);
    options.signal?.addEventListener('abort', cancel, { once: true });
    const request = async (path: string, body?: RemoteDelegationClaim): Promise<unknown> => {
        assertCurrent();
        const response = await (options.fetchImpl ?? fetch)(`${target.effectiveUrl}${path}`, {
            method: body ? 'POST' : 'GET', redirect: 'error', credentials: 'omit', signal: controller.signal,
            ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
        });
        const reader = response.body?.getReader();
        if (!reader) throw failure();
        const cancelRead = () => { void reader.cancel().catch(() => {}); };
        controller.signal.addEventListener('abort', cancelRead, { once: true });
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
            assertCurrent();
            if (!response.ok) throw failure();
            for (;;) {
                const { done, value } = await reader.read();
                assertCurrent();
                if (done) break;
                size += value.byteLength;
                if (size > 16_384) throw failure();
                chunks.push(value);
            }
            return JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } finally {
            controller.signal.removeEventListener('abort', cancelRead);
            void reader.cancel().catch(() => {});
            reader.releaseLock();
        }
    };
    try {
        return await Promise.race([cancelled, (async () => {
            const before = await request('/api/health') as { serverIdentity?: unknown } | null;
            if (before?.serverIdentity !== claim.originServerIdentity) throw failure();
            const proof = remoteDelegationProofSchema.parse(await request(REMOTE_DELEGATION_PROOF_PATH, claim));
            if (!sameRemoteDelegationBinding(claim, proof)) throw failure();
            const after = await request('/api/health') as { serverIdentity?: unknown } | null;
            if (after?.serverIdentity !== claim.originServerIdentity) throw failure();
            assertCurrent();
            return proof;
        })()]);
    } catch {
        options.signal?.throwIfAborted();
        throw failure();
    } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', cancel);
        controller.abort();
    }
}
