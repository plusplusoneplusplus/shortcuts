# Deep Wiki Generator

## Overview

A standalone CLI tool that auto-generates a comprehensive, browsable wiki for any codebase. Inspired by Cognition's [DeepWiki](https://deepwiki.com/), but runs locally via the Copilot SDK — no code leaves the machine.

**Output:** Markdown files in a folder, ready for conversion to a static site (e.g., via MkDocs, Docusaurus, or similar).

## Goals

1. **Any repo size** — scales from 10-file projects to 5000+ file monorepos
2. **Standalone CLI** — no VS Code dependency, uses `pipeline-core` package
3. **High quality** — AI has live tool access (grep, glob, view) to investigate code during generation
4. **Incremental** — cache analysis results, only regenerate changed modules
5. **Customizable** — control depth, focus areas, writing style

## Architecture

### Three-Phase Pipeline

The generator uses three sequential phases. Each phase builds on the output of the previous one.

```
Phase 1: DISCOVER          Phase 2: ANALYZE           Phase 3: WRITE
─────────────────          ──────────────────         ──────────────

Repo (local clone)         Module list + graph        Wiki articles
       │                          │                          │
       ▼                          ▼                          ▼
┌──────────────┐           ┌──────────────┐           ┌──────────────┐
│  AI + Tools  │           │  Map-Reduce  │           │  Map-Reduce  │
│  (1 session) │──────▶    │  (parallel)  │──────▶    │  (parallel)  │──▶ Markdown
│              │           │              │           │              │    files
│  grep, glob, │  Module   │  1 session   │  Deep     │  1 session   │
│  view        │  Graph    │  per module  │  Analysis │  per topic   │
└──────────────┘           └──────────────┘           └──────────────┘

   Not parallel               Parallel (N)              Parallel (N)
   ~1-3 minutes               ~2-10 minutes              ~2-5 minutes
```

### Why Three Phases

| Phase | Purpose | Why separate |
|-------|---------|--------------|
| Discovery | Build holistic understanding of repo structure | Cannot be parallelized — needs global view |
| Analysis | Deep-dive into each module's internals | Parallelizable, structured output for reuse |
| Writing | Generate polished prose articles | Parallelizable, can be re-run with different styles without re-analyzing |

Separating analysis from writing also enables **caching**: re-run Phase 3 with a different audience or style without repeating the expensive Phase 2.

## Phase 1: Discovery

**Input:** Path to local git clone
**Output:** Module graph (JSON)
**Parallelism:** None — single AI session

A single long-running AI session with MCP tool access (`grep`, `glob`, `view`). The AI:

1. Scans directory structure via `glob`
2. Reads key files: README, package.json/Cargo.toml/go.mod, entry points, configs
3. Identifies modules, packages, and major directories
4. Maps dependencies and relationships between modules
5. Determines the "story" of the codebase — what it does, how it's organized

### Output Schema

```json
{
  "project": {
    "name": "my-project",
    "description": "Brief description inferred from README/config",
    "language": "TypeScript",
    "buildSystem": "npm + webpack",
    "entryPoints": ["src/index.ts"]
  },
  "modules": [
    {
      "id": "auth",
      "name": "Authentication Module",
      "path": "src/auth/",
      "purpose": "Handles user authentication and session management",
      "keyFiles": ["src/auth/index.ts", "src/auth/jwt.ts", "src/auth/middleware.ts"],
      "dependencies": ["database", "config"],
      "dependents": ["api", "web"],
      "complexity": "medium",
      "category": "core"
    }
  ],
  "categories": [
    { "name": "core", "description": "Core business logic" },
    { "name": "infra", "description": "Infrastructure and utilities" }
  ],
  "architectureNotes": "Layered architecture with dependency injection..."
}
```

### Scaling for Large Repos

The AI doesn't read every file. It uses tools strategically:

