# DeepWiki-Like Documentation System

## Vision

Build an AI-powered documentation system that discovers structural clusters in a codebase and generates human-readable wiki pages with topics that reflect how an engineer would explain the system.

**Core Principle:** AI cannot create a topic unless the codebase structurally supports it.

- **Graphs find reality** - Static analysis discovers actual code relationships
- **AI provides names and narratives** - AI explains what the structure means

---

## Requirements

### Functional Requirements

#### FR1: Structural Discovery
- Analyze codebase to discover structural clusters of related files
- Identify entry points, shared modules, and feature boundaries
- Build dependency graph from imports/exports
- Detect high fan-in modules (shared infrastructure)
- **Support multiple languages: TypeScript/JavaScript, Python, C++**

#### FR2: Contextual Enrichment
- Analyze git history for co-change patterns
- Map test files to source files
- Map documentation to source code
- Detect configuration and runtime wiring

#### FR3: AI-Powered Topic Generation
- Name clusters at appropriate abstraction level (concepts, not file names)
- Generate human-readable explanations for onboarding
- Suggest cluster boundary adjustments (split/merge)
- Create architecture diagrams with source links

#### FR4: Subfolder Scoping
- Support generating documentation for a subfolder within a repository
- Handle dependencies outside the target scope appropriately
- Allow including additional paths (e.g., shared utilities)
- Generate external dependencies reference page

#### FR5: Wiki Output
- Generate markdown wiki pages organized by features and topics
- Include source file links with line numbers
- Generate dependency graphs and architecture diagrams
- Support incremental regeneration

### Non-Functional Requirements

#### NFR1: Performance
- Handle repositories with 100K+ files
- Support incremental analysis (only changed files)
- Parallel processing for AI calls

#### NFR2: Accuracy
- Every topic must have structural evidence
- No hallucinated topics or invented relationships
- Validate generated content against codebase

#### NFR3: Usability
- Integrate with VSCode extension
- Support CLI usage
- Configurable via YAML file

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         INPUT: CODEBASE                             │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PHASE 1: STATIC ANALYSIS                         │
│                                                                     │
│  • Parse imports/exports (TypeScript AST, MSBuild, etc.)            │
│  • Build dependency graph                                           │
│  • Identify entry points and shared modules                         │
│  • Detect build targets and bundle boundaries                       │
│                                                                     │
│  Output: Dependency graph + unnamed file clusters                   │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  PHASE 2: CONTEXTUAL SIGNALS                        │
│                                                                     │
│  • Git co-change analysis (files that change together)              │
│  • Test → source file mapping                                       │
│  • Documentation → source mapping                                   │
│  • Configuration and registration patterns                          │
│                                                                     │
│  Output: Enriched clusters with contextual metadata                 │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      PHASE 3: AI LAYER                              │
│                                                                     │
│  • Name clusters (concepts, not implementation details)             │
│  • Explain purpose in onboarding terms                              │
│  • Suggest boundary adjustments                                     │
│  • Generate diagrams and narratives                                 │
│                                                                     │
│  Output: Named topics with explanations                             │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   PHASE 4: WIKI GENERATION                          │
│                                                                     │
│  • Generate markdown pages per topic                                │
│  • Create index pages (features, topics)                            │
│  • Generate Mermaid diagrams                                        │
│  • Add source links with line numbers                               │
│                                                                     │
│  Output: Markdown wiki files                                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Multi-Language Support

The system must support analysis of codebases in multiple languages:

### Supported Languages

| Language | Import Analysis | Entry Points | Build System |
|----------|----------------|--------------|--------------|
| **TypeScript/JavaScript** | ES6 imports, require() | package.json main, webpack entries | npm, webpack, tsconfig |
| **Python** | import statements, from...import | `__main__`, setup.py entry_points | pip, setup.py, pyproject.toml |
| **C++** | #include directives | main(), WinMain(), ServiceMain() | CMake, MSBuild, Makefile |

### Language-Specific Signals

#### TypeScript/JavaScript
- `package.json` dependencies and entry points
- `tsconfig.json` paths and project references
- Webpack/Vite/Rollup bundle configuration
- `index.ts` barrel exports as public API

#### Python
- `import` and `from...import` statements
- `__init__.py` as package markers
- `setup.py` / `pyproject.toml` for package metadata
- `requirements.txt` / `Pipfile` for dependencies

