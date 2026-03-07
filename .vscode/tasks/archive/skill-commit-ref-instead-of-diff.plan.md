# Plan: Skill Against Commit — Pass Reference Instead of Full Diff

## Problem

When running a skill (code review) against a commit, commit range, or outgoing changes via the
map-reduce AI path (`aiProcess` / `editor` output modes), the full diff text is embedded directly
in every AI call through the `{{diff}}` placeholder in `DEFAULT_REVIEW_PROMPT_TEMPLATE`.

This causes:
- Enormous prompt sizes for large diffs (repeated N times, once per rule)
- Wasted tokens since modern AI can retrieve the diff itself via `git show` / `git diff`
- Inconsistency with the clipboard path, which already passes commit SHA + instructions correctly

The **clipboard path** already does this right via `buildSingleRulePrompt()` in
`code-review-service.ts` — it outputs commit hash/range and tells the AI how to retrieve the diff.
The **map-reduce AI path** ignores this and still embeds the raw diff.

## Proposed Approach

Extend `CodeReviewInput` (pipeline-core) to carry an optional `commitReference` descriptor.
When set, the mapper builds a prompt that tells the AI *how to fetch the diff* rather than
embedding the diff inline.

The VS Code command layer stops fetching the raw diff for commits/staged/pending and instead
packages the reference metadata into `commitReference`.

---

## Key Files

| File | Role |
|------|------|
| `packages/pipeline-core/src/map-reduce/jobs/code-review-job.ts` | `CodeReviewInput`, `DEFAULT_REVIEW_PROMPT_TEMPLATE`, `CodeReviewMapper.buildPrompt()`, splitter |
| `src/shortcuts/code-review/code-review-commands.ts` | fetches diff, creates `CodeReviewInput`, triggers map-reduce |
| `src/shortcuts/code-review/code-review-service.ts` | `buildSingleRulePrompt()` (reference for correct commit prompt) |

---

## Todos

### 1. Extend `CodeReviewInput` with `commitReference`

In `code-review-job.ts`, add an optional field:

```typescript
export interface CommitReference {
  type: 'commit' | 'range' | 'pending' | 'staged';
  repositoryRoot: string;
  /** For type 'commit' */
  commitSha?: string;
  commitMessage?: string;
  /** For type 'range' */
  baseRef?: string;
  headRef?: string;
}

export interface CodeReviewInput {
  /** Inline diff content — use when diff is already available and small */
  diff?: string;
  /** Commit/range reference — AI retrieves diff via git tools */
  commitReference?: CommitReference;
  rules: Rule[];
  context?: ...;
}
```

Make `diff` optional (currently required). Require exactly one of `diff` or `commitReference`.

### 2. Update `CodeReviewMapper.buildPrompt()` in pipeline-core

Replace the hardcoded `{{diff}}` section with conditional logic:

- If `diff` is provided (and no `commitReference`): keep current behavior (embed inline diff)
- If `commitReference` is provided: build instructions similar to what `buildSingleRulePrompt()`
  already does — include `Repository`, `Commit`/`Range`, and git commands to retrieve the diff

Update `DEFAULT_REVIEW_PROMPT_TEMPLATE` or split it into two templates (with-diff / with-ref).

### 3. Update splitter in `createCodeReviewJob()`

The splitter currently passes `targetContent: input.diff` as the `targetContent` for each work
item. Change this to pass either the diff string or a serialised reference string (used by the
mapper to decide which prompt variant to build).

Alternative: pass the `CommitReference` directly on `RuleWorkItemData`.

### 4. Update VS Code `code-review-commands.ts`

For the `aiProcess`/`editor` path, stop fetching the raw diff for:
- `reviewCommit` — pass `commitReference: { type: 'commit', commitSha, repositoryRoot, ... }`
- `reviewPending` — pass `commitReference: { type: 'pending', repositoryRoot }`
- `reviewStaged` — pass `commitReference: { type: 'staged', repositoryRoot }`
- `reviewRange` — pass `commitReference: { type: 'range', baseRef, headRef, repositoryRoot }`

The raw diff fetch can be removed for these cases (or kept only for stats/metadata like
`filesChanged`).

> **Note:** The clipboard/fallback path (`buildSingleRulePrompt`) already handles this correctly
> and does NOT need changes.

### 5. Update tests

- `packages/pipeline-core/` Vitest tests for `code-review-job.ts` — add cases for
  `commitReference` input, verify prompt contains git commands instead of raw diff
- `src/` Mocha tests for `code-review-commands.ts` if they exist — verify `diff` is no longer
  fetched for commits in AI mode

---

## Out of Scope

- Changing the clipboard path (already correct)
- Changing behavior when `diff` is explicitly provided (non-commit use cases, e.g. arbitrary diff)
- Changing the UI or result rendering

---

## Notes

- The map-reduce job runs one AI call **per rule**. Removing the diff from each reduces prompt
  size by O(rulesCount × diffSize).
- AI already has MCP/git tools available in these sessions, so `git show <sha>` works.
- For the `pending` and `staged` types, the AI needs to run in the correct `repositoryRoot`
  working directory — ensure this is passed in the prompt.
- `isDiffLarge()` in `code-review-service.ts` may no longer be needed for commits once this is in
  place, but keep it for now (may still be used for stats UI).