- `glob("**/*.ts")` to understand file distribution
- `view` on entry points and index files
- `grep` for import/export patterns to map dependencies
- Hierarchical discovery for monorepos: scan top-level first, then drill into packages

For very large repos (5000+ files), Phase 1 may do **multi-round discovery**: first pass identifies top-level structure, second pass explores each top-level area.

### SDK Usage

```typescript
const result = await sdkService.sendMessage({
  prompt: discoveryPrompt,
  workingDirectory: repoPath,
  availableTools: ['view', 'grep', 'glob'],
  onPermissionRequest: (req) =>
    req.kind === 'read' ? { kind: 'approved' } : { kind: 'denied-by-rules' },
  usePool: false,  // Direct session for MCP tool access
  timeoutMs: 300000,  // 5 minutes
});
```

## Phase 2: Deep Analysis

**Input:** Module graph from Phase 1
**Output:** Structured analysis per module (JSON)
**Parallelism:** 5-10 concurrent sessions via session pool

For each module in the graph, spawn an AI session with tool access. Each session:

1. Reads the module's key files
2. Analyzes public API, exports, types
3. Traces internal control flow and data flow
4. Identifies patterns, conventions, error handling strategies
5. Extracts code examples worth highlighting

### Map-Reduce Configuration

```
Splitter:  IdentitySplitter (one module = one work item)
Mapper:    PromptMapper with MCP tools
Reducer:   IdentityReducer (collect all analyses as-is)
Parallel:  5-10 concurrent
```

### Output Schema (Per Module)

```json
{
  "moduleId": "auth",
  "overview": "The auth module provides JWT-based authentication...",
  "keyConcepts": [
    { "name": "Session Token", "description": "...", "codeRef": "src/auth/jwt.ts:45" }
  ],
  "publicAPI": [
    { "name": "authenticate()", "signature": "...", "description": "..." }
  ],
  "internalArchitecture": "Uses middleware pattern with...",
  "dataFlow": "Request → middleware → JWT validation → session lookup → ...",
  "patterns": ["Middleware chain", "Factory pattern for token providers"],
  "errorHandling": "Throws AuthError subclasses, caught by global handler",
  "codeExamples": [
    { "title": "Basic authentication", "code": "...", "file": "src/auth/index.ts", "lines": [10, 25] }
  ],
  "dependencies": {
    "internal": [{ "module": "database", "usage": "Session storage" }],
    "external": [{ "package": "jsonwebtoken", "usage": "JWT signing/verification" }]
  },
  "suggestedDiagram": "sequenceDiagram\n  Client->>Middleware: Request with token\n  ..."
}
```

### Tool Access Per Session

Each analysis session gets read-only MCP tools scoped to the repo:

```typescript
const job: PromptMapJob = {
  items: moduleGraph.modules,
  mapPrompt: analysisPromptTemplate,  // References {{path}}, {{keyFiles}}, {{purpose}}
  mapOptions: {
    parallel: 5,
    timeoutMs: 180000,  // 3 minutes per module
    availableTools: ['view', 'grep', 'glob'],
    onPermissionRequest: readOnlyPermissions,
  },
  reduceMode: 'deterministic',  // Just collect results
};
```

## Phase 3: Article Generation

**Input:** Module graph (Phase 1) + deep analyses (Phase 2)
**Output:** Markdown files
**Parallelism:** 5-10 concurrent sessions (no tool access needed)

### Article Types

| Article | Source | Description |
|---------|--------|-------------|
| `index.md` | Reduce phase | Table of contents, project overview |
| `architecture.md` | Reduce phase | High-level architecture with Mermaid diagrams |
| `getting-started.md` | Reduce phase | Setup, build, run instructions |
| `{module-name}.md` | Map phase (1 per module) | Detailed module documentation |

### Map Phase: Module Articles

Each session receives:
- The module's deep analysis from Phase 2
- The full module graph for cross-referencing
- Writing guidelines (depth, style, audience)

