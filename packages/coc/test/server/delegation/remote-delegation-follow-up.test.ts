import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepoQueueRegistry, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { SqliteQueuePersistence } from '../../../src/server/queue/sqlite-queue-persistence';
import { ProcessMessageDeliveryService } from '../../../src/server/processes/process-message-delivery-service';
import { RemoteDelegationAdmissionStore } from '../../../src/server/delegation/remote-delegation-admission-store';
import { getOrCreateServerIdentity } from '../../../src/server/servers/server-identity';
import { RemoteDelegationRequestStore } from '../../../src/server/delegation/remote-delegation-request-store';
import { captureRemoteDelegationIntent, type RemoteDelegationIntent } from '../../../src/server/delegation/remote-delegation-admission';
import type { RemoteDelegationClaim } from '../../../src/server/delegation/remote-delegation-auth';
import { REMOTE_DELEGATION_FOLLOW_UP_PATH, REMOTE_DELEGATION_RECEIPT_PATH,
    registerRemoteDelegationRoutes, registerRemoteDelegationProofRoutes } from '../../../src/server/delegation/remote-delegation-routes';
import { createRouter, sendJson, type Route } from '../../../src/server/shared/router';
import type { RemoteServerWithRuntime } from '../../../src/server/servers/remote-server-types';

const workspaceId = 'destination-repo';
const processId = 'queue_exact-chat';
const intent: RemoteDelegationIntent = { version: 1, kind: 'follow-up', workspaceId,
    targetProcessId: processId, body: { content: 'Inspect the saved plan', mode: 'ask' } };

