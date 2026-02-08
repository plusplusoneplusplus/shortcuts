/**
 * Reduce Prompt Templates
 *
 * Prompt templates for the reduce phase of Phase 3 (Article Generation).
 * The AI reducer receives module summaries and generates:
 * - index.md: Categorized table of contents with module summaries
 * - architecture.md: High-level architecture with Mermaid diagrams
 * - getting-started.md: Setup, build, and run instructions
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

/**
 * Build the reduce prompt for generating index, architecture, and getting-started pages.
 *
 * Template variables (substituted by the map-reduce framework):
 * - {{RESULTS}}: JSON array of module summaries (not full articles)
 * - {{COUNT}}: Total number of modules
 * - {{SUCCESS_COUNT}}: Successfully analyzed modules
 * - {{FAILURE_COUNT}}: Failed modules
 * - {{projectName}}: Project name
 * - {{projectDescription}}: Project description
 * - {{buildSystem}}: Build system
 * - {{language}}: Primary language
 *
 * @returns Reduce prompt template string
 */
export function buildReducePromptTemplate(): string {
    return `You are generating overview pages for a codebase wiki.

## Project Information

- **Project:** {{projectName}}
- **Description:** {{projectDescription}}
- **Language:** {{language}}
- **Build System:** {{buildSystem}}

## Module Articles

The following {{COUNT}} modules have been analyzed and documented:

{{RESULTS}}

## Task

Generate THREE pages as a single JSON object. Each page should be a complete markdown document.

### 1. index.md

Create a comprehensive index page:
- Project title and description
- Categorized table of contents grouping modules by their category
- Brief (1-2 sentence) summary for each module
- Links to module articles using: [Module Name](./modules/module-id.md)
- Quick start section pointing to getting-started.md

### 2. architecture.md

Create an architecture overview page:
- High-level Mermaid component/flowchart diagram showing module relationships
- Description of the architectural layers/tiers
- Key design decisions and patterns
- Data flow overview across modules
- Module interaction summary

### 3. getting-started.md

Create a getting started guide:
- Prerequisites (language, tools)
- Installation/setup steps
- Build instructions
- How to run the project
- Key entry points and where to start reading the code
- Links to relevant module articles

## Output Format

Return a JSON object with exactly three fields:
\`\`\`json
{
  "index": "full markdown content for index.md",
  "architecture": "full markdown content for architecture.md",
  "gettingStarted": "full markdown content for getting-started.md"
}
\`\`\`

IMPORTANT:
- All links to modules must use the format: [Module Name](./modules/module-id.md)
- Mermaid diagrams should use \`\`\`mermaid code blocks
- Each page should be a complete, standalone markdown document
- Use proper heading hierarchy starting with # for each page

Do NOT write, create, or save any files to disk. Return ONLY the JSON object in your response.`;
}

/**
 * Get the output fields for the reduce phase.
 */
export function getReduceOutputFields(): string[] {
    return ['index', 'architecture', 'gettingStarted'];
}

/**
 * Build a concise module summary for the reduce phase.
 * We don't send full articles to the reducer — just names and overviews.
 */
export function buildModuleSummaryForReduce(
    moduleId: string,
    moduleName: string,
    category: string,
    overview: string
): string {
    return JSON.stringify({
        id: moduleId,
        name: moduleName,
        category,
        overview: overview.substring(0, 500), // Truncate for token efficiency
    });
}
