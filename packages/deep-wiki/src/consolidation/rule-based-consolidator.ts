/**
 * Rule-Based Module Consolidator
 *
 * Merges fine-grained modules by directory proximity.
 * This is the fast, deterministic first pass of the hybrid consolidation.
 *
 * Algorithm:
 * 1. Group modules by their parent directory path
 * 2. Merge modules sharing the same directory into a single module
 * 3. Fix up dependency references (old IDs → new merged IDs)
 * 4. Re-derive categories from merged modules
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import type { ModuleInfo, ModuleGraph, CategoryInfo } from '../types';
import { normalizeModuleId } from '../schemas';
import { resolveMaxComplexity } from './constants';

// ============================================================================
// Types
// ============================================================================

/**
 * Intermediate grouping of modules by directory.
 */
interface DirectoryGroup {
    /** Normalized directory path (e.g., "src/shortcuts/tasks-viewer") */
    dirPath: string;
    /** Modules in this directory */
    modules: ModuleInfo[];
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Consolidate modules by directory proximity.
 *
 * Modules sharing the same parent directory are merged into a single module.
 * The merged module inherits the union of keyFiles, dependencies, dependents,
 * and picks the highest complexity level.
 *
 * @param graph - The original module graph from discovery
 * @returns A new module graph with consolidated modules
 */
export function consolidateByDirectory(graph: ModuleGraph): ModuleGraph {
    const modules = graph.modules;

    if (modules.length === 0) {
        return graph;
    }

    // Step 1: Group modules by parent directory
    const groups = groupModulesByDirectory(modules);

    // Step 2: Merge each group into a single module
    const mergedModules: ModuleInfo[] = [];
    const idMapping = new Map<string, string>(); // old ID → new ID

    for (const group of groups) {
        if (group.modules.length === 1) {
            // Single module in directory — keep as-is
            const mod = group.modules[0];
            idMapping.set(mod.id, mod.id);
            mergedModules.push(mod);
        } else {
            // Multiple modules — merge
            const merged = mergeModuleGroup(group);
            for (const mod of group.modules) {
                idMapping.set(mod.id, merged.id);
            }
            mergedModules.push(merged);
        }
    }

    // Step 3: Fix up dependency references
    const fixedModules = fixDependencyReferences(mergedModules, idMapping);

    // Step 4: Re-derive categories
    const categories = deriveCategories(fixedModules);

    return {
        ...graph,
        modules: fixedModules,
        categories,
    };
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Get the parent directory of a module's path.
 * Handles both file paths and directory paths.
 */
export function getModuleDirectory(modulePath: string): string {
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
 * Group modules by their parent directory path.
 */
function groupModulesByDirectory(modules: ModuleInfo[]): DirectoryGroup[] {
    const dirMap = new Map<string, ModuleInfo[]>();

    for (const mod of modules) {
        const dir = getModuleDirectory(mod.path);
        if (!dirMap.has(dir)) {
            dirMap.set(dir, []);
        }
        dirMap.get(dir)!.push(mod);
    }

    return Array.from(dirMap.entries()).map(([dirPath, mods]) => ({
        dirPath,
        modules: mods,
    }));
}

/**
 * Merge multiple modules in the same directory into a single module.
 */
function mergeModuleGroup(group: DirectoryGroup): ModuleInfo {
    const { dirPath, modules } = group;

    // Derive a name from the directory path
    const dirName = dirPath.split('/').pop() || dirPath;
    const id = normalizeModuleId(dirPath);
    const name = dirName
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

    // Union of all key files
    const keyFiles = deduplicateStrings(
        modules.flatMap(m => m.keyFiles)
    );

    // Union of all dependency IDs (will be fixed up later)
    const allDeps = deduplicateStrings(
        modules.flatMap(m => m.dependencies)
    );
    // Remove self-references (modules within this group)
    const selfIds = new Set(modules.map(m => m.id));
    const dependencies = allDeps.filter(d => !selfIds.has(d));

    // Union of all dependent IDs
    const allDependents = deduplicateStrings(
        modules.flatMap(m => m.dependents)
    );
    const dependents = allDependents.filter(d => !selfIds.has(d));

    // Pick highest complexity
    const complexity = pickHighestComplexity(modules);

    // Pick most common category
    const category = pickMostCommonCategory(modules);

    // Combine purposes
    const purpose = combinePurposes(modules);

    // Track provenance
    const mergedFrom = modules.map(m => m.id);

    // Preserve domain if all modules share the same domain
    const domains = new Set(modules.map(m => m.domain).filter(Boolean));
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
    modules: ModuleInfo[],
    idMapping: Map<string, string>
): ModuleInfo[] {
    const moduleIds = new Set(modules.map(m => m.id));

    return modules.map(mod => ({
        ...mod,
        dependencies: deduplicateStrings(
            mod.dependencies
                .map(d => idMapping.get(d) || d)
                .filter(d => d !== mod.id && moduleIds.has(d))
        ),
        dependents: deduplicateStrings(
            mod.dependents
                .map(d => idMapping.get(d) || d)
                .filter(d => d !== mod.id && moduleIds.has(d))
        ),
    }));
}

/**
 * Derive fresh categories from the merged modules.
 */
function deriveCategories(modules: ModuleInfo[]): CategoryInfo[] {
    const categoryMap = new Map<string, Set<string>>();

    for (const mod of modules) {
        if (!categoryMap.has(mod.category)) {
            categoryMap.set(mod.category, new Set());
        }
        categoryMap.get(mod.category)!.add(mod.id);
    }

    return Array.from(categoryMap.entries()).map(([name, moduleIds]) => ({
        name,
        description: `Contains ${moduleIds.size} module(s)`,
    }));
}

// ============================================================================
// Utility Helpers
// ============================================================================

function deduplicateStrings(arr: string[]): string[] {
    return [...new Set(arr)];
}

function pickHighestComplexity(modules: ModuleInfo[]): 'low' | 'medium' | 'high' {
    return resolveMaxComplexity(modules);
}

function pickMostCommonCategory(modules: ModuleInfo[]): string {
    const counts = new Map<string, number>();
    for (const m of modules) {
        counts.set(m.category, (counts.get(m.category) || 0) + 1);
    }
    let best = modules[0].category;
    let bestCount = 0;
    for (const [cat, count] of counts) {
        if (count > bestCount) {
            best = cat;
            bestCount = count;
        }
    }
    return best;
}

function combinePurposes(modules: ModuleInfo[]): string {
    if (modules.length === 1) {
        return modules[0].purpose;
    }
    // Use first module's purpose as base, mention others are included
    const unique = deduplicateStrings(modules.map(m => m.purpose));
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
