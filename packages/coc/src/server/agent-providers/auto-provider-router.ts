import type { AgentProvidersQuotaResponse, ProviderQuotaResult, ProviderQuotaType } from '@plusplusoneplusplus/coc-client';
import type { ConcreteAgentProvider, ResolvedCLIConfig } from '../../config';

const PROVIDERS: readonly ConcreteAgentProvider[] = ['copilot', 'codex', 'claude', 'opencode'];
const WEEKLY_QUOTA_TYPE_ALIASES = new Set([
    'seven_day',
    '7_day',
    '7day',
    '7d',
    'week',
    'weekly',
    'weekly_quota',
    'seven-day',
]);

export interface AutoProviderAvailability {
    enabled: boolean;
    available: boolean;
    error?: string;
    reason?: string;
}

export type AutoProviderAvailabilityMap = Partial<Record<ConcreteAgentProvider, AutoProviderAvailability>>;

export type AutoProviderCheckStatus =
    | 'passed'
    | 'failed'
    | 'disabled'
    | 'missing'
    | 'not_checked'
    | 'unlimited';

export interface AutoProviderQuotaCheck {
    status: AutoProviderCheckStatus;
    minimumRemainingPercent: number;
    remainingPercent?: number;
    quotaType?: string;
    quotaTypes?: string[];
    reason: string;
}

export interface AutoProviderRuleDecision {
    provider: ConcreteAgentProvider;
    ruleEnabled: boolean;
    providerEnabled: boolean;
    providerAvailable: boolean;
    eligible: boolean;
    selected: boolean;
    reason: string;
    availabilityReason?: string;
    normalThreshold: AutoProviderQuotaCheck;
    weeklyGuard: AutoProviderQuotaCheck & { enabled: boolean };
    warnings: string[];
}

export interface AutoProviderFallbackDecision {
    provider: ConcreteAgentProvider;
    used: boolean;
    providerEnabled: boolean;
    providerAvailable: boolean;
    reason: string;
    warnings: string[];
}

export interface AutoProviderResolutionResult {
    provider?: ConcreteAgentProvider;
    selectedByAuto: boolean;
    fallbackUsed: boolean;
    error?: string;
    decisions: AutoProviderRuleDecision[];
    fallback?: AutoProviderFallbackDecision;
    warnings: string[];
}

export interface ResolveAutoProviderOptions {
    providerAvailability: AutoProviderAvailabilityMap;
    quotaData?: AgentProvidersQuotaResponse | null;
    quotaStale?: boolean;
}

type AutoRoutingConfig = ResolvedCLIConfig['agentProviderRouting']['auto'];
type AutoRoutingRule = AutoRoutingConfig['rules'][number];

export function resolveDefaultAgentProvider(
    config: Pick<ResolvedCLIConfig, 'defaultProvider' | 'features' | 'agentProviderRouting'>,
    options: ResolveAutoProviderOptions,
): AutoProviderResolutionResult {
    if (config.features.autoAgentProviderRouting !== true) {
        return {
            provider: config.defaultProvider,
            selectedByAuto: false,
            fallbackUsed: false,
            decisions: [],
            warnings: [],
        };
    }

    return resolveAutoAgentProvider(config.agentProviderRouting.auto, options);
}

