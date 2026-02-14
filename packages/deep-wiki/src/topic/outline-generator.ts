/**
 * Topic Outline — Generator
 *
 * Generates a TopicOutline by asking AI to decompose a topic into articles,
 * with a heuristic fallback when AI is unavailable.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    getCopilotSDKService,
    type SendMessageOptions,
} from '@plusplusoneplusplus/pipeline-core';
import type { TopicRequest, TopicOutline, TopicArticlePlan, TopicInvolvedModule } from '../types';
import type { EnrichedProbeResult } from './topic-probe';
import { buildOutlinePrompt } from './outline-prompts';
import { parseAIJsonResponse } from '../utils/parse-ai-response';
import { printInfo, printWarning, gray } from '../logger';
import { getErrorMessage } from '../utils/error-utils';

// ============================================================================
// Constants
// ============================================================================

/** Default timeout for outline generation: 60 seconds */
const DEFAULT_OUTLINE_TIMEOUT_MS = 60_000;

// ============================================================================
// Types
// ============================================================================

export interface OutlineGeneratorOptions {
    repoPath: string;
    topic: TopicRequest;
    probeResult: EnrichedProbeResult;
    depth: 'shallow' | 'normal' | 'deep';
    model?: string;
    timeout?: number;
}

// ============================================================================
// AI-Driven Outline Generation
// ============================================================================

/**
 * Generate a TopicOutline by asking AI to decompose the topic into articles.
 *
 * Decision logic (AI-guided with heuristic fallbacks):
 * - 1-2 modules found → single article layout
 * - 3-6 modules found → area with index + per-aspect articles
 * - 7+ modules found → deep area (may include sub-sections)
 *
 * Falls back to heuristic outline if AI is unavailable or fails.
 */
export async function generateTopicOutline(
    options: OutlineGeneratorOptions
): Promise<TopicOutline> {
    const { repoPath, topic, probeResult, depth, model, timeout } = options;

    const service = getCopilotSDKService();
    const availability = await service.isAvailable();

    if (!availability) {
        printWarning('AI SDK unavailable, using fallback outline generation');
        return buildFallbackOutline(topic, probeResult);
    }

    const prompt = buildOutlinePrompt(topic, probeResult, depth);

    const sendOptions: SendMessageOptions = {
        prompt,
        workingDirectory: repoPath,
        usePool: false,
        timeoutMs: timeout ?? DEFAULT_OUTLINE_TIMEOUT_MS,
    };

    if (model) {
        sendOptions.model = model;
    }

    try {
        printInfo(`    Generating outline for topic: ${topic.topic} ${gray(`(depth: ${depth})`)}`);
        const result = await service.sendMessage(sendOptions);

        if (!result.success || !result.response) {
            printWarning(`    Outline generation failed for "${topic.topic}": ${result.error || 'empty response'}`);
            return buildFallbackOutline(topic, probeResult);
        }

        const outline = parseOutlineResponse(result.response, topic, probeResult);
        printInfo(`    Outline for "${topic.topic}": ${outline.layout} layout, ${outline.articles.length} article(s)`);
        return outline;
    } catch (error) {
        printWarning(`    Outline error for "${topic.topic}": ${getErrorMessage(error)}`);
        return buildFallbackOutline(topic, probeResult);
    }
}

// ============================================================================
// Response Parsing
// ============================================================================

/**
 * Parse AI response into a TopicOutline.
 * Validates structure and normalizes fields.
 */
export function parseOutlineResponse(
    response: string,
    topic: TopicRequest,
    probeResult: EnrichedProbeResult
): TopicOutline {
    const obj = parseAIJsonResponse(response, { context: 'outline', repair: true });

    const title = typeof obj.title === 'string' ? obj.title : formatTopicTitle(topic.topic);
    const layout = obj.layout === 'single' || obj.layout === 'area' ? obj.layout : 'single';

    // Parse articles
    const articles: TopicArticlePlan[] = [];
    if (Array.isArray(obj.articles)) {
        for (const item of obj.articles) {
            if (typeof item !== 'object' || item === null) continue;
            const art = item as Record<string, unknown>;

            if (typeof art.slug !== 'string' || typeof art.title !== 'string') continue;

            articles.push({
                slug: art.slug,
                title: art.title,
                description: typeof art.description === 'string' ? art.description : '',
                isIndex: art.isIndex === true,
                coveredModuleIds: parseStringArray(art.coveredModuleIds),
                coveredFiles: parseStringArray(art.coveredFiles),
            });
        }
    }

    // Ensure at least one article exists
    if (articles.length === 0) {
        articles.push({
            slug: 'index',
            title: title,
            description: `Overview of ${topic.topic}`,
            isIndex: true,
            coveredModuleIds: probeResult.probeResult.foundModules.map(m => m.id),
            coveredFiles: probeResult.allKeyFiles,
        });
    }

    // Build involvedModules from probe results
    const involvedModules = buildInvolvedModules(probeResult);

    return {
        topicId: topic.topic,
        title,
        layout,
        articles,
        involvedModules,
    };
}

// ============================================================================
// Fallback Outline (No AI)
// ============================================================================

/**
 * Build outline without AI using module count heuristics.
 */
export function buildFallbackOutline(
    topic: TopicRequest,
    probeResult: EnrichedProbeResult
): TopicOutline {
    const modules = probeResult.probeResult.foundModules;
    const title = formatTopicTitle(topic.topic);
    const involvedModules = buildInvolvedModules(probeResult);

    if (modules.length <= 2) {
        // Single article covering everything
        return {
            topicId: topic.topic,
            title,
            layout: 'single',
            articles: [{
                slug: 'index',
                title,
                description: `Complete guide to ${topic.topic}`,
                isIndex: true,
                coveredModuleIds: modules.map(m => m.id),
                coveredFiles: probeResult.allKeyFiles,
            }],
            involvedModules,
        };
    }

    // Area layout: index + one article per module
    const articles: TopicArticlePlan[] = [];

    // Index article
    articles.push({
        slug: 'index',
        title: `${title} Overview`,
        description: `Introduction and overview of ${topic.topic}`,
        isIndex: true,
        coveredModuleIds: modules.map(m => m.id),
        coveredFiles: [],
    });

    // One article per module
    for (const mod of modules) {
        articles.push({
            slug: mod.id,
            title: mod.name,
            description: mod.purpose || `Details of ${mod.name}`,
            isIndex: false,
            coveredModuleIds: [mod.id],
            coveredFiles: mod.keyFiles,
        });
    }

    return {
        topicId: topic.topic,
        title,
        layout: 'area',
        articles,
        involvedModules,
    };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build TopicInvolvedModule array from enriched probe results.
 */
function buildInvolvedModules(probeResult: EnrichedProbeResult): TopicInvolvedModule[] {
    return probeResult.probeResult.foundModules.map(mod => ({
        moduleId: mod.id,
        role: mod.purpose || mod.evidence || 'Related module',
        keyFiles: mod.keyFiles,
    }));
}

/**
 * Convert kebab-case topic ID to a human-readable title.
 */
function formatTopicTitle(topicId: string): string {
    return topicId
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Safely parse an unknown value as a string array.
 */
function parseStringArray(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(item => typeof item === 'string').map(item => String(item));
}
