import { describe, expect, it } from 'vitest';
import type { AgentProvidersQuotaResponse, ProviderQuotaType } from '@plusplusoneplusplus/coc-client';
import type { ConcreteAgentProvider, ResolvedCLIConfig } from '../../../src/config';
import { DEFAULT_CONFIG } from '../../../src/config';
import {
    resolveAutoAgentProvider,
    resolveDefaultAgentProvider,
    type AutoProviderAvailabilityMap,
} from '../../../src/server/agent-providers/auto-provider-router';

function config(overrides: Partial<ResolvedCLIConfig> = {}): ResolvedCLIConfig {
    return {
        ...DEFAULT_CONFIG,
        features: {
            ...DEFAULT_CONFIG.features,
            autoAgentProviderRouting: true,
            ...overrides.features,
        },
        defaultProvider: overrides.defaultProvider ?? 'auto',
        agentProviderRouting: overrides.agentProviderRouting ?? DEFAULT_CONFIG.agentProviderRouting,
    };
}

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

function quota(
    providers: Partial<Record<ConcreteAgentProvider, ProviderQuotaType[]>>,
    errors: Partial<Record<ConcreteAgentProvider, string>> = {},
): AgentProvidersQuotaResponse {
    return {
        lastUpdated: '2026-06-06T10:00:00.000Z',
        providers: Object.entries(providers).map(([id, quotaTypes]) => ({
            id: id as ConcreteAgentProvider,
            quotaTypes: quotaTypes ?? [],
            ...(errors[id as ConcreteAgentProvider] ? { error: errors[id as ConcreteAgentProvider] } : {}),
        })),
    };
}

function availability(overrides: AutoProviderAvailabilityMap = {}): AutoProviderAvailabilityMap {
    return {
        copilot: { enabled: true, available: true },
        codex: { enabled: true, available: true },
        claude: { enabled: true, available: true },
        ...overrides,
    };
}

