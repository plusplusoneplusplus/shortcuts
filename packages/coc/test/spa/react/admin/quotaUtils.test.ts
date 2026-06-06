import { describe, expect, it } from 'vitest';
import type { AgentProvidersQuotaResponse, ProviderQuotaType } from '@plusplusoneplusplus/coc-client';
import {
    formatQuotaTypeLabel,
    getMostConstrainedProviderQuota,
    getQuotaPercent,
    getQuotaRiskClasses,
    getQuotaUsedPercent,
    getTightestFiniteQuotaType,
} from '../../../../src/server/spa/client/react/shared/quotaUtils';

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

describe('quotaUtils', () => {
    it('formats known and unknown quota type labels', () => {
        expect(formatQuotaTypeLabel('five_hour')).toBe('5h');
        expect(formatQuotaTypeLabel('seven_day')).toBe('Weekly');
        expect(formatQuotaTypeLabel('monthly-window')).toBe('Monthly window');
        expect(formatQuotaTypeLabel('   ')).toBe('Quota');
    });

    it('clamps remaining and used percentages', () => {
        expect(getQuotaPercent(0.456)).toBe(46);
        expect(getQuotaPercent(-0.5)).toBe(0);
        expect(getQuotaPercent(1.5)).toBe(100);
        expect(getQuotaPercent(undefined)).toBe(100);
        expect(getQuotaUsedPercent(0.25)).toBe(75);
        expect(getQuotaUsedPercent(0.245)).toBe(76);
        expect(getQuotaUsedPercent(undefined)).toBe(0);
    });

    it('returns risk classes from remaining percentage thresholds', () => {
        expect(getQuotaRiskClasses(24)).toMatchObject({ badgeClass: 'ar-badge-danger', badgeLabel: 'Risk' });
        expect(getQuotaRiskClasses(49)).toMatchObject({ badgeClass: 'ar-badge-warning', badgeLabel: 'Watch' });
        expect(getQuotaRiskClasses(50)).toMatchObject({ badgeClass: 'ar-badge-success', badgeLabel: 'OK' });
    });

    it('selects the tightest finite quota and ignores unlimited pools', () => {
        const tightest = getTightestFiniteQuotaType([
            quotaType({ type: 'weekly', remainingPercentage: 0.9 }),
            quotaType({ type: 'five_hour', remainingPercentage: 0.15 }),
            quotaType({ type: 'unlimited', isUnlimitedEntitlement: true, remainingPercentage: 1 }),
        ]);

        expect(tightest?.type).toBe('five_hour');
    });

    it('selects the most constrained enabled provider quota', () => {
        const quotaData: AgentProvidersQuotaResponse = {
            lastUpdated: '2026-06-06T10:00:00.000Z',
            providers: [
                { id: 'copilot', quotaTypes: [quotaType({ type: 'chat', remainingPercentage: 0.8 })] },
                { id: 'codex', quotaTypes: [quotaType({ type: 'five_hour', remainingPercentage: 0.2 })] },
                { id: 'claude', quotaTypes: [quotaType({ type: 'seven_day', remainingPercentage: 0.1 })] },
            ],
        };

        const constrained = getMostConstrainedProviderQuota(quotaData, ['copilot', 'codex']);

        expect(constrained?.provider.id).toBe('codex');
        expect(constrained?.quotaType.type).toBe('five_hour');
        expect(constrained?.remainingPercent).toBe(20);
        expect(constrained?.usedPercent).toBe(80);
    });

    it('ignores provider errors when selecting constrained quotas', () => {
        const quotaData: AgentProvidersQuotaResponse = {
            lastUpdated: '2026-06-06T10:00:00.000Z',
            providers: [
                { id: 'codex', quotaTypes: [quotaType({ type: 'five_hour', remainingPercentage: 0.01 })], error: 'quota unavailable' },
                { id: 'claude', quotaTypes: [quotaType({ type: 'seven_day', remainingPercentage: 0.4 })] },
            ],
        };

        expect(getMostConstrainedProviderQuota(quotaData)?.provider.id).toBe('claude');
    });

    it('returns null when every provider quota is unlimited or absent', () => {
        const quotaData: AgentProvidersQuotaResponse = {
            lastUpdated: '2026-06-06T10:00:00.000Z',
            providers: [
                { id: 'copilot', quotaTypes: [quotaType({ type: 'chat', isUnlimitedEntitlement: true })] },
                { id: 'codex', quotaTypes: [] },
            ],
        };

        expect(getMostConstrainedProviderQuota(quotaData)).toBeNull();
    });
});
