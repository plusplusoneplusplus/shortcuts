/**
 * Deep Wiki Generator — JSON Schemas
 *
 * JSON schema strings used to instruct the AI on expected output format.
 * These are embedded in prompts to guide structured AI responses.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

// ============================================================================
// Module Graph Schema (Phase 1 output)
// ============================================================================

/**
 * JSON schema string for the ModuleGraph type.
 * Used in the discovery prompt to specify expected output format.
 */
export const MODULE_GRAPH_SCHEMA = `{
  "project": {
    "name": "string — project name from config files",
    "description": "string — brief description from README or config",
    "language": "string — primary programming language",
    "buildSystem": "string — build system (e.g., npm + webpack, cargo, go modules)",
    "entryPoints": ["string — entry point file paths relative to repo root"]
  },
  "modules": [
    {
      "id": "string — unique kebab-case identifier describing the FEATURE (e.g., 'auth-engine', 'pipeline-executor'), NOT the file/directory path (avoid 'src-auth', 'packages-core-src')",
      "name": "string — human-readable name describing what this module DOES for users/system (e.g., 'Authentication Engine', 'Pipeline Executor'), NOT the file name",
      "path": "string — path relative to repo root (e.g., src/auth/)",
      "purpose": "string — what this module does for users or the system (feature-focused, not 'contains files in src/auth')",
      "keyFiles": ["string — key file paths relative to repo root"],
      "dependencies": ["string — IDs of modules this depends on"],
      "dependents": ["string — IDs of modules that depend on this"],
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
 * JSON schema string for the structural scan output (large repo first pass).
 */
export const STRUCTURAL_SCAN_SCHEMA = `{
  "fileCount": "number — estimated total number of files",
  "areas": [
    {
      "name": "string — descriptive area name focusing on FUNCTIONALITY (e.g., 'AI Pipeline Engine' not just 'packages/core')",
      "path": "string — path relative to repo root",
      "description": "string — what this area DOES, not just what directory it is"
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
// Module Analysis Schema (Phase 3 output)
// ============================================================================

/**
 * JSON schema string for the ModuleAnalysis type.
 * Used in analysis prompts to specify expected output format.
 */
export const MODULE_ANALYSIS_SCHEMA = `{
  "moduleId": "string — must match the module ID provided",
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
        "module": "string — module ID",
        "usage": "string — how this module uses it"
      }
    ],
    "external": [
      {
        "package": "string — package name",
        "usage": "string — how this module uses it"
      }
    ]
  },
  "suggestedDiagram": "string — Mermaid diagram code (e.g., graph TD; A-->B)",
  "sourceFiles": ["string — all file paths examined during analysis, relative to repo root"]
}`;

/**
 * JSON schema string for the reduce output (Phase 4 index/architecture generation).
 */
export const REDUCE_OUTPUT_SCHEMA = `{
  "index": "string — full markdown content for index.md (categorized TOC, project overview, module summaries)",
  "architecture": "string — full markdown content for architecture.md (high-level Mermaid diagram, layer descriptions)",
  "gettingStarted": "string — full markdown content for getting-started.md (setup, build, run instructions)"
}`;

// ============================================================================
// Module Analysis Validation Helpers
// ============================================================================

/**
 * Required fields for a valid ModuleAnalysis
 */
export const MODULE_ANALYSIS_REQUIRED_FIELDS = ['moduleId', 'overview'] as const;

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

/**
 * Required fields for a valid ModuleGraph
 */
export const MODULE_GRAPH_REQUIRED_FIELDS = ['project', 'modules', 'categories'] as const;

/**
 * Required fields for a valid ProjectInfo
 */
export const PROJECT_INFO_REQUIRED_FIELDS = ['name', 'language'] as const;

/**
 * Required fields for a valid ModuleInfo
 */
export const MODULE_INFO_REQUIRED_FIELDS = ['id', 'name', 'path'] as const;

/**
 * Valid complexity values
 */
export const VALID_COMPLEXITY_VALUES = ['low', 'medium', 'high'] as const;

/**
 * Validate that a module ID is in the correct format (lowercase kebab-case)
 */
export function isValidModuleId(id: string): boolean {
    return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id);
}

/**
 * Normalize a string into a valid module ID (lowercase kebab-case)
 */
export function normalizeModuleId(input: string): string {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-') || 'unknown';
}
