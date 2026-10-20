import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getRepoDataPath } from '../paths';
import { getOrCreateServerIdentity } from '../servers/server-identity';
import { atomicWriteJsonUnique } from '../shared/fs-utils';
import {
    remoteDelegationBindingSchema, remoteDelegationProofSchema, sameRemoteDelegationBinding,
    type RemoteDelegationBinding, type RemoteDelegationProof,
} from './remote-delegation-auth';

export const REMOTE_DELEGATION_ADMISSIONS_FILE = 'remote-delegation-admissions.json';
const id = z.string().min(1).max(512).refine(value => !!value.trim());
const childSchema = z.object({ processId: id, sessionId: id.optional() }).strict();
const admissionSchema = z.discriminatedUnion('state', [
    z.object({ state: z.literal('dispatching') }).strict(),
    z.object({ state: z.literal('uncertain') }).strict(),
    z.object({ state: z.literal('rejected') }).strict(),
    z.object({ state: z.literal('accepted'), child: childSchema }).strict(),
]);
const receiptSchema = remoteDelegationBindingSchema.extend({
    /** Destination-local task/relay identity, independent of colliding origin request IDs. */
    executionId: z.uuid(), createdAt: z.iso.datetime(), admission: admissionSchema,
}).superRefine((row, context) => {
    if ((row.kind === 'follow-up') !== !!row.targetProcessId) {
        context.addIssue({ code: 'custom', message: 'Only follow-ups require an exact target' });
    }
    if (row.admission.state !== 'accepted') return;
    const child = row.admission.child;
    if ((row.kind === 'ralph') !== !!child.sessionId
        || (row.kind === 'follow-up' && child.processId !== row.targetProcessId)) {
        context.addIssue({ code: 'custom', message: 'Child must match the exact turn or whole Ralph session' });
    }
});
export type RemoteDelegationAdmission = z.infer<typeof receiptSchema>;
export type RemoteDelegationChild = z.infer<typeof childSchema>;
const key = (binding: RemoteDelegationBinding) => JSON.stringify([
    binding.originServerIdentity, binding.parent.workspaceId, binding.requestId,
]);

/**
 * Destination-owned execution claims. All methods require a previously authenticated
 * binding; storage validation itself is not authentication. A claimed request can
 * only be reconciled, even after a crash before dispatch. No prompt or token is saved.
 */
export class RemoteDelegationAdmissionStore {
    readonly serverIdentity: string;
    constructor(private readonly dataDir: string) {
        this.serverIdentity = getOrCreateServerIdentity(dataDir);
    }

    list(workspaceId: string): RemoteDelegationAdmission[] {
        let raw: string;
        try { raw = fs.readFileSync(getRepoDataPath(this.dataDir, workspaceId, REMOTE_DELEGATION_ADMISSIONS_FILE), 'utf8'); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw error;
        }
        const rows = z.array(receiptSchema).parse(JSON.parse(raw));
        this.validate(workspaceId, rows);
        return rows;
    }

    /** Persist before execution. A duplicate never grants another execution attempt. */
    claim(input: RemoteDelegationProof): { execute: boolean; receipt: RemoteDelegationAdmission } {
        const proof = remoteDelegationProofSchema.parse(input);
        const binding = this.binding(proof);
        const rows = this.list(binding.destination.workspaceId);
        const existing = this.find(rows, binding);
        if (existing) return { execute: false, receipt: existing };
        // An origin which already accepted work may reconcile, never invent a lost child.
        if (proof.admission === 'accepted') throw new Error('Accepted origin requires an existing destination receipt');
        const receipt = receiptSchema.parse({ ...binding, executionId: randomUUID(),
            createdAt: new Date().toISOString(), admission: { state: 'dispatching' } });
        this.save(binding.destination.workspaceId, [...rows, receipt]);
        return { execute: true, receipt };
    }

    /** Read-only reconciliation, including receipts left dispatching by a crashed adapter. */
    get(input: RemoteDelegationBinding): RemoteDelegationAdmission | undefined {
        const binding = this.binding(input);
        return this.find(this.list(binding.destination.workspaceId), binding);
    }

