# Incremental Seed Update for Auto-Generated Discovery

## Problem

Re-running `deep-wiki discover` regenerates the entire ModuleGraph from scratch, overwriting the cached `module-graph.json`. If the AI missed a topic, the user has no way to manually add modules and have them survive the next discovery run. We need a way to **merge** new modules into an existing cached graph without losing prior entries.

## Proposed Approach

Introduce an **incremental merge** workflow that:
1. Loads the existing cached `module-graph.json` (from `.wiki-cache/`)
2. Accepts a **patch file** — a partial ModuleGraph JSON with new/updated modules
3. Merges the patch into the cached graph (dedup by module `id`, patch wins on conflict)
4. Tags each module with a `source` field (`"ai"` | `"manual"`) so manual entries are identifiable
5. Saves the merged graph back to cache (preserving manual entries across git-hash invalidation)

Three user workflows are supported:
- **CLI merge command**: `deep-wiki merge <repo-path> --patch <file>` — applies a patch file to the cached graph
- **Direct JSON editing**: User edits `wiki/module-graph.json` directly, then runs `deep-wiki discover --use-cache` which picks it up; or uses the merge command to re-import
- **AI-assisted seed addition**: `deep-wiki seeds add <repo-path> --topic "describe topic in natural language"` — uses AI to interpret the user's natural-language description, generate a properly formatted `TopicSeed` entry (with kebab-case `topic`, `description`, and `hints`), and append it to an existing seeds file. The seed-to-graph discovery is still handled by the existing `deep-wiki discover --seeds` flow.

## Acceptance Criteria

- [ ] `ModuleInfo` gains an optional `source?: 'ai' | 'manual'` field; AI discovery sets it to `"ai"`, manual additions use `"manual"`
- [ ] A new `mergeModuleGraphs(base, patch)` function merges two `ModuleGraph` objects: dedup by module `id`, patch entries override base on conflict
- [ ] Manual (`source: "manual"`) modules are preserved when cache is invalidated by git-hash change — they carry forward into the new graph
- [ ] A `deep-wiki merge` CLI command applies a patch file to the existing cached/output graph
- [ ] `deep-wiki discover --incremental` re-discovers but merges results into the existing cached graph instead of replacing it
- [ ] Duplicate detection matches on `ModuleInfo.id` (primary) with fallback warning on `ModuleInfo.path` collision
- [ ] `deep-wiki seeds add <repo-path> --topic "<natural language>"` uses AI to generate a `TopicSeed` from the user's description and appends it to the seeds file
- [ ] `seeds add` supports `--seeds <path>` to specify the target seeds file (defaults to `seeds.json`)
- [ ] `seeds add` deduplicates against existing seeds (skips if a seed with the same `topic` id already exists)
- [ ] Tests cover: merge logic, dedup, conflict resolution, manual-entry preservation across cache invalidation, AI-driven seed addition

## Workplan

### Phase 1: Type & Merge Core

- [ ] **1.1 Add `source` field to `ModuleInfo`** (`types.ts`)
  - Add `source?: 'ai' | 'manual'` to `ModuleInfo` interface
  - Backward-compatible (optional field, existing graphs without it remain valid)

- [ ] **1.2 Create `merge.ts` module** (`packages/deep-wiki/src/merge.ts`)
  - `mergeModuleGraphs(base: ModuleGraph, patch: ModuleGraph): MergeResult`
  - Merge strategy:
    - **Modules**: Match by `id`. If patch module has same `id` as base → patch wins (deep-merge fields). New `id`s → append. Base-only modules preserved.
    - **Categories**: Union by `name`. Patch description wins on conflict.
    - **Areas**: Union by `id`. Patch wins on conflict. Update `modules[]` lists.
    - **Project info**: Patch wins for non-empty fields.
    - **Architecture notes**: Concatenate with separator if both non-empty.
  - `MergeResult`: `{ graph: ModuleGraph; added: string[]; updated: string[]; unchanged: string[] }`
  - `loadPatchFile(filePath: string): ModuleGraph` — parse a partial JSON file (allows omitting `project`/`categories`/`architectureNotes`)

