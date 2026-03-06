---
status: pending
---

# 001: pipeline-core — add template types and replication service

## Summary

Create a new `src/templates/` module in `packages/pipeline-core/` that defines the template type system and a commit-replication service. The module provides:

- Discriminated-union `Template` types with a `CommitTemplate` specialisation
- A prompt builder that constructs an AI prompt from commit metadata, diff, and user instruction
- A response parser that extracts structured `FileChange[]` from the AI's `=== FILE ===` block output format
- An orchestrating `replicateCommit()` function that wires git introspection → prompt building → AI invocation → response parsing

## Motivation

Template-based commit replication lets users point at an existing commit ("do it like this one") and have the AI produce analogous changes in a different context. This is the foundational building block for the `coc` template-commit feature. By placing the pure logic in `pipeline-core` (no VS Code deps), it stays reusable across the CLI, server, and extension.

## Changes

### Files to Create

- `packages/pipeline-core/src/templates/types.ts` — Template type hierarchy and replication I/O types
- `packages/pipeline-core/src/templates/prompt-builder.ts` — `buildReplicatePrompt()` function
- `packages/pipeline-core/src/templates/result-parser.ts` — `parseReplicateResponse()` function
- `packages/pipeline-core/src/templates/replicate-service.ts` — `replicateCommit()` orchestrator
- `packages/pipeline-core/src/templates/index.ts` — barrel re-exports
- `packages/pipeline-core/test/templates/prompt-builder.test.ts` — unit tests for prompt builder
- `packages/pipeline-core/test/templates/result-parser.test.ts` — unit tests for response parser
- `packages/pipeline-core/test/templates/replicate-service.test.ts` — integration test with mocked AIInvoker

### Files to Modify

- `packages/pipeline-core/src/index.ts` — add a new `// Templates` section re-exporting from `'./templates'`

## Implementation Notes

### `types.ts`

```typescript
/** Base template — `kind` is a discriminated union tag for future extensibility. */
export interface Template {
  name: string;
  kind: 'commit'; // extend with | 'snippet' | 'diff' later
  description?: string;
  hints?: string[];
}

/** Commit-flavoured template — references an existing commit by hash. */
export interface CommitTemplate extends Template {
  kind: 'commit';
  commitHash: string;
}

/** Input for `replicateCommit()`. */
export interface ReplicateOptions {
  template: CommitTemplate;
  repoRoot: string;
  instruction: string;
}

/** A single file change produced by the AI. */
export interface FileChange {
  path: string;
  content: string;
  status: 'new' | 'modified' | 'deleted';
  explanation?: string;
}

/** Return value of `replicateCommit()`. */
export interface ReplicateResult {
  files: FileChange[];
  summary: string;
}
```

No runtime code — pure type declarations. Export everything.

### `prompt-builder.ts`

**Signature:**

```typescript
import { GitCommitFile } from '../git';

export function buildReplicatePrompt(
  commit: { hash: string; shortHash: string; subject: string },
  diff: string,
  files: GitCommitFile[],
  instruction: string,
  hints?: string[],
): string;
```

**Prompt structure (template literal):**

1. **Role preamble** — "You are a code-generation assistant. You will be shown an example commit (the 'template') and an instruction describing what analogous change to produce."
2. **Template commit section** — Heading `## Template Commit`, the commit hash + subject, then a fenced `diff` block containing the full diff, then a bullet-list of the files with their status (map `GitCommitFile.status` chars `A`→`new`, `M`→`modified`, `D`→`deleted`, `R`→`modified`, `C`→`new`).
3. **Instruction section** — Heading `## Instruction`, the user-supplied `instruction` string verbatim.
4. **Hints section** (optional) — If `hints` is non-empty, heading `## Hints` followed by a numbered list.
5. **Output format section** — Heading `## Output Format`, instruct the model to emit each file as:
   ```
   === FILE: <relative-path> (<status>) ===
   <file content or diff>
   === END FILE ===
   ```
   where `<status>` is one of `new`, `modified`, `deleted`. For `deleted` files, content can be empty. After all file blocks, emit a line `=== SUMMARY ===` followed by a brief summary paragraph.

**Edge cases:**

- If `diff` is empty string, include a note "(empty diff — this was likely an empty or merge commit)".
- If `files` is empty, omit the file list bullet section.
- Trim trailing whitespace from the assembled prompt.

**Status mapping helper** (internal, not exported):

```typescript
function mapGitStatus(s: GitCommitFile['status']): FileChange['status'] {
  switch (s) {
    case 'added': return 'new';
    case 'deleted': return 'deleted';
    default: return 'modified'; // modified, renamed, copied → modified
  }
}
```

