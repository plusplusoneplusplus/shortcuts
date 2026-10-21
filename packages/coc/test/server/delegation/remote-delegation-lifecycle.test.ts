import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { createQueueInfrastructure } from '../../../src/server/infrastructure/queue-infrastructure';
import { DEFAULT_QUEUE_RUNTIME_CONFIG } from '../../../src/server/queue/queue-runtime-config';
import { CLITaskExecutor } from '../../../src/server/queue/queue-executor-bridge';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { createRemoteDelegationLaunch } from '../../../src/server/delegation/remote-delegation-launch';
import { RemoteDelegationAdmissionStore } from '../../../src/server/delegation/remote-delegation-admission-store';
import { RemoteDelegationResults } from '../../../src/server/delegation/remote-delegation-results';
import { RemoteDelegationReturn } from '../../../src/server/delegation/remote-delegation-return';
import { RemoteDelegationRequestStore } from '../../../src/server/delegation/remote-delegation-request-store';
import { DelegatedJobStore } from '../../../src/server/delegation/delegated-job-store';
import { DelegatedJobReviews, delegatedReviewReceipt } from '../../../src/server/delegation/delegated-job-reviews';
import { registerRemoteDelegationProofRoutes, registerRemoteDelegationRoutes } from '../../../src/server/delegation/remote-delegation-routes';
import { ProcessMessageDeliveryService } from '../../../src/server/processes/process-message-delivery-service';
import { RalphSessionStore } from '../../../src/server/ralph/ralph-session-store';
import { createRouter, sendJson, type Route } from '../../../src/server/shared/router';
import type { RemoteServerWithRuntime } from '../../../src/server/servers/remote-server-types';
import type { RemoteDelegationIntent } from '../../../src/server/delegation/remote-delegation-admission';
import { MessagingJobNotices } from '../../../src/server/messaging/job-notices';

// Raw workspace and process identities deliberately collide across both installations.
const workspaceId = 'shared-repo';
const parentId = 'queue_shared-chat';
type Infrastructure = ReturnType<typeof createQueueInfrastructure>;

