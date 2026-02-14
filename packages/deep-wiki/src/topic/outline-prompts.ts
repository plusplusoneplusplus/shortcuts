/**
 * Topic Outline — Prompt Templates
 *
 * Builds AI prompts for decomposing a topic into a structured article outline.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { TopicRequest } from '../types';
import type { EnrichedProbeResult } from './topic-probe';

// ============================================================================
// Prompt Builder
// ============================================================================

/**
 * Build the prompt for topic outline generation.
 *
 * The prompt includes topic context, discovered modules, and depth instructions.
 * The AI is asked to return a JSON object describing the article layout.
 *
 * @param topic - The topic request
 * @param probeResult - Enriched probe results with module info
 * @param depth - How deeply to decompose the topic
 * @returns Prompt string for the AI
 */
export function buildOutlinePrompt(
    topic: TopicRequest,
    probeResult: EnrichedProbeResult,
    depth: 'shallow' | 'normal' | 'deep'
): string {
    const moduleSummaries = probeResult.probeResult.foundModules.map((mod, i) => {
        const keyFilesStr = mod.keyFiles.length > 0
            ? `\n    Key files: ${mod.keyFiles.join(', ')}`
            : '';
        return `  ${i + 1}. **${mod.name}** (id: ${mod.id}, path: ${mod.path})
    Purpose: ${mod.purpose}${keyFilesStr}
    Evidence: ${mod.evidence}`;
    }).join('\n');

    const depthInstruction = getDepthInstruction(depth);
    const moduleCount = probeResult.probeResult.foundModules.length;

    const layoutHint = moduleCount <= 2
        ? 'Given the small number of modules, prefer a single-article layout unless the content is clearly separable.'
        : moduleCount <= 6
            ? 'Consider an area layout with an index article and per-aspect sub-articles.'
            : 'This is a large topic. Use an area layout with an index overview and multiple focused sub-articles.';

    const topicDescription = topic.description
        ? `\nDescription: ${topic.description}`
        : '';

    const topicHints = topic.hints && topic.hints.length > 0
        ? `\nSearch hints: ${topic.hints.join(', ')}`
        : '';

    return `You are a technical documentation planner. Your task is to decompose a codebase topic into a structured article outline.

## Topic
Name: ${topic.topic}${topicDescription}${topicHints}

## Discovered Modules (${moduleCount} found)
${moduleSummaries || '  (no modules discovered)'}

## Instructions
${layoutHint}

${depthInstruction}

Decide whether this topic warrants:
- **"single"** layout: One comprehensive article covering everything
- **"area"** layout: An index article plus multiple focused sub-articles

For area layout, the first article MUST have \`"isIndex": true\` and slug \`"index"\`.
Each article should be focused and self-contained, targeting ~1000-3000 words.
Group related modules into coherent articles. Every discovered module should be covered by at least one article.

## Output Format
Return a single JSON object (no markdown fences, no extra text):
{
  "title": "Human-readable topic title",
  "layout": "single" or "area",
  "articles": [
    {
      "slug": "url-safe-slug",
      "title": "Article Title",
      "description": "Brief description of what this article covers",
      "isIndex": false,
      "coveredModuleIds": ["module-id-1", "module-id-2"],
      "coveredFiles": ["path/to/file1.ts", "path/to/file2.ts"]
    }
  ]
}`;
}

/**
 * Get depth-specific instructions for the prompt.
 */
function getDepthInstruction(depth: 'shallow' | 'normal' | 'deep'): string {
    switch (depth) {
        case 'shallow':
            return 'Depth: SHALLOW — Prefer fewer articles with broader scope. Combine related modules aggressively. Aim for 1-2 articles total.';
        case 'normal':
            return 'Depth: NORMAL — Balanced decomposition. Group closely related modules, but separate distinct concerns. Aim for a reasonable number of articles.';
        case 'deep':
            return 'Depth: DEEP — Fine-grained decomposition. Create more articles with narrower focus. Include articles for internals, tuning, and edge cases. Aim for thorough coverage.';
    }
}
