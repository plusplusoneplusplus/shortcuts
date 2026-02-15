/**
 * Phase 2: Component Consolidation
 *
 * Reduces the component graph by consolidating related components using rule-based and AI-powered clustering.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { GenerateCommandOptions, ComponentGraph } from '../../types';
import type { AIInvoker } from '@plusplusoneplusplus/pipeline-core';
import { resolvePhaseModel, resolvePhaseTimeout } from '../../config-loader';
import { consolidateComponents } from '../../consolidation';
import { createConsolidationInvoker } from '../../ai-invoker';
import { UsageTracker } from '../../usage-tracker';
import {
    getCachedConsolidation,
    getCachedConsolidationAny,
    saveConsolidation,
} from '../../cache';
import {
    Spinner,
    printSuccess,
    printWarning,
    printInfo,
    printHeader,
} from '../../logger';
import { getErrorMessage } from '../../utils/error-utils';

// ============================================================================
// Types
// ============================================================================

export interface Phase2ConsolidationResult {
    graph: ComponentGraph;
    duration: number;
}

// ============================================================================
// Phase 2: Component Consolidation
// ============================================================================

export async function runPhase2Consolidation(
    repoPath: string,
    graph: ComponentGraph,
    options: GenerateCommandOptions,
    usageTracker?: UsageTracker
): Promise<Phase2ConsolidationResult> {
    const startTime = Date.now();

    process.stderr.write('\n');
    printHeader('Phase 2: Consolidation');
    printInfo(`Input: ${graph.components.length} components`);

    const outputDir = path.resolve(options.output);
    const inputComponentCount = graph.components.length;

    // Check consolidation cache (skip when --force)
    if (!options.force) {
        const cached = options.useCache
            ? getCachedConsolidationAny(outputDir, inputComponentCount)
            : await getCachedConsolidation(repoPath, outputDir, inputComponentCount);

        if (cached) {
            printSuccess(
                `Using cached consolidation (${inputComponentCount} → ${cached.graph.components.length} components)`
            );
            usageTracker?.markCached('consolidation');

            // Ensure component-graph.json reflects the consolidated graph, even from cache.
            // Phase 1 may have overwritten it with the pre-consolidation graph.
            const graphOutputFile = path.join(outputDir, 'component-graph.json');
            try {
                fs.mkdirSync(outputDir, { recursive: true });
                fs.writeFileSync(graphOutputFile, JSON.stringify(cached.graph, null, 2), 'utf-8');
            } catch {
                // Non-fatal
            }

            return { graph: cached.graph, duration: Date.now() - startTime };
        }
    }

    const spinner = new Spinner();
    spinner.start('Consolidating components...');

    try {
        // Resolve per-phase settings for consolidation
        const consolidationModel = resolvePhaseModel(options, 'consolidation');
        const consolidationTimeout = resolvePhaseTimeout(options, 'consolidation');
        const consolidationSkipAI = options.phases?.consolidation?.skipAI;

        // Create AI invoker for semantic clustering (uses output dir as cwd)
        fs.mkdirSync(outputDir, { recursive: true });
        const baseInvoker = createConsolidationInvoker({
            workingDirectory: outputDir,
            model: consolidationModel,
            timeoutMs: consolidationTimeout ? consolidationTimeout * 1000 : undefined,
        });

        // Wrap invoker to capture token usage
        const aiInvoker: AIInvoker = async (prompt, opts) => {
            const result = await baseInvoker(prompt, opts);
            usageTracker?.addUsage('consolidation', result.tokenUsage);
            return result;
        };

        const result = await consolidateComponents(graph, aiInvoker, {
            model: consolidationModel,
            timeoutMs: consolidationTimeout ? consolidationTimeout * 1000 : undefined,
            skipAI: consolidationSkipAI,
        });

        spinner.succeed(
            `Consolidation complete: ${result.originalCount} → ${result.afterRuleBasedCount} (rule-based) → ${result.finalCount} components`
        );

        // Save consolidation result to cache
        await saveConsolidation(repoPath, result.graph, outputDir, inputComponentCount);

        // Update component-graph.json with the consolidated graph.
        // Phase 5 (Website) reads this file to build the embedded data, so it must
        // reflect the post-consolidation component IDs used in Phases 3–4.
        const graphOutputFile = path.join(outputDir, 'component-graph.json');
        try {
            fs.mkdirSync(outputDir, { recursive: true });
            fs.writeFileSync(graphOutputFile, JSON.stringify(result.graph, null, 2), 'utf-8');
        } catch {
            // Non-fatal: website may show stale graph but generation continues
            if (options.verbose) {
                printWarning('Failed to update component-graph.json after consolidation');
            }
        }

        return { graph: result.graph, duration: Date.now() - startTime };
    } catch (error) {
        spinner.warn('Consolidation failed — using original components');
        if (options.verbose) {
            printWarning(getErrorMessage(error));
        }
        return { graph, duration: Date.now() - startTime };
    }
}
