/**
 * Discovery Phase — Large Repo Handler
 *
 * Handles multi-round discovery for large repositories (3000+ files).
 * First pass identifies top-level structure, second pass drills into each domain.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    getCopilotSDKService,
    type SendMessageOptions,
    type PermissionRequest,
    type PermissionRequestResult,
} from '@plusplusoneplusplus/pipeline-core';
import type {
    DiscoveryOptions,
    ModuleGraph,
    ModuleInfo,
    CategoryInfo,
    DomainInfo,
    StructuralScanResult,
    TopLevelDomain,
} from '../types';
import { normalizeModuleId } from '../schemas';
import { getErrorMessage } from '../utils/error-utils';
import { buildStructuralScanPrompt, buildFocusedDiscoveryPrompt } from './prompts';
import { parseStructuralScanResponse, parseModuleGraphResponse } from './response-parser';
import { printInfo, printWarning, gray, cyan } from '../logger';
import {
    getCachedStructuralScan,
    getCachedStructuralScanAny,
    saveStructuralScan,
    getCachedDomainSubGraph,
    saveDomainSubGraph,
} from '../cache';

// ============================================================================
// Constants
// ============================================================================

/** File count threshold for triggering multi-round discovery */
export const LARGE_REPO_THRESHOLD = 3000;

/** Default timeout for structural scan */
const STRUCTURAL_SCAN_TIMEOUT_MS = 1_800_000; // 30 minutes

/** Default timeout per domain drill-down */
const PER_DOMAIN_TIMEOUT_MS = 1_800_000; // 30 minutes

/** Available tools for discovery (read-only file exploration) */
const DISCOVERY_TOOLS = ['view', 'grep', 'glob'];

// ============================================================================
// Permission Handler
// ============================================================================

/**
 * Read-only permission handler.
 */
function readOnlyPermissions(request: PermissionRequest): PermissionRequestResult {
    if (request.kind === 'read') {
        return { kind: 'approved' };
    }
    return { kind: 'denied-by-rules' };
}

// ============================================================================
// File Count Estimation
// ============================================================================

/**
 * Estimate the number of files in a repository by counting glob results.
 * Uses a fast glob pattern to avoid reading file contents.
 *
 * @param repoPath - Path to the repository
 * @returns Estimated file count, or -1 if estimation fails
 */
export async function estimateFileCount(repoPath: string): Promise<number> {
    const service = getCopilotSDKService();

    printInfo('Estimating repository file count...');
    const result = await service.sendMessage({
        prompt: `Count the approximate number of files in this repository. Run glob("**/*") and count the results. Respond with ONLY a single number, nothing else.`,
        workingDirectory: repoPath,
        availableTools: ['glob'],
        onPermissionRequest: readOnlyPermissions,
        usePool: false,
        timeoutMs: 1_800_000,
    });

    if (!result.success || !result.response) {
        printWarning('Could not estimate file count');
        return -1;
    }

    // Extract number from response
    const match = result.response.trim().match(/(\d+)/);
    const count = match ? parseInt(match[1], 10) : -1;
    if (count > 0) {
        printInfo(`Repository contains ~${count} files ${gray(`(threshold: ${LARGE_REPO_THRESHOLD})`)}`);
    }
    return count;
}

/**
 * Check if a repository is large enough to require multi-round discovery.
 *
 * @param repoPath - Path to the repository
 * @param threshold - Custom file count threshold (defaults to LARGE_REPO_THRESHOLD)
 * @returns True if the repo has more files than the threshold
 */
export async function isLargeRepo(repoPath: string, threshold?: number): Promise<boolean> {
    const count = await estimateFileCount(repoPath);
    return count > (threshold ?? LARGE_REPO_THRESHOLD);
}

// ============================================================================
// Multi-Round Discovery
// ============================================================================

/**
 * Perform multi-round discovery for a large repository.
 *
 * Round 1: Structural scan — identify top-level domains
 * Round 2: Per-domain drill-down — focused discovery for each domain (sequential)
 * Final:   Merge all sub-graphs into a unified ModuleGraph
 *
 * @param options - Discovery options
 * @returns Merged ModuleGraph
 */
