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
# Basic — runs all 3 phases (discover → analyze → write)
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

# Resume from Phase 2 (reuse cached discovery)
deep-wiki generate /path/to/repo --output ./wiki --phase 2

# Resume from Phase 3 (reuse cached discovery + analysis)
deep-wiki generate /path/to/repo --output ./wiki --phase 3

# Force full regeneration (ignore all caches)
deep-wiki generate /path/to/repo --output ./wiki --force
```

### Discover Module Graph Only (Phase 1)

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
| `--phase <n>` | Resume from phase N (1, 2, or 3) | `1` |
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
├── module-graph.json     # Raw Phase 1 discovery output
└── modules/
    ├── auth.md           # Per-module article
    ├── database.md
    └── ...
```

**Large repos** (3-level hierarchical layout — automatic for repos with 3000+ files):
```
wiki/
├── index.md                    # Project-level index (links to areas)
├── architecture.md             # Project-level architecture
├── getting-started.md          # Project-level getting started
├── module-graph.json           # Raw Phase 1 discovery output
├── areas/
│   ├── packages-core/
│   │   ├── index.md            # Area index (links to its modules)
│   │   ├── architecture.md     # Area-level architecture diagram
│   │   └── modules/
│   │       ├── auth.md
│   │       ├── database.md
│   │       └── ...
│   ├── packages-api/
│   │   ├── index.md
│   │   ├── architecture.md
│   │   └── modules/
│   │       ├── routes.md
│   │       └── ...
│   └── ...
└── modules/                    # (empty — modules live under their area)
```

The hierarchical layout activates automatically when Phase 1 discovers top-level areas (repos with 3000+ files). No additional CLI flags needed.

## Three-Phase Pipeline

### Phase 1: Discovery (~1-3 min)

A single AI session with MCP tools scans the repo and produces a `ModuleGraph` JSON:
- Project info (name, language, build system, entry points)
- Modules (id, name, path, purpose, key files, dependencies, complexity, category)
- Categories and architecture notes

Large repos (3000+ files) use multi-round discovery automatically.

### Phase 2: Deep Analysis (~2-10 min)

Parallel AI sessions (each with read-only MCP tools) analyze every module:
- Public API, internal architecture, data flow
- Design patterns, error handling, code examples
- Internal and external dependency mapping
- Suggested Mermaid diagrams

Three depth levels control investigation thoroughness:
- **shallow** — overview + public API only (fastest)
- **normal** — 7-step investigation (default)
- **deep** — 10-step exhaustive analysis with performance and edge cases

### Phase 3: Article Generation (~2-5 min)

Parallel AI sessions (session pool, no tools needed) write markdown articles:
- **Map phase** — one article per module with cross-links between modules
- **Reduce phase** — AI generates index, architecture, and getting-started pages

For large repos with areas, Phase 3 uses a 2-tier reduce:
1. **Per-area reduce** — generates area index + area architecture (10-30 modules per area)
2. **Project-level reduce** — receives area summaries → generates project index + architecture + getting-started

## Incremental Rebuilds

Subsequent runs are faster thanks to per-module caching:

1. Git diff detects changed files since last analysis
2. Changed files are mapped to affected modules
3. Only affected modules are re-analyzed (unchanged modules load from cache)
4. Phase 3 always re-runs (cheap, cross-links may need updating)

Cache is stored in `<output>/.wiki-cache/`. Use `--force` to bypass. Article cache supports area-scoped storage: `articles/{area-id}/{module-id}.json`.

## Testing

```bash
# Run all tests
npm run test:run

# Watch mode
npm test
```

451 tests across 21 test files covering all three phases: types, schemas, AI invoker, prompt generation, response parsing, map-reduce orchestration, file writing, caching (with incremental rebuild), CLI parsing, command integration, hierarchical output, area tagging, and area-scoped article caching.

## Architecture

```
src/
├── index.ts                # CLI entry point
├── cli.ts                  # Commander program (discover + generate)
├── types.ts                # All shared types (Phase 1+2+3)
├── schemas.ts              # JSON schemas + validation helpers
├── logger.ts               # Colored CLI output + spinner
├── ai-invoker.ts           # Analysis + writing invoker factories
├── commands/
│   ├── discover.ts         # deep-wiki discover <repo>
│   └── generate.ts         # deep-wiki generate <repo> (3-phase orchestration)
├── discovery/
│   ├── index.ts            # discoverModuleGraph()
│   ├── prompts.ts          # Discovery prompt templates
│   ├── discovery-session.ts    # SDK session orchestration
│   ├── response-parser.ts     # JSON extraction + validation
│   └── large-repo-handler.ts  # Multi-round for big repos
├── analysis/
│   ├── index.ts            # analyzeModules()
│   ├── prompts.ts          # Analysis prompt templates (3 depths)
│   ├── analysis-executor.ts    # MapReduceExecutor orchestration
│   └── response-parser.ts     # ModuleAnalysis JSON parsing + Mermaid validation
├── writing/
│   ├── index.ts            # generateArticles()
│   ├── prompts.ts          # Module article prompt templates
│   ├── reduce-prompts.ts   # Index/architecture/getting-started prompts
│   ├── article-executor.ts # MapReduceExecutor orchestration
│   └── file-writer.ts      # Write markdown to disk (flat + hierarchical layouts)
└── cache/
    ├── index.ts            # Cache manager (graph + analyses + area-scoped articles)
    └── git-utils.ts        # Git hash + change detection
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@plusplusoneplusplus/pipeline-core` | AI SDK, MapReduceExecutor, JSON extraction |
| `commander` | CLI argument parsing |
| `js-yaml` | YAML handling |
