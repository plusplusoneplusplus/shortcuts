/**
 * Creates and wires up the OutputPruner and StaleTaskDetector used by the
 * execution server.
 */

import { OutputPruner } from '../processes/output-pruner';
import { StaleTaskDetector } from '../processes/stale-task-detector';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import { getServerLogger } from '../logging/server-logger';
import type { ProcessStore, TaskQueueManager } from '@plusplusoneplusplus/forge';

// ============================================================================
// Types
// ============================================================================

export interface CleanupInfrastructure {
    outputPruner: OutputPruner;
    staleDetector: StaleTaskDetector;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * @param dataDir     - Root data directory (e.g. `~/.coc/`).
 */
export function createCleanupInfrastructure(
    store: ProcessStore,
    dataDir: string,
    queueFacade: TaskQueueManager,
): CleanupInfrastructure {
    const outputPruner = new OutputPruner(store, dataDir);

    if (store instanceof FileProcessStore) {
        store.onPrune = (entries) => outputPruner.handlePrunedEntries(entries);
    }

    const staleDetector = new StaleTaskDetector(queueFacade, store);
    staleDetector.start();

    outputPruner.startListening();
    outputPruner.cleanupOrphans().catch((err) => {
        getServerLogger().warn({ err }, '[OutputPruner] orphan cleanup failed');
    });
    outputPruner.cleanupStaleQueueEntries().catch((err) => {
        getServerLogger().warn({ err }, '[OutputPruner] stale queue cleanup failed');
    });

    return { outputPruner, staleDetector };
}
