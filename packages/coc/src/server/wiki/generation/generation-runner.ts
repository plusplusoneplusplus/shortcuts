/**
 * Wiki Generation Runner
 *
 * Executes the five-phase deep-wiki workflow as a state machine that emits
 * typed generation events. It has no knowledge of HTTP — the caller supplies a
 * sink (SSE in production, an array in tests).
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as path from 'path';
import * as fs from 'fs';
import type { GenerateWiki } from '../wiki-backend';
import type { GenerationEventSink } from './events';
import type { GenerationHandle } from './generation-registry';
import { defaultDeepWikiAdapter, type DeepWikiAdapter } from './deep-wiki-adapter';

export interface RunWikiGenerationOptions {
    wiki: GenerateWiki;
    startPhase: number;
    endPhase: number;
    force: boolean;
    emit: GenerationEventSink;
    handle: GenerationHandle;
    adapter?: DeepWikiAdapter;
}

/**
 * Run phases `startPhase`..`endPhase`.
 *
 * Any phase failure emits an `error` event followed by a failing `done` event
 * and stops the run — later phases would operate on missing prerequisites.
 * Phase 5 is the exception: its failure is reported but not fatal, matching the
 * fact that the website build is derived output.
 */
export async function runWikiGeneration(options: RunWikiGenerationOptions): Promise<void> {
    const { wiki, startPhase, endPhase, force, emit, handle } = options;
    const adapter = options.adapter ?? defaultDeepWikiAdapter;

    const repoPath = path.resolve(wiki.registration.repoPath!);
    const outputDir = wiki.registration.wikiDir;
    const totalStartTime = Date.now();
    const isCancelled = () => handle.isCancelled();

    const phaseOptions = {
        output: outputDir,
        depth: 'normal' as const,
        force,
        useCache: !force,
        verbose: false,
        phase: startPhase,
        endPhase,
    };

    const { runPhase1, runPhase2Consolidation, runPhase3Analysis, runPhase4Writing, runPhase5Website } =
        await adapter.loadPhases();
    const { getCachedGraphAny, getCachedGraph, getCachedAnalyses, getCachedConsolidationAny, getCachedConsolidation } =
        await adapter.loadCache();

    // Phases 1-4 all need the AI backend; phase 5 is a pure build step.
    if (endPhase <= 4 || startPhase <= 4) {
        const availability = await adapter.checkAIAvailability();
        if (!availability.available) {
            emit({ type: 'error', message: `Copilot SDK not available: ${availability.reason || 'Unknown'}` });
            emit({ type: 'done', success: false, error: 'AI service unavailable' });
            return;
        }
    }

    const usageTracker = await adapter.createUsageTracker();
    let graph: any;
    let analyses: any[] | undefined;
    let reanalyzedComponentIds: string[] | undefined;

    // ------------------------------------------------------------------
    // Phase 1: Discovery
    // ------------------------------------------------------------------
    if (startPhase <= 1 && endPhase >= 1) {
        if (isCancelled()) { emit({ type: 'done', success: false, error: 'Cancelled' }); return; }
        handle.setPhase(1);
        emit({ type: 'status', phase: 1, state: 'running', message: 'Starting discovery...' });
        const phaseStart = Date.now();
        try {
            const result = await runPhase1(repoPath, phaseOptions, isCancelled);
            if (result.exitCode !== undefined) {
                emit({ type: 'error', phase: 1, message: `Discovery failed (exit code ${result.exitCode})` });
                emit({ type: 'done', success: false, error: 'Phase 1 failed' }); return;
            }
            graph = result.graph!;
            if (result.tokenUsage) usageTracker.addUsage('discovery', result.tokenUsage);
            emit({ type: 'phase-complete', phase: 1, success: true, duration: Date.now() - phaseStart, message: `Discovered ${graph.components.length} components` });
        } catch (error) {
            emit({ type: 'error', phase: 1, message: error instanceof Error ? error.message : String(error) });
            emit({ type: 'done', success: false, error: 'Phase 1 failed' }); return;
        }
    } else if (startPhase > 1) {
        const cached = getCachedGraphAny(outputDir) ?? await getCachedGraph(repoPath, outputDir);
        if (!cached) {
            emit({ type: 'error', message: 'No cached component graph found. Run Discovery first.' });
            emit({ type: 'done', success: false, error: 'Missing prerequisite: Discovery' }); return;
        }
        graph = cached.graph;
        emit({ type: 'log', phase: startPhase, message: `Loaded cached component graph (${graph.components.length} components)` });
    }

    if (!graph) {
        emit({ type: 'error', message: 'No component graph available' });
        emit({ type: 'done', success: false, error: 'No component graph' }); return;
    }

    // ------------------------------------------------------------------
    // Phase 2: Consolidation
    // ------------------------------------------------------------------
    if (startPhase <= 2 && endPhase >= 2) {
        if (isCancelled()) { emit({ type: 'done', success: false, error: 'Cancelled' }); return; }
        handle.setPhase(2);
        emit({ type: 'status', phase: 2, state: 'running', message: 'Starting consolidation...' });
        const phaseStart = Date.now();
        try {
            const result = await runPhase2Consolidation(repoPath, graph, phaseOptions, usageTracker);
            graph = result.graph;
            emit({ type: 'phase-complete', phase: 2, success: true, duration: Date.now() - phaseStart, message: `Consolidated to ${graph.components.length} components` });
        } catch (error) {
            emit({ type: 'error', phase: 2, message: error instanceof Error ? error.message : String(error) });
            emit({ type: 'done', success: false, error: 'Phase 2 failed' }); return;
        }
    } else if (startPhase > 2 && graph.components.length > 0) {
        // When skipping Phase 2, load the consolidated graph from cache so
        // downstream phases operate on the reduced component set.
        const consolidatedCache = getCachedConsolidationAny(outputDir, graph.components.length)
            ?? await getCachedConsolidation(repoPath, outputDir, graph.components.length);
        if (consolidatedCache) {
            const prevCount = graph.components.length;
            graph = consolidatedCache.graph;
            emit({ type: 'log', phase: startPhase, message: `Loaded consolidated graph (${prevCount} → ${graph.components.length} components)` });
        }
    }

    // ------------------------------------------------------------------
    // Phase 3: Analysis
    // ------------------------------------------------------------------
    if (startPhase <= 3 && endPhase >= 3) {
        if (isCancelled()) { emit({ type: 'done', success: false, error: 'Cancelled' }); return; }
        handle.setPhase(3);
        emit({ type: 'status', phase: 3, state: 'running', message: 'Starting analysis...' });
        const phaseStart = Date.now();
        try {
            const result = await runPhase3Analysis(repoPath, graph, phaseOptions, isCancelled, usageTracker);
            if (result.exitCode !== undefined) {
                emit({ type: 'error', phase: 3, message: `Analysis failed (exit code ${result.exitCode})` });
                emit({ type: 'done', success: false, error: 'Phase 3 failed' }); return;
            }
            analyses = result.analyses!;
            reanalyzedComponentIds = result.reanalyzedComponentIds;
            emit({ type: 'phase-complete', phase: 3, success: true, duration: Date.now() - phaseStart, message: `Analyzed ${analyses!.length} components` });
        } catch (error) {
            emit({ type: 'error', phase: 3, message: error instanceof Error ? error.message : String(error) });
            emit({ type: 'done', success: false, error: 'Phase 3 failed' }); return;
        }
    } else if (startPhase > 3 && endPhase >= 4) {
        const cached = getCachedAnalyses(outputDir);
        if (!cached || cached.length === 0) {
            emit({ type: 'error', message: 'No cached analyses found. Run Analysis first.' });
            emit({ type: 'done', success: false, error: 'Missing prerequisite: Analysis' }); return;
        }
        // Filter to only analyses whose component IDs exist in the current
        // (possibly consolidated) graph — stale files from pre-consolidation
        // runs may still be on disk.
        const graphIds = new Set(graph.components.map((m: any) => m.id));
        analyses = graphIds.size > 0
            ? cached.filter((a: any) => graphIds.has(a.componentId))
            : cached;
        emit({ type: 'log', phase: startPhase, message: `Loaded ${analyses!.length} cached analyses` });
    }

    // ------------------------------------------------------------------
    // Phase 4: Writing
    // ------------------------------------------------------------------
    if (startPhase <= 4 && endPhase >= 4) {
        if (isCancelled()) { emit({ type: 'done', success: false, error: 'Cancelled' }); return; }
        if (!analyses) {
            emit({ type: 'error', message: 'No analyses available for writing phase' });
            emit({ type: 'done', success: false, error: 'Missing analyses' }); return;
        }
        handle.setPhase(4);
        emit({ type: 'status', phase: 4, state: 'running', message: 'Starting article writing...' });
        const phaseStart = Date.now();
        try {
            const result = await runPhase4Writing(repoPath, graph, analyses!, phaseOptions, isCancelled, usageTracker, reanalyzedComponentIds);
            if (result.exitCode !== undefined) {
                emit({ type: 'error', phase: 4, message: `Writing failed (exit code ${result.exitCode})` });
                emit({ type: 'done', success: false, error: 'Phase 4 failed' }); return;
            }
            emit({ type: 'phase-complete', phase: 4, success: true, duration: Date.now() - phaseStart, message: `Wrote ${result.articlesWritten} articles` });
        } catch (error) {
            emit({ type: 'error', phase: 4, message: error instanceof Error ? error.message : String(error) });
            emit({ type: 'done', success: false, error: 'Phase 4 failed' }); return;
        }
    }

    // ------------------------------------------------------------------
    // Phase 5: Website
    // ------------------------------------------------------------------
    if (startPhase <= 5 && endPhase >= 5) {
        if (isCancelled()) { emit({ type: 'done', success: false, error: 'Cancelled' }); return; }
        handle.setPhase(5);
        emit({ type: 'status', phase: 5, state: 'running', message: 'Building website...' });

        if (graph) {
            const graphOutputFile = path.join(path.resolve(outputDir), 'component-graph.json');
            try {
                fs.mkdirSync(path.resolve(outputDir), { recursive: true });
                fs.writeFileSync(graphOutputFile, JSON.stringify(graph, null, 2), 'utf-8');
            } catch { /* non-fatal */ }
        }

        const phaseStart = Date.now();
        try {
            const result = runPhase5Website(phaseOptions);
            if (result.success) {
                emit({ type: 'phase-complete', phase: 5, success: true, duration: Date.now() - phaseStart, message: 'Website generated' });
            } else {
                emit({ type: 'error', phase: 5, message: 'Website generation failed' });
            }
        } catch (error) {
            emit({ type: 'error', phase: 5, message: error instanceof Error ? error.message : String(error) });
        }
    }

    // Phases 4+ change articles on disk, so the served wiki data is now stale.
    if (endPhase >= 4) {
        reloadWikiData(wiki, emit);
    }

    emit({ type: 'done', success: true, duration: Date.now() - totalStartTime });
}

/** Reload served wiki data, reporting failure as a log line rather than an error. */
export function reloadWikiData(wiki: GenerateWiki, emit: GenerationEventSink): void {
    try {
        wiki.wikiData.reload();
        emit({ type: 'log', message: 'Wiki data reloaded' });
    } catch (error) {
        emit({ type: 'log', message: `Warning: Failed to reload wiki data: ${error instanceof Error ? error.message : String(error)}` });
    }
}
