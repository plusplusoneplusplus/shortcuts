import type { TopicRequest, ModuleGraph, TopicSeed } from '../types';
import type { TopicProbeResult } from '../discovery/iterative/types';
import { runTopicProbe } from '../discovery/iterative/probe-session';

export interface TopicProbeOptions {
    repoPath: string;
    topic: TopicRequest;
    existingGraph?: ModuleGraph;
    model?: string;
    timeout?: number; // default: 120s
}

export interface EnrichedProbeResult {
    probeResult: TopicProbeResult;
    /** Modules from probe that already have articles in the wiki */
    existingModuleIds: string[];
    /** Modules from probe that are new (no existing article) */
    newModuleIds: string[];
    /** All discovered key files across found modules */
    allKeyFiles: string[];
}

/**
 * Convert TopicRequest to TopicSeed for the probe session.
 * If no description provided, generates a basic one from the topic name.
 * If no hints provided, derives hints from the topic name.
 */
export function buildTopicSeed(topic: TopicRequest): TopicSeed {
    const description = topic.description
        ?? `Discover code related to ${topic.topic.replace(/-/g, ' ')}`;

    const hints = topic.hints && topic.hints.length > 0
        ? topic.hints
        : generateHints(topic.topic);

    return {
        topic: topic.topic,
        description,
        hints,
    };
}

/**
 * Derive search hints from a kebab-case topic name.
 * Splits on hyphens and adds common morphological variations.
 */
function generateHints(topicName: string): string[] {
    const parts = topicName.split('-');
    const hints = new Set<string>();

    // Add each part as a hint
    for (const part of parts) {
        hints.add(part);
    }

    // Add the full topic name (with hyphens)
    hints.add(topicName);

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
 * Run a single topic probe and enrich results with existing wiki context.
 */
export async function runSingleTopicProbe(
    options: TopicProbeOptions
): Promise<EnrichedProbeResult> {
    const seed = buildTopicSeed(options.topic);
    const timeout = options.timeout ?? 120;

    const probeResult = await runTopicProbe(options.repoPath, seed, {
        model: options.model,
        timeout,
    });

    return enrichProbeResult(probeResult, options.existingGraph);
}

/**
 * Cross-reference probe results with an existing ModuleGraph.
 * Matches by exact ID and by directory path overlap.
 */
function enrichProbeResult(
    probeResult: TopicProbeResult,
    existingGraph?: ModuleGraph
): EnrichedProbeResult {
    const existingModuleIds: string[] = [];
    const newModuleIds: string[] = [];
    const allKeyFiles: string[] = [];

    // Collect all key files
    for (const mod of probeResult.foundModules) {
        for (const f of mod.keyFiles) {
            if (!allKeyFiles.includes(f)) {
                allKeyFiles.push(f);
            }
        }
    }

    if (!existingGraph || existingGraph.modules.length === 0) {
        // No existing graph — all modules are new
        return {
            probeResult,
            existingModuleIds: [],
            newModuleIds: probeResult.foundModules.map(m => m.id),
            allKeyFiles,
        };
    }

    // Build lookup structures for existing modules
    const existingIds = new Set(existingGraph.modules.map(m => m.id));
    const existingPaths = new Map(
        existingGraph.modules.map(m => [normalizePath(m.path), m.id])
    );

    for (const mod of probeResult.foundModules) {
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
