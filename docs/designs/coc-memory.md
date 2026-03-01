# CoC Memory System Design

## Overview

A two-level memory system for CoC that enables all AI interactions — pipelines, server conversations, task execution — to learn from past sessions. Memory is captured after AI calls, persisted as raw observations, and periodically consolidated into a concise knowledge base. Every AI call site in CoC can opt in to memory through a shared middleware layer.

### Design Principles

- **Non-blocking hot path** — AI calls only write raw observations; aggregation happens asynchronously
- **Cross-cutting via middleware** — memory integrates at the AI invoker layer, not per-feature
- **Two isolation levels** — repo-level (project-specific) and system-level (cross-project) memory
- **Batched aggregation** — AI consolidation runs only when enough raw observations accumulate, amortizing cost
- **Global + per-pipeline control** — `~/.coc/config.yaml` for system-wide defaults; `memory:` in pipeline YAML for per-pipeline overrides

## Storage Layout

All memory lives under `~/.coc/memory/`. Repo-level memory is keyed by a stable SHA-256 hash (16-char hex prefix) of the resolved repo root path. Git remote URL is stored in `repo-info.json` as a secondary signal.

```
~/.coc/memory/
  system/                                   # System-level (cross-repo)
    raw/                                    # Append-only observations
      <timestamp>-<source-id>.md
    consolidated.md                         # AI-aggregated knowledge
    index.json                              # Lightweight metadata index
  repos/<repo-hash>/                        # Repo-level (per-project)
    raw/
      <timestamp>-<source-id>.md
    consolidated.md
    index.json
    repo-info.json                          # { path, name, remoteUrl, lastAccessed }
```

`<source-id>` identifies the origin of the observation: a pipeline name (e.g. `code-review`), a server feature (e.g. `wiki-ask`, `task-resolve`), or `manual` for user-added facts.

### File Formats

**Raw observation** (`raw/*.md`):

```markdown
---
source: code-review
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

### 1. Retrieve (Pre-Call)

Before an AI call, the memory middleware:

1. Loads `consolidated.md` from repo-level memory (if a repo context is available)
2. Loads `consolidated.md` from system-level memory
3. Formats as a context block and prepends to the AI prompt

```
## Context from Memory

### Project-Specific
{repo consolidated.md}

### General Knowledge
{system consolidated.md}
```

**Retrieval strategy (v1):** Full dump of consolidated memory. The aggregation step keeps memory concise enough (<100 facts) that this is practical. Future versions can add keyword/TF-IDF/embedding-based selective retrieval.

### 2. Capture (Post-Call)

After an AI call, the memory middleware issues a lightweight follow-up prompt:

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

After each AI interaction completes:

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

## Memory Middleware

The core integration mechanism. `MemoryMiddleware` wraps any `AIInvoker` function with retrieve-before and capture-after logic, making memory available to all AI call sites without modifying each one.

```typescript
function createMemoryAwareInvoker(
  innerInvoker: AIInvoker,
  options: MemoryMiddlewareOptions
): AIInvoker
```

### How it works

```
Caller → memoryAwareInvoker(prompt, opts)
           │
           ├─ 1. Retrieve: load consolidated memory, prepend to prompt
           ├─ 2. Invoke: call innerInvoker(enrichedPrompt, opts)
           ├─ 3. Capture: issue follow-up prompt, write raw observation
           └─ 4. Aggregate check: if raw count ≥ threshold, trigger background aggregation
           │
           └─ Return original result (unchanged)
