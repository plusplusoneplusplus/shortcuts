---
status: done
---

# 001: Add parentProcessId to ProcessFilter

## Summary
Add `parentProcessId` as a queryable filter field on `ProcessFilter`, and implement the filtering logic in `FileProcessStore.getAllProcesses()` using the existing index which already stores `parentProcessId`.

## Motivation
This is the foundation for all child process querying. `AIProcess.parentProcessId` (line 62 of `process-types.ts`) and `ProcessIndexEntry.parentProcessId` (line 41 of `file-process-store.ts`) already exist — the only gap is that `ProcessFilter` doesn't expose it as a queryable dimension, and `FileProcessStore` doesn't filter on it. This must come first because all subsequent commits (API routes, SPA drill-down) depend on being able to query children by parent.

## Changes

### Files to Modify

#### 1. `packages/pipeline-core/src/process-store.ts` — ProcessFilter interface (lines 113–128)

Add `parentProcessId?: string` field to the `ProcessFilter` interface, alongside the existing filter fields (`workspaceId`, `status`, `type`, `since`, `limit`, `offset`, `exclude`):

```typescript
// process-store.ts, inside ProcessFilter (after line 114)
export interface ProcessFilter {
    workspaceId?: string;
    parentProcessId?: string;   // ← NEW: filter by parent process
    status?: AIProcessStatus | AIProcessStatus[];
    type?: AIProcessType;
    since?: Date;
    limit?: number;
    offset?: number;
    exclude?: string[];
}
```

Place `parentProcessId` directly after `workspaceId` (line 114) since both are string-equality ID filters and logically group together.

#### 2. `packages/pipeline-core/src/file-process-store.ts` — getAllProcesses() index filtering (lines 127–163)

In `getAllProcesses()`, add index-level filtering for `parentProcessId`. Insert a new block immediately after the `workspaceId` filter (lines 132–134) and before the `status` filter (lines 135–138), replicating the exact same pattern:

```typescript
// file-process-store.ts, getAllProcesses(), after line 134
if (filter?.parentProcessId) {
    indexEntries = indexEntries.filter(e => e.parentProcessId === filter.parentProcessId);
}
```

**Pattern being replicated** (lines 132–134):
```typescript
if (filter?.workspaceId) {
    indexEntries = indexEntries.filter(e => e.workspaceId === filter.workspaceId);
}
```

This filters at the index level (`ProcessIndexEntry[]`) before any process JSON files are read from disk (the file reads happen later at lines 154–161). The `ProcessIndexEntry` type already has `parentProcessId?: string` declared at line 41, so no schema change is needed.

#### 3. `packages/pipeline-core/src/file-process-store.ts` — clearProcesses() filter matching (lines 211–254)

For consistency, also add `parentProcessId` matching in the `clearProcesses()` method. Currently this method checks `workspaceId` (line 229–231), `status` (lines 233–236), and `type` (lines 238–240). Add a matching block for `parentProcessId`:

```typescript
// file-process-store.ts, clearProcesses(), after the workspaceId check (line 231)
if (match && filter.parentProcessId) {
    match = ie.parentProcessId === filter.parentProcessId;
}
```

This follows the exact guard pattern used by other filter fields in this method: `if (match && filter.<field>) { match = <comparison>; }`.

## Implementation Notes

- **Index already stores `parentProcessId`**: See `toIndexEntry()` at lines 533–545 which maps `entry.process.parentProcessId` directly to the index entry. No index schema change needed.
- **Pure additive change**: No existing behavior is modified. All existing filter fields continue to work identically. An `undefined` (unset) `parentProcessId` filter simply skips the new block via the `if (filter?.parentProcessId)` guard.
- **Exact pattern replication**: The `workspaceId` index filter at lines 132–134 is the template. Both are simple string-equality checks on an index field using `indexEntries.filter(e => ...)`.
- **No full-file reads**: Filtering happens entirely on the in-memory `ProcessIndexEntry[]` array before the `readProcessFile()` loop at lines 155–160. This means querying children of a parent reads zero unnecessary JSON files.

## Tests

Add tests in `packages/pipeline-core/test/file-process-store.test.ts` (existing test file):

1. **Filter returns only matching children**:
   - Create 3 processes via `store.addProcess()`: P1 (parent, no `parentProcessId`), P2 (child of P1, `parentProcessId: P1.id`), P3 (unrelated, no `parentProcessId`)
   - Call `store.getAllProcesses({ parentProcessId: P1.id })` → should return exactly `[P2]`

2. **Filter with nonexistent parent returns empty**:
   - Call `store.getAllProcesses({ parentProcessId: 'nonexistent' })` → should return `[]`

3. **No filter returns all (no regression)**:
   - Call `store.getAllProcesses({})` → should return all 3 processes `[P1, P2, P3]`

4. **Combined filters work**:
   - Call `store.getAllProcesses({ parentProcessId: P1.id, status: 'completed' })` → should return P2 only if P2 is completed, empty otherwise

5. **clearProcesses respects parentProcessId filter**:
   - Call `store.clearProcesses({ parentProcessId: P1.id })` → should remove only P2
   - Verify P1 and P3 still exist via `store.getAllProcesses()`

## Acceptance Criteria
- [ ] `ProcessFilter` interface has `parentProcessId?: string` field (in `process-store.ts` line ~115)
- [ ] `FileProcessStore.getAllProcesses({ parentProcessId: 'X' })` returns only processes where `parentProcessId === 'X'`
- [ ] `FileProcessStore.clearProcesses({ parentProcessId: 'X' })` removes only processes where `parentProcessId === 'X'`
- [ ] Filtering happens at index level (no unnecessary file reads) — new block is before the `readProcessFile()` loop at line 155
- [ ] Existing filter behavior unchanged (no regressions)
- [ ] Tests pass on Linux, macOS, Windows

## Dependencies
- Depends on: None

## Assumed Prior State
None — this is the first commit.
