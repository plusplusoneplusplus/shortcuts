import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepoQueueRegistry, SqliteProcessStore, toQueueProcessId } from '@plusplusoneplusplus/forge';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { SqliteQueuePersistence } from '../../../src/server/queue/sqlite-queue-persistence';
import { ProcessMessageDeliveryService } from '../../../src/server/processes/process-message-delivery-service';
import { RemoteDelegationAdmissionStore } from '../../../src/server/delegation/remote-delegation-admission-store';
import { RemoteDelegationRequestStore } from '../../../src/server/delegation/remote-delegation-request-store';
import { captureRemoteDelegationIntent, type RemoteDelegationIntent } from '../../../src/server/delegation/remote-delegation-admission';
import type { RemoteDelegationClaim } from '../../../src/server/delegation/remote-delegation-auth';
import { createRemoteDelegationLaunch } from '../../../src/server/delegation/remote-delegation-launch';
import { REMOTE_DELEGATION_LAUNCH_PATH, REMOTE_DELEGATION_RECEIPT_PATH,
    registerRemoteDelegationRoutes, registerRemoteDelegationProofRoutes } from '../../../src/server/delegation/remote-delegation-routes';
import { RalphSessionStore } from '../../../src/server/ralph/ralph-session-store';
import { RalphGrillingStore } from '../../../src/server/ralph/grilling-state';
import { getOrCreateServerIdentity } from '../../../src/server/servers/server-identity';
import { createRouter, sendJson, type Route } from '../../../src/server/shared/router';
import type { RemoteServerWithRuntime } from '../../../src/server/servers/remote-server-types';

const workspaceId = 'destination-repo';
const launch: RemoteDelegationIntent = { version: 1, kind: 'launch', workspaceId,
    body: { content: 'Inspect the saved goal', mode: 'ask', provider: 'copilot', title: 'Inspect goal' } };
const ralph = (entryPoint: 'grill' | 'execute'): RemoteDelegationIntent => ({ version: 1, kind: 'ralph', workspaceId,
    body: { goalSpec: '## Goal\nImplement the approved goal', entryPoint } });

