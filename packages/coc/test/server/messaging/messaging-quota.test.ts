import { describe, expect, it } from 'vitest';
import type { AgentProvidersQuotaResponse, ProviderQuotaType } from '@plusplusoneplusplus/coc-client';
import { formatQuotaReply, readQuotaReply } from '../../../src/server/messaging/messaging-commands';
import { quotaResultToProviderQuotaTypes } from '../../../src/server/agent-providers/quota-cache';

function quota(type: string, remainingPercentage: number, resetDate?: string): ProviderQuotaType {
    return {
        type, remainingPercentage, resetDate, isUnlimitedEntitlement: false,
        usedRequests: 100 * (1 - remainingPercentage), entitlementRequests: 100,
        usageAllowedWithExhaustedQuota: false, overage: 0,
    };
}

function data(quotaTypes: ProviderQuotaType[]): AgentProvidersQuotaResponse {
    return { lastUpdated: '2026-10-01T00:00:00Z', providers: [{ id: 'codex', quotaTypes }] };
}

describe('messaging quota replies', () => {
    it.each(['codex', 'claude'] as const)('reports both normalized %s windows with their own remaining and resets', id => {
        const { type: _fiveHourType, ...fiveHour } = quota('five_hour', 0.72, '2026-10-06T18:00:00Z');
        const { type: _sevenDayType, ...sevenDay } = quota('seven_day', 0.19, '2026-10-12T00:00:00Z');
        const quotaTypes = quotaResultToProviderQuotaTypes({ quotaSnapshots: { five_hour: fiveHour, seven_day: sevenDay } });
        const response = { ...data(quotaTypes), providers: [{ id, quotaTypes }] };
        const before = JSON.stringify(response);
        expect(formatQuotaReply(response)).toBe(
            `${id}: 72% left (5h, resets 2026-10-06); 19% left (7d, resets 2026-10-12)`);
        expect(JSON.stringify(response)).toBe(before);
    });

    it.each([
        ['five_hour', '5h'], ['seven_day', '7d'], ['weekly', 'weekly'],
    ])('reports only the supplied %s bucket', (type, label) => {
        expect(formatQuotaReply(data([quota(type, 0.45)]))).toBe(`codex: 45% left (${label})`);
    });

    it('keeps distinct Codex limit ids and equal-valued windows', () => {
        expect(formatQuotaReply(data([
            quota('codex_five_hour', 0.4), quota('codex_seven_day', 0.4),
            quota('review_five_hour', 0.8),
        ]))).toBe('codex: 40% left (codex_5h); 40% left (codex_7d); 80% left (review_5h)');
    });

    it.each([undefined, null, NaN, Infinity])('does not invent a percentage for %s remaining', remaining => {
        const unknown = { ...quota('five_hour', 0.5, 'invalid'), remainingPercentage: remaining } as ProviderQuotaType;
        expect(formatQuotaReply(data([unknown, quota('seven_day', 0)]))).toBe(
            'codex: remaining unknown (5h); 0% left (7d)');
    });

    it('preserves premium interactions, unlimited entitlements, empty and failed providers', () => {
        const unlimited = { ...quota('chat', 1), isUnlimitedEntitlement: true };
        expect(formatQuotaReply({ lastUpdated: null, providers: [
            { id: 'copilot', quotaTypes: [unlimited, quota('premium_interactions', 0.62, '2026-11-01T00:00:00Z')] },
            { id: 'codex', quotaTypes: [quota('five_hour', 0.01)], error: 'private error details' },
            { id: 'claude', quotaTypes: [unlimited] },
            { id: 'opencode', quotaTypes: [] },
        ] })).toBe('copilot: 62% left (premium_interactions, resets 2026-11-01)\ncodex: unavailable\nclaude: unlimited\nopencode: no quota data');
    });

    it('preserves other finite categories and percentage rounding/clamping', () => {
        expect(formatQuotaReply(data([
            quota('monthly', 0.456, 'invalid'), quota('requests', -0.2), quota('tokens', 1.2),
        ]))).toBe('codex: 46% left (monthly); 0% left (requests); 100% left (tokens)');
    });

    it('shares the formatter for successful reads, including cached snapshots', async () => {
        const response = data([quota('five_hour', 0.72), quota('seven_day', 0.19)]);
        expect(await readQuotaReply(async () => response)).toBe('codex: 72% left (5h); 19% left (7d)');
    });

    it('preserves unavailable replies without exposing errors', async () => {
        expect(formatQuotaReply(undefined)).toBe('Quota data is unavailable.');
        expect(formatQuotaReply(null)).toBe('Quota data is unavailable.');
        expect(formatQuotaReply({ lastUpdated: null, providers: [] })).toBe('Quota data is unavailable.');
        expect(await readQuotaReply(undefined)).toBe('Quota data is unavailable.');
        expect(await readQuotaReply(async () => null)).toBe('Quota data is unavailable.');
        expect(await readQuotaReply(async () => { throw new Error('private'); })).toBe('Quota data is unavailable.');
    });
});
