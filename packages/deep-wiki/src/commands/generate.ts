/**
 * Generate Command
 *
 * Implements the `deep-wiki generate <repo-path>` command.
 * Full pipeline wiki generation:
 *   Phase 1: Discovery      → ModuleGraph
 *   Phase 2: Consolidation  → Reduced ModuleGraph
 *   Phase 3: Analysis       → ModuleAnalysis[] (incremental with cache)
 *   Phase 4: Writing        → Wiki articles on disk
 *   Phase 5: Website        → Static HTML website
 *
 * Phase runner functions are in `./phases/`.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import * as fs from 'fs';
import type { GenerateCommandOptions, ModuleGraph, ModuleAnalysis } from '../types';
import { checkAIAvailability } from '../ai-invoker';
import { UsageTracker } from '../usage-tracker';
import type { TrackedPhase } from '../usage-tracker';
import {
    getCachedGraphAny,
    getCachedGraph,
    getCachedAnalyses,
} from '../cache';
import {
    printSuccess,
    printError,
    printWarning,
    printInfo,
    printHeader,
    printKeyValue,
    bold,
    gray,
} from '../logger';
import { EXIT_CODES } from '../cli';
import {
    runPhase1,
    runPhase2Consolidation,
    runPhase3Analysis,
    runPhase4Writing,
    runPhase5Website,
} from './phases';

// ============================================================================
// Execute Generate Command
// ============================================================================

/**
 * Execute the generate command — full pipeline wiki generation.
 *
 * @param repoPath - Path to the local git repository
 * @param options - Command options
 * @returns Exit code
 */
