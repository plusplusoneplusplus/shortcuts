import type { ProcessStore, ProcessHistoryOptions } from '@plusplusoneplusplus/forge';
import { isQueueProcessId, toTaskId } from '@plusplusoneplusplus/forge';
import { badRequest } from '../errors';

function readInteger(query: URLSearchParams, key: string, min: number, max: number): number | undefined {
    const values = query.getAll(key);
    if (values.length === 0) return undefined;
    const raw = values[0];
    const value = Number(raw);
    if (values.length !== 1 || !/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
        throw badRequest(`${key} must be an integer between ${min} and ${max}`);
    }
    return value;
}

export function parseChatHistoryQuery(query: URLSearchParams, initial = false): ProcessHistoryOptions {
    return {
        limit: readInteger(query, initial ? 'turnsLimit' : 'limit', 1, 200),
        ...(initial ? {} : { beforeTurnIndex: readInteger(query, 'beforeTurnIndex', 0, Number.MAX_SAFE_INTEGER) }),
    };
}

/** Queue-prefix compatibility stays on the owning store, never another server. */
export async function readChatHistory(
    store: Pick<ProcessStore, 'getProcessHistory'>,
    id: string,
    workspaceId?: string,
    options?: ProcessHistoryOptions,
): ReturnType<ProcessStore['getProcessHistory']> {
    const result = await store.getProcessHistory(id, workspaceId, options);
    if (result) return result;
    return isQueueProcessId(id)
        ? store.getProcessHistory(toTaskId(id), workspaceId, options)
        : undefined;
}
