import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    captureRemoteDelegationIntent, RemoteDelegationAdmissionService,
    type RemoteDelegationDispatch, type RemoteDelegationIntent,
} from '../../../src/server/delegation/remote-delegation-admission';
import {
    RemoteDelegationAdmissionStore, RemoteDelegationReceiptOwnerError, REMOTE_DELEGATION_ADMISSIONS_FILE,
} from '../../../src/server/delegation/remote-delegation-admission-store';
import { RemoteDelegationRequestStore } from '../../../src/server/delegation/remote-delegation-request-store';
import { RemoteDelegationRefusedError, type RemoteDelegationClaim } from '../../../src/server/delegation/remote-delegation-auth';
import { DelegatedJobStore } from '../../../src/server/delegation/delegated-job-store';
import { getRepoDataPath } from '../../../src/server/paths';

const launch: RemoteDelegationIntent = { version: 1, kind: 'launch', workspaceId: 'destination-repo',
    body: { prompt: 'Fix the login', config: { model: 'model-1', effortTier: 'medium' }, mode: 'autopilot' } };

describe('remote execution intent digest', () => {
    it('hashes all wire fields with stable object order and captures a separate JSON body', () => {
        const input = structuredClone(launch);
        const first = captureRemoteDelegationIntent(input);
        const reordered = { body: { mode: 'autopilot', config: { effortTier: 'medium', model: 'model-1' }, prompt: 'Fix the login' },
            workspaceId: launch.workspaceId, kind: launch.kind, version: 1 };
        expect(captureRemoteDelegationIntent(reordered)).toEqual(first);
        input.body.prompt = 'changed';
        expect(first.intent.body.prompt).toBe('Fix the login');
        for (const change of [
            { ...launch, body: { ...launch.body, prompt: 'different' } },
            { ...launch, body: { ...launch.body, config: { model: 'model-2' } } },
            { ...launch, body: { ...launch.body, extra: true } },
            { ...launch, body: { prompt: ['first', 'second'] } },
            { ...launch, body: { prompt: ['second', 'first'] } },
            { ...launch, kind: 'ralph' }, { ...launch, workspaceId: 'other-repo' },
            { ...launch, kind: 'follow-up', targetProcessId: 'exact-chat' },
        ]) expect(captureRemoteDelegationIntent(change).digest).not.toBe(first.digest);
        expect(captureRemoteDelegationIntent({ ...launch, body: { value: ['a', 'b'] } }).digest)
            .not.toBe(captureRemoteDelegationIntent({ ...launch, body: { value: ['b', 'a'] } }).digest);
    });

    it('preserves Unicode, special keys and wire-equivalent negative zero', () => {
        const body = JSON.parse('{"__proto__":{"safe":true},"constructor":"value","unicode":"猫 🚀"}');
        expect(captureRemoteDelegationIntent({ ...launch, body }).intent.body).toEqual(body);
        expect(captureRemoteDelegationIntent({ ...launch, body: { zero: -0 } }).digest)
            .toBe(captureRemoteDelegationIntent({ ...launch, body: { zero: 0 } }).digest);
        expect(Object.prototype).not.toHaveProperty('safe');
    });

    it.each([undefined, NaN, Infinity, BigInt(1), new Date(), () => {}, Symbol('x'), new Map(), new Array(2)])(
        'rejects non-wire JSON value %s', value => {
            expect(() => captureRemoteDelegationIntent({ ...launch, body: { value } })).toThrow();
        },
    );
    it.each([
        { ...launch, version: 2 }, { ...launch, kind: 'unknown' }, { ...launch, workspaceId: '../escape' },
        { ...launch, targetProcessId: 'unexpected' }, { ...launch, kind: 'follow-up' },
        { ...launch, body: [] }, { ...launch, extra: 'not-hashed-away' },
    ])('refuses malformed execution envelope %j', input => {
        expect(() => captureRemoteDelegationIntent(input)).toThrow();
    });
    it('bounds bytes, depth and breadth, including cyclic and multi-byte payloads', () => {
        let deep: unknown = null;
        for (let i = 0; i < 34; i++) deep = { deep };
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        for (const value of ['猫'.repeat(400_000), 'x'.repeat(1_048_576), deep, cyclic, Array(100_001).fill(null)]) {
            expect(() => captureRemoteDelegationIntent({ ...launch, body: { value } })).toThrow('Invalid or oversized');
        }
    });
});