describe('auto provider router', () => {
    it('returns concrete defaults without invoking auto routing', () => {
        const result = resolveDefaultAgentProvider(
            config({ defaultProvider: 'codex' }),
            { providerAvailability: availability(), quotaData: null },
        );

        expect(result).toMatchObject({
            provider: 'codex',
            selectedByAuto: false,
            fallbackUsed: false,
            decisions: [],
            warnings: [],
        });
    });

    it('rejects defaultProvider auto when the feature flag is disabled at runtime', () => {
        const result = resolveDefaultAgentProvider(
            config({
                defaultProvider: 'auto',
                features: { ...DEFAULT_CONFIG.features, autoAgentProviderRouting: false },
            }),
            { providerAvailability: availability(), quotaData: null },
        );

        expect(result.provider).toBeUndefined();
        expect(result.error).toBe('defaultProvider "auto" requires features.autoAgentProviderRouting: true');
    });

    it('chooses the first eligible provider by priority using the tightest finite quota pool', () => {
        const result = resolveDefaultAgentProvider(
            config(),
            {
                providerAvailability: availability(),
                quotaData: quota({
                    claude: [
                        quotaType({ type: 'five_hour', remainingPercentage: 0.4 }),
                        quotaType({ type: 'seven_day', remainingPercentage: 0.2 }),
                    ],
                    codex: [
                        quotaType({ type: 'five_hour', remainingPercentage: 0.5 }),
                        quotaType({ type: 'seven_day', remainingPercentage: 0.8 }),
                    ],
                    copilot: [quotaType({ type: 'chat', remainingPercentage: 0.9 })],
                }),
            },
        );

        expect(result.provider).toBe('codex');
        expect(result.fallbackUsed).toBe(false);
        expect(result.decisions.map(decision => decision.provider)).toEqual(['claude', 'codex']);
        expect(result.decisions[0].normalThreshold).toMatchObject({
            status: 'failed',
            quotaType: 'seven_day',
            remainingPercent: 20,
        });
        expect(result.decisions[1].normalThreshold).toMatchObject({
            status: 'passed',
            quotaType: 'five_hour',
            remainingPercent: 50,
        });
    });

    it('skips disabled rules and unavailable providers before quota checks', () => {
        const result = resolveAutoAgentProvider(
            {
                fallbackProvider: 'copilot',
                rules: [
                    {
                        provider: 'claude',
                        enabled: false,
                        minimumRemainingPercent: 25,
                        weeklyGuard: { enabled: true, minimumRemainingPercent: 25 },
                    },
                    {
                        provider: 'codex',
                        enabled: true,
                        minimumRemainingPercent: 25,
                        weeklyGuard: { enabled: true, minimumRemainingPercent: 25 },
                    },
                    {
                        provider: 'copilot',
                        enabled: true,
                        minimumRemainingPercent: 10,
                        weeklyGuard: { enabled: false, minimumRemainingPercent: 10 },
                    },
                ],
            },
            {
                providerAvailability: availability({
                    codex: { enabled: true, available: false, error: 'Codex SDK missing' },
                }),
                quotaData: quota({
                    claude: [quotaType({ type: 'five_hour', remainingPercentage: 1 })],
                    codex: [quotaType({ type: 'five_hour', remainingPercentage: 1 })],
                    copilot: [quotaType({ type: 'chat', remainingPercentage: 0.8 })],
                }),
            },
        );

        expect(result.provider).toBe('copilot');
        expect(result.decisions[0]).toMatchObject({
            provider: 'claude',
            eligible: false,
            normalThreshold: { status: 'not_checked' },
        });
        expect(result.decisions[1]).toMatchObject({
            provider: 'codex',
            eligible: false,
            reason: 'Codex SDK missing',
            normalThreshold: { status: 'not_checked' },
        });
    });

    it('treats unlimited quota pools as passing normal and weekly checks', () => {
        const result = resolveAutoAgentProvider(
            {
                fallbackProvider: 'copilot',
                rules: [
                    {
                        provider: 'claude',
                        enabled: true,
                        minimumRemainingPercent: 90,
                        weeklyGuard: { enabled: true, minimumRemainingPercent: 90 },
                    },
                ],
            },
            {
                providerAvailability: availability(),
                quotaData: quota({
                    claude: [
                        quotaType({ type: 'five_hour', isUnlimitedEntitlement: true }),
                        quotaType({ type: 'seven_day', isUnlimitedEntitlement: true }),
                    ],
                }),
            },
        );

        expect(result.provider).toBe('claude');
        expect(result.decisions[0].normalThreshold.status).toBe('unlimited');
        expect(result.decisions[0].weeklyGuard.status).toBe('unlimited');
    });

    it('uses fallback with warnings when no rule has quota data', () => {
        const result = resolveAutoAgentProvider(
            {
                fallbackProvider: 'copilot',
                rules: [
                    {
                        provider: 'claude',
                        enabled: true,
                        minimumRemainingPercent: 25,
                        weeklyGuard: { enabled: true, minimumRemainingPercent: 25 },
                    },
                ],
            },
            {
                providerAvailability: availability(),
                quotaData: quota({
                    copilot: [],
                    claude: [],
                }),
            },
        );

        expect(result.provider).toBe('copilot');
        expect(result.fallbackUsed).toBe(true);
        expect(result.decisions[0].normalThreshold.status).toBe('missing');
        expect(result.warnings).toContain("Fallback provider 'copilot' is being considered without usable quota data.");
    });

    it('fails fast when no rule passes and fallback is unavailable', () => {
        const result = resolveAutoAgentProvider(
            {
                fallbackProvider: 'copilot',
                rules: [
                    {
                        provider: 'claude',
                        enabled: true,
                        minimumRemainingPercent: 25,
                        weeklyGuard: { enabled: false, minimumRemainingPercent: 25 },
                    },
                ],
            },
            {
                providerAvailability: availability({
                    copilot: { enabled: true, available: false, error: 'Copilot auth expired' },
                }),
                quotaData: quota({
                    claude: [quotaType({ type: 'five_hour', remainingPercentage: 0.1 })],
                    copilot: [quotaType({ type: 'chat', remainingPercentage: 1 })],
                }),
            },
        );

        expect(result.provider).toBeUndefined();
        expect(result.error).toContain("claude: Tightest quota 'five_hour' has 10% remaining");
        expect(result.error).toContain('fallback copilot: Copilot auth expired');
    });

    it('enforces weekly guardrails even when normal quota passes', () => {
        const result = resolveDefaultAgentProvider(
            config(),
            {
                providerAvailability: availability(),
                quotaData: quota({
                    claude: [
                        quotaType({ type: 'five_hour', remainingPercentage: 0.9 }),
                        quotaType({ type: 'seven_day', remainingPercentage: 0.24 }),
                    ],
                    codex: [
                        quotaType({ type: 'five_hour', remainingPercentage: 0.9 }),
                        quotaType({ type: 'seven_day', remainingPercentage: 0.9 }),
                    ],
                }),
            },
        );

        expect(result.provider).toBe('codex');
        expect(result.decisions[0]).toMatchObject({
            provider: 'claude',
            eligible: false,
            weeklyGuard: {
                status: 'failed',
                quotaType: 'seven_day',
                remainingPercent: 24,
            },
        });
    });

    it('allows normal routing and records a warning when weekly guard data is missing', () => {
        const result = resolveAutoAgentProvider(
            {
                fallbackProvider: 'copilot',
                rules: [
                    {
                        provider: 'claude',
                        enabled: true,
                        minimumRemainingPercent: 25,
                        weeklyGuard: { enabled: true, minimumRemainingPercent: 25 },
                    },
                ],
            },
            {
                providerAvailability: availability(),
                quotaData: quota({
                    claude: [quotaType({ type: 'five_hour', remainingPercentage: 0.9 })],
                }),
            },
        );

        expect(result.provider).toBe('claude');
        expect(result.decisions[0].weeklyGuard.status).toBe('missing');
        expect(result.warnings).toContain(
            'Weekly guard enabled but provider has no weekly quota snapshot; falling back to the normal threshold.',
        );
    });

    it('records stale and missing quota cache warnings for observability', () => {
        const stale = resolveAutoAgentProvider(
            {
                fallbackProvider: 'copilot',
                rules: [
                    {
                        provider: 'copilot',
                        enabled: true,
                        minimumRemainingPercent: 10,
                        weeklyGuard: { enabled: false, minimumRemainingPercent: 10 },
                    },
                ],
            },
            {
                providerAvailability: availability(),
                quotaData: quota({ copilot: [quotaType({ type: 'chat', remainingPercentage: 1 })] }),
                quotaStale: true,
            },
        );
        const missing = resolveAutoAgentProvider(
            {
                fallbackProvider: 'copilot',
                rules: [
                    {
                        provider: 'copilot',
                        enabled: true,
                        minimumRemainingPercent: 10,
                        weeklyGuard: { enabled: false, minimumRemainingPercent: 10 },
                    },
                ],
            },
            {
                providerAvailability: availability(),
                quotaData: null,
            },
        );

        expect(stale.warnings[0]).toContain('Quota cache is stale');
        expect(missing.warnings).toContain('Quota cache is missing; normal auto routing rules require quota data.');
        expect(missing.fallbackUsed).toBe(true);
    });
});
