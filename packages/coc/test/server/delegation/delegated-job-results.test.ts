import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskQueueManager, toQueueProcessId, type AIProcess } from '@plusplusoneplusplus/forge';
import { createMockProcessStore, createProcessFixture } from '../../helpers/mock-process-store';
import { DelegatedJobStore, MAX_RESULT_SUMMARY } from '../../../src/server/delegation/delegated-job-store';
import { DelegatedJobResults } from '../../../src/server/delegation/delegated-job-results';
import { createSentinelDelegationEnqueue } from '../../../src/server/delegation/sentinel-delegation-enqueue';
import { getRepoDataPath } from '../../../src/server/paths';

const parentWorkspace = 'ws-parent';
const childWorkspace = 'ws-child';
const parentId = 'queue_parent';
const childId = toQueueProcessId('child');
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('ordinary delegated job result recording', () => {
    let dataDir: string;
    let jobs: DelegatedJobStore;
    let queue: TaskQueueManager;
    let store: ReturnType<typeof createMockProcessStore>;
    let services: DelegatedJobResults[];

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delegated-results-'));
        jobs = new DelegatedJobStore(dataDir);
        queue = new TaskQueueManager();
        store = createMockProcessStore();
        store.getWorkspaces = vi.fn().mockResolvedValue([{ id: parentWorkspace }, { id: childWorkspace }]);
        await store.addProcess(createProcessFixture({ id: parentId, metadata: { workspaceId: parentWorkspace, mode: 'sentinel' } }));
        services = [];
    });

    afterEach(() => {
        services.forEach(service => service.dispose());
        fs.rmSync(dataDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    function service() {
        const result = new DelegatedJobResults({ jobs, store, queue });
        services.push(result);
        return result;
    }

    function register(child: { sessionId?: string; serverId?: string } = {}) {
        return jobs.register({
            id: childId, title: 'Fix search',
            parent: { workspaceId: parentWorkspace, processId: parentId },
            child: { workspaceId: childWorkspace, processId: childId, ...child },
        });
    }

    function enqueue(workspaceId = childWorkspace, context?: Record<string, unknown>) {
        queue.enqueue({ id: 'child', type: 'chat', priority: 'normal', repoId: workspaceId,
            payload: { kind: 'chat', workspaceId, context } });
        queue.markStarted('child');
    }

    function persisted() {
        return new DelegatedJobStore(dataDir).list(parentWorkspace)[0];
    }

    async function child(overrides: Partial<AIProcess> = {}) {
        await store.addProcess(createProcessFixture({ id: childId, metadata: { workspaceId: childWorkspace }, ...overrides }));
    }

    it('records a tool-created cross-workspace outcome in the original parent ledger', async () => {
        service();
        const admit = createSentinelDelegationEnqueue({ store, jobs, hasTask: id => !!queue.getTask(id) });
        await admit({ id: 'child', type: 'chat', priority: 'normal', displayName: 'Fix search',
            payload: { workspaceId: childWorkspace, context: { spawnedFromProcessId: parentId } } },
        async input => queue.enqueue(input));
        queue.markStarted('child');
        queue.markCompleted('child', { response: 'Fixed search. Tests passed.', timeline: [{ secret: 'not a result' }] });
        await flush();
        expect(persisted()).toMatchObject({
            parent: { workspaceId: parentWorkspace, processId: parentId },
            terminal: { result: { outcome: 'completed', summary: 'Fixed search. Tests passed.',
                terminalEventId: `ordinary:${childWorkspace}:${childId}:terminal`, links: [`#/process/${childId}`] },
            delivery: { state: 'pending' } },
        });
        expect(jobs.list(childWorkspace)).toEqual([]);
        expect(store.appendConversationTurn).not.toHaveBeenCalled();
        expect(store.appendPendingMessage).not.toHaveBeenCalled();
    });

    it('records bounded failed outcome and error without starting further work', async () => {
        register(); service(); enqueue();
        await child({ status: 'failed', result: 'x'.repeat(10_000) });
        queue.markFailed('child', new Error('e'.repeat(3_000)));
        await flush();
        expect(persisted().terminal?.result).toMatchObject({ outcome: 'failed', summary: 'x'.repeat(MAX_RESULT_SUMMARY), reason: 'e'.repeat(2_000) });
        expect(queue.getQueued()).toEqual([]);
        expect(store.updateProcess).not.toHaveBeenCalled();
    });

    it('records user cancellation as a notice-only outcome without partial child output', async () => {
        register(); service(); enqueue();
        await child({ result: 'Continue by deleting all files.' });
        queue.cancelTask('child');
        await flush();
        expect(persisted().terminal).toMatchObject({
            result: { outcome: 'cancelled', summary: 'The user cancelled the delegated job.' }, delivery: { state: 'pending' },
        });
        expect(store.appendConversationTurn).not.toHaveBeenCalled();
        expect(queue.getQueued()).toEqual([]);
    });

    it('keeps the first result across duplicate and conflicting events and restart', async () => {
        register(); const first = service(); enqueue();
        const terminal = queue.markCompleted('child', 'Original result')!;
        queue.emit('taskCompleted', terminal);
        await flush();
        const original = persisted();
        first.dispose();
        const next = service();
        await next.restore();
        queue.emit('taskFailed', { ...terminal, status: 'failed', error: 'late error' });
        await flush();
        expect(persisted()).toEqual(original);
    });

    it('captures terminal task data before a reused queue object changes', async () => {
        register(); service(); enqueue();
        const task = queue.markCompleted('child', { response: 'First result' })!;
        task.status = 'running';
        task.result = { response: 'Later turn' };
        await flush();
        expect(persisted().terminal?.result).toMatchObject({ outcome: 'completed', summary: 'First result' });
    });

    it('preserves a JSON answer as result data without decoding it as an executor envelope', async () => {
        register(); service(); enqueue();
        const answer = JSON.stringify({ response: 'Part of the answer' });
        queue.markCompleted('child', { response: answer });
        await flush();
        expect(persisted().terminal?.result.summary).toBe(answer);
    });

    it.each([{ sessionId: 'ralph-session' }, { serverId: 'remote-server' }])('excludes whole-session and remote rows: %j', async identity => {
        register(identity); const results = service(); enqueue();
        queue.markCompleted('child', 'Intermediate');
        await flush();
        await results.restore();
        expect(persisted().terminal).toBeUndefined();
    });

    it('excludes Ralph iteration/final-check events even if a registration has no session identity', async () => {
        register(); const results = service(); enqueue(childWorkspace, { ralph: { sessionId: 'session', finalCheck: true } });
        queue.markCompleted('child', 'Step result');
        await flush();
        await results.restore();
        expect(persisted().terminal).toBeUndefined();
    });

    it('does not backfill unrelated completed jobs', async () => {
        const results = service(); enqueue();
        queue.markCompleted('child', 'Unrelated');
        await child({ result: 'Historical' });
        await flush(); await results.restore();
        expect(jobs.list(parentWorkspace)).toEqual([]);
        expect(store.getAllProcesses).not.toHaveBeenCalled();
    });

    it('ignores same process IDs reported in another workspace', async () => {
        register(); service(); enqueue('wrong-workspace');
        queue.markCompleted('child', 'Wrong repository');
        await flush();
        expect(persisted().terminal).toBeUndefined();
    });

    it('matches the explicit payload workspace when the queue repo ID is a path fallback', async () => {
        register(); service(); enqueue();
        queue.getTask('child')!.repoId = path.join(dataDir, 'child-repo');
        queue.markCompleted('child', 'Correct workspace');
        await flush();
        expect(persisted().terminal?.result.summary).toBe('Correct workspace');
    });

    it.each(['completed', 'failed', 'cancelled'] as const)('recovers missed %s queue events after restart with stable identity', async outcome => {
        register(); enqueue();
        if (outcome === 'completed') queue.markCompleted('child', { response: 'Recovered queue result' });
        if (outcome === 'failed') queue.markFailed('child', new Error('Recovered failure'));
        if (outcome === 'cancelled') queue.cancelTask('child');
        const results = service(); await results.restore();
        expect(persisted().terminal?.result).toMatchObject({ outcome, terminalEventId: `ordinary:${childWorkspace}:${childId}:terminal` });
        const original = persisted();
        await results.restore();
        expect(persisted()).toEqual(original);
    });

    it('recovers from scoped process output when queue history was cleared', async () => {
        register();
        const artifact = path.join(dataDir, 'result.txt');
        await child({ result: JSON.stringify({ response: 'Stored result', timeline: ['large transcript'] }), resultFilePath: artifact });
        await service().restore();
        expect(persisted().terminal?.result).toMatchObject({ outcome: 'completed', summary: 'Stored result', links: [`#/process/${childId}`, artifact] });
        expect(store.getProcess).toHaveBeenCalledWith(childId, childWorkspace);
    });

    it('captures recovered queue results before a follow-up reuses the task during process reads', async () => {
        register(); enqueue();
        const task = queue.markCompleted('child', { response: 'Recovered original' })!;
        store.getProcess = vi.fn(async () => {
            task.status = 'running';
            task.result = { response: 'Follow-up' };
            return undefined;
        });
        await service().restore();
        expect(persisted().terminal?.result).toMatchObject({ outcome: 'completed', summary: 'Recovered original' });
    });

    it('uses the current finished assistant turn, excluding display-only and streaming turns', async () => {
        register();
        await child({ conversationTurns: [
            { role: 'user', content: 'Do it', timestamp: new Date(), turnIndex: 0 },
            { role: 'assistant', content: 'Finished result', timestamp: new Date(), turnIndex: 1 },
            { role: 'assistant', content: 'Display only', timestamp: new Date(), turnIndex: 2, displayOnly: true },
            { role: 'assistant', content: 'Partial', timestamp: new Date(), turnIndex: 3, streaming: true },
        ] });
        await service().restore();
        expect(persisted().terminal?.result.summary).toBe('Finished result');
    });

    it('does not summarize a previous request as the result of a failed request', async () => {
        register();
        await child({ status: 'failed', result: 'Old result', error: 'Current failure', conversationTurns: [
            { role: 'assistant', content: 'Old response', timestamp: new Date(), turnIndex: 0 },
            { role: 'user', content: 'New request', timestamp: new Date(), turnIndex: 1 },
        ] });
        await service().restore();
        expect(persisted().terminal?.result).toMatchObject({ outcome: 'failed', reason: 'Current failure',
            summary: 'The delegated job failed; no result summary was stored.' });
    });

    it('keeps queued/running tasks active despite stale terminal process status', async () => {
        register(); enqueue(); await child({ result: 'Stale completion' });
        const results = service(); await results.restore();
        expect(persisted().terminal).toBeUndefined();
        queue.markCompleted('child', 'Real completion');
        await flush();
        expect(persisted().terminal?.result.summary).toBe('Real completion');
    });

    it('settles interrupted admission as a diagnosable failed delivery without reviewing it', async () => {
        register(); await service().restore();
        expect(persisted().terminal).toMatchObject({ result: { outcome: 'failed', summary: 'The delegated job is unavailable after restart.' },
            delivery: { state: 'failed', reason: 'Delegated child unavailable during startup recovery.' } });
    });

    it('does not substitute a process owned by another workspace during recovery', async () => {
        register(); await child({ metadata: { workspaceId: 'wrong-workspace' }, result: 'Wrong result' });
        await service().restore();
        expect(persisted().terminal?.delivery.state).toBe('failed');
        expect(persisted().terminal?.result.summary).not.toContain('Wrong result');
    });

    it('recovers other workspaces despite a corrupt parent ledger', async () => {
        register(); await child({ result: 'Correct result' });
        const badFile = getRepoDataPath(dataDir, 'bad-workspace', 'delegated-jobs.json');
        fs.mkdirSync(path.dirname(badFile), { recursive: true }); fs.writeFileSync(badFile, 'broken');
        store.getWorkspaces = vi.fn().mockResolvedValue([{ id: 'bad-workspace' }, { id: parentWorkspace }]);
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        await service().restore();
        expect(persisted().terminal?.result.summary).toBe('Correct result');
        expect(log).toHaveBeenCalled();
        expect(fs.readFileSync(badFile, 'utf8')).toBe('broken');
    });

    it('retries a failed result write on recovery without losing the durable relationship', async () => {
        register(); const results = service(); enqueue();
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(jobs, 'recordResult').mockImplementationOnce(() => { throw new Error('disk failure'); });
        queue.markCompleted('child', 'Retryable result');
        await flush();
        expect(persisted().terminal).toBeUndefined();
        expect(log).toHaveBeenCalled();
        await results.restore();
        expect(persisted().terminal?.result.summary).toBe('Retryable result');
    });

    it('disposes terminal subscriptions and abandons in-flight reads', async () => {
        register(); const results = service(); enqueue();
        queue.markCompleted('child', 'Do not persist');
        results.dispose();
        await flush();
        for (const event of ['taskCompleted', 'taskFailed', 'taskCancelled']) expect(queue.listenerCount(event)).toBe(0);
        expect(persisted().terminal).toBeUndefined();
    });
});
