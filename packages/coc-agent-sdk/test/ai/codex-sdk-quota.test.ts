/**
 * Codex SDK Service — Rate Limits to Quota Mapping Tests
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CodexSDKService, mapCodexRateLimitsToQuota } from '../../src/codex-sdk-service';

describe('mapCodexRateLimitsToQuota', () => {
    it('maps a single rate limit entry from rateLimitsByLimitId', () => {
        const result = mapCodexRateLimitsToQuota({
            rateLimits: {
                limitId: 'codex',
                limitName: null,
                primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1700000000 },
                secondary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: 1700500000 },
                credits: { hasCredits: false, unlimited: false, balance: '0' },
                planType: 'plus',
                rateLimitReachedType: null,
            },
            rateLimitsByLimitId: {
                codex: {
                    limitId: 'codex',
                    limitName: null,
                    primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1700000000 },
                    secondary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: 1700500000 },
                    credits: { hasCredits: false, unlimited: false, balance: '0' },
                    planType: 'plus',
                    rateLimitReachedType: null,
                },
            },
        });

        expect(result.quotaSnapshots).toHaveProperty('codex');
        const snap = result.quotaSnapshots['codex'];
        expect(snap.isUnlimitedEntitlement).toBe(false);
        expect(snap.usedRequests).toBe(10);
        expect(snap.entitlementRequests).toBe(100);
        expect(snap.remainingPercentage).toBe(0.9);
        expect(snap.usageAllowedWithExhaustedQuota).toBe(false);
        expect(snap.overage).toBe(0);
        expect(snap.resetDate).toBe(new Date(1700000000 * 1000).toISOString());
    });

    it('falls back to rateLimits when rateLimitsByLimitId is absent', () => {
        const result = mapCodexRateLimitsToQuota({
            rateLimits: {
                limitId: 'codex',
                limitName: null,
                primary: { usedPercent: 50, windowDurationMins: 300, resetsAt: 1700000000 },
                secondary: { usedPercent: 5, windowDurationMins: 10080, resetsAt: 1700500000 },
                credits: { hasCredits: true, unlimited: false, balance: '10' },
                planType: 'pro',
                rateLimitReachedType: null,
            },
        });

        expect(Object.keys(result.quotaSnapshots)).toEqual(['codex']);
        const snap = result.quotaSnapshots['codex'];
        expect(snap.usedRequests).toBe(50);
        expect(snap.remainingPercentage).toBe(0.5);
        expect(snap.usageAllowedWithExhaustedQuota).toBe(true);
    });

    it('handles unlimited entitlements', () => {
        const result = mapCodexRateLimitsToQuota({
            rateLimits: {
                limitId: 'codex',
                limitName: null,
                primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 1700000000 },
                secondary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: 1700500000 },
                credits: { hasCredits: true, unlimited: true, balance: '999' },
                planType: 'enterprise',
                rateLimitReachedType: null,
            },
        });

        const snap = result.quotaSnapshots['codex'];
        expect(snap.isUnlimitedEntitlement).toBe(true);
        expect(snap.remainingPercentage).toBe(1);
    });

    it('clamps remaining percentage to [0, 1] range', () => {
        const result = mapCodexRateLimitsToQuota({
            rateLimits: {
                limitId: 'codex',
                limitName: null,
                primary: { usedPercent: 120, windowDurationMins: 300, resetsAt: 1700000000 },
                secondary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: 1700500000 },
                credits: { hasCredits: false, unlimited: false, balance: '0' },
                planType: 'plus',
                rateLimitReachedType: null,
            },
        });

        const snap = result.quotaSnapshots['codex'];
        expect(snap.remainingPercentage).toBe(0);
    });

    it('uses default limitId "codex" when limitId is empty', () => {
        const result = mapCodexRateLimitsToQuota({
            rateLimits: {
                limitId: '',
                limitName: null,
                primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: 1700000000 },
                secondary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: 1700500000 },
                credits: { hasCredits: false, unlimited: false, balance: '0' },
                planType: 'plus',
                rateLimitReachedType: null,
            },
        });

        expect(result.quotaSnapshots).toHaveProperty('codex');
    });

    it('handles multiple rate limit entries', () => {
        const result = mapCodexRateLimitsToQuota({
            rateLimits: {
                limitId: 'codex',
                limitName: null,
                primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1700000000 },
                secondary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: 1700500000 },
                credits: { hasCredits: false, unlimited: false, balance: '0' },
                planType: 'plus',
                rateLimitReachedType: null,
            },
            rateLimitsByLimitId: {
                codex: {
                    limitId: 'codex',
                    limitName: null,
                    primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1700000000 },
                    secondary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: 1700500000 },
                    credits: { hasCredits: false, unlimited: false, balance: '0' },
                    planType: 'plus',
                    rateLimitReachedType: null,
                },
                'codex-pro': {
                    limitId: 'codex-pro',
                    limitName: null,
                    primary: { usedPercent: 25, windowDurationMins: 600, resetsAt: 1700100000 },
                    secondary: { usedPercent: 2, windowDurationMins: 10080, resetsAt: 1700500000 },
                    credits: { hasCredits: false, unlimited: false, balance: '0' },
                    planType: 'pro',
                    rateLimitReachedType: null,
                },
            },
        });

        expect(Object.keys(result.quotaSnapshots)).toHaveLength(2);
        expect(result.quotaSnapshots['codex']).toBeDefined();
        expect(result.quotaSnapshots['codex-pro']).toBeDefined();
        expect(result.quotaSnapshots['codex-pro'].usedRequests).toBe(25);
        expect(result.quotaSnapshots['codex-pro'].remainingPercentage).toBe(0.75);
    });

    it('handles zero resetsAt (no reset date)', () => {
        const result = mapCodexRateLimitsToQuota({
            rateLimits: {
                limitId: 'codex',
                limitName: null,
                primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: 0 },
                secondary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: 0 },
                credits: { hasCredits: false, unlimited: false, balance: '0' },
                planType: 'plus',
                rateLimitReachedType: null,
            },
        });

        const snap = result.quotaSnapshots['codex'];
        expect(snap.resetDate).toBeUndefined();
    });
});

describe('CodexSDKService runtime CLI resolution', () => {
    it('resolves the bundled Codex CLI bin used by quota and model catalog RPCs', () => {
        const svc = new CodexSDKService();
        const binPath = (svc as unknown as { resolveCodexBinPath: () => string }).resolveCodexBinPath();

        expect(path.basename(binPath)).toBe('codex.js');
        expect(path.basename(path.dirname(binPath))).toBe('bin');
        expect(fs.existsSync(binPath)).toBe(true);
    });
});
