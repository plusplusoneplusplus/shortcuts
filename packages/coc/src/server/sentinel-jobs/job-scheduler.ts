import { nextCronTime } from '../schedule/cron-utils';
import { ScheduleTimerRegistry } from '../schedule/schedule-timer-registry';
import type { SentinelTodoOwner } from '../sentinel-todos/sentinel-todo-store';
import type { SentinelJobStore } from './job-store';
import type { SentinelJobService } from './job-service';

/** Future-only local-server cron dates. Each job re-arms at admission, not completion. */
export class SentinelJobScheduler {
    private readonly timers = new ScheduleTimerRegistry();
    private generation = 0;
    private disposed = false;
    constructor(private readonly deps: {
        jobs: SentinelJobStore;
        service: Pick<SentinelJobService, 'assertOwner' | 'start'>;
        getEnabled: () => boolean;
        now?: () => Date;
    }) {}

    refreshAll(): void {
        const generation = ++this.generation;
        this.timers.clear();
        if (this.disposed || !this.deps.getEnabled()) return;
        for (const { owner, job } of this.deps.jobs.all()) {
            if (job.enabled && job.cron) void this.arm(owner, job.id, generation).catch(error =>
                console.error('[sentinel-jobs] Could not arm job schedule:', error));
        }
    }

    dispose(): void { this.disposed = true; this.generation++; this.timers.clear(); }

    private current(generation: number): boolean {
        return !this.disposed && generation === this.generation && this.deps.getEnabled();
    }

    private async arm(owner: SentinelTodoOwner, id: string, generation: number, due?: Date): Promise<void> {
        try { await this.deps.service.assertOwner(owner); } catch { return; }
        if (!this.current(generation)) return;
        const job = this.deps.jobs.get(owner, id);
        if (!job.enabled || !job.cron) return;
        const now = this.deps.now?.() ?? new Date();
        const next = due ?? nextCronTime(job.cron, now);
        if (!next) return;
        const key = JSON.stringify([owner.workspaceId, owner.processId, id]);
        this.timers.set(key, () => {
            if (!this.current(generation)) return;
            if ((this.deps.now?.() ?? new Date()).getTime() < next.getTime()) {
                void this.arm(owner, id, generation, next);
                return;
            }
            // Re-arm independently of run completion, so overlaps remain observable.
            void this.arm(owner, id, generation);
            void this.deps.service.start(owner, id, 'schedule', () => this.current(generation)
                && this.deps.jobs.get(owner, id).revision === job.revision).catch(error =>
                console.error('[sentinel-jobs] Scheduled job admission failed:', error));
        }, next.getTime() - now.getTime());
    }
}
