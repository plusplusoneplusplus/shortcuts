/**
 * JSON schema strings embedded in prompts so the AI returns structured output.
 */

// ============================================================================
// Component Graph Schema (Phase 1 output)
// ============================================================================

/**
 * Used in the discovery prompt.
 */
export const COMPONENT_GRAPH_SCHEMA = `{
  "project": {
    "name": "string — project name from config files",
    "description": "string — brief description from README or config",
    "language": "string — primary programming language",
    "buildSystem": "string — build system (e.g., npm + webpack, cargo, go modules)",
    "entryPoints": ["string — entry point file paths relative to repo root"]
  },
  "components": [
    {
      "id": "string — unique kebab-case identifier describing the FEATURE (e.g., 'auth-engine', 'pipeline-executor'), NOT the file/directory path (avoid 'src-auth', 'packages-core-src')",
      "name": "string — human-readable name describing what this module DOES for users/system (e.g., 'Authentication Engine', 'Pipeline Executor'), NOT the file name",
      "path": "string — path relative to repo root (e.g., src/auth/)",
      "purpose": "string — what this module does for users or the system (feature-focused, not 'contains files in src/auth')",
      "keyFiles": ["string — key file paths relative to repo root"],
      "dependencies": ["string — IDs of components this depends on"],
      "dependents": ["string — IDs of components that depend on this"],
      "complexity": "low | medium | high",
      "category": "string — must match one of the declared categories"
    }
  ],
  "categories": [
    {
      "name": "string — category identifier",
      "description": "string — short description"
    }
  ],
  "architectureNotes": "string — free-text summary of the overall architecture"
}`;

// ============================================================================
// Structural Scan Schema (Large repo first pass)
// ============================================================================

/**
 * Structural scan output (large repo first pass).
 */
export const STRUCTURAL_SCAN_SCHEMA = `{
  "fileCount": "number — estimated total number of files",
  "domains": [
    {
      "name": "string — descriptive domain name focusing on FUNCTIONALITY (e.g., 'AI Pipeline Engine' not just 'packages/core')",
      "path": "string — path relative to repo root",
      "description": "string — what this domain DOES, not just what directory it is"
    }
  ],
  "projectInfo": {
    "name": "string — project name if found",
    "description": "string — project description if found",
    "language": "string — primary language if determinable",
    "buildSystem": "string — build system if determinable"
  }
}`;

// ============================================================================
// Component Analysis Schema (Phase 3 output)
// ============================================================================

/**
 * Used in analysis prompts.
 */
export const COMPONENT_ANALYSIS_SCHEMA = `{
  "componentId": "string — must match the component ID provided",
  "overview": "string — high-level overview paragraph",
  "keyConcepts": [
    {
      "name": "string — concept name",
      "description": "string — what this concept represents",
      "codeRef": "string (optional) — file path or file:line reference"
    }
  ],
  "publicAPI": [
    {
      "name": "string — function/class/constant name",
      "signature": "string — type signature or declaration",
      "description": "string — what it does"
    }
  ],
  "internalArchitecture": "string — description of internal structure and design",
  "dataFlow": "string — how data moves through this module",
  "patterns": ["string — design patterns identified (e.g., Factory, Observer, Middleware)"],
  "errorHandling": "string — error handling strategy description",
  "codeExamples": [
    {
      "title": "string — short title",
      "code": "string — the code snippet",
      "file": "string (optional) — file path relative to repo root",
      "lines": [0, 0]
    }
  ],
  "dependencies": {
    "internal": [
      {
        "component": "string — component ID",
        "usage": "string — how this component uses it"
      }
    ],
    "external": [
      {
        "package": "string — package name",
        "usage": "string — how this component uses it"
      }
    ]
  },
  "suggestedDiagram": "string — Mermaid diagram code (e.g., graph TD; A-->B)",
  "sourceFiles": ["string — all file paths examined during analysis, relative to repo root"]
}`;

/**
 * Reduce output — Phase 4 index/architecture generation.
 */
export const REDUCE_OUTPUT_SCHEMA = `{
  "index": "string — full markdown content for index.md (categorized TOC, project overview, module summaries)",
  "architecture": "string — full markdown content for architecture.md (high-level Mermaid diagram, layer descriptions)",
  "gettingStarted": "string — full markdown content for getting-started.md (setup, build, run instructions)"
}`;

// ============================================================================
// Component Analysis Validation Helpers
// ============================================================================

export const COMPONENT_ANALYSIS_REQUIRED_FIELDS = ['componentId', 'overview'] as const;

/**
 * Valid Mermaid diagram type keywords that a diagram should start with
 */
export const VALID_MERMAID_KEYWORDS = [
    'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
    'erDiagram', 'gantt', 'pie', 'gitGraph', 'journey', 'mindmap',
    'timeline', 'quadrantChart', 'sankey', 'xychart', 'block',
] as const;

/**
 * Check if a string looks like a valid Mermaid diagram (starts with a known keyword).
 */
export function isValidMermaidDiagram(diagram: string): boolean {
    if (!diagram || typeof diagram !== 'string') {
        return false;
    }
    const trimmed = diagram.trim();
    return VALID_MERMAID_KEYWORDS.some(keyword =>
        trimmed.startsWith(keyword) || trimmed.startsWith(`${keyword}-`)
    );
}

// ============================================================================
// Validation Helpers
// ============================================================================

export const COMPONENT_GRAPH_REQUIRED_FIELDS = ['project', 'components', 'categories'] as const;

export const PROJECT_INFO_REQUIRED_FIELDS = ['name', 'language'] as const;

export const COMPONENT_INFO_REQUIRED_FIELDS = ['id', 'name', 'path'] as const;

export const VALID_COMPLEXITY_VALUES = ['low', 'medium', 'high'] as const;

/**
 * Validate that a component ID is in the correct format (lowercase kebab-case)
 */
export function isValidComponentId(id: string): boolean {
    return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id);
}

/**
 * Normalize a string into a valid component ID (lowercase kebab-case)
 */
export function normalizeComponentId(input: string): string {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-') || 'unknown';
}

