# Deep Wiki Generator

A standalone CLI tool that auto-generates a comprehensive, browsable wiki for any codebase. Uses the Copilot SDK with MCP tools (grep, glob, view) to discover, analyze, and document repository structure, modules, and dependencies.

All code stays local — nothing leaves your machine.

## Installation

```bash
# From the monorepo root
npm install

# Build
cd packages/deep-wiki
npm run build
```

## Usage

### Generate Full Wiki

```bash
# Basic — runs all 5 phases (discover → consolidate → analyze → write → website)
deep-wiki generate /path/to/repo --output ./wiki

# With options
deep-wiki generate /path/to/repo \
  --output ./wiki \
  --model claude-sonnet \
  --concurrency 5 \
  --depth normal \
  --focus "src/" \
  --timeout 300 \
  --verbose

# Resume from Phase 3 (reuse cached discovery + consolidation)
deep-wiki generate /path/to/repo --output ./wiki --phase 3

# Resume from Phase 4 (reuse cached discovery + consolidation + analysis)
deep-wiki generate /path/to/repo --output ./wiki --phase 4

# Force full regeneration (ignore all caches)
deep-wiki generate /path/to/repo --output ./wiki --force
```

### Discover Component Graph Only (Phase 1)

```bash
deep-wiki discover /path/to/repo --output ./wiki --verbose
```

### Generate Options

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output <path>` | Output directory for wiki | `./wiki` |
| `-m, --model <model>` | AI model to use | SDK default |
| `-c, --concurrency <n>` | Parallel AI sessions | `5` |
| `-t, --timeout <seconds>` | Timeout per phase | 300 (5 min) |
| `--depth <level>` | Article detail: `shallow`, `normal`, `deep` | `normal` |
| `--focus <path>` | Focus on a specific subtree | Full repo |
| `--phase <n>` | Resume from phase N (1, 2, 3, or 4) | `1` |
| `--force` | Ignore all caches, regenerate everything | `false` |
| `-v, --verbose` | Verbose logging | `false` |
| `--no-color` | Disable colored output | Colors on |

### Output Structure

**Small repos** (flat layout):
```
wiki/
├── index.md              # Project overview + categorized table of contents
├── architecture.md       # High-level architecture with Mermaid diagrams
├── getting-started.md    # Prerequisites, setup, build, run instructions
├── component-graph.json     # Raw Phase 1 discovery output
└── components/
    ├── auth.md           # Per-component article
    ├── database.md
    └── ...