- [ ] **1.3 Tests for merge logic** (`test/merge.test.ts`)
  - Merge two disjoint graphs
  - Merge with overlapping module ids (patch wins)
  - Merge with `source` field preservation
  - Partial patch file (missing `project`, `categories`)
  - Empty patch / empty base
  - Category dedup
  - Area merging and module list updates

### Phase 2: Cache Integration

- [ ] **2.1 Preserve manual modules across cache invalidation** (`cache/index.ts`)
  - In `getCachedGraph()`: when git-hash doesn't match, instead of returning `null`, extract modules where `source === 'manual'` and return them as `manualModules` in a new return type
  - New helper: `extractManualModules(graph: ModuleGraph): ModuleInfo[]`
  - After fresh discovery, auto-merge preserved manual modules back into the new graph

- [ ] **2.2 Tag AI-discovered modules** (`discovery/`, `commands/discover.ts`)
  - After `discoverModuleGraph()` or `runIterativeDiscovery()` returns, tag all modules with `source: 'ai'` (if not already tagged)
  - Ensures all AI results are distinguishable from manual additions

### Phase 3: CLI Commands

- [ ] **3.1 Add `deep-wiki merge` command** (`commands/merge.ts`, `cli.ts`)
  - `deep-wiki merge <repo-path> --patch <file> [--output <dir>]`
  - Flow: Load cached graph → load patch file → `mergeModuleGraphs()` → save merged graph → print summary
  - If no cached graph exists, use patch as the full graph
  - Validates patch file structure before merging

- [ ] **3.2 Add `--incremental` flag to `discover`** (`commands/discover.ts`, `cli.ts`)
  - When `--incremental` is passed: load existing cached graph (any hash) → run discovery → merge new AI results into cached graph (manual entries preserved) → save
  - Without `--incremental`: current behavior (full replace)

- [ ] **3.3 Add `--incremental` flag to `generate`** (`commands/generate.ts`, `cli.ts`)
  - Pass-through to Phase 1 (discovery) when `--incremental` is set
  - Phase 2/3/4 remain unchanged (they already support incremental analysis)

- [ ] **3.4 Register commands in CLI** (`cli.ts`)
  - Add `merge` command with options
  - Add `--incremental` option to `discover` and `generate`

### Phase 3.5: AI-Assisted Seed Addition

- [ ] **3.5.1 Create `seeds add` subcommand** (`commands/seeds-add.ts`, `cli.ts`)
  - `deep-wiki seeds add <repo-path> --topic "<natural language description>" [--seeds <path>]`
  - Flow:
    1. Load existing seeds file (if it exists at `--seeds` path, default `seeds.json`)
    2. Send the user's `--topic` text to AI with a prompt asking it to generate a `TopicSeed` JSON object (`{ topic, description, hints }`)
    3. The AI prompt includes:
       - The user's natural-language topic description
       - The list of existing seed topics (for dedup awareness and consistency)
       - Instructions to output a valid `TopicSeed` with kebab-case `topic`, concise `description`, and relevant `hints[]`
    4. Parse the AI response to extract the `TopicSeed`
    5. Deduplicate: if a seed with the same `topic` id already exists, warn and skip (or update with `--force`)
    6. Append the new seed to the `topics[]` array in the seeds file
    7. Write back the updated seeds file
  - Options:
    - `--topic <text>` (required) — Natural-language description of the topic to add
    - `--seeds <path>` — Path to seeds file (default: `seeds.json`)
    - `--force` — Overwrite if a seed with the same topic id already exists
    - `-m, --model <model>` — AI model override
  - Example usage:
    ```bash
    # Add a topic about OAuth authentication
    deep-wiki seeds add ./my-repo --topic "OAuth2 authentication flow with JWT tokens"
    
    # Add to a specific seeds file
    deep-wiki seeds add ./my-repo --topic "database migration system" --seeds my-seeds.json
    
    # Force-update an existing topic
    deep-wiki seeds add ./my-repo --topic "improved auth description" --force
    ```