export function resolveAutoAgentProvider(
    routing: AutoRoutingConfig,
    options: ResolveAutoProviderOptions,
): AutoProviderResolutionResult {
    const warnings = buildQuotaFreshnessWarnings(options);
    const decisions: AutoProviderRuleDecision[] = [];

    for (const rule of routing.rules) {
        const decision = evaluateRule(rule, options);
        decisions.push(decision);
        if (decision.eligible) {
            decision.selected = true;
            return {
                provider: rule.provider,
                selectedByAuto: true,
                fallbackUsed: false,
                decisions,
                warnings: [...warnings, ...decision.warnings],
            };
        }
    }

    const fallback = evaluateFallback(routing.fallbackProvider, options);
    const fallbackWarnings = [...warnings, ...fallback.warnings];
    if (fallback.providerEnabled && fallback.providerAvailable) {
        fallback.used = true;
        fallback.reason = `No auto provider rule passed; using fallback provider '${fallback.provider}'.`;
        return {
            provider: fallback.provider,
            selectedByAuto: true,
            fallbackUsed: true,
            decisions,
            fallback,
            warnings: fallbackWarnings,
        };
    }

    const candidateReasons = decisions
        .map(decision => `${decision.provider}: ${decision.reason}`)
        .join('; ');
    return {
        selectedByAuto: true,
        fallbackUsed: false,
        decisions,
        fallback,
        warnings: fallbackWarnings,
        error: `Auto provider routing failed. ${candidateReasons}; fallback ${fallback.provider}: ${fallback.reason}`,
    };
}

function evaluateRule(rule: AutoRoutingRule, options: ResolveAutoProviderOptions): AutoProviderRuleDecision {
    const state = getProviderState(rule.provider, options.providerAvailability);
    const weeklyGuardEnabled = rule.weeklyGuard.enabled;
    const notCheckedNormal = quotaNotChecked(rule.minimumRemainingPercent);
    const notCheckedWeekly = {
        ...quotaNotChecked(rule.weeklyGuard.minimumRemainingPercent),
        enabled: weeklyGuardEnabled,
    };

    if (!rule.enabled) {
        return {
            provider: rule.provider,
            ruleEnabled: false,
            providerEnabled: state.enabled,
            providerAvailable: state.available,
            eligible: false,
            selected: false,
            reason: 'Routing rule is disabled.',
            availabilityReason: availabilityReason(state),
            normalThreshold: notCheckedNormal,
            weeklyGuard: notCheckedWeekly,
            warnings: [],
        };
    }

    if (!state.enabled) {
        return {
            provider: rule.provider,
            ruleEnabled: true,
            providerEnabled: false,
            providerAvailable: state.available,
            eligible: false,
            selected: false,
            reason: 'Provider is disabled.',
            availabilityReason: availabilityReason(state),
            normalThreshold: notCheckedNormal,
            weeklyGuard: notCheckedWeekly,
            warnings: [],
        };
    }

    if (!state.available) {
        return {
            provider: rule.provider,
            ruleEnabled: true,
            providerEnabled: true,
            providerAvailable: false,
            eligible: false,
            selected: false,
            reason: availabilityReason(state) ?? 'Provider is unavailable.',
            availabilityReason: availabilityReason(state),
            normalThreshold: notCheckedNormal,
            weeklyGuard: notCheckedWeekly,
            warnings: [],
        };
    }

    const quota = getProviderQuota(options.quotaData, rule.provider);
    const normalThreshold = evaluateNormalThreshold(quota, rule.minimumRemainingPercent);
    const weeklyGuard = evaluateWeeklyGuard(quota, rule.weeklyGuard.enabled, rule.weeklyGuard.minimumRemainingPercent);
    const warnings = weeklyGuard.status === 'missing' && weeklyGuard.enabled ? [weeklyGuard.reason] : [];

    if (normalThreshold.status !== 'passed' && normalThreshold.status !== 'unlimited') {
        return {
            provider: rule.provider,
            ruleEnabled: true,
            providerEnabled: true,
            providerAvailable: true,
            eligible: false,
            selected: false,
            reason: normalThreshold.reason,
            normalThreshold,
            weeklyGuard,
            warnings,
        };
    }

    if (weeklyGuard.status === 'failed') {
        return {
            provider: rule.provider,
            ruleEnabled: true,
            providerEnabled: true,
            providerAvailable: true,
            eligible: false,
            selected: false,
            reason: weeklyGuard.reason,
            normalThreshold,
            weeklyGuard,
            warnings,
        };
    }

    return {
        provider: rule.provider,
        ruleEnabled: true,
        providerEnabled: true,
        providerAvailable: true,
        eligible: true,
        selected: false,
        reason: 'Provider passed availability, normal quota, and weekly guard checks.',
        normalThreshold,
        weeklyGuard,
        warnings,
    };
}