```

**Large repos** (3-level hierarchical layout — automatic for repos with 3000+ files):
```
wiki/
├── index.md                    # Project-level index (links to areas)
├── architecture.md             # Project-level architecture
├── getting-started.md          # Project-level getting started
├── component-graph.json           # Raw Phase 1 discovery output
├── domains/
│   ├── packages-core/
│   │   ├── index.md            # Domain index (links to its components)
│   │   ├── architecture.md     # Domain-level architecture diagram
│   │   └── components/
│   │       ├── auth.md
│   │       ├── database.md
│   │       └── ...
│   ├── packages-api/
│   │   ├── index.md
│   │   ├── architecture.md
│   │   └── components/
│   │       ├── routes.md
│   │       └── ...
│   └── ...
└── components/                    # (empty — components live under their domain)
```

The hierarchical layout activates automatically when Phase 1 discovers top-level domains (repos with 3000+ files). No additional CLI flags needed.

## Five-Phase Pipeline

### Phase 1: Discovery (~1-3 min)

A single AI session with MCP tools scans the repo and produces a `ComponentGraph` JSON:
- Project info (name, language, build system, entry points)
- Components (id, name, path, purpose, key files, dependencies, complexity, category)
- Categories and architecture notes

Large repos (3000+ files) use multi-round discovery automatically.

### Phase 2: Consolidation

Consolidates and refines the component graph from Phase 1 before analysis.

### Phase 3: Deep Analysis (~2-10 min)

Parallel AI sessions (each with read-only MCP tools) analyze every component:
- Public API, internal architecture, data flow
- Design patterns, error handling, code examples
- Internal and external dependency mapping
- Suggested Mermaid diagrams

Three depth levels control investigation thoroughness:
- **shallow** — overview + public API only (fastest)
- **normal** — 7-step investigation (default)
- **deep** — 10-step exhaustive analysis with performance and edge cases

### Phase 4: Article Generation (~2-5 min)

Parallel AI sessions (session pool, no tools needed) write markdown articles:
- **Map phase** — one article per component with cross-links between components
- **Reduce phase** — AI generates index, architecture, and getting-started pages

For large repos with domains, Phase 4 uses a 2-tier reduce:
1. **Per-domain reduce** — generates domain index + domain architecture (10-30 components per domain)
2. **Project-level reduce** — receives domain summaries → generates project index + architecture + getting-started

### Phase 5: Website

Creates optional static HTML website with navigation, themes (light/dark/auto). Use `--skip-website` to omit.

## Incremental Rebuilds

Subsequent runs are faster thanks to per-component caching:

1. Git diff detects changed files since last analysis
2. Changed files are mapped to affected components
3. Only affected components are re-analyzed (unchanged components load from cache)
4. Phase 4 always re-runs (cheap, cross-links may need updating)

Cache is stored in `<output>/.wiki-cache/`. Use `--force` to bypass. Article cache supports domain-scoped storage: `articles/{domain-id}/{component-id}.json`.

## Testing

```bash
# Run all tests
npm run test:run

# Watch mode
npm test
```

451 tests across 21 test files covering all phases: types, schemas, AI invoker, prompt generation, response parsing, map-reduce orchestration, file writing, caching (with incremental rebuild), CLI parsing, command integration, hierarchical output, domain tagging, and domain-scoped article caching.

## Architecture

```
src/
├── index.ts                # CLI entry point
├── cli.ts                  # Commander program (discover + generate)
├── types.ts                # All shared types (Phase 1+3+4)
├── schemas.ts              # JSON schemas + validation helpers
├── logger.ts               # Colored CLI output + spinner
├── ai-invoker.ts           # Analysis + writing invoker factories
├── commands/
│   ├── discover.ts         # deep-wiki discover <repo>
│   └── generate.ts         # deep-wiki generate <repo> (5-phase orchestration)
├── discovery/
│   ├── index.ts            # discoverComponentGraph()
│   ├── prompts.ts          # Discovery prompt templates
│   ├── discovery-session.ts    # SDK session orchestration
│   ├── response-parser.ts     # JSON extraction + validation
│   └── large-repo-handler.ts  # Multi-round for big repos
├── consolidation/
│   ├── index.ts            # consolidateComponents()
│   ├── consolidator.ts     # Hybrid orchestration
│   ├── rule-based-consolidator.ts
│   └── ai-consolidator.ts
├── analysis/
│   ├── index.ts            # analyzeComponents()
│   ├── prompts.ts          # Analysis prompt templates (3 depths)
│   ├── analysis-executor.ts    # MapReduceExecutor orchestration
│   └── response-parser.ts     # ComponentAnalysis JSON parsing + Mermaid validation
├── writing/
│   ├── index.ts            # generateArticles()
│   ├── prompts.ts          # Component article prompt templates
│   ├── reduce-prompts.ts   # Index/architecture/getting-started prompts
│   ├── article-executor.ts # MapReduceExecutor orchestration
│   └── file-writer.ts      # Write markdown to disk (flat + hierarchical layouts)
└── cache/
    ├── index.ts            # Cache manager (graph + consolidation + analyses + domain-scoped articles)
    └── git-utils.ts        # Git hash + change detection
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@plusplusoneplusplus/pipeline-core` | AI SDK, MapReduceExecutor, JSON extraction |
| `commander` | CLI argument parsing |
| `js-yaml` | YAML handling |