describe('authenticated destination launch HTTP admission', () => {
    let directory: string;
    let store: SqliteProcessStore;
    let bridge: MultiRepoQueueRouter;
    let persistence: SqliteQueuePersistence;
    let requests: RemoteDelegationRequestStore;
    let admissions: RemoteDelegationAdmissionStore;
    let remotes: RemoteServerWithRuntime[];
    let destinationUrl: string;
    let ralphEnabled: boolean;
    const validateProvider = vi.fn();
    const servers: http.Server[] = [];
    const routes: Route[] = [];
    const destinationDir = () => path.join(directory, 'destination');
    const originDir = () => path.join(directory, 'origin');
    const repo = () => path.join(directory, 'repo');
    const queues = () => bridge.createAggregateQueueFacade().getAll();
    const row = (claim: RemoteDelegationClaim) => admissions.get(claim)!;

    function openDestination() {
        store = new SqliteProcessStore({ dbPath: path.join(destinationDir(), 'processes.db') });
        bridge = new MultiRepoQueueRouter(new RepoQueueRegistry(), store,
            { autoStart: false, aiService: createMockSDKService().service });
        bridge.registerRepoId(workspaceId, repo());
        persistence = new SqliteQueuePersistence(bridge, store.getDatabase(), { restartPolicy: 'fail' });
        persistence.restore();
        admissions = new RemoteDelegationAdmissionStore(destinationDir());
        routes.splice(0);
        registerRemoteDelegationRoutes(routes, {
            admissions, store, remotes: { list: () => remotes },
            delivery: new ProcessMessageDeliveryService({ store, bridge }),
            launch: createRemoteDelegationLaunch({ queue: {
                bridge, store, dataDir: destinationDir(), globalWorkspaceRootPath: '/never-use-fallback',
                state: { globalPaused: true, globalAutopilotPaused: false, resumeInProgress: new Set() },
                getDefaultProvider: () => 'copilot', validateProvider,
                getEffortTiersForProvider: () => ({ high: { model: 'gpt-5', reasoningEffort: 'high' } }) as any,
                isAutoProviderRoutingActive: () => false,
            }, getRalphEnabled: () => ralphEnabled }),
        });
    }
    function closeDestination() { persistence.dispose(); bridge.dispose(); store.close(); }
    async function listen(list: Route[]) {
        const server = http.createServer(createRouter({ routes: list, spaHtml: '' }));
        servers.push(server);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        return `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    }
    function reserve(intent = launch, origin = requests, requestId?: string): RemoteDelegationClaim {
        const request = origin.reserve({ requestId, parent: { workspaceId: 'origin-repo', processId: 'sentinel' },
            destination: { serverId: 'target-alias', serverIdentity: admissions.serverIdentity, workspaceId: intent.workspaceId },
            kind: intent.kind, intentDigest: captureRemoteDelegationIntent(intent).digest, title: 'Inspect goal' });
        origin.beginDispatch(request.parent.workspaceId, request.requestId);
        return { version: 1, requestId: request.requestId, originServerIdentity: request.originServerIdentity,
            parent: request.parent, destination: { serverIdentity: request.destination.serverIdentity, workspaceId: intent.workspaceId },
            kind: intent.kind, intentDigest: request.intentDigest, proofToken: request.proofToken! };
    }
    async function post(route: string, body: unknown) {
        const response = await fetch(`${destinationUrl}${route}`, { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        expect(response.headers.get('cache-control')).toBe('no-store');
        return { status: response.status, body: await response.json() as any };
    }
    const admit = (claim: RemoteDelegationClaim, intent: unknown = launch) => post(REMOTE_DELEGATION_LAUNCH_PATH, { claim, intent });
    const reconcile = (claim: RemoteDelegationClaim) => post(REMOTE_DELEGATION_RECEIPT_PATH, claim);

    beforeEach(async () => {
        validateProvider.mockReset();
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-launch-'));
        fs.mkdirSync(destinationDir()); fs.mkdirSync(repo());
        ralphEnabled = true;
        requests = new RemoteDelegationRequestStore(originDir());
        const originRoutes: Route[] = [{ method: 'GET', pattern: '/api/health', handler: (_req, res) =>
            sendJson(res, { serverIdentity: getOrCreateServerIdentity(originDir()) }) }];
        registerRemoteDelegationProofRoutes(originRoutes, requests);
        const originUrl = await listen(originRoutes);
        remotes = [{ id: 'origin-alias', kind: 'url', label: 'Origin', url: originUrl, effectiveUrl: originUrl,
            status: 'online', serverIdentity: getOrCreateServerIdentity(originDir()), addedAt: 1, updatedAt: 1 }];
        openDestination();
        await store.registerWorkspace({ id: workspaceId, rootPath: repo(), name: 'Destination' });
        destinationUrl = await listen(routes);
    });
    afterEach(async () => {
        vi.restoreAllMocks();
        for (const server of servers.splice(0)) {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
        closeDestination(); fs.rmSync(directory, { recursive: true, force: true });
    });

    it('admits one exact-owner chat through the paused queue and conceals private correlation', async () => {
        const claim = reserve();
        const response = await admit(claim);
        const executionId = row(claim).executionId;
        expect(response).toMatchObject({ status: 202, body: { admission: { state: 'accepted',
            child: { processId: toQueueProcessId(executionId) } } } });
        expect(executionId).not.toBe(claim.requestId);
        expect(JSON.stringify(response.body)).not.toMatch(new RegExp(`${claim.proofToken}|Inspect the saved goal|executionId`));
        expect(queues()).toHaveLength(1);
        expect(queues()[0]).toMatchObject({ id: executionId, type: 'chat', displayName: 'Inspect goal',
            payload: { workspaceId, mode: 'ask', provider: 'copilot', workingDirectory: repo(), customTitle: 'Inspect goal' } });
        expect(queues()[0].payload.context).toBeUndefined();
        expect(bridge.registry.getQueueForRepo(repo()).getStats().isPaused).toBe(true);
        expect(validateProvider).toHaveBeenCalledWith('copilot');
        expect(await admit(claim)).toEqual(response);
        expect((await reconcile(claim)).body).toEqual(response.body);
        expect(queues()).toHaveLength(1);
    });

    it.each(['grill', 'execute'] as const)('uses native Ralph %s with destination-owned whole-session identity', async entryPoint => {
        const intent = ralph(entryPoint);
        const claim = reserve(intent);
        const response = await admit(claim, intent);
        const executionId = row(claim).executionId;
        const sessionId = `ralph-approved-${executionId}`;
        expect(response.body.admission).toEqual({ state: 'accepted', child: { processId: toQueueProcessId(executionId), sessionId } });
        expect(queues()).toHaveLength(1);
        expect(queues()[0]).toMatchObject({ id: executionId, payload: { workspaceId,
            mode: entryPoint === 'grill' ? 'ask' : 'ralph', context: { ralph: { sessionId,
                phase: entryPoint === 'grill' ? 'grilling' : 'executing' } } } });
        if (entryPoint === 'grill') {
            expect(await new RalphGrillingStore(destinationDir()).read(workspaceId, sessionId))
                .toMatchObject({ workspaceId, sessionId, processId: toQueueProcessId(executionId) });
            expect(await new RalphSessionStore({ dataDir: destinationDir() }).readSessionRecord(workspaceId, sessionId))
                .toMatchObject({ phase: 'grilling', currentIteration: 0, iterations: [], originalGoal: '' });
        } else {
            expect(await new RalphSessionStore({ dataDir: destinationDir() }).readSessionRecord(workspaceId, sessionId))
                .toMatchObject({ workspaceId, sessionId, phase: 'executing', currentIteration: 0 });
        }
        closeDestination(); openDestination();
        requests = new RemoteDelegationRequestStore(originDir());
        expect((await reconcile(claim)).body.admission).toEqual(response.body.admission);
        expect((await admit(claim, intent)).body.admission).toEqual(response.body.admission);
        expect(queues()).toHaveLength(1);
    });

    it.each([launch, ralph('grill'), ralph('execute')])('repairs lost acceptance for $kind without another launch', async intent => {
        const claim = reserve(intent);
        vi.spyOn(admissions, 'accept').mockImplementationOnce(() => { throw new Error('private receipt path'); });
        expect((await admit(claim, intent)).body.admission.state).toBe('uncertain');
        closeDestination(); openDestination();
        const enqueue = vi.spyOn(bridge, 'enqueue');
        expect((await reconcile(claim)).body.admission.state).toBe('accepted');
        expect((await admit(claim, intent)).body.admission.state).toBe('accepted');
        expect(enqueue).not.toHaveBeenCalled();
        expect(queues()).toHaveLength(1);
    });

    it.each([launch, ralph('grill'), ralph('execute')])('never replays a consumed $kind claim with no queue evidence', async intent => {
        const claim = reserve(intent);
        admissions.claim(requests.proveOrigin(claim)!);
        if (intent.kind === 'ralph') await new RalphSessionStore({ dataDir: destinationDir() }).initSession(workspaceId,
            `ralph-approved-${row(claim).executionId}`, { originalGoal: 'Prepared only', maxIterations: 2 });
        closeDestination(); openDestination();
        expect((await reconcile(claim)).body.admission.state).toBe('dispatching');
        expect((await admit(claim, intent)).body.admission.state).toBe('dispatching');
        expect(queues()).toHaveLength(0);
    });

    it('deduplicates concurrent HTTP requests', async () => {
        const claim = reserve();
        const responses = await Promise.all([admit(claim), admit(claim), admit(claim)]);
        expect(responses.every(response => response.status === 202)).toBe(true);
        expect((await reconcile(claim)).body.admission.state).toBe('accepted');
        expect(queues()).toHaveLength(1);
    });

    it.each(['launch', 'ralph'] as const)('keeps $kind queue errors uncertain without replay', async kind => {
        const intent = kind === 'launch' ? launch : ralph('grill');
        const claim = reserve(intent);
        const enqueue = vi.spyOn(bridge.registry.getQueueForRepo(repo()), 'enqueue').mockImplementation(() => { throw new Error('private queue failure'); });
        expect((await admit(claim, intent)).body.admission.state).toBe('uncertain');
        expect((await admit(claim, intent)).body.admission.state).toBe('uncertain');
        expect((await reconcile(claim)).body.admission.state).toBe('uncertain');
        expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it.each(['launch', 'ralph'] as const)('recovers $kind acceptance after a queue observer throws', async kind => {
        const intent = kind === 'launch' ? launch : ralph('execute');
        const claim = reserve(intent);
        const manager = bridge.registry.getQueueForRepo(repo());
        manager.on('taskAdded', () => { throw new Error('private observer failure'); });
        await admit(claim, intent);
        expect((await reconcile(claim)).body.admission.state).toBe('accepted');
        expect(queues()).toHaveLength(1);
    });

    it.each(['grill', 'execute'] as const)('preserves disabled Ralph %s admission', async entryPoint => {
        ralphEnabled = false;
        const intent = ralph(entryPoint);
        const claim = reserve(intent);
        expect((await admit(claim, intent)).body.admission.state).toBe('rejected');
        ralphEnabled = true;
        expect((await admit(claim, intent)).body.admission.state).toBe('rejected');
        expect(queues()).toHaveLength(0);
    });

    it('rejects unknown workspaces without a global or cwd fallback', async () => {
        const intent = { ...launch, workspaceId: 'missing' };
        expect((await admit(reserve(intent), intent)).body.admission.state).toBe('rejected');
        expect(queues()).toHaveLength(0);
    });

    it('routes two registered workspaces independently on the same destination', async () => {
        const otherRoot = path.join(directory, 'other-repo');
        fs.mkdirSync(otherRoot);
        await store.registerWorkspace({ id: 'other-repo', rootPath: otherRoot, name: 'Other' });
        const second = { ...launch, workspaceId: 'other-repo' };
        const firstClaim = reserve();
        const secondClaim = reserve(second);
        expect((await admit(firstClaim)).body.admission.state).toBe('accepted');
        expect((await admit(secondClaim, second)).body.admission.state).toBe('accepted');
        expect(bridge.registry.getQueueForRepo(repo()).getAll()).toMatchObject([
            { id: row(firstClaim).executionId, payload: { workspaceId, workingDirectory: repo() } }]);
        expect(bridge.registry.getQueueForRepo(otherRoot).getAll()).toMatchObject([
            { id: row(secondClaim).executionId, payload: { workspaceId: 'other-repo', workingDirectory: otherRoot } }]);
    });

    it('revalidates the workspace after asynchronous provider policy', async () => {
        validateProvider.mockImplementationOnce(async () => {
            await store.registerWorkspace({ id: workspaceId, rootPath: path.join(directory, 'moved'), name: 'Moved' });
        });
        expect((await admit(reserve())).body.admission.state).toBe('rejected');
        expect(queues()).toHaveLength(0);
    });

    it('resolves destination effort tiers through existing preparation', async () => {
        const intent = { ...launch, body: { ...launch.body, config: { effortTier: 'high' } } };
        expect((await admit(reserve(intent), intent)).body.admission.state).toBe('accepted');
        expect(queues()[0].config).toMatchObject({ model: 'gpt-5', reasoningEffort: 'high' });
    });

    it.each([launch, ralph('grill'), ralph('execute')])('repairs $kind acceptance from an exact persisted process', async intent => {
        const claim = reserve(intent);
        admissions.claim(requests.proveOrigin(claim)!);
        const executionId = row(claim).executionId;
        const sessionId = `ralph-approved-${executionId}`;
        await store.addProcess({ id: toQueueProcessId(executionId), type: 'chat', status: 'completed', startTime: new Date(),
            promptPreview: 'Already ran', metadata: { workspaceId, mode: intent.kind === 'ralph' ? 'ralph' : 'ask',
                ...(intent.kind === 'ralph' ? { ralph: { sessionId, phase: 'executing' } } : {}) } });
        closeDestination(); openDestination();
        expect((await reconcile(claim)).body.admission).toEqual({ state: 'accepted', child: {
            processId: toQueueProcessId(executionId), ...(intent.kind === 'ralph' ? { sessionId } : {}) } });
        expect(queues()).toHaveLength(0);
    });

    it.each(['workspace', 'type', 'mode', 'session'] as const)('refuses conflicting %s evidence', async conflict => {
        const intent = conflict === 'session' ? ralph('execute') : launch;
        const claim = reserve(intent);
        vi.spyOn(admissions, 'accept').mockImplementationOnce(() => { throw new Error('private receipt failure'); });
        await admit(claim, intent);
        const executionId = row(claim).executionId;
        await store.addProcess({ id: toQueueProcessId(executionId), type: conflict === 'type' ? 'workflow' : 'chat',
            status: 'completed', startTime: new Date(), promptPreview: 'Conflict', metadata: {
                workspaceId: conflict === 'workspace' ? 'foreign-repo' : workspaceId,
                mode: conflict === 'mode' ? 'sentinel' : 'ask',
                ...(conflict === 'session' ? { ralph: { sessionId: 'different-session' } } : {}) } });
        expect((await reconcile(claim)).status).toBe(503);
        expect(row(claim).admission.state).toBe('uncertain');
        expect(queues()).toHaveLength(1);
    });

    it.each([launch, ralph('execute')])('recognizes an admitted $kind process after its root task is reused for a follow-up', async intent => {
        const claim = reserve(intent);
        admissions.claim(requests.proveOrigin(claim)!);
        const executionId = row(claim).executionId;
        const processId = toQueueProcessId(executionId);
        const sessionId = `ralph-approved-${executionId}`;
        await store.addProcess({ id: processId, type: 'chat', status: 'completed', startTime: new Date(),
            workingDirectory: repo(), promptPreview: 'Already ran', metadata: { workspaceId, mode: 'ask',
                ...(intent.kind === 'ralph' ? { ralph: { sessionId, phase: 'executing' } } : {}) } });
        await bridge.requeueForFollowUp(executionId, 'Later explicit user follow-up');
        expect((await reconcile(claim)).body.admission.state).toBe('accepted');
        expect(queues()).toHaveLength(1);
        expect(queues()[0].payload.prompt).toBe('Later explicit user follow-up');
    });

    it('never creates a missing destination claim during receipt reconciliation', async () => {
        const claim = reserve();
        expect((await reconcile(claim)).status).toBe(404);
        expect(admissions.list(workspaceId)).toHaveLength(0);
        expect(queues()).toHaveLength(0);
    });

    it('keeps provider policy failure uncertain and never dispatches it later', async () => {
        validateProvider.mockRejectedValueOnce(new Error('private provider failure'));
        const claim = reserve();
        expect((await admit(claim)).body.admission.state).toBe('uncertain');
        expect((await admit(claim)).body.admission.state).toBe('uncertain');
        expect(queues()).toHaveLength(0);
    });

    it.each(['sentinel', 'ralph', 'plan'])('rejects ordinary launch mode %s', async mode => {
        const intent = { ...launch, body: { ...launch.body, mode } };
        expect((await admit(reserve(intent), intent)).status).toBe(400);
        expect(admissions.list(workspaceId)).toHaveLength(0);
    });

    it('keeps explicit Auto routing under destination policy', async () => {
        const intent = { ...launch, body: { content: 'Inspect', autoProviderRouting: true } };
        expect((await admit(reserve(intent), intent)).body.admission.state).toBe('uncertain');
        expect(queues()).toHaveLength(0);
    });

    it('cannot execute when the initial destination claim cannot persist', async () => {
        const claim = reserve();
        vi.spyOn(admissions, 'claim').mockImplementationOnce(() => { throw new Error('private claim failure'); });
        const response = await admit(claim);
        expect(response.status).toBe(503);
        expect(JSON.stringify(response.body)).not.toContain('private');
        expect(queues()).toHaveLength(0);
    });

    it.each(['workspace', 'follow-up', 'ralph'] as const)('refuses conflicting queue %s evidence', async conflict => {
        const claim = reserve();
        vi.spyOn(admissions, 'accept').mockImplementationOnce(() => { throw new Error('private receipt failure'); });
        await admit(claim);
        const task = queues()[0];
        const payload = { ...task.payload,
            ...(conflict === 'workspace' ? { workspaceId: 'foreign-repo' } : {}),
            ...(conflict === 'follow-up' ? { processId: 'different-chat' } : {}),
            ...(conflict === 'ralph' ? { context: { ralph: { sessionId: 'foreign-session' } } } : {}) };
        vi.spyOn(bridge, 'getTask').mockReturnValue({ ...task, payload } as any);
        expect((await reconcile(claim)).status).toBe(503);
        expect(row(claim).admission.state).toBe('uncertain');
        expect(queues()).toHaveLength(1);
    });

    it.each(['workingDirectory', 'folderPath', 'workspaceId', 'requestId', 'spawnedFromProcessId', 'messagingOrigin',
        'sentinelTodoTracking', 'context', 'worktree', 'processId', 'callbackUrl'])('rejects caller-controlled %s', async field => {
        const intent = { ...launch, body: { ...launch.body, [field]: 'injected' } };
        expect((await admit(reserve(intent), intent)).status).toBe(400);
        expect(admissions.list(workspaceId)).toHaveLength(0);
        expect(queues()).toHaveLength(0);
    });

    it.each(['worktree', 'workingDirectory', 'requestId', 'spawnedFromProcessId', 'sentinelTodoTracking', 'messagingOrigin'])
        ('rejects caller-controlled Ralph %s', async field => {
            const intent = { ...ralph('grill'), body: { ...ralph('grill').body, [field]: 'injected' } };
            expect((await admit(reserve(intent), intent)).status).toBe(400);
            expect(admissions.list(workspaceId)).toHaveLength(0);
        });

    it('rejects mismatched intent, wrong authentication and unavailable relationships before execution', async () => {
        const claim = reserve();
        expect((await admit(claim, { ...launch, body: { content: 'Other work' } })).status).toBe(503);
        expect((await admit({ ...claim, proofToken: '0'.repeat(64) })).status).toBe(503);
        remotes = [];
        expect((await admit(claim)).status).toBe(503);
        expect(admissions.list(workspaceId)).toHaveLength(0);
        expect(queues()).toHaveLength(0);
    });

    it('keeps distinct destination IDs for colliding origin UUIDs', async () => {
        const requestId = randomUUID();
        const first = reserve(launch, requests, requestId);
        const otherDir = path.join(directory, 'other-origin');
        const other = new RemoteDelegationRequestStore(otherDir);
        const otherRoutes: Route[] = [{ method: 'GET', pattern: '/api/health', handler: (_req, res) =>
            sendJson(res, { serverIdentity: getOrCreateServerIdentity(otherDir) }) }];
        registerRemoteDelegationProofRoutes(otherRoutes, other);
        const url = await listen(otherRoutes);
        remotes.push({ ...remotes[0], id: 'other-alias', serverIdentity: getOrCreateServerIdentity(otherDir), url, effectiveUrl: url });
        const second = reserve(launch, other, requestId);
        await admit(first); await admit(second);
        expect(row(first).executionId).not.toBe(row(second).executionId);
        expect(queues()).toHaveLength(2);
    });
});