- [ ] **3.5.2 Create AI prompt for seed generation** (`seeds/add-topic-prompt.ts`)
  - Prompt template that takes:
    - `userTopic: string` — the user's natural-language description
    - `existingTopics: TopicSeed[]` — current seeds for context/dedup
  - Instructs AI to return a single JSON object:
    ```json
    {
      "topic": "kebab-case-id",
      "description": "1-2 sentence description of the topic",
      "hints": ["search", "terms", "to", "find", "related", "code"]
    }
    ```
  - AI does NOT scan the codebase in this step — it purely formats the user's intent into a structured seed entry
  - The prompt provides existing topic names so the AI can avoid duplicates and maintain naming consistency

- [ ] **3.5.3 Create response parser** (`seeds/add-topic-parser.ts`)
  - Parse AI response to extract `TopicSeed` JSON
  - Validate: `topic` is non-empty kebab-case, `description` is non-empty, `hints` is a non-empty array
  - Normalize `topic` via `normalizeModuleId()`
  - Handle edge cases: AI returns markdown-wrapped JSON, extra text around JSON, etc.

- [ ] **3.5.4 Register `seeds add` as a subcommand in CLI** (`cli.ts`)
  - Add `seeds` as a command group with subcommands:
    - `deep-wiki seeds generate <repo-path>` (existing functionality, renamed from bare `seeds`)
    - `deep-wiki seeds add <repo-path> --topic "..."` (new)
  - Backward-compatible: if `seeds` is called without subcommand, default to `generate` behavior

- [ ] **3.5.5 Tests for AI seed addition** (`test/seeds/add-topic.test.ts`)
  - AI prompt includes user topic and existing seeds
  - Response parser extracts valid TopicSeed
  - Deduplication: skip when topic id already exists
  - Force mode: overwrite existing topic
  - Seeds file created if it doesn't exist
  - Seeds file updated with new entry appended
  - Invalid AI response handling (retry or error)

### Phase 4: Tests & Edge Cases

- [ ] **4.1 Merge command integration tests** (`test/commands/merge.test.ts`)
  - Apply patch to cached graph
  - Apply patch when no cache exists
  - Invalid patch file handling

- [ ] **4.2 Incremental discover tests** (`test/commands/discover-incremental.test.ts`)
  - Discover with `--incremental` preserves manual modules
  - Cache invalidation + manual preservation

- [ ] **4.3 Cache preservation tests** (`test/cache/manual-preservation.test.ts`)
  - `extractManualModules` extracts only `source: 'manual'` entries
  - Git-hash change preserves manual modules when `--incremental`

## File Changes Summary

| File | Change |
|------|--------|
| `packages/deep-wiki/src/types.ts` | Add `source?: 'ai' \| 'manual'` to `ModuleInfo` |
| `packages/deep-wiki/src/merge.ts` | **New** — merge logic + patch loader |
| `packages/deep-wiki/src/cache/index.ts` | Add `extractManualModules()`, update `getCachedGraph` variant |
| `packages/deep-wiki/src/commands/merge.ts` | **New** — merge command handler |
| `packages/deep-wiki/src/commands/discover.ts` | Add `--incremental` flow, tag AI modules |
| `packages/deep-wiki/src/commands/generate.ts` | Pass `--incremental` to Phase 1 |
| `packages/deep-wiki/src/commands/seeds-add.ts` | **New** — `seeds add` subcommand handler |
| `packages/deep-wiki/src/seeds/add-topic-prompt.ts` | **New** — AI prompt template for seed generation |
| `packages/deep-wiki/src/seeds/add-topic-parser.ts` | **New** — Response parser for AI-generated TopicSeed |
| `packages/deep-wiki/src/cli.ts` | Register `merge` command, add `--incremental` option, refactor `seeds` to command group with `generate`/`add` subcommands |
| `packages/deep-wiki/test/merge.test.ts` | **New** — merge logic tests |
| `packages/deep-wiki/test/commands/merge.test.ts` | **New** — merge command tests |
| `packages/deep-wiki/test/seeds/add-topic.test.ts` | **New** — AI seed addition tests |
| `packages/deep-wiki/test/cache/manual-preservation.test.ts` | **New** — cache preservation tests |

