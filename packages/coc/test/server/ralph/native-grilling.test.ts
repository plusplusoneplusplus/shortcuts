import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskQueueManager, type AIProcess, type CreateTaskInput } from '@plusplusoneplusplus/forge';
import { createMockProcessStore, createProcessFixture } from '../../helpers/mock-process-store';
import { buildRalphGrillingSubmission } from '../../../src/server/ralph/grilling-submission';
import { RalphGrillingStore, prepareRalphGrilling, reconcileRalphGoal, projectRalphGrillingMetadata } from '../../../src/server/ralph/grilling-state';
import { RalphSessionStore } from '../../../src/server/ralph/ralph-session-store';
import { launchRalphSession } from '../../../src/server/ralph/ralph-launch-service';
import { DelegatedJobStore, grillingResultJob } from '../../../src/server/delegation/delegated-job-store';
import { DelegatedJobResults } from '../../../src/server/delegation/delegated-job-results';
import { createSentinelDelegationEnqueue } from '../../../src/server/delegation/sentinel-delegation-enqueue';

describe('native Ralph grilling admission and recovery', () => {
    let dataDir: string;
    let store: ReturnType<typeof createMockProcessStore>;
    let queue: TaskQueueManager;
    let task: CreateTaskInput;
    let results: DelegatedJobResults | undefined;
    const sessionId = 'ralph-native-test';
    const workspaceId = 'ws-target';

    beforeEach(async () => {
        dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'native-grilling-'));
        store = createMockProcessStore();
        store.getWorkspaces = vi.fn().mockResolvedValue([{ id: workspaceId, rootPath: dataDir }, { id: 'ws-parent' }]);
        queue = new TaskQueueManager();
        const submission = buildRalphGrillingSubmission({ prompt: 'Build a thing', sessionId, skills: ['impl', 'grill-me'] });
        task = { id: 'interview', type: 'chat', priority: 'normal', payload: { kind: 'chat', workspaceId,
            ...submission, context: { ...submission.context, spawnedFromProcessId: 'queue_parent' } } };
    });

    afterEach(async () => { results?.dispose(); results = undefined; await fs.rm(dataDir, { recursive: true, force: true }); });

    async function admit() { await prepareRalphGrilling(task, { dataDir, store, enabled: true }); }
    async function process(content: string, extra: Partial<AIProcess> = {}) {
        const proc = createProcessFixture({ id: 'queue_interview', status: 'completed',
            metadata: { workspaceId, mode: 'ask', ralph: { phase: 'grilling', sessionId } },
            conversationTurns: [
                { role: 'user', turnIndex: 0, content: 'Build a thing', timestamp: new Date() },
                { role: 'assistant', turnIndex: 1, content, timestamp: new Date(), streaming: false },
            ], ...extra });
        await store.addProcess(proc);
        return proc;
    }

    it('shares composer skills and native Ask identity, never queues execution', async () => {
        await admit();
        expect(task.payload.mode).toBe('ask');
        expect((task.payload.context as any).skills).toEqual(['impl', 'grill-me']);
        expect(task.payload.prompt).toContain(new RalphGrillingStore(dataDir).goalPath(workspaceId, sessionId).replace(/\\/g, '/'));
        expect(await new RalphSessionStore({ dataDir }).readSessionRecord(workspaceId, sessionId)).toMatchObject({ phase: 'grilling', currentIteration: 0, iterations: [] });
        expect(queue.getQueued()).toEqual([]);
        await admit(); // Canonical preparation can be called again by the route adapter.
        expect(String(task.payload.prompt).match(/Save the final synthesized/g)).toHaveLength(1);
    });

    it.each([false, undefined])('rejects disabled/missing Ralph availability (%s)', async enabled => {
        await expect(prepareRalphGrilling(task, { dataDir, store, enabled: enabled === true })).rejects.toThrow('disabled');
        expect(await new RalphSessionStore({ dataDir }).readSessionRecord(workspaceId, sessionId)).toBeNull();
    });

    it('rejects unknown owners, unsafe session IDs and identity reuse by another child', async () => {
        await admit();
        await expect(prepareRalphGrilling({ ...task, id: 'other-child' }, { dataDir, store, enabled: true })).rejects.toThrow('another conversation');
        (task.payload.context as any).ralph.sessionId = '../../outside';
        await expect(admit()).rejects.toThrow('identity');
        task.payload.workspaceId = 'unknown';
        await expect(admit()).rejects.toThrow('registered');
    });

    it.each(['What do you want?', '## Goal', '## Goal\n\n## Constraints'])('does not treat an interview or empty heading as readiness: %s', async content => {
        await admit();
        const state = await reconcileRalphGoal(await process(content), { dataDir, store });
        expect(state?.goal).toBeUndefined();
    });

    it('persists validated synthesis and stable readiness without a SPA, then rejects edited artifacts', async () => {
        await admit();
        const proc = await process('## Goal\nBuild a thing\n\n## Acceptance Criteria\n- Tests pass');
        const state = (await reconcileRalphGoal(proc, { dataDir, store }))!;
        const grilling = new RalphGrillingStore(dataDir);
        expect(await grilling.validatedGoal(state)).toContain('## Goal');
        expect((await store.getProcess(proc.id))?.metadata?.ralphGoal).toEqual(state.goal);
        const restored = await new RalphGrillingStore(dataDir).read(workspaceId, sessionId);
        expect(restored?.goal).toEqual(state.goal);
        await reconcileRalphGoal(proc, { dataDir, store });
        expect((await grilling.read(workspaceId, sessionId))?.goal).toEqual(state.goal);
        await fs.writeFile(state.goal!.path, '## Goal\nChanged without review');
        expect(await grilling.validatedGoal(state)).toBeUndefined();
        expect((await projectRalphGrillingMetadata(proc, dataDir)).metadata?.ralphGoal).toBeNull();
        expect((await reconcileRalphGoal(proc, { dataDir, store }))?.goal).toBeUndefined();
        expect(await fs.readFile(state.goal!.path, 'utf8')).toContain('Changed without review');
    });

    it('pending native questions, cancellation, and a newer interview request cannot be ready', async () => {
        await admit();
        const proc = await process('## Goal\nBuild it', { pendingAskUser: [{ question: 'Choose a scope' }] as any });
        expect((await reconcileRalphGoal(proc, { dataDir, store }))?.goal).toBeUndefined();
        await store.updateProcess(proc.id, { pendingAskUser: undefined });
        expect((await reconcileRalphGoal(proc, { dataDir, store }))?.goal).toBeDefined();
        proc.conversationTurns!.push({ role: 'user', turnIndex: 2, timestamp: new Date(), content: 'Need context' });
        expect((await reconcileRalphGoal(proc, { dataDir, store }))?.goal).toBeUndefined();
        await store.updateProcess(proc.id, { status: 'cancelled' });
        expect((await reconcileRalphGoal(proc, { dataDir, store }))?.goal).toBeUndefined();
        expect(queue.getQueued()).toEqual([]);
    });

    it('launches a target-owned interview through the same queue admission, preserving Auto overrides', async () => {
        const enqueue = vi.fn(async (input: CreateTaskInput) => queue.enqueue(input));
        const result = await launchRalphSession({ goalSpec: 'Build it', entryPoint: 'grill', workspaceId,
            spawnedFromProcessId: 'queue_parent', title: 'Interview',
            aiSelection: { autoProviderRouting: true, config: { effortTier: 'high' } } },
        { bridge: { enqueue } as any, dataDir, store, getRalphEnabled: () => true });
        expect(result).toMatchObject({ ok: true, phase: 'grilling', workspaceId });
        const input = enqueue.mock.calls[0][0];
        expect(input.payload).toMatchObject({ mode: 'ask', customTitle: 'Interview', context: {
            spawnedFromProcessId: 'queue_parent', autoProviderRouting: { requested: true }, skills: ['grill-me'],
        } });
        expect(input.payload.provider).toBeUndefined();
        expect(input.config).toEqual({ effortTier: 'high' });
        expect(queue.getQueued().every(row => row.payload.mode === 'ask')).toBe(true);
    });

    it('reuses a source-approved execution admission across retries and restart without a duplicate child', async () => {
        const requestId = '12345678-1234-4234-9234-123456789abc';
        const input = { goalSpec: '## Goal\nApproved feature', workspaceId, requestId };
        const enqueue = vi.fn(async (input: CreateTaskInput) => queue.enqueue(input));
        const deps = { bridge: { enqueue, getTask: (id: string) => queue.getTask(id) } as any, dataDir, store, getRalphEnabled: () => true };
        const launches = await Promise.all([launchRalphSession(input, deps), launchRalphSession(input, deps)]);
        expect(launches[0]).toEqual(launches[1]); expect(enqueue).toHaveBeenCalledOnce();
        expect(await launchRalphSession(input, deps)).toEqual(launches[0]);
        expect(await launchRalphSession({ ...input, goalSpec: 'Different' }, deps)).toMatchObject({ ok: false });
        expect(enqueue).toHaveBeenCalledOnce();
    });

    it('recovers queue acceptance after an observer fails and rejects uncertain crash replay', async () => {
        const requestId = '12345678-1234-4234-9234-123456789def';
        const input = { goalSpec: 'Build it', entryPoint: 'grill' as const, workspaceId, requestId };
        const enqueue = vi.fn(async (input: CreateTaskInput) => { queue.enqueue(input); throw new Error('observer failed'); });
        const deps = { bridge: { enqueue, getTask: (id: string) => queue.getTask(id) } as any, dataDir, store, getRalphEnabled: () => true };
        const admitted = await launchRalphSession(input, deps);
        expect(admitted).toMatchObject({ ok: true, phase: 'grilling', processId: `queue_${requestId}` });
        expect(await launchRalphSession(input, deps)).toEqual(admitted);
        expect(enqueue).toHaveBeenCalledOnce();
        const uncertainId = '12345678-1234-4234-9234-123456789aaa';
        const sessionDir = new RalphSessionStore({ dataDir }).getSessionDir(workspaceId, `ralph-approved-${uncertainId}`);
        await fs.mkdir(sessionDir, { recursive: true });
        await fs.writeFile(path.join(sessionDir, 'admission.json'), JSON.stringify({ goalSpec: input.goalSpec, entryPoint: 'grill', status: 'admitting' }));
        expect(await launchRalphSession({ ...input, requestId: uncertainId }, deps)).toMatchObject({ ok: false, error: expect.stringContaining('uncertain') });
        expect(enqueue).toHaveBeenCalledOnce();
    });

    it('does not relaunch a rejected delegation whose admission receipt has settled', async () => {
        const input = { goalSpec: 'Build it', entryPoint: 'grill' as const, workspaceId,
            requestId: '12345678-1234-4234-9234-123456789bbb' };
        const enqueue = vi.fn().mockRejectedValue(new Error('Queue rejected'));
        const deps = { bridge: { enqueue, getTask: () => undefined } as any, dataDir, store, getRalphEnabled: () => true };
        const rejected = await launchRalphSession(input, deps);
        expect(rejected).toMatchObject({ ok: false, error: 'Queue rejected' });
        expect(await launchRalphSession(input, deps)).toEqual(rejected);
        expect(enqueue).toHaveBeenCalledOnce();
    });

    it('recovers a different local execution owner with the original session receipt, excluding remote callbacks', async () => {
        await admit();
        const jobs = new DelegatedJobStore(dataDir);
        const relationship = { id: 'queue_interview', title: 'Native interview', parent: { workspaceId: 'ws-parent', processId: 'queue_parent' },
            child: { workspaceId, processId: 'queue_interview', sessionId } };
        jobs.register(relationship);
        const grilling = new RalphGrillingStore(dataDir);
        const state = (await grilling.read(workspaceId, sessionId))!;
        const execution = { workspaceId: 'ws-parent', sessionId: 'ralph-other-owner', processId: 'queue_execution', remote: false };
        state.start = { taskId: 'approval', goalSpec: '## Goal\nApproved', status: 'admitted', targetKey: 'local:ws-parent', execution };
        await grilling.write(state);
        const sessions = new RalphSessionStore({ dataDir });
        await sessions.initSession(execution.workspaceId, execution.sessionId, { originalGoal: state.start.goalSpec, maxIterations: 1 });
        await sessions.recordCompletion(execution.workspaceId, execution.sessionId, { reason: 'signal', totalIterations: 1,
            processId: execution.processId, completedAt: new Date().toISOString() });
        await store.addProcess(createProcessFixture({ id: execution.processId, status: 'completed',
            metadata: { workspaceId: execution.workspaceId }, result: 'Executed in the actual target' }));
        results = new DelegatedJobResults({ jobs, store, dataDir, queue, sessions });
        await results.restore();
        const terminal = jobs.list('ws-parent')[0].terminal!.result;
        expect(terminal.terminalEventId).toBe(`ralph:${workspaceId}:${sessionId}:terminal`);
        expect(terminal.summary).toContain('Executed in the actual target');
        expect(terminal.links).toEqual([
            `#chat-references/${jobs.serverIdentity}/${execution.workspaceId}/${execution.processId}`,
            sessions.getProgressPath(execution.workspaceId, execution.sessionId),
        ]);
        const remoteJobs = new DelegatedJobStore(path.join(dataDir, 'remote-ledger-test'));
        remoteJobs.register(relationship);
        state.start.execution!.remote = true; await grilling.write(state);
        results.dispose();
        results = new DelegatedJobResults({ jobs: remoteJobs, store, dataDir, queue, sessions });
        await results.restore();
        expect(remoteJobs.list('ws-parent')[0].terminal).toBeUndefined();
    });

    it('records spec-ready separately from execution terminal and replays only registered receipts', async () => {
        await admit();
        await store.addProcess(createProcessFixture({ id: 'queue_parent', metadata: { workspaceId: 'ws-parent', mode: 'sentinel' } }));
        const jobs = new DelegatedJobStore(dataDir);
        const register = createSentinelDelegationEnqueue({ jobs, store, hasTask: id => !!queue.getTask(id) });
        await register(task, async input => queue.enqueue(input));
        const callback = vi.fn();
        await process('## Goal\nBuild it');
        results = new DelegatedJobResults({ jobs, store, dataDir, queue, sessions: new RalphSessionStore({ dataDir }), onResult: callback });
        queue.markStarted('interview'); queue.markCompleted('interview', { response: '## Goal\nBuild it' });
        await vi.waitFor(() => expect(jobs.list('ws-parent')[0].grilling?.result.reason).toBe('spec-ready'));
        const row = jobs.list('ws-parent')[0];
        expect(row.terminal).toBeUndefined();
        expect(grillingResultJob(row)?.boundary).toBe('grill');
        expect(jobs.recordResult('ws-parent', row.id, { terminalEventId: `ralph:${workspaceId}:${sessionId}:terminal`,
            outcome: 'completed', summary: 'Executed', links: [] })).toBe(true);
        expect(jobs.list('ws-parent')[0].grilling).toEqual(row.grilling);
        expect(jobs.updateDelivery('ws-parent', row.id, 'pending', { state: 'queued', receiptId: 'spec-receipt' }, 'grill')).toBe(true);
        expect(jobs.list('ws-parent')[0].terminal?.delivery.state).toBe('pending');
    });
});
