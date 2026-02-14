/**
 * Topic Analysis — Prompt Templates
 *
 * Prompt templates for per-article and cross-cutting topic analysis.
 * Per-article prompts scope the AI to the article's covered files.
 * Cross-cutting prompts synthesize all article analyses into a holistic view.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

// ============================================================================
// Depth Variants (Per-Article)
// ============================================================================

const SHALLOW_ARTICLE_STEPS = `
Use the grep, glob, and view tools to investigate the files listed above:

1. Read the main entry files and understand the key abstractions
2. Identify how this aspect relates to the overall topic

Return a JSON object matching the schema below. For shallow analysis, keep
keyConcepts to 2-3 entries and codeExamples to 1 example maximum.`;

const NORMAL_ARTICLE_STEPS = `
Use the grep, glob, and view tools to deeply investigate the files listed above:

1. Read all listed files and understand the public API and key abstractions
2. Trace the main control flow and data flow within this aspect
3. Identify how this aspect connects to other parts of the topic
4. Extract 2-3 illustrative code examples
5. Summarize internal implementation details

Return a JSON object matching the schema below.`;

const DEEP_ARTICLE_STEPS = `
Use the grep, glob, and view tools to exhaustively investigate the files listed above:

1. Read ALL listed files, not just entry points
2. Map the complete public API with type signatures
3. Trace every control flow path and data flow within this aspect
4. Identify ALL design patterns and coding conventions
5. Extract 3-5 illustrative code examples covering different aspects
6. Analyze error handling and edge cases
7. Document internal implementation details comprehensively

Return a JSON object matching the schema below. Be thorough and comprehensive.`;

// ============================================================================
// Per-Article Prompt
// ============================================================================

function getArticleInvestigationSteps(depth: 'shallow' | 'normal' | 'deep'): string {
    switch (depth) {
        case 'shallow': return SHALLOW_ARTICLE_STEPS;
        case 'deep': return DEEP_ARTICLE_STEPS;
        default: return NORMAL_ARTICLE_STEPS;
    }
}

const ARTICLE_ANALYSIS_SCHEMA = `{
  "slug": "string — the article slug (MUST match the slug provided)",
  "keyConcepts": [
    { "name": "string", "description": "string", "codeRef": "string (optional, file path)" }
  ],
  "dataFlow": "string — how data moves within this aspect of the topic",
  "codeExamples": [
    { "title": "string", "code": "string — actual code snippet", "file": "string — source file path" }
  ],
  "internalDetails": "string — internal implementation details and design decisions"
}`;

/**
 * Build a prompt for analyzing a single article's scope.
 */
export function buildArticleAnalysisPrompt(
    topicTitle: string,
    articleTitle: string,
    articleDescription: string,
    articleSlug: string,
    coveredFiles: string[],
    moduleContext: string,
    depth: 'shallow' | 'normal' | 'deep'
): string {
    const steps = getArticleInvestigationSteps(depth);
    const fileList = coveredFiles.length > 0
        ? coveredFiles.join('\n')
        : '(no specific files listed — explore the repository)';

    return `You are analyzing a specific aspect of the topic "${topicTitle}".

Article: ${articleTitle}
Article slug: ${articleSlug}
Description: ${articleDescription}

Files to examine:
${fileList}
${moduleContext ? `\nModule context:\n${moduleContext}\n` : ''}
${steps}

**Output JSON Schema:**
\`\`\`json
${ARTICLE_ANALYSIS_SCHEMA}
\`\`\`

IMPORTANT:
- The "slug" field MUST be exactly "${articleSlug}"
- All file paths should be relative to the repository root
- Focus your analysis on the specific aspect described above, not the entire codebase
- Return ONLY the JSON object, no additional text before or after`;
}

// ============================================================================
// Cross-Cutting Prompt
// ============================================================================

const CROSS_CUTTING_SCHEMA = `{
  "architecture": "string — how the modules collaborate to implement this topic",
  "dataFlow": "string — end-to-end data flow across all aspects",
  "suggestedDiagram": "string — Mermaid diagram showing component interactions",
  "configuration": "string (optional) — configuration knobs and tuning options",
  "relatedTopics": ["string (optional) — IDs of related topics"]
}`;

/**
 * Build a prompt for cross-cutting analysis across all articles.
 */
export function buildCrossCuttingPrompt(
    topicTitle: string,
    topicId: string,
    articleSummaries: string,
    moduleIds: string[]
): string {
    return `You are synthesizing a cross-cutting analysis for the topic "${topicTitle}".

Topic ID: ${topicId}
Involved modules: ${moduleIds.join(', ')}

The following per-article analyses have been completed:

${articleSummaries}

Based on these analyses, produce a cross-cutting synthesis that covers:
1. **Architecture**: How do these modules collaborate to implement this feature/topic?
2. **Data Flow**: What is the end-to-end data flow across all aspects?
3. **Diagram**: Create a Mermaid diagram showing how the components interact
4. **Configuration**: What configuration knobs or tuning options exist? (if applicable)
5. **Related Topics**: What other topics are closely related?

Return a JSON object matching the schema below.

**Output JSON Schema:**
\`\`\`json
${CROSS_CUTTING_SCHEMA}
\`\`\`

IMPORTANT:
- The "suggestedDiagram" field should contain valid Mermaid syntax (graph, flowchart, or sequence diagram)
- Focus on how the aspects work TOGETHER, not individual module details
- Return ONLY the JSON object, no additional text before or after`;
}
