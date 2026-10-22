import { createHash } from 'node:crypto';
import { z } from 'zod';
import { isValidWorkspaceId } from '../tasks/comments/base-comments-manager';
import {
    parseRemoteDelegationClaim, RemoteDelegationRefusedError,
    type RemoteDelegationBinding,
} from './remote-delegation-auth';
import {
    RemoteDelegationAdmissionStore, RemoteDelegationReceiptOwnerError, type RemoteDelegationAdmission, type RemoteDelegationChild,
} from './remote-delegation-admission-store';

const intentSchema = z.object({
    version: z.literal(1), kind: z.enum(['launch', 'follow-up', 'ralph']),
    workspaceId: z.string().refine(isValidWorkspaceId),
    targetProcessId: z.string().min(1).max(512).refine(value => !!value.trim()).optional(),
    body: z.record(z.string(), z.json()),
}).strict().refine(value => (value.kind === 'follow-up') === !!value.targetProcessId);
export type RemoteDelegationIntent = z.infer<typeof intentSchema>;

/**
 * Hash the complete wire execution envelope, independent of object key order.
 * Capture JSON before any await; the domain adapter must validate and execute this
 * captured body with the envelope's exact owner/target, not reread caller objects.
 */
export function captureRemoteDelegationIntent(input: unknown): { intent: RemoteDelegationIntent; digest: string } {
    const chunks: string[] = [];
    let bytes = 0;
    let nodes = 0;
    const invalid = () => new Error('Invalid or oversized remote execution intent');
    const write = (text: string) => {
        bytes += Buffer.byteLength(text);
        if (bytes > 1_048_576) throw invalid();
        chunks.push(text);
    };
    const encode = (value: unknown, depth: number): void => {
        if (depth > 32 || ++nodes > 100_000) throw invalid();
        if (value === null || typeof value === 'boolean' || typeof value === 'string'
            || (typeof value === 'number' && Number.isFinite(value))) {
            write(JSON.stringify(value));
        } else if (Array.isArray(value)) {
            write('[');
            for (let i = 0; i < value.length; i++) {
                if (i) write(',');
                encode(value[i], depth + 1);
            }
            write(']');
        } else if (value && typeof value === 'object'
            && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
            write('{');
            const keys = Object.keys(value).sort();
            for (let i = 0; i < keys.length; i++) {
                if (i) write(',');
                write(JSON.stringify(keys[i]));
                write(':');
                encode((value as Record<string, unknown>)[keys[i]], depth + 1);
            }
            write('}');
        } else throw invalid();
    };
    encode(input, 0);
    const canonical = chunks.join('');
    const captured = JSON.parse(canonical);
    intentSchema.parse(captured);
    // Record parsers may discard special keys. Execute the exact JSON we hashed.
    return { intent: captured as RemoteDelegationIntent, digest: createHash('sha256').update(canonical).digest('hex') };
}

export type RemoteDelegationDispatch = (input: {
    binding: RemoteDelegationBinding; intent: RemoteDelegationIntent;
    /** Use for destination task/relay IDs; never use the origin's raw request ID. */
    executionId: string;
}) => Promise<
    { state: 'accepted'; child: RemoteDelegationChild } | { state: 'rejected' }>;
/** Inspect durable domain records only. This callback must never enqueue or execute. */
export type RemoteDelegationFindChild = (receipt: RemoteDelegationAdmission) => Promise<RemoteDelegationChild | undefined>;

/**
 * Destination gateway; execution adapters are supplied by route composition.
 * It never contacts the origin: see `parseRemoteDelegationClaim` for the trust model.
 */
export class RemoteDelegationAdmissionService {
    constructor(private readonly store: RemoteDelegationAdmissionStore) {}

    async admit(input: unknown, execution: unknown, dispatch: RemoteDelegationDispatch): Promise<RemoteDelegationAdmission> {
        const claim = parseRemoteDelegationClaim(input, this.store.serverIdentity);
        let captured: ReturnType<typeof captureRemoteDelegationIntent>;
        try { captured = captureRemoteDelegationIntent(execution); }
        catch { throw new RemoteDelegationRefusedError('Invalid remote execution intent'); }
        const { intent, digest } = captured;
        if (digest !== claim.intentDigest || intent.kind !== claim.kind
            || intent.workspaceId !== claim.destination.workspaceId || intent.targetProcessId !== claim.targetProcessId) {
            throw new RemoteDelegationRefusedError('Remote execution intent does not match the origin reservation');
        }
        let receipt: RemoteDelegationAdmission;
        let execute: boolean;
        try { ({ receipt, execute } = this.store.claim(claim)); }
        catch (error) {
            if (error instanceof RemoteDelegationReceiptOwnerError) throw error;
            throw new Error('Destination admission is unavailable; do not retry execution');
        }
        if (!execute) return receipt;
        try {
            // The durable claim remains consumed even if dispatch throws or its reply is lost.
            const outcome = await dispatch({ binding: remoteDelegationBinding(claim), intent, executionId: receipt.executionId });
            if (outcome.state === 'accepted') return this.store.accept(claim, outcome.child);
            if (outcome.state === 'rejected') return this.store.settle(claim, 'rejected');
            throw new Error('Unrecognized execution admission outcome');
        } catch {
            try { return this.store.settle(claim, 'uncertain'); }
            catch { throw new Error('Destination admission could not be recorded; do not retry execution'); }
        }
    }

    /** Owner-only receipt reconciliation; only durable domain evidence can repair acceptance. */
    async reconcile(input: unknown, findChild?: RemoteDelegationFindChild): Promise<RemoteDelegationAdmission | undefined> {
        const claim = parseRemoteDelegationClaim(input, this.store.serverIdentity);
        try {
            const receipt = this.store.owned(claim);
            if (receipt && (receipt.admission.state === 'dispatching' || receipt.admission.state === 'uncertain') && findChild) {
                const child = await findChild(receipt);
                if (child) return this.store.accept(claim, child);
            }
            return receipt;
        }
        catch { throw new Error('Destination admission receipt is unavailable'); }
    }
}

function remoteDelegationBinding(claim: RemoteDelegationBinding): RemoteDelegationBinding {
    return {
        version: claim.version, requestId: claim.requestId, originServerIdentity: claim.originServerIdentity,
        parent: claim.parent, destination: claim.destination, kind: claim.kind,
        ...(claim.targetProcessId ? { targetProcessId: claim.targetProcessId } : {}), intentDigest: claim.intentDigest,
    };
}
