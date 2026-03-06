---
status: pending
---

# 005: Update AGENTS.md for Memory Module

## Summary

Update existing AGENTS.md files to document the new `packages/pipeline-core/src/memory/` module, and create a new AGENTS.md inside the memory module directory. This makes the memory subsystem discoverable by AI agents.

## Motivation

AGENTS.md files are the primary documentation for AI agents working in this repository. Commits 001–004 added a complete memory module (`types.ts`, `memory-store.ts`, `memory-capture.ts`, `memory-integration.ts`) with tests, but none of the AGENTS.md files reference it yet. Without documentation, agents won't know the module exists or how to use it.

## Changes

### Files to Create

- **`packages/pipeline-core/src/memory/AGENTS.md`** — New AGENTS.md for the memory module.

### Files to Modify

- **`AGENTS.md`** (root) — Add memory to the pipeline-core key modules list.
- **`packages/pipeline-core/AGENTS.md`** — Add memory module to the package structure tree and add a new "Memory" section under Key Modules.

### Files to Delete

- none

## Implementation Notes

### 1. New file: `packages/pipeline-core/src/memory/AGENTS.md`

Create a concise AGENTS.md following the style of other module-level docs:

```markdown
# Memory Module

Two-level observation memory for CoC pipelines. Captures facts and observations from AI interactions and persists them for future pipeline runs.

## Storage Layout

- **System memory:** `~/.coc/memory/system/` — cross-repo observations
- **Repo memory:** `~/.coc/memory/repos/<hash>/` — per-repository observations (hash = first 12 chars of SHA-256 of repo root path)

## Key Files

| File | Purpose |
|------|---------|
| `types.ts` | `MemoryLevel`, `MemoryConfig`, `RawObservation`, `MemoryIndex`, `RepoInfo` |
| `memory-store.ts` | `MemoryStore` — file-based storage with atomic writes, serialized write queue, `generateRawFilename()` |
| `memory-capture.ts` | `captureObservations`, `classifyFact`, `parseCaptureFacts`, `formatRawObservation` |
| `memory-integration.ts` | `normalizeMemoryConfig`, `createMemoryLifecycle` (wraps AIInvoker with phase-aware capture) |
| `index.ts` | Barrel exports |

## How Memory Is Enabled

In pipeline YAML:
```yaml
memory: true          # enable with defaults
memory:
  retrieve: true      # inject memory into prompts
  capture: true       # record observations from this run
  level: repo         # or 'system' or 'both'
```

The pipeline executor (`pipeline/executor.ts`) validates and wires memory when the `memory` field is present in `PipelineConfig`.

## Patterns

- **Atomic writes:** temp file + rename (same as `FileProcessStore`)
- **Serialized write queue:** prevents concurrent writes from corrupting files
- **AI follow-up:** after reduce/job phase, a follow-up prompt extracts observations
- **Observation classification:** `classifyFact` determines memory level (repo vs system) from content
- **Phase-aware capture:** map phase skipped, only reduce/job phases trigger capture

## Design Doc

See `docs/designs/coc-memory.md` for full design rationale.

## Tests

Tests in `packages/pipeline-core/test/memory/`:
- `types.test.ts` — type validation and defaults
- `memory-store.test.ts` — storage CRUD, atomic writes, index management
- `memory-capture.test.ts` — observation extraction and classification
- `memory-integration.test.ts` — invoker wrapping, lifecycle, config normalization
```

### 2. Root `AGENTS.md` changes

In the pipeline-core row of the "Key modules" paragraph (line 93), append memory to the list. The current text ends with:

> …Utilities (file I/O, glob, HTTP, text matching, AI response parsing, template engine).

After "Utilities (…)" add:

> , Memory (two-level repo+system observation capture and storage).

The full sentence will read:
> **Key modules:** Logger (pluggable), …, Utilities (file I/O, glob, HTTP, text matching, AI response parsing, template engine), Memory (two-level repo+system observation capture and storage).

### 3. `packages/pipeline-core/AGENTS.md` changes

**Package structure tree (line 7–147):**
Add the memory directory after the `map-reduce/` block (after line 57):

```
│   ├── memory/              # Two-level observation memory
│   │   ├── index.ts          # Memory module exports
│   │   ├── types.ts          # MemoryLevel, MemoryConfig, RawObservation, MemoryIndex
│   │   ├── memory-store.ts   # File-based memory storage with atomic writes
│   │   ├── memory-capture.ts # Observation extraction from AI responses
│   │   └── memory-integration.ts  # Pipeline integration (invoker wrapping, lifecycle)
```

**Key Modules section:**
Add a new subsection after the "Process Store" section (after line 555) and before "Testing":

```markdown
### Memory

Two-level observation memory for learning across pipeline runs. Stores repo-scoped and system-wide observations.

```typescript
import {
    MemoryStore,
    normalizeMemoryConfig,
    createMemoryLifecycle
} from 'pipeline-core';

// Create a memory store (defaults to ~/.coc/memory)
const store = new MemoryStore();

// Normalize pipeline config's memory field
const memConfig = normalizeMemoryConfig(pipelineConfig.memory);
if (memConfig) {
    // Create lifecycle that wraps AIInvoker with phase-aware capture
    const lifecycle = createMemoryLifecycle(originalInvoker, {
        config: memConfig,
        store,
        pipelineName: pipelineConfig.name,
        repoPath: '/path/to/repo',
    });

    // Use lifecycle.wrappedInvoker instead of originalInvoker
    lifecycle.setPhase('job');
    const result = await lifecycle.wrappedInvoker(prompt);
    await lifecycle.flush(); // wait for pending captures
}
```

**Key behaviors:**
- Atomic writes via temp file + rename (same pattern as `FileProcessStore`)
- Serialized write queue prevents corruption under concurrent writes
- Repo memory hashed by repo root path (first 12 hex of SHA-256)
- System memory shared across all repos
- AI follow-up extracts observations after reduce/job phase (not per-item during map)
- Phase-aware: `setPhase('map')` suppresses capture, `setPhase('reduce'|'job')` enables it
```

**Testing section (line 557–573):**
Update the test file count from "61 test files" to "65 test files" (adds 4: `types.test.ts`, `memory-store.test.ts`, `memory-capture.test.ts`, `memory-integration.test.ts`). Add a line:

```bash
# Run memory tests
npx vitest run test/memory/
```

**Test tree (line 108–144):**
Add after the `runtime/` block (after line 142):

```
│   ├── memory/               # Memory tests
│   │   ├── types.test.ts
│   │   ├── memory-store.test.ts
│   │   ├── memory-capture.test.ts
│   │   └── memory-integration.test.ts
```

## Tests

None — documentation-only commit.

## Acceptance Criteria

- [ ] `packages/pipeline-core/src/memory/AGENTS.md` exists with module purpose, storage layout, key files, patterns, and test references
- [ ] Root `AGENTS.md` mentions "Memory (two-level repo+system observation capture and storage)" in the pipeline-core key modules list
- [ ] `packages/pipeline-core/AGENTS.md` package structure tree includes the `memory/` directory
- [ ] `packages/pipeline-core/AGENTS.md` has a "Memory" section under Key Modules with usage example
- [ ] `packages/pipeline-core/AGENTS.md` test tree includes `memory/` test files
- [ ] `packages/pipeline-core/AGENTS.md` test file count updated to 65
- [ ] All content is factually consistent with the code from commits 001–004

## Dependencies

- Depends on: 004
