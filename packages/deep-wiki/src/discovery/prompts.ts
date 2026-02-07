/**
 * Discovery Phase — Prompt Templates
 *
 * Prompt templates for the discovery phase. These guide the AI to explore
 * a repository and produce a structured ModuleGraph JSON.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { MODULE_GRAPH_SCHEMA, STRUCTURAL_SCAN_SCHEMA } from '../schemas';

// ============================================================================
// Discovery Prompt
// ============================================================================

/**
 * Build the main discovery prompt for a repository.
 *
 * @param repoPath - Absolute path to the repository
 * @param focus - Optional subtree to focus on
 * @returns The rendered prompt string
 */
export function buildDiscoveryPrompt(repoPath: string, focus?: string): string {
    const focusSection = focus
        ? `\n## Focus Area\n\nFocus your analysis on the subtree: ${focus}\nOnly include modules within or directly related to this area.\nStill read top-level config files (package.json, README, etc.) for project context.\n`
        : '';

    return `You are a senior software architect analyzing a codebase to produce a comprehensive module graph.
You have access to grep, glob, and view tools to explore the repository at ${repoPath}.

## Your Task

Analyze the repository and produce a JSON object describing its module structure, dependencies, and architecture.

## Exploration Strategy

Follow these steps in order:

1. **File structure**: Run glob("**/*") or glob("*") to understand the overall directory layout and approximate file count.
2. **Config files**: Read key configuration files to determine the project type:
   - Node.js: package.json, tsconfig.json, webpack.config.js
   - Rust: Cargo.toml
   - Go: go.mod, go.sum
   - Python: pyproject.toml, setup.py, requirements.txt
   - Java/Kotlin: pom.xml, build.gradle
   - General: Makefile, Dockerfile, .github/workflows/
3. **Documentation**: Read README.md or similar files for project context and architecture overview.
4. **Entry points**: Identify and read main entry point files (index.ts, main.go, main.rs, app.py, etc.).
5. **Dependency mapping**: Use grep for import/require/use patterns to map dependencies between modules.
   - TypeScript/JavaScript: grep for "import .* from" or "require("
   - Go: grep for "import" blocks
   - Rust: grep for "use " and "mod "
   - Python: grep for "import " and "from .* import"
6. **Monorepo detection**: For monorepos, identify sub-packages and their relationships.
   - Check for workspaces in package.json
   - Check for packages/ or libs/ directories
   - Each sub-package with its own config file is likely a separate module.
${focusSection}
## Output Format

Return a **single JSON object** matching this schema exactly. Do NOT wrap it in markdown code blocks. Return raw JSON only.

${MODULE_GRAPH_SCHEMA}

## Rules

- Module IDs must be unique lowercase kebab-case identifiers (e.g., "auth-service", "database-layer")
- All paths must be relative to the repo root (no absolute paths)
- Dependencies and dependents must reference other module IDs that exist in the modules array
- Complexity: "low" = simple utility/config, "medium" = moderate logic, "high" = complex business logic
- Every module's category must match one of the declared categories
- architectureNotes should be a 2-4 sentence summary of the overall architecture pattern
- Include at least 1-3 key files per module (the most important files for understanding it)
- If you can't determine a field, use a reasonable default rather than leaving it empty`;
}

// ============================================================================
// Structural Scan Prompt (Large Repo First Pass)
// ============================================================================

/**
 * Build the structural scan prompt for large repositories.
 * This is the first pass that identifies top-level areas without deep-diving.
 *
 * @param repoPath - Absolute path to the repository
 * @returns The rendered prompt string
 */
export function buildStructuralScanPrompt(repoPath: string): string {
    return `You are a senior software architect performing a quick structural scan of a large codebase.
You have access to grep, glob, and view tools to explore the repository at ${repoPath}.

## Your Task

This is a LARGE repository. Perform a quick scan to identify the top-level structure WITHOUT deep-diving into any area.

## Steps

1. Run glob("*") to see top-level files and directories.
2. Read top-level config files (package.json, Cargo.toml, go.mod, pyproject.toml, README.md, etc.).
3. Run glob("*/") or similar to identify major subdirectories.
4. For each major directory, run glob("<dir>/*") to get a sense of its contents (do NOT recurse deeply).
5. Estimate the total file count based on what you see.

## Output Format

Return a **single JSON object** matching this schema exactly. Do NOT wrap it in markdown code blocks. Return raw JSON only.

${STRUCTURAL_SCAN_SCHEMA}

## Rules

- List only TOP-LEVEL areas (don't go more than 2 levels deep)
- Estimate fileCount based on directory sizes you observe
- Keep descriptions brief (1 sentence each)
- Include all significant directories (skip node_modules, .git, dist, build, vendor, etc.)`;
}

// ============================================================================
// Focused Discovery Prompt (Large Repo Second Pass)
// ============================================================================

/**
 * Build a focused discovery prompt for a specific area of a large repository.
 * Used in the second pass where each top-level area gets its own session.
 *
 * @param repoPath - Absolute path to the repository
 * @param areaPath - Path of the area to focus on
 * @param areaDescription - Description of the area
 * @param projectName - Name of the overall project
 * @returns The rendered prompt string
 */
export function buildFocusedDiscoveryPrompt(
    repoPath: string,
    areaPath: string,
    areaDescription: string,
    projectName: string
): string {
    return `You are a senior software architect analyzing a specific area of the ${projectName} codebase.
You have access to grep, glob, and view tools to explore the repository at ${repoPath}.

## Your Task

Analyze the "${areaPath}" directory in detail. This area is described as: ${areaDescription}

## Steps

1. Run glob("${areaPath}/**/*") to see all files in this area.
2. Read key entry points and config files within this area.
3. Identify sub-modules, their purposes, and dependencies.
4. Use grep to trace imports/exports to understand internal and cross-area dependencies.

## Output Format

Return a **single JSON object** matching this schema exactly. Do NOT wrap it in markdown code blocks. Return raw JSON only.

${MODULE_GRAPH_SCHEMA}

## Rules

- Module IDs should be prefixed with the area name (e.g., "core-auth", "core-database")
- Paths must be relative to the repo root (include the area path prefix)
- Dependencies may reference modules outside this area — use your best guess for their IDs
- For cross-area dependencies, use the convention: area-name + "-" + module-name
- architectureNotes should describe the architecture of THIS area specifically
- Categories should be specific to this area's contents`;
}
