---
status: pending
---

# 002: Refactor VS Code Extension to Use pipeline-core Discovery

## Summary

Refactor the VS Code extension's `prompt-files-utils.ts` and `skill-files-utils.ts` to delegate pure filesystem scanning logic to `@plusplusoneplusplus/pipeline-core`'s new discovery module (added in commit 001). The extension modules become thin VS Code–specific wrappers that read settings, resolve workspace root, and map pipeline-core types to the existing extension types. All consumers remain untouched.

## Motivation

- **DRY:** The recursive `.prompt.md` scanning in `findPromptFilesInFolder()` (prompt-files-utils.ts:89–121) and the `.github/skills` directory scanning in `getSkills()` (skill-files-utils.ts:31–65) are pure Node.js FS logic with zero VS Code dependencies. This duplicates what pipeline-core's new `findPromptFiles()` and `findSkills()` functions provide.
- **Reuse in CLI:** With the scanning logic in pipeline-core, the `coc` CLI and other Node.js consumers can discover prompts/skills without depending on VS Code APIs.
- **Single source of truth:** Bug fixes or new features (e.g., `.prompt.yaml` support, custom skill directory) only need to be made once in pipeline-core.

## Changes

### Files to Create

_None._ Commit 001 already creates the discovery module in pipeline-core. This commit only modifies existing extension files.

### Files to Modify

#### 1. `src/shortcuts/shared/prompt-files-utils.ts`

**Current state (146 lines):**
- Imports: `fs`, `path`, `vscode`, `getWorkspaceRoot` (line 1–4)
- `PromptFile` interface (lines 9–18): `{ absolutePath, relativePath, name, sourceFolder }` — all `string`
- `DEFAULT_PROMPT_LOCATION = '.github/prompts'` (line 23)
- `getPromptFileLocations()` (lines 33–49): reads `vscode.workspace.getConfiguration('chat').get('promptFilesLocations')` — VS Code–specific; returns enabled folder paths; falls back to `DEFAULT_PROMPT_LOCATION`
- `getPromptFiles()` (lines 58–84): resolves each location relative to workspace root via `path.isAbsolute()` / `path.join()`, checks `fs.existsSync()`, calls private `findPromptFilesInFolder()` for each
- `findPromptFilesInFolder()` (lines 89–121): **private**, recursively scans folder with `fs.readdirSync()` for `*.prompt.md` files, constructs `PromptFile` objects
- `getPromptFilePaths()` / `getPromptFileNames()` (lines 130–145): convenience wrappers over `getPromptFiles()`

**Changes:**

1. **Replace imports** — remove `fs` and `path`; add pipeline-core import:
   ```typescript
   import * as vscode from 'vscode';
   import { findPromptFiles as coreFindPromptFiles } from '@plusplusoneplusplus/pipeline-core';
   import { getWorkspaceRoot } from './workspace-utils';
   ```
   `fs` and `path` are no longer needed: `getPromptFiles()` no longer does its own path resolution or existence checks (pipeline-core handles both), and `findPromptFilesInFolder()` is deleted.

2. **Keep `PromptFile` interface unchanged** — consumers depend on this exact shape.

3. **Keep `DEFAULT_PROMPT_LOCATION` constant unchanged** — still used by `getPromptFileLocations()` as fallback.

4. **Keep `getPromptFileLocations()` unchanged** — reads the VS Code `chat.promptFilesLocations` setting, which is VS Code–specific and cannot move to pipeline-core.

