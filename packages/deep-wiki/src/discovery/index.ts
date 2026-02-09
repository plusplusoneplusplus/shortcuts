/**
 * Discovery Phase — Public API
 *
 * Main entry point for the discovery phase (Phase 1).
 * Analyzes a local repository and produces a ModuleGraph JSON
 * describing the codebase structure, modules, and dependencies.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { DiscoveryOptions, DiscoveryResult } from '../types';
import { runDiscoverySession } from './discovery-session';
import { isLargeRepo, discoverLargeRepo } from './large-repo-handler';
import { printInfo } from '../logger';

// Re-export key types and functions
export { DiscoveryError } from './discovery-session';
export { LARGE_REPO_THRESHOLD, mergeSubGraphs } from './large-repo-handler';
export { parseModuleGraphResponse, parseStructuralScanResponse, normalizePath } from './response-parser';
export { buildDiscoveryPrompt, buildStructuralScanPrompt, buildFocusedDiscoveryPrompt } from './prompts';
export { runIterativeDiscovery } from './iterative/iterative-discovery';

/**
 * Discover the module graph for a repository.
 *
 * This is the main entry point for Phase 1 of the deep-wiki pipeline.
 * It analyzes the repository and returns a structured ModuleGraph.
 *
 * For large repositories (3000+ files), it automatically uses multi-round
 * discovery: first a structural scan, then per-area drill-downs.
 *
 * @param options - Discovery options (repoPath is required)
 * @returns DiscoveryResult containing the ModuleGraph and timing info
 */
export async function discoverModuleGraph(options: DiscoveryOptions): Promise<DiscoveryResult> {
    const startTime = Date.now();

    let graph;

    // Check if the repo is large enough for multi-round discovery
    const large = await isLargeRepo(options.repoPath);

    if (large) {
        graph = await discoverLargeRepo(options);
    } else {
        printInfo('Standard-size repo — running single-pass discovery');
        graph = await runDiscoverySession(options);
    }

    const duration = Date.now() - startTime;

    return {
        graph,
        duration,
    };
}