function evaluateFallback(
    provider: ConcreteAgentProvider,
    options: ResolveAutoProviderOptions,
): AutoProviderFallbackDecision {
    const state = getProviderState(provider, options.providerAvailability);
    const quota = getProviderQuota(options.quotaData, provider);
    const warnings = quotaHasUsableData(quota)
        ? []
        : [`Fallback provider '${provider}' is being considered without usable quota data.`];
    const reason = !state.enabled
        ? 'Fallback provider is disabled.'
        : !state.available
            ? availabilityReason(state) ?? 'Fallback provider is unavailable.'
            : `Fallback provider '${provider}' is enabled and available.`;

    return {
        provider,
        used: false,
        providerEnabled: state.enabled,
        providerAvailable: state.available,
        reason,
        warnings,
    };
}

function evaluateNormalThreshold(
    quota: ProviderQuotaResult | undefined,
    minimumRemainingPercent: number,
): AutoProviderQuotaCheck {
    if (!quota || quota.error || quota.quotaTypes.length === 0) {
        return {
            status: 'missing',
            minimumRemainingPercent,
            reason: quota?.error
                ? `Provider quota unavailable: ${quota.error}`
                : 'Provider has no quota data; normal routing rules require quota data.',
        };
    }

    const finite = getFiniteQuotaTypes(quota.quotaTypes);
    if (finite.length === 0 && quota.quotaTypes.some(type => type.isUnlimitedEntitlement)) {
        return {
            status: 'unlimited',
            minimumRemainingPercent,
            quotaTypes: quota.quotaTypes.map(type => type.type),
            reason: 'Provider has only unlimited quota pools.',
        };
    }

    const tightest = getTightestQuotaType(finite);
    if (!tightest) {
        return {
            status: 'missing',
            minimumRemainingPercent,
            quotaTypes: quota.quotaTypes.map(type => type.type),
            reason: 'Provider has no usable finite quota data.',
        };
    }

    const remainingPercent = toWholePercent(tightest.remainingPercentage);
    const passed = tightest.remainingPercentage >= minimumRemainingPercent / 100;
    return {
        status: passed ? 'passed' : 'failed',
        minimumRemainingPercent,
        remainingPercent,
        quotaType: tightest.type,
        quotaTypes: finite.map(type => type.type),
        reason: passed
            ? `Tightest quota '${tightest.type}' has ${remainingPercent}% remaining, meeting the ${minimumRemainingPercent}% minimum.`
            : `Tightest quota '${tightest.type}' has ${remainingPercent}% remaining, below the ${minimumRemainingPercent}% minimum.`,
    };
}