#### C++
- `#include` directives (distinguish `<system>` vs `"local"`)
- MSBuild `.vcxproj` project references
- CMake `target_link_libraries` and `add_subdirectory`
- Header file fan-in as API surface indicator

### Mixed-Language Repositories

For repositories with multiple languages:
- Detect language per directory/file
- Build unified dependency graph with cross-language edges
- Identify FFI/binding layers (e.g., Python C extensions, wasm)
- Generate per-language and cross-language topic views

---

## Subfolder Scoping

### Use Cases

1. **Large Monorepos** - Document one service without processing entire codebase
2. **Focused Documentation** - Generate docs for a specific feature area
3. **Library Documentation** - Document a library embedded in a larger project
4. **Incremental Onboarding** - Start with one subsystem, expand later

### Scope Configuration

| Setting | Description |
|---------|-------------|
| `targetPath` | Subfolder to document (relative to repo root) |
| `externalDependencyMode` | How to handle deps outside target |
| `additionalIncludes` | Extra paths to include in scope |
| `excludePaths` | Paths to exclude within target |

### External Dependency Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `reference` | Show as external link, don't fully document | Document one module, reference shared code |
| `include` | Pull in and document transitively | Document module + all its dependencies |
| `ignore` | Treat as opaque external | Focus only on target, hide dep internals |

### Scoped Dependency Graph

```
┌─────────────────────────────────────────────────────────────────────┐
│                      FULL REPO GRAPH                                │
│                                                                     │
│    extension.ts ──▶ ai-service/ ──▶ shared/                        │
│         │               │              ▲                            │
│         ▼               ▼              │                            │
│      git/ ◀──── code-review/ ─────────┘                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  │  Scope: targetPath = ai-service/
                                  │         additionalIncludes = [shared/]
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      SCOPED GRAPH                                   │
│                                                                     │
│  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓                        │
│  ┃  IN SCOPE (fully documented)           ┃                        │
│  ┃                                        ┃                        │
│  ┃    ai-service/ ──▶ shared/             ┃                        │
│  ┃                                        ┃                        │
│  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛                        │
│              │                                                      │
│              ▼                                                      │
│       ┌ ─ ─ ─ ─ ─ ─ ┐                                              │
│         extension.ts   ← External reference only                   │
│       └ ─ ─ ─ ─ ─ ─ ┘                                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Scoped Analysis Behavior

| Phase | Scoped Behavior |
|-------|-----------------|
| Static Analysis | Only parse files within targetPath + additionalIncludes |
| Import Graph | Track edges crossing scope boundary as "external" |
| Git Co-change | Filter to commits touching scoped files |
| Test Mapping | Only map tests within scope |
| Clustering | Cluster only scoped files; externals become single nodes |
| AI Naming | Name topics within scope; externals get generic labels |
| Wiki Output | Generate pages for scope; external deps page lists references |

---

## Wiki Output Structure

```
docs/wiki/
├── index.md                      # Overview with navigation
├── features/                     # Feature-level documentation
│   ├── index.md
│   ├── markdown-review.md
│   ├── git-diff-review.md
│   └── yaml-pipelines.md
├── topics/                       # Cross-cutting topics
│   ├── index.md
│   ├── tree-view-infrastructure.md
│   ├── ai-integration.md
│   └── configuration-system.md
├── architecture/                 # System-wide architecture
│   ├── overview.md
│   └── dependency-graph.md
└── diagrams/                     # Generated diagrams
    └── module-dependencies.mermaid
```

### Wiki Page Content

Each topic page includes:
- **Summary** - 2-3 sentence overview
- **Purpose** - What problem it solves
- **Architecture** - How it's structured (with diagram)
- **Key Components** - Table with file links
- **Dependencies** - What it relies on
- **Dependents** - What relies on it
- **Code Examples** - Key snippets with explanations
- **Related** - Links to tests and documentation

---

## AI Topic Naming Guidelines

### Good Names (Concepts)
- "Application Lifecycle & Bootstrap"
- "Tree View Infrastructure"
- "AI-Powered Code Review"
- "Comment Persistence System"

### Bad Names (Implementation Details)
- "extension.ts"
- "shared/base-tree-data-provider"
- "Utility Functions"
- "Miscellaneous"

### Naming Criteria
1. Reflect the **concept**, not file/folder names
2. Use terms an engineer would use in onboarding
3. Consider the cluster's role in the larger system
4. Match abstraction level to cluster scope

---

## Configuration

### YAML Configuration File

```yaml
# .deepwiki.yaml
output:
  path: docs/wiki
  format: markdown

