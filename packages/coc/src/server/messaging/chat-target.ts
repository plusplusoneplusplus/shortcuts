/**
 * Chat-target lookups and queue wiring shared by the Teams and WhatsApp
 * messaging connectors. Reply wording stays with each connector.
 */

import type { AIProcess, ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import type { ScheduleQueueEventBus } from '../schedule/schedule-queue-await';

/** How many recent topics `list topics` shows and `select topic <n>` indexes into. */
export const TOPIC_LIST_LIMIT = 10;

const TERMINAL_TASK_EVENTS = ['taskCompleted', 'taskFailed', 'taskCancelled'] as const;

/** Parses a 1-based list position; returns 0 when `arg` is not a plain positive integer. */
export function parseListIndex(arg: string): number {
    return /^[1-9]\d*$/.test(arg) ? Number(arg) : 0;
}

/**
 * Resolves a workspace by 1-based list position, exact id, or case-insensitive name/id.
 * `strictIndex: false` keeps the legacy lenient `parseInt` index (e.g. `2nd` → 2).
 */
export function resolveWorkspace<W extends { id: string; name?: string }>(
    workspaces: readonly W[],
    nameOrIndex: string,
    strictIndex = true,
): W | undefined {
    const idx = strictIndex ? parseListIndex(nameOrIndex) : parseInt(nameOrIndex, 10);
    if (idx >= 1 && idx <= workspaces.length) return workspaces[idx - 1];
    const byId = workspaces.find(w => w.id === nameOrIndex);
    if (byId) return byId;
    const lower = nameOrIndex.toLowerCase();
    return workspaces.find(w => (w.name ?? '').toLowerCase() === lower || w.id.toLowerCase() === lower);
}

/** Last activity of a topic (last conversation event, else start time); undefined when unknown. */
export function topicActivityMs(topic: { lastEventAt?: Date | string; startTime?: Date | string }): number | undefined {
    const value = topic.lastEventAt ?? topic.startTime;
    const ms = value === undefined ? NaN : new Date(value).getTime();
    return Number.isNaN(ms) ? undefined : ms;
}

/** Stable most-recent-activity-first order for a topic page. */
export function sortTopicsByActivity<T extends { lastEventAt?: Date | string; startTime?: Date | string }>(topics: T[]): T[] {
    return topics.sort((a, b) => (topicActivityMs(b) ?? 0) - (topicActivityMs(a) ?? 0));
}

/**
 * Most recent topics for a workspace (or all workspaces), the store's bounded
 * page re-sorted by last activity. A workspace-scoped list keeps only processes that workspace owns, so list
 * positions match what {@link resolveTopic} selects.
 * Bounded and conversation-free: an unbounded `getAllProcesses` loads every turn
 * in the repo and stalls the server on large stores.
 */
export async function listRecentTopics(
    store: Pick<ProcessStore, 'getAllProcesses'>,
    workspaceId?: string,
): Promise<AIProcess[]> {
    const topics = await store.getAllProcesses({
        ...(workspaceId ? { workspaceId } : {}),
        limit: TOPIC_LIST_LIMIT,
        exclude: ['conversation', 'toolCalls'],
    });
    return sortTopicsByActivity(workspaceId ? topics.filter(topic => topic.metadata?.workspaceId === workspaceId) : topics);
}

/**
 * Resolves a topic by its position in {@link listRecentTopics}, falling back to a
 * direct process-id lookup. Callers still validate workspace ownership.
 */
export async function resolveTopic(
    store: Pick<ProcessStore, 'getAllProcesses' | 'getProcess'>,
    workspaceId: string | undefined,
    idOrIndex: string,
    strictIndex = true,
): Promise<AIProcess | undefined> {
    const arg = idOrIndex.trim();
    const idx = strictIndex ? parseListIndex(arg) : parseInt(arg, 10);
    if (idx >= 1) {
        const topic = (await listRecentTopics(store, workspaceId))[idx - 1];
        if (topic) return topic;
    }
    return store.getProcess(arg, workspaceId);
}

/** Subscribes to every terminal queue event; returns the unsubscribe function. */
export function onTaskTerminal(
    queue: Pick<ScheduleQueueEventBus, 'on' | 'off'>,
    listener: (task: QueuedTask) => void,
): () => void {
    for (const event of TERMINAL_TASK_EVENTS) queue.on(event, listener);
    return () => {
        for (const event of TERMINAL_TASK_EVENTS) queue.off(event, listener);
    };
}
