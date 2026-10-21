import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskQueueManager, toQueueProcessId, type ConversationTurn } from '@plusplusoneplusplus/forge';
import { createMockProcessStore, createProcessFixture } from '../../helpers/mock-process-store';
import { RemoteDelegationAdmissionStore, type RemoteDelegationAdmission } from '../../../src/server/delegation/remote-delegation-admission-store';
import { RemoteDelegationResults } from '../../../src/server/delegation/remote-delegation-results';
import type { RemoteDelegationProof } from '../../../src/server/delegation/remote-delegation-auth';
import { RalphSessionStore } from '../../../src/server/ralph/ralph-session-store';
import { DelegatedJobStore } from '../../../src/server/delegation/delegated-job-store';
import { buildDashboardArtifactReference } from '../../../src/server/shared/chat-reference';
import { RalphGrillingStore } from '../../../src/server/ralph/grilling-state';

const workspaceId = 'destination-repo';
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('durable destination remote results', () => {
    let dataDir: string;
    let admissions: RemoteDelegationAdmissionStore;
    let store: ReturnType<typeof createMockProcessStore>;
    let queue: TaskQueueManager;
    let sessions: RalphSessionStore;
    let services: RemoteDelegationResults[];
    beforeEach(() => {
        const scratch = path.resolve('.test-scratch');
        fs.mkdirSync(scratch, { recursive: true });
        dataDir = fs.mkdtempSync(path.join(scratch, 'remote-results-'));
        admissions = new RemoteDelegationAdmissionStore(dataDir);
        store = createMockProcessStore();
        store.getWorkspaces = vi.fn().mockResolvedValue([{ id: workspaceId }, { id: 'another-repo' }]);
        queue = new TaskQueueManager();
        sessions = new RalphSessionStore({ dataDir });
        services = [];
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        services.forEach(service => service.dispose());
        fs.rmSync(dataDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });
    function claim(kind: RemoteDelegationProof['kind'] = 'launch', overrides: Partial<RemoteDelegationProof> = {}) {
        return admissions.claim({ version: 1, requestId: randomUUID(), originServerIdentity: 'origin-owner',
            parent: { workspaceId: 'origin-repo', processId: 'exact-sentinel' },
            destination: { serverIdentity: admissions.serverIdentity, workspaceId },
            kind, intentDigest: 'a'.repeat(64), admission: 'dispatching',
            ...(kind === 'follow-up' ? { targetProcessId: 'queue_shared' } : {}), ...overrides }).receipt;
    }
    function child(row: RemoteDelegationAdmission) {
        return { processId: row.targetProcessId ?? toQueueProcessId(row.executionId),
            ...(row.kind === 'ralph' ? { sessionId: `ralph-approved-${row.executionId}` } : {}) };
    }
    const accept = (row: RemoteDelegationAdmission) => admissions.accept(row, child(row));
    const saved = (row: RemoteDelegationAdmission) => new RemoteDelegationAdmissionStore(dataDir).get(row)!;
    function service(findChild = vi.fn(async (_row: RemoteDelegationAdmission) => undefined as ReturnType<typeof child> | undefined)) {
        const result = new RemoteDelegationResults({ admissions, store, queue, sessions, dataDir, findChild });
        services.push(result);
        return result;
    }
    function enqueue(row: RemoteDelegationAdmission, owner = workspaceId) {
        queue.enqueue({ id: row.executionId, type: 'chat', priority: 'normal', repoId: owner,
            ...(row.kind === 'follow-up' ? { processId: row.targetProcessId } : {}),
            payload: { kind: 'chat', workspaceId: owner, mode: row.kind === 'ralph' ? 'ralph' : 'ask',
                ...(row.kind === 'ralph'
                    ? { context: { ralph: { sessionId: child(row).sessionId, phase: 'executing', currentIteration: 1 } } }
                    : { relayRequestId: row.executionId }),
                ...(row.kind === 'follow-up' ? { processId: row.targetProcessId } : {}),
            } });
    }
    const turn = (role: 'user' | 'assistant', content: string, relayRequestId?: string): ConversationTurn =>
        ({ role, content, timestamp: new Date(), ...(relayRequestId ? { relayRequestId } : {}) });

    it.each(['completed', 'failed', 'cancelled'] as const)('captures %s without writing origin jobs or queueing parent work', async status => {
        const row = accept(claim()); const result = service(); enqueue(row);
        queue.markStarted(row.executionId);
        if (status === 'completed') queue.markCompleted(row.executionId, { response: 'Exact initial answer' });
        if (status === 'failed') queue.markFailed(row.executionId, new Error('Execution failed'));
        if (status === 'cancelled') queue.cancelTask(row.executionId);
        await flush(); await result.restore();
        expect(saved(row).terminal?.result).toMatchObject({ outcome: status,
            links: [`#chat-references/${admissions.serverIdentity}/${workspaceId}/${child(row).processId}`] });
        if (status === 'completed') expect(saved(row).terminal?.result.summary).toBe('Exact initial answer');
        if (status === 'cancelled') expect(saved(row).terminal?.result.summary).toContain('cancelled');
        expect(new DelegatedJobStore(dataDir).list(workspaceId)).toEqual([]);
        expect(new DelegatedJobStore(dataDir).list('origin-repo')).toEqual([]);
        expect(queue.getQueued()).toEqual([]);
        expect(store.appendConversationTurn).not.toHaveBeenCalled();
        expect(store.appendPendingMessage).not.toHaveBeenCalled();
    });

    it('recovers terminal-before-acceptance from durable admission evidence without execution', async () => {
        const row = claim(); enqueue(row); queue.markStarted(row.executionId); queue.markCompleted(row.executionId, 'Fast answer');
        admissions.settle(row, 'uncertain');
        const find = vi.fn(async () => child(row));
        await service(find).restore();
        expect(saved(row)).toMatchObject({ admission: { state: 'accepted' }, terminal: { result: { summary: 'Fast answer' } } });
        const { executionId: _executionId, createdAt: _createdAt, terminal: _terminal, admission: _admission, ...binding } = row;
        expect(admissions.claim({ ...binding, admission: 'dispatching' }).execute).toBe(false);
        expect(queue.getAll()).toHaveLength(1);
    });

    it('qualifies a stored result file only in the remote projection', async () => {
        const row = accept(claim());
        const resultFilePath = path.join(dataDir, 'outputs', 'result ?#.md');
        await store.addProcess(createProcessFixture({ id: child(row).processId, status: 'completed',
            metadata: { workspaceId }, result: 'Saved answer', resultFilePath,
            conversationTurns: [turn('user', 'initial', row.executionId), turn('assistant', 'Saved answer')] }));
        await service().restore();
        expect(saved(row).terminal?.result.links).toEqual([
            `#chat-references/${admissions.serverIdentity}/${workspaceId}/${child(row).processId}`,
            buildDashboardArtifactReference(admissions.serverIdentity, workspaceId, child(row).processId, resultFilePath),
        ]);
    });

    it('retains the actual execution workspace and final process when qualifying Ralph progress', async () => {
        const row = accept(claim('ralph'));
        const initialSession = child(row).sessionId!;
        const execution = { workspaceId: 'another-repo', sessionId: 'actual-session', processId: 'final-check', remote: false };
        await new RalphGrillingStore(dataDir).write({ workspaceId, sessionId: initialSession,
            processId: child(row).processId, start: { taskId: 'execution-task', goalSpec: 'goal.md', status: 'admitted', execution } });
        await sessions.initSession(execution.workspaceId, execution.sessionId, { originalGoal: 'Goal', maxIterations: 3 });
        await sessions.recordCompletion(execution.workspaceId, execution.sessionId, { reason: 'cap',
            processId: execution.processId, totalIterations: 3, completedAt: new Date().toISOString() });
        await service().restore();
        expect(saved(row).terminal?.result.links).toEqual([
            `#chat-references/${admissions.serverIdentity}/${execution.workspaceId}/${execution.processId}`,
            buildDashboardArtifactReference(admissions.serverIdentity, execution.workspaceId, execution.processId,
                sessions.getProgressPath(execution.workspaceId, execution.sessionId)),
        ]);
    });

    it('captures an uncertain claim when its later terminal event supplies admission evidence', async () => {
        const row = claim(); enqueue(row);
        const find = vi.fn(async () => queue.getTask(row.executionId)?.status === 'completed' ? child(row) : undefined);
        service(find);
        queue.markStarted(row.executionId);
        queue.markCompleted(row.executionId, 'Later terminal');
        await flush();
        expect(saved(row).terminal?.result.summary).toBe('Later terminal');
    });

    it('keeps consumed uncertain claims pending without domain evidence or from a prepared Ralph journal', async () => {
        const row = claim('ralph');
        await sessions.initSession(workspaceId, child(row).sessionId!, { originalGoal: 'Goal', maxIterations: 3 });
        await service().restore();
        expect(saved(row).admission.state).toBe('dispatching');
        expect(saved(row).terminal).toBeUndefined();
        expect(queue.getAll()).toEqual([]);
    });

    it('recovers two exact requested turns after restart without borrowing a later answer', async () => {
        const first = accept(claim('follow-up')); const second = accept(claim('follow-up'));
        await store.addProcess(createProcessFixture({ id: first.targetProcessId!, status: 'completed',
            metadata: { workspaceId }, result: 'Unrelated latest result', conversationTurns: [
                turn('user', 'first', first.executionId), turn('assistant', 'First answer'),
                turn('user', 'second', second.executionId),
                { ...turn('assistant', 'Error: Second failed'), interrupted: true, interruptionReason: 'Second failure' },
                turn('user', 'unrelated'), turn('assistant', 'Wrong latest answer'),
            ] }));
        await service().restore();
        expect(saved(first).terminal?.result).toMatchObject({ outcome: 'completed', summary: 'First answer' });
        expect(saved(second).terminal?.result).toMatchObject({ outcome: 'failed', reason: 'Second failure' });
        expect(saved(first).terminal?.result.terminalEventId).not.toBe(saved(second).terminal?.result.terminalEventId);
        expect(saved(second).terminal?.result.summary).not.toContain('Wrong latest');
    });

    it('separates completed and cancelled live follow-ups into the same target chat', async () => {
        const first = accept(claim('follow-up')); const second = accept(claim('follow-up'));
        const result = service(); enqueue(first); enqueue(second);
        queue.markStarted(first.executionId); queue.markCompleted(first.executionId, 'First requested answer');
        queue.cancelTask(second.executionId);
        await flush(); await result.restore();
        expect(saved(first).terminal?.result).toMatchObject({ outcome: 'completed', summary: 'First requested answer' });
        expect(saved(second).terminal?.result).toMatchObject({ outcome: 'cancelled' });
        expect(saved(second).terminal?.result.summary).not.toContain('First requested answer');
        expect(saved(first).admission).toEqual(saved(second).admission);
        expect(saved(first).requestId).not.toBe(saved(second).requestId);
    });

    it('recovers the launch turn after its root queue task has been reused by a follow-up', async () => {
        const row = accept(claim());
        await store.addProcess(createProcessFixture({ id: child(row).processId, status: 'completed', metadata: { workspaceId },
            conversationTurns: [turn('user', 'initial', row.executionId), turn('assistant', 'Initial only'),
                turn('user', 'later', 'another-request'), turn('assistant', 'Later answer')] }));
        enqueue(row);
        queue.getTask(row.executionId)!.payload.relayRequestId = 'another-request';
        queue.markStarted(row.executionId);
        queue.markCompleted(row.executionId, 'Later answer');
        await service().restore();
        expect(saved(row).terminal?.result.summary).toBe('Initial only');
    });

    it('ignores foreign workspace events and lets restored active work beat stale process failure', async () => {
        const row = accept(claim('follow-up')); const result = service(); enqueue(row, 'another-repo');
        queue.markStarted(row.executionId); queue.markCompleted(row.executionId, 'Foreign answer'); await flush();
        expect(saved(row).terminal?.result.summary).not.toBe('Foreign answer');
        // A separate fresh registration has valid active admission.
        const active = accept(claim('follow-up')); enqueue(active);
        await store.addProcess(createProcessFixture({ id: active.targetProcessId!, status: 'failed', metadata: { workspaceId },
            result: 'Stale failure' }));
        await result.restore();
        expect(saved(active).terminal).toBeUndefined();
    });

    it.each(['signal', 'cap', 'user-stopped', 'iteration-failed'])(
        'returns one whole Ralph %s result and keeps iteration events silent', async reason => {
            const row = accept(claim('ralph')); const sessionId = child(row).sessionId!;
            await sessions.initSession(workspaceId, sessionId, { originalGoal: 'Goal', maxIterations: 3 });
            const result = service(); enqueue(row); queue.markStarted(row.executionId);
            queue.markCompleted(row.executionId, 'An iteration only'); await flush();
            expect(saved(row).terminal).toBeUndefined();
            await sessions.recordCompletion(workspaceId, sessionId, { reason, processId: child(row).processId,
                totalIterations: 3, completedAt: new Date().toISOString() });
            // Restart/journal recovery works without the transient completion event.
            result.dispose(); await service().restore();
            const outcome = reason === 'signal' ? 'completed' : reason === 'cap' ? 'capped'
                : reason === 'user-stopped' ? 'cancelled' : 'failed';
            expect(saved(row).terminal?.result).toMatchObject({ outcome, reason });
            if (reason === 'cap') expect(saved(row).terminal?.result.summary).toContain('goal completion is not confirmed');
            expect(saved(row).terminal?.result.summary).not.toContain('An iteration only');
        });

    it('keeps a native grilling completion silent and returns only the eventual execution session', async () => {
        const row = accept(claim('ralph')); const sessionId = child(row).sessionId!;
        await sessions.initSession(workspaceId, sessionId, { phase: 'grilling', originalGoal: '', maxIterations: 3 });
        const result = service(); enqueue(row);
        queue.getTask(row.executionId)!.payload.context = { ralph: { sessionId, phase: 'grilling' } };
        queue.markStarted(row.executionId);
        queue.markCompleted(row.executionId, 'Spec ready'); await flush(); await result.restore();
        expect(saved(row).terminal).toBeUndefined();
        expect(store.updateProcess).not.toHaveBeenCalled();
    });

    it('persists a whole-session cancellation for an admitted Ralph task stopped before execution', async () => {
        const row = accept(claim('ralph')); const sessionId = child(row).sessionId!;
        await sessions.initSession(workspaceId, sessionId, { originalGoal: 'Goal', maxIterations: 3 });
        const result = service(); enqueue(row); queue.cancelTask(row.executionId);
        await flush(); await result.restore();
        expect(saved(row).terminal?.result).toMatchObject({ outcome: 'cancelled', reason: 'user-stopped' });
        expect((await sessions.readSessionRecord(workspaceId, sessionId))?.completion?.reason).toBe('user-stopped');
    });

    it('retries a failed result write from durable terminal evidence, keeping the first persisted result', async () => {
        const row = accept(claim()); enqueue(row); queue.markStarted(row.executionId); queue.markCompleted(row.executionId, 'Persisted first');
        const write = vi.spyOn(admissions, 'recordResult').mockImplementationOnce(() => { throw new Error('Disk full'); });
        const result = service(); await result.restore();
        expect(saved(row).terminal).toBeUndefined();
        await result.restore(); expect(write).toHaveBeenCalledTimes(2);
        const first = saved(row).terminal;
        queue.emit('taskFailed', { ...queue.getTask(row.executionId), status: 'failed', error: 'Late conflict' });
        await flush(); await result.restore();
        expect(saved(row).terminal).toEqual(first);
    });

    it('does not publish a late result or acceptance after disposal', async () => {
        const row = claim(); enqueue(row); queue.markStarted(row.executionId); queue.markCompleted(row.executionId, 'Too late');
        let release!: (value: ReturnType<typeof child>) => void;
        const find = vi.fn(() => new Promise<ReturnType<typeof child>>(resolve => { release = resolve; }));
        const result = service(find); const pending = result.restore();
        await flush(); result.dispose(); release(child(row)); await pending;
        expect(saved(row).admission.state).toBe('dispatching');
        expect(saved(row).terminal).toBeUndefined();
        expect(queue.listenerCount('ralphSessionComplete')).toBe(0);
    });

    it('skips queued recovery after disposal closes the process store', async () => {
        let releaseFirst!: () => void;
        store.getWorkspaces = vi.fn()
            .mockImplementationOnce(() => new Promise(resolve => { releaseFirst = () => resolve([]); }))
            .mockRejectedValue(new Error('database connection is closed'));
        const result = service();
        const first = result.restore();
        const queued = result.restore();
        await flush(); result.dispose(); releaseFirst();
        await expect(first).resolves.toBeUndefined();
        await expect(queued).resolves.toBeUndefined();
        expect(store.getWorkspaces).toHaveBeenCalledOnce();
    });
});
