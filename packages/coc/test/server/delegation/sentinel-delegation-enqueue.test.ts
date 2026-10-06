import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskQueueManager, toQueueProcessId, type CreateTaskInput } from '@plusplusoneplusplus/forge';
import { createMockProcessStore } from '../../helpers/mock-process-store';
import { DelegatedJobStore } from '../../../src/server/delegation/delegated-job-store';
import { createSentinelDelegationEnqueue } from '../../../src/server/delegation/sentinel-delegation-enqueue';
import { createSendToConversationTool } from '../../../src/server/llm-tools/send-to-conversation-tool';
import { launchRalphSession } from '../../../src/server/ralph/ralph-launch-service';

const parentId = 'queue_parent';
const parentWorkspace = 'ws-parent';
const childWorkspace = 'ws-child';

describe('Sentinel delegation admission', () => {
    let dataDir: string;
    let jobs: DelegatedJobStore;
    let queue: TaskQueueManager;
    let store: ReturnType<typeof createMockProcessStore>;
    let admit: ReturnType<typeof createSentinelDelegationEnqueue>;
    let enqueue: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-delegation-'));
        jobs = new DelegatedJobStore(dataDir);
        queue = new TaskQueueManager();
        store = createMockProcessStore();
        await store.addProcess({
            id: parentId, type: 'chat', status: 'running', promptPreview: 'Dispatch', startTime: new Date(),
            metadata: { workspaceId: parentWorkspace, provider: 'copilot', mode: 'sentinel' },
        });
        store.getWorkspaces = vi.fn().mockResolvedValue([
            { id: parentWorkspace, rootPath: path.join(dataDir, 'parent') },
            { id: childWorkspace, rootPath: path.join(dataDir, 'child') },
        ]);
        admit = createSentinelDelegationEnqueue({ store, jobs, hasTask: id => !!queue.getTask(id), getTask: id => queue.getTask(id) });
        enqueue = vi.fn(async (input: CreateTaskInput) => queue.enqueue(input));
    });

    afterEach(() => fs.rmSync(dataDir, { recursive: true, force: true }));

    function input(): CreateTaskInput {
        return {
            type: 'chat', priority: 'normal', displayName: 'Fix search',
            payload: { kind: 'chat', mode: 'autopilot', workspaceId: childWorkspace,
                context: { spawnedFromProcessId: parentId } },
        };
    }

    it.each(['ask', 'autopilot', 'ralph'] as const)('persists %s tool delegation before taskAdded, across workspaces', async mode => {
        queue.on('taskAdded', (task) => {
            const rows = new DelegatedJobStore(dataDir).list(parentWorkspace);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({
                id: toQueueProcessId(task.id), title: 'Fix search',
                parent: { workspaceId: parentWorkspace, processId: parentId },
                child: { workspaceId: childWorkspace, processId: toQueueProcessId(task.id) },
            });
            expect(jobs.list(childWorkspace)).toEqual([]);
        });
        const { tool } = createSendToConversationTool({
            store, workspaceId: parentWorkspace, parentProcessId: parentId,
            enqueueChat: task => admit(task, enqueue),
            launchRalph: request => launchRalphSession(request, {
                dataDir, store, bridge: { enqueue: task => admit(task, enqueue) } as any,
            }),
        });
        const result = await tool.handler({ content: 'Fix search', mode, workspaceId: childWorkspace, title: 'Fix search' });
        if ('error' in result) throw new Error(result.error);
        const job = new DelegatedJobStore(dataDir).list(parentWorkspace)[0];
        expect(job.id).toBe(result.processId);
        expect(job.child.sessionId).toBe(mode === 'ralph' ? result.sessionId : undefined);
        expect(job.terminal).toBeUndefined();
    });

    it('preserves supplied IDs and registers duplicate admission identity once', async () => {
        const task = input();
        task.id = 'reserved';
        const launch = vi.fn(async task => task.id!);
        expect(await admit(task, launch)).toBe('reserved');
        expect(await admit(task, launch)).toBe('reserved');
        expect(jobs.list(parentWorkspace)).toHaveLength(1);
    });

    it.each(['queued', 'running'] as const)('registers a %s Sentinel parent before its first process exists', async status => {
        const id = queue.enqueue({ type: 'chat', repoId: parentWorkspace, priority: 'normal',
            payload: { kind: 'chat', mode: 'sentinel', workspaceId: parentWorkspace } });
        if (status === 'running') queue.markStarted(id);
        const task = input();
        task.payload.context = { spawnedFromProcessId: toQueueProcessId(id) };
        queue.on('taskAdded', child => {
            expect(new DelegatedJobStore(dataDir).list(parentWorkspace)[0]).toMatchObject({
                parent: { workspaceId: parentWorkspace, processId: toQueueProcessId(id) },
                child: { workspaceId: childWorkspace, processId: toQueueProcessId(child.id) },
            });
        });
        await admit(task, enqueue);
        expect(jobs.list(childWorkspace)).toEqual([]);
    });

    it('does not use stale queue history when the parent process is unavailable', async () => {
        const id = queue.enqueue({ type: 'chat', repoId: parentWorkspace, priority: 'normal',
            payload: { kind: 'chat', mode: 'sentinel', workspaceId: parentWorkspace } });
        queue.cancelTask(id);
        const task = input();
        task.payload.context = { spawnedFromProcessId: toQueueProcessId(id) };
        await admit(task, enqueue);
        expect(jobs.list(parentWorkspace)).toEqual([]);
    });

    it('prefers stored parent mode and workspace over its active queue task', async () => {
        queue.enqueue({ id: 'parent', type: 'chat', repoId: childWorkspace, priority: 'normal',
            payload: { kind: 'chat', mode: 'sentinel', workspaceId: childWorkspace } });
        await store.updateProcess(parentId, { metadata: { workspaceId: parentWorkspace, mode: 'ask' } });
        await admit(input(), enqueue);
        expect(jobs.list(parentWorkspace)).toEqual([]);
        expect(jobs.list(childWorkspace)).toEqual([]);
    });

    it.each(['ask', 'autopilot', undefined])('keeps non-Sentinel parent mode %s untracked', async mode => {
        await store.updateProcess(parentId, { metadata: { workspaceId: parentWorkspace, mode } });
        const task = input();
        await admit(task, enqueue);
        expect(task.id).toBeUndefined();
        expect(jobs.list(parentWorkspace)).toEqual([]);
    });

    it('does not register unrelated jobs or missing parents', async () => {
        const task = input();
        task.payload.context = {};
        await admit(task, enqueue);
        task.payload.context = { spawnedFromProcessId: 'missing' };
        await admit(task, enqueue);
        expect(jobs.list(parentWorkspace)).toEqual([]);
    });

    it('fails before admission for a Sentinel missing workspace identity', async () => {
        await store.updateProcess(parentId, { metadata: { mode: 'sentinel' } });
        await expect(admit(input(), enqueue)).rejects.toThrow('workspace identities');
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('fails before admission when durable registration fails', async () => {
        vi.spyOn(jobs, 'register').mockImplementation(() => { throw new Error('disk failure'); });
        await expect(admit(input(), enqueue)).rejects.toThrow('disk failure');
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('atomically settles rejected admission so recovery cannot review it', async () => {
        queue.once('change', () => { throw new Error('persistence failure'); });
        await expect(admit(input(), enqueue)).rejects.toThrow('persistence failure');
        const job = new DelegatedJobStore(dataDir).list(parentWorkspace)[0];
        expect(queue.getTask(job.child.processId.slice('queue_'.length))).toBeUndefined();
        expect(job.terminal).toMatchObject({ result: { outcome: 'failed' }, delivery: { state: 'failed' } });
    });

    it('retains tracking after admitted taskAdded observer failure', async () => {
        queue.on('taskAdded', () => { throw new Error('observer failure'); });
        await expect(admit(input(), enqueue)).rejects.toThrow('observer failure');
        const job = new DelegatedJobStore(dataDir).list(parentWorkspace)[0];
        expect(queue.getTask(job.child.processId.slice('queue_'.length))).toBeDefined();
        expect(job.terminal).toBeUndefined();
    });
});
