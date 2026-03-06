---
status: done
---

# 001: Extend PATCH wiki endpoint with repoPath

## Summary

Add `repoPath` and `wikiDir` to the accepted body fields of the `PATCH /api/wikis/:wikiId` endpoint so that wikis can be linked to (or unlinked from) repositories at runtime.

## Motivation

The upcoming "Wiki Tab in Repo Detail Page" feature needs to associate an existing wiki with a repo (and vice-versa). The PATCH endpoint currently only accepts `title`, `name`, `color`, and `aiEnabled`. Adding `repoPath` and `wikiDir` as patchable fields is the smallest foundational change required, and it is purely backend — no UI or frontend dependencies — making it a clean first commit.

## Changes

### Files to Create

- (none)

### Files to Modify

- `packages/coc-server/src/wiki/wiki-routes.ts` — Extend the PATCH handler (lines 314-366):
  1. Add `repoPath?: string | null` and `wikiDir?: string` to the `readJsonBody` type parameter (line 321-326).
  2. In the store-update block (lines 333-337), add:
     - `if (body.repoPath !== undefined) storeUpdates.repoPath = body.repoPath === null ? '' : body.repoPath;`
     - `if (body.wikiDir !== undefined) storeUpdates.wikiDir = body.wikiDir;`
  3. In the runtime-update block (lines 353-358), add:
     - `if (body.repoPath !== undefined) reg.repoPath = body.repoPath === null ? undefined : body.repoPath;`
     — This ensures an in-memory runtime registration reflects the new repo link immediately, without requiring a server restart.

- `packages/coc/test/server/wiki/wiki-routes.test.ts` — Add three new test cases in the store-backed PATCH describe block (after the existing "PATCH succeeds for store-only wikis" test around line 1687):
  1. `'PATCH with repoPath persists to store'`
  2. `'PATCH with repoPath null unlinks wiki from repo'`
  3. `'PATCH with wikiDir updates wikiDir in store'`

### Files to Delete

- (none)

## Implementation Notes

- **`WikiInfo.repoPath`** is already an optional string on the type (see `packages/pipeline-core/src/process-store.ts:80`), so no type changes are needed in pipeline-core.
- **`WikiRegistration.repoPath`** is also already optional (`packages/coc-server/src/wiki/wiki-manager.ts:33`), so `reg.repoPath = ...` compiles without changes.
- **Null semantics:** The body accepts `null` to mean "unlink". When persisting to the store, convert `null` → `''` (empty string) since `WikiInfo.repoPath` is `string | undefined`. When updating the runtime registration, convert `null` → `undefined` to clear the field. This mirrors how the store treats absent vs. empty values and avoids introducing `null` into the persisted data.
- **Existing bug note:** Lines 334-335 both write to `storeUpdates.name` (one for `body.name`, one for `body.title`). This is pre-existing and out of scope for this commit.
- **No validation of path existence** is performed for `repoPath` — the value is stored as-is. Path validation belongs in a higher-level layer (e.g., the UI or a future `POST /api/wikis/:wikiId/link` endpoint). This keeps the PATCH handler simple and consistent with how other fields are handled.

## Tests

- **PATCH with repoPath persists to store:** Register a wiki via POST, PATCH with `{ repoPath: '/some/repo' }`, then verify `store.getWikis()` returns the updated `repoPath`.
- **PATCH with repoPath null unlinks:** Register a wiki with a `repoPath`, PATCH with `{ repoPath: null }`, then verify `store.getWikis()` returns the wiki with `repoPath` cleared (empty string or undefined).
- **PATCH with wikiDir updates wikiDir:** Register a wiki via POST, PATCH with `{ wikiDir: '/new/dir' }`, then verify `store.getWikis()` returns the updated `wikiDir`.

All three tests should follow the same pattern as the existing `'PATCH updates name and color in the store'` test (line 1555): create a `FileProcessStore`, start a server, POST to register, PATCH to update, read back from store and assert.

## Acceptance Criteria

- [ ] `PATCH /api/wikis/:wikiId` with `{ repoPath: "/some/path" }` persists the repoPath to the store
- [ ] `PATCH /api/wikis/:wikiId` with `{ repoPath: null }` clears the repoPath in the store
- [ ] `PATCH /api/wikis/:wikiId` with `{ wikiDir: "/new/dir" }` persists the wikiDir to the store
- [ ] If the wiki has an active runtime, `repoPath` changes are reflected in the runtime registration
- [ ] Existing PATCH tests continue to pass (no regressions)
- [ ] `npm run test` passes in `packages/coc/`

## Dependencies

- Depends on: None

## Assumed Prior State

None (first commit)