5. **Refactor `getPromptFiles()`** — replace the manual for-loop + path resolution + existence check + `findPromptFilesInFolder()` with a single call to `coreFindPromptFiles()`:
   ```typescript
   export async function getPromptFiles(
       workspaceRoot?: string,
       configOverride?: Record<string, boolean>
   ): Promise<PromptFile[]> {
       const root = workspaceRoot || getWorkspaceRoot();
       if (!root) { return []; }

       const locations = getPromptFileLocations(configOverride);

       // Delegate filesystem scanning to pipeline-core
       const coreResults = await coreFindPromptFiles(root, locations);

       // Map pipeline-core PromptFileInfo → extension PromptFile (1:1 fields)
       return coreResults.map(info => ({
           absolutePath: info.absolutePath,
           relativePath: info.relativePath,
           name: info.name,
           sourceFolder: info.sourceFolder,
       }));
   }
   ```
   Pipeline-core's `findPromptFiles(rootDir, locations)` (from commit 001) handles: resolving relative/absolute paths, `fs.existsSync` checks, recursive `readdirSync` walk, `.prompt.md` filtering, and error handling — identical logic to what lines 58–121 currently do.

6. **Delete `findPromptFilesInFolder()`** (lines 89–121) — entirely replaced by `coreFindPromptFiles()`.

7. **Keep `getPromptFilePaths()` and `getPromptFileNames()` unchanged** — they delegate to `getPromptFiles()` which now uses core.

**Net result:** File shrinks from 146 lines to ~60 lines. Zero behavioral change for prompt file discovery.

#### 2. `src/shortcuts/shared/skill-files-utils.ts`

**Current state (88 lines):**
- Imports: `fs`, `path`, `getWorkspaceRoot` (lines 1–3)
- `Skill` interface (lines 8–17): `{ absolutePath, relativePath, name, sourceFolder }` — all `string`
- `DEFAULT_SKILLS_LOCATION = '.github/skills'` (line 22)
- `getSkills()` (lines 31–65): resolves `path.join(root, DEFAULT_SKILLS_LOCATION)`, checks `fs.existsSync()`, reads `fs.readdirSync()`, filters directories, constructs `Skill[]`
- `getSkillPaths()` / `getSkillNames()` (lines 73–87): convenience wrappers over `getSkills()`

**Changes:**

1. **Replace imports** — remove `fs` and `path`; add pipeline-core import:
   ```typescript
   import { findSkills as coreFindSkills } from '@plusplusoneplusplus/pipeline-core';
   import { getWorkspaceRoot } from './workspace-utils';
   ```

2. **Keep `Skill` interface unchanged** — consumers depend on this shape.

3. **Remove `DEFAULT_SKILLS_LOCATION` constant** — pipeline-core owns this default (`DEFAULT_SKILLS_DIRECTORY = '.github/skills'` in `packages/pipeline-core/src/config/defaults.ts:162`). No extension code references this local constant outside this file.

4. **Refactor `getSkills()`** — delegate to `coreFindSkills()`:
   ```typescript
   export async function getSkills(workspaceRoot?: string): Promise<Skill[]> {
       const root = workspaceRoot || getWorkspaceRoot();
       if (!root) { return []; }

       // Delegate filesystem scanning to pipeline-core
       const coreResults = await coreFindSkills(root);

       // Map pipeline-core SkillInfo → extension Skill (drop description field)
       return coreResults.map(info => ({
           absolutePath: info.absolutePath,
           relativePath: info.relativePath,
           name: info.name,
           sourceFolder: info.sourceFolder,
       }));
   }
   ```
   The `map()` explicitly drops `SkillInfo.description` (optional field added in commit 001 from YAML frontmatter parsing) since the extension's `Skill` type has no `description` field.

5. **Keep `getSkillPaths()` and `getSkillNames()` unchanged.**

**Net result:** File shrinks from 88 lines to ~45 lines.

#### 3. `src/shortcuts/shared/index.ts`

**No changes required.** The barrel file already re-exports `getPromptFileLocations`, `getPromptFileNames`, `getPromptFilePaths`, `getPromptFiles`, and `PromptFile` from `./prompt-files-utils` (lines 94–101). Since the public API of that module doesn't change, no barrel updates are needed.

Note: `skill-files-utils` is currently NOT re-exported from the barrel — consumers import directly from `'../shared/skill-files-utils'`. This is fine; adding barrel re-exports is optional and orthogonal to this commit.

