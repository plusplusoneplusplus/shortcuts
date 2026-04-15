/**
 * Memory Extraction Sweep
 *
 * Periodic background sweep that finds completed conversations needing
 * fact extraction, dispatches extraction jobs via TranscriptExtractor,
 * and optionally triggers consolidation when enough raw observations
 * accumulate.
 *
 * Follows the same start/stop/dispose pattern as StaleTaskDetector.
 *
 * No VS Code dependencies — pure Node.js.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { AIInvoker, ProcessStore, TaskQueueManager } from '@plusplusoneplusplus/forge';
import { FileMemoryStore as ObservationStore } from '@plusplusoneplusplus/forge';
import { TranscriptExtractor } from './transcript-extractor';
import { ExtractionStateManager } from './extraction-state';
import { readMemoryConfig } from './memory-config-handler';
import { readRepoPreferences } from '../preferences-handler';
import { getRepoDataPath } from '../paths';
import type { ExtractionConfig } from './extraction-config';
import { DEFAULT_EXTRACTION_CONFIG } from './extraction-config';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface MemoryExtractionSweepOptions {
    store: ProcessStore;
    dataDir: string;
    aiInvoker: AIInvoker;
    queueFacade?: TaskQueueManager;
    config?: Partial<ExtractionConfig>;
}

// ============================================================================
// MemoryExtractionSweep
// ============================================================================

export class MemoryExtractionSweep {
    private readonly store: ProcessStore;
    private readonly dataDir: string;
    private readonly aiInvoker: AIInvoker;
    private readonly queueFacade?: TaskQueueManager;
    private readonly config: ExtractionConfig;
    private readonly extractor: TranscriptExtractor;
    private timer: ReturnType<typeof setInterval> | null = null;
    private sweeping = false;

    constructor(options: MemoryExtractionSweepOptions) {
        this.store = options.store;
        this.dataDir = options.dataDir;
        this.aiInvoker = options.aiInvoker;
        this.queueFacade = options.queueFacade;
        this.config = { ...DEFAULT_EXTRACTION_CONFIG, ...options.config };

        this.extractor = new TranscriptExtractor({
            dataDir: this.dataDir,
            store: this.store,
            aiInvoker: this.aiInvoker,
            model: this.config.model,
            minTurns: this.config.minTurns,
        });
    }

    /**
     * Start periodic sweep.
     */
    start(): void {
        if (!this.config.enabled) return;
        if (this.timer) return;
        this.timer = setInterval(() => {
            this.sweep().catch(() => {
                // Non-fatal — will retry next cycle
            });
        }, this.config.sweepIntervalMs);
    }

    /**
     * Stop periodic sweep.
     */
    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /**
     * Dispose the sweep — stop the timer.
     */
    dispose(): void {
        this.stop();
    }

    /**
     * Run a single sweep pass.
     * Finds completed processes that are idle and haven't been extracted yet,
     * extracts facts, and optionally triggers consolidation.
     *
     * @returns Number of processes successfully extracted.
     */
    async sweep(): Promise<number> {
        // Prevent overlapping sweeps
        if (this.sweeping) return 0;
        this.sweeping = true;

        try {
            return await this.doSweep();
        } finally {
            this.sweeping = false;
        }
    }

    private async doSweep(): Promise<number> {
        const idleCutoff = new Date(Date.now() - this.config.idleThresholdMs);

        // Use getProcessSummaries for lightweight queries with workspace info.
        // Fall back to getAllProcesses for stores that don't support summaries.
        const candidates = await this.getCandidates(idleCutoff);

        if (candidates.length === 0) return 0;

        // Group by workspace
        const byWorkspace = new Map<string, Array<{ id: string; turnCount: number }>>();
        for (const c of candidates) {
            if (!c.workspaceId) continue;
            if (!byWorkspace.has(c.workspaceId)) {
                byWorkspace.set(c.workspaceId, []);
            }
            byWorkspace.get(c.workspaceId)!.push({ id: c.id, turnCount: c.turnCount });
        }

        let extracted = 0;

        for (const [wsId, procs] of byWorkspace) {
            if (!this.isMemoryEnabled(wsId)) continue;

            const stateManager = new ExtractionStateManager(this.dataDir, wsId);

            for (const candidate of procs) {
                if (extracted >= this.config.batchSize) break;
                if (!stateManager.needsExtraction(candidate.id, candidate.turnCount)) continue;

                try {
                    const result = await this.extractor.extract(candidate.id, wsId);
                    if (!result.error && !result.skipped) {
                        stateManager.markExtracted(candidate.id, candidate.turnCount);
                        stateManager.save();
                        extracted++;
                    }
                } catch {
                    // Non-fatal — will retry next sweep
                }
            }

            // Auto-consolidation check
            if (extracted > 0) {
                await this.maybeConsolidate(wsId);
            }
        }

        return extracted;
    }

    /**
     * Get candidate processes for extraction.
     * Uses getProcessSummaries (lightweight) if available, falls back to getAllProcesses.
     */
    private async getCandidates(idleCutoff: Date): Promise<Array<{ id: string; workspaceId: string; turnCount: number }>> {
        if (this.store.getProcessSummaries) {
            const { entries } = await this.store.getProcessSummaries({
                status: 'completed',
                limit: this.config.batchSize * 3,
            });

            return entries
                .filter(e => {
                    const lastActivity = e.lastEventAt ? new Date(e.lastEventAt) : new Date(e.startTime);
                    return lastActivity < idleCutoff && e.workspaceId;
                })
                .map(e => ({ id: e.id, workspaceId: e.workspaceId, turnCount: 0 }));
        }

        // Fallback: use getAllProcesses with exclude=['conversation'] for lightweight queries
        const processes = await this.store.getAllProcesses({
            status: 'completed',
            limit: this.config.batchSize * 3,
            exclude: ['conversation'],
        });

        return processes
            .filter(p => {
                const wsId = p.metadata?.workspaceId;
                if (!wsId) return false;
                const lastActivity = p.endTime ?? p.startTime;
                return lastActivity < idleCutoff;
            })
            .map(p => ({
                id: p.id,
                workspaceId: p.metadata!.workspaceId!,
                turnCount: p.conversationTurns?.length ?? 0,
            }));
    }

    /**
     * Check per-repo preferences for memory extraction enabled flag.
     */
    private isMemoryEnabled(workspaceId: string): boolean {
        try {
            const prefs = readRepoPreferences(this.dataDir, workspaceId);
            return prefs.memoryExtraction?.enabled ?? false;
        } catch {
            return false;
        }
    }

    /**
     * If raw observation count exceeds the consolidation threshold,
     * enqueue a memory-aggregate task.
     */
    private async maybeConsolidate(workspaceId: string): Promise<void> {
        if (!this.queueFacade) return;

        try {
            const config = readMemoryConfig(this.dataDir);
            const repoDir = getRepoDataPath(this.dataDir, workspaceId, path.join('memory', 'observations'));
            const obsStore = new ObservationStore({ dataDir: config.storageDir, repoDir });
            const rawFiles = await obsStore.listRaw('repo', undefined);

            if (rawFiles.length >= this.config.consolidationThreshold) {
                this.queueFacade.enqueue({
                    type: 'memory-aggregate',
                    repoId: workspaceId,
                    payload: {
                        kind: 'memory-aggregate',
                        repoId: workspaceId,
                    },
                    priority: 'normal',
                    config: {},
                    concurrencyMode: 'exclusive',
                    displayName: 'Memory Consolidation (auto)',
                });
            }
        } catch {
            // Non-fatal — consolidation can happen on next sweep
        }
    }
}
