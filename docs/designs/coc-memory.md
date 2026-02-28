# CoC Memory System Design

## Overview

Add a two-level memory system to CoC that enables AI pipelines to learn from past executions. Memory is captured asynchronously during pipeline runs and consolidated in the background, providing persistent context across sessions.

### Design Principles

- **Non-blocking hot path** — live pipeline execution only writes raw observations, never waits for aggregation
- **Opt-in per pipeline** — pipelines declare `memory: true` in YAML; no memory overhead for pipelines that don't need it
- **Two isolation levels** — repo-level (project-specific) and system-level (cross-project) memory
- **Batched aggregation** — AI consolidation runs only when enough raw observations accumulate, amortizing cost

## Storage Layout

All memory lives under `~/.coc/memory/`. Repo-level memory is keyed by a stable hash of the repo root path (falling back to git remote URL when available).

```
~/.coc/memory/
  system/                                   # System-level (cross-repo)
    raw/                                    # Append-only observations
      <timestamp>-<pipeline-id>.md
    consolidated.md                         # AI-aggregated knowledge
    index.json                              # Lightweight metadata index
  repos/<repo-hash>/                        # Repo-level (per-project)
    raw/
      <timestamp>-<pipeline-id>.md
    consolidated.md
    index.json
    repo-info.json                          # { path, name, remoteUrl, lastAccessed }
```

### File Formats

**Raw observation** (`raw/*.md`):

```markdown
---
pipeline: code-review
timestamp: 2026-02-28T15:00:00Z
repo: github/shortcuts
model: gpt-4
---

- This repo uses Vitest for package tests and Mocha for extension tests
- The team prefers kebab-case file naming
- AGENTS.md files provide important context per directory
```

**Consolidated memory** (`consolidated.md`):

```markdown
# Memory — github/shortcuts

## Conventions
- Kebab-case file naming throughout
- Vitest for packages, Mocha for VS Code extension tests
- AGENTS.md files in key directories document per-folder guidance

## Architecture
- Monorepo: VS Code extension in src/, packages in packages/
- pipeline-core has no VS Code dependencies
- Atomic file writes via tmp-then-rename pattern

## Gotchas
- Extension tests require VS Code test runner, not plain Vitest
- Map-reduce batch mode needs {{ITEMS}} placeholder in prompt
```

**Index** (`index.json`):

```json
{
  "lastAggregation": "2026-02-28T16:00:00Z",
  "rawCount": 0,
  "factCount": 15,
  "categories": ["conventions", "architecture", "gotchas", "tools", "patterns"]
}
```

## Three Execution Paths

### 1. Retrieve (Pre-Run)

When a pipeline has `memory.retrieve: true`, before the first AI call:

1. Load `consolidated.md` from repo-level memory (if exists)
2. Load `consolidated.md` from system-level memory (if exists)
3. Format as a context block and prepend to the AI prompt

```
## Context from Memory

### Project-Specific
{repo consolidated.md}

### General Knowledge
{system consolidated.md}
```

**Retrieval strategy (v1):** Full dump of consolidated memory. The aggregation step keeps memory concise enough (<100 facts) that this is practical. Future versions can add keyword/TF-IDF/embedding-based selective retrieval.

### 2. Capture (Post-AI-Call)

After each AI call in a memory-enabled pipeline, issue a lightweight follow-up prompt:

```
Given the task you just completed and the context you operated in, list 2-5 concise 
facts worth remembering for future tasks on this codebase. Focus on:
- Coding conventions and patterns
- Architecture decisions and structure
- Common gotchas or pitfalls
- Tool/library usage patterns

Output as a markdown bullet list. If nothing notable, output "No new observations."
```

The response is written as a raw observation file with metadata header. This is a fast, small AI call (short prompt, short output).

**Classification:** Each observation is tagged as repo-level or system-level based on a simple heuristic — facts referencing specific files, directories, or project names → repo; facts about general patterns, user preferences, or tool behavior → system. The capture prompt can include guidance for this, or it can be determined during aggregation.

### 3. Aggregate (Background, Batched)

After each pipeline run completes:

```
count = number of raw/*.md files since last aggregation
if count >= BATCH_THRESHOLD (default: 5):
    spawn background aggregation
else:
    skip (accumulate more raw observations)
```

**Aggregation process:**

1. Read existing `consolidated.md` (if any)
2. Read all unprocessed `raw/*.md` files
3. Issue AI consolidation call:

```
## Existing Memory
{consolidated.md contents, or "No existing memory" if first run}

## New Observations ({count} sessions)
{concatenated raw/*.md files}

Produce an updated memory document following these rules:
- Deduplicate: merge similar or redundant facts
- Resolve conflicts: newer observations override older ones
- Prune: drop facts that appear no longer relevant
- Categorize: group by topic (conventions, architecture, patterns, tools, gotchas)
- Keep it concise: target <100 facts total
- Use markdown with clear section headers
```