Produces a markdown article with:
- Overview and purpose
- Key concepts
- API reference
- Architecture/data flow (with Mermaid diagrams)
- Code examples
- Related modules (cross-links)

### Reduce Phase: Index & Architecture

An AI reducer receives all module articles and generates:

1. **`index.md`** — project overview + categorized table of contents with links
2. **`architecture.md`** — high-level architecture overview with Mermaid component/sequence diagrams
3. **`getting-started.md`** — synthesized from README + build config analysis

### No Tool Access Needed

Phase 3 sessions work purely from the structured data produced by Phase 2. No MCP tools required — this is a pure writing task, making it faster and cheaper.

```typescript
const job: PromptMapJob = {
  items: modulesWithAnalysis,
  mapPrompt: articlePromptTemplate,
  mapOptions: {
    parallel: 10,  // Higher parallelism since no tools
    timeoutMs: 120000,
  },
  reduceMode: 'ai',
  reducePrompt: indexGenerationPrompt,
};
```

## Output Structure

```
wiki/
├── index.md                    # Project overview + table of contents
├── architecture.md             # High-level architecture + diagrams
├── getting-started.md          # Setup and build instructions
├── modules/
│   ├── auth.md                 # Authentication module
│   ├── database.md             # Database layer
│   ├── api.md                  # API endpoints
│   └── ...
├── assets/
│   └── (any generated diagrams)
└── .wiki-cache/                # Cached Phase 1+2 results for incremental rebuilds
    ├── module-graph.json       # Phase 1 output
    └── analyses/
        ├── auth.json           # Phase 2 per-module analyses
        └── ...
```

## Incremental Rebuilds

After the initial generation, subsequent runs can be faster:

1. **Detect changes** — `git diff --name-only <last-hash>` to find changed files
2. **Map to modules** — determine which modules are affected
3. **Re-run Phase 2** — only for affected modules
4. **Re-run Phase 3** — only for affected module articles + re-generate index

The `.wiki-cache/` directory stores Phase 1 + Phase 2 outputs with the git hash they were generated from.

## CLI Interface

```bash
# Basic usage
deep-wiki /path/to/repo --output ./wiki

# Options
deep-wiki /path/to/repo \
  --output ./wiki \
  --concurrency 5 \          # Parallel AI sessions
  --model claude-sonnet \     # Model for all phases
  --focus "src/" \            # Only document this subtree
  --depth shallow|normal|deep \  # Article detail level
  --cache .wiki-cache \       # Cache directory for incremental rebuilds
  --force \                   # Ignore cache, regenerate everything
  --phase 3 \                 # Re-run only from phase N (uses cached prior phases)
  --format markdown           # Output format
```

## SDK Components Used

| Component | Usage |
|-----------|-------|
| `CopilotSDKService` | All AI interactions |
| `sendMessage()` with MCP tools | Phase 1 discovery, Phase 2 analysis |
| `SessionPool` | Phase 2 + Phase 3 parallel sessions |
| `MapReduceExecutor` | Phase 2 (analysis) and Phase 3 (writing) |
| `IdentitySplitter` | One module = one work item |
| `PromptMapper` | Template-based prompts with module data |
| `AIReducer` | Phase 3 index/architecture generation |
| `ConcurrencyLimiter` | Control parallel session count |
| `isCancelled()` | Graceful cancellation across all phases |
| Progress callbacks | Per-phase progress reporting |

## Open Questions

1. **Monorepo support** — should each package get its own wiki, or one unified wiki?
2. **Language-specific analyzers** — should Phase 1 have language-specific heuristics (e.g., know about `go.mod`, `Cargo.toml`, `pyproject.toml`)?
3. **Diagram generation** — Mermaid only, or also support other formats?
4. **Static site integration** — bundle a default MkDocs/Docusaurus config, or just output raw markdown?
5. **Interactive Q&A** — after generation, allow follow-up questions against the wiki as context?
6. **Cost control** — should there be a `--budget` flag to limit total API calls?
