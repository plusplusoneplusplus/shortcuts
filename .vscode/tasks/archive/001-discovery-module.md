---
status: pending
---

# 001: Add discovery module to pipeline-core

## Summary

Extract prompt-file and skill-file discovery logic from the VS Code extension into a new `discovery` module in `pipeline-core`, providing pure Node.js APIs that both the extension and the CoC CLI/dashboard can consume.

## Motivation

The extension's `prompt-files-utils.ts` reads VS Code settings (`vscode.workspace.getConfiguration('chat')`) and `skill-files-utils.ts` calls `getWorkspaceRoot()` from `vscode`. The CoC dashboard runs as a standalone Node.js process with no VS Code API. Extracting discovery into `pipeline-core` with explicit `rootDir`/`locations` parameters makes the logic runtime-agnostic. This is the foundation commit — later commits wire discovery results into the CoC dashboard's AI action dropdown.

## Changes

### Files to Create

- `packages/pipeline-core/src/discovery/types.ts` — `PromptFileInfo` and `SkillInfo` type definitions (no runtime code)
- `packages/pipeline-core/src/discovery/prompt-files.ts` — `findPromptFiles(rootDir, locations?)` recursive `.prompt.md` scanner
- `packages/pipeline-core/src/discovery/skill-files.ts` — `findSkills(rootDir, skillsLocation?)` skill directory scanner with YAML frontmatter description extraction
- `packages/pipeline-core/src/discovery/index.ts` — Barrel re-exports for all discovery types and functions
- `packages/pipeline-core/test/discovery/prompt-files.test.ts` — Vitest tests for prompt file discovery
- `packages/pipeline-core/test/discovery/skill-files.test.ts` — Vitest tests for skill file discovery

### Files to Modify

- `packages/pipeline-core/src/index.ts` — Add `// Discovery` export section (after the existing "Tasks" section at line ~676) re-exporting from `'./discovery'`
- `packages/pipeline-core/package.json` — Add `"./discovery": "./dist/discovery/index.js"` to the `"exports"` map (after the existing `"./tasks"` entry at line 13)

## Implementation Notes

### Type Definitions (`discovery/types.ts`)

```typescript
/**
 * Discovered prompt file metadata.
 *
 * Mirrors the extension's PromptFile type (src/shortcuts/shared/prompt-files-utils.ts:9-18)
 * but named PromptFileInfo to avoid ambiguity with pipeline's PromptResolutionResult.
 */
export interface PromptFileInfo {
    /** Absolute path to the .prompt.md file */
    absolutePath: string;
    /** Path relative to the rootDir passed to findPromptFiles() */
    relativePath: string;
    /** File name without .prompt.md suffix (e.g., "fix-bug" from "fix-bug.prompt.md") */
    name: string;
    /** The source folder this file was found in (the location string as passed to the finder) */
    sourceFolder: string;
}

/**
 * Discovered skill metadata.
 *
 * Extends the extension's Skill type (src/shortcuts/shared/skill-files-utils.ts:8-17)
 * with an optional description field parsed from SKILL.md YAML frontmatter.
 */
export interface SkillInfo {
    /** Absolute path to the skill directory (not SKILL.md itself) */
    absolutePath: string;
    /** Path relative to rootDir (e.g., ".github/skills/go-deep") */
    relativePath: string;
    /** Skill name — the directory name (e.g., "go-deep") */
    name: string;
    /** The base folder where skills are stored (e.g., ".github/skills") */
    sourceFolder: string;
    /** Description from SKILL.md YAML frontmatter, if present */
    description?: string;
}
```

### Prompt File Discovery (`discovery/prompt-files.ts`)

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../logger';
import type { PromptFileInfo } from './types';

/** Default location when no locations are specified */
const DEFAULT_PROMPT_LOCATION = '.github/prompts';

