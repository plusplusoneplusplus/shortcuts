/**
 * Theme Outline — Generator
 *
 * Generates a ThemeOutline by asking AI to decompose a theme into articles,
 * with a heuristic fallback when AI is unavailable.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    getCopilotSDKService,
    type SendMessageOptions,
} from '@plusplusoneplusplus/pipeline-core';
import type { ThemeRequest, ThemeOutline, ThemeArticlePlan, ThemeInvolvedComponent } from '../types';
import type { EnrichedProbeResult } from './theme-probe';
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
    theme: ThemeRequest;
    probeResult: EnrichedProbeResult;
    depth: 'shallow' | 'normal' | 'deep';
    model?: string;
    timeout?: number;
}

// ============================================================================
// AI-Driven Outline Generation
// ============================================================================

/**
 * Generate a ThemeOutline by asking AI to decompose the theme into articles.
 *
 * Decision logic (AI-guided with heuristic fallbacks):
 * - 1-2 modules found → single article layout
 * - 3-6 modules found → area with index + per-aspect articles
 * - 7+ modules found → deep area (may include sub-sections)
 *
 * Falls back to heuristic outline if AI is unavailable or fails.
 */
export async function generateThemeOutline(
    options: OutlineGeneratorOptions
): Promise<ThemeOutline> {
    const { repoPath, theme, probeResult, depth, model, timeout } = options;

    const service = getCopilotSDKService();
    const availability = await service.isAvailable();

    if (!availability) {
        printWarning('AI SDK unavailable, using fallback outline generation');
        return buildFallbackOutline(theme, probeResult);
    }

    const prompt = buildOutlinePrompt(theme, probeResult, depth);

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
        printInfo(`    Generating outline for theme: ${theme.theme} ${gray(`(depth: ${depth})`)}`);
        const result = await service.sendMessage(sendOptions);

        if (!result.success || !result.response) {
            printWarning(`    Outline generation failed for "${theme.theme}": ${result.error || 'empty response'}`);
            return buildFallbackOutline(theme, probeResult);
        }

        const outline = parseOutlineResponse(result.response, theme, probeResult);
        printInfo(`    Outline for "${theme.theme}": ${outline.layout} layout, ${outline.articles.length} article(s)`);
        return outline;
    } catch (error) {
        printWarning(`    Outline error for "${theme.theme}": ${getErrorMessage(error)}`);
        return buildFallbackOutline(theme, probeResult);
    }
}

// ============================================================================
// Response Parsing
// ============================================================================

/**
 * Parse AI response into a ThemeOutline.
 * Validates structure and normalizes fields.
 */
export function parseOutlineResponse(
    response: string,
    theme: ThemeRequest,
    probeResult: EnrichedProbeResult
): ThemeOutline {
    const obj = parseAIJsonResponse(response, { context: 'outline', repair: true });

    const title = typeof obj.title === 'string' ? obj.title : formatThemeTitle(theme.theme);
    const layout = obj.layout === 'single' || obj.layout === 'area' ? obj.layout : 'single';

    // Parse articles
    const articles: ThemeArticlePlan[] = [];
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
                coveredComponentIds: parseStringArray(art.coveredComponentIds),
                coveredFiles: parseStringArray(art.coveredFiles),
            });
        }
    }

    // Ensure at least one article exists
    if (articles.length === 0) {
        articles.push({
            slug: 'index',
            title: title,
            description: `Overview of ${theme.theme}`,
            isIndex: true,
            coveredComponentIds: probeResult.probeResult.foundComponents.map(m => m.id),
            coveredFiles: probeResult.allKeyFiles,
        });
    }

    // Build involvedComponents from probe results
    const involvedComponents = buildInvolvedModules(probeResult);

    return {
        themeId: theme.theme,
        title,
        layout,
        articles,
        involvedComponents,
    };
}

// ============================================================================
// Fallback Outline (No AI)
// ============================================================================

/**
 * Build outline without AI using module count heuristics.
 */
export function buildFallbackOutline(
    theme: ThemeRequest,
    probeResult: EnrichedProbeResult
): ThemeOutline {
    const modules = probeResult.probeResult.foundComponents;
    const title = formatThemeTitle(theme.theme);
    const involvedComponents = buildInvolvedModules(probeResult);

    if (modules.length <= 2) {
        // Single article covering everything
        return {
            themeId: theme.theme,
            title,
            layout: 'single',
            articles: [{
                slug: 'index',
                title,
                description: `Complete guide to ${theme.theme}`,
                isIndex: true,
                coveredComponentIds: modules.map(m => m.id),
                coveredFiles: probeResult.allKeyFiles,
            }],
            involvedComponents,
        };
    }

    // Area layout: index + one article per module
    const articles: ThemeArticlePlan[] = [];

    // Index article
    articles.push({
        slug: 'index',
        title: `${title} Overview`,
        description: `Introduction and overview of ${theme.theme}`,
        isIndex: true,
        coveredComponentIds: modules.map(m => m.id),
        coveredFiles: [],
    });

    // One article per module
    for (const mod of modules) {
        articles.push({
            slug: mod.id,
            title: mod.name,
            description: mod.purpose || `Details of ${mod.name}`,
            isIndex: false,
            coveredComponentIds: [mod.id],
            coveredFiles: mod.keyFiles,
        });
    }

    return {
        themeId: theme.theme,
        title,
        layout: 'area',
        articles,
        involvedComponents,
    };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build ThemeInvolvedComponent array from enriched probe results.
 */
function buildInvolvedModules(probeResult: EnrichedProbeResult): ThemeInvolvedComponent[] {
    return probeResult.probeResult.foundComponents.map(mod => ({
        componentId: mod.id,
        role: mod.purpose || mod.evidence || 'Related module',
        keyFiles: mod.keyFiles,
    }));
}

/**
 * Convert kebab-case theme ID to a human-readable title.
 */
function formatThemeTitle(themeId: string): string {
    return themeId
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