## Patch File Format

Users create a partial `ModuleGraph` JSON to add modules:

```json
{
  "modules": [
    {
      "id": "auth-oauth",
      "name": "OAuth Authentication",
      "path": "src/auth/oauth/",
      "purpose": "Handles OAuth2 login flows",
      "keyFiles": ["src/auth/oauth/handler.ts"],
      "dependencies": ["auth-core"],
      "dependents": [],
      "complexity": "medium",
      "category": "auth",
      "source": "manual"
    }
  ],
  "categories": [
    { "name": "auth", "description": "Authentication modules" }
  ]
}
```

Fields like `project` and `architectureNotes` are optional in the patch — only provided fields are merged.

## AI-Assisted Seed Addition

Instead of manually writing JSON seed entries, users describe topics in natural language:

```bash
# User describes a topic they want covered
deep-wiki seeds add ./my-repo --topic "OAuth2 authentication flow with JWT tokens and refresh token rotation"

# AI generates:
# {
#   "topic": "oauth2-authentication",
#   "description": "OAuth2 authentication flow including JWT token issuance, validation, and refresh token rotation",
#   "hints": ["oauth", "jwt", "token", "refresh", "authentication", "login", "authorize"]
# }

# The generated seed is appended to seeds.json
# Then run discovery with the updated seeds:
deep-wiki discover ./my-repo --seeds seeds.json
```

**How it works:**
1. User provides a natural-language `--topic` description
2. AI interprets the description and generates a structured `TopicSeed` entry (no codebase scanning — pure text formatting)
3. The AI sees existing seed topics for naming consistency and dedup awareness
4. The new seed is appended to the seeds file
5. The existing `deep-wiki discover --seeds` flow uses the updated seed list for breadth-first discovery

**Why AI instead of manual JSON?**
- Users don't need to know the `TopicSeed` schema
- AI generates appropriate kebab-case `topic` ids automatically
- AI produces relevant `hints[]` search terms that improve discovery quality
- AI maintains naming consistency with existing seeds
- Lower friction → users are more likely to add missing topics

## Design Decisions

1. **Module `id` as merge key** — `id` is already required to be unique kebab-case. Path collision with different id triggers a warning but allows both entries.
2. **Patch wins on conflict** — When the same `id` exists in both base and patch, patch values replace base values field-by-field. This lets users correct AI-discovered entries.
3. **Manual entries survive cache invalidation** — When git hash changes, manual modules are extracted and re-merged after fresh discovery. This is the key behavior that makes the workflow usable.
4. **Separate `merge` command vs `--incremental` flag** — The `merge` command is for manual patch files; `--incremental` is for re-discovery that preserves manual edits. Both use the same `mergeModuleGraphs()` core.
5. **AI seed addition is text-only** — The `seeds add` command uses AI purely for natural-language-to-structured-data conversion. It does NOT scan the codebase. Codebase analysis happens later during `discover --seeds`, keeping the two concerns cleanly separated.
6. **`seeds` becomes a command group** — The existing `deep-wiki seeds` command becomes `deep-wiki seeds generate` (with backward-compatible default), and `deep-wiki seeds add` is the new subcommand. This follows the established CLI pattern and avoids a proliferation of top-level commands.

## Notes

- Existing cached graphs without `source` fields remain valid — modules without `source` are treated as `"ai"` by default
- The `mergeModuleGraphs` function is pure (no side effects) and independently testable
- Large repo `areas` field is handled: areas are union-merged by `id`, and area `modules[]` lists are updated to include new module ids
- Edge case: if a manually-added module references files that no longer exist in the repo, `deep-wiki discover --incremental` should log a warning but keep the module (user may be documenting planned/removed code)
- The `seeds add` AI prompt is lightweight (no MCP tools needed) — it can use a pooled session (`usePool: true`) for speed
- If the seeds file doesn't exist when running `seeds add`, a new `SeedsOutput` file is created with the single generated topic
