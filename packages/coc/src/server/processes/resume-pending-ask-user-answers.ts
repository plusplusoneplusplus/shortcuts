/**
 * Startup re-enqueue for pending ask_user resumes (AC-04).
 *
 * When an answer is submitted for a process whose live ask_user resolver was
 * torn down by a restart, the answer is persisted as a durable
 * `pendingAskUserAnswer` and a resume task is enqueued (see
 * queue-executor-bridge.ts). If the server restarts *again* in the window
 * between that submit and the resume task actually running, the in-memory queue
 * task is lost — but the durable `pendingAskUserAnswer` survives on the process.
 *
 * This module is the safety net: on startup, scan the store for any process
 * that still carries a `pendingAskUserAnswer` and has no in-flight (queued or
 * running) resume task, and (re)enqueue one. Idempotent — a process whose
 * resume task was restored by the queue persistence layer (or already
 * re-enqueued by an earlier invocation) is skipped, so repeated restarts never
 * stack duplicate concurrent resumes.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { AIProcess, CreateTaskInput, ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import { isAskUserResumePayload } from '../tasks/task-types';

/**
 * Build the chat follow-up task input that drives an ask_user resume. The
 * synthesized answer message is rebuilt from the durable `pendingAskUserAnswer`
 * at execution time, so the placeholder prompt here is never sent to the model.
 *
 * Shared by the live answer-submit path ({@link CLITaskExecutor.enqueueAskUserResumeTask})
 * and the startup re-enqueue routine so both schedule an identical task.
 */
export function buildAskUserResumeTaskInput(proc: AIProcess): CreateTaskInput {
    const workspaceId = proc.metadata?.workspaceId;
    return {
        processId: proc.id,
        type: 'chat',
        priority: 'normal',
        payload: {
            kind: 'chat' as const,
            processId: proc.id,
            prompt: '',
            mode: 'ask' as const,
            context: { askUserResume: true },
            ...(proc.workingDirectory ? { workingDirectory: proc.workingDirectory } : {}),
            ...(workspaceId ? { workspaceId } : {}),
        },
        config: {},
        displayName: 'Resuming after restart…',
    };
}

/**
 * Collect the set of process IDs that already have an in-flight (queued or
 * running) ask_user resume task, so the startup scan doesn't enqueue a
 * duplicate.
 */
export function collectInFlightAskUserResumeProcessIds(
    tasks: Array<{ payload?: Record<string, unknown> }>,
): Set<string> {
    const ids = new Set<string>();
    for (const task of tasks) {
        const payload = task.payload;
        if (payload && isAskUserResumePayload(payload) && typeof payload.processId === 'string') {
            ids.add(payload.processId);
        }
    }
    return ids;
}

/** Minimal queue surface the re-enqueue routine needs. */
export interface AskUserResumeQueue {
    getQueued(): QueuedTask[];
    getRunning(): QueuedTask[];
    enqueue(input: CreateTaskInput): Promise<string> | string;
}

/**
 * Scan the store for processes carrying a durable `pendingAskUserAnswer` and
 * (re)enqueue a resume task for any that have no in-flight resume. Returns the
 * number of resume tasks enqueued.
 *
 * Best-effort: a store read failure yields 0 rather than blocking startup.
 * Idempotent across repeated calls because the in-flight set is computed from
 * the live queue each invocation — a task enqueued by an earlier call (or
 * restored by the queue persistence layer) is seen as in-flight and skipped.
 */
export async function reenqueuePendingAskUserResumes(
    store: ProcessStore,
    queue: AskUserResumeQueue,
): Promise<number> {
    let processes: AIProcess[];
    try {
        // `pendingAskUserAnswer` rides in the always-loaded metadata envelope, so
        // we can skip the heavy conversation/toolCalls text columns here.
        processes = await store.getAllProcesses({ exclude: ['conversation', 'toolCalls'] });
    } catch {
        return 0;
    }

    const pending = processes.filter(p => p.pendingAskUserAnswer);
    if (pending.length === 0) return 0;

    const inFlight = collectInFlightAskUserResumeProcessIds([
        ...queue.getQueued(),
        ...queue.getRunning(),
    ]);

    let enqueued = 0;
    for (const proc of pending) {
        if (inFlight.has(proc.id)) continue;
        await queue.enqueue(buildAskUserResumeTaskInput(proc));
        // Guard against double-enqueue within a single scan (defensive — the
        // store returns each process once).
        inFlight.add(proc.id);
        enqueued++;
    }
    return enqueued;
}
