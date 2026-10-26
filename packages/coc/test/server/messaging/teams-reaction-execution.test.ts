import { EventEmitter } from 'node:events';
import { DEFAULT_TASK_CONFIG, toQueueProcessId, type QueuedTask } from '@plusplusoneplusplus/forge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTeamsReactionExecution } from '../../../src/server/messaging/teams-reaction-execution';
import { TeamsReactionLaunchError } from '../../../src/server/messaging/teams-reaction-launch';
import type { ScheduleQueueEventBus } from '../../../src/server/schedule/schedule-queue-await';

describe('Teams reaction same-source execution', () => {
    const source = {
        tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        userId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        conversationId: '48:notes',
        messageId: 'source-message',
    };
    let events: EventEmitter;
    let tasks: Map<string, QueuedTask>;
    let queue: ScheduleQueueEventBus;
    let execution: ReturnType<typeof createTeamsReactionExecution>;
    let launch: ReturnType<typeof vi.fn<(id: string, context: string, signal: AbortSignal) => Promise<{
        workspaceId: string; processId: string;
    }>>>;
    const signal = () => new AbortController().signal;
    const run = (id: string, controllerSignal = signal(), target = source, context = 'Untrusted context') =>
        execution.run(target, id, context, controllerSignal);
    const job = (id: string) => ({ workspaceId: 'workspace-alpha', processId: toQueueProcessId(id) });
    const task = (id: string): QueuedTask => ({
        id, type: 'chat', repoId: 'workspace-alpha', status: 'queued', priority: 'normal',
        createdAt: 1, config: { ...DEFAULT_TASK_CONFIG },
        payload: { kind: 'chat', mode: 'ask', relayRequestId: id },
    });
    const finish = (id: string, status: 'completed' | 'failed' | 'cancelled' = 'completed') => {
        const current = tasks.get(id)!;
        current.status = status;
        events.emit({ completed: 'taskCompleted', failed: 'taskFailed', cancelled: 'taskCancelled' }[status], current);
    };
    async function launched(count: number) {
        await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(count));
    }

    beforeEach(() => {
        events = new EventEmitter();
        tasks = new Map();
        queue = {
            on: (name, listener) => { events.on(name, listener); },
            off: (name, listener) => { events.off(name, listener); },
            getTask: id => tasks.get(id),
        };
        launch = vi.fn(async id => {
            tasks.set(id, task(id));
            return job(id);
        });
        execution = createTeamsReactionExecution({ queue, launch });
    });

    afterEach(() => execution.dispose());

    it.each(['completed', 'failed', 'cancelled'] as const)(
        'waits for actual %s execution, not admission, before a same-message re-add', async status => {
            const first = run('teams-reaction-first');
            const second = run('teams-reaction-second');
            await launched(1);
            expect(launch.mock.calls[0][0]).toBe('teams-reaction-first');
            finish('teams-reaction-first', status);
            await expect(first).resolves.toEqual({ ...job('teams-reaction-first'), status });
            await launched(2);
            finish('teams-reaction-second');
            await expect(second).resolves.toMatchObject({ status: 'completed' });
        },
    );

    it('preserves FIFO order for three additions', async () => {
        const first = run('teams-reaction-first');
        const second = run('teams-reaction-second');
        const third = run('teams-reaction-third');
        await launched(1);
        finish('teams-reaction-first');
        await first;
        await launched(2);
        finish('teams-reaction-second');
        await second;
        await launched(3);
        finish('teams-reaction-third');
        await third;
        expect(launch.mock.calls.map(call => call[0])).toEqual([
            'teams-reaction-first', 'teams-reaction-second', 'teams-reaction-third',
        ]);
    });

    it.each([
        { messageId: 'other-message' },
        { conversationId: '19:direct@thread.v2' },
        { conversationId: '19:group@unq.gbl.spaces' },
        { tenantId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' },
        { userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' },
    ])('retains ordinary concurrency for distinct source scope %j', async change => {
        const first = run('teams-reaction-first');
        const second = run('teams-reaction-second', signal(), { ...source, ...change });
        await launched(2);
        finish('teams-reaction-first');
        finish('teams-reaction-second');
        await Promise.all([first, second]);
    });

    it('normalizes account case, snapshots sources and does not scope lanes by execution workspace', async () => {
        const mutable = { ...source };
        const first = run('teams-reaction-first', signal(), mutable);
        mutable.messageId = 'mutated';
        const second = run('teams-reaction-second', signal(), {
            ...source, tenantId: source.tenantId.toUpperCase(), userId: source.userId.toUpperCase(),
        });
        await launched(1);
        launch.mockImplementationOnce(async id => {
            tasks.set(id, { ...task(id), repoId: 'workspace-beta' });
            return { ...job(id), workspaceId: 'workspace-beta' };
        });
        finish('teams-reaction-first');
        await first;
        await launched(2);
        finish('teams-reaction-second');
        await expect(second).resolves.toMatchObject({ workspaceId: 'workspace-beta' });
    });

    it('coalesces duplicate pending requests, but rejects conflicting source or context', async () => {
        const first = run('teams-reaction-first');
        const duplicate = run('teams-reaction-first');
        expect(() => run('teams-reaction-first', signal(), { ...source, messageId: 'other' })).toThrow('collision');
        expect(() => run('teams-reaction-first', signal(), source, 'changed')).toThrow('collision');
        await launched(1);
        finish('teams-reaction-first');
        expect(await duplicate).toEqual(await first);
    });

    it('does not let cancellation of a duplicate observer cancel admitted work', async () => {
        const first = run('teams-reaction-first');
        await launched(1);
        const observer = new AbortController();
        const duplicate = expect(run('teams-reaction-first', observer.signal)).rejects.toThrow('observer stopped');
        observer.abort(new Error('observer stopped'));
        await duplicate;
        finish('teams-reaction-first');
        await expect(first).resolves.toMatchObject({ status: 'completed' });
    });

    it('revokes a cancelled result without releasing an executing predecessor', async () => {
        const controller = new AbortController();
        const first = expect(run('teams-reaction-first', controller.signal)).rejects.toThrow('session changed');
        await launched(1);
        controller.abort(new Error('session changed'));
        await first;
        const second = run('teams-reaction-second');
        await Promise.resolve();
        expect(launch).toHaveBeenCalledTimes(1);
        finish('teams-reaction-first');
        await launched(2);
        finish('teams-reaction-second');
        await second;
    });

    it('skips a cancelled pending addition without blocking later additions', async () => {
        const first = run('teams-reaction-first');
        const controller = new AbortController();
        const second = expect(run('teams-reaction-second', controller.signal)).rejects.toThrow('stopped');
        const third = run('teams-reaction-third');
        await launched(1);
        controller.abort(new Error('stopped'));
        await second;
        finish('teams-reaction-first');
        await first;
        await launched(2);
        expect(launch.mock.calls[1][0]).toBe('teams-reaction-third');
        finish('teams-reaction-third');
        await third;
    });

    it('holds a job admitted during cancellation until terminal evidence arrives', async () => {
        const controller = new AbortController();
        launch.mockImplementationOnce(async id => {
            tasks.set(id, task(id));
            controller.abort(new Error('late cancellation'));
            return job(id);
        });
        await expect(run('teams-reaction-first', controller.signal)).rejects.toThrow('late cancellation');
        const second = run('teams-reaction-second');
        await Promise.resolve();
        expect(launch).toHaveBeenCalledTimes(1);
        finish('teams-reaction-first');
        await launched(2);
        finish('teams-reaction-second');
        await second;
    });

    it('observes execution that finishes before admission returns', async () => {
        launch.mockImplementationOnce(async id => {
            tasks.set(id, task(id));
            finish(id);
            return job(id);
        });
        await expect(run('teams-reaction-first')).resolves.toMatchObject({ status: 'completed' });
    });

    it('closes the subscription/read completion race', async () => {
        const get = queue.getTask;
        queue.getTask = id => {
            finish(id);
            return get(id);
        };
        await expect(run('teams-reaction-first')).resolves.toMatchObject({ status: 'completed' });
    });

    it('ignores unrelated jobs and nonterminal signals', async () => {
        const first = run('teams-reaction-first');
        const second = run('teams-reaction-second');
        await launched(1);
        events.emit('taskCompleted', task('teams-reaction-unrelated'));
        events.emit('taskCompleted', task('teams-reaction-first'));
        await Promise.resolve();
        expect(launch).toHaveBeenCalledTimes(1);
        finish('teams-reaction-first');
        await first;
        await launched(2);
        finish('teams-reaction-second');
        await second;
    });

    it.each(['missing-task', 'wrong-workspace', 'wrong-process', 'follow-up', 'wrong-mode', 'wrong-request', 'wrong-kind', 'wrong-type'])(
        'blocks uncertain same-source execution on %s admission evidence', async reason => {
            launch.mockImplementationOnce(async id => {
                const current = task(id);
                if (reason !== 'missing-task') tasks.set(id, current);
                if (reason === 'wrong-workspace') current.repoId = 'workspace-beta';
                if (reason === 'wrong-process') current.processId = 'other-process';
                if (reason === 'follow-up') current.payload.processId = 'other-process';
                if (reason === 'wrong-mode') current.payload.mode = 'autopilot';
                if (reason === 'wrong-request') current.payload.relayRequestId = 'other-request';
                if (reason === 'wrong-kind') current.payload.kind = 'custom';
                if (reason === 'wrong-type') current.type = 'custom';
                return job(id);
            });
            await expect(run('teams-reaction-first')).rejects.toThrow();
            await expect(run('teams-reaction-second')).rejects.toThrow('blocked by uncertain execution');
            expect(launch).toHaveBeenCalledTimes(1);
        },
    );

    it('rejects mismatched terminal ownership without releasing a new execution', async () => {
        const first = expect(run('teams-reaction-first')).rejects.toThrow('ownership mismatch');
        const second = expect(run('teams-reaction-second')).rejects.toThrow('blocked by uncertain execution');
        await launched(1);
        tasks.get('teams-reaction-first')!.repoId = 'workspace-beta';
        finish('teams-reaction-first');
        await Promise.all([first, second]);
        expect(launch).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])('never replays an uncertain admission (persisted: %s)', async persisted => {
        launch.mockImplementationOnce(async id => {
            if (persisted) tasks.set(id, task(id));
            throw new Error('enqueue uncertain');
        });
        await expect(run('teams-reaction-first')).rejects.toThrow('enqueue uncertain');
        await expect(run('teams-reaction-second')).rejects.toThrow('blocked by uncertain execution');
        const unrelated = run('teams-reaction-other', signal(), { ...source, messageId: 'other-message' });
        await launched(2);
        finish('teams-reaction-other');
        await unrelated;
    });

    it('allows a later addition after a proven not-admitted failure', async () => {
        launch.mockRejectedValueOnce(new TeamsReactionLaunchError(new Error('dispatcher unavailable'), 'not-admitted'));
        await expect(run('teams-reaction-first')).rejects.toThrow('dispatcher unavailable');
        const second = run('teams-reaction-second');
        await launched(2);
        finish('teams-reaction-second');
        await expect(second).resolves.toMatchObject({ status: 'completed' });
    });

    it('bounds outstanding additions without evicting active source protection', async () => {
        const pending = Array.from({ length: 256 }, (_, index) => run(`teams-reaction-${index}`));
        const settled = Promise.allSettled(pending);
        expect(() => run('teams-reaction-overflow')).toThrow('capacity exceeded');
        await launched(1);
        for (const event of ['taskCompleted', 'taskFailed', 'taskCancelled']) {
            expect(events.listenerCount(event)).toBe(1);
        }
        execution.dispose();
        expect((await settled).every(result => result.status === 'rejected')).toBe(true);
        expect(launch).toHaveBeenCalledTimes(1);
    });

    it('bounds retained uncertain sources without evicting their protection', async () => {
        launch.mockRejectedValue(new Error('enqueue uncertain'));
        for (let index = 0; index < 4096; index++) {
            await expect(run(`teams-reaction-${index}`, signal(), {
                ...source, messageId: `source-${index}`,
            })).rejects.toThrow('enqueue uncertain');
        }
        expect(() => run('teams-reaction-overflow', signal(), {
            ...source, messageId: 'new-source',
        })).toThrow('capacity exceeded');
        await expect(run('teams-reaction-readd', signal(), {
            ...source, messageId: 'source-0',
        })).rejects.toThrow('blocked by uncertain execution');
        expect(launch).toHaveBeenCalledTimes(4096);
    });

    it('removes terminal subscriptions on dispose and never accepts another run', async () => {
        const first = expect(run('teams-reaction-first')).rejects.toThrow('execution stopped');
        const second = expect(run('teams-reaction-second')).rejects.toThrow('execution stopped');
        await launched(1);
        expect(events.eventNames()).toHaveLength(3);
        execution.dispose();
        execution.dispose();
        await Promise.all([first, second]);
        expect(events.eventNames()).toHaveLength(0);
        expect(() => run('teams-reaction-other')).toThrow('execution stopped');
        expect(tasks.get('teams-reaction-first')!.status).toBe('queued');
    });

    it('revokes late launch results after dispose without installing a new waiter', async () => {
        let complete!: () => void;
        launch.mockImplementationOnce(id => new Promise(resolve => {
            complete = () => { tasks.set(id, task(id)); resolve(job(id)); };
        }));
        const first = expect(run('teams-reaction-first')).rejects.toThrow('execution stopped');
        await launched(1);
        execution.dispose();
        await first;
        complete();
        await Promise.resolve();
        expect(events.eventNames()).toHaveLength(0);
    });

    it('rejects pre-cancelled requests before launch', () => {
        const controller = new AbortController();
        controller.abort(new Error('already stopped'));
        expect(() => run('teams-reaction-first', controller.signal)).toThrow('already stopped');
        expect(launch).not.toHaveBeenCalled();
    });

    it.each([
        { tenantId: 'invalid' }, { userId: 'invalid' }, { conversationId: '19:channel@thread.tacv2' },
        { conversationId: '48:other' }, { messageId: '' }, { messageId: 'bad/id' }, { messageId: 'x'.repeat(4097) },
    ])('rejects unsafe source scope %j before launch', change => {
        expect(() => run('teams-reaction-first', signal(), { ...source, ...change })).toThrow('Invalid');
        expect(launch).not.toHaveBeenCalled();
    });

    it.each([
        { id: 'invalid', context: 'context' },
        { id: 'teams-reaction-valid', context: ' ' },
        { id: 'teams-reaction-valid', context: '\u00e9'.repeat(256 * 1024 + 1) },
    ])('rejects invalid request/context before launch', ({ id, context }) => {
        expect(() => run(id, signal(), source, context)).toThrow('Invalid');
        expect(launch).not.toHaveBeenCalled();
    });
});