#### 4. `src/test/suite/skill-files-utils.test.ts` (conditional — see Behavioral Difference below)

If the stricter `SKILL.md` requirement from pipeline-core is accepted, **8 of 12 tests** need a one-line fix to create a `SKILL.md` file in each test skill directory. See the **Behavioral Difference** section for full details.

### Files to Delete

_None._

## Implementation Notes

### Type Mapping: pipeline-core → Extension

Commit 001 defines these types in `packages/pipeline-core/src/discovery/types.ts`:

| pipeline-core Type | Extension Type | Field Mapping | Notes |
|---|---|---|---|
| `PromptFileInfo` | `PromptFile` (prompt-files-utils.ts:9–18) | 1:1 — both have `absolutePath: string`, `relativePath: string`, `name: string`, `sourceFolder: string` | Trivial identity map |
| `SkillInfo` | `Skill` (skill-files-utils.ts:8–17) | 4 of 5 fields match — `SkillInfo` adds `description?: string` | Map drops `description` |

The mapping is a trivial object spread. If commit 001 renames any field (e.g., `source` vs `sourceFolder`), adjust the `map()` call accordingly.

**Important:** Do **not** replace the extension's `PromptFile` / `Skill` types with pipeline-core types in consumer code. Keeping the extension types as the public API ensures:
- Consumers need zero changes.
- The extension can add VS Code–specific fields later without polluting pipeline-core.

### ⚠️ Behavioral Difference: Skill Discovery Strictness

**Current extension behavior** (`skill-files-utils.ts:46–59`): Any subdirectory under `.github/skills/` is treated as a valid skill, regardless of whether it contains a `SKILL.md` file. The extension scans with `entry.isDirectory()` only.

**Pipeline-core behavior** (commit 001 plan, `findSkills()`): A valid skill requires `SKILL.md` to exist in the subdirectory. This follows the `listSkills()` pattern at `pipeline/skill-resolver.ts:182–189` which checks `fs.existsSync(promptPath)` for `SKILL.md`.

**Impact:** Skill directories without `SKILL.md` would stop being discovered. In practice, this is harmless because **every consumer reads `SKILL.md`**:
- `review-editor-view-provider.ts:1011` — `readSkillPrompt()` reads `SKILL.md`
- `diff-review-editor-provider.ts:991` — `readSkillPrompt()` reads `SKILL.md`
- `diff-review-editor-provider.ts:1009` — `readSkillDescription()` reads `SKILL.md`
- `ai-queue-commands.ts:271–278` — resolves skill then reads `SKILL.md`
- `job-template-commands.ts:271–276` — resolves skill then reads `SKILL.md`

A skill without `SKILL.md` would appear in the dropdown but fail when selected. The stricter behavior is actually more correct.

**Recommended approach:** Accept the stricter behavior. Update `src/test/suite/skill-files-utils.test.ts` to create `SKILL.md` in test skill directories. This aligns the extension with the pipeline-core convention.

**8 tests that need `SKILL.md` added** (each test creates skill dirs but omits `SKILL.md`):

| Line | Test Name | Fix |
|------|-----------|-----|
| 35 | `getSkills finds skill directory` | Add `fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Skill')` after dir creation |
| 47 | `getSkills finds multiple skills` | Add `SKILL.md` to both `skill-one` and `skill-two` dirs |
| 65 | `getSkills ignores files in .github/skills root` | Add `SKILL.md` to `valid-skill` dir |
| 81 | `getSkills finds empty skill directories` | **Rename test** to `getSkills requires SKILL.md` and **assert length 0** (empty dir = not a skill), OR add `SKILL.md` and rename to `getSkills finds minimal skill directories` |
| 106 | `getSkillPaths returns array of absolute paths` | Add `SKILL.md` to both skill dirs |
| 123 | `getSkillNames returns array of skill names` | Add `SKILL.md` to both skill dirs |
| 138 | `getSkills returns correct relative paths` | Add `SKILL.md` to `test-skill` dir |
| 151 | `getSkills handles cross-platform paths correctly` | Add `SKILL.md` to `cross-platform-skill` dir |

