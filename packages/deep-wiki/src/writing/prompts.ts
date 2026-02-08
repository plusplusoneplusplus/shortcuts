/**
 * Article Writing Prompt Templates
 *
 * Prompt templates for Phase 3 (Article Generation). Each module's analysis
 * is converted into a markdown article. Templates include cross-link
 * information and Mermaid diagram integration.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ModuleAnalysis, ModuleGraph, ModuleInfo, AreaInfo } from '../types';

// ============================================================================
// Simplified Graph for Cross-Linking
// ============================================================================

/**
 * Build a simplified module graph for cross-link reference.
 * Contains only names, IDs, and paths — not full analysis data.
 */
export function buildSimplifiedGraph(graph: ModuleGraph): string {
    const simplified = graph.modules.map(m => ({
        id: m.id,
        name: m.name,
        path: m.path,
        category: m.category,
    }));
    return JSON.stringify(simplified, null, 2);
}

// ============================================================================
// Depth Variants
// ============================================================================

const SHALLOW_STYLE = `
Write a concise article (500-800 words). Focus on:
- Brief overview paragraph
- Public API reference (table format)
- Basic usage example
- Key dependencies`;

const NORMAL_STYLE = `
Write a comprehensive article (800-1500 words). Include:
- Overview and purpose
- Architecture and design patterns
- Public API reference with descriptions
- Data flow explanation
- Code examples (use fenced code blocks with language)
- Dependency map
- Mermaid diagrams where the analysis suggests them`;

const DEEP_STYLE = `
Write a thorough, detailed article (1500-3000 words). Include:
- Comprehensive overview with context
- Detailed architecture walkthrough
- Complete public API reference with signatures and usage
- In-depth data flow and control flow explanation
- Error handling patterns
- Performance considerations
- Multiple code examples covering different aspects
- Mermaid diagrams (architecture + data flow if possible)
- Dependency analysis (internal and external)
- Related modules and cross-references`;

// ============================================================================
// Module Article Prompt
// ============================================================================

/**
 * Get the style guide for a given depth.
 */
export function getArticleStyleGuide(depth: 'shallow' | 'normal' | 'deep'): string {
    switch (depth) {
        case 'shallow': return SHALLOW_STYLE;
        case 'deep': return DEEP_STYLE;
        default: return NORMAL_STYLE;
    }
}

/**
 * Build the prompt for generating a single module article.
 *
 * @param analysis The module's analysis data
 * @param graph The full module graph (for cross-linking)
 * @param depth Article depth
 * @returns Complete prompt string
 */
export function buildModuleArticlePrompt(
    analysis: ModuleAnalysis,
    graph: ModuleGraph,
    depth: 'shallow' | 'normal' | 'deep'
): string {
    const simplifiedGraph = buildSimplifiedGraph(graph);
    const styleGuide = getArticleStyleGuide(depth);

    // Find module info for additional context
    const moduleInfo = graph.modules.find(m => m.id === analysis.moduleId);
    const moduleName = moduleInfo?.name || analysis.moduleId;
    const areaId = moduleInfo?.area;
    const crossLinkRules = buildCrossLinkRules(areaId);

    return `You are writing a wiki article for the "${moduleName}" module.

## Analysis Data

The following is a detailed analysis of this module:

\`\`\`json
${JSON.stringify(analysis, null, 2)}
\`\`\`

## Module Graph (for cross-linking)

Use this to create cross-references to other modules:

\`\`\`json
${simplifiedGraph}
\`\`\`

## Instructions
${styleGuide}

${crossLinkRules}

## Mermaid Diagrams

If the analysis includes a suggestedDiagram, include it in the article wrapped in:
\`\`\`mermaid
(diagram content)
\`\`\`

## Format

- Use GitHub-Flavored Markdown
- Start with a level-1 heading: # ${moduleName}
- Use proper heading hierarchy (## for sections, ### for subsections)
- Use fenced code blocks with language tags for code examples
- Use tables for API references where appropriate

Do NOT write, create, or save any files to disk. Return ONLY the markdown content in your response.`;
}

/**
 * Build cross-linking rules based on whether areas exist (hierarchical layout).
 *
 * @param areaId - The area this module belongs to (undefined for flat layout)
 * @returns Cross-linking rules string for prompt
 */
export function buildCrossLinkRules(areaId?: string): string {
    if (!areaId) {
        // Flat layout (small repos)
        return `## Cross-Linking Rules

- Link to other modules using relative paths: [Module Name](./modules/module-id.md)
- For the index page, link as: [Module Name](./modules/module-id.md)
- Use the module graph above to find valid module IDs for links
- Only link to modules that actually exist in the graph`;
    }

    // Hierarchical layout (large repos with areas)
    return `## Cross-Linking Rules

- This article is located at: areas/${areaId}/modules/<this-module>.md
- Link to modules in the SAME area: [Module Name](./module-id.md) (they are sibling files)
- Link to modules in OTHER areas: [Module Name](../../other-area-id/modules/module-id.md)
- Link to this area's index: [Area Index](../index.md)
- Link to the project index: [Project Index](../../../index.md)
- Use the module graph above to find valid module IDs and their areas for links
- Only link to modules that actually exist in the graph`;
}

/**
 * Build the prompt template for the map-reduce framework.
 * Uses {{variable}} placeholders for template substitution.
 *
 * @param depth Article depth
 * @param areaId Optional area ID for hierarchical cross-linking
 * @returns Prompt template string
 */
export function buildModuleArticlePromptTemplate(depth: 'shallow' | 'normal' | 'deep', areaId?: string): string {
    const styleGuide = getArticleStyleGuide(depth);
    const crossLinkRules = buildCrossLinkRules(areaId);

    return `You are writing a wiki article for the "{{moduleName}}" module.

## Analysis Data

The following is a detailed analysis of this module:

\`\`\`json
{{analysis}}
\`\`\`

## Module Graph (for cross-linking)

Use this to create cross-references to other modules:

\`\`\`json
{{moduleGraph}}
\`\`\`

## Instructions
${styleGuide}

${crossLinkRules}

## Mermaid Diagrams

If the analysis includes a suggestedDiagram, include it in the article wrapped in:
\`\`\`mermaid
(diagram content)
\`\`\`

## Format

- Use GitHub-Flavored Markdown
- Start with a level-1 heading: # {{moduleName}}
- Use proper heading hierarchy (## for sections, ### for subsections)
- Use fenced code blocks with language tags for code examples
- Use tables for API references where appropriate

Do NOT write, create, or save any files to disk. Return ONLY the markdown content in your response.`;
}
