/**
 * Queue process ID helpers (client-side mirror of forge queue helpers).
 *
 * These are intentionally duplicated from `@plusplusoneplusplus/forge` to
 * avoid pulling in the full forge bundle in the SPA webpack build.
 */

export const QUEUE_PROCESS_PREFIX = 'queue_';

export function toQueueProcessId(taskId: string): string {
    return `${QUEUE_PROCESS_PREFIX}${taskId}`;
}

export function toTaskId(processId: string): string {
    if (!processId.startsWith(QUEUE_PROCESS_PREFIX)) {
        throw new Error(`Expected process ID to start with "${QUEUE_PROCESS_PREFIX}", got "${processId}"`);
    }
    return processId.slice(QUEUE_PROCESS_PREFIX.length);
}

export function isQueueProcessId(id: string): boolean {
    return id.startsWith(QUEUE_PROCESS_PREFIX);
}

export function ensureQueueProcessId(id: string): string {
    return id.startsWith(QUEUE_PROCESS_PREFIX) ? id : `${QUEUE_PROCESS_PREFIX}${id}`;
}
