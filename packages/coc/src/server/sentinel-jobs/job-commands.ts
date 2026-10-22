import type { SentinelScheduledJob, SentinelScheduledJobGateTest, SentinelScheduledJobInput } from '@plusplusoneplusplus/coc-client';
import type { SentinelTodoOwner } from '../sentinel-todos/sentinel-todo-store';
import type { JobRunRecord, SentinelJobStore } from './job-store';
import type { SentinelJobService } from './job-service';

export interface SentinelJobCommandsDeps {
    jobs: SentinelJobStore;
    service: SentinelJobService;
    /** Re-arms schedules after a configuration write. */
    onConfigChange?: () => void;
}

/**
 * Owner-validated custom-job commands shared by REST and the `sentinel_jobs`
 * tool. Every command re-proves the owner and feature flag before touching
 * the store; validation, revisions and run admission stay in the store/service.
 */
export class SentinelJobCommands {
    constructor(private readonly deps: SentinelJobCommandsDeps) {}

    /** Live availability and ownership gate, also used before scrubber tool dispatch. */
    assertOwner(owner: SentinelTodoOwner): Promise<void> {
        return this.deps.service.assertOwner(owner);
    }

    async list(owner: SentinelTodoOwner): Promise<SentinelScheduledJob[]> {
        await this.deps.service.assertOwner(owner);
        return this.deps.jobs.list(owner).map(job => this.deps.service.view(owner, job));
    }

    async get(owner: SentinelTodoOwner, id: string): Promise<SentinelScheduledJob> {
        await this.deps.service.assertOwner(owner);
        return this.deps.service.view(owner, this.deps.jobs.get(owner, id));
    }

    async create(owner: SentinelTodoOwner, input: SentinelScheduledJobInput): Promise<SentinelScheduledJob> {
        await this.deps.service.assertOwner(owner);
        const job = this.deps.jobs.create(owner, input);
        this.deps.onConfigChange?.();
        return this.deps.service.view(owner, job);
    }

    async update(owner: SentinelTodoOwner, id: string, settings: Partial<SentinelScheduledJobInput>,
        expectedRevision: number): Promise<SentinelScheduledJob> {
        await this.deps.service.assertOwner(owner);
        const job = this.deps.jobs.update(owner, id, settings, expectedRevision);
        this.deps.service.cancelGate(owner, id);
        this.deps.onConfigChange?.();
        return this.deps.service.view(owner, job);
    }

    async delete(owner: SentinelTodoOwner, id: string, expectedRevision: number): Promise<void> {
        await this.deps.service.assertOwner(owner);
        this.deps.jobs.delete(owner, id, expectedRevision);
        this.deps.service.cancelGate(owner, id);
        this.deps.onConfigChange?.();
        await this.deps.service.removeSnapshots(owner, id);
    }

    start(owner: SentinelTodoOwner, id: string): Promise<JobRunRecord> {
        return this.deps.service.start(owner, id);
    }

    cancel(owner: SentinelTodoOwner, id: string, runId: string): Promise<JobRunRecord> {
        return this.deps.service.cancel(owner, id, runId);
    }

    testGate(owner: SentinelTodoOwner, id: string, signal?: AbortSignal): Promise<SentinelScheduledJobGateTest> {
        return this.deps.service.testGate(owner, id, signal);
    }

    async resumeGate(owner: SentinelTodoOwner, id: string): Promise<SentinelScheduledJob> {
        return this.deps.service.view(owner, await this.deps.service.resumeGate(owner, id));
    }
}
