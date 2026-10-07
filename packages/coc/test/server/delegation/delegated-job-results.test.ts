import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskQueueManager, toQueueProcessId, type AIProcess } from '@plusplusoneplusplus/forge';
import { createMockProcessStore, createProcessFixture } from '../../helpers/mock-process-store';
import { DelegatedJobStore, MAX_RESULT_SUMMARY } from '../../../src/server/delegation/delegated-job-store';
import { DelegatedJobResults } from '../../../src/server/delegation/delegated-job-results';
import { createSentinelDelegationEnqueue } from '../../../src/server/delegation/sentinel-delegation-enqueue';
import { RalphSessionStore } from '../../../src/server/ralph/ralph-session-store';
import { orchestrateRalphIteration } from '../../../src/server/ralph/orchestrate-iteration';
import { _clearFinalCheckEnqueuedSet } from '../../../src/server/ralph/enqueue-final-check';
import { orchestrateFinalCheck } from '../../../src/server/ralph/orchestrate-final-check';
import type { RalphSessionRecord } from '../../../src/server/ralph/types';
import type { RalphSessionCompleteEvent } from '../../../src/server/queue/queue-executor-bridge';
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
                terminalEventId: `ordinary:${childWorkspace}:${childId}:terminal`, links: [`#repos/${childWorkspace}/chats/${childId}`] },
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
        expect(persisted().terminal?.result).toMatchObject({ outcome: 'completed', summary: 'Stored result', links: [`#repos/${childWorkspace}/chats/${childId}`, artifact] });
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

    it.each(['wrong-workspace', undefined])('rejects unscoped process ownership %s during recovery', async workspaceId => {
        register();
        const foreign = createProcessFixture({ id: childId, metadata: { workspaceId },
            result: 'Wrong result', error: 'Wrong error', resultFilePath: 'wrong-artifact' });
        // Match the native store, which accepts but ignores the scope argument.
        store.getProcess = vi.fn(async () => foreign);
        await service().restore();
        expect(persisted().terminal).toMatchObject({ delivery: { state: 'failed' },
            result: { summary: 'The delegated job is unavailable after restart.',
                links: [`#repos/${childWorkspace}/chats/${childId}`] } });
        expect(JSON.stringify(persisted())).not.toContain('Wrong');
        expect(JSON.stringify(persisted())).not.toContain('wrong-artifact');
    });

    it.each(['completed', 'failed'] as const)('keeps scoped queue %s without borrowing foreign process context', async outcome => {
        register(); service(); enqueue();
        store.getProcess = vi.fn(async () => createProcessFixture({ id: childId,
            metadata: { workspaceId: 'wrong-workspace' }, result: 'Wrong result',
            error: 'Wrong error', resultFilePath: 'wrong-artifact' }));
        if (outcome === 'completed') queue.markCompleted('child', { response: 'Queue result' });
        else queue.markFailed('child', new Error('Queue failure'));
        await flush();
        expect(persisted().terminal?.result).toMatchObject({ outcome,
            summary: outcome === 'completed' ? 'Queue result' : 'The delegated job failed; no result summary was stored.',
            links: [`#repos/${childWorkspace}/chats/${childId}`] });
        if (outcome === 'failed') expect(persisted().terminal?.result.reason).toBe('Queue failure');
        expect(JSON.stringify(persisted())).not.toContain('Wrong');
        expect(JSON.stringify(persisted())).not.toContain('wrong-artifact');
    });

    it('encodes the child workspace and process in the result link independently of the parent', async () => {
        const workspaceId = 'child/workspace #1';
        const processId = 'queue_child /?#';
        jobs.register({ id: processId, title: 'Scoped link',
            parent: { workspaceId: parentWorkspace, processId: parentId },
            child: { workspaceId, processId } });
        store.getProcess = vi.fn(async () => createProcessFixture({ id: processId,
            metadata: { workspaceId }, result: 'Done' }));
        await service().restore();
        expect(jobs.list(parentWorkspace)[0].terminal?.result.links).toEqual([
            `#repos/${encodeURIComponent(workspaceId)}/chats/${encodeURIComponent(processId)}`,
        ]);
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
    describe('whole-session Ralph results', () => {
        const sessionId = 'ralph-session';
        function session(overrides: Partial<RalphSessionRecord> = {}): RalphSessionRecord {
            return { sessionId, workspaceId: childWorkspace, originalGoal: 'Fix search', maxIterations: 20,
                currentIteration: 3, phase: 'complete', terminalReason: 'RALPH_COMPLETE',
                startedAt: new Date().toISOString(), iterations: [], ...overrides };
        }
        function ralph(record: RalphSessionRecord | null = session()) {
            register({ sessionId });
            const sessions = { readSessionRecord: vi.fn().mockResolvedValue(record),
                recordCompletion: vi.fn(async (_workspaceId, _sessionId, completion) => ({ ...record!, completion: record?.completion ?? completion })),
                getProgressPath: () => path.join(dataDir, 'progress.md') };
            const onResult = vi.fn().mockResolvedValue(undefined);
            const results = new DelegatedJobResults({ jobs, store, queue, sessions, onResult });
            services.push(results);
            return { results, sessions, onResult };
        }
        function queuedIteration(overrides: Record<string, unknown> = {}, workspaceId = childWorkspace, id = 'child') {
            queue.enqueue({ id, type: 'chat', priority: 'normal', repoId: workspaceId,
                payload: { kind: 'chat', mode: 'ralph', workspaceId,
                    context: { ralph: { sessionId, phase: 'executing', currentIteration: 4, ...overrides } } } });
        }

        function queuedCheck(repair = false, overrides: Record<string, unknown> = {}, id = 'checker', workspaceId = childWorkspace) {
            queue.enqueue({ id, type: 'chat', priority: 'normal', repoId: workspaceId,
                ...(repair ? { processId: 'queue_checker' } : {}),
                payload: { kind: 'chat', mode: 'ralph', workspaceId,
                    ...(repair ? { processId: 'queue_checker' } : {}),
                    context: { ralph: { sessionId, phase: 'executing', currentIteration: 3,
                        finalCheck: { kind: 'goal-gap-check', checkIndex: 2, loopIndex: 2,
                            sourceIteration: 3, ...(repair ? { repairTurn: true } : {}), ...overrides } } } } });
        }
        function waitingCheck(repair = false, overrides: Record<string, unknown> = {}) {
            return session({ finalChecks: [check({ status: repair ? 'running' : 'queued',
                taskId: 'checker', processId: 'queue_checker', repairAttempted: repair, ...overrides })] });
        }

        it.each([false, true])('settles a queued check cancellation (repair=%s) in a complete iteration phase', async repair => {
            const { sessions, onResult } = ralph(waitingCheck(repair));
            queuedCheck(repair, {}, repair ? 'repair' : 'checker');
            queue.cancelTask(repair ? 'repair' : 'checker'); await flush();
            expect(sessions.recordCompletion).toHaveBeenCalledWith(childWorkspace, sessionId,
                expect.objectContaining({ reason: 'user-stopped', processId: 'queue_checker', totalIterations: 3 }));
            expect(persisted().terminal?.result).toMatchObject({ outcome: 'cancelled', reason: 'user-stopped' });
            expect(onResult).toHaveBeenCalledOnce();
            expect(store.appendConversationTurn).not.toHaveBeenCalled();
        });

        it.each([false, true])('recovers a queued check cancellation before subscription (repair=%s)', async repair => {
            queuedCheck(repair, {}, repair ? 'repair' : 'checker');
            queue.cancelTask(repair ? 'repair' : 'checker');
            const { results, onResult } = ralph(waitingCheck(repair));
            await results.restore();
            expect(persisted().terminal?.result.outcome).toBe('cancelled');
            expect(onResult).toHaveBeenCalledOnce();
        });

        it.each([
            { checkIndex: 1 }, { loopIndex: 1 }, { sourceIteration: 2 },
        ])('ignores stale queued checker identity: %j', async overrides => {
            const { results, sessions } = ralph(waitingCheck());
            queuedCheck(false, overrides); queue.cancelTask('checker'); await flush(); await results.restore();
            expect(sessions.recordCompletion).not.toHaveBeenCalled();
            expect(persisted().terminal).toBeUndefined();
        });

        it.each([
            { status: 'completed' }, { status: 'failed' }, { taskId: 'other' }, { processId: 'queue_other' },
            { sourceIteration: 4 },
        ])('ignores cancellations outside the current admitted check: %j', async overrides => {
            const { results, sessions } = ralph(waitingCheck(false, overrides));
            queuedCheck(); queue.cancelTask('checker'); await flush();
            expect(sessions.recordCompletion).not.toHaveBeenCalled();
            expect(persisted().terminal).toBeUndefined();
            await results.restore();
            expect(sessions.recordCompletion).not.toHaveBeenCalled();
            expect(persisted().terminal?.result.outcome).not.toBe('cancelled');
        });

        it('requires the durable repair attempt', async () => {
            const { sessions } = ralph(waitingCheck(false));
            queuedCheck(true, {}, 'repair'); queue.cancelTask('repair'); await flush();
            expect(sessions.recordCompletion).not.toHaveBeenCalled();
        });

        it('lets a live checker repair win over the cancelled checker history', async () => {
            queuedCheck(); queue.cancelTask('checker'); queuedCheck(true, {}, 'repair');
            const { results, sessions } = ralph(waitingCheck(true));
            await results.restore();
            expect(sessions.recordCompletion).not.toHaveBeenCalled();
            expect(persisted().terminal).toBeUndefined();
        });

        it.each(['awaiting-input', 'grilling'] as const)('keeps %s silent for cancelled checks', async phase => {
            const { results, sessions } = ralph({ ...waitingCheck(), phase });
            queuedCheck(); queue.cancelTask('checker'); await flush(); await results.restore();
            expect(sessions.recordCompletion).not.toHaveBeenCalled();
        });

        it('ignores queued checker cancellation in another workspace', async () => {
            const { results, sessions } = ralph(waitingCheck());
            queuedCheck(false, {}, 'checker', parentWorkspace); queue.cancelTask('checker');
            await flush(); await results.restore();
            expect(sessions.recordCompletion).not.toHaveBeenCalled();
        });

        it('leaves a started checker cancellation to the executor boundary', async () => {
            const { sessions } = ralph(waitingCheck());
            queuedCheck(); queue.markStarted('checker'); queue.cancelTask('checker'); await flush();
            expect(sessions.recordCompletion).not.toHaveBeenCalled();
        });

        it('persists a queued continuation cancellation before returning it to the original parent', async () => {
            const { sessions, onResult } = ralph(session({ phase: 'executing', terminalReason: undefined }));
            queuedIteration({}, childWorkspace, 'continuation');
            queue.cancelTask('continuation'); await flush();
            expect(sessions.recordCompletion).toHaveBeenCalledWith(childWorkspace, sessionId,
                expect.objectContaining({ reason: 'user-stopped', processId: 'queue_continuation', totalIterations: 3 }));
            expect(persisted().terminal?.result).toMatchObject({ outcome: 'cancelled', reason: 'user-stopped' });
            expect(onResult).toHaveBeenCalledOnce();
            expect(queue.getQueued()).toEqual([]);
            expect(store.appendConversationTurn).not.toHaveBeenCalled();
        });

        it('settles cancellation before the first iteration ever starts', async () => {
            const { sessions, onResult } = ralph(session({ phase: 'executing', terminalReason: undefined, currentIteration: 0 }));
            queuedIteration({ currentIteration: 1 }); queue.cancelTask('child'); await flush();
            expect(sessions.recordCompletion).toHaveBeenCalledWith(childWorkspace, sessionId,
                expect.objectContaining({ reason: 'user-stopped', totalIterations: 0 }));
            expect(onResult).toHaveBeenCalledOnce();
        });

        it('leaves running cancellation to the executor boundary', async () => {
            const { sessions, onResult } = ralph(session({ phase: 'executing', terminalReason: undefined }));
            queuedIteration(); queue.markStarted('child'); queue.cancelTask('child'); await flush();
            expect(sessions.recordCompletion).not.toHaveBeenCalled(); expect(onResult).not.toHaveBeenCalled();
        });

        it('preserves the first durable outcome when queued cancellation is replayed', async () => {
            const completion = { reason: 'iteration-failed' as const, processId: 'queue_previous',
                totalIterations: 3, completedAt: new Date().toISOString() };
            const { onResult } = ralph(session({ phase: 'executing', terminalReason: undefined, completion }));
            queuedIteration(); queue.cancelTask('child'); await flush();
            expect(persisted().terminal?.result).toMatchObject({ outcome: 'failed', reason: 'iteration-failed' });
            expect(onResult).toHaveBeenCalledOnce();
        });

        it('recovers a queued cancellation after lost ledger recording and pruned queue history', async () => {
            const journal = new RalphSessionStore({ dataDir });
            await journal.initSession(childWorkspace, sessionId, { originalGoal: 'Fix search', maxIterations: 20 });
            await journal.updateSessionRecord(childWorkspace, sessionId, () => session({ phase: 'executing', terminalReason: undefined }));
            const { results, sessions, onResult } = ralph();
            sessions.readSessionRecord.mockImplementation(() => journal.readSessionRecord(childWorkspace, sessionId));
            sessions.recordCompletion.mockImplementation((...args) => journal.recordCompletion(...args));
            const saveResult = vi.spyOn(jobs, 'recordResult').mockImplementationOnce(() => { throw new Error('ledger write interrupted'); });
            vi.spyOn(console, 'error').mockImplementation(() => {});
            queuedIteration(); queue.cancelTask('child');
            await vi.waitFor(() => expect(saveResult).toHaveBeenCalledOnce());
            expect((await journal.readSessionRecord(childWorkspace, sessionId))?.completion?.reason).toBe('user-stopped');
            expect(persisted().terminal).toBeUndefined();
            expect(onResult).not.toHaveBeenCalled();
            saveResult.mockRestore();
            results.dispose();
            queue = new TaskQueueManager(); // no task/process survived; only session.json remains
            const restarted = new DelegatedJobResults({ jobs: new DelegatedJobStore(dataDir), store, queue,
                sessions: new RalphSessionStore({ dataDir }), onResult });
            services.push(restarted);
            await restarted.restore();
            expect(persisted().terminal?.result.outcome).toBe('cancelled');
            expect(onResult).toHaveBeenCalledOnce();
        });

        it.each([false, true])('recovers durable checker cancellation with pruned history (repair=%s)', async repair => {
            const journal = new RalphSessionStore({ dataDir });
            await journal.initSession(childWorkspace, sessionId, { originalGoal: 'Fix search', maxIterations: 20 });
            await journal.updateSessionRecord(childWorkspace, sessionId, () => waitingCheck(repair));
            const { results, sessions, onResult } = ralph();
            sessions.readSessionRecord.mockImplementation(() => journal.readSessionRecord(childWorkspace, sessionId));
            sessions.recordCompletion.mockImplementation((...args) => journal.recordCompletion(...args));
            const saveResult = vi.spyOn(jobs, 'recordResult').mockImplementationOnce(() => { throw new Error('interrupted ledger write'); });
            vi.spyOn(console, 'error').mockImplementation(() => {});
            queuedCheck(repair, {}, repair ? 'repair' : 'checker');
            queue.cancelTask(repair ? 'repair' : 'checker');
            await vi.waitFor(() => expect(saveResult).toHaveBeenCalledOnce());
            expect((await journal.readSessionRecord(childWorkspace, sessionId))?.completion).toMatchObject({
                reason: 'user-stopped', processId: 'queue_checker', totalIterations: 3 });
            expect(onResult).not.toHaveBeenCalled();
            saveResult.mockRestore(); results.dispose(); queue = new TaskQueueManager();
            const restarted = new DelegatedJobResults({ jobs: new DelegatedJobStore(dataDir), store, queue,
                sessions: new RalphSessionStore({ dataDir }), onResult });
            services.push(restarted); await restarted.restore();
            expect(persisted().terminal?.result.outcome).toBe('cancelled');
            expect(onResult).toHaveBeenCalledOnce();
        });

        it('recovers cancellation before the result listener was started', async () => {
            queuedIteration({}, childWorkspace, 'continuation'); queue.cancelTask('continuation');
            const { results, sessions, onResult } = ralph(session({ phase: 'executing', terminalReason: undefined }));
            await results.restore();
            expect(sessions.recordCompletion).toHaveBeenCalledOnce();
            expect(persisted().terminal?.result.outcome).toBe('cancelled');
            expect(onResult).toHaveBeenCalledOnce();
        });

        it.each([
            { currentIteration: 2 }, { currentIteration: 3 }, { currentIteration: 5 },
            { sessionId: 'other-session' }, { finalCheck: true }, { submit: true }, { phase: 'grilling' },
        ])('does not settle excluded queued steps: %j', async context => {
            const { sessions, results, onResult } = ralph(session({ phase: 'executing', terminalReason: undefined }));
            queuedIteration(context); queue.cancelTask('child'); await flush(); await results.restore();
            expect(sessions.recordCompletion).not.toHaveBeenCalled();
            expect(onResult).not.toHaveBeenCalled(); expect(persisted().terminal).toBeUndefined();
        });

        it.each(['awaiting-input', 'grilling', 'complete'] as const)('keeps %s sessions silent on queued cancellation', async phase => {
            const { sessions, onResult } = ralph(session({ phase }));
            queuedIteration(); queue.cancelTask('child'); await flush();
            expect(sessions.recordCompletion).not.toHaveBeenCalled(); expect(onResult).not.toHaveBeenCalled();
        });

        it('ignores cancellation in a different workspace', async () => {
            const { sessions, results } = ralph(session({ phase: 'executing', terminalReason: undefined }));
            queuedIteration({}, parentWorkspace); queue.cancelTask('child'); await flush(); await results.restore();
            expect(sessions.recordCompletion).not.toHaveBeenCalled(); expect(persisted().terminal).toBeUndefined();
        });

        it('lets an admitted resume win over stale queued cancellation history', async () => {
            queuedIteration(); queue.cancelTask('child'); queuedIteration({}, childWorkspace, 'resume');
            const { sessions, results } = ralph(session({ phase: 'executing', terminalReason: undefined }));
            await results.restore();
            expect(sessions.recordCompletion).not.toHaveBeenCalled(); expect(persisted().terminal).toBeUndefined();
        });

        it('withholds cancellation publication when session persistence fails', async () => {
            const { sessions, onResult, results } = ralph(session({ phase: 'executing', terminalReason: undefined }));
            sessions.recordCompletion.mockRejectedValue(new Error('disk unavailable'));
            vi.spyOn(console, 'error').mockImplementation(() => {});
            queuedIteration(); queue.cancelTask('child'); await flush();
            expect(onResult).not.toHaveBeenCalled(); expect(persisted().terminal).toBeUndefined();
            sessions.recordCompletion.mockImplementation(async (_ws, _id, completion) => session({ completion }));
            await results.restore();
            expect(persisted().terminal?.result.outcome).toBe('cancelled');
        });

        function complete(reason = 'signal', overrides: Partial<RalphSessionCompleteEvent> = {}) {
            queue.emit('ralphSessionComplete', { type: 'ralphSessionComplete', workspaceId: childWorkspace,
                sessionId, processId: 'queue_final-check', totalIterations: 3, reason, ...overrides });
        }
        function check(overrides: Record<string, unknown> = {}) {
            return { checkIndex: 2, loopIndex: 2, sourceIteration: 3, startedAt: new Date().toISOString(),
                status: 'completed' as const, hasGaps: false, ...overrides };
        }

        it.each([
            ['signal', 'completed'], ['manual-verification-only', 'completed'], ['cap', 'capped'],
            ['user-stopped', 'cancelled'], ['final-check-failed', 'failed'], ['final-check-enqueue-failed', 'failed'],
            ['final-check-session-missing', 'failed'], ['final-check-gap-loop-start-failed', 'failed'],
            ['final-check-gap-enqueue-failed', 'failed'],
        ])('records whole-session %s as %s, independently of final process identity', async (reason, outcome) => {
            const { onResult } = ralph(); complete(reason); await flush();
            expect(persisted().terminal?.result).toMatchObject({ outcome, reason,
                terminalEventId: `ralph:${childWorkspace}:${sessionId}:terminal`,
                links: [`/api/workspaces/${childWorkspace}/ralph-sessions/${sessionId}`, path.join(dataDir, 'progress.md')] });
            expect(onResult).toHaveBeenCalledWith(persisted());
            expect(jobs.list(childWorkspace)).toEqual([]);
            if (outcome === 'capped') expect(persisted().terminal?.result.summary).toContain('goal completion is not confirmed');
        });

        it('includes only finished output from the scoped final process, never the original iteration', async () => {
            ralph(); await child({ result: 'Old iteration' });
            await store.addProcess(createProcessFixture({ id: 'queue_final-check', metadata: { workspaceId: childWorkspace },
                result: JSON.stringify({ response: 'All checks passed. The fix is committed.' }) }));
            complete(); await flush();
            expect(persisted().terminal?.result.summary).toContain('All checks passed. The fix is committed.');
            expect(persisted().terminal?.result.summary).not.toContain('Old iteration');
        });

        it('maps missing-signal termination to failure, even when the lifecycle labels it cap', async () => {
            ralph(session({ terminalReason: 'NO_SIGNAL' })); complete('cap'); await flush();
            expect(persisted().terminal?.result.outcome).toBe('failed');
        });

        it('ignores iterations, checks and gap tasks and awaiting-input pauses', async () => {
            const { results, onResult } = ralph(session({ phase: 'awaiting-input' }));
            enqueue(childWorkspace, { ralph: { sessionId } }); queue.markCompleted('child', 'Intermediate');
            await flush(); await results.restore();
            expect(persisted().terminal).toBeUndefined(); expect(onResult).not.toHaveBeenCalled();
        });

        it.each([
            { workspaceId: 'wrong' }, { sessionId: 'other' }, { sessionId: undefined },
        ])('ignores whole-session events without the registered workspace/session: %j', async overrides => {
            const { onResult } = ralph(); complete('signal', overrides); await flush();
            expect(persisted().terminal).toBeUndefined(); expect(onResult).not.toHaveBeenCalled();
        });

        it('retains first terminal identity and outcome across duplicate/conflicting events and restart', async () => {
            const { results } = ralph(); complete('cap'); complete('signal'); await flush();
            const first = persisted(); await results.restore(); complete('final-check-failed'); await flush();
            expect(persisted()).toEqual(first); expect(first.terminal?.result.outcome).toBe('capped');
        });

        it.each([
            { terminalReason: 'USER_STOPPED', outcome: 'cancelled' },
            { terminalReason: 'CAP_REACHED', outcome: 'capped' },
            { terminalReason: 'NO_SIGNAL', outcome: 'failed' },
            { terminalReason: 'CANCELLED', outcome: 'cancelled' },
        ] as const)('recovers terminal journal $terminalReason', async ({ terminalReason, outcome }) => {
            await ralph(session({ terminalReason })).results.restore();
            expect(persisted().terminal?.result.outcome).toBe(outcome);
        });

        it.each([
            { status: 'completed', hasGaps: false, outcome: 'completed' },
            { status: 'completed', hasGaps: true, capReached: true, outcome: 'capped' },
            { status: 'failed', outcome: 'failed' },
        ] as const)('recovers final check outcome $outcome without a live terminal event', async ({ outcome, ...record }) => {
            const { results, onResult } = ralph(session({ finalChecks: [check(record)] }));
            await results.restore(); expect(persisted().terminal?.result.outcome).toBe(outcome);
            expect(onResult).toHaveBeenCalledOnce();
        });

        it.each([
            {}, { finalChecks: [check({ status: 'queued' })] }, { finalChecks: [check({ status: 'running', repairAttempted: true })] },
            { finalChecks: [check({ gapLoopStarted: true })] }, { finalChecks: [check({ hasGaps: true })] },
            { finalChecks: [check({ sourceIteration: 2 })] }, { phase: 'executing' },
        ] as Partial<RalphSessionRecord>[])('does not recover a complete iteration as whole-session completion: %j', async record => {
            const { results, onResult } = ralph(session(record)); await results.restore();
            expect(persisted().terminal).toBeUndefined(); expect(onResult).not.toHaveBeenCalled();
        });

        it('uses the last iteration output for a cap after earlier checks and gap loops', async () => {
            const { results } = ralph(session({ terminalReason: 'CAP_REACHED',
                finalChecks: [check({ sourceIteration: 2, gapLoopStarted: true, processId: 'queue_old-check' })],
                iterations: [{ iteration: 3, loopIndex: 2, taskId: 'child', processId: childId,
                    status: 'completed', startedAt: new Date().toISOString() }] }));
            await child({ result: 'Latest gap loop result' });
            await store.addProcess(createProcessFixture({ id: 'queue_old-check', metadata: { workspaceId: childWorkspace }, result: 'Old check' }));
            await results.restore();
            expect(persisted().terminal?.result.summary).toContain('Latest gap loop result');
            expect(persisted().terminal?.result.summary).not.toContain('Old check');
        });

        it('recovers failed gap-loop admission even when its phase is executing', async () => {
            await ralph(session({ phase: 'executing', finalChecks: [check({ status: 'failed' })] })).results.restore();
            expect(persisted().terminal?.result.outcome).toBe('failed');
        });

        it.each([null, session({ workspaceId: 'wrong' }), session({ sessionId: 'wrong' })])('settles unavailable/mis-scoped journal without redirecting results', async record => {
            const { results, onResult } = ralph(record); await results.restore();
            expect(persisted().terminal?.delivery.state).toBe('failed'); expect(onResult).not.toHaveBeenCalled();
        });

        it('recovers after a transient ledger write failure using the final-check journal', async () => {
            const { results } = ralph(session({ finalChecks: [check()] }));
            vi.spyOn(console, 'error').mockImplementation(() => {});
            vi.spyOn(jobs, 'recordResult').mockImplementationOnce(() => { throw new Error('disk failure'); });
            complete(); await flush(); expect(persisted().terminal).toBeUndefined();
            await results.restore(); expect(persisted().terminal?.result.outcome).toBe('completed');
        });

        it.each([
            ['clean', 'completed', 'signal'], ['cap', 'capped', 'cap'],
            ['failed', 'failed', 'final-check-failed'],
            ['gap admission', 'failed', 'final-check-gap-enqueue-failed'],
        ])('recovers durable %s after metadata failure and a crash before publication', async (scenario, outcome, reason) => {
            const journal = new RalphSessionStore({ dataDir });
            await journal.initSession(childWorkspace, sessionId, { originalGoal: 'Fix search', maxIterations: 20 });
            await journal.updateSessionRecord(childWorkspace, sessionId, () => session({
                finalChecks: [check({ status: 'running', processId: 'queue_final-check', repairAttempted: true })],
            }));
            vi.spyOn(journal, 'upsertFinalCheckRecord').mockRejectedValue(new Error('check metadata write failed'));
            await store.addProcess(createProcessFixture({ id: 'queue_final-check', metadata: { workspaceId: childWorkspace },
                result: 'Final scoped output' }));
            const response = scenario === 'failed' ? 'missing result'
                : `RALPH_FINAL_CHECK_RESULT\n\`\`\`json\n${JSON.stringify({
                    marker: 'RALPH_FINAL_CHECK_RESULT', hasGaps: scenario !== 'clean', summary: 'Checked',
                    gaps: scenario === 'clean' ? [] : [{ id: 'gap', title: 'Missing check', evidence: 'test', recommendedAction: 'test' }],
                    gapFixGoal: 'Run missing check',
                })}\n\`\`\``;
            const publish = vi.fn(() => { throw new Error('crash before result subscriber'); });
            await expect(orchestrateFinalCheck({
                workspaceId: childWorkspace, sessionId, checkIndex: 2, loopIndex: 2, sourceIteration: 3,
                taskId: 'check-task', processId: 'queue_final-check', responseText: response,
                deps: { store: journal, maxGapFixLoops: scenario === 'cap' ? 0 : 3,
                    enqueueTask: () => { throw new Error('admission rejected'); }, broadcastSessionComplete: publish },
            })).rejects.toThrow('crash before result subscriber');
            const restarted = new RalphSessionStore({ dataDir });
            const record = (await restarted.readSessionRecord(childWorkspace, sessionId))!;
            expect(record.completion).toMatchObject({ reason, processId: 'queue_final-check', totalIterations: 3 });
            // The check stayed running: only the independent completion record can recover this outcome.
            expect(record.finalChecks?.at(-1)?.status).toBe('running');
            const { results, sessions, onResult } = ralph();
            sessions.readSessionRecord.mockImplementation(() => restarted.readSessionRecord(childWorkspace, sessionId));
            await results.restore();
            expect(persisted().terminal?.result).toMatchObject({ outcome, reason });
            expect(persisted().terminal?.result.summary).toContain('Final scoped output');
            expect(onResult).toHaveBeenCalledOnce();
            const first = persisted();
            complete('signal'); await flush();
            expect(persisted()).toEqual(first);
        });

        it.each([
            ['RALPH_NEXT', 2, 'failed', 'iteration-enqueue-failed'],
            ['RALPH_COMPLETE', 2, 'failed', 'final-check-enqueue-failed'],
            ['RALPH_NEXT', 20, 'capped', 'cap'],
            ['no signal', 2, 'failed', 'no-signal'],
        ])('recovers an iteration outcome after publication interruption: %s/%s', async (response, iteration, outcome, reason) => {
            const journal = new RalphSessionStore({ dataDir });
            await journal.initSession(childWorkspace, sessionId, { originalGoal: 'Fix search', maxIterations: 20 });
            // Independent terminal durability must survive failure of the journal write.
            vi.spyOn(RalphSessionStore.prototype, 'appendProgressSection').mockRejectedValue(new Error('journal failed'));
            await child({ result: 'Final iteration output' });
            _clearFinalCheckEnqueuedSet();
            try {
                await expect(orchestrateRalphIteration({
                    workspaceId: childWorkspace, sessionId, responseText: response, currentIteration: iteration,
                    maxIterations: 20, originalGoal: 'Fix search', completedTaskId: 'child', processId: childId,
                    deps: { dataDir, enqueueTask: () => { throw new Error('queue full'); },
                        broadcastSessionComplete: () => { throw new Error('publication interrupted'); } },
                })).rejects.toThrow('publication interrupted');
                const restarted = new RalphSessionStore({ dataDir });
                const { results, sessions, onResult } = ralph();
                sessions.readSessionRecord.mockImplementation(() => restarted.readSessionRecord(childWorkspace, sessionId));
                await results.restore();
                expect(persisted().terminal?.result).toMatchObject({ outcome, reason });
                expect(persisted().terminal?.result.summary).toContain('Final iteration output');
                expect(onResult).toHaveBeenCalledOnce();
                const first = persisted();
                complete('signal'); await flush();
                expect(persisted()).toEqual(first);
            } finally {
                _clearFinalCheckEnqueuedSet();
            }
        });

        it('disposes session listeners and pending journal reads', async () => {
            const { results } = ralph(); complete(); results.dispose(); await flush();
            expect(queue.listenerCount('ralphSessionComplete')).toBe(0); expect(persisted().terminal).toBeUndefined();
        });
    });

});
