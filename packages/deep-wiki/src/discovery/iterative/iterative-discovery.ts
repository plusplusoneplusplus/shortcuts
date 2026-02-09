/**
 * Iterative Discovery — Main Convergence Loop
 *
 * Implements breadth-first iterative discovery using topic seeds.
 * Runs parallel probes, merges results, and iterates until convergence.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { IterativeDiscoveryOptions, ModuleGraph, TopicSeed, TopicProbeResult } from '../../types';
import { runTopicProbe } from './probe-session';
import { mergeProbeResults } from './merge-session';
import { printInfo, printWarning, gray, cyan } from '../../logger';

// ============================================================================
// Concurrency Control
// ============================================================================

/**
 * Run tasks in parallel with a concurrency limit.
 *
 * @param items - Items to process
 * @param concurrency - Maximum parallel tasks
 * @param fn - Function to run for each item
 * @returns Array of results (in order)
 */
async function runParallel<T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    const executing: Promise<void>[] = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const index = i;
        const promise = fn(item)
            .then(result => {
                results[index] = result;
            })
            .catch(() => {
                // Handle errors gracefully
            })
            .finally(() => {
                // Remove this promise from executing array
                const idx = executing.indexOf(promise);
                if (idx !== -1) {
                    executing.splice(idx, 1);
                }
            });

        executing.push(promise);

        if (executing.length >= concurrency) {
            await Promise.race(executing);
        }
    }

    // Wait for remaining tasks
    await Promise.all(executing);

    return results;
}

// ============================================================================
// Iterative Discovery
// ============================================================================

/**
 * Run iterative breadth-first discovery.
 *
 * Flow:
 * 1. Load seeds (already provided in options)
 * 2. Run N parallel probe sessions (one per topic)
 * 3. Merge probe results + identify gaps + discover new topics
 * 4. Iterate until convergence (no new topics, good coverage, or max rounds)
 * 5. Return final ModuleGraph
 *
 * @param options - Iterative discovery options
 * @returns Final ModuleGraph
 */
export async function runIterativeDiscovery(
    options: IterativeDiscoveryOptions
): Promise<ModuleGraph> {
    const maxRounds = options.maxRounds ?? 3;
    const concurrency = options.concurrency ?? 5;
    const coverageThreshold = options.coverageThreshold ?? 0.8;

    let currentTopics: TopicSeed[] = [...options.seeds];
    let currentGraph: ModuleGraph | null = null;
    let round = 0;

    // Handle empty seeds
    if (currentTopics.length === 0) {
        return {
            project: {
                name: 'unknown',
                description: '',
                language: 'unknown',
                buildSystem: 'unknown',
                entryPoints: [],
            },
            modules: [],
            categories: [],
            architectureNotes: 'No seeds provided for iterative discovery.',
        };
    }

    while (round < maxRounds && currentTopics.length > 0) {
        round++;

        printInfo(`Round ${round}/${maxRounds}: Probing ${currentTopics.length} topics ${gray(`(concurrency: ${concurrency})`)}`);
        if (currentTopics.length <= 10) {
            printInfo(`  Topics: ${currentTopics.map(t => cyan(t.topic)).join(', ')}`);
        }

        // Run parallel probes (one per topic, limited by concurrency)
        const probeResults = await runParallel(
            currentTopics,
            concurrency,
            async (topic) => {
                return runTopicProbe(options.repoPath, topic, {
                    model: options.model,
                    timeout: options.probeTimeout,
                    focus: options.focus,
                });
            }
        );

        // Count successful probes
        const successfulProbes = probeResults.filter(r => r && r.foundModules.length > 0).length;
        const totalModulesFound = probeResults.reduce((sum, r) => sum + (r?.foundModules?.length || 0), 0);
        printInfo(`  Probes completed: ${successfulProbes}/${currentTopics.length} successful, ${totalModulesFound} modules found`);

        // Merge results
        printInfo('  Merging probe results...');
        const mergeResult = await mergeProbeResults(
            options.repoPath,
            probeResults,
            currentGraph,
            {
                model: options.model,
                timeout: options.mergeTimeout,
            }
        );

        currentGraph = mergeResult.graph;
        printInfo(`  Merged graph: ${currentGraph.modules.length} modules, coverage: ${(mergeResult.coverage * 100).toFixed(0)}%`);

        // Check convergence
        if (mergeResult.converged) {
            printInfo(`  Converged${mergeResult.reason ? ` — ${mergeResult.reason}` : ''}`);
            break;
        }

        // Check coverage threshold
        if (mergeResult.coverage >= coverageThreshold && mergeResult.newTopics.length === 0) {
            printInfo(`  Coverage threshold reached (${(mergeResult.coverage * 100).toFixed(0)}% >= ${(coverageThreshold * 100).toFixed(0)}%)`);
            break;
        }

        // Next round: probe newly discovered topics
        if (mergeResult.newTopics.length > 0) {
            printInfo(`  Discovered ${mergeResult.newTopics.length} new topics for next round`);
        }
        currentTopics = mergeResult.newTopics.map(t => ({
            topic: t.topic,
            description: t.description,
            hints: t.hints,
        }));
    }

    // Return final graph (should never be null due to empty seeds check)
    return currentGraph!;
}