/**
 * Discover all .prompt.md files under the given root directory.
 *
 * Adapted from extension's getPromptFiles() + findPromptFilesInFolder()
 * (src/shortcuts/shared/prompt-files-utils.ts:58-121) — same recursive
 * walk logic but with explicit location parameters instead of VS Code
 * settings.
 *
 * @param rootDir   Workspace/project root (absolute path)
 * @param locations Folders to scan, relative to rootDir or absolute.
 *                  Defaults to ['.github/prompts'].
 * @returns Array of discovered prompt files
 */
export async function findPromptFiles(
    rootDir: string,
    locations?: string[]
): Promise<PromptFileInfo[]> { ... }
```

**Algorithm** (matches extension's `findPromptFilesInFolder` line-for-line):

1. `const folders = locations?.length ? locations : [DEFAULT_PROMPT_LOCATION]`
2. For each folder: resolve with `path.isAbsolute(loc) ? loc : path.join(rootDir, loc)`
3. Skip if `!fs.existsSync(folderPath)`
4. Call recursive inner function `scanFolder(folderPath, rootDir, sourceFolder)`
5. Inner function: `fs.readdirSync(folderPath, { withFileTypes: true })`
   - `entry.isDirectory()` → recurse into subdirectory
   - `entry.isFile() && entry.name.endsWith('.prompt.md')` → emit `PromptFileInfo`:
     - `absolutePath`: `path.join(folderPath, entry.name)`
     - `relativePath`: `path.relative(rootDir, fullPath)`
     - `name`: `entry.name.replace('.prompt.md', '')` — **exact match** with extension line 110
     - `sourceFolder`: the original location string (not the resolved absolute)
6. Catch per-folder → `getLogger().debug('Error reading folder ...', error)` — same as extension's `console.error` but using pipeline-core's pluggable logger

### Skill File Discovery (`discovery/skill-files.ts`)

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../logger';
import { DEFAULT_SKILLS_DIRECTORY } from '../config/defaults';
import type { SkillInfo } from './types';

/** Standard skill filename within a skill directory */
const SKILL_PROMPT_FILENAME = 'SKILL.md';

/** Frontmatter regex — same as skill-resolver.ts:207 */
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Description extraction — same as skill-resolver.ts:215 */
const DESCRIPTION_REGEX = /^description:\s*["']?(.+?)["']?\s*$/m;

/**
 * Discover all skills under the skills directory.
 *
 * Merged from extension's getSkills() (skill-files-utils.ts:31-65) and
 * pipeline-core's listSkills() (skill-resolver.ts:169-195). Uses the
 * stricter validation from listSkills() which requires SKILL.md presence
 * (the extension's getSkills() only checks for directories).
 *
 * @param rootDir        Workspace/project root (absolute path)
 * @param skillsLocation Custom skills folder, relative to rootDir or absolute.
 *                       Defaults to '.github/skills' (from config/defaults.ts:162).
 * @returns Array of discovered skills, sorted by name
 */
export async function findSkills(
    rootDir: string,
    skillsLocation?: string
): Promise<SkillInfo[]> { ... }
```

**Algorithm:**

1. `const location = skillsLocation ?? DEFAULT_SKILLS_DIRECTORY` — reuse constant from `config/defaults.ts:162`
2. Resolve: `path.isAbsolute(location) ? location : path.join(rootDir, location)`
3. Return `[]` if `!fs.existsSync(skillsDir)`
4. `fs.readdirSync(skillsDir, { withFileTypes: true })`
5. For each directory entry:
   - Check `fs.existsSync(path.join(skillsDir, entry.name, SKILL_PROMPT_FILENAME))` — skip if missing (matches `listSkills()` at skill-resolver.ts:187-188)
   - Read `SKILL.md` content with `fs.readFileSync(skillMdPath, 'utf-8')`
   - Extract description: match `FRONTMATTER_REGEX`, then `DESCRIPTION_REGEX` on the captured frontmatter block — **exact same regexes** as `parseSkillMetadata()` at skill-resolver.ts:208,215
   - Build `SkillInfo` with `description` set or `undefined`
