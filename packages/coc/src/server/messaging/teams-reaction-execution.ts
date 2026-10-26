import { toQueueProcessId, type QueuedTask } from '@plusplusoneplusplus/forge';
import type { ScheduleQueueEventBus } from '../schedule/schedule-queue-await';
import { onTaskTerminal } from './chat-target';
import { TeamsReactionLaunchError, type createTeamsReactionLaunch } from './teams-reaction-launch';

interface Source {
    tenantId: string;
    userId: string;
    conversationId: string;
    messageId: string;
}

type Job = Awaited<ReturnType<ReturnType<typeof createTeamsReactionLaunch>>>;
type TerminalStatus = 'completed' | 'failed' | 'cancelled';
interface Lane { tail: Promise<void>; blocked: boolean; }

function terminal(status: string): status is TerminalStatus {
    return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/** Keep one server-owned instance across account/config/session reconnects. */
export function createTeamsReactionExecution(options: {
    queue: ScheduleQueueEventBus;
    launch: ReturnType<typeof createTeamsReactionLaunch>;
}) {
    const lanes = new Map<string, Lane>();
    const requests = new Map<string, { key: string; context: string; result: Promise<Job & { status: TerminalStatus }> }>();
    const waiting = new Map<string, { job: Job; resolve: (status: TerminalStatus) => void; reject: (error: Error) => void }>();
    const lifetime = new AbortController();

    function check(task: QueuedTask, requestId: string, job: Job) {
        if (task.id !== requestId || task.type !== 'chat' || task.repoId !== job.workspaceId
            || task.payload.kind !== 'chat' || task.payload.mode !== 'ask'
            || task.payload.relayRequestId !== requestId || task.payload.processId
            || job.processId !== toQueueProcessId(requestId)
            || (task.processId && task.processId !== job.processId)) {
            throw new Error('Teams reaction execution ownership mismatch.');
        }
    }

    const unsubscribe = onTaskTerminal(options.queue, task => {
        const waiter = waiting.get(task.id);
        if (!waiter || !terminal(task.status)) return;
        try {
            check(task, task.id, waiter.job);
            waiter.resolve(task.status);
        } catch (error) {
            waiter.reject(error instanceof Error ? error : new Error('Invalid Teams reaction terminal evidence.'));
        }
    });

    function awaitTerminal(requestId: string, job: Job): Promise<TerminalStatus> {
        return new Promise<TerminalStatus>((resolve, reject) => {
            waiting.set(requestId, { job, resolve, reject });
            try {
                // Subscribe before reading: execution can finish while launch is returning.
                const task = options.queue.getTask(requestId);
                if (!task) throw new Error('Teams reaction execution task is unavailable.');
                check(task, requestId, job);
                if (terminal(task.status)) resolve(task.status);
            } catch (error) {
                reject(error);
            }
        }).finally(() => waiting.delete(requestId));
    }

    function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
        return new Promise((resolve, reject) => {
            const abort = () => reject(signal.reason);
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
            work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
        });
    }

    return {
        run(source: Source, requestId: string, messageContext: string, signal: AbortSignal) {
            lifetime.signal.throwIfAborted();
            signal.throwIfAborted();
            const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!guid.test(source.tenantId) || !guid.test(source.userId)
                || (source.conversationId !== '48:notes'
                    && !/^19:[^\s/\\?#]+@(?:thread\.v2|unq\.gbl\.spaces)$/.test(source.conversationId))
                || !source.messageId || source.messageId.length > 4096 || /[\u0000-\u0020/\\?#]/.test(source.messageId)
                || !/^teams-reaction-[a-zA-Z0-9_-]{1,128}$/.test(requestId)
                || !messageContext.trim() || Buffer.byteLength(messageContext, 'utf8') > 512 * 1024) {
                throw new Error('Invalid Teams reaction execution request.');
            }
            const key = JSON.stringify([source.tenantId.toLowerCase(), source.userId.toLowerCase(),
                source.conversationId, source.messageId]);
            const existing = requests.get(requestId);
            if (existing) {
                if (existing.key !== key || existing.context !== messageContext) {
                    throw new Error('Teams reaction execution request collision.');
                }
                return untilAborted(existing.result, AbortSignal.any([signal, lifetime.signal]));
            }
            if (requests.size >= 256 || (!lanes.has(key) && lanes.size >= 4096)) {
                throw new Error('Teams reaction execution capacity exceeded.');
            }
            const lane = lanes.get(key) ?? { tail: Promise.resolve(), blocked: false };
            lanes.set(key, lane);
            const activeSignal = AbortSignal.any([signal, lifetime.signal]);
            const operation = lane.tail.then(async () => {
                activeSignal.throwIfAborted();
                if (lane.blocked) throw new Error('Teams reaction source is blocked by uncertain execution.');
                let job: Job;
                try {
                    job = await options.launch(requestId, messageContext, activeSignal);
                } catch (error) {
                    // An enqueue may persist before throwing. Never release an uncertain source.
                    lane.blocked = !(error instanceof TeamsReactionLaunchError && error.outcome === 'not-admitted');
                    throw error;
                }
                try {
                    lifetime.signal.throwIfAborted();
                    const status = await awaitTerminal(requestId, job);
                    return { ...job, status };
                } catch (error) {
                    lane.blocked = true;
                    throw error;
                }
            });
            const result = operation.finally(() => requests.delete(requestId));
            // Caller cancellation revokes its result, not the admitted queue execution.
            const tail = result.then(() => {}, () => {}).finally(() => {
                if (lane.tail === tail && !lane.blocked) lanes.delete(key);
            });
            lane.tail = tail;
            requests.set(requestId, { key, context: messageContext, result });
            return untilAborted(result, activeSignal);
        },
        dispose() {
            if (lifetime.signal.aborted) return;
            lifetime.abort(new Error('Teams reaction execution stopped.'));
            unsubscribe();
            for (const waiter of waiting.values()) waiter.reject(lifetime.signal.reason);
            waiting.clear();
        },
    };
}
