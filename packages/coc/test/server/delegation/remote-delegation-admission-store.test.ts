import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    RemoteDelegationAdmissionStore, REMOTE_DELEGATION_ADMISSIONS_FILE,
} from '../../../src/server/delegation/remote-delegation-admission-store';
import type { RemoteDelegationProof } from '../../../src/server/delegation/remote-delegation-auth';
import { getRepoDataPath } from '../../../src/server/paths';
import { createDelegatedJobsDomain } from '../../../src/server/storage/snapshot/delegated-jobs-domain';
import type { StorageSnapshotContext } from '../../../src/server/storage/snapshot/types';

vi.mock('node:fs', async importOriginal => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

describe('destination remote delegation admission', () => {
    let dataDir: string;
    let store: RemoteDelegationAdmissionStore;
    let proof: RemoteDelegationProof;
    const workspaceId = 'destination-repo';
    const file = () => getRepoDataPath(dataDir, workspaceId, REMOTE_DELEGATION_ADMISSIONS_FILE);
    const restart = () => new RemoteDelegationAdmissionStore(dataDir);
    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-admission-'));
        store = restart();
        proof = { version: 1, requestId: randomUUID(), originServerIdentity: 'origin-owner',
            parent: { workspaceId: 'origin-repo', processId: 'sentinel-1' },
            destination: { serverIdentity: store.serverIdentity, workspaceId },
            kind: 'launch', intentDigest: 'a'.repeat(64), admission: 'dispatching' };
    });
    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('publishes one private-mode claim before dispatch and never reclaims after restart', () => {
        const claim = store.claim(proof);
        expect(claim.execute).toBe(true);
        expect(claim.receipt).toMatchObject({ ...proof, admission: { state: 'dispatching' } });
        expect(claim.receipt.executionId).toMatch(/^[a-f0-9-]{36}$/);
        expect(restart().claim(proof)).toEqual({ execute: false, receipt: claim.receipt });
        expect(restart().get(proof)).toEqual(claim.receipt);
        expect(restart().list('different-repo')).toEqual([]);
        if (process.platform !== 'win32') expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
        // Mutating a returned receipt does not change the ledger.
        claim.receipt.parent.processId = 'changed';
        expect(restart().get(proof)?.parent.processId).toBe('sentinel-1');
    });

    it('grants no execution permission if persistence fails', () => {
        vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw new Error('disk full'); });
        expect(() => store.claim(proof)).toThrow('disk full');
        expect(restart().get(proof)).toBeUndefined();
        expect(store.claim(proof).execute).toBe(true);
    });

    it.each(['launch', 'follow-up', 'ralph'] as const)('persists immutable accepted %s identity and late reconciliation', kind => {
        proof = { ...proof, kind, ...(kind === 'follow-up' ? { targetProcessId: 'existing-chat' } : {}) };
        store.claim(proof);
        store.settle(proof, 'uncertain');
        const child = { processId: kind === 'follow-up' ? 'existing-chat' : 'queue-child',
            ...(kind === 'ralph' ? { sessionId: 'whole-session' } : {}) };
        const accepted = restart().accept(proof, child);
        expect(accepted.admission).toEqual({ state: 'accepted', child });
        expect(restart().accept(proof, child)).toEqual(accepted);
        expect(restart().claim({ ...proof, admission: 'accepted' })).toEqual({ execute: false, receipt: accepted });
        expect(store.settle(proof, 'rejected')).toEqual(accepted);
        expect(store.settle(proof, 'uncertain')).toEqual(accepted);
        expect(() => store.accept(proof, { ...child, processId: 'another' })).toThrow();
        if (kind === 'ralph') expect(() => store.accept(proof, { ...child, sessionId: 'another' })).toThrow();
    });

    it('never invents execution or a child when origin already accepted but destination receipt is missing', () => {
        expect(() => store.claim({ ...proof, admission: 'accepted' })).toThrow('existing destination receipt');
        expect(store.get(proof)).toBeUndefined();
        expect(() => store.accept(proof, { processId: 'invented' })).toThrow('not been claimed');
        expect(() => store.settle(proof, 'uncertain')).toThrow('not been claimed');
    });

    it('makes rejection terminal and retains uncertain claims without replay', () => {
        store.claim(proof);
        expect(store.settle(proof, 'uncertain').admission.state).toBe('uncertain');
        expect(restart().claim(proof).execute).toBe(false);
        const rejected = store.settle(proof, 'rejected');
        expect(store.settle(proof, 'uncertain')).toEqual(rejected);
        expect(restart().claim(proof).execute).toBe(false);
        expect(() => store.accept(proof, { processId: 'child' })).toThrow('Rejected');
    });

    it('does not publish acceptance on write failure and repairs bookkeeping without execution', () => {
        store.claim(proof);
        vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw new Error('disk full'); });
        expect(() => store.accept(proof, { processId: 'child' })).toThrow('disk full');
        expect(restart().get(proof)?.admission.state).toBe('dispatching');
        expect(restart().claim(proof).execute).toBe(false);
        expect(restart().accept(proof, { processId: 'child' }).admission.state).toBe('accepted');
    });

    const result = () => ({ terminalEventId: 'caller-event', outcome: 'completed' as const,
        summary: 'x'.repeat(10_000), reason: 'r'.repeat(3_000), links: ['#chat-reference'] });

    it('bounds and persists the first terminal result under the exact origin request', () => {
        store.claim(proof); store.accept(proof, { processId: 'child' });
        expect(store.recordResult(proof, result())).toBe(true);
        const terminal = restart().get(proof)!.terminal!;
        expect(terminal.result.summary).toHaveLength(8_000);
        expect(terminal.result.reason).toHaveLength(2_000);
        expect(terminal.result.terminalEventId).toContain(JSON.stringify([proof.originServerIdentity, proof.parent.workspaceId, proof.requestId]));
        expect(restart().recordResult(proof, { ...result(), outcome: 'failed', summary: 'Conflicting late result' })).toBe(false);
        expect(restart().get(proof)!.terminal).toEqual(terminal);
        expect(restart().claim(proof).execute).toBe(false);
    });

    it('keeps a failed terminal publication recoverable and never grants execution replay', () => {
        store.claim(proof); store.accept(proof, { processId: 'child' });
        vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw new Error('disk full'); });
        expect(() => store.recordResult(proof, result())).toThrow('disk full');
        expect(restart().get(proof)!.terminal).toBeUndefined();
        expect(restart().claim(proof).execute).toBe(false);
        expect(restart().recordResult(proof, result())).toBe(true);
    });

    it.each(['dispatching', 'uncertain', 'rejected'] as const)('does not invent an outcome for %s admission', state => {
        store.claim(proof);
        if (state !== 'dispatching') store.settle(proof, state);
        expect(() => store.recordResult(proof, result())).toThrow('not accepted');
        expect(restart().get(proof)!.terminal).toBeUndefined();
    });

    it('rejects a result with reassigned request ownership or malformed outcome', () => {
        store.claim(proof); store.accept(proof, { processId: 'child' });
        expect(() => store.recordResult({ ...proof, parent: { ...proof.parent, processId: 'other-parent' } }, result())).toThrow();
        expect(() => store.recordResult(proof, { ...result(), outcome: 'running' as any })).toThrow();
        expect(restart().get(proof)!.terminal).toBeUndefined();
    });

    it('keeps colliding origin IDs separate by installation and parent workspace', () => {
        const second = { ...proof, originServerIdentity: 'second-origin' };
        const third = { ...proof, parent: { ...proof.parent, workspaceId: 'second-origin-repo' } };
        const fourth = { ...proof, destination: { ...proof.destination, workspaceId: 'second-destination-repo' } };
        const claims = [proof, second, third, fourth].map(binding => store.claim(binding));
        expect(new Set(claims.map(claim => claim.receipt.executionId)).size).toBe(4);
        expect(store.list(workspaceId)).toHaveLength(3);
        expect(store.list('second-destination-repo')).toHaveLength(1);
        for (const binding of [proof, second, third, fourth]) expect(restart().claim(binding).execute).toBe(false);
    });

    it.each(['parent', 'digest', 'kind'] as const)('rejects reassigned %s within an existing request key', field => {
        store.claim(proof);
        const changed = field === 'parent' ? { ...proof, parent: { ...proof.parent, processId: 'another' } }
            : field === 'digest' ? { ...proof, intentDigest: 'b'.repeat(64) } : { ...proof, kind: 'ralph' as const };
        const bytes = fs.readFileSync(file(), 'utf8');
        expect(() => store.claim(changed)).toThrow('cannot be reassigned');
        expect(() => store.get(changed)).toThrow('cannot be reassigned');
        expect(() => store.accept(changed, { processId: 'child' })).toThrow();
        expect(fs.readFileSync(file(), 'utf8')).toBe(bytes);
    });

    it.each(['wrong-owner', 'self-origin', 'bad-workspace', 'missing-target', 'extra-target'])(
        'refuses %s before any write', change => {
            const changed = change === 'wrong-owner' ? { ...proof, destination: { ...proof.destination, serverIdentity: 'other' } }
                : change === 'self-origin' ? { ...proof, originServerIdentity: store.serverIdentity }
                : change === 'bad-workspace' ? { ...proof, destination: { ...proof.destination, workspaceId: '../escape' } }
                : change === 'missing-target' ? { ...proof, kind: 'follow-up' as const }
                : { ...proof, targetProcessId: 'extra' };
            expect(() => store.claim(changed)).toThrow();
            expect(store.list(workspaceId)).toEqual([]);
        },
    );

    it.each(['launch', 'follow-up', 'ralph'] as const)('checks exact %s child shape', kind => {
        proof = { ...proof, kind, ...(kind === 'follow-up' ? { targetProcessId: 'exact-chat' } : {}) };
        store.claim(proof);
        const badChild = kind === 'ralph' ? { processId: 'iteration-only' }
            : kind === 'follow-up' ? { processId: 'other-chat' } : { processId: 'child', sessionId: 'unrelated' };
        expect(() => store.accept(proof, badChild)).toThrow();
        expect(store.get(proof)?.admission.state).toBe('dispatching');
    });

    it('allows repeated follow-ups to one chat and refuses reused launch children or Ralph sessions', () => {
        const followUp = { ...proof, kind: 'follow-up' as const, targetProcessId: 'same-chat' };
        const next = { ...followUp, requestId: randomUUID() };
        for (const binding of [followUp, next]) {
            store.claim(binding);
            store.accept(binding, { processId: 'same-chat' });
        }
        const launch = { ...proof, requestId: randomUUID() };
        const duplicateLaunch = { ...launch, requestId: randomUUID() };
        store.claim(launch);
        store.accept(launch, { processId: 'new-chat' });
        store.claim(duplicateLaunch);
        expect(() => store.accept(duplicateLaunch, { processId: 'new-chat' })).toThrow('Duplicate destination child');
        const ralph = { ...proof, kind: 'ralph' as const, requestId: randomUUID() };
        const duplicateRalph = { ...ralph, requestId: randomUUID() };
        store.claim(ralph);
        store.accept(ralph, { processId: 'iteration-one', sessionId: 'whole-session' });
        store.claim(duplicateRalph);
        expect(() => store.accept(duplicateRalph, { processId: 'different-iteration', sessionId: 'whole-session' }))
            .toThrow('Duplicate destination Ralph session');
    });

    it.each(['owner', 'workspace', 'duplicate', 'execution', 'state', 'token', 'json'])(
        'fails closed on corrupt %s receipts without replacing data', corruption => {
            const { receipt } = store.claim(proof);
            const contents = corruption === 'json' ? '{' : JSON.stringify(corruption === 'duplicate' ? [receipt, receipt]
                : corruption === 'execution' ? [receipt, { ...receipt, requestId: randomUUID() }]
                : [{ ...receipt, ...(corruption === 'owner' ? { destination: { ...receipt.destination, serverIdentity: 'other' } }
                    : corruption === 'workspace' ? { destination: { ...receipt.destination, workspaceId: 'other' } }
                    : corruption === 'token' ? { proofToken: 'private' } : { admission: { state: 'please-execute-again' } }) }]);
            fs.writeFileSync(file(), contents);
            expect(() => restart().list(workspaceId)).toThrow();
            expect(() => restart().claim(proof)).toThrow();
            expect(fs.readFileSync(file(), 'utf8')).toBe(contents);
        },
    );

    it('excludes destination claims from snapshots/import and clears them on wipe', async () => {
        const { receipt } = store.claim(proof);
        const domain = createDelegatedJobsDomain();
        const context = { dataDir, store: {} } as StorageSnapshotContext;
        expect((await domain.collect(context)).data).toEqual({});
        await domain.restoreReplace({} as never, context, {} as never);
        await domain.restoreMerge({} as never, context, {} as never);
        expect(store.get(proof)).toEqual(receipt);
        const plan = await domain.planWipe({ ...context, includeWikis: false });
        expect(plan.plan).toEqual([file()]);
        const result = { errors: [] as string[] };
        await domain.executeWipe({ ...context, includeWikis: false }, plan.plan, result);
        expect(result.errors).toEqual([]);
        expect(restart().get(proof)).toBeUndefined();
    });
});
