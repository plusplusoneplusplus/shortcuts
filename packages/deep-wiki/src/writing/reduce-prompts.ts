/**
 * Reduce Prompt Templates
 *
 * Prompt templates for the reduce phase of Phase 4 (Article Generation).
 * The AI reducer receives component summaries and generates:
 * - index.md: Categorized table of contents with component summaries
 * - architecture.md: High-level architecture with Mermaid diagrams
 * - getting-started.md: Setup, build, and run instructions
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

/**
 * Build the reduce prompt for generating index, architecture, and getting-started pages.
 *
 * Template variables (substituted by the map-reduce framework):
 * - {{RESULTS}}: JSON array of component summaries (not full articles)
 * - {{COUNT}}: Total number of components
 * - {{SUCCESS_COUNT}}: Successfully analyzed components
 * - {{FAILURE_COUNT}}: Failed components
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

## Component Articles

The following {{COUNT}} components have been analyzed and documented:

{{RESULTS}}

## Task

Generate THREE pages as a single JSON object. Each page should be a complete markdown document.

### 1. index.md

Create a comprehensive index page following DeepWiki structure:
- Project title (level-1 heading) and a short overview summary paragraph (2-3 sentences)
- **Table of Contents** with anchor links to every section on the page
- Categorized component listing: group components by category, each with a brief (1-2 sentence) summary
- Links to component articles using: [Component Name](./components/component-id.md)
- Quick start section pointing to getting-started.md
- Use proper heading hierarchy (## for categories, ### where needed)

### 2. architecture.md

Create an architecture overview page following DeepWiki structure:
- Title (level-1 heading) and short overview summary
- **Table of Contents** with anchor links to all sections
- System Overview section describing the high-level architecture
- High-level Mermaid component/flowchart diagram showing component relationships
- Architectural Layers section describing tiers and boundaries
- Key Design Decisions section covering patterns and rationale
- Data Flow Overview section explaining cross-component data flow
- Component Interaction Summary section
- **Sources** section at the end listing the component files/paths that informed the architecture

### 3. getting-started.md

Create a getting started guide following DeepWiki structure:
- Title (level-1 heading) and short overview summary
- **Table of Contents** with anchor links to all sections
- Prerequisites section (language, tools, versions)
- Installation / Setup section with step-by-step instructions
- Build Instructions section
- Running the Project section
- Key Entry Points section describing where to start reading code
- Links to relevant component articles
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
- All links to components must use the format: [Component Name](./components/component-id.md)
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
 * Build a concise component summary for the reduce phase.
 * We don't send full articles to the reducer — just names and overviews.
 */
export function buildComponentSummaryForReduce(
    componentId: string,
    componentName: string,
    category: string,
    overview: string
): string {
    return JSON.stringify({
        id: componentId,
        name: componentName,
        category,
        overview: overview.substring(0, 500), // Truncate for token efficiency
    });
}

// ============================================================================
// Domain-Level Reduce Prompt (Hierarchical — Large Repos Only)
// ============================================================================

/**
 * Build the reduce prompt for generating domain-level index and architecture pages.
 * Used in the 2-tier reduce for large repos: per-domain reduce first, then project-level.
 *
 * Template variables:
 * - {{RESULTS}}: JSON array of component summaries for this domain only
 * - {{COUNT}}: Number of components in this domain
 * - {{SUCCESS_COUNT}}: Successfully analyzed components
 * - {{FAILURE_COUNT}}: Failed components
 * - {{domainName}}: Domain name
 * - {{domainDescription}}: Domain description
 * - {{domainPath}}: Domain path
 * - {{projectName}}: Project name
 *
 * @returns Reduce prompt template string
 */
