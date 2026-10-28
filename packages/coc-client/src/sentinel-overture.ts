import type { Trigger } from './contracts/triggers';

/**
 * A fired overture whose wake message was admitted needs no attention, so owner
 * lists hide it like Clear does. The stored record and its delivery receipt stay
 * for dedupe; pending, failed, skipped and error results remain visible.
 */
export function isDeliveredSentinelOverture(trigger: Pick<Trigger, 'binding' | 'outcome' | 'delivery'>): boolean {
  return trigger.binding?.kind === 'sentinel-todo' && !trigger.binding.delegatedPr
    && trigger.outcome === 'fired' && trigger.delivery?.state === 'delivered';
}
