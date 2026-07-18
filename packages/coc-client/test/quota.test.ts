import { describe, expect, it } from 'vitest';
import type { AgentProvidersQuotaResponse, ProviderQuotaType } from '../src';
import {
  getFiniteQuotaTypes,
  getMostConstrainedProviderQuota,
  getQuotaPercent,
  getQuotaUsedPercent,
  getTightestFiniteQuotaType,
  getUnlimitedQuotaTypes,
} from '../src';

function quotaType(overrides: Partial<ProviderQuotaType> & { type: string }): ProviderQuotaType {
  return {
    type: overrides.type,
    isUnlimitedEntitlement: overrides.isUnlimitedEntitlement ?? false,
    usedRequests: overrides.usedRequests ?? 0,
    entitlementRequests: overrides.entitlementRequests ?? 100,
    remainingPercentage: overrides.remainingPercentage ?? 1,
    usageAllowedWithExhaustedQuota: overrides.usageAllowedWithExhaustedQuota ?? false,
    overage: overrides.overage ?? 0,
    resetDate: overrides.resetDate,
  };
}

describe('quota math', () => {
  it('clamps rounded display percentages', () => {
    expect(getQuotaPercent(0.456)).toBe(46);
    expect(getQuotaPercent(-0.5)).toBe(0);
    expect(getQuotaPercent(1.5)).toBe(100);
    expect(getQuotaPercent(undefined)).toBe(100);
    expect(getQuotaUsedPercent(0.245)).toBe(76);
    expect(getQuotaUsedPercent(undefined)).toBe(0);
  });

  it('separates finite and unlimited quota types without mutating the input', () => {
    const finite = quotaType({ type: 'five_hour', remainingPercentage: 0.2 });
    const unlimited = quotaType({ type: 'unlimited', isUnlimitedEntitlement: true });
    const quotaTypes = Object.freeze([unlimited, finite]);

    expect(getFiniteQuotaTypes(quotaTypes)).toEqual([finite]);
    expect(getUnlimitedQuotaTypes(quotaTypes)).toEqual([unlimited]);
    expect(quotaTypes).toEqual([unlimited, finite]);
  });

  it('keeps the first quota when raw fractions round to the same display percent', () => {
    const first = quotaType({ type: 'weekly', remainingPercentage: 0.204 });
    const second = quotaType({ type: 'five_hour', remainingPercentage: 0.199 });

    expect(getTightestFiniteQuotaType([first, second])).toBe(first);
  });

  it('ignores unlimited quotas and keeps the first exact tie', () => {
    const first = quotaType({ type: 'five_hour', remainingPercentage: 0.2 });
    const second = quotaType({ type: 'weekly', remainingPercentage: 0.2 });
    const unlimited = quotaType({ type: 'unlimited', isUnlimitedEntitlement: true, remainingPercentage: 0 });

    expect(getTightestFiniteQuotaType([first, second, unlimited])).toBe(first);
    expect(getTightestFiniteQuotaType([unlimited])).toBeNull();
    expect(getTightestFiniteQuotaType(undefined)).toBeNull();
  });

  it('selects the most constrained enabled, readable provider and preserves raw quota metadata', () => {
    const codexQuota = quotaType({
      type: 'five_hour',
      remainingPercentage: 0.204,
      resetDate: '2026-07-19T00:00:00.000Z',
    });
    const claudeQuota = quotaType({
      type: 'seven_day',
      remainingPercentage: 0.189,
      usageAllowedWithExhaustedQuota: true,
      resetDate: '2026-07-20T00:00:00.000Z',
    });
    const claudeProvider = { id: 'claude' as const, quotaTypes: [claudeQuota] };
    const quotaData: AgentProvidersQuotaResponse = {
      lastUpdated: '2026-07-18T22:00:00.000Z',
      providers: [
        { id: 'copilot', quotaTypes: [quotaType({ type: 'chat', remainingPercentage: 0.01 })] },
        { id: 'codex', quotaTypes: [codexQuota] },
        claudeProvider,
      ],
    };

    const constrained = getMostConstrainedProviderQuota(quotaData, ['codex', 'claude']);

    expect(constrained?.provider).toBe(claudeProvider);
    expect(constrained?.quotaType).toBe(claudeQuota);
    expect(constrained?.quotaType.usageAllowedWithExhaustedQuota).toBe(true);
    expect(constrained?.quotaType.resetDate).toBe('2026-07-20T00:00:00.000Z');
    expect(constrained?.remainingPercent).toBe(19);
    expect(constrained?.usedPercent).toBe(81);
  });

  it('ignores provider errors when selecting across all providers', () => {
    const readableProvider = {
      id: 'claude' as const,
      quotaTypes: [quotaType({ type: 'seven_day', remainingPercentage: 0.4 })],
    };
    const quotaData: AgentProvidersQuotaResponse = {
      lastUpdated: null,
      providers: [
        {
          id: 'codex',
          quotaTypes: [quotaType({ type: 'five_hour', remainingPercentage: 0.01 })],
          error: 'quota unavailable',
        },
        readableProvider,
      ],
    };

    expect(getMostConstrainedProviderQuota(quotaData)?.provider).toBe(readableProvider);
  });

  it('honors an empty provider scope and returns null without usable finite quotas', () => {
    const quotaData: AgentProvidersQuotaResponse = {
      lastUpdated: null,
      providers: [
        { id: 'codex', quotaTypes: [quotaType({ type: 'five_hour', remainingPercentage: 0.1 })] },
      ],
    };

    expect(getMostConstrainedProviderQuota(quotaData, [])).toBeNull();
    expect(getMostConstrainedProviderQuota(undefined)).toBeNull();
    expect(getMostConstrainedProviderQuota({
      lastUpdated: null,
      providers: [{ id: 'codex', quotaTypes: [quotaType({ type: 'unlimited', isUnlimitedEntitlement: true })] }],
    })).toBeNull();
  });
});