export function buildDomainReducePromptTemplate(): string {
    return `You are generating overview pages for the "{{domainName}}" domain of a codebase wiki.

## Domain Information

- **Domain:** {{domainName}}
- **Path:** {{domainPath}}
- **Description:** {{domainDescription}}
- **Project:** {{projectName}}

## Component Articles

The following {{COUNT}} components in this domain have been analyzed and documented:

{{RESULTS}}

## Task

Generate TWO pages as a single JSON object. Each page should be a complete markdown document.

### 1. index.md (Domain Index)

Create an domain-level index page following DeepWiki structure:
- Domain name (level-1 heading) and a short overview summary paragraph (2-3 sentences)
- **Table of Contents** with anchor links to every section on the page
- Component listing with brief (1-2 sentence) summary for each component
- Links to component articles using: [Component Name](./components/component-id.md)
- Overview of how components in this domain interact

### 2. architecture.md (Domain Architecture)

Create an domain-level architecture page following DeepWiki structure:
- Title (level-1 heading) and short overview summary
- **Table of Contents** with anchor links to all sections
- Mermaid component diagram showing component relationships within this domain
- Description of the domain's internal architecture
- Key design decisions specific to this domain
- Data flow between components in this domain
- External dependencies (components from other domains this domain depends on)
- **Sources** section at the end listing the key source files in this domain

## Output Format

Return a JSON object with exactly two fields:
\`\`\`json
{
  "index": "full markdown content for index.md",
  "architecture": "full markdown content for architecture.md"
}
\`\`\`

IMPORTANT:
- All links to components WITHIN this domain must use: [Component Name](./components/component-id.md)
- Links to components in OTHER domains must use: [Component Name](../../other-domain-id/components/component-id.md)
- Mermaid diagrams should use \`\`\`mermaid code blocks
- Each page should be a complete, standalone markdown document
- Use proper heading hierarchy starting with # for each page
- Every page MUST include a Table of Contents section with anchor links after the overview paragraph
- Keep heading text anchor-friendly (descriptive, consistent casing)
- architecture.md should end with a ## Sources section

Do NOT write, create, or save any files to disk. Return ONLY the JSON object in your response.`;
}

/**
 * Get the output fields for the domain-level reduce phase.
 */
export function getDomainReduceOutputFields(): string[] {
    return ['index', 'architecture'];
}

// ============================================================================
// Project-Level Reduce Prompt (Hierarchical — Large Repos Only)
// ============================================================================

/**
 * Build the project-level reduce prompt for large repos with domain hierarchy.
 * Receives domain summaries instead of raw component summaries.
 *
 * Template variables:
 * - {{RESULTS}}: JSON array of domain summaries
 * - {{COUNT}}: Number of domains
 * - {{SUCCESS_COUNT}}: Successfully processed domains
 * - {{FAILURE_COUNT}}: Failed domains
 * - {{projectName}}: Project name
 * - {{projectDescription}}: Project description
 * - {{buildSystem}}: Build system
 * - {{language}}: Primary language
 *
 * @returns Reduce prompt template string
 */
export function buildHierarchicalReducePromptTemplate(): string {
    return `You are generating project-level overview pages for a large codebase wiki.
This project uses a hierarchical structure organized by domains.

## Project Information

- **Project:** {{projectName}}
- **Description:** {{projectDescription}}
- **Language:** {{language}}
- **Build System:** {{buildSystem}}

## Domains

The project is organized into {{COUNT}} top-level domains:

{{RESULTS}}

## Task

Generate THREE pages as a single JSON object. Each page should be a complete markdown document.

### 1. index.md (Project Index)

Create a project-level index page following DeepWiki structure:
- Project title (level-1 heading) and a short overview summary paragraph (2-3 sentences)
- **Table of Contents** with anchor links to every section on the page
- Table of domains with brief descriptions and links: [Domain Name](./domains/domain-id/index.md)
- Quick start section pointing to getting-started.md
- High-level project structure overview

### 2. architecture.md (Project Architecture)

Create a project-level architecture overview following DeepWiki structure:
- Title (level-1 heading) and short overview summary
- **Table of Contents** with anchor links to all sections
- System Overview section describing the high-level architecture
- High-level Mermaid diagram showing domain relationships
- Architectural Layers section describing tiers and boundaries
- How domains interact with each other
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
- Key entry points organized by domain
- Links to relevant domain indexes
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
- Links to domains must use: [Domain Name](./domains/domain-id/index.md)
- Links to area architecture: [Domain Architecture](./domains/domain-id/architecture.md)
- Links to specific components: [Component Name](./domains/domain-id/components/component-id.md)
- Mermaid diagrams should use \`\`\`mermaid code blocks
- Each page should be a complete, standalone markdown document
- Use proper heading hierarchy starting with # for each page
- Every page MUST include a Table of Contents section with anchor links after the overview paragraph
- Keep heading text anchor-friendly (descriptive, consistent casing)
- architecture.md and getting-started.md should end with a ## Sources section

Do NOT write, create, or save any files to disk. Return ONLY the JSON object in your response.`;
}
