import type { SentinelScrubberConfig, SentinelScrubRunSummary } from '@plusplusoneplusplus/coc-client';
import { nextCronTime } from '../schedule/cron-utils';
import type { SentinelTodoService } from '../sentinel-todos/sentinel-todo-service';
import type { SentinelTodoOwner } from '../sentinel-todos/sentinel-todo-store';
import { validateScrubCron } from './scrubber-model';
import type { ScrubberRunService } from './scrubber-runs';
import { ScrubberStoreError, type ScrubberStore, type ScrubRunRecord } from './scrubber-store';

export interface ScrubberCommandsDeps {
    todos: Pick<SentinelTodoService, 'assertOwner'>;
    scrubber: ScrubberStore;
    runs: Pick<ScrubberRunService, 'start' | 'cancel'>;
    /** True only when the scrubber flag is enabled. */
    getEnabled: () => boolean;
    onChange?: (owner: SentinelTodoOwner, change: { runId?: string; ledgerChanged?: boolean; configChanged?: boolean }) => void;
}

export interface ScrubberView {
    config: SentinelScrubberConfig;
    activeRun?: ScrubRunRecord;
    runs: SentinelScrubRunSummary[];
}

/**
 * Owner-validated commands for the built-in To-do Scrubber singleton, shared
 * by REST and the `sentinel_jobs` tool. Findings review stays REST-only.
 */
export class ScrubberCommands {
    constructor(private readonly deps: ScrubberCommandsDeps) {}

    /** Proves the flag and Sentinel/workspace identity before any scrubber read or write. */
    async assertOwner(owner: SentinelTodoOwner): Promise<void> {
        if (!this.deps.getEnabled()) throw new ScrubberStoreError('not_found', 'Sentinel to-do scrubber is disabled');
        await this.deps.todos.assertOwner(owner);
    }

    async view(owner: SentinelTodoOwner): Promise<ScrubberView> {
        await this.assertOwner(owner);
        const activeRun = this.deps.scrubber.activeRun(owner);
        return { config: this.config(owner), ...(activeRun ? { activeRun } : {}),
            runs: this.deps.scrubber.listRuns(owner).map(run => this.summary(owner, run)) };
    }

    /** Saving (or resuming) the schedule clears an auto-pause, as in the Jobs panel. */
    async putConfig(owner: SentinelTodoOwner, input: { enabled: boolean; cron: string },
        expectedRevision: number): Promise<SentinelScrubberConfig> {
        await this.assertOwner(owner);
        const error = validateScrubCron(input.cron);
        if (error) throw new ScrubberStoreError('invalid', error);
        this.deps.scrubber.putConfig(owner, input, expectedRevision);
        this.deps.onChange?.(owner, { configChanged: true });
        return this.config(owner);
    }

    async start(owner: SentinelTodoOwner, itemIds?: string[]): Promise<ScrubRunRecord> {
        await this.assertOwner(owner);
        // Also enforce single-flight when the ledger currently has no eligible items.
        if (this.deps.scrubber.activeRun(owner)) throw new ScrubberStoreError('conflict', 'A scrub is already running for this ledger');
        return this.deps.runs.start(owner, { trigger: 'manual', ...(itemIds ? { itemIds } : {}) });
    }

    async cancel(owner: SentinelTodoOwner, runId: string): Promise<ScrubRunRecord> {
        await this.assertOwner(owner);
        return this.deps.runs.cancel(owner, runId);
    }

    private config(owner: SentinelTodoOwner): SentinelScrubberConfig {
        const config = this.deps.scrubber.getConfig(owner);
        const next = config.enabled && !config.paused ? nextCronTime(config.cron, new Date()) : undefined;
        return { ...config, ...(next ? { nextRunAt: next.toISOString() } : {}) };
    }

    private summary(owner: SentinelTodoOwner, run: ScrubRunRecord): SentinelScrubRunSummary {
        const findings = this.deps.scrubber.listFindings(owner, run.id);
        return {
            id: run.id, trigger: run.trigger, status: run.status, createdAt: run.createdAt,
            startedAt: run.startedAt, finishedAt: run.finishedAt, childProcessId: run.childProcessId,
            error: run.error, skipReason: run.skipReason, itemCount: run.snapshot.length,
            deferredCount: run.deferredItemIds.length, awaitingReviewCount: run.awaitingReviewItemIds.length,
            counts: {
                done: findings.filter(f => (f.state === 'applied' || f.state === 'accepted')
                    && (f.finding.verdict === 'done' || f.finding.verdict === 'obsolete')).length,
                proposals: findings.filter(f => f.state === 'proposed').length,
                unverified: findings.filter(f => f.state === 'unverified').length,
            },
        };
    }
}