analysis:
  gitLookbackDays: 90
  clusteringThreshold: 0.7
  includePrivateApis: false

scope:
  targetPath: src/shortcuts/ai-service    # Optional: subfolder
  externalDependencyMode: reference
  additionalIncludes:
    - src/shortcuts/shared
  excludePaths:
    - "**/*.test.ts"
    - "**/fixtures/**"

ignore:
  - node_modules/
  - dist/
  - out/
```

### Extension Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `deepwiki.enabled` | Enable DeepWiki feature | `true` |
| `deepwiki.outputPath` | Wiki output directory | `docs/wiki` |
| `deepwiki.gitLookbackDays` | Days of git history to analyze | `90` |
| `deepwiki.parallelism` | Concurrent AI calls | `5` |
| `deepwiki.scope.defaultMode` | Default external dep mode | `reference` |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Circular dependencies confuse clustering | Use strongly connected components algorithm |
| Too many small clusters | Set minimum cluster size threshold |
| AI names inconsistently | Use few-shot examples, validate against guidelines |
| Generated docs become stale | Add "last verified" timestamp, CI validation |
| Large repos timeout | Incremental analysis, caching intermediate results |
| Scoped analysis misses critical context | Suggest additional includes based on fan-in |
| External deps list too long | Group by category, collapse low-relevance deps |
| Scoped wiki orphaned from main docs | Generate navigation links back to full repo wiki |

---

## Testing Strategy

### Test with Current Extension

This extension is an ideal test case with expected clusters:

| Expected Topic | Source Files |
|----------------|--------------|
| Extension Bootstrap | extension.ts, activation logic |
| Tree View Infrastructure | shared/base-tree-data-provider, filterable-tree-data-provider |
| Markdown Review Editor | markdown-comments/ directory |
| Git Diff Review | git-diff-comments/ directory |
| AI Integration | ai-service/ directory |
| YAML Pipelines | yaml-pipeline/, map-reduce/ |
| Configuration System | configuration-manager.ts, migrations |

### Subfolder Testing Scenarios

| Target | Expected Clusters | External Deps |
|--------|------------------|---------------|
| `src/shortcuts/ai-service` | Session Pool, Copilot Wrapper, Process Manager | shared/, extension.ts |
| `src/shortcuts/yaml-pipeline` | Pipeline Manager, Executor, Tree Provider | map-reduce/, shared/ |
| `src/shortcuts/markdown-comments` | Editor Provider, Comments Manager, Webview | shared/, tree-items.ts |

### Validation Criteria

| Criterion | How to Verify |
|-----------|---------------|
| Clusters match directory structure | Compare detected clusters with subdirectories |
| High fan-in modules identified | `shared/` modules should have highest fan-in |
| Entry points found | extension.ts, webview entry points detected |
| No orphan topics | Every topic has structural support |
| Scoped output correct | Only target files in generated wiki |

---

## Future Enhancements

1. **Incremental Updates** - Only regenerate changed topics
2. **Interactive Mode** - Let developers adjust cluster boundaries
3. **Multi-Language** - Support C++, Python, Go analysis
4. **Search Integration** - Full-text search across wiki
5. **Version History** - Track topic evolution over time
6. **IDE Integration** - Show topic info in hover tooltips

---

## Detailed Phase Documents

Each phase has a dedicated design document with implementation details and testing strategy:

| Phase | Document | Description |
|-------|----------|-------------|
| Phase 1 | [phase1-static-analysis.md](./phase1-static-analysis.md) | Dependency graph construction, multi-language parsing |
| Phase 2 | [phase2-contextual-signals.md](./phase2-contextual-signals.md) | Git analysis, test/doc mapping |
| Phase 3 | [phase3-ai-layer.md](./phase3-ai-layer.md) | Topic naming, explanation generation |
| Phase 4 | [phase4-wiki-generation.md](./phase4-wiki-generation.md) | Markdown output, diagrams |

---

## References

- [DeepWiki](https://deepwiki.com/) - Inspiration for topic-based documentation
- [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) - For import/export analysis
- [Mermaid.js](https://mermaid.js.org/) - For diagram generation
