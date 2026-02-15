/**
 * Theme Article — Prompt Templates
 *
 * Prompt templates for generating theme sub-articles and index pages.
 * Sub-article prompts return raw markdown (not JSON).
 * Index page prompts synthesize all sub-article summaries into an overview.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type {
    ThemeOutline,
    ThemeArticlePlan,
    ThemeArticleAnalysis,
    ThemeCrossCuttingAnalysis,
} from '../types';

// ============================================================================
// Depth Variants (Sub-Article)
// ============================================================================

const SHALLOW_STYLE = `
Write a concise article (500-800 words) covering:
1. Overview paragraph (2-3 sentences)
2. Key concepts with brief explanations
3. One code example if available
4. A "See also" section linking to sibling articles`;

const NORMAL_STYLE = `
Write a comprehensive article (800-1500 words) covering:
1. Overview paragraph summarizing this aspect of the theme
2. Key concepts and abstractions with explanations
3. Data flow and control flow relevant to this aspect
4. 2-3 code examples with fenced code blocks and language tags
5. Internal implementation details
6. A "See also" section linking to sibling articles`;

const DEEP_STYLE = `
Write a thorough, detailed article (1500-3000 words) covering:
1. Overview paragraph with context within the broader theme
2. All key concepts and abstractions, with detailed explanations
3. Complete data flow and control flow analysis
4. 3-5 code examples covering different usage patterns
5. Internal implementation details and design decisions
6. Error handling and edge cases
7. Performance considerations if relevant
8. A "See also" section linking to sibling articles`;

function getSubArticleStyle(depth: 'shallow' | 'normal' | 'deep'): string {
    switch (depth) {
        case 'shallow': return SHALLOW_STYLE;
        case 'deep': return DEEP_STYLE;
        default: return NORMAL_STYLE;
    }
}

// ============================================================================
// Sub-Article Prompt
// ============================================================================

/**
 * Build prompt for a single sub-article.
 *
 * Context includes:
 * - Theme name and overall description
 * - This article's title, description, and covered files
 * - Analysis results (keyConcepts, dataFlow, codeExamples)
 * - Sibling article titles (for "See also" cross-references)
 * - Depth setting influences length and detail
 *
 * Output: raw markdown (not JSON) — heading, prose, code blocks, diagrams
 */
export function buildSubArticlePrompt(
    themeTitle: string,
    article: ThemeArticlePlan,
    analysis: ThemeArticleAnalysis,
    siblingTitles: { slug: string; title: string }[],
    depth: 'shallow' | 'normal' | 'deep'
): string {
    const style = getSubArticleStyle(depth);

    const keyConcepts = analysis.keyConcepts.length > 0
        ? analysis.keyConcepts.map(c =>
            `- **${c.name}**: ${c.description}${c.codeRef ? ` (see \`${c.codeRef}\`)` : ''}`
        ).join('\n')
        : '(no key concepts available)';

    const codeExamples = analysis.codeExamples.length > 0
        ? analysis.codeExamples.map(ex =>
            `### ${ex.title}\nFile: \`${ex.file}\`\n\`\`\`\n${ex.code}\n\`\`\``
        ).join('\n\n')
        : '';

    const coveredFiles = article.coveredFiles.length > 0
        ? article.coveredFiles.join('\n')
        : '(none listed)';

    const siblingLinks = siblingTitles.length > 0
        ? siblingTitles.map(s => `- [${s.title}](./${s.slug}.md)`).join('\n')
        : '(none)';

    return `You are writing a wiki article for the theme area "${themeTitle}".

## Article Details
Title: ${article.title}
Slug: ${article.slug}
Description: ${article.description}

## Covered Files
${coveredFiles}

## Analysis Data

### Key Concepts
${keyConcepts}

### Data Flow
${analysis.dataFlow || '(not described)'}

### Internal Details
${analysis.internalDetails || '(not described)'}
${codeExamples ? `\n### Code Examples from Analysis\n${codeExamples}` : ''}

## Sibling Articles (for cross-references)
${siblingLinks}

## Instructions
${style}

## Format

- Use GitHub-Flavored Markdown
- Start with: # ${article.title}
- Second line: > Part of the [${themeTitle}](./index.md) theme area.
- Use proper heading hierarchy (## for sections, ### for subsections)
- Use fenced code blocks with language tags
- Cross-references to sibling articles use relative links: [Title](./<slug>.md)
- Include Mermaid diagrams in \`\`\`mermaid blocks where helpful

Return ONLY the markdown content. Do NOT write, create, or save any files to disk.`;
}

// ============================================================================
// Index Page Prompt
// ============================================================================

/**
 * Build prompt for the index/overview page (reduce).
 *
 * Context includes:
 * - Theme name and description
 * - Summaries of all sub-articles (first 200 words each)
 * - Cross-cutting analysis (architecture, data flow, diagram)
 * - Links to each sub-article
 *
 * Output: markdown with overview, architecture diagram, ToC, data flow, related modules.
 */
export function buildIndexPagePrompt(
    themeTitle: string,
    outline: ThemeOutline,
    crossCutting: ThemeCrossCuttingAnalysis,
    articleSummaries: { slug: string; title: string; summary: string }[]
): string {
    const articlesSection = articleSummaries.length > 0
        ? articleSummaries.map(a =>
            `### [${a.title}](./${a.slug}.md)\n${a.summary}`
        ).join('\n\n')
        : '(no sub-articles)';

    const moduleList = outline.involvedComponents.length > 0
        ? outline.involvedComponents.map(m =>
            `- **${m.componentId}**: ${m.role}`
        ).join('\n')
        : '(none)';

    const diagram = crossCutting.suggestedDiagram
        ? `\`\`\`mermaid\n${crossCutting.suggestedDiagram}\n\`\`\``
        : '(no diagram available — please generate one)';

    const relatedThemes = crossCutting.relatedThemes && crossCutting.relatedThemes.length > 0
        ? crossCutting.relatedThemes.map(t => `- ${t}`).join('\n')
        : '';

    return `You are writing the index page for the theme area "${themeTitle}".

## Theme Overview
${crossCutting.architecture || `Overview of ${themeTitle}`}

## Architecture & Data Flow
Architecture: ${crossCutting.architecture || '(not described)'}
Data Flow: ${crossCutting.dataFlow || '(not described)'}
${crossCutting.configuration ? `Configuration: ${crossCutting.configuration}` : ''}

## Suggested Diagram
${diagram}

## Sub-Articles
${articlesSection}

## Involved Modules
${moduleList}
${relatedThemes ? `\n## Related Themes\n${relatedThemes}` : ''}

## Instructions

Write the index page for this theme area. Include:

1. **Title & Overview** — Start with \`# ${themeTitle}\` and a paragraph summarizing the theme
2. **Architecture** — Describe how the components fit together, include a Mermaid diagram
3. **Articles** — Table of contents with links to each sub-article and a brief description
4. **Data Flow** — Cross-module data flow summary
5. **Involved Modules** — List of modules with their roles
${relatedThemes ? '6. **Related Themes** — Links to related theme areas' : ''}

## Format

- Use GitHub-Flavored Markdown
- Start with: # ${themeTitle}
- Include a Mermaid architecture diagram in \`\`\`mermaid blocks
- Link to sub-articles: [Article Title](./<slug>.md)
- Use proper heading hierarchy

Return ONLY the markdown content. Do NOT write, create, or save any files to disk.`;
}
