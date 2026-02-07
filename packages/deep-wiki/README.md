# Deep Wiki Generator

A standalone CLI tool that auto-generates a comprehensive module graph for any codebase. Uses the Copilot SDK with read-only MCP tools (grep, glob, view) to analyze repository structure, modules, and dependencies.

> **Status:** Phase 1 (Discovery) is implemented. Phase 2 (Analysis) and Phase 3 (Writing) are planned for future milestones.

## Installation

```bash
# From the monorepo root
npm install

# Build
cd packages/deep-wiki
npm run build
```

## Usage

### Discover Module Graph (Phase 1)

```bash
# Basic usage
deep-wiki discover /path/to/repo

# With options
deep-wiki discover /path/to/repo \
  --output ./wiki \
  --model claude-sonnet \
  --focus "src/" \
  --timeout 300 \
  --verbose \
  --force
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output <path>` | Output directory for results | `./wiki` |
| `-m, --model <model>` | AI model to use | SDK default |
| `-t, --timeout <seconds>` | Timeout for discovery session | 300 (5 min) |
| `--focus <path>` | Focus on a specific subtree | Full repo |
| `--force` | Ignore cache, regenerate | `false` |
| `-v, --verbose` | Verbose logging | `false` |
| `--no-color` | Disable colored output | Colors on |

### Output

The `discover` command produces a `module-graph.json` file containing:

- **Project info** — name, language, build system, entry points
- **Modules** — id, name, path, purpose, key files, dependencies, complexity, category
- **Categories** — groupings for modules
- **Architecture notes** — high-level architecture summary

JSON is also written to stdout for piping.

### Caching

Discovery results are cached in `<output>/.wiki-cache/module-graph.json` with the git HEAD hash. Subsequent runs skip discovery if the hash matches. Use `--force` to bypass.

### Large Repos

Repos with 3000+ files automatically use multi-round discovery:
1. Structural scan — identifies top-level areas
2. Per-area drill-down — focused discovery for each area
3. Merge — combines sub-graphs into a unified ModuleGraph

## Testing

```bash
# Run all tests
npm run test:run

# Watch mode
npm test
```

156 tests across 8 test files covering types, schemas, response parsing, prompt generation, large repo handling, caching, CLI parsing, and command integration.

## Architecture

```
src/
├── index.ts              # CLI entry point
├── cli.ts                # Commander program
├── types.ts              # All shared types
├── schemas.ts            # JSON schemas + validation helpers
├── logger.ts             # Colored CLI output + spinner
├── commands/
│   ├── discover.ts       # deep-wiki discover <repo>
│   └── generate.ts       # Stub for Phase 2+3
├── discovery/
│   ├── index.ts          # discoverModuleGraph() public API
│   ├── prompts.ts        # AI prompt templates
│   ├── discovery-session.ts  # SDK session orchestration
│   ├── response-parser.ts    # JSON extraction + validation
│   └── large-repo-handler.ts # Multi-round for big repos
└── cache/
    ├── index.ts          # Cache manager
    └── git-utils.ts      # Git hash utilities
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@plusplusoneplusplus/pipeline-core` | AI SDK, JSON extraction |
| `commander` | CLI argument parsing |
| `js-yaml` | YAML handling (future config) |
