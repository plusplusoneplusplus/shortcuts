export {
    getFiniteQuotaTypes,
    getMostConstrainedProviderQuota,
    getQuotaPercent,
    getQuotaUsedPercent,
    getTightestFiniteQuotaType,
    getUnlimitedQuotaTypes,
} from '@plusplusoneplusplus/coc-client';
export type { MostConstrainedQuota } from '@plusplusoneplusplus/coc-client';

const QUOTA_TYPE_LABELS: Record<string, string> = {
    five_hour: '5h',
    seven_day: 'Weekly',
};

export interface QuotaRiskClasses {
    barClass: string;
    badgeClass: string;
    badgeLabel: string;
}

export function formatQuotaTypeLabel(type: string): string {
    const normalized = type.trim();
    const knownLabel = QUOTA_TYPE_LABELS[normalized];
    if (knownLabel) return knownLabel;
    const readable = normalized.replace(/[_-]+/g, ' ').trim();
    if (!readable) return 'Quota';
    return readable.charAt(0).toUpperCase() + readable.slice(1);
}

export function getQuotaRiskClasses(pct: number): QuotaRiskClasses {
    return {
        barClass: pct < 25 ? 'aip-bar-danger' : pct < 50 ? 'aip-bar-warning' : '',
        badgeClass: pct < 25 ? 'ar-badge-danger' : pct < 50 ? 'ar-badge-warning' : 'ar-badge-success',
        badgeLabel: pct < 25 ? 'Risk' : pct < 50 ? 'Watch' : 'OK',
    };
}
