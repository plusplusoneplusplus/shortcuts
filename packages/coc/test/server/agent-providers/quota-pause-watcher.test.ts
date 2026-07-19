import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QuotaPauseWatcher, type QuotaPauseRule } from '../../../src/server/agent-providers/quota-pause-watcher';
import type { QueueGlobalState } from '../../../src/server/routes/queue-shared';
import type { AgentProvidersQuotaCache } from '../../../src/server/agent-providers/quota-cache';
import type { AgentProvidersQuotaResponse, ProviderQuotaResult } from '@plusplusoneplusplus/coc-client';

vi.mock('@plusplusoneplusplus/forge', () => ({
    getLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
    LogCategory: { AI: 'AI' },
}));

function makeQuotaType(remaining: number, opts: {
    resetDate?: string;
    usageAllowedWithExhaustedQuota?: boolean;
    isUnlimitedEntitlement?: boolean;
} = {}) {
    return {
        type: 'monthly' as const,
        remainingPercentage: remaining,
        resetDate: opts.resetDate,
        usageAllowedWithExhaustedQuota: opts.usageAllowedWithExhaustedQuota ?? false,
        isUnlimitedEntitlement: opts.isUnlimitedEntitlement ?? false,
    };
}

function makeProvider(id: string, remaining: number, opts: {
    resetDate?: string;
    error?: string;
    usageAllowedWithExhaustedQuota?: boolean;
    isUnlimited?: boolean;
} = {}): ProviderQuotaResult {
    return {
        id,
        label: id,
        error: opts.error,
        quotaTypes: opts.error ? [] : [makeQuotaType(remaining, {
            resetDate: opts.resetDate,
            usageAllowedWithExhaustedQuota: opts.usageAllowedWithExhaustedQuota,
            isUnlimitedEntitlement: opts.isUnlimited,
        })],
    } as unknown as ProviderQuotaResult;
}

function makeQuotaData(providers: ProviderQuotaResult[]): AgentProvidersQuotaResponse {
    return { providers, lastUpdated: new Date().toISOString() };
}

function makeCache(data: AgentProvidersQuotaResponse | null): AgentProvidersQuotaCache {
    return {
        getCached: () => data,
    } as unknown as AgentProvidersQuotaCache;
}

function makeBridge(queues: { pauseAutopilot?: (until?: number) => void; resumeAutopilot?: () => void; pause?: (until?: number) => void; resume?: () => void }[]) {
    const managers = queues.map(q => ({
        pauseAutopilot: q.pauseAutopilot ?? vi.fn(),
        resumeAutopilot: q.resumeAutopilot ?? vi.fn(),
        pause: q.pause ?? vi.fn(),
        resume: q.resume ?? vi.fn(),
    }));
    return {
        registry: {
            getAllQueues: () => new Map(managers.map((m, i) => [`repo${i}`, m])),
        },
        managers,
    };
}

function makeState(overrides: Partial<QueueGlobalState> = {}): QueueGlobalState {
    return {
        globalPaused: false,
        globalPausedUntil: undefined,
        globalPauseSource: undefined,
        globalAutopilotPaused: false,
        globalAutopilotPausedUntil: undefined,
        globalAutopilotPauseSource: undefined,
        resumeInProgress: new Set(),
        ...overrides,
    };
}

function makeRule(overrides: Partial<QuotaPauseRule> = {}): QuotaPauseRule {
    return {
        enabled: true,
        threshold: 0.15,
        action: 'autopilot',
        respectOverage: true,
        ...overrides,
    };
}

const FUTURE_RESET = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
const PAST_RESET = new Date(Date.now() - 60 * 1000).toISOString();
const NOW = Date.now();

