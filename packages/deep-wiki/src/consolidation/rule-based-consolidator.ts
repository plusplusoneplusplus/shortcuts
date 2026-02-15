/**
 * Rule-Based Component Consolidator
 *
 * Merges fine-grained components by directory proximity.
 * This is the fast, deterministic first pass of the hybrid consolidation.
 *
 * Algorithm:
 * 1. Group components by their parent directory path
 * 2. Merge components sharing the same directory into a single component
 * 3. Fix up dependency references (old IDs → new merged IDs)
 * 4. Re-derive categories from merged components
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import type { ComponentInfo, ComponentGraph, CategoryInfo } from '../types';
import { normalizeComponentId } from '../schemas';
import { resolveMaxComplexity } from './constants';

// ============================================================================
// Types
// ============================================================================

/**
 * Intermediate grouping of components by directory.
 */
interface DirectoryGroup {
    /** Normalized directory path (e.g., "src/shortcuts/tasks-viewer") */
    dirPath: string;
    /** Components in this directory */
    components: ComponentInfo[];
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Consolidate components by directory proximity.
 *
 * Components sharing the same parent directory are merged into a single component.
 * The merged component inherits the union of keyFiles, dependencies, dependents,
 * and picks the highest complexity level.
 *
 * @param graph - The original component graph from discovery
 * @returns A new component graph with consolidated components
 */
export function consolidateByDirectory(graph: ComponentGraph): ComponentGraph {
    const components = graph.components;

    if (components.length === 0) {
        return graph;
    }

    // Step 1: Group modules by parent directory
    const groups = groupComponentsByDirectory(components);

    // Step 2: Merge each group into a single component
    const mergedComponents: ComponentInfo[] = [];
    const idMapping = new Map<string, string>(); // old ID → new ID

    for (const group of groups) {
        if (group.components.length === 1) {
            // Single component in directory — keep as-is
            const comp = group.components[0];
            idMapping.set(comp.id, comp.id);
            mergedComponents.push(comp);
        } else {
            // Multiple components — merge
            const merged = mergeComponentGroup(group);
            for (const comp of group.components) {
                idMapping.set(comp.id, merged.id);
            }
            mergedComponents.push(merged);
        }
    }

    // Step 3: Fix up dependency references
    const fixedComponents = fixDependencyReferences(mergedComponents, idMapping);

    // Step 4: Re-derive categories
    const categories = deriveCategories(fixedComponents);

    return {
        ...graph,
        components: fixedComponents,
        categories,
    };
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Get the parent directory of a component's path.
 * Handles both file paths and directory paths.
 */
export function getComponentDirectory(modulePath: string): string {
    // Normalize path separators
    const normalized = modulePath.replace(/\\/g, '/');

    // Remove trailing slash
    const cleaned = normalized.replace(/\/$/, '');

    // If path looks like a file (has extension), get its directory
    const lastSegment = cleaned.split('/').pop() || '';
    if (lastSegment.includes('.')) {
        return path.posix.dirname(cleaned);
    }

    // It's already a directory path
    return cleaned;
}

/**
 * Group components by their parent directory path.
 */
function groupComponentsByDirectory(components: ComponentInfo[]): DirectoryGroup[] {
    const dirMap = new Map<string, ComponentInfo[]>();

    for (const comp of components) {
        const dir = getComponentDirectory(comp.path);
        if (!dirMap.has(dir)) {
            dirMap.set(dir, []);
        }
        dirMap.get(dir)!.push(comp);
    }

    return Array.from(dirMap.entries()).map(([dirPath, comps]) => ({
        dirPath,
        components: comps,
    }));
}

/**
 * Merge multiple components in the same directory into a single component.
 */
function mergeComponentGroup(group: DirectoryGroup): ComponentInfo {
    const { dirPath, components: comps } = group;

    // Derive a name from the directory path
    const dirName = dirPath.split('/').pop() || dirPath;
    const id = normalizeComponentId(dirPath);
    const name = dirName
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

    // Union of all key files
    const keyFiles = deduplicateStrings(
        comps.flatMap(m => m.keyFiles)
    );

    // Union of all dependency IDs (will be fixed up later)
    const allDeps = deduplicateStrings(
        comps.flatMap(m => m.dependencies)
    );
    // Remove self-references (modules within this group)
    const selfIds = new Set(comps.map(m => m.id));
    const dependencies = allDeps.filter(d => !selfIds.has(d));

    // Union of all dependent IDs
    const allDependents = deduplicateStrings(
        comps.flatMap(m => m.dependents)
    );
    const dependents = allDependents.filter(d => !selfIds.has(d));

    // Pick highest complexity
    const complexity = pickHighestComplexity(comps);

    // Pick most common category
    const category = pickMostCommonCategory(comps);

    // Combine purposes
    const purpose = combinePurposes(comps);

    // Track provenance
    const mergedFrom = comps.map(m => m.id);

    // Preserve domain if all modules share the same domain
    const domains = new Set(comps.map(m => m.domain).filter(Boolean));
    const domain = domains.size === 1 ? [...domains][0] : undefined;

    return {
        id,
        name,
        path: dirPath.endsWith('/') ? dirPath : dirPath + '/',
        purpose,
        keyFiles,
        dependencies,
        dependents,
        complexity,
        category,
        domain,
        mergedFrom,
    };
}

/**
 * Fix dependency and dependent references to use merged IDs.
 * Also remove self-references created by merging.
 */
function fixDependencyReferences(
    components: ComponentInfo[],
    idMapping: Map<string, string>
): ComponentInfo[] {
    const componentIds = new Set(components.map(m => m.id));

    return components.map(comp => ({
        ...comp,
        dependencies: deduplicateStrings(
            comp.dependencies
                .map(d => idMapping.get(d) || d)
                .filter(d => d !== comp.id && componentIds.has(d))
        ),
        dependents: deduplicateStrings(
            comp.dependents
                .map(d => idMapping.get(d) || d)
                .filter(d => d !== comp.id && componentIds.has(d))
        ),
    }));
}

/**
 * Derive fresh categories from the merged components.
 */
function deriveCategories(components: ComponentInfo[]): CategoryInfo[] {
    const categoryMap = new Map<string, Set<string>>();

    for (const comp of components) {
        if (!categoryMap.has(comp.category)) {
            categoryMap.set(comp.category, new Set());
        }
        categoryMap.get(comp.category)!.add(comp.id);
    }

    return Array.from(categoryMap.entries()).map(([name, componentIds]) => ({
        name,
        description: `Contains ${componentIds.size} component(s)`,
    }));
}

// ============================================================================
// Utility Helpers
// ============================================================================

function deduplicateStrings(arr: string[]): string[] {
    return [...new Set(arr)];
}

function pickHighestComplexity(components: ComponentInfo[]): 'low' | 'medium' | 'high' {
    return resolveMaxComplexity(components);
}

function pickMostCommonCategory(components: ComponentInfo[]): string {
    const counts = new Map<string, number>();
    for (const m of components) {
        counts.set(m.category, (counts.get(m.category) || 0) + 1);
    }
    let best = components[0].category;
    let bestCount = 0;
    for (const [cat, count] of counts) {
        if (count > bestCount) {
            best = cat;
            bestCount = count;
        }
    }
    return best;
}

function combinePurposes(components: ComponentInfo[]): string {
    if (components.length === 1) {
        return components[0].purpose;
    }
    // Use first component's purpose as base, mention others are included
    const unique = deduplicateStrings(components.map(m => m.purpose));
    if (unique.length === 1) {
        return unique[0];
    }
    // Combine up to 3 purposes, truncate rest
    const shown = unique.slice(0, 3);
    const remaining = unique.length - shown.length;
    const combined = shown.join('; ');
    return remaining > 0
        ? `${combined} (+${remaining} more)`
        : combined;
}
