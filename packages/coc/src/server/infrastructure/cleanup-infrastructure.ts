/**
 * Cleanup Infrastructure Builder
 *
 * Creates and wires up the OutputPruner and StaleTaskDetector used by the
 * execution server.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { OutputPruner } from '../output-pruner';
import { StaleTaskDetector } from '../stale-task-detector';
import { MemoryExtractionSweep } from '../memory/memory-extraction-sweep';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import { getServerLogger } from '../server-logger';
import type { AIInvoker, ProcessStore, TaskQueueManager } from '@plusplusoneplusplus/forge';
import type { ExtractionConfig } from '../memory/extraction-config';

// ============================================================================
// Types
// ============================================================================

export interface CleanupInfrastructure {
    outputPruner: OutputPruner;
    staleDetector: StaleTaskDetector;
    extractionSweep: MemoryExtractionSweep;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates and wires up the cleanup infrastructure (OutputPruner +
 * StaleTaskDetector + MemoryExtractionSweep) required by the execution server.
 *
 * @param store       - Process store for task tracking.
 * @param dataDir     - Root data directory (e.g. `~/.coc/`).
 * @param queueFacade - Aggregate queue facade for stale task detection.
 * @param aiInvoker   - AI invoker for memory extraction.
 * @param extractionConfig - Optional extraction configuration overrides.
 */
export function createCleanupInfrastructure(
    store: ProcessStore,
    dataDir: string,
    queueFacade: TaskQueueManager,
    aiInvoker?: AIInvoker,
    extractionConfig?: Partial<ExtractionConfig>,
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

    const extractionSweep = new MemoryExtractionSweep({
        store,
        dataDir,
        aiInvoker: aiInvoker ?? (() => Promise.resolve({ success: false, error: 'No AI invoker configured' })),
        queueFacade,
        config: extractionConfig,
    });
    extractionSweep.start();

    return { outputPruner, staleDetector, extractionSweep };
}
