/**
 * AI-Assisted Module Consolidator
 *
 * Uses a single AI session to semantically cluster pre-consolidated modules
 * into a target number of high-level groups. This is the second pass of the
 * hybrid consolidation, running after the rule-based pass.
 *
 * The AI receives a compact module list and returns cluster assignments.
 * Modules within each cluster are then programmatically merged.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { AIInvoker } from '@plusplusoneplusplus/pipeline-core';
import { extractJSON } from '@plusplusoneplusplus/pipeline-core';
import type { ModuleInfo, ModuleGraph, CategoryInfo } from '../types';
import type { ClusterGroup } from './types';
import { normalizeModuleId } from '../schemas';
import { resolveMaxComplexity } from './constants';

// ============================================================================
// Constants
// ============================================================================

/** Default target module count */
const DEFAULT_TARGET_COUNT = 50;

/** Default timeout for AI clustering session: 30 minutes */
const DEFAULT_CLUSTERING_TIMEOUT_MS = 1_800_000;

// ============================================================================
// Public API
// ============================================================================

/**
 * Options for AI-assisted clustering.
 */
export interface AIClusteringOptions {
    /** AI invoker for the clustering session */
    aiInvoker: AIInvoker;
    /** Target number of modules after clustering (default: 50) */
    targetCount?: number;
    /** AI model to use */
    model?: string;
    /** Timeout in milliseconds (default: 120000) */
    timeoutMs?: number;
}

/**
 * Cluster modules using AI semantic analysis.
 *
 * Sends the module list to AI, which groups semantically related modules.
 * Then programmatically merges each cluster into a single module.
 *
 * @param graph - Module graph (typically after rule-based consolidation)
 * @param options - AI clustering options
 * @returns Consolidated module graph
 */
export async function clusterWithAI(
    graph: ModuleGraph,
    options: AIClusteringOptions
): Promise<ModuleGraph> {
    const { aiInvoker, model } = options;
    const targetCount = options.targetCount || DEFAULT_TARGET_COUNT;
    const timeoutMs = options.timeoutMs || DEFAULT_CLUSTERING_TIMEOUT_MS;

    const modules = graph.modules;

    // Skip if already at or below target
    if (modules.length <= targetCount) {
        return graph;
    }

    // Build the clustering prompt
    const prompt = buildClusteringPrompt(modules, graph.project.name, targetCount);

    // Call AI
    const result = await aiInvoker(prompt, { model, timeoutMs });

    if (!result.success || !result.response) {
        // AI failed — return graph unchanged
        return graph;
    }

    // Parse the cluster assignments
    const clusters = parseClusterResponse(result.response, modules);

    if (clusters.length === 0) {
        // Parse failed — return unchanged
        return graph;
    }

    // Merge modules according to clusters
    return applyClusterMerge(graph, clusters);
}

// ============================================================================
// Prompt Building
// ============================================================================

/**
 * Build the clustering prompt for AI.
 * Sends a compact module list and asks for semantic groupings.
 */
export function buildClusteringPrompt(
    modules: ModuleInfo[],
    projectName: string,
    targetCount: number
): string {
    // Build compact module list
    const moduleList = modules
        .map(m => `- ${m.id}: ${m.path} — ${m.purpose}`)
        .join('\n');

    return `You are analyzing the codebase of "${projectName}" which has ${modules.length} modules.
Your task is to cluster semantically related modules into ${targetCount} (or fewer) high-level groups for documentation purposes.

## Current Modules

${moduleList}

## Instructions

Group these modules into approximately ${targetCount} clusters based on:
1. **Functional cohesion** — modules that serve the same feature or subsystem
2. **Directory proximity** — modules in related paths
3. **Dependency relationships** — tightly coupled modules

Rules:
- Every module ID must appear in exactly one cluster
- Each cluster should have a descriptive name and purpose
- Prefer fewer, broader clusters over many small ones
- A cluster can have a single module if it's truly standalone

## Output Format

Return a JSON object with this exact structure:

\`\`\`json
{
  "clusters": [
    {
      "id": "string — kebab-case cluster ID",
      "name": "string — human-readable cluster name",
      "memberIds": ["module-id-1", "module-id-2"],
      "purpose": "string — one-sentence purpose of this cluster"
    }
  ]
}
\`\`\`

Return ONLY the JSON, no other text.`;
}

// ============================================================================
// Response Parsing
// ============================================================================

/**
 * Parse the AI response into ClusterGroup objects.
 * Validates that all module IDs are accounted for.
 */
