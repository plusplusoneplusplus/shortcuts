import type { ThemeRequest, ComponentGraph, ThemeSeed } from '../types';
import type { ThemeProbeResult } from '../discovery/iterative/types';
import { runThemeProbe } from '../discovery/iterative/probe-session';

export interface ThemeProbeOptions {
    repoPath: string;
    theme: ThemeRequest;
    existingGraph?: ComponentGraph;
    model?: string;
    timeout?: number; // default: 120s
}

export interface EnrichedProbeResult {
    probeResult: ThemeProbeResult;
    /** Modules from probe that already have articles in the wiki */
    existingModuleIds: string[];
    /** Modules from probe that are new (no existing article) */
    newModuleIds: string[];
    /** All discovered key files across found modules */
    allKeyFiles: string[];
}

/**
 * Convert ThemeRequest to ThemeSeed for the probe session.
 * If no description provided, generates a basic one from the theme name.
 * If no hints provided, derives hints from the theme name.
 */
export function buildThemeSeed(theme: ThemeRequest): ThemeSeed {
    const description = theme.description
        ?? `Discover code related to ${theme.theme.replace(/-/g, ' ')}`;

    const hints = theme.hints && theme.hints.length > 0
        ? theme.hints
        : generateHints(theme.theme);

    return {
        theme: theme.theme,
        description,
        hints,
    };
}

/**
 * Derive search hints from a kebab-case theme name.
 * Splits on hyphens and adds common morphological variations.
 */
function generateHints(themeName: string): string[] {
    const parts = themeName.split('-');
    const hints = new Set<string>();

    // Add each part as a hint
    for (const part of parts) {
        hints.add(part);
    }

    // Add the full theme name (with hyphens)
    hints.add(themeName);

    // Add common suffix variations for each part
    for (const part of parts) {
        if (part.length < 3) continue;
        // -ing form
        if (part.endsWith('e')) {
            hints.add(part.slice(0, -1) + 'ing');
        } else {
            hints.add(part + 'ing');
        }
        // -or / -er form
        hints.add(part + 'or');
        hints.add(part + 'er');
    }

    return [...hints];
}

/**
 * Run a single theme probe and enrich results with existing wiki context.
 */
export async function runSingleThemeProbe(
    options: ThemeProbeOptions
): Promise<EnrichedProbeResult> {
    const seed = buildThemeSeed(options.theme);
    const timeout = options.timeout ?? 120;

    const probeResult = await runThemeProbe(options.repoPath, seed, {
        model: options.model,
        timeout,
    });

    return enrichProbeResult(probeResult, options.existingGraph);
}

/**
 * Cross-reference probe results with an existing ComponentGraph.
 * Matches by exact ID and by directory path overlap.
 */
function enrichProbeResult(
    probeResult: ThemeProbeResult,
    existingGraph?: ComponentGraph
): EnrichedProbeResult {
    const existingModuleIds: string[] = [];
    const newModuleIds: string[] = [];
    const allKeyFiles: string[] = [];

    // Collect all key files
    for (const mod of probeResult.foundComponents) {
        for (const f of mod.keyFiles) {
            if (!allKeyFiles.includes(f)) {
                allKeyFiles.push(f);
            }
        }
    }

    if (!existingGraph || existingGraph.components.length === 0) {
        // No existing graph — all modules are new
        return {
            probeResult,
            existingModuleIds: [],
            newModuleIds: probeResult.foundComponents.map(m => m.id),
            allKeyFiles,
        };
    }

    // Build lookup structures for existing modules
    const existingIds = new Set(existingGraph.components.map(m => m.id));
    const existingPaths = new Map(
        existingGraph.components.map(m => [normalizePath(m.path), m.id])
    );

    for (const mod of probeResult.foundComponents) {
        if (existingIds.has(mod.id)) {
            existingModuleIds.push(mod.id);
        } else if (existingPaths.has(normalizePath(mod.path))) {
            // Fuzzy match: same directory = likely same module
            existingModuleIds.push(mod.id);
        } else {
            newModuleIds.push(mod.id);
        }
    }

    return { probeResult, existingModuleIds, newModuleIds, allKeyFiles };
}

/** Normalize a path for comparison (strip trailing slashes, lowercase). */
function normalizePath(p: string): string {
    return p.replace(/\/+$/, '').toLowerCase();
}
