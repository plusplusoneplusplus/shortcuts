/**
 * Article Writing Prompt Templates
 *
 * Prompt templates for Phase 4 (Article Generation). Each module's analysis
 * is converted into a markdown article. Templates include cross-link
 * information and Mermaid diagram integration.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ModuleAnalysis, ModuleGraph, ModuleInfo, DomainInfo } from '../types';

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
Write a concise article (500-800 words) following this exact section structure:

1. **Title & Overview** — Start with a level-1 heading and a short overview paragraph summarizing the module's purpose and role in the project.
2. **Table of Contents** — Include a bullet list of anchor links to every major section (e.g., \`- [Public API](#public-api)\`).
3. **Purpose & Scope** — Brief description of what this module does and where it fits.
4. **Public API** — Table format with function/class names, signatures, and descriptions.
5. **Usage Example** — A basic code example showing how to use this module.
6. **Dependencies** — List key internal and external dependencies.
7. **Sources & References** — A "Sources" section at the end listing the source files examined (from the analysis data's sourceFiles field), formatted as a bullet list of repo-relative file paths.`;

const NORMAL_STYLE = `
Write a comprehensive article (800-1500 words) following this exact section structure:

1. **Title & Overview** — Start with a level-1 heading and a short overview paragraph summarizing the module's purpose and role in the project.
2. **Table of Contents** — Include a bullet list of anchor links to every major section (e.g., \`- [Architecture](#architecture)\`).
3. **Purpose & Scope** — What this module does, why it exists, and its responsibilities.
4. **Architecture** — Internal design, component structure, and design patterns used. Include a Mermaid diagram if the analysis suggests one.
5. **Public API Reference** — Table with function/class names, signatures, and descriptions.
6. **Data Flow** — How data moves through this module, with clear explanation of inputs and outputs.
7. **Usage Examples** — Code examples with fenced code blocks and language tags.
8. **Dependencies** — Internal module dependencies and external package dependencies with usage context.
9. **Sources & References** — A "Sources" section at the end listing ALL source files examined (from the analysis data's sourceFiles field), formatted as a bullet list of repo-relative file paths.`;

const DEEP_STYLE = `
Write a thorough, detailed article (1500-3000 words) following this exact section structure:

1. **Title & Overview** — Start with a level-1 heading and a short overview paragraph summarizing the module's purpose, role, and significance in the project.
2. **Table of Contents** — Include a bullet list of anchor links to every major section and subsection (e.g., \`- [Architecture](#architecture)\`, \`  - [Design Patterns](#design-patterns)\`).
3. **Purpose & Scope** — What this module does, why it exists, its responsibilities, and its context within the broader system.
4. **Architecture** — Detailed internal design walkthrough with:
   - Component structure and relationships
   - Design patterns identified (### Design Patterns subsection)
   - Mermaid diagrams (architecture + data flow if possible)
5. **Public API Reference** — Complete API reference with full type signatures, parameter descriptions, return values, and usage notes. Use tables.
6. **Data Flow & Control Flow** — In-depth explanation of how data and control move through this module, including edge cases.
7. **Error Handling** — Error handling patterns, recovery strategies, and error propagation.
8. **Performance Considerations** — Performance characteristics, potential bottlenecks, and optimization notes.
9. **Usage Examples** — Multiple code examples covering different aspects, with fenced code blocks, language tags, and file path references.
10. **Dependencies** — Detailed analysis of internal module dependencies and external packages, including how each is used.
11. **Related Modules** — Cross-references to related modules with brief descriptions of relationships.
12. **Sources & References** — A "Sources" section at the end listing ALL source files examined (from the analysis data's sourceFiles field), formatted as a bullet list of repo-relative file paths.`;

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
    const domainId = moduleInfo?.domain;
    const crossLinkRules = buildCrossLinkRules(domainId);

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
- Follow with a short overview summary paragraph (2-3 sentences)
- Include a **Table of Contents** section with anchor links to all major sections
- Use proper heading hierarchy (## for sections, ### for subsections) — keep headers anchor-friendly (lowercase, hyphenated)
- Use fenced code blocks with language tags for code examples
- Use tables for API references where appropriate
- Include file path references (e.g., \`src/module/file.ts:42\`) when citing code
- Include Mermaid diagrams wrapped in \`\`\`mermaid blocks where analysis suggests them
- End with a ## Sources section listing source file paths as a bullet list

Do NOT write, create, or save any files to disk. Return ONLY the markdown content in your response.`;
}

/**
 * Build cross-linking rules based on whether domains exist (hierarchical layout).
 *
 * @param domainId - The area this module belongs to (undefined for flat layout)
 * @returns Cross-linking rules string for prompt
 */
export function buildCrossLinkRules(domainId?: string): string {
    if (!domainId) {
        // Flat layout (small repos)
        return `## Cross-Linking Rules

- Link to other modules using relative paths: [Module Name](./modules/module-id.md)
- For the index page, link as: [Module Name](./modules/module-id.md)
- Use the module graph above to find valid module IDs for links
- Only link to modules that actually exist in the graph`;
    }

    // Hierarchical layout (large repos with domains)
    return `## Cross-Linking Rules

- This article is located at: domains/${domainId}/modules/<this-module>.md
- Link to modules in the SAME domain: [Module Name](./module-id.md) (they are sibling files)
- Link to modules in OTHER domains: [Module Name](../../other-domain-id/modules/module-id.md)
- Link to this domain's index: [Domain Index](../index.md)
- Link to the project index: [Project Index](../../../index.md)
- Use the module graph above to find valid module IDs and their domains for links
- Only link to modules that actually exist in the graph`;
}

/**
 * Build the prompt template for the map-reduce framework.
 * Uses {{variable}} placeholders for template substitution.
 *
 * @param depth Article depth
 * @param domainId Optional domain ID for hierarchical cross-linking
 * @returns Prompt template string
 */
export function buildModuleArticlePromptTemplate(depth: 'shallow' | 'normal' | 'deep', domainId?: string): string {
    const styleGuide = getArticleStyleGuide(depth);
    const crossLinkRules = buildCrossLinkRules(domainId);

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
- Follow with a short overview summary paragraph (2-3 sentences)
- Include a **Table of Contents** section with anchor links to all major sections
- Use proper heading hierarchy (## for sections, ### for subsections) — keep headers anchor-friendly (lowercase, hyphenated)
- Use fenced code blocks with language tags for code examples
- Use tables for API references where appropriate
- Include file path references (e.g., \`src/module/file.ts:42\`) when citing code
- Include Mermaid diagrams wrapped in \`\`\`mermaid blocks where analysis suggests them
- End with a ## Sources section listing source file paths as a bullet list

Do NOT write, create, or save any files to disk. Return ONLY the markdown content in your response.`;
}
