import type {
  AgentProviderId,
  AgentProvidersQuotaResponse,
  ProviderQuotaResult,
  ProviderQuotaType,
} from './contracts/admin';

export interface MostConstrainedQuota {
  provider: ProviderQuotaResult;
  quotaType: ProviderQuotaType;
  remainingPercent: number;
  usedPercent: number;
}

export function getQuotaPercent(remainingPercentage: number | undefined): number {
  return Math.max(0, Math.min(100, Math.round((remainingPercentage ?? 1) * 100)));
}

export function getQuotaUsedPercent(remainingPercentage: number | undefined): number {
  return Math.max(0, Math.min(100, Math.round((1 - (remainingPercentage ?? 1)) * 100)));
}

export function getFiniteQuotaTypes(quotaTypes: readonly ProviderQuotaType[] | undefined): ProviderQuotaType[] {
  return [...(quotaTypes ?? [])].filter(quotaType => !quotaType.isUnlimitedEntitlement);
}

export function getUnlimitedQuotaTypes(quotaTypes: readonly ProviderQuotaType[] | undefined): ProviderQuotaType[] {
  return [...(quotaTypes ?? [])].filter(quotaType => quotaType.isUnlimitedEntitlement);
}

export function getTightestFiniteQuotaType(
  quotaTypes: readonly ProviderQuotaType[] | undefined,
): ProviderQuotaType | null {
  const finiteTypes = getFiniteQuotaTypes(quotaTypes);
  if (finiteTypes.length === 0) {
    return null;
  }
  return finiteTypes.reduce((best, quotaType) => {
    const remainingPercent = getQuotaPercent(quotaType.remainingPercentage);
    const bestRemainingPercent = getQuotaPercent(best.remainingPercentage);
    return remainingPercent < bestRemainingPercent ? quotaType : best;
  }, finiteTypes[0]);
}

export function getMostConstrainedProviderQuota(
  quotaData: AgentProvidersQuotaResponse | null | undefined,
  enabledProviderIds?: readonly AgentProviderId[],
): MostConstrainedQuota | null {
  const enabledSet = enabledProviderIds ? new Set(enabledProviderIds) : null;
  let mostConstrained: MostConstrainedQuota | null = null;

  for (const provider of quotaData?.providers ?? []) {
    if (provider.error) {
      continue;
    }
    if (enabledSet && !enabledSet.has(provider.id)) {
      continue;
    }
    const quotaType = getTightestFiniteQuotaType(provider.quotaTypes);
    if (!quotaType) {
      continue;
    }
    const candidate: MostConstrainedQuota = {
      provider,
      quotaType,
      remainingPercent: getQuotaPercent(quotaType.remainingPercentage),
      usedPercent: getQuotaUsedPercent(quotaType.remainingPercentage),
    };
    if (!mostConstrained || candidate.remainingPercent < mostConstrained.remainingPercent) {
      mostConstrained = candidate;
    }
  }

  return mostConstrained;
}
