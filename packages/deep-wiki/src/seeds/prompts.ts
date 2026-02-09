/**
 * Seeds Phase — Prompt Templates
 *
 * Prompt templates for Phase 0 topic seed generation. These guide the AI
 * to scan a repository and identify architectural topics/concerns.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

// ============================================================================
// Seeds Prompt
// ============================================================================

/**
 * Build the topic seeds prompt for a repository.
 *
 * @param repoPath - Absolute path to the repository
 * @param minTopics - Minimum number of topics to generate
 * @param maxTopics - Maximum number of topics to generate
 * @returns The rendered prompt string
 */
export function buildSeedsPrompt(repoPath: string, minTopics: number, maxTopics: number): string {
    return `You are a senior software architect analyzing a codebase to identify architectural topics and concerns.
You have access to grep, glob, and view tools to explore the repository at ${repoPath}.

## Your Task

Scan the repository and identify ${minTopics}-${maxTopics} distinct architectural topics or concerns. These topics represent major areas of functionality, architectural patterns, or modules that would be useful for breadth-first exploration.

## Exploration Strategy

Follow these steps in order:

1. **Top-level structure**: Run glob("*") to see the overall directory layout.
2. **Documentation**: Read README.md, CONTRIBUTING.md, or similar files for project overview.
3. **Package manifests**: Read key configuration files to understand the project:
   - Node.js: package.json, tsconfig.json, webpack.config.js
   - Rust: Cargo.toml
   - Go: go.mod, go.sum
   - Python: pyproject.toml, setup.py, requirements.txt
   - Java/Kotlin: pom.xml, build.gradle
   - General: Makefile, Dockerfile, .github/workflows/
4. **Directory structure**: Examine top-level directories to identify major areas:
   - Look for directories like src/, lib/, packages/, services/, components/, etc.
   - Each major directory may represent a distinct topic.
5. **CI/CD configs**: Check .github/workflows/, .gitlab-ci.yml, or similar for build/test patterns.
6. **Config files**: Look for configuration directories (config/, conf/, etc.) that might indicate separate concerns.

## Output Format

Return a **single JSON object** matching this schema exactly. Do NOT wrap it in markdown code blocks. Return raw JSON only.

{
  "topics": [
    {
      "topic": "string — short kebab-case identifier (e.g., authentication, api-gateway, database-layer)",
      "description": "string — 1-2 sentence description of what this topic represents",
      "hints": ["string — search terms/keywords to find related code", "another hint"]
    }
  ]
}

## Rules

- Generate between ${minTopics} and ${maxTopics} topics
- Topic IDs must be unique lowercase kebab-case identifiers (e.g., "authentication", "api-gateway", "database-layer")
- Each topic should represent a distinct architectural concern or module area
- Hints should be an array of 2-5 search terms that would help locate code related to this topic
- Focus on high-level architectural concerns, not low-level implementation details
- If the repository is small, you may generate fewer topics, but aim for at least ${minTopics}
- If the repository is large, prioritize the most important or central topics
- Topics should be useful for guiding breadth-first exploration of the codebase`;
}