describe('sender-only destination admission gateway', () => {
    let root: string;
    let origin: RemoteDelegationRequestStore;
    let destination: RemoteDelegationAdmissionStore;
    let claim: RemoteDelegationClaim;
    let fetchImpl: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>;
    let dispatch: ReturnType<typeof vi.fn<RemoteDelegationDispatch>>;
    const restart = () => new RemoteDelegationAdmissionStore(path.join(root, 'destination'));
    const service = () => new RemoteDelegationAdmissionService(restart());
    const file = () => getRepoDataPath(path.join(root, 'destination'), launch.workspaceId, REMOTE_DELEGATION_ADMISSIONS_FILE);
    function reserve(intent: RemoteDelegationIntent = launch) {
        const request = origin.reserve({ parent: { workspaceId: 'origin-repo', processId: 'sentinel-1' },
            destination: { serverId: 'destination-alias', serverIdentity: destination.serverIdentity, workspaceId: intent.workspaceId },
            kind: intent.kind, ...(intent.targetProcessId ? { targetProcessId: intent.targetProcessId } : {}),
            intentDigest: captureRemoteDelegationIntent(intent).digest, title: 'Fix login' });
        origin.beginDispatch('origin-repo', request.requestId);
        claim = { version: 1, requestId: request.requestId, originServerIdentity: request.originServerIdentity,
            parent: request.parent, destination: { serverIdentity: destination.serverIdentity, workspaceId: intent.workspaceId },
            kind: intent.kind, ...(intent.targetProcessId ? { targetProcessId: intent.targetProcessId } : {}),
            intentDigest: request.intentDigest, proofToken: request.proofToken! };
        return claim;
    }
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-admission-service-'));
        origin = new RemoteDelegationRequestStore(path.join(root, 'origin'));
        destination = restart();
        reserve();
        // The destination has no origin registration and must never call out.
        fetchImpl = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network operation'));
        dispatch = vi.fn(async ({ executionId }) => ({ state: 'accepted' as const, child: { processId: `queue_${executionId}` } }));
    });
    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('authenticates, persists before execution and reconciles lost replies on both restarted stores', async () => {
        dispatch.mockImplementationOnce(async ({ binding, intent, executionId }) => {
            expect(destination.get(binding)).toMatchObject({ executionId, admission: { state: 'dispatching' } });
            expect(binding).not.toHaveProperty('proofToken');
            expect(binding).not.toHaveProperty('admission');
            expect(intent).toEqual(launch);
            return { state: 'accepted', child: { processId: `queue_${executionId}` } };
        });
        const accepted = await service().admit(claim, launch, dispatch);
        // The response is lost: origin records uncertainty, never re-dispatches work.
        origin.settleDispatch('origin-repo', claim.requestId, 'uncertain', 'Reply lost');
        origin = new RemoteDelegationRequestStore(path.join(root, 'origin'));
        expect(origin.beginDispatch('origin-repo', claim.requestId)).toBe(false);
        const receipt = await service().reconcile(claim);
        expect(receipt).toEqual(accepted);
        if (receipt?.admission.state !== 'accepted') throw new Error('Expected acceptance');
        const job = origin.accept('origin-repo', { requestId: receipt.requestId, originServerIdentity: receipt.originServerIdentity,
            serverIdentity: receipt.destination.serverIdentity, workspaceId: receipt.destination.workspaceId,
            intentDigest: receipt.intentDigest, kind: receipt.kind, child: receipt.admission.child });
        expect(job.parent).toEqual(claim.parent);
        expect((await service().admit(claim, launch, dispatch)).admission.state).toBe('accepted');
        expect(await service().reconcile(claim)).toEqual(accepted);
        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(new DelegatedJobStore(path.join(root, 'origin')).list('origin-repo')).toHaveLength(1);
        const bytes = fs.readFileSync(getRepoDataPath(path.join(root, 'destination'), launch.workspaceId,
            REMOTE_DELEGATION_ADMISSIONS_FILE), 'utf8');
        for (const privateValue of [claim.proofToken, 'Fix the login', 'model-1', 'destination-alias']) {
            expect(bytes).not.toContain(privateValue);
        }
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('admits concurrent duplicates once while the execution adapter is still awaiting its reply', async () => {
        let finish!: () => void;
        let entered!: () => void;
        const entry = new Promise<void>(resolve => { entered = resolve; });
        dispatch.mockImplementationOnce(async () => {
            entered();
            await new Promise<void>(resolve => { finish = resolve; });
            return { state: 'accepted', child: { processId: 'child' } };
        });
        const first = service().admit(claim, launch, dispatch);
        await entry;
        expect((await service().admit(claim, launch, dispatch)).admission.state).toBe('dispatching');
        finish();
        expect((await first).admission.state).toBe('accepted');
        expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it('never reexecutes a crash-window claim or an adapter failure, including after restart', async () => {
        dispatch.mockRejectedValueOnce(new Error('private transport credentials'));
        expect((await service().admit(claim, launch, dispatch)).admission.state).toBe('uncertain');
        expect((await service().admit(claim, launch, dispatch)).admission.state).toBe('uncertain');
        expect(dispatch).toHaveBeenCalledTimes(1);
        const nextClaim = reserve();
        destination.claim(nextClaim); // Crash before execution adapter starts.
        expect((await service().admit(nextClaim, launch, dispatch)).admission.state).toBe('dispatching');
        expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it('retains definitive rejection without storing raw error text or retrying execution', async () => {
        dispatch.mockResolvedValueOnce({ state: 'rejected' });
        expect((await service().admit(claim, launch, dispatch)).admission.state).toBe('rejected');
        expect((await service().admit(claim, launch, dispatch)).admission.state).toBe('rejected');
        expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it('treats invalid adapter acknowledgments as uncertain rather than definitive rejection', async () => {
        dispatch.mockResolvedValueOnce({ state: 'unexpected' } as never);
        expect((await service().admit(claim, launch, dispatch)).admission.state).toBe('uncertain');
        expect((await service().admit(claim, launch, dispatch)).admission.state).toBe('uncertain');
        expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it.each(['follow-up', 'ralph'] as const)('uses a stable independent destination identity for each %s', async kind => {
        const intent: RemoteDelegationIntent = { ...launch, kind,
            ...(kind === 'follow-up' ? { targetProcessId: 'same-chat' } : {}) };
        const firstClaim = reserve(intent);
        const secondClaim = reserve(intent);
        dispatch.mockImplementation(async ({ executionId }) => ({ state: 'accepted', child: {
            processId: kind === 'follow-up' ? 'same-chat' : `queue_${executionId}`,
            ...(kind === 'ralph' ? { sessionId: `ralph-${executionId}` } : {}),
        } }));
        const first = await service().admit(firstClaim, intent, dispatch);
        const second = await service().admit(secondClaim, intent, dispatch);
        expect(first.requestId).not.toBe(second.requestId);
        expect(first.executionId).not.toBe(second.executionId);
        expect(await service().reconcile(firstClaim)).toEqual(first);
        expect(await service().reconcile(secondClaim)).toEqual(second);
        expect(dispatch).toHaveBeenCalledTimes(2);
    });

    it('captures caller JSON before asynchronous execution', async () => {
        const input = structuredClone(launch);
        const originalClaim = structuredClone(claim);
        const pending = service().admit(claim, input, dispatch);
        input.body.prompt = 'Changed after verification began';
        claim.parent.processId = 'another-sentinel';
        await pending;
        expect(dispatch.mock.calls[0][0].intent).toEqual(launch);
        expect(dispatch.mock.calls[0][0].binding.parent).toEqual(originalClaim.parent);
    });

    it.each(['prompt', 'kind', 'workspace', 'target'])(
        'refuses changed %s before any claim or execution', async change => {
            const execution = change === 'prompt' ? { ...launch, body: { prompt: 'different' } }
                : change === 'kind' ? { ...launch, kind: 'ralph' }
                : change === 'workspace' ? { ...launch, workspaceId: 'other-repo' }
                : { ...launch, kind: 'follow-up', targetProcessId: 'other-chat' };
            await expect(service().admit(claim, execution, dispatch)).rejects.toBeInstanceOf(RemoteDelegationRefusedError);
            expect(fetchImpl).not.toHaveBeenCalled();
            expect(dispatch).not.toHaveBeenCalled();
            expect(destination.list(launch.workspaceId)).toEqual([]);
        },
    );

    it('rejects a matching digest if envelope owner/kind/target differs from the claim', async () => {
        for (const intent of [{ ...launch, workspaceId: 'different' }, { ...launch, kind: 'ralph' as const },
            { ...launch, kind: 'follow-up' as const, targetProcessId: 'different' }]) {
            await expect(service().admit({ ...claim, intentDigest: captureRemoteDelegationIntent(intent).digest }, intent, dispatch))
                .rejects.toThrow('does not match');
        }
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('binds receipt ownership to the first submitter secret for replays and reads', async () => {
        await service().admit(claim, launch, dispatch);
        const bytes = fs.readFileSync(file(), 'utf8');
        const wrongToken = { ...claim, proofToken: 'f'.repeat(64) };
        await expect(service().admit(wrongToken, launch, dispatch)).rejects.toBeInstanceOf(RemoteDelegationReceiptOwnerError);
        expect(await service().reconcile(wrongToken)).toBeUndefined();
        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(fs.readFileSync(file(), 'utf8')).toBe(bytes);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each([
        ['origin identity', { originServerIdentity: 'spoofed-origin' }],
        ['parent workspace', { parent: { workspaceId: 'other-repo', processId: 'sentinel-1' } }],
        ['destination workspace', { destination: { serverIdentity: 'x', workspaceId: 'other-repo' } }],
    ])('does not disclose a receipt to a claim with another %s, even with the secret', async (_label, change) => {
        await service().admit(claim, launch, dispatch);
        const changed = { ...claim, ...change } as RemoteDelegationClaim;
        if ('destination' in change) changed.destination = { ...change.destination, serverIdentity: destination.serverIdentity };
        expect(await service().reconcile(changed)).toBeUndefined();
        expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it.each(['self origin', 'other destination', 'malformed'])('refuses a %s claim before storage', async problem => {
        const input = problem === 'self origin' ? { ...claim, originServerIdentity: destination.serverIdentity }
            : problem === 'other destination' ? { ...claim, destination: { ...claim.destination, serverIdentity: 'other-server' } }
            : { ...claim, callbackUrl: 'http://attacker.invalid' };
        await expect(service().admit(input, launch, dispatch)).rejects.toBeInstanceOf(RemoteDelegationRefusedError);
        await expect(service().reconcile(input)).rejects.toBeInstanceOf(RemoteDelegationRefusedError);
        expect(dispatch).not.toHaveBeenCalled();
        expect(fs.existsSync(file())).toBe(false);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('never binds or replays a legacy reverse-proof receipt that has no secret digest', async () => {
        dispatch.mockResolvedValueOnce({ state: 'rejected' });
        await service().admit(claim, launch, dispatch);
        const rows = JSON.parse(fs.readFileSync(file(), 'utf8'));
        rows[0].admission = { state: 'uncertain' };
        delete rows[0].receiptTokenDigest;
        fs.writeFileSync(file(), JSON.stringify(rows));
        const bytes = fs.readFileSync(file(), 'utf8');
        await expect(service().admit(claim, launch, dispatch)).rejects.toBeInstanceOf(RemoteDelegationReceiptOwnerError);
        expect(await service().reconcile(claim, async () => ({ processId: 'queue_guess' }))).toBeUndefined();
        expect(fs.readFileSync(file(), 'utf8')).toBe(bytes);
        expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it('sanitizes claim/write errors and leaves a consumed claim if execution succeeded before a disk failure', async () => {
        const claimWrite = vi.spyOn(RemoteDelegationAdmissionStore.prototype, 'claim').mockImplementationOnce(() => {
            throw new Error('private disk path');
        });
        await expect(service().admit(claim, launch, dispatch)).rejects.toThrow('Destination admission is unavailable');
        expect(dispatch).not.toHaveBeenCalled();
        claimWrite.mockRestore();
        const accept = vi.spyOn(RemoteDelegationAdmissionStore.prototype, 'accept').mockImplementationOnce(() => {
            throw new Error('private disk path');
        });
        expect((await service().admit(claim, launch, dispatch)).admission.state).toBe('uncertain');
        accept.mockRestore();
        expect((await service().admit(claim, launch, dispatch)).admission.state).toBe('uncertain');
        expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it('keeps a consumed claim if even uncertainty persistence fails', async () => {
        dispatch.mockRejectedValueOnce(new Error('private provider error'));
        vi.spyOn(RemoteDelegationAdmissionStore.prototype, 'settle').mockImplementationOnce(() => { throw new Error('private path'); });
        await expect(service().admit(claim, launch, dispatch)).rejects.toThrow('could not be recorded; do not retry execution');
        expect((await service().reconcile(claim))?.admission.state).toBe('dispatching');
        expect((await service().admit(claim, launch, dispatch)).admission.state).toBe('dispatching');
        expect(dispatch).toHaveBeenCalledTimes(1);
    });
});