export async function discoverLargeRepo(options: DiscoveryOptions): Promise<ModuleGraph> {
    const cacheEnabled = !!options.outputDir;
    const gitHash = options.gitHash;
    const useCache = options.useCache ?? false;

    // Round 1: Structural scan (check cache first)
    printInfo('Large repo detected — using multi-round discovery');
    printInfo('Round 1: Running structural scan to identify top-level domains...');

    let scanResult: StructuralScanResult | null = null;

    if (cacheEnabled) {
        scanResult = (useCache || !gitHash)
            ? getCachedStructuralScanAny(options.outputDir!)
            : getCachedStructuralScan(options.outputDir!, gitHash!);

        if (scanResult) {
            printInfo(`Using cached structural scan (${scanResult.domains.length} domains)`);
        }
    }

    if (!scanResult) {
        scanResult = await performStructuralScan(options);

        // Save to cache
        if (cacheEnabled && gitHash) {
            try {
                saveStructuralScan(scanResult, options.outputDir!, gitHash);
            } catch {
                // Non-fatal: cache write failed
            }
        }
    }

    if (scanResult.domains.length === 0) {
        throw new Error('Structural scan found no top-level domains. The repository may be empty or inaccessible.');
    }

    printInfo(`Structural scan found ${scanResult.domains.length} domains: ${scanResult.domains.map(a => cyan(a.name)).join(', ')}`);

    // Round 2: Per-domain drill-down (sequential to avoid overloading the SDK)
    printInfo('Round 2: Per-domain drill-down...');
    const subGraphs: ModuleGraph[] = [];
    const projectName = scanResult.projectInfo.name || 'project';

    for (let i = 0; i < scanResult.domains.length; i++) {
        const domain = scanResult.domains[i];
        const domainSlug = normalizeModuleId(domain.path);

        // Check domain cache
        let cachedDomain: ModuleGraph | null = null;
        if (cacheEnabled && gitHash) {
            cachedDomain = getCachedDomainSubGraph(domainSlug, options.outputDir!, gitHash);
        }

        if (cachedDomain) {
            printInfo(`  Domain "${domain.name}" loaded from cache (${cachedDomain.modules.length} modules)`);
            subGraphs.push(cachedDomain);
            continue;
        }

        printInfo(`  Discovering domain ${i + 1}/${scanResult.domains.length}: ${cyan(domain.name)} ${gray(`(${domain.path})`)}`);
        try {
            const subGraph = await discoverDomain(options, domain, projectName);
            printInfo(`    Found ${subGraph.modules.length} modules`);
            subGraphs.push(subGraph);

            // Save domain sub-graph to cache
            if (cacheEnabled && gitHash) {
                try {
                    saveDomainSubGraph(domainSlug, subGraph, options.outputDir!, gitHash);
                } catch {
                    // Non-fatal: cache write failed
                }
            }
        } catch (error) {
            // Log error but continue with other domains
            printWarning(`Failed to discover domain '${domain.name}': ${getErrorMessage(error)}`);
        }
    }

    if (subGraphs.length === 0) {
        throw new Error('All domain discoveries failed. Cannot produce a module graph.');
    }

    // Merge sub-graphs
    printInfo(`Merging ${subGraphs.length} domain sub-graphs...`);
    const merged = mergeSubGraphs(subGraphs, scanResult);
    printInfo(`Merged result: ${merged.modules.length} modules, ${merged.categories.length} categories`);
    return merged;
}

// ============================================================================
// Round 1: Structural Scan
// ============================================================================

/**
 * Perform the structural scan (first pass).
 */
async function performStructuralScan(options: DiscoveryOptions): Promise<StructuralScanResult> {
    const service = getCopilotSDKService();
    const prompt = buildStructuralScanPrompt(options.repoPath);

    const sendOptions: SendMessageOptions = {
        prompt,
        workingDirectory: options.repoPath,
        availableTools: DISCOVERY_TOOLS,
        onPermissionRequest: readOnlyPermissions,
        usePool: false,
        timeoutMs: STRUCTURAL_SCAN_TIMEOUT_MS,
    };

    if (options.model) {
        sendOptions.model = options.model;
    }

    const result = await service.sendMessage(sendOptions);

    if (!result.success || !result.response) {
        throw new Error(`Structural scan failed: ${result.error || 'empty response'}`);
    }

    return parseStructuralScanResponse(result.response);
}

// ============================================================================
// Round 2: Per-Domain Drill-Down
// ============================================================================

/**
 * Discover a single domain of a large repository.
 */