4. Atomic write new `consolidated.md` (tmp → rename)
5. Update `index.json` with new metadata
6. Archive or delete processed raw files

**Aggregation runs at both levels independently** — repo-level raw files consolidate into repo-level memory, system-level into system-level.

## Pipeline YAML Integration

### Simple opt-in

```yaml
name: code-review
memory: true    # enables both retrieve and capture at both levels
model: gpt-4
```

### Granular control

```yaml
name: code-review
memory:
  retrieve: true      # inject memory into prompts
  capture: true       # record observations from this run
  level: both         # repo | system | both (default: both)
model: gpt-4
```

### Memory in map-reduce pipelines

For map-reduce pipelines, memory retrieval happens once (before the map phase), not per-item. Observation capture happens once after the reduce phase completes. This keeps costs bounded regardless of input size.

## CLI Commands

```bash
# Show current memory
coc memory show                    # show both levels
coc memory show --repo             # repo-level only
coc memory show --system           # system-level only

# Force aggregation (don't wait for batch threshold)
coc memory aggregate               # aggregate both levels
coc memory aggregate --repo        # repo-level only

# Clear memory
coc memory clear                   # clear both levels
coc memory clear --system          # system-level only
coc memory clear --raw             # clear raw only, keep consolidated

# Add a fact manually
coc memory add "always use gpt-4 for code review"           # system-level
coc memory add --repo "tests require Node 20+"              # repo-level
```

## Implementation Modules

| Module | Package | Responsibility |
|--------|---------|---------------|
| `MemoryStore` | `pipeline-core` | CRUD for raw + consolidated files, atomic writes, repo hashing, path resolution |
| `MemoryCapture` | `pipeline-core` | Post-AI-call "what did you learn?" prompt generation, raw file writing |
| `MemoryRetriever` | `pipeline-core` | Load consolidated memory, format for prompt injection |
| `MemoryAggregator` | `pipeline-core` | Batch threshold check, AI consolidation prompt, prune/archive raw files |
| `PipelineConfig.memory` | `pipeline-core` | Schema addition for `memory` field in pipeline YAML |
| `executePipeline` hooks | `pipeline-core` | Wire retrieve (pre-run) and capture (post-call) into execution flow |
| `coc memory` command | `coc` | CLI subcommands for show/aggregate/clear/add |
| Background aggregation | `coc-server` | Timer-based aggregation when running `coc serve` |

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                      coc run                            │
│                                                         │
│  ┌───────────┐    ┌────────────┐    ┌───────────────┐   │
│  │ Retrieve  │───▶│  Execute   │───▶│   Capture     │   │
│  │  Memory   │    │  Pipeline  │    │ Observations  │   │
│  └───────────┘    └────────────┘    └───────┬───────┘   │
│       ▲                                     │           │
│       │              ┌──────────────────┐   │           │
│       │              │ Batch threshold  │   │           │
│       │              │  check (≥5?)     │◀──┘           │
│       │              └────────┬─────────┘               │
│       │                  yes  │  no                     │
│       │                  ▼    ▼                         │
│  ┌────┴───────┐   ┌──────────────┐  ┌──────────────┐   │
│  │consolidated│◀──│  Aggregate   │  │  raw/*.md    │   │
│  │   .md      │   │ (background) │  │ (accumulate) │   │
│  └────────────┘   └──────────────┘  └──────────────┘   │
│                                                         │
│  Memory levels: ~/.coc/memory/system/                   │
│                 ~/.coc/memory/repos/<hash>/              │
└─────────────────────────────────────────────────────────┘
```

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Memory location | `~/.coc/memory/` (not in repo) | Avoids polluting repos; consistent with existing `~/.coc/` patterns |
| Aggregation trigger | Post-run, batched (threshold ≥ 5) | Balances freshness vs. AI call cost |
| Pipeline opt-in | `memory: true` in YAML | Zero overhead for pipelines that don't need memory |
| Observation extraction | AI self-reports via follow-up prompt | Higher quality than regex; lightweight single-turn call |
| Retrieval strategy (v1) | Full dump of consolidated.md | Simple, effective for <100 facts; upgrade path to selective retrieval |
| Write pattern | Atomic tmp → rename | Consistent with FileProcessStore and deep-wiki cache patterns |
| Repo identity | Hash of repo root path | Simple, local-only; git remote URL as secondary signal |

## Future Extensions

- **Selective retrieval** — TF-IDF or embedding-based retrieval from memory based on current pipeline context
- **Memory decay** — facts accessed less frequently get lower priority; eventually pruned
- **Memory sharing** — export/import repo memory for team sharing
- **Memory UI** — visual memory browser in `coc serve` dashboard
- **Cross-pipeline memory** — pipeline A's observations available to pipeline B within same run
- **Structured memory** — JSON-based fact store alongside markdown for programmatic querying
