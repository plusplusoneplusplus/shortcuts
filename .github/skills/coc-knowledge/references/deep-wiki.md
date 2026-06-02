# Deep Wiki

CLI tool that auto-generates comprehensive wikis for any codebase using a six-phase AI pipeline, with optional theme-based article generation.

Published as `@plusplusoneplusplus/deep-wiki`. Depends on `@plusplusoneplusplus/forge`, `@plusplusoneplusplus/coc-agent-sdk`, and `@plusplusoneplusplus/coc-workflow` at runtime so the bundled CLI can externalize Forge and its runtime dependency chain safely. Requires Node.js ≥ 24.

Location: `packages/deep-wiki/`

## CLI Commands

```bash
deep-wiki seeds <repo>      # Generate theme seeds (Phase 0)
deep-wiki discover <repo>   # Phase 1 only → ComponentGraph JSON
deep-wiki generate <repo>   # Full six-phase pipeline
deep-wiki theme <repo> [name]  # Cross-cutting theme articles
deep-wiki init              # Template config file
```

### Key Flags

`--output`, `--model`, `--concurrency`, `--timeout`, `--depth` (shallow/normal/deep), `--seeds` (auto or file), `--phase` (start from N), `--force`, `--use-cache`, `--skip-website`, `--no-cluster`, `--theme` (light/dark/auto)

## Six-Phase Pipeline

### Phase 0: Seeds (Optional)
- AI + MCP tools scans repo to identify key themes/domains
- Heuristic fallback: top-level directory names
- Output: `ThemeSeed[]` with theme, description, hints
- Supports JSON and CSV seed file formats

### Phase 1: Discovery
- Single AI session with MCP tools (grep, glob, view)
- Large repos (3000+ files): multi-round or iterative breadth-first using seeds
- Output: `ComponentGraph` with `ProjectInfo`, `ComponentInfo[]`, `CategoryInfo[]`, optional `DomainInfo[]`
- Intermediate results cached for crash recovery

### Phase 2: Consolidation
- Rule-based: merges components in same directory
- AI-assisted: semantic grouping of related components
- Skip with `--no-cluster`

### Phase 3: Analysis
- Per-component deep analysis with MCP tools and concurrency control
- Incremental: only re-analyzes components whose files changed (git-hash caching)
- Output: `ComponentAnalysis[]` with API surface, patterns, integration points

### Phase 4: Writing
- Per-component article generation from analysis
- Reduce/synthesis for overview and cross-cutting articles
- File writer outputs markdown organized by domain/category

### Phase 5: Website
- Static HTML with navigation, themes (light/dark/auto)
- Mermaid diagram zoom/pan support
- Customizable CSS and client-side JavaScript

## Core Concepts

| Concept | Level | Description |
|---------|-------|-------------|
| **Component** | Smallest unit | A code directory/unit with specific purpose. Always present. |
| **Domain** | Structural grouping | Top-level directory regions. Only for large repos (3000+ files). |
| **Theme** | Cross-cutting | User-defined concerns spanning multiple components. |

### Hierarchy

```
ComponentGraph
├── components: ComponentInfo[]        ← always present
│   └── domain?: string                ← links to domain (large repos)
├── domains?: DomainInfo[]             ← large repos only
│   └── components: string[]           ← IDs in this domain
└── themes?: ThemeAreaMeta[]           ← user-created themes
    └── involvedComponentIds: string[] ← components involved
```

## Theme Pipeline

`deep-wiki theme` runs: Probe → Outline → Analysis → Articles → File Writing & Wiki Integration → optional Website Regeneration.

Modules in `src/theme/`:
- `coverage-checker.ts` — loads `module-graph.json`, identifies gaps
- `theme-probe.ts` — single-theme probe using iterative discovery
- `outline-generator.ts` — structured outline (sub-articles list)
- `theme-analysis.ts` — cross-cutting concern analysis
- `article-generator.ts` — individual article generation
- `file-writer.ts` — writes to wiki output directory
- `wiki-integrator.ts` — updates `module-graph.json`, adds cross-links

## Caching

- Git HEAD hash-based invalidation
- Per-phase: seeds, discovery, consolidation, analysis, articles
- Shared cache utilities: atomic writes (temp + rename), generic read with validation, batch scan
- Incremental re-analysis: only changed components
- `--force` bypasses all; `--use-cache` ignores hash; `--phase N` skips earlier phases

## Key Types

```typescript
interface ComponentGraph {
    project: ProjectInfo;
    components: ComponentInfo[];
    categories: CategoryInfo[];
    domains?: DomainInfo[];
    themes?: ThemeAreaMeta[];
}

interface ComponentInfo {
    id: string;           // kebab-case
    name: string;
    path: string;         // relative to repo root
    purpose: string;
    keyFiles: string[];
    dependencies: string[];
    complexity: 'low' | 'medium' | 'high';
    category: string;
    domain?: string;      // large repos only
}

interface ComponentAnalysis {
    componentId: string;
    summary: string;
    publicAPI: APIEntry[];
    internalPatterns: string[];
    integrationPoints: IntegrationPoint[];
    gotchas: string[];
}
```

## Package Structure

```
packages/deep-wiki/
├── src/
│   ├── index.ts, cli.ts, types.ts, schemas.ts
│   ├── ai-invoker.ts, logger.ts, usage-tracker.ts, config-loader.ts
│   ├── commands/       # CLI commands + phase runners
│   ├── seeds/          # Theme seed generation
│   ├── discovery/      # Component graph discovery
│   ├── consolidation/  # Component merging
│   ├── analysis/       # Per-component analysis
│   ├── writing/        # Article generation + website
│   ├── theme/          # Cross-cutting theme articles
│   ├── utils/          # Error handling, git, AI parsing
│   ├── rendering/      # Mermaid zoom/pan
│   └── cache/          # Per-phase caching
└── test/               # 64 Vitest test files
```

## Testing

64 Vitest test files covering all phases, theme module, cache, commands, rendering. Run with `npm run test:run` in `packages/deep-wiki/`.