export function parseClusterResponse(
    response: string,
    modules: ModuleInfo[]
): ClusterGroup[] {
    const json = extractJSON(response);
    if (!json) {
        return [];
    }

    let parsed: unknown;
    try {
        parsed = typeof json === 'string' ? JSON.parse(json) : json;
    } catch {
        return [];
    }

    const data = parsed as Record<string, unknown>;
    const rawClusters = data?.clusters;
    if (!Array.isArray(rawClusters)) {
        return [];
    }

    const validModuleIds = new Set(modules.map(m => m.id));
    const assignedIds = new Set<string>();
    const clusters: ClusterGroup[] = [];

    for (const raw of rawClusters) {
        if (!raw || typeof raw !== 'object') { continue; }
        const r = raw as Record<string, unknown>;

        const id = typeof r.id === 'string' ? normalizeModuleId(r.id) : '';
        const name = typeof r.name === 'string' ? r.name : '';
        const purpose = typeof r.purpose === 'string' ? r.purpose : '';
        const memberIds = Array.isArray(r.memberIds)
            ? (r.memberIds as unknown[])
                .filter((mid): mid is string => typeof mid === 'string' && validModuleIds.has(mid))
                .filter(mid => !assignedIds.has(mid))
            : [];

        if (id && memberIds.length > 0) {
            for (const mid of memberIds) {
                assignedIds.add(mid);
            }
            clusters.push({ id, name: name || id, memberIds, purpose });
        }
    }

    // Assign any unassigned modules to their own singleton cluster
    for (const mod of modules) {
        if (!assignedIds.has(mod.id)) {
            clusters.push({
                id: mod.id,
                name: mod.name,
                memberIds: [mod.id],
                purpose: mod.purpose,
            });
        }
    }

    return clusters;
}

// ============================================================================
// Cluster Merging
// ============================================================================

/**
 * Apply cluster assignments by merging modules within each cluster.
 */
export function applyClusterMerge(
    graph: ModuleGraph,
    clusters: ClusterGroup[]
): ModuleGraph {
    const moduleMap = new Map(graph.modules.map(m => [m.id, m]));
    const idMapping = new Map<string, string>(); // old ID → cluster ID
    const mergedModules: ModuleInfo[] = [];

    for (const cluster of clusters) {
        const members = cluster.memberIds
            .map(id => moduleMap.get(id))
            .filter((m): m is ModuleInfo => m !== undefined);

        if (members.length === 0) { continue; }

        if (members.length === 1) {
            // Singleton — keep as-is
            const mod = members[0];
            idMapping.set(mod.id, mod.id);
            mergedModules.push(mod);
        } else {
            // Merge members into cluster module
            const merged = mergeClusterMembers(cluster, members);
            for (const mod of members) {
                idMapping.set(mod.id, cluster.id);
            }
            mergedModules.push(merged);
        }
    }

    // Fix up dependency references
    const moduleIds = new Set(mergedModules.map(m => m.id));
    const fixedModules = mergedModules.map(mod => ({
        ...mod,
        dependencies: dedup(
            mod.dependencies
                .map(d => idMapping.get(d) || d)
                .filter(d => d !== mod.id && moduleIds.has(d))
        ),
        dependents: dedup(
            mod.dependents
                .map(d => idMapping.get(d) || d)
                .filter(d => d !== mod.id && moduleIds.has(d))
        ),
    }));

    // Re-derive categories
    const categories = deriveFreshCategories(fixedModules);

    return {
        ...graph,
        modules: fixedModules,
        categories,
    };
}

// ============================================================================
// Helpers
// ============================================================================

function mergeClusterMembers(cluster: ClusterGroup, members: ModuleInfo[]): ModuleInfo {
    const selfIds = new Set(members.map(m => m.id));

    const keyFiles = dedup(members.flatMap(m => m.keyFiles));
    const dependencies = dedup(
        members.flatMap(m => m.dependencies).filter(d => !selfIds.has(d))
    );
    const dependents = dedup(
        members.flatMap(m => m.dependents).filter(d => !selfIds.has(d))
    );

    // Pick highest complexity
    const complexity = resolveMaxComplexity(members);

    // Pick most common category
    const catCounts = new Map<string, number>();
    for (const m of members) {
        catCounts.set(m.category, (catCounts.get(m.category) || 0) + 1);
    }
    let category = members[0].category;
    let bestCount = 0;
    for (const [cat, count] of catCounts) {
        if (count > bestCount) { category = cat; bestCount = count; }
    }

    // Use shortest path as representative
    const shortestPath = members
        .map(m => m.path)
        .sort((a, b) => a.length - b.length)[0];

    // Collect all mergedFrom (flatten if already merged)
    const mergedFrom = dedup(
        members.flatMap(m => m.mergedFrom || [m.id])
    );

    // Preserve domain if consistent
    const domains = new Set(members.map(m => m.domain).filter(Boolean));
    const domain = domains.size === 1 ? [...domains][0] : undefined;

    return {
        id: cluster.id,
        name: cluster.name,
        path: shortestPath,
        purpose: cluster.purpose || members.map(m => m.purpose).slice(0, 2).join('; '),
        keyFiles,
        dependencies,
        dependents,
        complexity,
        category,
        domain,
        mergedFrom,
    };
}

function dedup(arr: string[]): string[] {
    return [...new Set(arr)];
}

function deriveFreshCategories(modules: ModuleInfo[]): CategoryInfo[] {
    const categoryMap = new Map<string, number>();
    for (const mod of modules) {
        categoryMap.set(mod.category, (categoryMap.get(mod.category) || 0) + 1);
    }
    return Array.from(categoryMap.entries()).map(([name, count]) => ({
        name,
        description: `Contains ${count} module(s)`,
    }));
}