async function discoverDomain(
    options: DiscoveryOptions,
    domain: TopLevelDomain,
    projectName: string
): Promise<ModuleGraph> {
    const service = getCopilotSDKService();
    const prompt = buildFocusedDiscoveryPrompt(
        options.repoPath,
        domain.path,
        domain.description,
        projectName
    );

    const sendOptions: SendMessageOptions = {
        prompt,
        workingDirectory: options.repoPath,
        availableTools: DISCOVERY_TOOLS,
        onPermissionRequest: readOnlyPermissions,
        usePool: false,
        timeoutMs: PER_DOMAIN_TIMEOUT_MS,
    };

    if (options.model) {
        sendOptions.model = options.model;
    }

    const result = await service.sendMessage(sendOptions);

    if (!result.success || !result.response) {
        throw new Error(`Domain discovery failed for '${domain.name}': ${result.error || 'empty response'}`);
    }

    return parseModuleGraphResponse(result.response);
}

// ============================================================================
// Sub-Graph Merging
// ============================================================================

/**
 * Merge multiple sub-graphs from domain discoveries into a unified ModuleGraph.
 *
 * - Deduplicates modules by ID
 * - Tags each module with its domain slug
 * - Populates graph.domains from TopLevelDomain[]
 * - Merges categories (deduplicating by name)
 * - Resolves cross-domain dependencies
 * - Combines architecture notes
 */
export function mergeSubGraphs(
    subGraphs: ModuleGraph[],
    scanResult: StructuralScanResult
): ModuleGraph {
    // Merge project info (take from first sub-graph, supplement with scan result)
    const firstProject = subGraphs[0].project;
    const project = {
        name: scanResult.projectInfo.name || firstProject.name,
        description: scanResult.projectInfo.description || firstProject.description,
        language: scanResult.projectInfo.language || firstProject.language,
        buildSystem: scanResult.projectInfo.buildSystem || firstProject.buildSystem,
        entryPoints: firstProject.entryPoints,
    };

    // Build domain-to-graph mapping for tagging modules with their domain
    // Each sub-graph corresponds to one domain (same order as scanResult.domains)
    const domainModuleMap = new Map<string, string[]>();

    // Merge modules (deduplicate by ID) and tag with domain slug
    const moduleMap = new Map<string, ModuleInfo>();
    for (let i = 0; i < subGraphs.length; i++) {
        const graph = subGraphs[i];
        const domain = scanResult.domains[i];
        const domainSlug = domain ? normalizeModuleId(domain.path) : undefined;

        for (const mod of graph.modules) {
            if (!moduleMap.has(mod.id)) {
                // Tag module with its domain
                const taggedMod = domainSlug ? { ...mod, domain: domainSlug } : mod;
                moduleMap.set(mod.id, taggedMod);

                // Track which modules belong to each domain
                if (domainSlug) {
                    if (!domainModuleMap.has(domainSlug)) {
                        domainModuleMap.set(domainSlug, []);
                    }
                    domainModuleMap.get(domainSlug)!.push(mod.id);
                }
            }
        }
    }
    const modules = Array.from(moduleMap.values());

    // Merge categories (deduplicate by name)
    const categoryMap = new Map<string, CategoryInfo>();
    for (const graph of subGraphs) {
        for (const cat of graph.categories) {
            if (!categoryMap.has(cat.name)) {
                categoryMap.set(cat.name, cat);
            }
        }
    }
    const categories = Array.from(categoryMap.values());

    // Validate cross-domain dependencies
    const moduleIds = new Set(modules.map(m => m.id));
    for (const mod of modules) {
        mod.dependencies = mod.dependencies.filter(dep => moduleIds.has(dep));
        mod.dependents = mod.dependents.filter(dep => moduleIds.has(dep));
    }

    // Combine architecture notes
    const architectureNotes = subGraphs
        .map(g => g.architectureNotes)
        .filter(Boolean)
        .join('\n\n');

    // Build DomainInfo[] from TopLevelDomain[] + module assignments
    const domains: DomainInfo[] | undefined = scanResult.domains.length > 0
        ? scanResult.domains.map(topLevelDomain => {
            const domainSlug = normalizeModuleId(topLevelDomain.path);
            return {
                id: domainSlug,
                name: topLevelDomain.name,
                path: topLevelDomain.path,
                description: topLevelDomain.description,
                modules: domainModuleMap.get(domainSlug) || [],
            };
        })
        : undefined;

    return {
        project,
        modules,
        categories,
        architectureNotes,
        ...(domains ? { domains } : {}),
    };
}
