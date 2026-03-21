/**
 * Schedule Infrastructure Builder
 *
 * Creates the schedule-related objects (ScheduleYamlPersistence,
 * ScheduleRunPersistence, RepoScheduleOverrideStore, ScheduleManager)
 * used by the execution server and returns them as a plain object.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { TaskQueueManager } from '@plusplusoneplusplus/forge';
import { ScheduleYamlPersistence } from '../schedule-yaml-persistence';
import { ScheduleRunPersistence } from '../schedule-run-persistence';
import { ScheduleManager } from '../schedule-manager';
import { RepoScheduleOverrideStore } from '../repo-schedule-overrides';

// ============================================================================
// Types
// ============================================================================

export interface ScheduleInfrastructure {
    scheduleManager: ScheduleManager;
    scheduleRunPersistence: ScheduleRunPersistence;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates and wires up the schedule infrastructure required by the execution
 * server. Persisted schedule state is restored before returning.
 *
 * @param dataDir     - Root data directory (e.g. `~/.coc/`).
 * @param queueFacade - Aggregate queue facade used by the schedule manager to
 *                      enqueue triggered jobs.
 */
export function createScheduleInfrastructure(
    dataDir: string,
    queueFacade: TaskQueueManager,
): ScheduleInfrastructure {
    const schedulePersistence = new ScheduleYamlPersistence(dataDir);
    schedulePersistence.migrateAllFromJson(); // non-destructive, idempotent
    const scheduleRunPersistence = new ScheduleRunPersistence(dataDir);
    const scheduleOverrideStore = new RepoScheduleOverrideStore(dataDir);
    const scheduleManager = new ScheduleManager(
        schedulePersistence,
        queueFacade,
        scheduleOverrideStore,
    );
    scheduleManager.restore();
    scheduleManager.restoreRunHistory(scheduleRunPersistence);
    return { scheduleManager, scheduleRunPersistence };
}