Note: `GitCommitFile.status` uses the `GitChangeStatus` union type which has string values `'modified'`, `'added'`, `'deleted'`, `'renamed'`, `'copied'`, etc. — **not** single-letter codes. The `git-log-service.ts` `parseFileLine()` already maps git letters to these strings. So the mapping function above works against the string union, not raw git letters.

### `result-parser.ts`

**Signature:**

```typescript
import { FileChange } from './types';

export function parseReplicateResponse(aiOutput: string): { files: FileChange[]; summary: string };
```

**Parsing algorithm:**

1. Split `aiOutput` by lines.
2. Walk lines with a simple state machine:
   - **State `idle`**: look for `=== FILE: <path> (<status>) ===` via regex `/^=== FILE:\s*(.+?)\s*\((\w+)\)\s*===$/`. On match, transition to `inFile`, capture `path` and `status`.
   - **State `inFile`**: accumulate content lines. On `=== END FILE ===` (exact or trimmed match), push a `FileChange` and return to `idle`.
   - On `=== SUMMARY ===` (trimmed match), transition to `inSummary`.
   - **State `inSummary`**: accumulate remaining lines as the summary text.
3. If parsing finishes with an open `inFile` block (no `END FILE`), flush whatever was accumulated as the last file — be lenient.
4. Return `{ files, summary }`. If no `=== SUMMARY ===` marker found, set `summary` to `''`.

**Normalisation:**

- `status` string from the regex is lower-cased and validated against `'new' | 'modified' | 'deleted'`. Unknown values default to `'modified'`.
- `content` trailing newline is trimmed (single trailing `\n` only).
- `path` is trimmed of whitespace.

### `replicate-service.ts`

**Signature:**

```typescript
import { GitLogService } from '../git';
import { AIInvoker } from '../map-reduce';
import { ReplicateOptions, ReplicateResult, FileChange } from './types';
import { buildReplicatePrompt } from './prompt-builder';
import { parseReplicateResponse } from './result-parser';

export type ReplicateProgressCallback = (stage: string, detail?: string) => void;

export async function replicateCommit(
  options: ReplicateOptions,
  aiInvoker: AIInvoker,
  onProgress?: ReplicateProgressCallback,
): Promise<ReplicateResult>;
```

**Implementation steps (sequential):**

