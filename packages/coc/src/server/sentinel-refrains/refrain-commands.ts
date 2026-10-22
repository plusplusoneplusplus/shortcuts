import type { SentinelRefrain, SentinelRefrainGateTest, SentinelRefrainInput } from '@plusplusoneplusplus/coc-client';
import type { SentinelTodoOwner } from '../sentinel-todos/sentinel-todo-store';
import type { RefrainRunRecord, SentinelRefrainStore } from './refrain-store';
import type { SentinelRefrainService } from './refrain-service';

export interface SentinelRefrainCommandsDeps {
    jobs: SentinelRefrainStore;
    service: SentinelRefrainService;
    /** Re-arms schedules after a configuration write. */
    onConfigChange?: () => void;
}

/**
 * Owner-validated custom-job commands shared by REST and the `sentinel_jobs`
 * tool. Every command re-proves the owner and feature flag before touching
 * the store; validation, revisions and run admission stay in the store/service.
 */
export class SentinelRefrainCommands {
    constructor(private readonly deps: SentinelRefrainCommandsDeps) {}

    /** Live availability and ownership gate, also used before scrubber tool dispatch. */
    assertOwner(owner: SentinelTodoOwner): Promise<void> {
        return this.deps.service.assertOwner(owner);
    }

    async list(owner: SentinelTodoOwner): Promise<SentinelRefrain[]> {
        await this.deps.service.assertOwner(owner);
        return this.deps.jobs.list(owner).map(job => this.deps.service.view(owner, job));
    }

    async get(owner: SentinelTodoOwner, id: string): Promise<SentinelRefrain> {
        await this.deps.service.assertOwner(owner);
        return this.deps.service.view(owner, this.deps.jobs.get(owner, id));
    }

    async create(owner: SentinelTodoOwner, input: SentinelRefrainInput): Promise<SentinelRefrain> {
        await this.deps.service.assertOwner(owner);
        const job = this.deps.jobs.create(owner, input);
        this.deps.onConfigChange?.();
        return this.deps.service.view(owner, job);
    }

    async update(owner: SentinelTodoOwner, id: string, settings: Partial<SentinelRefrainInput>,
        expectedRevision: number): Promise<SentinelRefrain> {
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

    start(owner: SentinelTodoOwner, id: string): Promise<RefrainRunRecord> {
        return this.deps.service.start(owner, id);
    }

    cancel(owner: SentinelTodoOwner, id: string, runId: string): Promise<RefrainRunRecord> {
        return this.deps.service.cancel(owner, id, runId);
    }

    testGate(owner: SentinelTodoOwner, id: string, signal?: AbortSignal): Promise<SentinelRefrainGateTest> {
        return this.deps.service.testGate(owner, id, signal);
    }

    async resumeGate(owner: SentinelTodoOwner, id: string): Promise<SentinelRefrain> {
        return this.deps.service.view(owner, await this.deps.service.resumeGate(owner, id));
    }
}