**Special case — line 81:** The `getSkills finds empty skill directories` test explicitly verifies that a directory without `SKILL.md` is discovered. Two options:
- **Option A:** Change the assertion to `assert.strictEqual(skills.length, 0)` and rename to `getSkills excludes directories without SKILL.md` — this documents the new (correct) behavior.
- **Option B:** Add a `SKILL.md` file so it's still a "found" test — but then it's not really testing "empty" anymore. Combine with Option A for full coverage.

**Recommended:** Apply Option A (assert empty, rename) for the "empty skill directories" test, and add `SKILL.md` to all other tests. This adds both positive and negative test coverage.

**4 tests that need NO changes:**

| Line | Test Name | Why |
|------|-----------|-----|
| 22 | `returns empty when .github/skills does not exist` | No skill dirs at all |
| 27 | `returns empty when .github/skills is empty` | Empty directory |
| 91 | `finds skill directories with any content` | Already creates `SKILL.md` |
| 164 | `returns empty when workspaceRoot is undefined` | No workspace |

**Alternative approach** (if strict behavior is unacceptable): Commit 001 would need to add a `requireSkillMd?: boolean` option to `findSkills()` defaulting to `true`. The extension would call `coreFindSkills(root, undefined, { requireSkillMd: false })`. This preserves the lenient behavior but adds API complexity. Not recommended.

### Consumer Inventory (must remain untouched)

| File | Import Source | Symbols | Usage |
|---|---|---|---|
| `review-editor-view-provider.ts:25` | `'../shared/prompt-files-utils'` | `getPromptFiles` | `handleRequestPromptFiles()` at line 1476 — reads all 4 `PromptFile` fields |
| `review-editor-view-provider.ts:26` | `'../shared/skill-files-utils'` | `getSkills` | `handleRequestPromptFiles()` — reads `absolutePath`, `relativePath`, `name` |
| `diff-review-editor-provider.ts:12` | `'../shared/prompt-files-utils'` | `getPromptFiles` | `handleRequestPromptFiles()` at line 939 |
| `diff-review-editor-provider.ts:13` | `'../shared/skill-files-utils'` | `getSkills` | `handleRequestPromptFiles()` line 941, `handleRequestSkills()` line 952–957 |
| `job-template-commands.ts:24` | `'../shared/skill-files-utils'` | `getSkills` | line 271 — reads `absolutePath`, `name` |
| `ai-queue-commands.ts:14` | `'../shared/skill-files-utils'` | `getSkills` | line 271 — reads `absolutePath`, `name` |
| `queue-job-dialog-service.ts:13` | `'../shared/skill-files-utils'` | `getSkillNames` | lines 81, 214 — returns `string[]` |

All consumers import from the same module paths and use the same `PromptFile`/`Skill` types. Since the public API surface doesn't change, zero consumer modifications are needed.

### Pipeline-core's Existing Skill/Prompt Infrastructure

Pipeline-core already has related modules that this commit does **not** touch:
- `pipeline/skill-resolver.ts` — resolves a single skill by name, loads `SKILL.md` content. Has `listSkills()` (line 169) which returns `string[]` of skill names only (no full metadata). Commit 001's `findSkills()` returns full `SkillInfo[]` with `absolutePath`/`relativePath`/`sourceFolder`/`description`.
- `pipeline/prompt-resolver.ts` — resolves a single prompt file for pipeline execution (`resolvePromptFile()`). Does not scan for all `.prompt.md` files. Commit 001's `findPromptFiles()` scans configurable locations recursively.

### Backward Compatibility Checklist

