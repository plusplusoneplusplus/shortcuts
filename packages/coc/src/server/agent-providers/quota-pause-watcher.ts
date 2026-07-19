import { getMostConstrainedProviderQuota } from '@plusplusoneplusplus/coc-client';
import type { AgentProviderId } from '@plusplusoneplusplus/coc-client';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import type { AgentProvidersQuotaCache } from './quota-cache';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import type { QueueGlobalState } from '../routes/queue-shared';

export interface QuotaPauseRule {
    enabled: boolean;
    /** Remaining-fraction threshold (0..1). Pause when remaining ≤ this. */
    threshold: number;
    action: 'autopilot' | 'all';
    /** When true (default), skip auto-pause if usageAllowedWithExhaustedQuota. */
    respectOverage: boolean;
}

/** Fallback pause duration when no future resetDate is available. */
const FALLBACK_PAUSE_MS = 60 * 60 * 1000;

export class QuotaPauseWatcher {
    private intervalTimer: ReturnType<typeof setInterval> | null = null;

    constructor(
        private readonly deps: {
            quotaCache: AgentProvidersQuotaCache;
            bridge: MultiRepoQueueRouter;
            state: QueueGlobalState;
            getRule: () => QuotaPauseRule;
            enabledProviderIds?: () => AgentProviderId[];
            intervalMs?: number;
            now?: () => number;
        },
    ) {}

    start(): void {
        if (this.intervalTimer) {
            return;
        }
        const intervalMs = this.deps.intervalMs ?? 5 * 60 * 1000;
        this.intervalTimer = setInterval(() => {
            try {
                this.evaluate();
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                getLogger().warn(LogCategory.AI, `[QuotaPauseWatcher] evaluate error: ${msg}`);
            }
        }, intervalMs);
        const timer = this.intervalTimer;
        if (typeof timer === 'object' && 'unref' in timer && typeof (timer as NodeJS.Timeout).unref === 'function') {
            (timer as NodeJS.Timeout).unref();
        }
    }

    dispose(): void {
        if (!this.intervalTimer) {
            return;
        }
        clearInterval(this.intervalTimer);
        this.intervalTimer = null;
    }

    evaluate(): void {
        const rule = this.deps.getRule();
        if (!rule.enabled) {
            return;
        }

        const quotaData = this.deps.quotaCache.getCached();
        if (!quotaData) {
            return;
        }

        const enabledProviderIds = this.deps.enabledProviderIds?.();
        const mostConstrained = getMostConstrainedProviderQuota(quotaData, enabledProviderIds);
        const now = this.deps.now?.() ?? Date.now();

        const rawRemaining = mostConstrained?.quotaType.remainingPercentage;
        const rawBelowThreshold =
            mostConstrained !== null &&
            rawRemaining !== undefined &&
            Number.isFinite(rawRemaining) &&
            rawRemaining <= rule.threshold;

        const exemptByOverage =
            rawBelowThreshold &&
            rule.respectOverage &&
            !!mostConstrained?.quotaType.usageAllowedWithExhaustedQuota;

        const effectiveBelowThreshold = rawBelowThreshold && !exemptByOverage;
        const resetDate = mostConstrained?.quotaType.resetDate;

        if (rule.action === 'autopilot') {
            this._applyRule(
                effectiveBelowThreshold,
                resetDate,
                'globalAutopilotPaused',
                'globalAutopilotPausedUntil',
                'globalAutopilotPauseSource',
                (until) => {
                    for (const m of this.deps.bridge.registry.getAllQueues().values()) {
                        m.pauseAutopilot(until);
                    }
                },
                () => {
                    for (const m of this.deps.bridge.registry.getAllQueues().values()) {
                        m.resumeAutopilot();
                    }
                },
                now,
            );
        } else {
            this._applyRule(
                effectiveBelowThreshold,
                resetDate,
                'globalPaused',
                'globalPausedUntil',
                'globalPauseSource',
                (until) => {
                    for (const m of this.deps.bridge.registry.getAllQueues().values()) {
                        m.pause(until);
                    }
                },
                () => {
                    for (const m of this.deps.bridge.registry.getAllQueues().values()) {
                        m.resume();
                    }
                },
                now,
            );
        }
    }

    private _applyRule(
        belowThreshold: boolean,
        resetDate: string | undefined,
        pausedKey: 'globalPaused' | 'globalAutopilotPaused',
        pausedUntilKey: 'globalPausedUntil' | 'globalAutopilotPausedUntil',
        pauseSourceKey: 'globalPauseSource' | 'globalAutopilotPauseSource',
        doPause: (until: number) => void,
        doResume: () => void,
        now: number,
    ): void {
        const state = this.deps.state;
        const isOurPause = state[pausedKey] && state[pauseSourceKey] === 'quota';

        if (belowThreshold && (!state[pausedKey] || isOurPause)) {
            const parsedReset = resetDate ? Date.parse(resetDate) : NaN;
            const until = Number.isFinite(parsedReset) && parsedReset > now
                ? parsedReset
                : now + FALLBACK_PAUSE_MS;

            state[pausedKey] = true;
            state[pausedUntilKey] = until;
            state[pauseSourceKey] = 'quota';
            doPause(until);
            getLogger().info(
                LogCategory.AI,
                `[QuotaPauseWatcher] auto-paused (${pauseSourceKey}) until ${new Date(until).toISOString()}`,
            );
        } else if (isOurPause && !belowThreshold) {
            state[pausedKey] = false;
            state[pausedUntilKey] = undefined;
            state[pauseSourceKey] = undefined;
            doResume();
            getLogger().info(LogCategory.AI, `[QuotaPauseWatcher] auto-resumed (${pauseSourceKey})`);
        }
    }
}
