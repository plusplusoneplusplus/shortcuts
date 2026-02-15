---
status: done
---

# 001: Add WikiInfo Type and Wiki CRUD to ProcessStore

## Summary
Add WikiInfo interface and wiki management methods to the ProcessStore interface and FileProcessStore implementation in pipeline-core, with persistence to ~/.coc/wikis.json.

## Motivation
WikiInfo is the foundational type for multi-wiki support. Like WorkspaceInfo for repos, WikiInfo represents a registered wiki in the CoC server. All subsequent commits depend on this type existing in pipeline-core.

## Changes

### Files to Create
- (none for this commit — extend existing files)

### Files to Modify
- `packages/pipeline-core/src/process-store.ts` — Add WikiInfo interface, add wiki CRUD methods to ProcessStore interface
- `packages/pipeline-core/src/file-process-store.ts` — Implement wiki CRUD with wikis.json persistence (atomic writes, same pattern as workspaces)
- `packages/pipeline-core/src/index.ts` — Export WikiInfo type

### Files to Delete
- (none)

## Implementation Notes

### WikiInfo Interface (process-store.ts)

Add the `WikiInfo` interface immediately after the `WorkspaceInfo` interface (after line 39, before `ProcessFilter` on line 44). Fields:

```typescript
export interface WikiInfo {
    /** Stable unique identifier — typically a hash of wikiDir */
    id: string;
    /** Human-readable name (e.g. "My Project Wiki") */
    name: string;
    /** Absolute path to the generated wiki directory */
    wikiDir: string;
    /** Absolute path to the source repository (optional — wiki may be standalone) */
    repoPath?: string;
    /** Optional UI color for dashboard differentiation */
    color?: string;
    /** Whether AI Q&A is enabled for this wiki */
    aiEnabled: boolean;
    /** ISO 8601 timestamp of when the wiki was registered */
    registeredAt: string;
}
```

### ProcessStore Interface Methods (process-store.ts)

Add four wiki CRUD methods to the `ProcessStore` interface (after the `updateWorkspace` method on line 81, before `onProcessChange` on line 84). Follow the exact same naming and signature pattern as workspaces:

```typescript
/** Return all known wikis. */
getWikis(): Promise<WikiInfo[]>;
/** Register (or update) a wiki identity. */
registerWiki(wiki: WikiInfo): Promise<void>;
/** Remove a wiki by ID. Returns true if found and removed. */
removeWiki(id: string): Promise<boolean>;
/** Partial-update a wiki. Returns updated wiki or undefined if not found. */
updateWiki(id: string, updates: Partial<Omit<WikiInfo, 'id'>>): Promise<WikiInfo | undefined>;
```

### FileProcessStore Implementation (file-process-store.ts)

1. **Import WikiInfo** — Update the import on line 15 to include `WikiInfo`:
   ```typescript
   import { ProcessStore, ProcessFilter, WorkspaceInfo, WikiInfo, ProcessChangeCallback, ProcessOutputEvent } from './process-store';
   ```

2. **Add `wikisPath` property** — Add a new readonly property alongside `workspacesPath` (line 56). In the constructor (after line 68), initialize it:
   ```typescript
   private readonly wikisPath: string;
   // in constructor:
   this.wikisPath = path.join(this.dataDir, 'wikis.json');
   ```

3. **Implement CRUD methods** — Place them after the `updateWorkspace` method (after line 249), before the streaming support section (line 251). Replicate the exact workspace pattern:

   - **`registerWiki`** — Same pattern as `registerWorkspace` (lines 203-215): `enqueueWrite` → `ensureDataDir` → `readWikis` → find-or-push → `writeWikis`.
   - **`getWikis`** — Same as `getWorkspaces` (lines 217-219): delegates to `readWikis`.
   - **`removeWiki`** — Same as `removeWorkspace` (lines 221-232): `enqueueWrite` → `readWikis` → `findIndex` → `splice` → `writeWikis`.
   - **`updateWiki`** — Same as `updateWorkspace` (lines 235-249): `enqueueWrite` → `readWikis` → `findIndex` → merge fields individually → `writeWikis`. Apply each WikiInfo field explicitly:
     ```typescript
     if (updates.name !== undefined) { wikis[idx].name = updates.name; }
     if (updates.wikiDir !== undefined) { wikis[idx].wikiDir = updates.wikiDir; }
     if (updates.repoPath !== undefined) { wikis[idx].repoPath = updates.repoPath; }
     if (updates.color !== undefined) { wikis[idx].color = updates.color; }
     if (updates.aiEnabled !== undefined) { wikis[idx].aiEnabled = updates.aiEnabled; }
     if (updates.registeredAt !== undefined) { wikis[idx].registeredAt = updates.registeredAt; }
     ```

4. **Add private read/write helpers** — Place after `writeWorkspaces` (after line 315), before `enqueueWrite` (line 317). Follow the same atomic-write pattern used for workspaces (lines 302-315):

   ```typescript
   private async readWikis(): Promise<WikiInfo[]> {
       try {
           const data = await fs.readFile(this.wikisPath, 'utf-8');
           return JSON.parse(data) as WikiInfo[];
       } catch {
           return [];
       }
   }

   private async writeWikis(wikis: WikiInfo[]): Promise<void> {
       const tmpPath = this.wikisPath + '.tmp';
       await fs.writeFile(tmpPath, JSON.stringify(wikis, null, 2), 'utf-8');
       await fs.rename(tmpPath, this.wikisPath);
   }
   ```

   The atomic write pattern (write to `.tmp` then `rename`) ensures crash-safety — same as `writeProcesses` (lines 296-300) and `writeWorkspaces` (lines 311-315).

### Barrel Export (index.ts)

Add `WikiInfo` to the Process Store export block (line 347-353). Update the export from `./process-store` to include `WikiInfo`:

```typescript
export {
    ProcessOutputEvent,
    WorkspaceInfo,
    WikiInfo,
    ProcessFilter,
    ProcessChangeCallback,
    ProcessStore
} from './process-store';
```

## Tests
- Test WikiInfo CRUD in FileProcessStore (register, get, update, remove)
- Test wikis.json persistence (atomic writes)
- Test empty wikis list on fresh store
- Test wiki ID uniqueness (registerWiki with existing ID should update, not duplicate)
- Test that registerWiki is idempotent (upsert semantics, matching registerWorkspace behavior)
- Test updateWiki returns undefined for non-existent ID
- Test removeWiki returns false for non-existent ID

## Acceptance Criteria
- [x] WikiInfo interface exported from pipeline-core
- [x] ProcessStore interface has registerWiki, getWikis, removeWiki, updateWiki methods
- [x] FileProcessStore implements all wiki methods with wikis.json persistence
- [x] All existing pipeline-core tests still pass
- [x] New tests for wiki CRUD pass

## Dependencies
- Depends on: None
