/**
 * Schedule snapshot domain.
 *
 * Thin adapter over {@link ScheduleSnapshotRepository}, which owns the
 * schedule-specific YAML file and `schedule_runs` row behavior next to the
 * schedule persistence code.
 */

import type { ScheduleWipePlan } from '../../schedule/schedule-snapshot-repository';
import { ScheduleSnapshotRepository } from '../../schedule/schedule-snapshot-repository';
import type { StorageSnapshotDomain } from './types';
import { getErrorMessage } from './snapshot-fs';

export function createScheduleDomain(): StorageSnapshotDomain<ScheduleWipePlan> {
    const repository = new ScheduleSnapshotRepository();

    return {
        id: 'schedules',
        collect(ctx) {
            const result = repository.collect(ctx.dataDir, ctx.store);
            return {
                data: { scheduleHistory: result.snapshots },
                metadata: { scheduleFileCount: result.snapshots.length },
                warnings: result.warnings,
            };
        },
        restoreReplace(payload, ctx, result) {
            if (!payload.scheduleHistory) { return; }
            result.importedScheduleFiles = repository.writeReplace(ctx.dataDir, ctx.store, payload.scheduleHistory, result.errors);
        },
        restoreMerge(payload, ctx, result) {
            if (!payload.scheduleHistory) { return; }
            result.importedScheduleFiles = repository.writeMerge(ctx.dataDir, ctx.store, payload.scheduleHistory, result.errors);
        },
        planWipe(ctx) {
            const plan = repository.planWipe(ctx.dataDir);
            return {
                plan,
                counts: { deletedSchedules: plan.scheduleFiles.length + repository.countScheduleRuns(ctx.store) },
                errors: [],
            };
        },
        executeWipe(ctx, plan, result) {
            try {
                repository.deleteScheduleRuns(ctx.store);
            } catch (err) {
                result.errors.push(`Failed to clear schedule_runs table: ${getErrorMessage(err)}`);
            }
            repository.executeWipe(plan, result.errors);
        },
    };
}