export async function executeGenerate(
    repoPath: string,
    options: GenerateCommandOptions
): Promise<number> {
    const startTime = Date.now();

    // Resolve to absolute path
    const absoluteRepoPath = path.resolve(repoPath);

    // Validate the repo path exists
    if (!fs.existsSync(absoluteRepoPath)) {
        printError(`Repository path does not exist: ${absoluteRepoPath}`);
        return EXIT_CODES.CONFIG_ERROR;
    }

    if (!fs.statSync(absoluteRepoPath).isDirectory()) {
        printError(`Repository path is not a directory: ${absoluteRepoPath}`);
        return EXIT_CODES.CONFIG_ERROR;
    }

    // Validate phase option
    const startPhase = options.phase || 1;
    if (startPhase < 1 || startPhase > 4) {
        printError(`Invalid --phase value: ${startPhase}. Must be 1, 2, 3, or 4.`);
        return EXIT_CODES.CONFIG_ERROR;
    }

    // Validate end-phase option
    const endPhase = options.endPhase !== undefined ? options.endPhase : 5; // default: run through Phase 5 (website)
    if (endPhase < 1 || endPhase > 5) {
        printError(`Invalid --end-phase value: ${endPhase}. Must be 1, 2, 3, 4, or 5.`);
        return EXIT_CODES.CONFIG_ERROR;
    }
    if (endPhase < startPhase) {
        printError(`Invalid --end-phase value: ${endPhase} is less than --phase ${startPhase}.`);
        return EXIT_CODES.CONFIG_ERROR;
    }

    // Print header
    printHeader('Deep Wiki \u2014 Full Generation');
    printKeyValue('Repository', absoluteRepoPath);
    printKeyValue('Output', path.resolve(options.output));
    printKeyValue('Depth', options.depth);
    if (options.focus) { printKeyValue('Focus', options.focus); }
    if (options.model) { printKeyValue('Model', options.model); }
    if (options.concurrency) { printKeyValue('Concurrency', String(options.concurrency)); }
    if (startPhase > 1) { printKeyValue('Starting Phase', String(startPhase)); }
    if (options.endPhase) { printKeyValue('End Phase', String(endPhase)); }
    if (options.force) { printKeyValue('Force', 'yes (ignoring all caches)'); }
    if (options.useCache) { printKeyValue('Use Cache', 'yes (ignoring git hash)'); }
    if (options.strict === false) { printKeyValue('Strict', 'no (partial failures allowed)'); }
    if (options.config) { printKeyValue('Config', options.config); }

    // Print per-phase overrides if configured
    if (options.phases) {
        const phaseNames: Array<{ key: import('../types').PhaseName; label: string }> = [
            { key: 'discovery', label: 'Phase 1 (Discovery)' },
            { key: 'consolidation', label: 'Phase 2 (Consolidation)' },
            { key: 'analysis', label: 'Phase 3 (Analysis)' },
            { key: 'writing', label: 'Phase 4 (Writing)' },
        ];
        for (const { key, label } of phaseNames) {
            const phaseConfig = options.phases[key];
            if (phaseConfig) {
                const parts: string[] = [];
                if (phaseConfig.model) { parts.push(`model=${phaseConfig.model}`); }
                if (phaseConfig.timeout) { parts.push(`timeout=${phaseConfig.timeout}s`); }
                if (phaseConfig.concurrency) { parts.push(`concurrency=${phaseConfig.concurrency}`); }
                if (phaseConfig.depth) { parts.push(`depth=${phaseConfig.depth}`); }
                if (phaseConfig.skipAI) { parts.push('skipAI'); }
                if (parts.length > 0) {
                    printKeyValue(label, parts.join(', '));
                }
            }
        }
    }

    process.stderr.write('\n');

    // Check AI availability
    const availability = await checkAIAvailability();
    if (!availability.available) {
        printError(`Copilot SDK is not available: ${availability.reason || 'Unknown reason'}`);
        printInfo('Setup instructions:');
        printInfo('  1. Install GitHub Copilot extension');
        printInfo('  2. Sign in with your GitHub account');
        printInfo('  3. Ensure Copilot has SDK access');
        return EXIT_CODES.AI_UNAVAILABLE;
    }

    // Set up cancellation
    let cancelled = false;
    const isCancelled = () => cancelled;
    const sigintHandler = () => {
        if (cancelled) {
            process.exit(EXIT_CODES.CANCELLED);
        }
        cancelled = true;
        printWarning('Cancellation requested — finishing current operations...');
    };
    process.on('SIGINT', sigintHandler);

    try {
        // Token usage tracker
        const usageTracker = new UsageTracker();

        // ================================================================
        // Phase 1: Discovery
        // ================================================================
        let graph: ModuleGraph;
        let phase1Duration = 0;

        if (startPhase <= 1) {
            const phase1Result = await runPhase1(absoluteRepoPath, options, isCancelled);
            if (phase1Result.exitCode !== undefined) {
                return phase1Result.exitCode;
            }
            graph = phase1Result.graph!;
            phase1Duration = phase1Result.duration;
            if (phase1Result.tokenUsage) {
                usageTracker.addUsage('discovery', phase1Result.tokenUsage);
            }
        } else {
            // Load from cache
            const cached = options.useCache
                ? getCachedGraphAny(options.output)
                : await getCachedGraph(absoluteRepoPath, options.output);
            if (!cached) {
                printError(`No cached module graph found. Run without --phase (or --phase 1) first.`);
                return EXIT_CODES.CONFIG_ERROR;
            }
            graph = cached.graph;
            printSuccess(`Loaded cached module graph (${graph.modules.length} modules)`);
            usageTracker.markCached('discovery');
        }

        if (isCancelled()) {
            return EXIT_CODES.CANCELLED;
        }

        // If endPhase is 1, stop after discovery
        if (endPhase < 2) {
            printPhaseStopped(1, endPhase);
            return EXIT_CODES.SUCCESS;
        }

        // ================================================================
        // Phase 2: Consolidation
        // ================================================================
        let phase2Duration = 0;

        if (!options.noCluster && graph.modules.length > 0 && startPhase <= 2) {
            const phase2Result = await runPhase2Consolidation(absoluteRepoPath, graph, options, usageTracker);
            graph = phase2Result.graph;
            phase2Duration = phase2Result.duration;
        }

        if (isCancelled()) {
            return EXIT_CODES.CANCELLED;
        }

        // If endPhase is 2, stop after consolidation
        if (endPhase < 3) {
            printPhaseStopped(2, endPhase);
            return EXIT_CODES.SUCCESS;
        }

        // ================================================================
        // Phase 3: Deep Analysis
        // ================================================================
        let analyses: ModuleAnalysis[];
        let phase3Duration = 0;

        let reanalyzedModuleIds: string[] | undefined;

        if (startPhase <= 3) {
            const phase3Result = await runPhase3Analysis(
                absoluteRepoPath, graph, options, isCancelled, usageTracker
            );
            if (phase3Result.exitCode !== undefined) {
                return phase3Result.exitCode;
            }
            analyses = phase3Result.analyses!;
            phase3Duration = phase3Result.duration;
            reanalyzedModuleIds = phase3Result.reanalyzedModuleIds;
        } else {
            // Load from cache
            const cached = getCachedAnalyses(options.output);
            if (!cached || cached.length === 0) {
                printError(`No cached analyses found. Run with --phase 3 (or without --phase) first.`);
                return EXIT_CODES.CONFIG_ERROR;
            }
            analyses = cached;
            printSuccess(`Loaded ${analyses.length} cached module analyses`);
            usageTracker.markCached('analysis');
        }

        if (isCancelled()) {
            return EXIT_CODES.CANCELLED;
        }

        // If endPhase is 3, stop after analysis
        if (endPhase < 4) {
            printPhaseStopped(3, endPhase);
            return EXIT_CODES.SUCCESS;
        }

        // ================================================================
        // Phase 4: Article Generation
        // ================================================================
        const phase4Result = await runPhase4Writing(
            absoluteRepoPath, graph, analyses, options, isCancelled, usageTracker, reanalyzedModuleIds
        );
        if (phase4Result.exitCode !== undefined) {
            return phase4Result.exitCode;
        }

        // ================================================================
        // Phase 5: Website Generation
        // ================================================================
        let websiteGenerated = false;
        let phase5Duration = 0;

        if (!options.skipWebsite && endPhase >= 5) {
            // Ensure module-graph.json reflects the current in-memory graph before
            // Phase 5 reads it. This is critical when Phase 2 (Consolidation)
            // changed module IDs — without this, the website would use the stale
            // Phase 1 graph and fail to match MARKDOWN_DATA keys to module IDs,
            // resulting in module pages showing only brief metadata instead of
            // the full generated articles.
            const outputDir = path.resolve(options.output);
            const graphOutputFile = path.join(outputDir, 'module-graph.json');
            try {
                fs.mkdirSync(outputDir, { recursive: true });
                fs.writeFileSync(graphOutputFile, JSON.stringify(graph, null, 2), 'utf-8');
            } catch {
                // Non-fatal: Phase 5 will still try to read whatever is on disk
            }

            const phase5Result = runPhase5Website(options);
            websiteGenerated = phase5Result.success;
            phase5Duration = phase5Result.duration;
        }

        // ================================================================
        // Summary
        // ================================================================
        const totalDuration = Date.now() - startTime;
        process.stderr.write('\n');
        printHeader('Generation Summary');
        printKeyValue('Modules Discovered', String(graph.modules.length));
        if (graph.areas && graph.areas.length > 0) {
            printKeyValue('Areas', String(graph.areas.length));
            printKeyValue('Layout', 'Hierarchical (3-level)');
        }
        printKeyValue('Modules Analyzed', String(analyses.length));
        printKeyValue('Articles Written', String(phase4Result.articlesWritten));
        if (websiteGenerated) {
            printKeyValue('Website', 'Generated');
        }
        if (phase1Duration > 0) { printKeyValue('Phase 1 Duration', formatDuration(phase1Duration)); }
        if (phase2Duration > 0) { printKeyValue('Phase 2 Duration', formatDuration(phase2Duration)); }
        if (phase3Duration > 0) { printKeyValue('Phase 3 Duration', formatDuration(phase3Duration)); }
        printKeyValue('Phase 4 Duration', formatDuration(phase4Result.duration));
        if (phase5Duration > 0) { printKeyValue('Phase 5 Duration', formatDuration(phase5Duration)); }
        printKeyValue('Total Duration', formatDuration(totalDuration));

        // Token usage summary
        if (usageTracker.hasUsage()) {
            process.stderr.write('\n');
            printTokenUsageSummary(usageTracker);

            // Save JSON report
            try {
                const cacheDir = path.join(path.resolve(options.output), '.wiki-cache');
                fs.mkdirSync(cacheDir, { recursive: true });
                const report = usageTracker.toReport(options.model);
                fs.writeFileSync(
                    path.join(cacheDir, 'usage-report.json'),
                    JSON.stringify(report, null, 2),
                    'utf-8'
                );
            } catch {
                // Non-fatal
            }
        }

        process.stderr.write('\n');
        printSuccess(`Wiki generated at ${bold(path.resolve(options.output))}`);
        if (websiteGenerated) {
            printSuccess(`Website: ${bold(path.join(path.resolve(options.output), 'index.html'))}`);
        }

        return EXIT_CODES.SUCCESS;

    } finally {
        process.removeListener('SIGINT', sigintHandler);
    }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Print a message indicating that the pipeline stopped at a specific phase
 * due to the --end-phase option.
 */
function printPhaseStopped(lastPhaseRun: number, endPhase: number): void {
    process.stderr.write('\n');
    printSuccess(`Stopped after Phase ${lastPhaseRun} (--end-phase ${endPhase})`);
}

/**
 * Format a duration in milliseconds to a human-readable string.
 */
function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) {
        return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Print a token usage summary table to stderr.
 */
function printTokenUsageSummary(tracker: UsageTracker): void {
    const fmt = UsageTracker.formatTokens;

    const phases: Array<{ label: string; phase: TrackedPhase }> = [
        { label: 'Phase 1 (Discovery)', phase: 'discovery' },
        { label: 'Phase 2 (Consolidation)', phase: 'consolidation' },
        { label: 'Phase 3 (Analysis)', phase: 'analysis' },
        { label: 'Phase 4 (Writing)', phase: 'writing' },
    ];

    printInfo('── Token Usage ──────────────────────────────────────────');

    for (const { label, phase } of phases) {
        const u = tracker.getPhaseUsage(phase);
        if (u.cached && u.calls === 0) {
            printKeyValue(label, gray('cached'));
        } else if (u.calls > 0) {
            printKeyValue(
                label,
                `${fmt(u.inputTokens)} in / ${fmt(u.outputTokens)} out / ${fmt(u.totalTokens)} total`
            );
        }
    }

    const total = tracker.getTotal();
    printInfo('─────────────────────────────────────────────────────────');
    printKeyValue(
        'Total Tokens',
        `${fmt(total.inputTokens)} in / ${fmt(total.outputTokens)} out / ${fmt(total.totalTokens)} total`
    );
    if (total.cost != null) {
        printKeyValue('Total Cost', UsageTracker.formatCost(total.cost));
    }
    printKeyValue('AI Calls', String(total.calls));
}