```

### Where it's wired in

Every AI call in CoC flows through `createCLIAIInvoker()` in `packages/coc/src/ai-invoker.ts`. This is the single integration point:

```typescript
// In createCLIAIInvoker():
let invoker = buildBaseInvoker(sdkService, options);
if (memoryConfig.enabled) {
  invoker = createMemoryAwareInvoker(invoker, {
    store: memoryStore,
    retriever: memoryRetriever,
    capturer: memoryCapturer,
    repoHash: resolvedRepoHash,
    level: memoryConfig.level,
  });
}
return invoker;
```

This gives memory to **all** call sites that use the shared invoker:

| Call Site | Package | Notes |
|-----------|---------|-------|
| Pipeline map/reduce/filter phases | `pipeline-core` | Via `executePipeline({ aiInvoker })` |
| Pipeline job mode | `pipeline-core` | Single AI call |
| Workflow AI/map/reduce/filter/load nodes | `pipeline-core` | DAG-based execution |
| Map-reduce jobs (code-review, prompt-map, template) | `pipeline-core` | All job types |
| Task comment resolution | `coc-server` | AI-powered comment resolve |
| Queue executor (chat, custom, follow-prompt, task-gen) | `coc-server` | Various task types |

### Call sites with their own AI path

These features use their own `sendMessage` path (not `createCLIAIInvoker`) and need separate integration:

| Call Site | Package | Integration Approach |
|-----------|---------|---------------------|
| Wiki Ask Q&A | `coc-server` | Inject memory context into ContextBuilder alongside TF-IDF results |
| Wiki Explore | `coc-server` | Inject memory context into exploration prompt |
| Conversation sessions | `coc-server` | Capture observations when session ends or every N turns |

## Repo Context Detection

For memory to work CoC-wide, the system must automatically detect which repository the user is working in. This determines which repo-level memory to load.

**Detection strategy (ordered by priority):**

1. **Explicit `--repo` flag** on CLI commands
2. **Pipeline working directory** — if set in pipeline YAML or CLI
3. **`git rev-parse --show-toplevel`** from the current working directory
4. **Walk up from cwd** looking for `.git/` directory (fallback if git not available)
5. **No repo context** — use system-level memory only

**Repo info enrichment:** On first access to a repo's memory, populate `repo-info.json`:
- `path`: resolved repo root path
- `name`: directory name (e.g. `shortcuts`)
- `remoteUrl`: output of `git remote get-url origin` (if available)
- `lastAccessed`: updated on every memory read/write

## Global Configuration

Memory is configured system-wide in `~/.coc/config.yaml` and can be overridden per-pipeline or per-command.

```yaml
# ~/.coc/config.yaml
memory:
  enabled: true               # master switch (default: false)
  level: both                 # repo | system | both (default: both)
  capture: true               # capture observations (default: true when enabled)
  retrieve: true              # inject memory into prompts (default: true when enabled)
  batchThreshold: 5           # raw observations before aggregation (default: 5)
```

### Pipeline YAML Override

Pipelines can override global config or opt in even when memory is globally disabled:

```yaml
# Simple opt-in (overrides global config)
name: code-review
memory: true
model: gpt-4
```

```yaml
# Granular control
name: code-review
memory:
  retrieve: true
  capture: true
  level: both
model: gpt-4
```

### CLI Flag Override

```bash
coc run pipeline.yaml --no-memory    # disable memory for this run
coc run pipeline.yaml --memory       # enable memory for this run (even if globally off)
```

### Precedence

CLI flag > pipeline YAML `memory:` > `~/.coc/config.yaml` `memory:` > defaults (disabled)

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

## Server Integration

When running `coc serve`, memory enhances the dashboard and wiki features.

### Background Aggregation

The server runs a timer-based aggregation check (e.g. every 60 seconds) that consolidates raw observations across all levels. This ensures memory stays fresh without requiring explicit `coc memory aggregate` calls.

### Wiki Context Enhancement

Wiki Ask and Explore handlers currently inject TF-IDF component context. Memory adds a complementary layer:

```
ContextBuilder output (TF-IDF components + graph)
  + Memory context (repo consolidated.md, if wiki maps to a repo)
  + Memory context (system consolidated.md)
  = Full context for AI prompt
