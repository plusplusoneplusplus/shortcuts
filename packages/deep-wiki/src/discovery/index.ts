/**
 * Main entry point for the discovery phase (Phase 1).
 * Analyzes a local repository and produces a ComponentGraph JSON
 * describing the codebase structure, components, and dependencies.
 */

import type { DiscoveryOptions, DiscoveryResult } from '../types';
import { runDiscoverySession } from './discovery-session';
import { isLargeRepo, discoverLargeRepo } from './large-repo-handler';
import { printInfo } from '../logger';

// Re-export key types and functions
export { DiscoveryError } from './discovery-session';
export type { DiscoverySessionResult } from './discovery-session';
export { LARGE_REPO_THRESHOLD, mergeSubGraphs } from './large-repo-handler';
export { parseComponentGraphResponse, parseStructuralScanResponse, normalizePath } from './response-parser';
export { buildDiscoveryPrompt, buildStructuralScanPrompt, buildFocusedDiscoveryPrompt } from './prompts';
export { runIterativeDiscovery } from './iterative/iterative-discovery';

/**
 * For large repositories (3000+ files), it automatically uses multi-round
 * discovery: first a structural scan, then per-domain drill-downs.
 *
 * @param options - Discovery options (repoPath is required)
 */
export async function discoverComponentGraph(options: DiscoveryOptions): Promise<DiscoveryResult> {
    const startTime = Date.now();

    let graph;

    // Check if the repo is large enough for multi-round discovery
    const large = await isLargeRepo(options.repoPath, options.largeRepoThreshold);

    if (large) {
        graph = await discoverLargeRepo(options);
    } else {
        printInfo('Standard-size repo — running single-pass discovery');
        const sessionResult = await runDiscoverySession(options);
        graph = sessionResult.graph;

        const duration = Date.now() - startTime;
        return {
            graph,
            duration,
            tokenUsage: sessionResult.tokenUsage,
        };
    }

    const duration = Date.now() - startTime;

    return {
        graph,
        duration,
    };
}
