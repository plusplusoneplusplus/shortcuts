/**
 * Iterative Discovery — Main Convergence Loop
 *
 * Implements breadth-first iterative discovery using theme seeds.
 * Runs parallel probes, merges results, and iterates until convergence.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ComponentGraph, ThemeSeed } from '../../types';
import type { IterativeDiscoveryOptions, ThemeProbeResult } from './types';
import { runThemeProbe } from './probe-session';
import { mergeProbeResults } from './merge-session';
import { printInfo, printWarning, gray, cyan } from '../../logger';
import {
    scanCachedProbes,
    scanCachedProbesAny,
    saveProbeResult,
    saveDiscoveryMetadata,
    getDiscoveryMetadata,
} from '../../cache';

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
 * 2. Run N parallel probe sessions (one per theme)
 * 3. Merge probe results + identify gaps + discover new themes
 * 4. Iterate until convergence (no new themes, good coverage, or max rounds)
 * 5. Return final ComponentGraph
 *
 * @param options - Iterative discovery options
 * @returns Final ComponentGraph
 */
export async function runIterativeDiscovery(
    options: IterativeDiscoveryOptions
): Promise<ComponentGraph> {
    const maxRounds = options.maxRounds ?? 3;
    const concurrency = options.concurrency ?? 5;
    const coverageThreshold = options.coverageThreshold ?? 0.8;

    let currentThemes: ThemeSeed[] = [...options.seeds];
    let currentGraph: ComponentGraph | null = null;
    let round = 0;

    // Handle empty seeds
    if (currentThemes.length === 0) {
        return {
            project: {
                name: 'unknown',
                description: '',
                language: 'unknown',
                buildSystem: 'unknown',
                entryPoints: [],
            },
            components: [],
            categories: [],
            architectureNotes: 'No seeds provided for iterative discovery.',
        };
    }

    // Cache configuration
    const cacheEnabled = !!options.outputDir;
    const gitHash = options.gitHash;
    const useCache = options.useCache ?? false;

    // Check for round resumption from metadata
    if (cacheEnabled) {
        const metadata = getDiscoveryMetadata(options.outputDir!);
        if (metadata && metadata.gitHash === gitHash && metadata.currentRound > 0) {
            round = metadata.currentRound - 1; // Will be incremented at loop start
            printInfo(`Resuming from round ${metadata.currentRound} (${metadata.completedThemes.length} themes completed)`);
        }
    }

    while (round < maxRounds && currentThemes.length > 0) {
        round++;

        printInfo(`Round ${round}/${maxRounds}: Probing ${currentThemes.length} themes ${gray(`(concurrency: ${concurrency})`)}`);
        if (currentThemes.length <= 10) {
            printInfo(`  Themes: ${currentThemes.map(t => cyan(t.theme)).join(', ')}`);
        }

        // Check probe cache — skip already-completed probes
        let cachedProbes = new Map<string, ThemeProbeResult>();
        let themesToProbe = currentThemes;

        if (cacheEnabled) {
            const themeNames = currentThemes.map(t => t.theme);
            const scanResult = (useCache || !gitHash)
                ? scanCachedProbesAny(themeNames, options.outputDir!)
                : scanCachedProbes(themeNames, options.outputDir!, gitHash!);

            cachedProbes = scanResult.found;
            themesToProbe = currentThemes.filter(t => scanResult.missing.includes(t.theme));

            if (cachedProbes.size > 0) {
                printInfo(`  Loaded ${cachedProbes.size} probes from cache, ${themesToProbe.length} remaining`);
            }
        }

        // Run parallel probes only for uncached themes
        let freshProbeResults: ThemeProbeResult[] = [];
        if (themesToProbe.length > 0) {
            freshProbeResults = await runParallel(
                themesToProbe,
                concurrency,
                async (theme) => {
                    const result = await runThemeProbe(options.repoPath, theme, {
                        model: options.model,
                        timeout: options.probeTimeout,
                        focus: options.focus,
                    });
                    // Save probe result to cache immediately after completion
                    if (cacheEnabled && gitHash && result) {
                        try {
                            saveProbeResult(theme.theme, result, options.outputDir!, gitHash);
                        } catch {
                            // Non-fatal: cache write failed
                        }
                    }
                    return result;
                }
            );
        }

        // Combine cached + fresh probe results (in original theme order)
        const allProbeResults: ThemeProbeResult[] = currentThemes.map(t => {
            const cached = cachedProbes.get(t.theme);
            if (cached) {
                return cached;
            }
            const fresh = freshProbeResults.find(r => r?.theme === t.theme);
            return fresh ?? {
                theme: t.theme,
                foundComponents: [],
                discoveredThemes: [],
                dependencies: [],
                confidence: 0,
            };
        });

        // Count successful probes
        const successfulProbes = allProbeResults.filter(r => r && r.foundComponents.length > 0).length;
        const totalComponentsFound = allProbeResults.reduce((sum, r) => sum + (r?.foundComponents?.length || 0), 0);
        printInfo(`  Probes completed: ${successfulProbes}/${currentThemes.length} successful, ${totalComponentsFound} components found`);

        // Merge results
        printInfo('  Merging probe results...');
        const mergeResult = await mergeProbeResults(
            options.repoPath,
            allProbeResults,
            currentGraph,
            {
                model: options.model,
                timeout: options.mergeTimeout,
            }
        );

        currentGraph = mergeResult.graph;
        printInfo(`  Merged graph: ${currentGraph.components.length} components, coverage: ${(mergeResult.coverage * 100).toFixed(0)}%`);

        // Save round progress to metadata
        if (cacheEnabled && gitHash) {
            try {
                saveDiscoveryMetadata({
                    gitHash,
                    timestamp: Date.now(),
                    mode: 'iterative',
                    currentRound: round,
                    maxRounds,
                    completedThemes: currentThemes.map(t => t.theme),
                    pendingThemes: mergeResult.newThemes.map(t => t.theme),
                    converged: mergeResult.converged,
                    coverage: mergeResult.coverage,
                }, options.outputDir!);
            } catch {
                // Non-fatal: metadata save failed
            }
        }

        // Check convergence
        if (mergeResult.converged) {
            printInfo(`  Converged${mergeResult.reason ? ` — ${mergeResult.reason}` : ''}`);
            break;
        }

        // Check coverage threshold
        if (mergeResult.coverage >= coverageThreshold && mergeResult.newThemes.length === 0) {
            printInfo(`  Coverage threshold reached (${(mergeResult.coverage * 100).toFixed(0)}% >= ${(coverageThreshold * 100).toFixed(0)}%)`);
            break;
        }

        // Next round: probe newly discovered themes
        if (mergeResult.newThemes.length > 0) {
            printInfo(`  Discovered ${mergeResult.newThemes.length} new themes for next round`);
        }
        currentThemes = mergeResult.newThemes.map(t => ({
            theme: t.theme,
            description: t.description,
            hints: t.hints,
        }));
    }

    // Return final graph (should never be null due to empty seeds check)
    return currentGraph!;
}
