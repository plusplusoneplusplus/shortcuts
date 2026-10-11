import type { SentinelTodoOwner } from '../sentinel-todos/sentinel-todo-store';
import { nextCronTime } from '../schedule/cron-utils';
import { ScheduleTimerRegistry } from '../schedule/schedule-timer-registry';
import { validateScrubCron } from './scrubber-model';
import type { ScrubberRunService } from './scrubber-runs';
import type { ScrubberStore } from './scrubber-store';

/** Future-only, owner-scoped cron ticks. RunService owns overlap and unchanged skips. */
export class ScrubberScheduler {
    private readonly timers = new ScheduleTimerRegistry();
    private readonly generations = new Map<string, { validated: boolean }>();
    private disposed = false;

    constructor(private readonly deps: {
        scrubber: Pick<ScrubberStore, 'getConfig' | 'listEnabledOwners'>;
        runs: Pick<ScrubberRunService, 'start'>;
        getEnabled: () => boolean;
        assertOwner: (owner: SentinelTodoOwner) => Promise<void>;
        now?: () => Date;
    }) {}

    refreshAll(): void {
        this.timers.clear();
        this.generations.clear();
        if (this.disposed || !this.deps.getEnabled()) return;
        for (const owner of this.deps.scrubber.listEnabledOwners()) this.refresh(owner);
    }

    refresh(owner: SentinelTodoOwner): void {
        const key = JSON.stringify([owner.workspaceId, owner.processId]);
        this.timers.cancel(key);
        this.generations.delete(key);
        if (this.disposed || !this.deps.getEnabled()) return;
        const config = this.deps.scrubber.getConfig(owner);
        if (!config.enabled || config.paused || validateScrubCron(config.cron, this.now())) return;
        const generation = { validated: false };
        this.generations.set(key, generation);
        void this.arm(owner, key, generation).catch(error => {
            console.error('[sentinel-scrubber] Could not arm schedule:', error);
        });
    }

    dispose(): void {
        this.disposed = true;
        this.timers.clear();
        this.generations.clear();
    }

    /** Snapshot admission must still belong to a current, validated owner timer. */
    canStart(owner: SentinelTodoOwner): boolean {
        const key = JSON.stringify([owner.workspaceId, owner.processId]);
        const generation = this.generations.get(key);
        return !!generation?.validated && this.current(key, generation);
    }

    private current(key: string, generation: object): boolean {
        return !this.disposed && this.deps.getEnabled() && this.generations.get(key) === generation;
    }

    private async arm(owner: SentinelTodoOwner, key: string, generation: { validated: boolean }): Promise<void> {
        try { await this.deps.assertOwner(owner); }
        catch { if (this.current(key, generation)) this.generations.delete(key); return; }
        if (!this.current(key, generation)) return;
        generation.validated = true;
        const config = this.deps.scrubber.getConfig(owner);
        if (!config.enabled || config.paused) return;
        const next = nextCronTime(config.cron, this.now());
        if (!next) return;
        this.timers.set(key, () => {
            // Long delays are capped by the shared registry. Re-arm the same due date.
            if (this.now().getTime() < next.getTime()) {
                if (this.current(key, generation)) void this.arm(owner, key, generation);
                return;
            }
            void this.tick(owner, key, generation);
        }, next.getTime() - this.now().getTime());
    }

    private async tick(owner: SentinelTodoOwner, key: string, generation: { validated: boolean }): Promise<void> {
        try {
            await this.deps.assertOwner(owner);
            if (!this.current(key, generation)) return;
            const config = this.deps.scrubber.getConfig(owner);
            if (!config.enabled || config.paused) return;
            await this.deps.runs.start(owner, { trigger: 'schedule' });
        } catch (error) {
            console.error('[sentinel-scrubber] Could not start scheduled run:', error);
        } finally {
            if (this.current(key, generation)) this.refresh(owner);
        }
    }

    private now(): Date { return this.deps.now?.() ?? new Date(); }
}
