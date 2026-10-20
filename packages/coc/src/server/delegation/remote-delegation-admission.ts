import { createHash } from 'node:crypto';
import { z } from 'zod';
import { isValidWorkspaceId } from '../tasks/comments/base-comments-manager';
import {
    remoteDelegationClaimSchema, verifyRemoteDelegationOrigin,
    type RemoteDelegationBinding,
} from './remote-delegation-auth';
import {
    RemoteDelegationAdmissionStore, type RemoteDelegationAdmission, type RemoteDelegationChild,
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

type OriginVerificationOptions = Omit<Parameters<typeof verifyRemoteDelegationOrigin>[1], 'serverIdentity'>;
export type RemoteDelegationDispatch = (input: {
    binding: RemoteDelegationBinding; intent: RemoteDelegationIntent;
    /** Use for destination task/relay IDs; never use the origin's raw request ID. */
    executionId: string;
}) => Promise<
    { state: 'accepted'; child: RemoteDelegationChild } | { state: 'rejected' }>;
/** Inspect durable domain records only. This callback must never enqueue or execute. */
export type RemoteDelegationFindChild = (receipt: RemoteDelegationAdmission) => Promise<RemoteDelegationChild | undefined>;

/** Authenticated destination gateway; execution adapters are supplied by route composition. */
export class RemoteDelegationAdmissionService {
    constructor(private readonly store: RemoteDelegationAdmissionStore, private readonly options: OriginVerificationOptions) {}

    async admit(input: unknown, execution: unknown, dispatch: RemoteDelegationDispatch): Promise<RemoteDelegationAdmission> {
        const claim = remoteDelegationClaimSchema.parse(input);
        const { intent, digest } = captureRemoteDelegationIntent(execution);
        if (digest !== claim.intentDigest || intent.kind !== claim.kind
            || intent.workspaceId !== claim.destination.workspaceId || intent.targetProcessId !== claim.targetProcessId) {
            throw new Error('Remote execution intent does not match the origin reservation');
        }
        const proof = await this.verify(claim);
        this.options.signal?.throwIfAborted();
        let receipt: RemoteDelegationAdmission;
        let execute: boolean;
        try { ({ receipt, execute } = this.store.claim(proof)); }
        catch { throw new Error('Destination admission is unavailable; do not retry execution'); }
        if (!execute) return receipt;
        try {
            // The durable claim remains consumed even if dispatch throws or its reply is lost.
            const outcome = await dispatch({ binding: remoteDelegationBinding(proof), intent, executionId: receipt.executionId });
            if (outcome.state === 'accepted') return this.store.accept(proof, outcome.child);
            if (outcome.state === 'rejected') return this.store.settle(proof, 'rejected');
            throw new Error('Unrecognized execution admission outcome');
        } catch {
            try { return this.store.settle(proof, 'uncertain'); }
            catch { throw new Error('Destination admission could not be recorded; do not retry execution'); }
        }
    }

    /** Authenticated receipt reconciliation; only durable domain evidence can repair acceptance. */
    async reconcile(input: unknown, findChild?: RemoteDelegationFindChild): Promise<RemoteDelegationAdmission | undefined> {
        const proof = await this.verify(input);
        this.options.signal?.throwIfAborted();
        try {
            const receipt = this.store.get(proof);
            if (receipt && (receipt.admission.state === 'dispatching' || receipt.admission.state === 'uncertain') && findChild) {
                const child = await findChild(receipt);
                this.options.signal?.throwIfAborted();
                if (child) return this.store.accept(proof, child);
            }
            return receipt;
        }
        catch {
            this.options.signal?.throwIfAborted();
            throw new Error('Destination admission receipt is unavailable');
        }
    }

    private verify(input: unknown) {
        return verifyRemoteDelegationOrigin(input, { ...this.options, serverIdentity: this.store.serverIdentity });
    }
}

function remoteDelegationBinding(proof: RemoteDelegationBinding): RemoteDelegationBinding {
    return {
        version: proof.version, requestId: proof.requestId, originServerIdentity: proof.originServerIdentity,
        parent: proof.parent, destination: proof.destination, kind: proof.kind,
        ...(proof.targetProcessId ? { targetProcessId: proof.targetProcessId } : {}), intentDigest: proof.intentDigest,
    };
}