6. Sort by `name` (`entries.sort((a, b) => a.name.localeCompare(b.name))`) — matches `listSkills()` which calls `.sort()`
7. Catch → `getLogger().debug(...)`, return `[]`

### Barrel Exports (`discovery/index.ts`)

```typescript
export type { PromptFileInfo, SkillInfo } from './types';
export { findPromptFiles } from './prompt-files';
export { findSkills } from './skill-files';
```

### Root Index Update (`src/index.ts`)

Insert after the "Tasks" section (after line 747 `} from './tasks';`):

```typescript
// ============================================================================
// Discovery
// ============================================================================

export {
    // Types
    PromptFileInfo,
    SkillInfo,
    // Prompt file discovery
    findPromptFiles,
    // Skill discovery
    findSkills
} from './discovery';
```

### Package.json Subpath Export

Add after `"./tasks"` in the `"exports"` map:

```json
"./discovery": "./dist/discovery/index.js"
```

Resulting exports: `.`, `./ai`, `./map-reduce`, `./pipeline`, `./utils`, `./tasks`, `./discovery`.

### Key Decisions

1. **No `vscode` dependency** — all functions take explicit `rootDir` + optional location overrides. VS Code settings reading stays in the extension adapter layer.
2. **Async-first API** — returns `Promise<>` matching the extension's signatures, even though current implementation uses `fs.readdirSync`/`fs.readFileSync` internally. Leaves room for async fs migration without breaking callers.
3. **Silent on missing directories** — returns `[]` rather than throwing, matching the extension's `getPromptFiles()` (line 74: skip if `!fs.existsSync`) and pipeline-core's `listSkills()` (line 175: return `[]`).
4. **Reuse `DEFAULT_SKILLS_DIRECTORY`** from `config/defaults.ts:162` (already `'.github/skills'`). Define `DEFAULT_PROMPT_LOCATION = '.github/prompts'` locally in `prompt-files.ts` since no equivalent constant exists in config yet.
5. **Use `getLogger()`** from `../logger` for error logging (consistent with pipeline-core patterns), not `console.error` (the extension pattern).
6. **Description extraction only** — `SkillInfo.description` is the only frontmatter field parsed. The full metadata parsing (name, version, variables, output) already lives in `skill-resolver.ts:203-241` and consumers needing full metadata should use `resolveSkillWithDetails()` from the pipeline module.
7. **`SKILL.md` presence required** — follows the stricter `listSkills()` pattern (skill-resolver.ts:187-188) rather than the extension's `getSkills()` which accepts any subdirectory. This avoids false positives from non-skill directories.

## Tests

### Prompt Files Tests (`test/discovery/prompt-files.test.ts`)

Follow Vitest patterns from `test/pipeline/skill-resolver.test.ts` (lines 8-58): `beforeEach`/`afterEach` with `fs.promises.mkdtemp` + `fs.promises.rm`, import from `'../../src/discovery'`.

- **returns empty for non-existent rootDir** — `findPromptFiles('/no/such/path')` → `[]`
- **returns empty when default location missing** — temp dir with no `.github/prompts/` → `[]`
- **discovers single prompt file** — create `<tmp>/.github/prompts/fix.prompt.md` → verify `name === 'fix'`, `relativePath === '.github/prompts/fix.prompt.md'`, `sourceFolder === '.github/prompts'`, `absolutePath` is correct
- **strips .prompt.md suffix for name** — verify `"my-complex.name.prompt.md"` → `name === 'my-complex.name'`
- **discovers nested prompt files recursively** — create `<tmp>/.github/prompts/sub/deep.prompt.md` → verify found with correct `relativePath`
- **ignores non-.prompt.md files** — create `README.md` and `notes.md` alongside `fix.prompt.md` → only 1 result
- **scans multiple locations** — pass `locations: ['.github/prompts', 'custom/prompts']` with files in both → verify all found with correct `sourceFolder`
- **handles absolute location path** — pass an absolute temp path as a location → verify resolution
- **uses default location when locations omitted** — omit `locations` param → verify scans `.github/prompts`
- **uses default location when empty array** — pass `locations: []` → verify scans `.github/prompts`
- **handles unreadable directory gracefully** — create dir with no read permission (skip on Windows) → `[]`, no throw