    accept(input: RemoteDelegationBinding, child: RemoteDelegationChild): RemoteDelegationAdmission {
        const binding = this.binding(input);
        const rows = this.list(binding.destination.workspaceId);
        const row = this.require(rows, binding);
        const next = receiptSchema.parse({ ...row, admission: { state: 'accepted', child } });
        if (row.admission.state === 'accepted') {
            if (JSON.stringify(row.admission) !== JSON.stringify(next.admission)) throw new Error('Accepted child cannot be reassigned');
            return row;
        }
        if (row.admission.state === 'rejected') throw new Error('Rejected admission cannot accept a child');
        rows[rows.indexOf(row)] = next;
        this.save(binding.destination.workspaceId, rows);
        return next;
    }

    settle(input: RemoteDelegationBinding, state: 'uncertain' | 'rejected'): RemoteDelegationAdmission {
        const binding = this.binding(input);
        const rows = this.list(binding.destination.workspaceId);
        const row = this.require(rows, binding);
        if (row.admission.state === 'accepted' || row.admission.state === 'rejected') return row;
        const next = receiptSchema.parse({ ...row, admission: { state } });
        rows[rows.indexOf(row)] = next;
        this.save(binding.destination.workspaceId, rows);
        return next;
    }

    private binding(input: RemoteDelegationBinding): RemoteDelegationBinding {
        // Pick fields explicitly: private claims and origin status never enter the receipt.
        const binding = remoteDelegationBindingSchema.parse({
            version: input.version, requestId: input.requestId, originServerIdentity: input.originServerIdentity,
            parent: input.parent, destination: input.destination, kind: input.kind,
            ...(input.targetProcessId !== undefined ? { targetProcessId: input.targetProcessId } : {}),
            intentDigest: input.intentDigest,
        });
        if (binding.destination.serverIdentity !== this.serverIdentity || binding.originServerIdentity === this.serverIdentity
            || ((binding.kind === 'follow-up') !== !!binding.targetProcessId)) throw new Error('Invalid destination admission owner or target');
        return binding;
    }

    private find(rows: RemoteDelegationAdmission[], binding: RemoteDelegationBinding): RemoteDelegationAdmission | undefined {
        const row = rows.find(candidate => key(candidate) === key(binding));
        if (row && !sameRemoteDelegationBinding(row, binding)) throw new Error('Remote request binding cannot be reassigned');
        return row;
    }

    private require(rows: RemoteDelegationAdmission[], binding: RemoteDelegationBinding): RemoteDelegationAdmission {
        const row = this.find(rows, binding);
        if (!row) throw new Error('Destination execution has not been claimed');
        return row;
    }

    private validate(workspaceId: string, rows: RemoteDelegationAdmission[]): void {
        const keys = new Set<string>();
        const executions = new Set<string>();
        const children = new Set<string>();
        const sessions = new Set<string>();
        for (const row of rows) {
            this.binding(row);
            if (row.destination.workspaceId !== workspaceId || keys.has(key(row)) || executions.has(row.executionId)) {
                throw new Error('Invalid or duplicate destination receipt');
            }
            keys.add(key(row));
            executions.add(row.executionId);
            if (row.admission.state !== 'accepted') continue;
            const child = row.admission.child;
            if (row.kind !== 'follow-up') {
                if (children.has(child.processId)) throw new Error('Duplicate destination child');
                children.add(child.processId);
            }
            if (child.sessionId) {
                if (sessions.has(child.sessionId)) throw new Error('Duplicate destination Ralph session');
                sessions.add(child.sessionId);
            }
        }
    }

    private save(workspaceId: string, rows: RemoteDelegationAdmission[]): void {
        const parsed = z.array(receiptSchema).parse(rows);
        this.validate(workspaceId, parsed);
        atomicWriteJsonUnique(getRepoDataPath(this.dataDir, workspaceId, REMOTE_DELEGATION_ADMISSIONS_FILE), parsed, 0o600);
    }
}