describe('authenticated destination follow-up HTTP admission', () => {
    let directory: string;
    let store: SqliteProcessStore;
    let bridge: MultiRepoQueueRouter;
    let persistence: SqliteQueuePersistence;
    let delivery: ProcessMessageDeliveryService;
    let requests: RemoteDelegationRequestStore;
    let admissions: RemoteDelegationAdmissionStore;
    let remotes: RemoteServerWithRuntime[];
    let destinationUrl: string;
    const servers: http.Server[] = [];
    const destinationRoutes: Route[] = [];
    const originDir = () => path.join(directory, 'origin');
    const destinationDir = () => path.join(directory, 'destination');
    const queues = () => bridge.createAggregateQueueFacade().getAll();

    function openDestination() {
        store = new SqliteProcessStore({ dbPath: path.join(destinationDir(), 'processes.db') });
        bridge = new MultiRepoQueueRouter(new RepoQueueRegistry(), store,
            { autoStart: false, aiService: createMockSDKService().service });
        bridge.registerRepoId(workspaceId, path.join(directory, 'repo'));
        persistence = new SqliteQueuePersistence(bridge, store.getDatabase(), { restartPolicy: 'fail' });
        persistence.restore();
        delivery = new ProcessMessageDeliveryService({ store, bridge });
        admissions = new RemoteDelegationAdmissionStore(destinationDir());
        destinationRoutes.splice(0);
        registerRemoteDelegationRoutes(destinationRoutes, {
            admissions, store, delivery, remotes: { list: () => remotes },
        });
    }
    function closeDestination() { persistence.dispose(); bridge.dispose(); store.close(); }
    async function listen(routes: Route[]) {
        const server = http.createServer(createRouter({ routes, spaHtml: '' }));
        servers.push(server);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        return `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    }
    function reserve(execution = intent, origin = requests, requestId?: string): RemoteDelegationClaim {
        const row = origin.reserve({ requestId, parent: { workspaceId: 'origin-repo', processId: 'sentinel' },
            destination: { serverId: 'destination-alias', serverIdentity: admissions.serverIdentity, workspaceId: execution.workspaceId },
            kind: execution.kind, targetProcessId: execution.targetProcessId,
            intentDigest: captureRemoteDelegationIntent(execution).digest, title: 'Inspect plan' });
        origin.beginDispatch(row.parent.workspaceId, row.requestId);
        return { version: 1, requestId: row.requestId, originServerIdentity: row.originServerIdentity, parent: row.parent,
            destination: { serverIdentity: row.destination.serverIdentity, workspaceId: row.destination.workspaceId },
            kind: row.kind, targetProcessId: row.targetProcessId, intentDigest: row.intentDigest, proofToken: row.proofToken! };
    }
    async function post(route: string, body: unknown) {
        const response = await fetch(`${destinationUrl}${route}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        expect(response.headers.get('cache-control')).toBe('no-store');
        return { status: response.status, body: await response.json() as any };
    }
    const admit = (claim: RemoteDelegationClaim, execution: unknown = intent) => post(REMOTE_DELEGATION_FOLLOW_UP_PATH, { claim, intent: execution });
    const reconcile = (claim: RemoteDelegationClaim) => post(REMOTE_DELEGATION_RECEIPT_PATH, claim);
    const proc = () => store.getProcess(processId, workspaceId);
    const row = (claim: RemoteDelegationClaim) => admissions.get(claim)!;

    beforeEach(async () => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-follow-up-'));
        fs.mkdirSync(destinationDir());
        requests = new RemoteDelegationRequestStore(originDir());
        const originRoutes: Route[] = [{ method: 'GET', pattern: '/api/health', handler: (_req, res) =>
            sendJson(res, { serverIdentity: getOrCreateServerIdentity(originDir()) }) }];
        registerRemoteDelegationProofRoutes(originRoutes, requests);
        const originUrl = await listen(originRoutes);
        remotes = [{ id: 'origin-alias', kind: 'url', label: 'Origin', url: originUrl, effectiveUrl: originUrl,
            status: 'online', serverIdentity: getOrCreateServerIdentity(originDir()), addedAt: 1, updatedAt: 1 }];
        openDestination();
        await store.registerWorkspace({ id: workspaceId, rootPath: path.join(directory, 'repo'), name: 'Destination' });
        await store.addProcess({ id: processId, type: 'chat', status: 'completed', startTime: new Date(), promptPreview: 'Initial',
            workingDirectory: path.join(directory, 'repo'), sdkSessionId: 'destination-session',
            metadata: { workspaceId, mode: 'ask', provider: 'copilot' } });
        destinationUrl = await listen(destinationRoutes);
    });
    afterEach(async () => {
        vi.restoreAllMocks();
        for (const server of servers.splice(0)) {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
        closeDestination();
        fs.rmSync(directory, { recursive: true, force: true });
    });

    it('authenticates real proof routes, admits once and hides private destination correlation', async () => {
        const claim = reserve();
        const enqueue = vi.spyOn(bridge, 'enqueueAdmitted');
        const response = await admit(claim);
        const { proofToken: _token, ...binding } = claim;
        expect(response).toMatchObject({ status: 202, body: { ...binding,
            admission: { state: 'accepted', child: { processId } } } });
        const executionId = row(claim).executionId;
        expect(JSON.stringify(response.body)).not.toMatch(new RegExp(`${executionId}|${claim.proofToken}|destination-session|Inspect the saved plan`));
        expect(queues()).toHaveLength(1);
        expect(queues()[0]).toMatchObject({ id: executionId, processId, payload: { workspaceId, processId,
            relayRequestId: executionId, mode: 'ask', provider: 'copilot', deliveryMode: 'enqueue' } });
        expect((await proc())!.conversationTurns).toMatchObject([{ role: 'user', relayRequestId: executionId }]);
        expect(await admit(claim)).toEqual(response);
        expect((await reconcile(claim)).body).toEqual(response.body);
        expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it('buffers two independent requests behind busy work and deduplicates after both stores reopen', async () => {
        await store.updateProcess(processId, { status: 'running' });
        const first = reserve();
        const secondIntent = { ...intent, body: { content: 'Second requested turn', mode: 'autopilot' } };
        const second = reserve(secondIntent);
        for (const [claim, execution] of [[first, intent], [second, secondIntent]] as const) {
            expect((await admit(claim, execution)).body.admission.state).toBe('accepted');
        }
        const messages = (await proc())!.pendingMessages!;
        expect(messages).toMatchObject([
            { id: row(first).executionId, relayRequestId: row(first).executionId, mode: 'ask', provider: 'copilot' },
            { id: row(second).executionId, relayRequestId: row(second).executionId, mode: 'autopilot', provider: 'copilot' },
        ]);
        expect(messages[0].id).not.toBe(messages[1].id);
        closeDestination(); openDestination();
        requests = new RemoteDelegationRequestStore(originDir());
        expect(requests.beginDispatch(first.parent.workspaceId, first.requestId)).toBe(false);
        expect((await reconcile(first)).body.admission.state).toBe('accepted');
        expect((await admit(second, secondIntent)).body.admission.state).toBe('accepted');
        expect((await proc())!.pendingMessages).toEqual(messages);
        expect((await proc())!.conversationTurns).toEqual([]);
        expect(queues()).toHaveLength(0);
    });

    it.each(['pending', 'turn', 'queue'] as const)('repairs acceptance after %s persistence without executing again', async evidence => {
        const claim = reserve();
        if (evidence === 'pending') await store.updateProcess(processId, { status: 'running' });
        if (evidence === 'queue') vi.spyOn(store, 'appendConversationTurn').mockRejectedValueOnce(new Error('private append path'));
        else vi.spyOn(admissions, 'accept').mockImplementationOnce(() => { throw new Error('private receipt path'); });
        expect((await admit(claim)).body.admission.state).toBe('uncertain');
        closeDestination(); openDestination();
        const enqueue = vi.spyOn(bridge, 'enqueueAdmitted');
        expect((await reconcile(claim)).body.admission).toEqual({ state: 'accepted', child: { processId } });
        expect((await admit(claim)).body.admission.state).toBe('accepted');
        expect(enqueue).not.toHaveBeenCalled();
        expect(evidence === 'pending' ? (await proc())!.pendingMessages : queues()).toHaveLength(1);
    });

    it('never executes a claimed crash-before-send request, including missing domain evidence', async () => {
        const claim = reserve();
        admissions.claim(requests.proveOrigin(claim)!);
        closeDestination(); openDestination();
        const enqueue = vi.spyOn(bridge, 'enqueueAdmitted');
        expect((await reconcile(claim)).body.admission.state).toBe('dispatching');
        expect((await admit(claim)).body.admission.state).toBe('dispatching');
        expect(enqueue).not.toHaveBeenCalled();
        expect(queues()).toHaveLength(0);
    });

    it('admits concurrent duplicate HTTP requests once', async () => {
        const claim = reserve();
        const enqueue = vi.spyOn(bridge, 'enqueueAdmitted');
        const replies = await Promise.all([admit(claim), admit(claim), admit(claim)]);
        expect(replies.every(reply => reply.status === 202)).toBe(true);
        expect((await reconcile(claim)).body.admission.state).toBe('accepted');
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(queues()).toHaveLength(1);
        expect((await proc())!.conversationTurns).toHaveLength(1);
    });

    it('fails closed before execution when the destination claim cannot persist', async () => {
        const claim = reserve();
        const enqueue = vi.spyOn(bridge, 'enqueueAdmitted');
        vi.spyOn(admissions, 'claim').mockImplementationOnce(() => { throw new Error('private ledger path'); });
        const reply = await admit(claim);
        expect(reply.status).toBe(503);
        expect(JSON.stringify(reply)).not.toMatch(/private ledger path|proofToken/);
        expect(admissions.list(workspaceId)).toHaveLength(0);
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('retains consumed uncertainty after an enqueue failure without durable evidence', async () => {
        const claim = reserve();
        const enqueue = vi.spyOn(bridge, 'enqueueAdmitted').mockRejectedValueOnce(new Error('private queue path'));
        expect((await admit(claim)).body.admission.state).toBe('uncertain');
        expect((await reconcile(claim)).body.admission.state).toBe('uncertain');
        expect((await admit(claim)).body.admission.state).toBe('uncertain');
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(queues()).toHaveLength(0);
        expect((await proc())!.conversationTurns).toHaveLength(0);
    });

    it('recovers a pending append whose observer throws without buffering another turn', async () => {
        const claim = reserve();
        await store.updateProcess(processId, { status: 'running' });
        const append = store.appendPendingMessage.bind(store);
        vi.spyOn(store, 'appendPendingMessage').mockImplementationOnce(async (...args) => {
            await append(...args);
            throw new Error('private observer failure');
        });
        expect((await admit(claim)).body.admission.state).toBe('uncertain');
        expect((await reconcile(claim)).body.admission.state).toBe('accepted');
        expect((await admit(claim)).body.admission.state).toBe('accepted');
        expect((await proc())!.pendingMessages).toHaveLength(1);
        expect(queues()).toHaveLength(0);
    });

    it('reconciles through another registered alias for the same verified origin', async () => {
        const claim = reserve();
        expect((await admit(claim)).body.admission.state).toBe('accepted');
        remotes = [{ ...remotes[0], id: 'replacement-alias', updatedAt: 2 }];
        expect((await reconcile(claim)).body.admission.state).toBe('accepted');
        remotes[0].serverIdentity = 'foreign-origin';
        expect((await reconcile(claim)).status).toBe(503);
        expect(queues()).toHaveLength(1);
    });

    it('rejects malformed and oversized envelopes with bounded sanitized replies', async () => {
        const claim = reserve();
        for (const body of [null, {}, { claim }, { claim, intent, callbackUrl: 'private-url' },
            { claim, intent: { ...intent, body: { content: 'x'.repeat(1_065_000) } } }]) {
            const reply = await post(REMOTE_DELEGATION_FOLLOW_UP_PATH, body);
            expect(reply.status).toBe(400);
            expect(JSON.stringify(reply)).not.toContain('private-url');
            expect(JSON.stringify(reply).length).toBeLessThan(200);
        }
        expect(admissions.list(workspaceId)).toHaveLength(0);
        expect(queues()).toHaveLength(0);
    });

    it.each(['archived', 'deleted', 'workspace', 'sentinel', 'ralph', 'unresumable', 'stopped-no-session'] as const)(
        'rejects %s targets without reviving or queuing them', async kind => {
            const claim = reserve();
            if (kind === 'archived') await store.updateProcess(processId, { archived: true });
            if (kind === 'deleted') await store.removeProcess(processId);
            if (kind === 'workspace') await store.updateProcess(processId, { metadata: { workspaceId: 'foreign', mode: 'ask' } });
            if (kind === 'sentinel' || kind === 'ralph') await store.updateProcess(processId, { metadata: { workspaceId, mode: kind } });
            if (kind === 'unresumable') await store.updateProcess(processId, { status: 'cancelled', metadata: { workspaceId, mode: 'ask',
                stoppedChatResume: { resumable: false, reason: 'strict-resume-failed' } } });
            if (kind === 'stopped-no-session') await store.updateProcess(processId, { status: 'cancelled',
                activeProviderSession: { provider: 'copilot', segmentId: 'stopped', firstTurnIndex: 0 } });
            expect((await admit(claim)).body.admission.state).toBe('rejected');
            expect((await reconcile(claim)).body.admission.state).toBe('rejected');
            expect(queues()).toHaveLength(0);
            expect((await proc())?.pendingMessages ?? []).toHaveLength(0);
            if (kind === 'archived') expect((await proc())!.archived).toBe(true);
        },
    );

    it('retains active destination provider and strict stopped-session resumption', async () => {
        await store.updateProcess(processId, { status: 'cancelled', activeProviderSession: {
            provider: 'codex', sessionId: 'active-codex-session', segmentId: 'codex-segment', firstTurnIndex: 0,
        } });
        const claim = reserve();
        expect((await admit(claim)).body.admission.state).toBe('accepted');
        expect(queues()[0].payload).toMatchObject({ provider: 'codex', resumeSessionId: 'active-codex-session' });
    });

    it.each(['archived', 'deleted', 'workspace', 'provider'] as const)(
        'rechecks %s revocation during asynchronous queue routing', async kind => {
            const claim = reserve();
            const original = bridge.enqueueAdmitted.bind(bridge);
            vi.spyOn(bridge, 'enqueueAdmitted').mockImplementationOnce(async (...args) => {
                if (kind === 'archived') await store.updateProcess(processId, { archived: true });
                if (kind === 'deleted') await store.removeProcess(processId);
                if (kind === 'workspace') await store.updateProcess(processId, { metadata: { workspaceId: 'foreign', mode: 'ask' } });
                if (kind === 'provider') await store.updateProcess(processId, { activeProviderSession: {
                    provider: 'codex', sessionId: 'changed', segmentId: 'changed', firstTurnIndex: 0,
                } });
                return original(...args);
            });
            expect((await admit(claim)).body.admission.state).toBe('rejected');
            expect(queues()).toHaveLength(0);
            expect((await proc())?.conversationTurns ?? []).toHaveLength(0);
        },
    );

    it.each(['deliveryMode', 'provider', 'parentProcessId', 'requestReceiptId', 'messagingOrigin', 'turnSource'])(
        'rejects caller-selected %s instead of forwarding authority or correlation', async field => {
            const execution = { ...intent, body: { ...intent.body, [field]: 'private-injection' } };
            expect((await admit(reserve(execution), execution)).status).toBe(400);
            expect(admissions.list(workspaceId)).toHaveLength(0);
            expect(queues()).toHaveLength(0);
        },
    );

    it('rejects tampered content, forged proof and changed owner without execution', async () => {
        const claim = reserve();
        expect((await admit(claim, { ...intent, body: { content: 'tampered' } })).status).toBe(503);
        expect((await admit({ ...claim, proofToken: 'b'.repeat(64) })).status).toBe(503);
        remotes[0].serverIdentity = 'replacement-owner';
        expect((await admit(claim)).status).toBe(503);
        expect(admissions.list(workspaceId)).toHaveLength(0);
        expect(queues()).toHaveLength(0);
    });

    it('retains uncertainty on conflicting domain receipts and never trusts raw ID matches', async () => {
        const claim = reserve();
        const executionId = admissions.claim(requests.proveOrigin(claim)!).receipt.executionId;
        await bridge.enqueue({ id: executionId, type: 'chat', processId: 'foreign',
            payload: { kind: 'chat', prompt: 'foreign', processId: 'foreign', workspaceId: 'foreign', workingDirectory: path.join(directory, 'repo') } });
        expect((await reconcile(claim)).status).toBe(503);
        expect(row(claim).admission.state).toBe('dispatching');
        expect(queues()).toHaveLength(1);
        expect((await proc())!.conversationTurns).toHaveLength(0);
    });

    it('reads derived pending task receipts after buffer removal without another admission', async () => {
        const claim = reserve();
        const executionId = admissions.claim(requests.proveOrigin(claim)!).receipt.executionId;
        await bridge.enqueue({ id: `pending-${processId}-${executionId}`, type: 'chat', processId,
            payload: { kind: 'chat', prompt: 'already admitted', processId, workspaceId, relayRequestId: executionId,
                workingDirectory: path.join(directory, 'repo') } });
        expect((await reconcile(claim)).body.admission.state).toBe('accepted');
        expect(queues()).toHaveLength(1);
        expect((await proc())!.conversationTurns).toHaveLength(0);
    });

    it('keeps colliding origin request IDs independent across authenticated installations', async () => {
        const shared = randomUUID();
        const first = reserve(intent, requests, shared);
        const other = new RemoteDelegationRequestStore(path.join(directory, 'other-origin'));
        const routes: Route[] = [{ method: 'GET', pattern: '/api/health', handler: (_req, res) =>
            sendJson(res, { serverIdentity: getOrCreateServerIdentity(path.join(directory, 'other-origin')) }) }];
        registerRemoteDelegationProofRoutes(routes, other);
        const url = await listen(routes);
        remotes.push({ ...remotes[0], id: 'other-origin', serverIdentity: getOrCreateServerIdentity(path.join(directory, 'other-origin')), url, effectiveUrl: url });
        const second = reserve(intent, other, shared);
        expect((await admit(first)).body.admission.state).toBe('accepted');
        expect((await admit(second)).body.admission.state).toBe('accepted');
        expect(row(first).executionId).not.toBe(row(second).executionId);
        expect((await proc())!.pendingMessages).toHaveLength(1);
        expect(queues()).toHaveLength(1);
    });

    it('does not invent missing receipts and does not accept launch/Ralph through follow-up routes', async () => {
        const claim = reserve();
        expect((await reconcile(claim)).status).toBe(404);
        for (const kind of ['launch', 'ralph'] as const) {
            const execution = { ...intent, kind, targetProcessId: undefined };
            // Capture JSON omits optional undefined fields, as the actual wire does.
            const wire = JSON.parse(JSON.stringify(execution));
            const otherClaim = reserve(wire);
            expect((await admit(otherClaim, wire)).status).toBe(400);
            expect((await reconcile(otherClaim)).status).toBe(400);
        }
        expect(admissions.list(workspaceId)).toHaveLength(0);
    });
});