### Skill Files Tests (`test/discovery/skill-files.test.ts`)

- **returns empty for non-existent rootDir** — `findSkills('/no/such/path')` → `[]`
- **returns empty when skills directory missing** — temp dir with no `.github/skills/` → `[]`
- **discovers single skill** — create `<tmp>/.github/skills/my-skill/SKILL.md` → verify `name === 'my-skill'`, `relativePath`, `absolutePath`, `sourceFolder === '.github/skills'`
- **excludes directories without SKILL.md** — create `<tmp>/.github/skills/empty-dir/` (no SKILL.md) → not in results
- **excludes files (not directories) in skills dir** — create `<tmp>/.github/skills/README.md` → not in results
- **parses description from YAML frontmatter** — SKILL.md with `---\ndescription: A cool skill\n---\n# Content` → `description === 'A cool skill'`
- **description is undefined without frontmatter** — SKILL.md with just `# My Skill\nDo stuff` → `description === undefined`
- **handles quoted description** — frontmatter `description: "Quoted desc"` → `description === 'Quoted desc'`
- **handles single-quoted description** — frontmatter `description: 'Single quoted'` → `description === 'Single quoted'`
- **returns results sorted by name** — create `z-skill`, `a-skill`, `m-skill` → verify order `[a, m, z]`
- **resolves custom skillsLocation (relative)** — pass `skillsLocation: 'custom/skills'` → verify correct resolution
- **resolves custom skillsLocation (absolute)** — pass absolute temp path → verify resolution
- **handles unreadable directory gracefully** — no throw on permission error

### Test Infrastructure

- Helper: `createPromptFile(relativePath: string, content = '# Prompt')` — creates file at `path.join(tempDir, relativePath)` with `mkdir -p` on parent
- Helper: `createSkill(name: string, skillMdContent = '# Skill')` — creates `<tempDir>/.github/skills/<name>/SKILL.md`
- Both helpers use `fs.promises.mkdir(dir, { recursive: true })` + `fs.promises.writeFile()`

## Acceptance Criteria

- [ ] `packages/pipeline-core/src/discovery/` directory exists with `types.ts`, `prompt-files.ts`, `skill-files.ts`, `index.ts`
- [ ] `PromptFileInfo` and `SkillInfo` types are exported from `@plusplusoneplusplus/pipeline-core` and from `@plusplusoneplusplus/pipeline-core/discovery`
- [ ] `findPromptFiles(rootDir)` with default location discovers `.prompt.md` files recursively under `.github/prompts/`
- [ ] `findPromptFiles(rootDir, locations)` supports custom locations (relative and absolute paths)
- [ ] `findSkills(rootDir)` discovers skills with `SKILL.md` present, parses frontmatter description, returns sorted `SkillInfo[]`
- [ ] `findSkills(rootDir, skillsLocation)` supports custom skills directory path
- [ ] `packages/pipeline-core/package.json` has `"./discovery": "./dist/discovery/index.js"` subpath export
- [ ] `packages/pipeline-core/src/index.ts` has Discovery export section re-exporting all types and functions
- [ ] No `vscode` imports anywhere in `packages/pipeline-core/src/discovery/`
- [ ] All new Vitest tests pass: `cd packages/pipeline-core && npm run test:run`
- [ ] All existing pipeline-core tests still pass (no regressions)
- [ ] `npm run build` in `packages/pipeline-core` succeeds with no type errors

## Dependencies

- Depends on: None
