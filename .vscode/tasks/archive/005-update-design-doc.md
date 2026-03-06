---
status: done
---

# 005: Update Design Doc with Implementation Status

## Summary

Update `docs/designs/coc-memory.md` to reflect that the MemoryStore module has been implemented, marking it complete in the implementation modules table and adding a status section.

## Motivation

Keeping the design doc in sync with implementation status helps contributors quickly understand what's done and what's left. This is a docs-only change that should follow the code commits.

## Changes

### Files to Create

- (none)

### Files to Modify

- `docs/designs/coc-memory.md` — Add implementation status section; update the Implementation Modules table to mark `MemoryStore` as complete

### Files to Delete

- (none)

## Implementation Notes

Add a new `## Implementation Status` section after the existing `## Implementation Modules` section. Use a simple status table:

```markdown
## Implementation Status

| Module | Status | Notes |
|--------|--------|-------|
| `MemoryStore` | ✅ Done | `pipeline-core/src/memory/` — raw CRUD, consolidated r/w, index, repo-info, clear, stats |
| `MemoryCapture` | ⬚ Not started | |
| `MemoryRetriever` | ⬚ Not started | |
| `MemoryAggregator` | ⬚ Not started | |
| `PipelineConfig.memory` | ⬚ Not started | |
| `executePipeline` hooks | ⬚ Not started | |
| `coc memory` command | ⬚ Not started | |
| Background aggregation | ⬚ Not started | |
```

Also update the existing Implementation Modules table row for `MemoryStore` to note that it's been implemented, by appending the subpath export:

```
| `MemoryStore` | `pipeline-core` | CRUD for raw + consolidated files, atomic writes, repo hashing, path resolution. Import via `@plusplusoneplusplus/pipeline-core/memory` |
```

## Tests

- None — documentation change only.

## Acceptance Criteria

- [ ] `docs/designs/coc-memory.md` has a new `## Implementation Status` section
- [ ] MemoryStore is marked as ✅ Done with a brief summary of what was implemented
- [ ] All other modules are marked as ⬚ Not started
- [ ] The existing Implementation Modules table row for MemoryStore includes the import path
- [ ] No other content in the design doc is changed

## Dependencies

- Depends on: 001, 002, 003, 004

## Assumed Prior State

All four prior commits are merged:
- 001: Types in `packages/pipeline-core/src/memory/types.ts`
- 002: MemoryStore class with raw observation CRUD
- 003: Consolidated memory, index, repo-info, clear, stats
- 004: Exports wired in `pipeline-core` index.ts and package.json (`./memory` subpath)
