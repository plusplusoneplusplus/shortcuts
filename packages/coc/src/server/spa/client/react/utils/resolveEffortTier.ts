import type { EffortTierKey, LocalEffortTiersMap } from '../hooks/useProviderEffortTiers';

/**
 * Resolves a tier key to the concrete `{ model, reasoningEffort }` values for
 * the send payload. Returns `null` when the tier has no model configured.
 */
export function resolveEffortTier(
    tier: EffortTierKey,
    tierMap: LocalEffortTiersMap,
): { model: string; reasoningEffort: string | null } | null {
    const entry = tierMap[tier];
    if (!entry?.model) return null;
    return {
        model: entry.model,
        reasoningEffort: entry.reasoningEffort || null,
    };
}

/**
 * Returns the effective tier to use given a desired tier and the current map.
 * Falls back to the first configured tier in preference order [medium, low, high]
 * when the desired tier is unconfigured, leaving the desired tier unchanged if
 * nothing is configured (the UI will show zero-tier legacy-fallback anyway).
 */
export function resolveEffectiveTier(
    desiredTier: EffortTierKey,
    tierMap: LocalEffortTiersMap,
): EffortTierKey {
    if (tierMap[desiredTier]?.model) return desiredTier;
    const fallbackOrder: EffortTierKey[] = ['medium', 'low', 'high'];
    return fallbackOrder.find(t => tierMap[t]?.model) ?? desiredTier;
}
