/**
 * AI-Assisted Component Consolidator
 *
 * Uses a single AI session to semantically cluster pre-consolidated components
 * into a target number of high-level groups. This is the second pass of the
 * hybrid consolidation, running after the rule-based pass.
 *
 * The AI receives a compact component list and returns cluster assignments.
 * Components within each cluster are then programmatically merged.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { AIInvoker } from '@plusplusoneplusplus/pipeline-core';
import { extractJSON } from '@plusplusoneplusplus/pipeline-core';
import type { ComponentInfo, ComponentGraph, CategoryInfo } from '../types';
import type { ClusterGroup } from './types';
import { normalizeComponentId } from '../schemas';
import { resolveMaxComplexity } from './constants';

// ============================================================================
// Constants
// ============================================================================

/** Default target component count */
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
    /** Target number of components after clustering (default: 50) */
    targetCount?: number;
    /** AI model to use */
    model?: string;
    /** Timeout in milliseconds (default: 120000) */
    timeoutMs?: number;
}

/**
 * Cluster components using AI semantic analysis.
 *
 * Sends the component list to AI, which groups semantically related components.
 * Then programmatically merges each cluster into a single component.
 *
 * @param graph - Component graph (typically after rule-based consolidation)
 * @param options - AI clustering options
 * @returns Consolidated component graph
 */
export async function clusterWithAI(
    graph: ComponentGraph,
    options: AIClusteringOptions
): Promise<ComponentGraph> {
    const { aiInvoker, model } = options;
    const targetCount = options.targetCount || DEFAULT_TARGET_COUNT;
    const timeoutMs = options.timeoutMs || DEFAULT_CLUSTERING_TIMEOUT_MS;

    const components = graph.components;

    // Skip if already at or below target
    if (components.length <= targetCount) {
        return graph;
    }

    // Build the clustering prompt
    const prompt = buildClusteringPrompt(components, graph.project.name, targetCount);

    // Call AI
    const result = await aiInvoker(prompt, { model, timeoutMs });

    if (!result.success || !result.response) {
        // AI failed — return graph unchanged
        return graph;
    }

    // Parse the cluster assignments
    const clusters = parseClusterResponse(result.response, components);

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
 * Sends a compact component list and asks for semantic groupings.
 */
export function buildClusteringPrompt(
    components: ComponentInfo[],
    projectName: string,
    targetCount: number
): string {
    // Build compact component list
    const componentList = components
        .map(m => `- ${m.id}: ${m.path} — ${m.purpose}`)
        .join('\n');

    return `You are analyzing the codebase of "${projectName}" which has ${components.length} components.
Your task is to cluster semantically related components into ${targetCount} (or fewer) high-level groups for documentation purposes.

## Current Components

${componentList}

## Instructions

Group these components into approximately ${targetCount} clusters based on:
1. **Functional cohesion** — components that serve the same feature or subsystem
2. **Directory proximity** — components in related paths
3. **Dependency relationships** — tightly coupled components

Rules:
- Every component ID must appear in exactly one cluster
- Each cluster should have a descriptive name and purpose
- Prefer fewer, broader clusters over many small ones
- A cluster can have a single component if it's truly standalone

## Output Format

Return a JSON object with this exact structure:

\`\`\`json
{
  "clusters": [
    {
      "id": "string — kebab-case cluster ID",
      "name": "string — human-readable cluster name",
      "memberIds": ["component-id-1", "component-id-2"],
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
 * Validates that all component IDs are accounted for.
 */
export function parseClusterResponse(
    response: string,
    components: ComponentInfo[]
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

    const validComponentIds = new Set(components.map(m => m.id));
    const assignedIds = new Set<string>();
    const clusters: ClusterGroup[] = [];

    for (const raw of rawClusters) {
        if (!raw || typeof raw !== 'object') { continue; }
        const r = raw as Record<string, unknown>;

        const id = typeof r.id === 'string' ? normalizeComponentId(r.id) : '';
        const name = typeof r.name === 'string' ? r.name : '';
        const purpose = typeof r.purpose === 'string' ? r.purpose : '';
        const memberIds = Array.isArray(r.memberIds)
            ? (r.memberIds as unknown[])
                .filter((mid): mid is string => typeof mid === 'string' && validComponentIds.has(mid))
                .filter(mid => !assignedIds.has(mid))
            : [];

        if (id && memberIds.length > 0) {
            for (const mid of memberIds) {
                assignedIds.add(mid);
            }
            clusters.push({ id, name: name || id, memberIds, purpose });
        }
    }

    // Assign any unassigned components to their own singleton cluster
    for (const comp of components) {
        if (!assignedIds.has(comp.id)) {
            clusters.push({
                id: comp.id,
                name: comp.name,
                memberIds: [comp.id],
                purpose: comp.purpose,
            });
        }
    }

    return clusters;
}

// ============================================================================
// Cluster Merging
// ============================================================================

/**
 * Apply cluster assignments by merging components within each cluster.
 */
export function applyClusterMerge(
    graph: ComponentGraph,
    clusters: ClusterGroup[]
): ComponentGraph {
    const componentMap = new Map(graph.components.map(m => [m.id, m]));
    const idMapping = new Map<string, string>(); // old ID → cluster ID
    const mergedComponents: ComponentInfo[] = [];

    for (const cluster of clusters) {
        const members = cluster.memberIds
            .map(id => componentMap.get(id))
            .filter((m): m is ComponentInfo => m !== undefined);

        if (members.length === 0) { continue; }

        if (members.length === 1) {
            // Singleton — keep as-is
            const comp = members[0];
            idMapping.set(comp.id, comp.id);
            mergedComponents.push(comp);
        } else {
            // Merge members into cluster component
            const merged = mergeClusterMembers(cluster, members);
            for (const comp of members) {
                idMapping.set(comp.id, cluster.id);
            }
            mergedComponents.push(merged);
        }
    }

    // Fix up dependency references
    const componentIds = new Set(mergedComponents.map(m => m.id));
    const fixedComponents = mergedComponents.map(comp => ({
        ...comp,
        dependencies: dedup(
            comp.dependencies
                .map(d => idMapping.get(d) || d)
                .filter(d => d !== comp.id && componentIds.has(d))
        ),
        dependents: dedup(
            comp.dependents
                .map(d => idMapping.get(d) || d)
                .filter(d => d !== comp.id && componentIds.has(d))
        ),
    }));

    // Re-derive categories
    const categories = deriveFreshCategories(fixedComponents);

    return {
        ...graph,
        components: fixedComponents,
        categories,
    };
}

// ============================================================================
// Helpers
// ============================================================================

function mergeClusterMembers(cluster: ClusterGroup, members: ComponentInfo[]): ComponentInfo {
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

function deriveFreshCategories(components: ComponentInfo[]): CategoryInfo[] {
    const categoryMap = new Map<string, number>();
    for (const comp of components) {
        categoryMap.set(comp.category, (categoryMap.get(comp.category) || 0) + 1);
    }
    return Array.from(categoryMap.entries()).map(([name, count]) => ({
        name,
        description: `Contains ${count} component(s)`,
    }));
}
