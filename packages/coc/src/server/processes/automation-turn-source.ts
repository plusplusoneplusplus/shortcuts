import type { TurnSource } from '@plusplusoneplusplus/forge';

/** Project only trusted automation attribution from queued or buffered context. */
export function readAutomationTurnSource(context?: Record<string, unknown>): TurnSource | undefined {
    if (context?.source !== 'cron' && context?.source !== 'wakeup' && context?.source !== 'trigger') return;
    return {
        source: context.source,
        ...(typeof context.cronId === 'string' ? { cronId: context.cronId } : {}),
        ...(typeof context.wakeupId === 'string' ? { wakeupId: context.wakeupId } : {}),
        ...(typeof context.triggerId === 'string' ? { triggerId: context.triggerId } : {}),
        ...(typeof context.deliveryId === 'string' ? { deliveryId: context.deliveryId } : {}),
    };
}
