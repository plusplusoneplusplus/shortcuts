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

    return `You are a senior software architect analyzing a codebase to produce a comprehensive, feature-oriented module graph.
You have access to grep, glob, and view tools to explore the repository at ${repoPath}.

## Your Task

Analyze the repository and produce a JSON object describing its module structure, dependencies, and architecture. Modules should represent **features, capabilities, and architectural concerns** — not just files or directories.

## Exploration Strategy

Follow these steps in order — understand PURPOSE before STRUCTURE:

1. **Documentation first**: Read README.md, ARCHITECTURE.md, or similar files for project context, features, and architecture overview.
2. **Config files**: Read key configuration files to determine the project type:
   - Node.js: package.json, tsconfig.json, webpack.config.js
   - Rust: Cargo.toml
   - Go: go.mod, go.sum
   - Python: pyproject.toml, setup.py, requirements.txt
   - Java/Kotlin: pom.xml, build.gradle
   - General: Makefile, Dockerfile, .github/workflows/
3. **Entry points**: Identify and read main entry point files (index.ts, main.go, main.rs, app.py, etc.) to understand what features are wired together.
4. **File structure**: Run glob("**/*") or glob("*") to understand the overall directory layout and approximate file count.
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
## Module Naming Guidance

Module IDs and names should describe WHAT the code does, not WHERE it lives.

**Good module IDs** (feature-focused):
- "inline-code-review" — describes the feature
- "ai-pipeline-engine" — describes the capability
- "workspace-shortcuts" — describes user-facing functionality
- "config-migration" — describes the architectural concern

**Bad module IDs** (path mirrors — DO NOT USE):
- "src-shortcuts-code-review" — just a directory path turned into kebab-case
- "packages-deep-wiki-src-cache" — echoes the file path
- "extension-entry-point" — just the file name
- "types-and-interfaces" — describes a code artifact, not a feature

## Output Format

Return a **single JSON object** matching this schema exactly. Do NOT wrap it in markdown code blocks. Return raw JSON only.

${MODULE_GRAPH_SCHEMA}

## Rules

- Module IDs must be unique lowercase kebab-case identifiers describing the FEATURE (e.g., "auth-service", "pipeline-execution", "real-time-sync")
- Do NOT derive module IDs from file paths or directory names — describe what the module DOES
- All paths must be relative to the repo root (no absolute paths)
- Dependencies and dependents must reference other module IDs that exist in the modules array
- Complexity: "low" = simple utility/config, "medium" = moderate logic, "high" = complex business logic
- Every module's category must match one of the declared categories
- architectureNotes should be a 2-4 sentence summary of the overall architecture pattern
- Include at least 1-3 key files per module (the most important files for understanding it)
- If you can't determine a field, use a reasonable default rather than leaving it empty
- Group related files into feature-level modules — do NOT create one module per file`;
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

This is a LARGE repository. Perform a quick scan to identify the top-level structure WITHOUT deep-diving into any area. Focus on understanding what each area DOES, not just what directory it is.

## Steps

1. Read top-level README.md and config files (package.json, Cargo.toml, go.mod, pyproject.toml, etc.) to understand the project's purpose and features.
2. Run glob("*") to see top-level files and directories.
3. Run glob("*/") or similar to identify major subdirectories.
4. For each major directory, run glob("<dir>/*") to get a sense of its contents (do NOT recurse deeply).
5. Estimate the total file count based on what you see.

## Area Naming Guidance

Area names should describe the FUNCTIONALITY of each area, not just echo the directory name.

**Good**: "AI Pipeline Engine (packages/core)" — describes what it does
**Bad**: "packages/core" — just the directory path

When the directory name is already descriptive (e.g., "authentication/"), keep it. When it's generic (e.g., "src/", "lib/", "pkg/"), describe what it contains.

## Output Format

Return a **single JSON object** matching this schema exactly. Do NOT wrap it in markdown code blocks. Return raw JSON only.

${STRUCTURAL_SCAN_SCHEMA}

## Rules

- List only TOP-LEVEL areas (don't go more than 2 levels deep)
- Estimate fileCount based on directory sizes you observe
- Area descriptions should explain what the area DOES, not just restate the directory name
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

Focus on identifying the **features, capabilities, and behavioral patterns** within this area — not just listing its files.

## Steps

1. Read any README, docs, or config files within "${areaPath}" to understand the area's purpose.
2. Run glob("${areaPath}/**/*") to see all files in this area.
3. Read key entry points and config files within this area.
4. Identify feature-level sub-modules, their purposes, and dependencies.
5. Use grep to trace imports/exports to understand internal and cross-area dependencies.

## Module Naming Guidance

Module IDs should describe WHAT the code does, not echo directory paths.

**Good**: "core-auth-engine", "pipeline-executor", "cache-invalidation"
**Bad**: "packages-core-src-auth", "src-pipeline", "cache-index" (path mirrors)

## Output Format

Return a **single JSON object** matching this schema exactly. Do NOT wrap it in markdown code blocks. Return raw JSON only.

${MODULE_GRAPH_SCHEMA}

## Rules

- Module IDs should be prefixed with the area name and describe the FEATURE (e.g., "core-auth-engine", "core-data-pipeline")
- Do NOT derive module IDs from file paths — describe what the module DOES
- Paths must be relative to the repo root (include the area path prefix)
- Dependencies may reference modules outside this area — use your best guess for their IDs
- For cross-area dependencies, use the convention: area-name + "-" + module-name
- architectureNotes should describe the architecture of THIS area specifically
- Categories should be specific to this area's contents
- Group related files into feature-level modules — do NOT create one module per file`;
}
