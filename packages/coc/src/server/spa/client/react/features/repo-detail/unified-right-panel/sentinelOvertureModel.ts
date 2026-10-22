import type { SentinelTodoItem, Trigger } from '@plusplusoneplusplus/coc-client';
import { sentinelTodoType } from './sentinelTodoPanelModel';

export function eligibleTriggerItems(items: readonly SentinelTodoItem[]) {
    return items.filter(item => sentinelTodoType(item) === 'normal' && !item.archived && item.status !== 'done');
}

export function isTerminalTrigger(trigger: Trigger) {
    return !!trigger.outcome || trigger.status === 'disarmed' || trigger.status === 'expired';
}

export function triggerError(error: unknown): { message: string; conflict: boolean } {
    const detail = error as { message?: unknown; status?: number; code?: string; body?: { current?: unknown } } | null;
    const message = typeof detail?.message === 'string' && detail.message ? detail.message : 'Could not update overtures.';
    const conflict = detail?.code === 'conflict' || detail?.status === 409
        && (!!detail.body?.current || /conflict|changed|terminal/i.test(message));
    return { message, conflict };
}
