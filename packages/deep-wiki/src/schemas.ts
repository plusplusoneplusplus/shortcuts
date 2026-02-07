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
      "id": "string — unique lowercase kebab-case identifier",
      "name": "string — human-readable module name",
      "path": "string — path relative to repo root (e.g., src/auth/)",
      "purpose": "string — one-sentence purpose description",
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
      "name": "string — area name (e.g., packages/core)",
      "path": "string — path relative to repo root",
      "description": "string — brief description of what this area contains"
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
