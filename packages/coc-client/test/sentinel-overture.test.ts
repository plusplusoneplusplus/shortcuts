import { describe, expect, it } from 'vitest';
import { isDeliveredSentinelOverture, type Trigger } from '../src';

const delivery = (state: 'pending' | 'delivered' | 'failed'): Trigger['delivery'] => ({
  deliveryId: 'd1', firedAt: '2026-10-26T15:00:00.000Z', reason: 'merged', state,
});
const binding: Trigger['binding'] = { kind: 'sentinel-todo', itemId: 'i1', armedBy: 'sentinel', armedAt: '2026-10-26T14:54:00.000Z' };

describe('isDeliveredSentinelOverture', () => {
  it('matches only fired overtures whose wake was delivered', () => {
    expect(isDeliveredSentinelOverture({ binding, outcome: 'fired', delivery: delivery('delivered') })).toBe(true);
  });
  it.each([
    ['delivery pending', { binding, outcome: 'fired', delivery: delivery('pending') }],
    ['delivery failed', { binding, outcome: 'error', delivery: delivery('failed') }],
    ['fired without receipt', { binding, outcome: 'fired' }],
    ['skipped', { binding, outcome: 'skipped' }],
    ['error', { binding, outcome: 'error', delivery: delivery('delivered') }],
    ['still waiting', { binding }],
    ['delegated PR outcome review', { binding: { ...binding, delegatedPr: { jobId: 'j', receiptId: 'r' } }, outcome: 'fired', delivery: delivery('delivered') }],
    ['unbound trigger', { outcome: 'fired', delivery: delivery('delivered') }],
  ] as const)('keeps %s visible', (_name, trigger) => {
    expect(isDeliveredSentinelOverture(trigger as Pick<Trigger, 'binding' | 'outcome' | 'delivery'>)).toBe(false);
  });
});