1. `onProgress?.('git', 'Reading commit metadata…')` — Instantiate `new GitLogService()`. Call `gitLog.getCommit(options.repoRoot, options.template.commitHash)`. If `undefined`, throw a `PipelineCoreError` with code `TEMPLATE_COMMIT_NOT_FOUND` and a message including the hash. (Import `PipelineCoreError` from `'../errors'`; add the new error code to the enum if it doesn't exist — or use an existing generic code like `INVALID_INPUT`.)
2. `onProgress?.('git', 'Reading commit diff…')` — Call `gitLog.getCommitDiff(options.repoRoot, options.template.commitHash)`.
3. `onProgress?.('git', 'Reading changed files…')` — Call `gitLog.getCommitFiles(options.repoRoot, options.template.commitHash)`.
4. `onProgress?.('prompt', 'Building prompt…')` — Call `buildReplicatePrompt(commit, diff, files, options.instruction, options.template.hints)`.
5. `onProgress?.('ai', 'Invoking AI…')` — Call `const result = await aiInvoker(prompt)`. If `!result.success`, throw a `PipelineCoreError` with code `AI_INVOCATION_FAILED` (or existing equivalent) including `result.error`.
6. `onProgress?.('parse', 'Parsing response…')` — Call `parseReplicateResponse(result.response!)`.
7. Return `{ files: parsed.files, summary: parsed.summary }`.

**Error handling:**

- The function wraps the entire body in try/catch. Known `PipelineCoreError`s are re-thrown. Unknown errors are wrapped in a `PipelineCoreError` with a generic code.
- After step 3, dispose the `GitLogService` instance (`gitLog.dispose()` — the class has a `dispose()` method that clears caches).

### `index.ts`

Barrel file — export everything public:

```typescript
export {
  Template,
  CommitTemplate,
  ReplicateOptions,
  FileChange,
  ReplicateResult,
} from './types';
export { buildReplicatePrompt } from './prompt-builder';
export { parseReplicateResponse } from './result-parser';
export { replicateCommit, ReplicateProgressCallback } from './replicate-service';
```

### `packages/pipeline-core/src/index.ts` modification

Add a new section after the last existing export block (follow the codebase pattern of `// ===…===` section headers):

```typescript
// ============================================================================
// Templates
// ============================================================================
export {
  Template,
  CommitTemplate,
  ReplicateOptions,
  FileChange,
  ReplicateResult,
  buildReplicatePrompt,
  parseReplicateResponse,
  replicateCommit,
  ReplicateProgressCallback,
} from './templates';
```

**Name collision check:** `FileChange` does not conflict with existing exports (verify with a search — the git module uses `GitChange` and `GitCommitFile`, not `FileChange`).

## Tests

### `test/templates/prompt-builder.test.ts`

Pure unit tests — no git access needed.

1. **"includes commit info and diff"** — Call `buildReplicatePrompt({ hash: 'abc123', shortHash: 'abc1', subject: 'Add foo' }, 'diff --git a/foo ...', [], 'Do the same for bar')`. Assert the result contains `abc123`, `Add foo`, the diff text, and `Do the same for bar`.
2. **"maps file statuses correctly"** — Provide `files` array with `status: 'added'`, `'modified'`, `'deleted'`, `'renamed'`. Assert output contains the corresponding human-readable statuses (`new`, `modified`, `deleted`, `modified`).
3. **"includes hints when provided"** — Pass `hints: ['Keep it short', 'Use TypeScript']`. Assert both strings appear in output.
4. **"omits hints section when hints is empty or undefined"** — Assert output does not contain `## Hints`.
5. **"handles empty diff gracefully"** — Pass `diff: ''`. Assert output contains the "(empty diff" note.
6. **"includes output format instructions"** — Assert output contains `=== FILE:` and `=== END FILE ===` and `=== SUMMARY ===`.

### `test/templates/result-parser.test.ts`

Pure unit tests — string-in, struct-out.

1. **"parses single new file"** — Input with one `=== FILE: src/foo.ts (new) ===` block and a `=== SUMMARY ===`. Assert one `FileChange` with correct path, status, content, and summary string.
2. **"parses multiple files"** — Three file blocks (new, modified, deleted). Assert `files.length === 3` and each has correct status.
3. **"handles deleted file with empty content"** — Assert `content` is `''`.
4. **"handles missing END FILE marker gracefully"** — Omit the `=== END FILE ===` for the last block. Assert the file is still captured.
5. **"handles missing SUMMARY marker"** — Omit `=== SUMMARY ===`. Assert `summary` is `''`.
6. **"normalises unknown status to modified"** — Use `(updated)` as status. Assert parsed status is `'modified'`.
7. **"trims path whitespace"** — Add spaces around path. Assert `path` is trimmed.
8. **"handles completely empty input"** — Empty string returns `{ files: [], summary: '' }`.

### `test/templates/replicate-service.test.ts`

Integration test with mocked `AIInvoker`.

1. **Setup:** Create a mock `AIInvoker` that returns `{ success: true, response: '<well-formed AI output>' }`. The canned response should include 2 file blocks and a summary.
2. **"replicateCommit returns expected FileChange array"** — Use the real `GitLogService` against the current repo. Pick a known commit hash (e.g., `git log --oneline -1` — or use `HEAD`). Call `replicateCommit()` with the mock invoker. Assert `result.files.length === 2` and `result.summary` is non-empty.
3. **"throws on unknown commit hash"** — Pass a non-existent hash like `0000000000000000000000000000000000000000`. Assert the function throws with an error mentioning the hash.
4. **"throws when AI invocation fails"** — Mock invoker returns `{ success: false, error: 'quota exceeded' }`. Assert error propagates.
5. **"calls onProgress with expected stages"** — Pass a `vi.fn()` for `onProgress`. Assert it was called with stages `'git'`, `'prompt'`, `'ai'`, `'parse'` in order.

## Acceptance Criteria

- [ ] `packages/pipeline-core/src/templates/types.ts` exports `Template`, `CommitTemplate`, `ReplicateOptions`, `FileChange`, `ReplicateResult`
- [ ] `buildReplicatePrompt()` produces a prompt containing the commit diff, file list, instruction, optional hints, and the `=== FILE ===` output format instructions
- [ ] `parseReplicateResponse()` correctly extracts `FileChange[]` and summary from well-formed and edge-case AI output
- [ ] `replicateCommit()` orchestrates git → prompt → AI → parse and returns `ReplicateResult`
- [ ] `replicateCommit()` throws descriptive errors for missing commits and failed AI calls
- [ ] `replicateCommit()` calls `onProgress` at each stage
- [ ] All new types and functions are re-exported from `packages/pipeline-core/src/index.ts`
- [ ] All three test files pass: `cd packages/pipeline-core && npx vitest run test/templates/`
- [ ] `npm run build` succeeds with no type errors in the new module
- [ ] No existing tests are broken

## Dependencies

- Depends on: None

## Assumed Prior State

None — this is the first commit.