describe('QuotaPauseWatcher', () => {
    describe('evaluate() — rule disabled', () => {
        it('does nothing when rule.enabled is false', () => {
            const bridge = makeBridge([{}]);
            const state = makeState();
            const cache = makeCache(makeQuotaData([makeProvider('claude', 0.05, { resetDate: FUTURE_RESET })]));
            const watcher = new QuotaPauseWatcher({
                quotaCache: cache,
                bridge: bridge as any,
                state,
                getRule: () => makeRule({ enabled: false }),
                now: () => NOW,
            });
            watcher.evaluate();
            expect(state.globalAutopilotPaused).toBe(false);
            expect(bridge.managers[0].pauseAutopilot).not.toHaveBeenCalled();
        });
    });

    describe('evaluate() — no cached data', () => {
        it('does nothing when cache is empty', () => {
            const bridge = makeBridge([{}]);
            const state = makeState();
            const cache = makeCache(null);
            const watcher = new QuotaPauseWatcher({
                quotaCache: cache,
                bridge: bridge as any,
                state,
                getRule: () => makeRule(),
                now: () => NOW,
            });
            watcher.evaluate();
            expect(state.globalAutopilotPaused).toBe(false);
            expect(bridge.managers[0].pauseAutopilot).not.toHaveBeenCalled();
        });
    });

    describe('evaluate() — trigger', () => {
        it('pauses autopilot when most-constrained provider is below threshold', () => {
            const bridge = makeBridge([{}]);
            const state = makeState();
            const cache = makeCache(makeQuotaData([makeProvider('claude', 0.10, { resetDate: FUTURE_RESET })]));
            const watcher = new QuotaPauseWatcher({
                quotaCache: cache,
                bridge: bridge as any,
                state,
                getRule: () => makeRule({ threshold: 0.15 }),
                now: () => NOW,
            });
            watcher.evaluate();
            expect(state.globalAutopilotPaused).toBe(true);
            expect(state.globalAutopilotPauseSource).toBe('quota');
            expect(state.globalAutopilotPausedUntil).toBeGreaterThan(NOW);
            expect(state.globalAutopilotPausedUntil).toBe(Date.parse(FUTURE_RESET));
            expect(bridge.managers[0].pauseAutopilot).toHaveBeenCalledWith(Date.parse(FUTURE_RESET));
        });

        it('uses fallback duration when resetDate is missing', () => {
            const bridge = makeBridge([{}]);
            const state = makeState();
            const cache = makeCache(makeQuotaData([makeProvider('claude', 0.05)]));
            const watcher = new QuotaPauseWatcher({
                quotaCache: cache,
                bridge: bridge as any,
                state,
                getRule: () => makeRule({ threshold: 0.15 }),
                now: () => NOW,
            });
            watcher.evaluate();
            expect(state.globalAutopilotPaused).toBe(true);
            expect(state.globalAutopilotPauseSource).toBe('quota');
            const expectedFallback = NOW + 60 * 60 * 1000;
            expect(state.globalAutopilotPausedUntil).toBe(expectedFallback);
            expect(bridge.managers[0].pauseAutopilot).toHaveBeenCalledWith(expectedFallback);
        });

        it('uses fallback when resetDate is in the past', () => {
            const bridge = makeBridge([{}]);
            const state = makeState();
            const cache = makeCache(makeQuotaData([makeProvider('claude', 0.05, { resetDate: PAST_RESET })]));
            const watcher = new QuotaPauseWatcher({
                quotaCache: cache,
                bridge: bridge as any,
                state,
                getRule: () => makeRule({ threshold: 0.15 }),
                now: () => NOW,
            });
            watcher.evaluate();
            expect(state.globalAutopilotPaused).toBe(true);
            const expectedFallback = NOW + 60 * 60 * 1000;
            expect(state.globalAutopilotPausedUntil).toBe(expectedFallback);
        });

        it('pauses ALL queues (not just autopilot) when action=all', () => {
            const bridge = makeBridge([{}, {}]);
            const state = makeState();
            const cache = makeCache(makeQuotaData([makeProvider('claude', 0.05, { resetDate: FUTURE_RESET })]));
            const watcher = new QuotaPauseWatcher({
                quotaCache: cache,
                bridge: bridge as any,
                state,
                getRule: () => makeRule({ action: 'all' }),
                now: () => NOW,
            });
            watcher.evaluate();
            expect(state.globalPaused).toBe(true);
            expect(state.globalPauseSource).toBe('quota');
            expect(bridge.managers[0].pause).toHaveBeenCalled();
            expect(bridge.managers[1].pause).toHaveBeenCalled();
            expect(bridge.managers[0].pauseAutopilot).not.toHaveBeenCalled();
        });
    });

    describe('evaluate() — recovery', () => {
        it('resumes autopilot when quota recovers above threshold', () => {
            const bridge = makeBridge([{}]);
            const state = makeState({
                globalAutopilotPaused: true,
                globalAutopilotPausedUntil: NOW + 3600_000,
                globalAutopilotPauseSource: 'quota',
            });
            const cache = makeCache(makeQuotaData([makeProvider('claude', 0.50, { resetDate: FUTURE_RESET })]));
            const watcher = new QuotaPauseWatcher({
                quotaCache: cache,
                bridge: bridge as any,
                state,
                getRule: () => makeRule({ threshold: 0.15 }),
                now: () => NOW,
            });
            watcher.evaluate();
            expect(state.globalAutopilotPaused).toBe(false);
            expect(state.globalAutopilotPauseSource).toBeUndefined();
            expect(bridge.managers[0].resumeAutopilot).toHaveBeenCalled();
        });

        it('resumes all-pause when quota recovers', () => {
            const bridge = makeBridge([{}]);
            const state = makeState({
                globalPaused: true,
                globalPausedUntil: NOW + 3600_000,
                globalPauseSource: 'quota',
            });
            const cache = makeCache(makeQuotaData([makeProvider('claude', 0.50)]));
            const watcher = new QuotaPauseWatcher({
                quotaCache: cache,
                bridge: bridge as any,
                state,
                getRule: () => makeRule({ action: 'all', threshold: 0.15 }),
                now: () => NOW,
            });
            watcher.evaluate();
            expect(state.globalPaused).toBe(false);
            expect(state.globalPauseSource).toBeUndefined();
            expect(bridge.managers[0].resume).toHaveBeenCalled();
        });
    });

    describe('evaluate() — manual pause protection', () => {
        it('does not auto-resume a manual autopilot pause', () => {
            const bridge = makeBridge([{}]);
            const state = makeState({
                globalAutopilotPaused: true,
                globalAutopilotPauseSource: 'manual',
            });
            // Quota is fine (above threshold)
            const cache = makeCache(makeQuotaData([makeProvider('claude', 0.80)]));
            const watcher = new QuotaPauseWatcher({
                quotaCache: cache,
                bridge: bridge as any,
                state,
                getRule: () => makeRule({ threshold: 0.15 }),
                now: () => NOW,
            });
            watcher.evaluate();
            // Manual pause untouched
            expect(state.globalAutopilotPaused).toBe(true);
            expect(state.globalAutopilotPauseSource).toBe('manual');
            expect(bridge.managers[0].resumeAutopilot).not.toHaveBeenCalled();
        });

        it('does not override a manual pause when quota drops below threshold', () => {
            const bridge = makeBridge([{}]);
            const state = makeState({
                globalAutopilotPaused: true,
                globalAutopilotPauseSource: 'manual',
            });
            const cache = makeCache(makeQuotaData([makeProvider('claude', 0.05, { resetDate: FUTURE_RESET })]));
            const watcher = new QuotaPauseWatcher({
                quotaCache: cache,
                bridge: bridge as any,
                state,
                getRule: () => makeRule({ threshold: 0.15 }),
                now: () => NOW,
            });
            watcher.evaluate();
            // Manual pause still manual; watcher doesn't overwrite it
            expect(state.globalAutopilotPauseSource).toBe('manual');
            expect(bridge.managers[0].pauseAutopilot).not.toHaveBeenCalled();
        });
    });

    describe('evaluate() — error provider skip', () => {
        it('skips providers with errors and does not trigger auto-pause on their behalf', () => {
            const bridge = makeBridge([{}]);
            const state = makeState();
            // Provider has an error — should be skipped; no other constrained provider
            const cache = makeCache(makeQuotaData([makeProvider('claude', 0.05, { error: 'quota unavailable' } as any)]));
            const watcher = new QuotaPauseWatcher({
                quotaCache: cache,
                bridge: bridge as any,
                state,
                getRule: () => makeRule({ threshold: 0.15 }),
                now: () => NOW,
            });
            watcher.evaluate();
            expect(state.globalAutopilotPaused).toBe(false);
            expect(bridge.managers[0].pauseAutopilot).not.toHaveBeenCalled();
        });
    });

    describe('evaluate() — overage exemption', () => {
        it('does not pause when usageAllowedWithExhaustedQuota and respectOverage=true', () => {
            const bridge = makeBridge([{}]);
            const state = makeState();
            const cache = makeCache(makeQuotaData([
                makeProvider('claude', 0.05, {
                    resetDate: FUTURE_RESET,
                    usageAllowedWithExhaustedQuota: true,
                }),
            ]));
            const watcher = new QuotaPauseWatcher({
                quotaCache: cache,
                bridge: bridge as any,
                state,
                getRule: () => makeRule({ threshold: 0.15, respectOverage: true }),
                now: () => NOW,
            });
            watcher.evaluate();
            expect(state.globalAutopilotPaused).toBe(false);
            expect(bridge.managers[0].pauseAutopilot).not.toHaveBeenCalled();
        });

        it('does pause when usageAllowedWithExhaustedQuota but respectOverage=false', () => {
            const bridge = makeBridge([{}]);
            const state = makeState();
            const cache = makeCache(makeQuotaData([
                makeProvider('claude', 0.05, {
                    resetDate: FUTURE_RESET,
                    usageAllowedWithExhaustedQuota: true,
                }),
            ]));
            const watcher = new QuotaPauseWatcher({
                quotaCache: cache,
                bridge: bridge as any,
                state,
                getRule: () => makeRule({ threshold: 0.15, respectOverage: false }),
                now: () => NOW,
            });
            watcher.evaluate();
            expect(state.globalAutopilotPaused).toBe(true);
            expect(bridge.managers[0].pauseAutopilot).toHaveBeenCalled();
        });

        it('resumes our quota pause when overage kicks in (recovery via overage)', () => {
            const bridge = makeBridge([{}]);
            const state = makeState({
                globalAutopilotPaused: true,
                globalAutopilotPausedUntil: NOW + 3600_000,
                globalAutopilotPauseSource: 'quota',
            });
            // Quota still below threshold but now allows overage
            const cache = makeCache(makeQuotaData([
                makeProvider('claude', 0.05, {
                    resetDate: FUTURE_RESET,
                    usageAllowedWithExhaustedQuota: true,
                }),
            ]));
            const watcher = new QuotaPauseWatcher({
                quotaCache: cache,
                bridge: bridge as any,
                state,
                getRule: () => makeRule({ threshold: 0.15, respectOverage: true }),
                now: () => NOW,
            });
            watcher.evaluate();
            expect(state.globalAutopilotPaused).toBe(false);
            expect(bridge.managers[0].resumeAutopilot).toHaveBeenCalled();
        });
    });

    describe('evaluate() — enabledProviderIds filtering', () => {
        it('only considers enabled providers', () => {
            const bridge = makeBridge([{}]);
            const state = makeState();
            const cache = makeCache(makeQuotaData([
                makeProvider('claude', 0.05, { resetDate: FUTURE_RESET }),
                makeProvider('copilot', 0.80),
            ]));
            // Only copilot is enabled — copilot is fine so no pause
            const watcher = new QuotaPauseWatcher({
                quotaCache: cache,
                bridge: bridge as any,
                state,
                getRule: () => makeRule({ threshold: 0.15 }),
                enabledProviderIds: () => ['copilot'],
                now: () => NOW,
            });
            watcher.evaluate();
            expect(state.globalAutopilotPaused).toBe(false);
        });
    });
});
