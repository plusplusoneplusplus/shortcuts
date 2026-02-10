/**
 * Phase 2: Module Consolidation
 *
 * Reduces the module graph by consolidating related modules using rule-based and AI-powered clustering.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { GenerateCommandOptions, ModuleGraph } from '../../types';
import type { AIInvoker } from '@plusplusoneplusplus/pipeline-core';
import { resolvePhaseModel, resolvePhaseTimeout } from '../../config-loader';
import { consolidateModules } from '../../consolidation';
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
    graph: ModuleGraph;
    duration: number;
}

// ============================================================================
// Phase 2: Module Consolidation
// ============================================================================

export async function runPhase2Consolidation(
    repoPath: string,
    graph: ModuleGraph,
    options: GenerateCommandOptions,
    usageTracker?: UsageTracker
): Promise<Phase2ConsolidationResult> {
    const startTime = Date.now();

    process.stderr.write('\n');
    printHeader('Phase 2: Consolidation');
    printInfo(`Input: ${graph.modules.length} modules`);

    const outputDir = path.resolve(options.output);
    const inputModuleCount = graph.modules.length;

    // Check consolidation cache (skip when --force)
    if (!options.force) {
        const cached = options.useCache
            ? getCachedConsolidationAny(outputDir, inputModuleCount)
            : await getCachedConsolidation(repoPath, outputDir, inputModuleCount);

        if (cached) {
            printSuccess(
                `Using cached consolidation (${inputModuleCount} → ${cached.graph.modules.length} modules)`
            );
            usageTracker?.markCached('consolidation');
            return { graph: cached.graph, duration: Date.now() - startTime };
        }
    }

    const spinner = new Spinner();
    spinner.start('Consolidating modules...');

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

        const result = await consolidateModules(graph, aiInvoker, {
            model: consolidationModel,
            timeoutMs: consolidationTimeout ? consolidationTimeout * 1000 : undefined,
            skipAI: consolidationSkipAI,
        });

        spinner.succeed(
            `Consolidation complete: ${result.originalCount} → ${result.afterRuleBasedCount} (rule-based) → ${result.finalCount} modules`
        );

        // Save consolidation result to cache
        await saveConsolidation(repoPath, result.graph, outputDir, inputModuleCount);

        return { graph: result.graph, duration: Date.now() - startTime };
    } catch (error) {
        spinner.warn('Consolidation failed — using original modules');
        if (options.verbose) {
            printWarning(getErrorMessage(error));
        }
        return { graph, duration: Date.now() - startTime };
    }
}
