import { describe, it, expect } from 'vitest';
import type { AgentProvidersQuotaResponse, AgentProviderStatus } from '@plusplusoneplusplus/coc-client';
import {
    buildRestartOptions,
    pickDefaultRestartProvider,
} from '../../../src/server/spa/client/react/features/chat/RestartWithProviderButton';

const QUOTA_ERROR = "You've hit your usage limit. Try again in 2 days.";

const providers: AgentProviderStatus[] = [
    { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
    { id: 'codex', label: 'Codex', enabled: true, available: true },
    { id: 'claude', label: 'Claude', enabled: true, available: true },
    { id: 'opencode', label: 'OpenCode', enabled: false, available: false },
];

function quotaType(remainingPercentage: number, extra: Record<string, unknown> = {}) {
    return {
        type: 'chat',
        isUnlimitedEntitlement: false,
        usedRequests: 0,
        entitlementRequests: 100,
        remainingPercentage,
        usageAllowedWithExhaustedQuota: false,
        overage: 0,
        ...extra,
    };
}

const quota: AgentProvidersQuotaResponse = {
    lastUpdated: null,
    providers: [
        { id: 'codex', quotaTypes: [quotaType(0, { resetDate: '2026-10-01T00:00:00Z' })] },
        { id: 'claude', quotaTypes: [quotaType(0.4)] },
        { id: 'copilot', quotaTypes: [quotaType(0.9)] },
    ],
};

describe('buildRestartOptions', () => {
    it('lists enabled providers plus the current one with quota, disabling exhausted ones', () => {
        const options = buildRestartOptions(providers, quota, 'codex');
        expect(options.map(o => o.provider)).toEqual(['copilot', 'codex', 'claude']);
        expect(options.find(o => o.provider === 'codex')).toMatchObject({
            isCurrent: true,
            remainingPercent: 0,
            disabled: true,
            resetDate: '2026-10-01T00:00:00Z',
        });
        expect(options.find(o => o.provider === 'claude')).toMatchObject({ remainingPercent: 40, disabled: false });
    });

    it('keeps the current provider even when it is disabled or unknown', () => {
        const options = buildRestartOptions(providers, null, 'opencode');
        expect(options.find(o => o.provider === 'opencode')).toMatchObject({ isCurrent: true, remainingPercent: null, disabled: false });
    });

    it('tolerates a malformed quota response', () => {
        const options = buildRestartOptions(providers, {} as AgentProvidersQuotaResponse, 'copilot');
        expect(options.every(o => o.remainingPercent === null)).toBe(true);
    });
});

describe('pickDefaultRestartProvider', () => {
    it('picks the other provider with the most remaining quota on a quota failure', () => {
        const options = buildRestartOptions(providers, quota, 'codex');
        expect(pickDefaultRestartProvider(options, 'codex', QUOTA_ERROR)).toBe('copilot');
    });

    it('ranks providers with unknown quota after known ones', () => {
        const options = buildRestartOptions(providers, {
            lastUpdated: null,
            providers: [{ id: 'claude', quotaTypes: [quotaType(0.1)] }],
        }, 'codex');
        expect(pickDefaultRestartProvider(options, 'codex', QUOTA_ERROR)).toBe('claude');
    });

    it('keeps the same provider for non-quota failures', () => {
        const options = buildRestartOptions(providers, quota, 'codex');
        expect(pickDefaultRestartProvider(options, 'codex', 'ENOENT: missing file')).toBe('codex');
    });

    it('falls back to the same provider when every other provider is exhausted', () => {
        const options = buildRestartOptions(providers, {
            lastUpdated: null,
            providers: [
                { id: 'copilot', quotaTypes: [quotaType(0)] },
                { id: 'claude', quotaTypes: [quotaType(0)] },
            ],
        }, 'codex');
        expect(pickDefaultRestartProvider(options, 'codex', QUOTA_ERROR)).toBe('codex');
    });
});
