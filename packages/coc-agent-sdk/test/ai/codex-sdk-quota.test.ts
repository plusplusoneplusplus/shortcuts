/**
 * Codex SDK Service — Rate Limits to Quota Mapping Tests
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CodexSDKService, mapCodexRateLimitsToQuota } from '../../src/codex-sdk-service';

describe('mapCodexRateLimitsToQuota', () => {
    it('maps primary and secondary windows to five_hour / seven_day snapshots', () => {
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

        expect(Object.keys(result.quotaSnapshots).sort()).toEqual(['five_hour', 'seven_day']);

        const primary = result.quotaSnapshots['five_hour'];
        expect(primary.isUnlimitedEntitlement).toBe(false);
        expect(primary.usedRequests).toBe(10);
        expect(primary.entitlementRequests).toBe(100);
        expect(primary.remainingPercentage).toBe(0.9);
        expect(primary.usageAllowedWithExhaustedQuota).toBe(false);
        expect(primary.overage).toBe(0);
        expect(primary.resetDate).toBe(new Date(1700000000 * 1000).toISOString());

        const secondary = result.quotaSnapshots['seven_day'];
        expect(secondary.usedRequests).toBe(0);
        expect(secondary.remainingPercentage).toBe(1);
        expect(secondary.resetDate).toBe(new Date(1700500000 * 1000).toISOString());
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

        expect(Object.keys(result.quotaSnapshots).sort()).toEqual(['five_hour', 'seven_day']);
        expect(result.quotaSnapshots['five_hour'].usedRequests).toBe(50);
        expect(result.quotaSnapshots['five_hour'].remainingPercentage).toBe(0.5);
        expect(result.quotaSnapshots['five_hour'].usageAllowedWithExhaustedQuota).toBe(true);
        expect(result.quotaSnapshots['seven_day'].usedRequests).toBe(5);
        expect(result.quotaSnapshots['seven_day'].remainingPercentage).toBe(0.95);
    });

    it('skips the weekly window when secondary is null', () => {
        const result = mapCodexRateLimitsToQuota({
            rateLimits: {
                limitId: 'codex',
                limitName: null,
                primary: { usedPercent: 30, windowDurationMins: 300, resetsAt: 1700000000 },
                secondary: null,
                credits: { hasCredits: false, unlimited: false, balance: '0' },
                planType: 'plus',
                rateLimitReachedType: null,
            },
        });

        expect(Object.keys(result.quotaSnapshots)).toEqual(['five_hour']);
        expect(result.quotaSnapshots['seven_day']).toBeUndefined();
        expect(result.quotaSnapshots['five_hour'].usedRequests).toBe(30);
    });

    it('handles unlimited entitlements on both windows', () => {
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

        expect(result.quotaSnapshots['five_hour'].isUnlimitedEntitlement).toBe(true);
        expect(result.quotaSnapshots['five_hour'].remainingPercentage).toBe(1);
        expect(result.quotaSnapshots['seven_day'].isUnlimitedEntitlement).toBe(true);
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

        expect(result.quotaSnapshots['five_hour'].remainingPercentage).toBe(0);
    });

    it('prefixes window keys with the limit id when multiple entries are present', () => {
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

        expect(Object.keys(result.quotaSnapshots).sort()).toEqual([
            'codex-pro_five_hour',
            'codex-pro_seven_day',
            'codex_five_hour',
            'codex_seven_day',
        ]);
        expect(result.quotaSnapshots['codex-pro_five_hour'].usedRequests).toBe(25);
        expect(result.quotaSnapshots['codex-pro_five_hour'].remainingPercentage).toBe(0.75);
        expect(result.quotaSnapshots['codex-pro_seven_day'].usedRequests).toBe(2);
    });

    it('uses default limitId "codex" prefix when limitId is empty across multiple entries', () => {
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

        // Single entry → unprefixed semantic keys.
        expect(Object.keys(result.quotaSnapshots).sort()).toEqual(['five_hour', 'seven_day']);
    });

    it('handles zero resetsAt (no reset date) on both windows', () => {
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

        expect(result.quotaSnapshots['five_hour'].resetDate).toBeUndefined();
        expect(result.quotaSnapshots['seven_day'].resetDate).toBeUndefined();
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
