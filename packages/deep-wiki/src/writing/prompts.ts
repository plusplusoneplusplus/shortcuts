/**
 * Article Writing Prompt Templates
 *
 * Prompt templates for Phase 4 (Article Generation). Each component's analysis
 * is converted into a markdown article. Templates include cross-link
 * information and Mermaid diagram integration.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ComponentAnalysis, ComponentGraph, ComponentInfo, DomainInfo } from '../types';

// ============================================================================
// Simplified Graph for Cross-Linking
// ============================================================================

/**
 * Build a simplified component graph for cross-link reference.
 * Contains only names, IDs, and paths — not full analysis data.
 */
export function buildSimplifiedGraph(graph: ComponentGraph): string {
    const simplified = graph.components.map(m => ({
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

1. **Title & Overview** — Start with a level-1 heading and a short overview paragraph summarizing the component's purpose and role in the project.
2. **Table of Contents** — Include a bullet list of anchor links to every major section (e.g., \`- [Public API](#public-api)\`).
3. **Purpose & Scope** — Brief description of what this component does and where it fits.
4. **Public API** — Table format with function/class names, signatures, and descriptions.
5. **Usage Example** — A basic code example showing how to use this component.
6. **Dependencies** — List key internal and external dependencies.
7. **Sources & References** — A "Sources" section at the end listing the source files examined (from the analysis data's sourceFiles field), formatted as a bullet list of repo-relative file paths.`;

const NORMAL_STYLE = `
Write a comprehensive article (800-1500 words) following this exact section structure:

1. **Title & Overview** — Start with a level-1 heading and a short overview paragraph summarizing the component's purpose and role in the project.
2. **Table of Contents** — Include a bullet list of anchor links to every major section (e.g., \`- [Architecture](#architecture)\`).
3. **Purpose & Scope** — What this component does, why it exists, and its responsibilities.
4. **Architecture** — Internal design, component structure, and design patterns used. Include a Mermaid diagram if the analysis suggests one.
5. **Public API Reference** — Table with function/class names, signatures, and descriptions.
6. **Data Flow** — How data moves through this component, with clear explanation of inputs and outputs.
7. **Usage Examples** — Code examples with fenced code blocks and language tags.
8. **Dependencies** — Internal component dependencies and external package dependencies with usage context.
9. **Sources & References** — A "Sources" section at the end listing ALL source files examined (from the analysis data's sourceFiles field), formatted as a bullet list of repo-relative file paths.`;

const DEEP_STYLE = `
Write a thorough, detailed article (1500-3000 words) following this exact section structure:

1. **Title & Overview** — Start with a level-1 heading and a short overview paragraph summarizing the component's purpose, role, and significance in the project.
2. **Table of Contents** — Include a bullet list of anchor links to every major section and subsection (e.g., \`- [Architecture](#architecture)\`, \`  - [Design Patterns](#design-patterns)\`).
3. **Purpose & Scope** — What this component does, why it exists, its responsibilities, and its context within the broader system.
4. **Architecture** — Detailed internal design walkthrough with:
   - Component structure and relationships
   - Design patterns identified (### Design Patterns subsection)
   - Mermaid diagrams (architecture + data flow if possible)
5. **Public API Reference** — Complete API reference with full type signatures, parameter descriptions, return values, and usage notes. Use tables.
6. **Data Flow & Control Flow** — In-depth explanation of how data and control move through this component, including edge cases.
7. **Error Handling** — Error handling patterns, recovery strategies, and error propagation.
8. **Performance Considerations** — Performance characteristics, potential bottlenecks, and optimization notes.
9. **Usage Examples** — Multiple code examples covering different aspects, with fenced code blocks, language tags, and file path references.
10. **Dependencies** — Detailed analysis of internal component dependencies and external packages, including how each is used.
11. **Related Components** — Cross-references to related components with brief descriptions of relationships.
12. **Sources & References** — A "Sources" section at the end listing ALL source files examined (from the analysis data's sourceFiles field), formatted as a bullet list of repo-relative file paths.`;

// ============================================================================
// Component Article Prompt
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
 * Build the prompt for generating a single component article.
 *
 * @param analysis The component's analysis data
 * @param graph The full component graph (for cross-linking)
 * @param depth Article depth
 * @returns Complete prompt string
 */
export function buildComponentArticlePrompt(
    analysis: ComponentAnalysis,
    graph: ComponentGraph,
    depth: 'shallow' | 'normal' | 'deep'
): string {
    const simplifiedGraph = buildSimplifiedGraph(graph);
    const styleGuide = getArticleStyleGuide(depth);

    // Find component info for additional context
    const componentInfo = graph.components.find(m => m.id === analysis.componentId);
    const componentName = componentInfo?.name || analysis.componentId;
    const domainId = componentInfo?.domain;
    const crossLinkRules = buildCrossLinkRules(domainId);

    return `You are writing a wiki article for the "${componentName}" component.

## Analysis Data

The following is a detailed analysis of this component:

\`\`\`json
${JSON.stringify(analysis, null, 2)}
\`\`\`

## Component Graph (for cross-linking)

Use this to create cross-references to other components:

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
- Start with a level-1 heading: # ${componentName}
- Follow with a short overview summary paragraph (2-3 sentences)
- Include a **Table of Contents** section with anchor links to all major sections
- Use proper heading hierarchy (## for sections, ### for subsections) — keep headers anchor-friendly (lowercase, hyphenated)
- Use fenced code blocks with language tags for code examples
- Use tables for API references where appropriate
- Include file path references (e.g., \`src/component/file.ts:42\`) when citing code
- Include Mermaid diagrams wrapped in \`\`\`mermaid blocks where analysis suggests them
- End with a ## Sources section listing source file paths as a bullet list

Do NOT write, create, or save any files to disk. Return ONLY the markdown content in your response.`;
}

/**
 * Build cross-linking rules based on whether domains exist (hierarchical layout).
 *
 * @param domainId - The area this component belongs to (undefined for flat layout)
 * @returns Cross-linking rules string for prompt
 */
export function buildCrossLinkRules(domainId?: string): string {
    if (!domainId) {
        // Flat layout (small repos)
        return `## Cross-Linking Rules

- Link to other components using relative paths: [Component Name](./components/component-id.md)
- For the index page, link as: [Component Name](./components/component-id.md)
- Use the component graph above to find valid component IDs for links
- Only link to components that actually exist in the graph`;
    }

    // Hierarchical layout (large repos with domains)
    return `## Cross-Linking Rules

- This article is located at: domains/${domainId}/components/<this-component>.md
- Link to components in the SAME domain: [Component Name](./component-id.md) (they are sibling files)
- Link to components in OTHER domains: [Component Name](../../other-domain-id/components/component-id.md)
- Link to this domain's index: [Domain Index](../index.md)
- Link to the project index: [Project Index](../../../index.md)
- Use the component graph above to find valid component IDs and their domains for links
- Only link to components that actually exist in the graph`;
}

/**
 * Build the prompt template for the map-reduce framework.
 * Uses {{variable}} placeholders for template substitution.
 *
 * @param depth Article depth
 * @param domainId Optional domain ID for hierarchical cross-linking
 * @returns Prompt template string
 */
export function buildComponentArticlePromptTemplate(depth: 'shallow' | 'normal' | 'deep', domainId?: string): string {
    const styleGuide = getArticleStyleGuide(depth);
    const crossLinkRules = buildCrossLinkRules(domainId);

    return `You are writing a wiki article for the "{{componentName}}" component.

## Analysis Data

The following is a detailed analysis of this component:

\`\`\`json
{{analysis}}
\`\`\`

## Component Graph (for cross-linking)

Use this to create cross-references to other components:

\`\`\`json
{{componentGraph}}
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
- Start with a level-1 heading: # {{componentName}}
- Follow with a short overview summary paragraph (2-3 sentences)
- Include a **Table of Contents** section with anchor links to all major sections
- Use proper heading hierarchy (## for sections, ### for subsections) — keep headers anchor-friendly (lowercase, hyphenated)
- Use fenced code blocks with language tags for code examples
- Use tables for API references where appropriate
- Include file path references (e.g., \`src/component/file.ts:42\`) when citing code
- Include Mermaid diagrams wrapped in \`\`\`mermaid blocks where analysis suggests them
- End with a ## Sources section listing source file paths as a bullet list

Do NOT write, create, or save any files to disk. Return ONLY the markdown content in your response.`;
}
