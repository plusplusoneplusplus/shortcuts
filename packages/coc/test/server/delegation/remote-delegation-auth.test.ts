import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    REMOTE_DELEGATION_PROOF_PATH, verifyRemoteDelegationOrigin,
    type RemoteDelegationClaim,
} from '../../../src/server/delegation/remote-delegation-auth';
import {
    REMOTE_DELEGATION_REQUESTS_FILE, RemoteDelegationRequestStore,
    type RemoteDelegationRequest,
} from '../../../src/server/delegation/remote-delegation-request-store';
import { registerRemoteDelegationProofRoutes } from '../../../src/server/delegation/remote-delegation-routes';
import type { RemoteServerWithRuntime } from '../../../src/server/servers/remote-server-types';
import { getRepoDataPath } from '../../../src/server/paths';
import { createRouter, sendJson, type Route } from '../../../src/server/shared/router';

const workspaceId = 'origin-repo';
const destination = { serverId: 'destination-alias', serverIdentity: 'destination-owner', workspaceId: 'destination-repo' };
const reservation = {
    parent: { workspaceId, processId: 'sentinel-1' }, destination,
    kind: 'launch' as const, intentDigest: 'a'.repeat(64), title: 'Fix login',
    messagingOrigin: { connector: 'teams' as const, chatKey: 'private-chat', threadId: 'private-thread' },
};
function claimFor(request: RemoteDelegationRequest): RemoteDelegationClaim {
    return {
        version: 1, requestId: request.requestId, originServerIdentity: request.originServerIdentity,
        parent: request.parent, destination: { serverIdentity: destination.serverIdentity, workspaceId: destination.workspaceId },
        kind: request.kind, ...(request.targetProcessId ? { targetProcessId: request.targetProcessId } : {}),
        intentDigest: request.intentDigest, proofToken: request.proofToken!,
    };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe('remote origin reservation authentication', () => {
    let dataDir: string;
    let requests: RemoteDelegationRequestStore;
    let request: RemoteDelegationRequest;
    let claim: RemoteDelegationClaim;
    let entries: RemoteServerWithRuntime[];
    const servers: http.Server[] = [];
    const file = () => getRepoDataPath(dataDir, workspaceId, REMOTE_DELEGATION_REQUESTS_FILE);
    const restart = () => new RemoteDelegationRequestStore(dataDir);
    const source = () => ({ list: () => entries });
    const options = () => ({ serverIdentity: destination.serverIdentity, remotes: source() });
    const fetchProof = () => vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith('/api/health')) return json({ serverIdentity: claim.originServerIdentity });
        if (String(url).endsWith(REMOTE_DELEGATION_PROOF_PATH)) {
            const proof = restart().proveOrigin(JSON.parse(init!.body as string));
            return json(proof ?? { error: 'denied' }, proof ? 200 : 403);
        }
        throw new Error('Unexpected request');
    });
    const verify = (input: unknown = claim, fetchImpl = fetchProof()) =>
        verifyRemoteDelegationOrigin(input, { ...options(), fetchImpl });

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-delegation-auth-'));
        requests = restart();
        request = requests.reserve(reservation);
        claim = claimFor(request);
        entries = [{ id: 'origin-alias', kind: 'url', label: 'Origin', url: 'https://origin.invalid',
            addedAt: 1, updatedAt: 1, effectiveUrl: 'https://origin.invalid', status: 'online',
            serverIdentity: request.originServerIdentity }];
    });
    afterEach(async () => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        for (const server of servers.splice(0)) {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function startOrigin(): Promise<string> {
        const routes: Route[] = [{ method: 'GET', pattern: '/api/health', handler: (_req, res) => {
            sendJson(res, { serverIdentity: request.originServerIdentity });
        } }];
        registerRemoteDelegationProofRoutes(routes, restart());
        const server = http.createServer(createRouter({ routes, spaHtml: '' }));
        servers.push(server);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        return `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    }

    it('keeps a random private credential stable across restart and immutable reservation replay', () => {
        expect(request.proofToken).toMatch(/^[a-f0-9]{64}$/);
        expect(requests.reserve(reservation).proofToken).not.toBe(request.proofToken);
        expect(restart().reserve({ ...reservation, requestId: request.requestId }).proofToken).toBe(request.proofToken);
        // POSIX mode is applied to temporary publication as well as the saved ledger.
        if (process.platform !== 'win32') expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
    });

    it('proves only an already-claimed request without mutating or granting another dispatch', async () => {
        expect(requests.proveOrigin(claim)).toBeUndefined();
        requests.beginDispatch(workspaceId, request.requestId);
        const bytes = fs.readFileSync(file(), 'utf8');
        const proof = await verify();
        expect(proof).toEqual({ ...claim, proofToken: undefined, admission: 'dispatching' });
        expect(Object.keys(proof)).not.toContain('proofToken');
        expect(JSON.stringify(proof)).not.toMatch(/private-chat|private-thread|destination-alias|Fix login/);
        expect(await verify()).toEqual(proof);
        expect(fs.readFileSync(file(), 'utf8')).toBe(bytes);
        expect(restart().beginDispatch(workspaceId, request.requestId)).toBe(false);
    });

    it.each(['uncertain', 'accepted', 'rejected'] as const)('handles persisted %s dispatch state truthfully', async state => {
        requests.beginDispatch(workspaceId, request.requestId);
        if (state === 'accepted') {
            requests.accept(workspaceId, { requestId: request.requestId, originServerIdentity: request.originServerIdentity,
                serverIdentity: destination.serverIdentity, workspaceId: destination.workspaceId,
                intentDigest: request.intentDigest, kind: 'launch', child: { processId: 'queue_child' } });
        } else requests.settleDispatch(workspaceId, request.requestId, state, 'Safe diagnostic');
        if (state === 'rejected') await expect(verify()).rejects.toThrow('could not be authenticated');
        else expect((await verify()).admission).toBe(state);
        expect(restart().beginDispatch(workspaceId, request.requestId)).toBe(false);
    });

    it.each(['launch', 'follow-up', 'ralph'] as const)('binds the exact %s kind and target', async kind => {
        request = requests.reserve({ ...reservation, kind, ...(kind === 'follow-up' ? { targetProcessId: 'existing-chat' } : {}) });
        claim = claimFor(request);
        requests.beginDispatch(workspaceId, request.requestId);
        expect((await verify()).kind).toBe(kind);
        expect((await verify()).targetProcessId).toBe(kind === 'follow-up' ? 'existing-chat' : undefined);
        expect(requests.proveOrigin({ ...claim, targetProcessId: 'other-chat' })).toBeUndefined();
    });

    it.each([
        ['token', { proofToken: 'b'.repeat(64) }], ['origin', { originServerIdentity: 'other-owner' }],
        ['parent workspace', { parent: { workspaceId: 'other-repo', processId: 'sentinel-1' } }],
        ['parent process', { parent: { workspaceId, processId: 'other-sentinel' } }],
        ['destination server', { destination: { workspaceId: destination.workspaceId, serverIdentity: 'other-owner' } }],
        ['destination workspace', { destination: { serverIdentity: destination.serverIdentity, workspaceId: 'other-repo' } }],
        ['digest', { intentDigest: 'b'.repeat(64) }], ['kind', { kind: 'ralph' }],
    ])('denies mismatching %s proof fields', (_label, change) => {
        requests.beginDispatch(workspaceId, request.requestId);
        expect(requests.proveOrigin({ ...claim, ...change })).toBeUndefined();
    });

    it('fails closed for old tokenless reservations without backfill or overwrite', () => {
        requests.beginDispatch(workspaceId, request.requestId);
        const rows = JSON.parse(fs.readFileSync(file(), 'utf8'));
        delete rows[0].proofToken;
        const bytes = JSON.stringify(rows);
        fs.writeFileSync(file(), bytes);
        expect(restart().proveOrigin(claim)).toBeUndefined();
        expect(restart().reserve({ ...reservation, requestId: request.requestId }).proofToken).toBeUndefined();
        expect(fs.readFileSync(file(), 'utf8')).toBe(bytes);
    });

    it('does not confuse colliding raw request, workspace and parent IDs on another origin', async () => {
        const otherDir = path.join(dataDir, 'other-installation');
        const otherRequests = new RemoteDelegationRequestStore(otherDir);
        const other = otherRequests.reserve({ ...reservation, requestId: request.requestId });
        otherRequests.beginDispatch(workspaceId, other.requestId);
        requests.beginDispatch(workspaceId, request.requestId);
        expect(otherRequests.proveOrigin(claim)).toBeUndefined();
        expect(requests.proveOrigin(claimFor(other))).toBeUndefined();
        expect(otherRequests.proveOrigin(claimFor(other))).toMatchObject({ originServerIdentity: other.originServerIdentity });
    });

    it('uses the real origin HTTP proof route through the registered endpoint after restart', async () => {
        requests.beginDispatch(workspaceId, request.requestId);
        const baseUrl = await startOrigin();
        entries = [{ ...entries[0], effectiveUrl: baseUrl }];
        const proof = await verifyRemoteDelegationOrigin(claim, options());
        expect(proof).toMatchObject({ requestId: claim.requestId, parent: claim.parent, destination: claim.destination });
        const response = await fetch(`${baseUrl}${REMOTE_DELEGATION_PROOF_PATH}`, {
            method: 'POST', body: JSON.stringify(claim),
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toEqual(proof);
    });

    it.each(['unknown', 'token', 'reserved', 'rejected', 'corrupt'])(
        'origin route gives a safe diagnostic for %s requests', async state => {
            if (state !== 'reserved') requests.beginDispatch(workspaceId, request.requestId);
            if (state === 'unknown') claim.requestId = requests.reserve(reservation).requestId;
            if (state === 'token') claim.proofToken = 'b'.repeat(64);
            if (state === 'rejected') requests.settleDispatch(workspaceId, request.requestId, 'rejected', 'Rejected');
            if (state === 'corrupt') fs.writeFileSync(file(), 'private-ledger-corruption');
            const response = await fetch(`${await startOrigin()}${REMOTE_DELEGATION_PROOF_PATH}`, {
                method: 'POST', body: JSON.stringify(claim),
            });
            expect(response.status).toBe(state === 'corrupt' ? 503 : 403);
            expect(await response.text()).toBe('{"error":"Remote origin proof is unavailable."}');
        },
    );

    it.each(['malformed', 'oversize', 'callback', 'path-traversal', 'windows-path', 'null', 'wrong-version'])(
        'origin route bounds and validates %s input before storage reads', async problem => {
            const baseUrl = await startOrigin();
            const spy = vi.spyOn(RemoteDelegationRequestStore.prototype, 'list');
            const body = problem === 'malformed' ? '{' : JSON.stringify(problem === 'oversize' ? { padding: 'x'.repeat(20_000) }
                : problem === 'callback' ? { ...claim, callbackUrl: 'http://attacker.invalid' }
                : problem === 'path-traversal' ? { ...claim, parent: { ...claim.parent, workspaceId: '../outside' } }
                : problem === 'windows-path' ? { ...claim, parent: { ...claim.parent, workspaceId: '..\\outside' } }
                : problem === 'wrong-version' ? { ...claim, version: 2 } : null);
            const response = await fetch(`${baseUrl}${REMOTE_DELEGATION_PROOF_PATH}`, { method: 'POST', body });
            expect(response.status).toBe(400);
            expect(await response.text()).not.toContain('attacker');
            expect(spy).not.toHaveBeenCalled();
        },
    );

    it.each(['missing', 'offline', 'unknown-identity', 'wrong-identity', 'self', 'wrong-destination', 'callback'])(
        'refuses %s relationships before sending credentials', async problem => {
            const fetchImpl = fetchProof();
            if (problem === 'missing') entries = [];
            if (problem === 'offline') entries[0].status = 'offline';
            if (problem === 'unknown-identity') entries[0].serverIdentity = undefined;
            if (problem === 'wrong-identity') entries[0].serverIdentity = 'other-server';
            if (problem === 'self') claim.originServerIdentity = destination.serverIdentity;
            if (problem === 'wrong-destination') claim.destination.serverIdentity = 'another-destination';
            await expect(verify(problem === 'callback' ? { ...claim, callbackUrl: entries[0].effectiveUrl } : claim, fetchImpl))
                .rejects.toThrow('could not be authenticated');
            expect(fetchImpl).not.toHaveBeenCalled();
        },
    );

    it('checks health around proof lookup and never sends the private token in a URL', async () => {
        requests.beginDispatch(workspaceId, request.requestId);
        const fetchImpl = fetchProof();
        await verify(claim, fetchImpl);
        expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
            'https://origin.invalid/api/health', `https://origin.invalid${REMOTE_DELEGATION_PROOF_PATH}`, 'https://origin.invalid/api/health',
        ]);
        for (const [url, init] of fetchImpl.mock.calls) {
            expect(String(url)).not.toContain(claim.proofToken);
            expect(init).toMatchObject({ redirect: 'error', credentials: 'omit' });
        }
        expect(JSON.parse(fetchImpl.mock.calls[1][1]!.body as string)).toEqual(claim);
    });

    it.each([1, 2, 3])('rejects a relationship change during request %i without later requests', async step => {
        requests.beginDispatch(workspaceId, request.requestId);
        const normal = fetchProof();
        let count = 0;
        const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
            const response = await normal(url, init);
            if (++count === step) entries[0].effectiveUrl = 'https://replacement.invalid';
            return response;
        });
        await expect(verify(claim, fetchImpl)).rejects.toThrow('could not be authenticated');
        expect(fetchImpl).toHaveBeenCalledTimes(step);
    });

    it.each(['removed', 'offline', 'owner', 'edited'])(
        'rejects %s registry changes even when the endpoint stays the same', async change => {
            requests.beginDispatch(workspaceId, request.requestId);
            const normal = fetchProof();
            const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
                const response = await normal(url, init);
                if (change === 'removed') entries = [];
                if (change === 'offline') entries[0].status = 'offline';
                if (change === 'owner') entries[0].serverIdentity = 'replacement-owner';
                if (change === 'edited') entries[0].updatedAt++;
                return response;
            });
            await expect(verify(claim, fetchImpl)).rejects.toThrow('could not be authenticated');
            expect(fetchImpl).toHaveBeenCalledTimes(1);
        },
    );

    it.each([1, 3])('rejects a wrong health owner on read %i', async step => {
        requests.beginDispatch(workspaceId, request.requestId);
        const normal = fetchProof();
        let count = 0;
        const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
            if (++count === step) return json({ serverIdentity: 'replacement-owner' });
            return normal(url, init);
        });
        await expect(verify(claim, fetchImpl)).rejects.toThrow('could not be authenticated');
        expect(fetchImpl).toHaveBeenCalledTimes(step);
    });

    it.each(['origin', 'destination', 'parent', 'digest', 'request', 'kind', 'version', 'private-token'])(
        'rejects wrong %s proof responses', async field => {
            requests.beginDispatch(workspaceId, request.requestId);
            const proof = requests.proveOrigin(claim)!;
            const wrong = field === 'origin' ? { ...proof, originServerIdentity: 'other' }
                : field === 'destination' ? { ...proof, destination: { ...proof.destination, serverIdentity: 'other' } }
                : field === 'parent' ? { ...proof, parent: { ...proof.parent, processId: 'other' } }
                : field === 'digest' ? { ...proof, intentDigest: 'b'.repeat(64) }
                : field === 'request' ? { ...proof, requestId: requests.reserve(reservation).requestId }
                : field === 'kind' ? { ...proof, kind: 'ralph' }
                : field === 'version' ? { ...proof, version: 2 } : { ...proof, proofToken: claim.proofToken };
            const normal = fetchProof();
            const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
                String(url).endsWith(REMOTE_DELEGATION_PROOF_PATH) ? json(wrong) : normal(url, init));
            await expect(verify(claim, fetchImpl)).rejects.toThrow('could not be authenticated');
            expect(fetchImpl).toHaveBeenCalledTimes(2);
        },
    );

    it.each([401, 403, 404, 408, 500, 503])('does not retry HTTP %i or expose its body', async status => {
        const fetchImpl = vi.fn(async () => json({ error: `private-${claim.proofToken}` }, status));
        await expect(verify(claim, fetchImpl)).rejects.toThrow(/^Remote origin reservation could not be authenticated\.$/);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it.each(['network', 'malformed', 'oversize', 'no-body'])(
        'bounds and sanitizes %s responses', async problem => {
            const fetchImpl = vi.fn(async () => {
                if (problem === 'network') throw new Error(`https://private.invalid/${claim.proofToken}`);
                return problem === 'malformed' ? new Response('{') : problem === 'no-body' ? new Response(null)
                    : json({ private: 'x'.repeat(20_000) });
            });
            await expect(verify(claim, fetchImpl)).rejects.toThrow(/^Remote origin reservation could not be authenticated\.$/);
            expect(fetchImpl).toHaveBeenCalledTimes(1);
        },
    );

    it.each(['headers', 'body'] as const)('bounds stalled %s and cleans timers', async stage => {
        vi.useFakeTimers();
        const setDeadline = vi.spyOn(globalThis, 'setTimeout');
        const clearDeadline = vi.spyOn(globalThis, 'clearTimeout');
        let bodyCancelled = false;
        const fetchImpl = vi.fn(async () => stage === 'headers' ? new Promise<Response>(() => {}) : new Response(new ReadableStream({
            cancel: () => { bodyCancelled = true; },
        })));
        const promise = verifyRemoteDelegationOrigin(claim, { ...options(), fetchImpl, timeoutMs: 25 });
        const assertion = expect(promise).rejects.toThrow('could not be authenticated');
        await vi.advanceTimersByTimeAsync(25);
        await assertion;
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(clearDeadline).toHaveBeenCalledWith(setDeadline.mock.results[0].value);
        if (stage === 'body') expect(bodyCancelled).toBe(true);
    });

    it('cancels promptly, preserves caller abort reason and rejects late ignored fetch results', async () => {
        const controller = new AbortController();
        let finish!: (response: Response) => void;
        const fetchImpl = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
        const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
        const promise = verifyRemoteDelegationOrigin(claim, { ...options(), fetchImpl, signal: controller.signal });
        const reason = new Error('User cancelled');
        controller.abort(reason);
        await expect(promise).rejects.toBe(reason);
        finish(json({ serverIdentity: claim.originServerIdentity }));
        await new Promise(resolve => setImmediate(resolve));
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it('does no I/O for a pre-aborted request', async () => {
        const controller = new AbortController();
        controller.abort('cancelled');
        const fetchImpl = fetchProof();
        await expect(verifyRemoteDelegationOrigin(claim, { ...options(), fetchImpl, signal: controller.signal })).rejects.toBe('cancelled');
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