- [ ] `PromptFile` interface shape: unchanged (4 string fields)
- [ ] `Skill` interface shape: unchanged (4 string fields)
- [ ] `getPromptFileLocations(configOverride?)` signature: unchanged
- [ ] `getPromptFiles(workspaceRoot?, configOverride?)` signature: unchanged
- [ ] `getSkills(workspaceRoot?)` signature: unchanged
- [ ] `getPromptFilePaths()` / `getPromptFileNames()` / `getSkillPaths()` / `getSkillNames()`: unchanged
- [ ] All consumer import paths compile without modification
- [ ] Prompt file discovery behavior: identical (same recursive scan, same `.prompt.md` filter)
- [ ] Skill discovery behavior: stricter (requires `SKILL.md`) — acceptable, see Behavioral Difference section
- [ ] Return order: may differ for skills (pipeline-core sorts by name; extension didn't sort). Existing tests use `sort()` before comparing (`skill-files-utils.test.ts:61`) or `includes()` checks (`line 134–135`), so ordering changes are safe.

## Tests

### Existing Tests — Prompt Files (`src/test/suite/prompt-files-utils.test.ts`)

**427 lines, 25 tests. All pass without modification.**

Tests exercise:
- `getPromptFileLocations()` with empty config, enabled/disabled locations, mixed states, empty config → default (5 tests) — **unaffected** (function unchanged)
- `getPromptFiles()` with temp directories: single file, nested files, multiple locations, absolute locations, non-.prompt.md files ignored, non-existent folders, deep nesting, special characters, symlinks (~15 tests) — **pass as-is** because pipeline-core uses identical scanning logic (recursive `readdirSync`, `.prompt.md` suffix filter, same `name` extraction via `replace('.prompt.md', '')`)
- `getPromptFilePaths()` / `getPromptFileNames()` convenience wrappers (5 tests) — **unaffected** (delegate to `getPromptFiles()`)

### Existing Tests — Skill Files (`src/test/suite/skill-files-utils.test.ts`)

**169 lines, 12 tests. 8 tests need minor updates** (see Behavioral Difference section above).

Changes required:
- 7 tests: Add one `fs.writeFileSync(...)` line to create `SKILL.md` in each test skill directory
- 1 test (`getSkills finds empty skill directories` at line 81): Change assertion from `length === 1` to `length === 0` and rename to document the `SKILL.md` requirement
- 4 tests: No changes (already create `SKILL.md` or test empty/missing scenarios)

### Full Extension Test Suite

Run `npm test` (6900+ tests) to verify no regressions across all features. The prompt-files and skill-files tests are included in this suite.

### New Tests

_None required._ The existing tests cover the public API thoroughly. Pipeline-core's own Vitest tests (from commit 001) cover the core scanning logic independently.

## Acceptance Criteria

1. `npm run compile` succeeds with no new TypeScript errors
2. `npm run lint` passes with no new warnings
3. All 25 `prompt-files-utils.test.ts` tests pass unchanged
4. All 12 `skill-files-utils.test.ts` tests pass (with 8 minor updates for `SKILL.md` requirement)
5. Full extension test suite passes (`npm test`, 6900+ tests)
6. `findPromptFilesInFolder()` private function is removed from `prompt-files-utils.ts`
7. `DEFAULT_SKILLS_LOCATION` constant is removed from `skill-files-utils.ts`
8. `fs` and `path` imports are removed from both `prompt-files-utils.ts` and `skill-files-utils.ts`
9. No changes to any consumer files (review-editor-view-provider, diff-review-editor-provider, job-template-commands, ai-queue-commands, queue-job-dialog-service)
10. `import` statements in modified files reference only `@plusplusoneplusplus/pipeline-core` and local modules (no new external deps)
11. `src/shortcuts/shared/index.ts` requires no changes (barrel re-exports unchanged)

## Dependencies

- Depends on: 001 (adds `findPromptFiles`, `findSkills`, `PromptFileInfo`, `SkillInfo` to `@plusplusoneplusplus/pipeline-core`)
