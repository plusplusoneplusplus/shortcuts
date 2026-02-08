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

// ============================================================================
// Area-Level Reduce Prompt (Hierarchical — Large Repos Only)
// ============================================================================

/**
 * Build the reduce prompt for generating area-level index and architecture pages.
 * Used in the 2-tier reduce for large repos: per-area reduce first, then project-level.
 *
 * Template variables:
 * - {{RESULTS}}: JSON array of module summaries for this area only
 * - {{COUNT}}: Number of modules in this area
 * - {{SUCCESS_COUNT}}: Successfully analyzed modules
 * - {{FAILURE_COUNT}}: Failed modules
 * - {{areaName}}: Area name
 * - {{areaDescription}}: Area description
 * - {{areaPath}}: Area path
 * - {{projectName}}: Project name
 *
 * @returns Reduce prompt template string
 */
export function buildAreaReducePromptTemplate(): string {
    return `You are generating overview pages for the "{{areaName}}" area of a codebase wiki.

## Area Information

- **Area:** {{areaName}}
- **Path:** {{areaPath}}
- **Description:** {{areaDescription}}
- **Project:** {{projectName}}

## Module Articles

The following {{COUNT}} modules in this area have been analyzed and documented:

{{RESULTS}}

## Task

Generate TWO pages as a single JSON object. Each page should be a complete markdown document.

### 1. index.md (Area Index)

Create an area-level index page:
- Area name and description
- Table of contents listing all modules in this area
- Brief (1-2 sentence) summary for each module
- Links to module articles using: [Module Name](./modules/module-id.md)
- Overview of how modules in this area interact

### 2. architecture.md (Area Architecture)

Create an area-level architecture page:
- Mermaid component diagram showing module relationships within this area
- Description of the area's internal architecture
- Key design decisions specific to this area
- Data flow between modules in this area
- External dependencies (modules from other areas this area depends on)

## Output Format

Return a JSON object with exactly two fields:
\`\`\`json
{
  "index": "full markdown content for index.md",
  "architecture": "full markdown content for architecture.md"
}
\`\`\`

IMPORTANT:
- All links to modules WITHIN this area must use: [Module Name](./modules/module-id.md)
- Links to modules in OTHER areas must use: [Module Name](../../other-area-id/modules/module-id.md)
- Mermaid diagrams should use \`\`\`mermaid code blocks
- Each page should be a complete, standalone markdown document
- Use proper heading hierarchy starting with # for each page

Do NOT write, create, or save any files to disk. Return ONLY the JSON object in your response.`;
}

/**
 * Get the output fields for the area-level reduce phase.
 */
export function getAreaReduceOutputFields(): string[] {
    return ['index', 'architecture'];
}

// ============================================================================
// Project-Level Reduce Prompt (Hierarchical — Large Repos Only)
// ============================================================================

/**
 * Build the project-level reduce prompt for large repos with area hierarchy.
 * Receives area summaries instead of raw module summaries.
 *
 * Template variables:
 * - {{RESULTS}}: JSON array of area summaries
 * - {{COUNT}}: Number of areas
 * - {{SUCCESS_COUNT}}: Successfully processed areas
 * - {{FAILURE_COUNT}}: Failed areas
 * - {{projectName}}: Project name
 * - {{projectDescription}}: Project description
 * - {{buildSystem}}: Build system
 * - {{language}}: Primary language
 *
 * @returns Reduce prompt template string
 */
export function buildHierarchicalReducePromptTemplate(): string {
    return `You are generating project-level overview pages for a large codebase wiki.
This project uses a hierarchical structure organized by areas.

## Project Information

- **Project:** {{projectName}}
- **Description:** {{projectDescription}}
- **Language:** {{language}}
- **Build System:** {{buildSystem}}

## Areas

The project is organized into {{COUNT}} top-level areas:

{{RESULTS}}

## Task

Generate THREE pages as a single JSON object. Each page should be a complete markdown document.

### 1. index.md (Project Index)

Create a project-level index page:
- Project title and description
- Table of areas with brief descriptions
- Links to each area's index: [Area Name](./areas/area-id/index.md)
- Quick start section pointing to getting-started.md
- High-level project structure overview

### 2. architecture.md (Project Architecture)

Create a project-level architecture overview:
- High-level Mermaid diagram showing area relationships
- Description of the architectural layers/tiers
- How areas interact with each other
- Key design decisions and patterns at the project level

### 3. getting-started.md (Getting Started)

Create a getting started guide:
- Prerequisites (language, tools)
- Installation/setup steps
- Build instructions
- How to run the project
- Key entry points organized by area
- Links to relevant area indexes

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
- Links to areas must use: [Area Name](./areas/area-id/index.md)
- Links to area architecture: [Area Architecture](./areas/area-id/architecture.md)
- Links to specific modules: [Module Name](./areas/area-id/modules/module-id.md)
- Mermaid diagrams should use \`\`\`mermaid code blocks
- Each page should be a complete, standalone markdown document
- Use proper heading hierarchy starting with # for each page

Do NOT write, create, or save any files to disk. Return ONLY the JSON object in your response.`;
}