describe('remote Sentinel lifecycle over authenticated fixture HTTP', () => {
    let directory: string;
    let originDir: string;
    let destinationDir: string;
    let repo: string;
    let origin: SqliteProcessStore;
    let destination: SqliteProcessStore;
    let originInfra: Infrastructure;
    let destinationInfra: Infrastructure;
    let requests: RemoteDelegationRequestStore;
    let jobs: DelegatedJobStore;
    let admissions: RemoteDelegationAdmissionStore;
    let capture: RemoteDelegationResults;
    let reviews: DelegatedJobReviews;
    let notices: MessagingJobNotices;
    let returns: RemoteDelegationReturn;
    let originRemotes: RemoteServerWithRuntime[];
    let destinationRemotes: RemoteServerWithRuntime[];
    let originUrl: string;
    let destinationUrl: string;
    let enabled: boolean;
    let disconnected: boolean;
    let loseAdmissionReply: boolean;
    let executionPosts: number;
    let receiptAttempts: number;
    let tamper: 'binding' | 'links' | 'capped' | undefined;
    let stalled: boolean;
    const servers: http.Server[] = [];
    const destinationRoutes: Route[] = [];
    const relay = vi.fn();
    const input: RemoteDelegationIntent = { version: 1, kind: 'launch', workspaceId,
        body: { content: 'Inspect fixture work', mode: 'ask', provider: 'copilot' } };

    function infrastructure(store: SqliteProcessStore, dataDir: string) {
        return createQueueInfrastructure(store, dataDir,
            { queue: { autoStart: false, historyLimit: 1 }, aiService: createMockSDKService().service },
            DEFAULT_QUEUE_RUNTIME_CONFIG, () => ({ broadcastProcessEvent: vi.fn() }) as never);
    }
    async function listen(routes: Route[]) {
        const server = http.createServer(createRouter({ routes, spaHtml: '' }));
        servers.push(server);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Fixture listener unavailable');
        return `http://127.0.0.1:${address.port}`;
    }
    function openDestination() {
        destination = new SqliteProcessStore({ dbPath: path.join(destinationDir, 'processes.db') });
        destinationInfra = infrastructure(destination, destinationDir);
        destinationInfra.bridge.registerRepoId(workspaceId, repo);
        admissions = new RemoteDelegationAdmissionStore(destinationDir);
        const delivery = new ProcessMessageDeliveryService({ store: destination, bridge: destinationInfra.bridge });
        const launch = createRemoteDelegationLaunch({ queue: {
            bridge: destinationInfra.bridge, store: destination, dataDir: destinationDir,
            state: { globalPaused: true, globalAutopilotPaused: false, resumeInProgress: new Set() },
            getDefaultProvider: () => 'copilot',
        }, getRalphEnabled: () => true,
        getRetainedTask: (owner, task) => destinationInfra.queuePersistence.getRetainedTerminalTask(owner, task) });
        capture = new RemoteDelegationResults({
            admissions, store: destination, dataDir: destinationDir, queue: destinationInfra.queueFacade,
            sessions: new RalphSessionStore({ dataDir: destinationDir }),
            getRetainedTask: (owner, task) => destinationInfra.queuePersistence.getRetainedTerminalTask(owner, task),
            findChild: async row => row.kind === 'follow-up'
                ? await delivery.findRemoteFollowUpReceipt(workspaceId, row.targetProcessId!, row.executionId)
                    ? { processId: row.targetProcessId! } : undefined
                : launch.findChild(row),
        });
        destinationRoutes.splice(0);
        destinationRoutes.push({ method: 'GET', pattern: '/api/health',
            handler: (_req, res) => sendJson(res, { serverIdentity: admissions.serverIdentity }) });
        registerRemoteDelegationRoutes(destinationRoutes, { admissions, store: destination, delivery, launch,
            remotes: { list: () => destinationRemotes }, results: { ready: capture.restore(), capture: () => capture.restore() } });
    }
    function closeDestination() {
        capture.dispose(); destinationInfra.queuePersistence.dispose(); destinationInfra.bridge.dispose(); destination.close();
    }
    function openOrigin() {
        origin = new SqliteProcessStore({ dbPath: path.join(originDir, 'processes.db') });
        originInfra = infrastructure(origin, originDir);
        originInfra.bridge.registerRepoId(workspaceId, repo);
        jobs = new DelegatedJobStore(originDir);
        requests = new RemoteDelegationRequestStore(originDir, jobs);
        notices = new MessagingJobNotices({ dataDir: originDir, store: origin, queue: originInfra.queueFacade, delegatedJobs: jobs });
        notices.register({ platform: 'teams', connected: chatKey => chatKey === 'origin-channel', post: relay });
        reviews = new DelegatedJobReviews({ jobs, store: origin, queue: originInfra.queueFacade,
            delivery: new ProcessMessageDeliveryService({ store: origin, bridge: originInfra.bridge }),
            recoverPendingMessages: (owner, parent) => originInfra.bridge.recoverPendingMessages(owner, parent),
            getRetainedTask: (owner, task) => originInfra.queuePersistence.getRetainedTerminalTask(owner, task),
            queueMessagingResult: result => notices.queueResult(result), reconcileMessagingNotices: () => notices.reconcile() });
        returns = makeReturns();
    }
    function makeReturns(timeoutMs?: number) {
        return new RemoteDelegationReturn({ requests, jobs, store: origin, timeoutMs,
            remotes: { list: () => originRemotes }, enabled: () => enabled, onResult: job => reviews.schedule(job),
            fetchImpl: async (url, options) => {
                if (String(url).endsWith('/receipt')) receiptAttempts++;
                if (stalled) return new Promise<Response>(() => {});
                if (disconnected) throw new Error('Fixture disconnected');
                const execution = String(url).endsWith('/launch') || String(url).endsWith('/follow-up');
                if (execution) executionPosts++;
                const response = await fetch(url, options);
                if (execution && loseAdmissionReply) throw new Error('Fixture lost admission reply');
                if (tamper && String(url).endsWith('/receipt')) {
                    const body = await response.json() as { parent: { workspaceId: string; processId: string };
                        terminal?: { result: { outcome: string; links: string[] } } };
                    if (tamper === 'binding') body.parent.processId = 'foreign-sentinel';
                    if (tamper === 'links' && body.terminal) body.terminal.result.links = ['https://untrusted.invalid/result'];
                    if (tamper === 'capped' && body.terminal) body.terminal.result.outcome = 'capped';
                    return Response.json(body, { status: response.status });
                }
                return response;
            },
        });
    }
    function closeOrigin() {
        returns.dispose(); reviews.dispose(); notices.dispose(); originInfra.queuePersistence.dispose(); originInfra.bridge.dispose(); origin.close();
    }
    async function dispatch(execution = input, requestId = randomUUID()) {
        const result = await returns.dispatch('destination-alias', execution, {
            requestId, parent: { workspaceId, processId: parentId }, title: 'Fixture work',
            messagingOrigin: { connector: 'teams', chatKey: 'origin-channel', threadId: 'origin-thread' },
        });
        if (!result || 'unavailable' in result) throw new Error('Expected authenticated tracked admission');
        return result;
    }
    async function complete(requestId: string, outcome: 'completed' | 'failed' | 'cancelled') {
        const row = admissions.list(workspaceId).find(row => row.requestId === requestId);
        if (!row) throw new Error('Expected destination admission');
        const manager = destinationInfra.registry.getQueueForRepo(repo);
        manager.markStarted(row.executionId);
        if (outcome === 'completed') manager.markCompleted(row.executionId, 'Exact remote outcome');
        else if (outcome === 'failed') manager.markFailed(row.executionId, 'Exact remote failure');
        else manager.cancelTask(row.executionId);
        await capture.restore();
        expect(admissions.get(row)?.terminal?.result.outcome).toBe(outcome);
    }
    beforeEach(async () => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-lifecycle-'));
        originDir = path.join(directory, 'origin'); destinationDir = path.join(directory, 'destination'); repo = path.join(directory, 'repo');
        fs.mkdirSync(originDir); fs.mkdirSync(destinationDir); fs.mkdirSync(repo);
        enabled = true; disconnected = false; loseAdmissionReply = false; executionPosts = 0; receiptAttempts = 0;
        tamper = undefined; stalled = false; relay.mockReset().mockResolvedValue('fixture-message');
        originRemotes = []; destinationRemotes = [];
        openOrigin(); openDestination();
        await origin.registerWorkspace({ id: workspaceId, name: 'Origin', rootPath: repo });
        await destination.registerWorkspace({ id: workspaceId, name: 'Destination', rootPath: repo });
        await origin.addProcess({ id: parentId, type: 'chat', status: 'running', startTime: new Date(), promptPreview: 'Sentinel',
            sdkSessionId: 'origin-session', workingDirectory: repo, metadata: { workspaceId, mode: 'sentinel', provider: 'copilot' } });
        await destination.addProcess({ id: parentId, type: 'chat', status: 'completed', startTime: new Date(), promptPreview: 'Target',
            sdkSessionId: 'destination-session', workingDirectory: repo, metadata: { workspaceId, mode: 'ask', provider: 'copilot' } });
        const originRoutes: Route[] = [{ method: 'GET', pattern: '/api/health',
            handler: (_req, res) => sendJson(res, { serverIdentity: jobs.serverIdentity }) }];
        registerRemoteDelegationProofRoutes(originRoutes, requests);
        originUrl = await listen(originRoutes); destinationUrl = await listen(destinationRoutes);
        originRemotes = [{ id: 'destination-alias', kind: 'url', url: destinationUrl, effectiveUrl: destinationUrl,
            status: 'online', serverIdentity: admissions.serverIdentity, addedAt: 1, updatedAt: 1 }];
        destinationRemotes = [{ id: 'origin-alias', kind: 'url', url: originUrl, effectiveUrl: originUrl,
            status: 'online', serverIdentity: jobs.serverIdentity, addedAt: 1, updatedAt: 1 }];
    });
    afterEach(async () => {
        for (const server of servers.splice(0)) {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
        closeOrigin(); closeDestination();
        fs.rmSync(directory, { recursive: true, force: true });
    });

    it('returns launch plus two exact follow-up outcomes and queues assessment only in the busy owner', async () => {
        const launch = await dispatch();
        await complete(launch.resultDelivery.remote.requestId, 'completed');
        const followUp: RemoteDelegationIntent = { version: 1, kind: 'follow-up', workspaceId, targetProcessId: parentId,
            body: { content: 'Follow up on the remote target' } };
        const first = await dispatch(followUp);
        await complete(first.resultDelivery.remote.requestId, 'failed');
        await destination.updateProcess(parentId, { status: 'completed' });
        const second = await dispatch(followUp);
        await complete(second.resultDelivery.remote.requestId, 'cancelled');
        await returns.recover(true); await returns.recover(true);
        expect(executionPosts).toBe(3);
        expect(jobs.list(workspaceId).map(job => job.terminal?.result.outcome)).toEqual(['completed', 'failed', 'cancelled']);
        expect((await origin.getProcess(parentId))?.pendingMessages).toHaveLength(3);
        expect(originInfra.queueFacade.getQueued()).toEqual([]);
        expect(relay).not.toHaveBeenCalled();
        for (const job of jobs.list(workspaceId)) {
            await origin.updateProcess(parentId, { status: 'completed' });
            await returns.recover(true);
            const task = originInfra.queueFacade.getQueued()[0];
            expect(task).toMatchObject({ id: delegatedReviewReceipt(job), processId: parentId, payload: { workspaceId, processId: parentId } });
            expect(String(task.payload.prompt)).toContain(admissions.serverIdentity);
            const manager = originInfra.registry.getQueueForRepo(repo);
            manager.markStarted(task.id);
            await origin.appendConversationTurn(parentId, turnIndex => ({ role: 'assistant', content: `Assessed ${job.id}`, timestamp: new Date(), turnIndex }));
            manager.markCompleted(task.id);
            await vi.waitFor(() => expect(jobs.list(workspaceId).find(row => row.id === job.id)?.terminal?.delivery.state).toBe('delivered'));
        }
        await notices.reconcile();
        expect(relay).toHaveBeenCalledTimes(3);
        expect(relay.mock.calls.every(([chatKey, notice]) => chatKey === 'origin-channel'
            && notice.threadId === 'origin-thread' && notice.body.startsWith('Assessed remote:'))).toBe(true);
        expect(destinationInfra.queueFacade.getQueued()).toEqual([]);
    });

    it('recovers both installations after disconnect with the origin flag off, without executing again', async () => {
        const result = await dispatch();
        disconnected = true;
        await complete(result.resultDelivery.remote.requestId, 'completed');
        await returns.recover(true);
        expect(jobs.list(workspaceId)[0].remote?.delivery).toMatchObject({ state: 'failed' });
        const attempts = receiptAttempts;
        await returns.recover();
        expect(receiptAttempts).toBe(attempts);
        expect(requests.list(workspaceId)[0].transfer?.nextAttemptAt).toBeGreaterThan(Date.now());
        closeOrigin(); closeDestination(); openOrigin(); openDestination();
        enabled = false; disconnected = false;
        await capture.restore(); await returns.recover(true); await returns.recover(true);
        expect(executionPosts).toBe(1);
        expect(jobs.list(workspaceId)[0]).toMatchObject({ remote: { delivery: { state: 'received' } },
            terminal: { result: { outcome: 'completed' }, delivery: { state: 'queued' } } });
        expect((await origin.getProcess(parentId))?.pendingMessages).toHaveLength(1);
        expect(destinationInfra.queueFacade.getAll()).toEqual([]);
    });

    it.each(['completed', 'failed', 'cancelled'] as const)('captures persisted %s evidence after destination restart before result observation', async outcome => {
        const result = await dispatch({ version: 1, kind: 'follow-up', workspaceId, targetProcessId: parentId,
            body: { content: 'Observe exact persisted follow-up' } });
        const row = admissions.list(workspaceId)[0];
        capture.dispose();
        const manager = destinationInfra.registry.getQueueForRepo(repo);
        manager.markStarted(row.executionId);
        if (outcome === 'completed') manager.markCompleted(row.executionId, 'Result before observation');
        else if (outcome === 'failed') manager.markFailed(row.executionId, 'Failure before observation');
        else manager.cancelTask(row.executionId);
        expect(admissions.get(row)?.terminal).toBeUndefined();
        closeDestination(); openDestination();
        await capture.restore(); await returns.recover(true);
        expect(jobs.list(workspaceId)[0]).toMatchObject({ remote: { requestId: result.resultDelivery.remote.requestId },
            terminal: { result: { outcome } } });
        expect(executionPosts).toBe(1);
        expect(destinationInfra.queueFacade.getAll()).toEqual([]);
        expect((await origin.getProcess(parentId))?.pendingMessages).toHaveLength(1);
    });

    it('reconciles a lost execution acknowledgement and a changed alias without duplicate work', async () => {
        const requestId = randomUUID();
        loseAdmissionReply = true;
        await expect(dispatch(input, requestId)).rejects.toMatchObject({ dispatchState: 'uncertain' });
        expect(admissions.list(workspaceId)).toHaveLength(1);
        await complete(requestId, 'completed');
        loseAdmissionReply = false;
        originRemotes = [{ ...originRemotes[0], id: 'replacement-alias' }];
        await returns.recover(true);
        expect(executionPosts).toBe(1);
        expect(jobs.list(workspaceId)[0].terminal?.result.summary).toBe('Exact remote outcome');
        expect((await origin.getProcess(parentId))?.pendingMessages).toHaveLength(1);
        await returns.recover(true);
        expect((await origin.getProcess(parentId))?.pendingMessages).toHaveLength(1);
    });

    it('does not revive an archived origin when remote work completes', async () => {
        const result = await dispatch();
        await origin.updateProcess(parentId, { archived: true });
        await complete(result.resultDelivery.remote.requestId, 'completed');
        await returns.recover(true);
        expect(jobs.list(workspaceId)[0].terminal?.delivery).toMatchObject({ state: 'failed', reason: expect.stringContaining('archived') });
        expect((await origin.getProcess(parentId))?.archived).toBe(true);
        expect((await origin.getProcess(parentId))?.pendingMessages ?? []).toEqual([]);
        expect(originInfra.queueFacade.getAll()).toEqual([]);
    });

    it('does not drain an accepted busy-parent assessment after the Sentinel is archived', async () => {
        const result = await dispatch();
        await complete(result.resultDelivery.remote.requestId, 'completed');
        await returns.recover(true);
        expect((await origin.getProcess(parentId))?.pendingMessages?.[0].context).toMatchObject({ sentinelRemoteResultReview: true });
        await origin.updateProcess(parentId, { archived: true, status: 'completed' });
        await originInfra.bridge.recoverPendingMessages(workspaceId, parentId);
        await returns.recover(true);
        expect(originInfra.queueFacade.getQueued()).toEqual([]);
        expect(jobs.list(workspaceId)[0].terminal?.delivery.state).toBe('failed');
        expect((await origin.getProcess(parentId))?.archived).toBe(true);
        expect(relay).not.toHaveBeenCalled();
    });

    it.each(['archived', 'deleted'] as const)('rejects a queued assessment at execution when its parent is %s', async state => {
        await origin.updateProcess(parentId, { status: 'completed' });
        const result = await dispatch();
        await complete(result.resultDelivery.remote.requestId, 'completed');
        await returns.recover(true);
        const task = originInfra.queueFacade.getQueued()[0];
        expect(task.payload.context).toMatchObject({ sentinelRemoteResultReview: true });
        if (state === 'archived') await origin.updateProcess(parentId, { archived: true });
        else await origin.removeProcess(parentId);
        const executor = new CLITaskExecutor(origin, { aiService: createMockSDKService().service });
        executor.setQueueManager(originInfra.registry.getQueueForRepo(repo));
        const outcome = await executor.execute(task);
        expect(outcome).toMatchObject({ success: false, error: expect.any(Error) });
        const parent = await origin.getProcess(parentId);
        if (state === 'archived') expect(parent?.archived).toBe(true);
        else expect(parent).toBeUndefined();
        expect(relay).not.toHaveBeenCalled();
    });

    it.each(['binding', 'links', 'capped'] as const)('rejects a %s result receipt without mistaking delivery failure for execution failure', async corruption => {
        const result = await dispatch();
        await complete(result.resultDelivery.remote.requestId, 'completed');
        tamper = corruption;
        await returns.recover(true);
        expect(jobs.list(workspaceId)[0].terminal).toBeUndefined();
        expect(jobs.list(workspaceId)[0].remote?.delivery?.state).toBe('failed');
        expect((await origin.getProcess(parentId))?.pendingMessages ?? []).toEqual([]);
        const repeated = await dispatch(input, result.resultDelivery.remote.requestId);
        expect(repeated.resultDelivery).toMatchObject({ status: 'tracked', reason: expect.stringContaining('Execution was admitted') });
        expect(executionPosts).toBe(1);
        tamper = undefined;
        await returns.recover(true);
        expect(jobs.list(workspaceId)[0].terminal?.result.outcome).toBe('completed');
    });

    it('does not rerun execution when reciprocal authentication fails before destination admission', async () => {
        const reciprocal = destinationRemotes;
        destinationRemotes = [];
        await expect(dispatch()).rejects.toMatchObject({ dispatchState: 'uncertain' });
        expect(admissions.list(workspaceId)).toEqual([]);
        destinationRemotes = reciprocal;
        await returns.recover(true);
        expect(executionPosts).toBe(1);
        expect(admissions.list(workspaceId)).toEqual([]);
        expect(requests.list(workspaceId)[0]).toMatchObject({
            admission: { state: 'uncertain' }, transfer: { error: expect.stringContaining('unavailable') },
        });
    });

    it('bounds an unresponsive receipt transport and later recovers without execution replay', async () => {
        const result = await dispatch();
        await complete(result.resultDelivery.remote.requestId, 'completed');
        returns.dispose();
        returns = makeReturns(30);
        stalled = true;
        await returns.recover(true);
        expect(jobs.list(workspaceId)[0].remote?.delivery?.state).toBe('failed');
        stalled = false;
        returns.dispose();
        returns = makeReturns();
        await returns.recover(true);
        expect(jobs.list(workspaceId)[0].terminal?.result.outcome).toBe('completed');
        expect(executionPosts).toBe(1);
    });

    it('admits no tracked work while default-off or when the peer lacks the compatible capability', async () => {
        const originContext = { parent: { workspaceId, processId: parentId }, title: 'Fixture work' };
        enabled = false;
        expect(await returns.dispatch('destination-alias', input, originContext)).toBeUndefined();
        enabled = true;
        const capabilityIndex = destinationRoutes.findIndex(route => route.pattern === '/api/remote-delegations/capabilities');
        expect(capabilityIndex).toBeGreaterThanOrEqual(0);
        destinationRoutes.splice(capabilityIndex, 1);
        expect(await returns.dispatch('destination-alias', input, originContext)).toMatchObject({
            unavailable: { status: 'unavailable', code: 'unsupported' },
        });
        expect(executionPosts).toBe(0);
        expect(requests.list(workspaceId)).toEqual([]);
        expect(admissions.list(workspaceId)).toEqual([]);
    });

    it('returns a capped Ralph session once, with no iteration result or review', async () => {
        const result = await dispatch({ version: 1, kind: 'ralph', workspaceId,
            body: { goalSpec: 'Fixture goal', entryPoint: 'execute', provider: 'copilot' } });
        const row = admissions.list(workspaceId)[0];
        const manager = destinationInfra.registry.getQueueForRepo(repo);
        manager.markStarted(row.executionId);
        manager.markCompleted(row.executionId, 'Intermediate iteration');
        await capture.restore(); await returns.recover(true);
        expect(admissions.get(row)?.terminal).toBeUndefined();
        expect((await origin.getProcess(parentId))?.pendingMessages ?? []).toEqual([]);
        expect(result.sessionId).toBeTruthy();
        await new RalphSessionStore({ dataDir: destinationDir }).recordCompletion(workspaceId, result.sessionId!, {
            reason: 'cap', totalIterations: 3, processId: result.processId, completedAt: new Date().toISOString(),
        });
        await capture.restore(); await returns.recover(true); await returns.recover(true);
        expect(jobs.list(workspaceId)[0]).toMatchObject({ child: { sessionId: result.sessionId },
            terminal: { result: { outcome: 'capped', summary: expect.stringContaining('goal completion is not confirmed') } } });
        expect((await origin.getProcess(parentId))?.pendingMessages).toHaveLength(1);
        expect(executionPosts).toBe(1);
        expect(relay).not.toHaveBeenCalled();
    });
});
