/**
 * Reduce Prompt Templates
 *
 * Prompt templates for the reduce phase of Phase 4 (Article Generation).
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

Create a comprehensive index page following DeepWiki structure:
- Project title (level-1 heading) and a short overview summary paragraph (2-3 sentences)
- **Table of Contents** with anchor links to every section on the page
- Categorized module listing: group modules by category, each with a brief (1-2 sentence) summary
- Links to module articles using: [Module Name](./modules/module-id.md)
- Quick start section pointing to getting-started.md
- Use proper heading hierarchy (## for categories, ### where needed)

### 2. architecture.md

Create an architecture overview page following DeepWiki structure:
- Title (level-1 heading) and short overview summary
- **Table of Contents** with anchor links to all sections
- System Overview section describing the high-level architecture
- High-level Mermaid component/flowchart diagram showing module relationships
- Architectural Layers section describing tiers and boundaries
- Key Design Decisions section covering patterns and rationale
- Data Flow Overview section explaining cross-module data flow
- Module Interaction Summary section
- **Sources** section at the end listing the module files/paths that informed the architecture

### 3. getting-started.md

Create a getting started guide following DeepWiki structure:
- Title (level-1 heading) and short overview summary
- **Table of Contents** with anchor links to all sections
- Prerequisites section (language, tools, versions)
- Installation / Setup section with step-by-step instructions
- Build Instructions section
- Running the Project section
- Key Entry Points section describing where to start reading code
- Links to relevant module articles
- **Sources** section at the end referencing relevant config/setup files

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
- Every page MUST include a Table of Contents section with anchor links after the overview paragraph
- Keep heading text anchor-friendly (descriptive, consistent casing)
- architecture.md and getting-started.md should end with a ## Sources section

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

Create an area-level index page following DeepWiki structure:
- Area name (level-1 heading) and a short overview summary paragraph (2-3 sentences)
- **Table of Contents** with anchor links to every section on the page
- Module listing with brief (1-2 sentence) summary for each module
- Links to module articles using: [Module Name](./modules/module-id.md)
- Overview of how modules in this area interact

### 2. architecture.md (Area Architecture)

Create an area-level architecture page following DeepWiki structure:
- Title (level-1 heading) and short overview summary
- **Table of Contents** with anchor links to all sections
- Mermaid component diagram showing module relationships within this area
- Description of the area's internal architecture
- Key design decisions specific to this area
- Data flow between modules in this area
- External dependencies (modules from other areas this area depends on)
- **Sources** section at the end listing the key source files in this area

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
- Every page MUST include a Table of Contents section with anchor links after the overview paragraph
- Keep heading text anchor-friendly (descriptive, consistent casing)
- architecture.md should end with a ## Sources section

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

Create a project-level index page following DeepWiki structure:
- Project title (level-1 heading) and a short overview summary paragraph (2-3 sentences)
- **Table of Contents** with anchor links to every section on the page
- Table of areas with brief descriptions and links: [Area Name](./areas/area-id/index.md)
- Quick start section pointing to getting-started.md
- High-level project structure overview

### 2. architecture.md (Project Architecture)

Create a project-level architecture overview following DeepWiki structure:
- Title (level-1 heading) and short overview summary
- **Table of Contents** with anchor links to all sections
- System Overview section describing the high-level architecture
- High-level Mermaid diagram showing area relationships
- Architectural Layers section describing tiers and boundaries
- How areas interact with each other
- Key design decisions and patterns at the project level
- **Sources** section at the end referencing key project-level config/entry files

### 3. getting-started.md (Getting Started)

Create a getting started guide following DeepWiki structure:
- Title (level-1 heading) and short overview summary
- **Table of Contents** with anchor links to all sections
- Prerequisites section (language, tools, versions)
- Installation / Setup section with step-by-step instructions
- Build Instructions section
- Running the Project section
- Key entry points organized by area
- Links to relevant area indexes
- **Sources** section at the end referencing relevant config/setup files

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
- Every page MUST include a Table of Contents section with anchor links after the overview paragraph
- Keep heading text anchor-friendly (descriptive, consistent casing)
- architecture.md and getting-started.md should end with a ## Sources section

Do NOT write, create, or save any files to disk. Return ONLY the JSON object in your response.`;
}
