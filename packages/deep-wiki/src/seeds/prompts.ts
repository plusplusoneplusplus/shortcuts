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
 * @param maxTopics - Maximum number of topics to generate
 * @returns The rendered prompt string
 */
export function buildSeedsPrompt(repoPath: string, maxTopics: number): string {
    return `You are a senior software architect analyzing a codebase to identify feature-level topics and concerns.
You have access to grep, glob, and view tools to explore the repository at ${repoPath}.

## Your Task

Scan the repository and identify up to ${maxTopics} distinct feature-level topics. Each topic should describe a **user-facing capability, architectural concern, or behavioral pattern** — NOT a file name or directory path.

## Exploration Strategy

Follow these steps in order — understanding PURPOSE before STRUCTURE is critical:

1. **Documentation first**: Read README.md, CONTRIBUTING.md, ARCHITECTURE.md, or similar files to understand what the project DOES and what features it provides.
2. **Package manifests**: Read key configuration files to understand the project:
   - Node.js: package.json, tsconfig.json, webpack.config.js
   - Rust: Cargo.toml
   - Go: go.mod, go.sum
   - Python: pyproject.toml, setup.py, requirements.txt
   - Java/Kotlin: pom.xml, build.gradle
   - General: Makefile, Dockerfile, .github/workflows/
3. **Entry points**: Read main entry point files (index.ts, main.go, main.rs, app.py) to understand what the project exposes and how features are wired together.
4. **Directory structure**: Run glob("*") to see the overall layout, then examine top-level directories to confirm feature domains you identified from docs.
5. **CI/CD configs**: Check .github/workflows/, .gitlab-ci.yml, or similar for build/test patterns.
6. **Config files**: Look for configuration directories (config/, conf/, etc.) that might indicate separate concerns.

## Naming Guidance

Topics should describe WHAT the code does, not WHERE it lives.

**Good topic names** (feature-focused):
- "inline-code-review" (describes the feature)
- "ai-powered-analysis" (describes the capability)
- "real-time-sync" (describes the behavior)
- "plugin-architecture" (describes the pattern)

**Bad topic names** (file/path mirrors — DO NOT USE):
- "extension-entry-point" (just echoes a file name)
- "tree-items" (just echoes a file name)
- "types-and-interfaces" (describes a code artifact, not a feature)
- "src-utils" (just a directory path)

## Anti-Patterns — AVOID These

- Do NOT name topics after individual files (e.g., "file-system-watcher" for a single watcher file)
- Do NOT name topics after directory paths (e.g., "src-shortcuts-code-review")
- Do NOT create topics for generic code artifacts like "types", "utilities", "helpers", "constants"
- Do NOT create a topic for every directory — group related directories into feature-level concerns

## Output Format

Return a **single JSON object** matching this schema exactly. Do NOT wrap it in markdown code blocks. Return raw JSON only.

{
  "topics": [
    {
      "topic": "string — short kebab-case identifier describing the FEATURE (e.g., authentication, api-gateway, real-time-sync)",
      "description": "string — 1-2 sentence description of what this feature/concern does for users or the system",
      "hints": ["string — search terms/keywords to find related code", "another hint"]
    }
  ]
}

## Rules

- Generate up to ${maxTopics} topics
- Topic IDs must be unique lowercase kebab-case identifiers that describe features (e.g., "authentication", "api-gateway", "pipeline-execution")
- Each topic should represent a distinct user-facing feature, architectural concern, or behavioral pattern
- Hints should be an array of 2-5 search terms that would help locate code related to this topic
- Focus on what the code DOES for users or the system, not on file/directory names
- If the repository is small, you may generate fewer topics
- If the repository is large, prioritize the most important or central topics
- Topics should be useful for guiding breadth-first exploration of the codebase
- When in doubt, ask "what feature does this enable?" rather than "what file is this?"`;
}
