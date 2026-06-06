import type {
    AgentProviderId,
    AgentProvidersQuotaResponse,
    ProviderQuotaResult,
    ProviderQuotaType,
} from '@plusplusoneplusplus/coc-client';

const QUOTA_TYPE_LABELS: Record<string, string> = {
    five_hour: '5h',
    seven_day: 'Weekly',
};

export interface QuotaRiskClasses {
    barClass: string;
    badgeClass: string;
    badgeLabel: string;
}

export interface MostConstrainedQuota {
    provider: ProviderQuotaResult;
    quotaType: ProviderQuotaType;
    remainingPercent: number;
    usedPercent: number;
}

export function formatQuotaTypeLabel(type: string): string {
    const normalized = type.trim();
    const knownLabel = QUOTA_TYPE_LABELS[normalized];
    if (knownLabel) return knownLabel;
    const readable = normalized.replace(/[_-]+/g, ' ').trim();
    if (!readable) return 'Quota';
    return readable.charAt(0).toUpperCase() + readable.slice(1);
}

export function getQuotaPercent(remainingPercentage: number | undefined): number {
    return Math.max(0, Math.min(100, Math.round((remainingPercentage ?? 1) * 100)));
}

export function getQuotaUsedPercent(remainingPercentage: number | undefined): number {
    return Math.max(0, Math.min(100, Math.round((1 - (remainingPercentage ?? 1)) * 100)));
}

export function getQuotaRiskClasses(pct: number): QuotaRiskClasses {
    return {
        barClass: pct < 25 ? 'aip-bar-danger' : pct < 50 ? 'aip-bar-warning' : '',
        badgeClass: pct < 25 ? 'ar-badge-danger' : pct < 50 ? 'ar-badge-warning' : 'ar-badge-success',
        badgeLabel: pct < 25 ? 'Risk' : pct < 50 ? 'Watch' : 'OK',
    };
}

export function getFiniteQuotaTypes(quotaTypes: readonly ProviderQuotaType[] | undefined): ProviderQuotaType[] {
    return [...(quotaTypes ?? [])].filter(q => !q.isUnlimitedEntitlement);
}

export function getUnlimitedQuotaTypes(quotaTypes: readonly ProviderQuotaType[] | undefined): ProviderQuotaType[] {
    return [...(quotaTypes ?? [])].filter(q => q.isUnlimitedEntitlement);
}

export function getTightestFiniteQuotaType(quotaTypes: readonly ProviderQuotaType[] | undefined): ProviderQuotaType | null {
    const finiteTypes = getFiniteQuotaTypes(quotaTypes);
    if (finiteTypes.length === 0) return null;
    return finiteTypes.reduce((best, quotaType) => {
        const pct = getQuotaPercent(quotaType.remainingPercentage);
        const bestPct = getQuotaPercent(best.remainingPercentage);
        return pct < bestPct ? quotaType : best;
    }, finiteTypes[0]);
}

export function getMostConstrainedProviderQuota(
    quotaData: AgentProvidersQuotaResponse | null | undefined,
    enabledProviderIds?: readonly AgentProviderId[],
): MostConstrainedQuota | null {
    const enabledSet = enabledProviderIds ? new Set(enabledProviderIds) : null;
    let mostConstrained: MostConstrainedQuota | null = null;

    for (const provider of quotaData?.providers ?? []) {
        if (provider.error) continue;
        if (enabledSet && !enabledSet.has(provider.id)) continue;
        const quotaType = getTightestFiniteQuotaType(provider.quotaTypes);
        if (!quotaType) continue;
        const remainingPercent = getQuotaPercent(quotaType.remainingPercentage);
        const candidate: MostConstrainedQuota = {
            provider,
            quotaType,
            remainingPercent,
            usedPercent: getQuotaUsedPercent(quotaType.remainingPercentage),
        };
        if (!mostConstrained || candidate.remainingPercent < mostConstrained.remainingPercent) {
            mostConstrained = candidate;
        }
    }

    return mostConstrained;
}