function evaluateWeeklyGuard(
    quota: ProviderQuotaResult | undefined,
    enabled: boolean,
    minimumRemainingPercent: number,
): AutoProviderQuotaCheck & { enabled: boolean } {
    if (!enabled) {
        return {
            enabled,
            status: 'disabled',
            minimumRemainingPercent,
            reason: 'Weekly guard is disabled for this provider.',
        };
    }

    if (!quota || quota.error || quota.quotaTypes.length === 0) {
        return {
            enabled,
            status: 'missing',
            minimumRemainingPercent,
            reason: quota?.error
                ? `Weekly guard could not inspect provider quota: ${quota.error}`
                : 'Weekly guard enabled but provider has no weekly quota snapshot; falling back to the normal threshold.',
        };
    }

    const weekly = quota.quotaTypes.filter(type => isWeeklyQuotaType(type.type));
    if (weekly.length === 0) {
        return {
            enabled,
            status: 'missing',
            minimumRemainingPercent,
            reason: 'Weekly guard enabled but provider has no weekly quota snapshot; falling back to the normal threshold.',
        };
    }

    const finite = getFiniteQuotaTypes(weekly);
    if (finite.length === 0 && weekly.some(type => type.isUnlimitedEntitlement)) {
        return {
            enabled,
            status: 'unlimited',
            minimumRemainingPercent,
            quotaTypes: weekly.map(type => type.type),
            reason: 'Weekly quota snapshot is unlimited.',
        };
    }

    const tightest = getTightestQuotaType(finite);
    if (!tightest) {
        return {
            enabled,
            status: 'missing',
            minimumRemainingPercent,
            quotaTypes: weekly.map(type => type.type),
            reason: 'Weekly guard enabled but provider has no usable weekly quota snapshot; falling back to the normal threshold.',
        };
    }

    const remainingPercent = toWholePercent(tightest.remainingPercentage);
    const passed = tightest.remainingPercentage >= minimumRemainingPercent / 100;
    return {
        enabled,
        status: passed ? 'passed' : 'failed',
        minimumRemainingPercent,
        remainingPercent,
        quotaType: tightest.type,
        quotaTypes: weekly.map(type => type.type),
        reason: passed
            ? `Weekly quota '${tightest.type}' has ${remainingPercent}% remaining, meeting the ${minimumRemainingPercent}% guard.`
            : `Weekly quota '${tightest.type}' has ${remainingPercent}% remaining, below the ${minimumRemainingPercent}% guard.`,
    };
}

function getProviderState(
    provider: ConcreteAgentProvider,
    availability: AutoProviderAvailabilityMap,
): AutoProviderAvailability {
    const state = availability[provider];
    if (state) {
        return state;
    }
    if (provider === 'copilot') {
        return { enabled: true, available: true };
    }
    return {
        enabled: false,
        available: false,
        reason: 'Provider status is unavailable.',
    };
}

function getProviderQuota(
    quotaData: AgentProvidersQuotaResponse | null | undefined,
    provider: ConcreteAgentProvider,
): ProviderQuotaResult | undefined {
    return quotaData?.providers.find(entry => entry.id === provider);
}

function getFiniteQuotaTypes(quotaTypes: readonly ProviderQuotaType[]): ProviderQuotaType[] {
    return quotaTypes.filter(type => !type.isUnlimitedEntitlement && Number.isFinite(type.remainingPercentage));
}

function getTightestQuotaType(quotaTypes: readonly ProviderQuotaType[]): ProviderQuotaType | undefined {
    return [...quotaTypes].sort((a, b) => a.remainingPercentage - b.remainingPercentage)[0];
}

function quotaHasUsableData(quota: ProviderQuotaResult | undefined): boolean {
    if (!quota || quota.error || quota.quotaTypes.length === 0) {
        return false;
    }
    return quota.quotaTypes.some(type => type.isUnlimitedEntitlement || Number.isFinite(type.remainingPercentage));
}

function quotaNotChecked(minimumRemainingPercent: number): AutoProviderQuotaCheck {
    return {
        status: 'not_checked',
        minimumRemainingPercent,
        reason: 'Quota was not checked because provider priority, enabled state, or availability failed first.',
    };
}

function isWeeklyQuotaType(type: string): boolean {
    return WEEKLY_QUOTA_TYPE_ALIASES.has(type.trim().toLowerCase());
}

function toWholePercent(value: number): number {
    return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

function availabilityReason(state: AutoProviderAvailability): string | undefined {
    return state.error ?? state.reason;
}

function buildQuotaFreshnessWarnings(options: ResolveAutoProviderOptions): string[] {
    const warnings: string[] = [];
    if (!options.quotaData) {
        warnings.push('Quota cache is missing; normal auto routing rules require quota data.');
    } else if (options.quotaStale) {
        const suffix = options.quotaData.lastUpdated ? ` Last updated: ${options.quotaData.lastUpdated}.` : '';
        warnings.push(`Quota cache is stale; selection used the cached provider quota snapshot.${suffix}`);
    }
    return warnings;
}

export function isConcreteAgentProvider(value: unknown): value is ConcreteAgentProvider {
    return PROVIDERS.includes(value as ConcreteAgentProvider);
}