```

### Memory API Endpoints

REST endpoints for the dashboard UI to interact with memory:

```
GET    /api/memory                    # stats for all levels
GET    /api/memory/system             # system-level consolidated + stats
GET    /api/memory/repos              # list all repos with memory
GET    /api/memory/repos/:hash        # repo-level consolidated + stats + info
DELETE /api/memory                    # clear all memory
DELETE /api/memory/system             # clear system-level
DELETE /api/memory/repos/:hash        # clear specific repo
POST   /api/memory/aggregate          # force aggregation
POST   /api/memory/add                # add a fact manually
```

## Implementation Modules

| Module | Package | Responsibility |
|--------|---------|---------------|
| `MemoryStore` | `pipeline-core` | CRUD for raw + consolidated files, atomic writes, repo hashing, path resolution. Import via `@plusplusoneplusplus/pipeline-core/memory` |
| `MemoryRetriever` | `pipeline-core` | Load consolidated memory, format as prompt context block |
| `MemoryCapture` | `pipeline-core` | Post-AI-call observation extraction prompt, raw file writing |
| `MemoryAggregator` | `pipeline-core` | Batch threshold check, AI consolidation prompt, prune/archive raw files |
| `MemoryMiddleware` | `pipeline-core` | Wraps any `AIInvoker` with retrieve + capture + aggregate-check |
| `PipelineConfig.memory` | `pipeline-core` | Schema addition for `memory` field in pipeline YAML |
| `executePipeline` hooks | `pipeline-core` | Wire memory middleware into pipeline execution flow |
| Repo context detection | `pipeline-core` | Auto-detect repo root from working directory via git or `.git/` walk |
| Global memory config | `coc` | `memory:` section in `~/.coc/config.yaml`, `--memory`/`--no-memory` CLI flags |
| AI invoker integration | `coc` | Wire `createMemoryAwareInvoker` into `createCLIAIInvoker()` |
| `coc memory` command | `coc` | CLI subcommands for show/aggregate/clear/add |
| Wiki memory context | `coc-server` | Inject memory into wiki Ask/Explore handlers alongside TF-IDF context |
| Memory API endpoints | `coc-server` | REST endpoints for dashboard memory management |
| Background aggregation | `coc-server` | Timer-based aggregation when running `coc serve` |

## Implementation Status

| Module | Status | Notes |
|--------|--------|-------|
| `MemoryStore` | ✅ Done | `pipeline-core/src/memory/` — FileMemoryStore with raw CRUD, consolidated r/w, index, repo-info, clear, stats. Exported via `@plusplusoneplusplus/pipeline-core/memory` |
| `MemoryRetriever` | ⬚ Not started | |
| `MemoryCapture` | ⬚ Not started | |
| `MemoryAggregator` | ⬚ Not started | |
| `MemoryMiddleware` | ⬚ Not started | |
| `PipelineConfig.memory` | ⬚ Not started | |
| `executePipeline` hooks | ⬚ Not started | |
| Repo context detection | ⬚ Not started | |
| Global memory config | ⬚ Not started | |
| AI invoker integration | ⬚ Not started | |
| `coc memory` command | ⬚ Not started | |
| Wiki memory context | ⬚ Not started | |
| Memory API endpoints | ⬚ Not started | |
| Background aggregation | ⬚ Not started | |

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                         CoC Memory System                            │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │                    AI Invoker Layer                          │     │
│  │                                                             │     │
│  │  createCLIAIInvoker()                                       │     │
│  │    └─ createMemoryAwareInvoker(innerInvoker, memoryOpts)    │     │
│  │         ├─ retrieve: prepend consolidated memory to prompt  │     │
│  │         ├─ invoke: call inner AI invoker                    │     │
│  │         ├─ capture: extract observations → raw/*.md         │     │
│  │         └─ check: raw count ≥ threshold? → aggregate        │     │
│  └─────────────────────────┬───────────────────────────────────┘     │
│                            │ used by                                 │
│            ┌───────────────┼───────────────────┐                     │
│            ▼               ▼                   ▼                     │
│     ┌────────────┐  ┌────────────┐  ┌───────────────────┐           │
│     │  coc run   │  │ coc serve  │  │  coc-server tasks │           │
│     │ (pipeline) │  │  (wiki AI) │  │ (chat, comments)  │           │
│     └────────────┘  └────────────┘  └───────────────────┘           │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │                    Storage Layer                             │     │
│  │                                                             │     │
│  │  ~/.coc/memory/                                             │     │
│  │    system/                    repos/<hash>/                  │     │
│  │      raw/*.md                   raw/*.md                    │     │
│  │      consolidated.md            consolidated.md             │     │
│  │      index.json                 index.json                  │     │
│  │                                 repo-info.json              │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │                   Config Precedence                          │     │
│  │                                                             │     │
│  │  CLI flag (--memory/--no-memory)                            │     │
│  │    > pipeline YAML (memory: true)                           │     │
│  │      > ~/.coc/config.yaml (memory.enabled)                  │     │
│  │        > default (disabled)                                 │     │
│  └─────────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────┘
```

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Memory location | `~/.coc/memory/` (not in repo) | Avoids polluting repos; consistent with existing `~/.coc/` patterns |
| Integration point | AI invoker middleware | Single integration point gives memory to all call sites; no per-feature wiring |
| Aggregation trigger | Post-call batched (threshold ≥ 5) | Balances freshness vs. AI call cost |
| Global default | Disabled | Safe default; users opt in via config or pipeline YAML |
| Observation extraction | AI self-reports via follow-up prompt | Higher quality than regex; lightweight single-turn call |
| Retrieval strategy (v1) | Full dump of consolidated.md | Simple, effective for <100 facts; upgrade path to selective retrieval |
| Write pattern | Atomic tmp → rename | Consistent with FileProcessStore and deep-wiki cache patterns |
| Repo identity | SHA-256 hash of resolved repo root path | Simple, local-only; git remote URL stored as secondary signal in repo-info.json |
| Config precedence | CLI > pipeline YAML > global config > default | Standard override chain; most specific wins |
| Source tracking | `source` field in raw observation metadata | Distinguishes pipeline observations from wiki/task/manual observations |

## Future Extensions

- **Selective retrieval** — TF-IDF or embedding-based retrieval from memory based on current prompt context
- **Memory decay** — facts accessed less frequently get lower priority; eventually pruned
- **Memory sharing** — export/import repo memory for team sharing
- **Memory UI** — visual memory browser in `coc serve` dashboard
- **Cross-pipeline memory** — pipeline A's observations available to pipeline B within same run
- **Structured memory** — JSON-based fact store alongside markdown for programmatic querying
- **Conversation-scoped capture** — capture observations per N turns in long server conversations, not just at session end
