import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DelegatedJobStore, DELEGATED_JOBS_FILE } from '../../../src/server/delegation/delegated-job-store';
import {
    RemoteDelegationRequestStore, REMOTE_DELEGATION_REQUESTS_FILE,
    type RemoteDelegationRequest, type RemoteDelegationReservation,
} from '../../../src/server/delegation/remote-delegation-request-store';
import { getRepoDataPath } from '../../../src/server/paths';
import { createDelegatedJobsDomain } from '../../../src/server/storage/snapshot/delegated-jobs-domain';
import type { StorageSnapshotContext } from '../../../src/server/storage/snapshot/types';

vi.mock('node:fs', async importOriginal => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

const reservation: RemoteDelegationReservation = {
    parent: { workspaceId: 'origin-repo', processId: 'sentinel-1' },
    destination: { serverId: 'connection-1', serverIdentity: 'destination-owner', workspaceId: 'remote-repo' },
    kind: 'launch', intentDigest: 'a'.repeat(64), title: 'Fix login',
    messagingOrigin: { connector: 'teams', chatKey: 'chat-1', threadId: 'thread-1' },
};
const receiptFor = (request: RemoteDelegationRequest) => ({
    requestId: request.requestId, originServerIdentity: request.originServerIdentity,
    serverIdentity: request.destination.serverIdentity, workspaceId: request.destination.workspaceId,
    intentDigest: request.intentDigest, kind: request.kind,
    child: { processId: request.targetProcessId ?? 'queue_remote-1',
        ...(request.kind === 'ralph' ? { sessionId: 'ralph-session-1' } : {}) },
});

describe('RemoteDelegationRequestStore', () => {
    let dataDir: string;
    let jobs: DelegatedJobStore;
    let requests: RemoteDelegationRequestStore;
    const workspaceId = reservation.parent.workspaceId;
    const file = () => getRepoDataPath(dataDir, workspaceId, REMOTE_DELEGATION_REQUESTS_FILE);
    const restart = () => new RemoteDelegationRequestStore(dataDir);

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-delegation-requests-'));
        jobs = new DelegatedJobStore(dataDir);
        requests = new RemoteDelegationRequestStore(dataDir, jobs);
    });
    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('reserves before a child exists, with independent request IDs and exact owner scope', () => {
        const first = requests.reserve(reservation);
        const second = requests.reserve(reservation);
        expect(first.requestId).not.toBe(second.requestId);
        expect(first).toMatchObject({ ...reservation, originServerIdentity: jobs.serverIdentity, admission: { state: 'reserved' } });
        expect(restart().list(workspaceId)).toEqual([first, second]);
        expect(restart().list('remote-repo')).toEqual([]);
        expect(jobs.list(workspaceId)).toEqual([]);
        first.parent.processId = 'mutated';
        expect(restart().list(workspaceId)[0].parent.processId).toBe('sentinel-1');
        expect(fs.readFileSync(file(), 'utf8')).not.toContain('prompt');
    });

    it('reuses an explicit request only with its immutable intent and routing capture', () => {
        const first = requests.reserve(reservation);
        requests.beginDispatch(workspaceId, first.requestId);
        expect(restart().reserve({ ...reservation, requestId: first.requestId }).admission.state).toBe('dispatching');
        for (const change of [
            { parent: { ...reservation.parent, processId: 'other-sentinel' } },
            { destination: { ...reservation.destination, serverIdentity: 'replaced-owner' } },
            { destination: { ...reservation.destination, serverId: 'different-alias' } },
            { destination: { ...reservation.destination, workspaceId: 'different-target' } },
            { intentDigest: 'b'.repeat(64) }, { title: 'Different job' },
            { messagingOrigin: { connector: 'teams' as const, chatKey: 'different-chat' } },
        ]) {
            expect(() => requests.reserve({ ...reservation, requestId: first.requestId, ...change })).toThrow('cannot be reassigned');
        }
        expect(restart().list(workspaceId)).toHaveLength(1);
    });

    it('persists the dispatch claim before permission to send and never grants a second attempt', () => {
        const request = requests.reserve(reservation);
        const failedWrite = vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw new Error('disk full'); });
        expect(() => requests.beginDispatch(workspaceId, request.requestId)).toThrow('disk full');
        expect(restart().list(workspaceId)[0].admission.state).toBe('reserved');
        failedWrite.mockRestore();
        expect(restart().beginDispatch(workspaceId, request.requestId)).toBe(true);
        // Simulate death immediately after the claim, before any response is recorded.
        expect(restart().beginDispatch(workspaceId, request.requestId)).toBe(false);
        requests.settleDispatch(workspaceId, request.requestId, 'uncertain', 'Response lost');
        expect(restart().beginDispatch(workspaceId, request.requestId)).toBe(false);
        expect(requests.recoverAccepted(workspaceId)).toEqual([]);
        expect(jobs.list(workspaceId)).toEqual([]);
        expect(fs.readdirSync(path.dirname(file()))).toEqual([REMOTE_DELEGATION_REQUESTS_FILE]);
    });

    it('keeps rejection terminal and diagnostics bounded without manufacturing a failed child', () => {
        const request = requests.reserve(reservation);
        expect(() => requests.settleDispatch(workspaceId, request.requestId, 'rejected', 'Denied')).toThrow('not been dispatched');
        requests.beginDispatch(workspaceId, request.requestId);
        requests.settleDispatch(workspaceId, request.requestId, 'rejected', 'r'.repeat(2_100));
        requests.settleDispatch(workspaceId, request.requestId, 'uncertain', 'Late timeout');
        expect(restart().list(workspaceId)[0].admission).toEqual({ state: 'rejected', reason: 'r'.repeat(2_000) });
        expect(restart().beginDispatch(workspaceId, request.requestId)).toBe(false);
        expect(() => requests.accept(workspaceId, receiptFor(request))).toThrow('current state');
        expect(jobs.list(workspaceId)).toEqual([]);
    });

    it.each(['launch', 'follow-up', 'ralph'] as const)('reconciles an uncertain %s to exactly one owner-qualified delegation', kind => {
        const request = requests.reserve({ ...reservation, kind,
            ...(kind === 'follow-up' ? { targetProcessId: 'existing-chat' } : {}) });
        const receipt = receiptFor(request);
        expect(() => requests.accept(workspaceId, receipt)).toThrow('current state');
        requests.beginDispatch(workspaceId, request.requestId);
        requests.settleDispatch(workspaceId, request.requestId, 'uncertain', 'Acknowledgment lost');
        const job = restart().accept(workspaceId, receipt);
        expect(job).toMatchObject({ id: `remote:${request.requestId}`, parent: reservation.parent,
            child: { ...receipt.child, workspaceId: reservation.destination.workspaceId, serverId: 'connection-1' },
            remote: { originServerIdentity: jobs.serverIdentity, serverIdentity: 'destination-owner', requestId: request.requestId, kind },
            messagingOrigin: reservation.messagingOrigin });
        expect(job.child.requestId).toBe(kind === 'follow-up' ? request.requestId : undefined);
        expect(restart().accept(workspaceId, receipt)).toEqual(job);
        expect(restart().recoverAccepted(workspaceId)).toEqual([job]);
        expect(jobs.list(workspaceId)).toHaveLength(1);
        expect(restart().beginDispatch(workspaceId, request.requestId)).toBe(false);
    });

    it('repairs a crash between accepted-receipt persistence and delegated-job registration', () => {
        const request = requests.reserve(reservation);
        requests.beginDispatch(workspaceId, request.requestId);
        vi.spyOn(jobs, 'register').mockImplementationOnce(() => { throw new Error('second write failed'); });
        expect(() => requests.accept(workspaceId, receiptFor(request))).toThrow('second write failed');
        expect(restart().list(workspaceId)[0].admission.state).toBe('accepted');
        expect(jobs.list(workspaceId)).toEqual([]);
        expect(restart().beginDispatch(workspaceId, request.requestId)).toBe(false);
        expect(restart().recoverAccepted(workspaceId)).toHaveLength(1);
        expect(restart().recoverAccepted(workspaceId)).toHaveLength(1);
        expect(jobs.list(workspaceId)).toHaveLength(1);
    });

    it('requires a whole Ralph session receipt and freezes its accepted child', () => {
        const request = requests.reserve({ ...reservation, kind: 'ralph' });
        requests.beginDispatch(workspaceId, request.requestId);
        const receipt = receiptFor(request);
        expect(() => requests.accept(workspaceId, { ...receipt, child: { processId: 'iteration-1' } })).toThrow();
        requests.accept(workspaceId, receipt);
        for (const child of [
            { ...receipt.child, processId: 'iteration-2' },
            { ...receipt.child, sessionId: 'another-session' },
        ]) {
            expect(() => requests.accept(workspaceId, { ...receipt, child })).toThrow('cannot be reassigned');
        }
        requests.settleDispatch(workspaceId, request.requestId, 'rejected', 'Late response');
        expect(restart().list(workspaceId)[0].admission).toEqual({ state: 'accepted', child: receipt.child });
        expect(jobs.list(workspaceId)).toHaveLength(1);
    });

    it('does not let another workspace claim or settle a reserved dispatch', () => {
        const request = requests.reserve(reservation);
        expect(() => requests.beginDispatch('another-workspace', request.requestId)).toThrow('not reserved');
        expect(() => requests.settleDispatch('another-workspace', request.requestId, 'rejected', 'Denied')).toThrow('not reserved');
        expect(restart().list(workspaceId)[0].admission.state).toBe('reserved');
    });

    it('does not publish a delegation when accepted-receipt persistence fails', () => {
        const request = requests.reserve(reservation);
        requests.beginDispatch(workspaceId, request.requestId);
        vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw new Error('read-only disk'); });
        expect(() => requests.accept(workspaceId, receiptFor(request))).toThrow('read-only disk');
        expect(restart().list(workspaceId)[0].admission.state).toBe('dispatching');
        expect(jobs.list(workspaceId)).toEqual([]);
        expect(restart().accept(workspaceId, receiptFor(request))).toBeDefined();
    });

    it('refuses wrong-owner, wrong-turn, changed-intent and changed-child receipts without mutation', () => {
        const request = requests.reserve({ ...reservation, kind: 'follow-up', targetProcessId: 'existing-chat' });
        requests.beginDispatch(workspaceId, request.requestId);
        const receipt = receiptFor(request);
        const saved = fs.readFileSync(file(), 'utf8');
        for (const change of [
            { requestId: randomUUID() }, { originServerIdentity: 'foreign-origin' }, { serverIdentity: 'replacement-owner' },
            { workspaceId: 'foreign-repo' }, { intentDigest: 'b'.repeat(64) }, { kind: 'launch' as const },
            { child: { processId: 'different-chat' } }, { child: { processId: 'existing-chat', sessionId: 'iteration' } },
        ]) {
            expect(() => requests.accept(workspaceId, { ...receipt, ...change })).toThrow();
            expect(fs.readFileSync(file(), 'utf8')).toBe(saved);
        }
        expect(() => requests.accept('different-parent-repo', receipt)).toThrow('not reserved');
        requests.accept(workspaceId, receipt);
        const accepted = fs.readFileSync(file(), 'utf8');
        expect(() => requests.accept(workspaceId, { ...receipt, child: { processId: 'other-chat' } })).toThrow();
        expect(fs.readFileSync(file(), 'utf8')).toBe(accepted);
    });

    it('keeps raw IDs separate across destination owners and origin workspaces', () => {
        const requestId = randomUUID();
        const first = requests.reserve({ ...reservation, requestId });
        const second = requests.reserve({ ...reservation, requestId,
            parent: { ...reservation.parent, workspaceId: 'second-origin' },
            destination: { ...reservation.destination, serverIdentity: 'other-destination' } });
        for (const request of [first, second]) {
            requests.beginDispatch(request.parent.workspaceId, requestId);
            requests.accept(request.parent.workspaceId, receiptFor(request));
        }
        expect(jobs.list(workspaceId)[0].remote?.serverIdentity).toBe('destination-owner');
        expect(jobs.list('second-origin')[0].remote?.serverIdentity).toBe('other-destination');
    });

    it.each([
        { kind: 'follow-up', targetProcessId: undefined }, { kind: 'launch', targetProcessId: 'chat' },
        { kind: 'ralph', targetProcessId: 'chat' }, { intentDigest: 'not-a-digest' }, { requestId: 'not-a-uuid' }, { requestId: null },
        { destination: { ...reservation.destination, serverIdentity: ' ' } },
    ])('refuses malformed reservation %j', change => {
        expect(() => requests.reserve({ ...reservation, ...change } as RemoteDelegationReservation)).toThrow();
        expect(restart().list(workspaceId)).toEqual([]);
    });

    it.each(['foreign-origin', 'wrong-workspace', 'duplicate', 'corrupt-json', 'corrupt-state'])(
        'fails closed on %s persisted data without overwriting it', corruption => {
            const request = requests.reserve(reservation);
            let contents: string;
            switch (corruption) {
                case 'foreign-origin': contents = JSON.stringify([{ ...request, originServerIdentity: 'other' }]); break;
                case 'wrong-workspace': contents = JSON.stringify([{ ...request, parent: { ...request.parent, workspaceId: 'other' } }]); break;
                case 'duplicate': contents = JSON.stringify([request, request]); break;
                case 'corrupt-json': contents = '{'; break;
                default: contents = JSON.stringify([{ ...request, admission: { state: 'please-resend' } }]);
            }
            fs.writeFileSync(file(), contents);
            expect(() => restart().list(workspaceId)).toThrow();
            expect(() => restart().reserve(reservation)).toThrow();
            expect(fs.readFileSync(file(), 'utf8')).toBe(contents);
        },
    );

    it('keeps origin admission receipts machine-local and wipes them together with delegated jobs', async () => {
        const request = requests.reserve(reservation);
        requests.beginDispatch(workspaceId, request.requestId);
        requests.accept(workspaceId, receiptFor(request));
        const domain = createDelegatedJobsDomain();
        const context = { dataDir, store: {} } as StorageSnapshotContext;
        expect((await domain.collect(context)).data).toEqual({});
        const plan = await domain.planWipe({ ...context, includeWikis: false });
        expect(plan.plan).toEqual([
            getRepoDataPath(dataDir, workspaceId, DELEGATED_JOBS_FILE), file(),
        ]);
        const result = { errors: [] as string[] };
        await domain.executeWipe({ ...context, includeWikis: false }, plan.plan, result);
        expect(result.errors).toEqual([]);
        expect(restart().list(workspaceId)).toEqual([]);
        expect(jobs.list(workspaceId)).toEqual([]);
    });
});
