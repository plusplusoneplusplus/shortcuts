---
status: done
depends_on: [001, 002]
commit: "003"
title: "MemoryCapture — observation extraction via AI follow-up"
---

# 003 — MemoryCapture: observation extraction via AI follow-up

## Summary

Implement the capture logic that extracts observations from AI pipeline results
using a lightweight follow-up prompt, classifies them as repo-level or
system-level, and writes them to the `MemoryStore`.

## Motivation

This is the "write path" — the mechanism that feeds raw observations into
memory. It is separated from `MemoryStore` (pure I/O) because it involves AI
interaction and classification logic. The design doc
(`docs/designs/coc-memory.md`) specifies:

> After each AI call in a memory-enabled pipeline, issue a lightweight
> follow-up prompt… The response is written as a raw observation file with
> metadata header.

## Prior commits this depends on

| Commit | Provides |
|--------|----------|
| 001 | `MemoryLevel`, `MemoryConfig`, `RawObservation`, `MemoryIndex`, `RepoInfo` in `packages/pipeline-core/src/memory/types.ts` |
| 002 | `MemoryStore` class with `writeRaw(level, content, filename, repoPath?)`, `listRawFiles()`, `generateRawFilename()`, atomic tmp→rename writes in `packages/pipeline-core/src/memory/memory-store.ts` |

## Files to create

| File | Purpose |
|------|---------|
| `packages/pipeline-core/src/memory/memory-capture.ts` | Capture logic: follow-up prompt, parse, classify, write |
| `packages/pipeline-core/test/memory/memory-capture.test.ts` | Tests with mocked `AIInvoker` and real FS via temp dir |

## Key types from the codebase

### `AIInvoker` (`packages/pipeline-core/src/map-reduce/types.ts`)

```typescript
export type AIInvoker = (prompt: string, options?: AIInvokerOptions) => Promise<AIInvokerResult>;

export interface AIInvokerOptions {
    model?: string;
    workingDirectory?: string;
    timeoutMs?: number;
}

export interface AIInvokerResult {
    success: boolean;
    response?: string;
    error?: string;
    sessionId?: string;
    tokenUsage?: import('../copilot-sdk-wrapper/types').TokenUsage;
}
```

### Raw observation file format (from design doc)

```markdown
---
pipeline: code-review
timestamp: 2026-02-28T15:00:00Z
repo: github/shortcuts
model: gpt-4
---

- This repo uses Vitest for package tests and Mocha for extension tests
- The team prefers kebab-case file naming
- AGENTS.md files provide important context per directory
```

Written to `~/.coc/memory/system/raw/<timestamp>-<pipeline-id>.md` or
`~/.coc/memory/repos/<repo-hash>/raw/<timestamp>-<pipeline-id>.md`.

## Design

### Follow-up prompt template

```typescript
const CAPTURE_PROMPT = `Given the following task prompt and AI response, list 2-5 concise facts worth remembering for future tasks. Focus on:
- Coding conventions and patterns
- Architecture decisions and structure
- Common gotchas or pitfalls
- Tool/library usage patterns

Prefix each fact with [REPO] if it's specific to this project, or [SYSTEM] if it's a general best practice.

Output as a markdown bullet list. If nothing notable, output "No new observations."

## Original task prompt
{{ORIGINAL_PROMPT}}

## AI response
{{AI_RESPONSE}}`;
```

The prompt includes the original prompt and response as context so the
follow-up model can identify noteworthy facts. Variable substitution follows the
same `substituteVariables` pattern used in pipeline executor
(`packages/pipeline-core/src/pipeline/executor.ts`).

### Interfaces

```typescript
interface CaptureContext {
  pipelineName: string;
  repoPath?: string;
  model?: string;
  originalPrompt: string;  // the prompt that was sent to the AI
  aiResponse: string;       // the response received
}

interface CaptureResult {
  repoObservations: RawObservation | null;
  systemObservations: RawObservation | null;
  skipped: boolean;  // true if "No new observations" or empty
}
```

### Exported functions

```typescript
// Main entry point — orchestrates prompt → parse → classify → write
async function captureObservations(
  aiInvoker: AIInvoker,
  context: CaptureContext,
  store: MemoryStore,
): Promise<CaptureResult>

// Parse the AI follow-up response into classified facts
function parseCaptureFacts(
  response: string,
): Array<{ text: string; level: 'repo' | 'system' }>

// Classify a single fact line by prefix tag or fallback heuristics
function classifyFact(fact: string): 'repo' | 'system'

// Build the YAML frontmatter + markdown body for a RawObservation
function formatRawObservation(
  metadata: { pipeline: string; timestamp: string; repo?: string; model?: string },
  facts: string[],
): string
```

### Classification logic (`classifyFact`)

1. **Prefix tag** (primary): `[REPO]` → `'repo'`, `[SYSTEM]` → `'system'`
2. **Fallback heuristics** (when no tag):
   - Contains file paths (`/`, `.ts`, `.js`, `src/`), specific directory names,
     or project-specific terms (package names, repo name) → `'repo'`
   - Everything else → `'system'`

### `captureObservations` flow

1. Build the follow-up prompt by substituting `{{ORIGINAL_PROMPT}}` and
   `{{AI_RESPONSE}}` into `CAPTURE_PROMPT`.
2. Call `aiInvoker(prompt, { model: context.model })`.
3. If `!result.success` or `!result.response` → log warning, return
   `{ repoObservations: null, systemObservations: null, skipped: false }`.
4. Call `parseCaptureFacts(result.response)`.
5. If empty or response matches `"No new observations"` → return
   `{ ..., skipped: true }`.
6. Partition facts by level into `repoFacts` and `systemFacts`.
7. For each non-empty group, call `formatRawObservation(...)` to build the
   markdown string, generate a filename via `MemoryStore.generateRawFilename(timestamp, pipelineName)`,
   then `store.writeRaw(level, content, filename, context.repoPath)`.
8. Return `CaptureResult` with the written observations.
9. **Entire function is wrapped in try/catch** — errors are logged as warnings
   and never propagated. This matches the design doc's non-blocking requirement.

### `parseCaptureFacts` parsing

Handles common markdown list formats:
- `- [REPO] fact text` / `- [SYSTEM] fact text`
- `* [REPO] fact text`
- `1. [REPO] fact text` (numbered lists)
- Lines without bullets but with prefix tags

Strips the bullet/number prefix, extracts the tag, trims the remaining text.

### `formatRawObservation` output

```typescript
function formatRawObservation(
  metadata: { pipeline: string; timestamp: string; repo?: string; model?: string },
  facts: string[],
): string {
  const frontmatter = [
    '---',
    `pipeline: ${metadata.pipeline}`,
    `timestamp: ${metadata.timestamp}`,
    metadata.repo ? `repo: ${metadata.repo}` : null,
    metadata.model ? `model: ${metadata.model}` : null,
    '---',
  ].filter(Boolean).join('\n');

  const body = facts.map(f => `- ${f}`).join('\n');
  return `${frontmatter}\n\n${body}\n`;
}
```

## Error handling

- The entire `captureObservations` function is wrapped in try/catch.
- On error: log a warning via the pipeline-core logger, return a result with
  `null` observations and `skipped: false`.
- This ensures capture failures never block pipeline execution — consistent with
  the `MemoryStore` pattern of atomic writes and the design doc's stated
  requirement.

## Tests

File: `packages/pipeline-core/test/memory/memory-capture.test.ts`

Use a **mocked `AIInvoker`** (simple async function returning
`AIInvokerResult`) and a **real `MemoryStore`** backed by an OS temp directory
(cleaned up in `afterEach`).

| # | Test case | Setup | Assertion |
|---|-----------|-------|-----------|
| 1 | Successful capture with mixed facts | Mock returns 3 `[REPO]` + 2 `[SYSTEM]` facts | Two raw files written; `CaptureResult` has both observations; file contents match `formatRawObservation` output |
| 2 | All facts are repo-level | Mock returns only `[REPO]` facts | Only repo raw file written; `systemObservations` is `null` |
| 3 | "No new observations" response | Mock returns `"No new observations."` | No files written; `skipped: true` |
| 4 | Empty response | Mock returns `{ success: true, response: '' }` | No files written; `skipped: true` |
| 5 | AI invoker failure | Mock returns `{ success: false, error: 'timeout' }` | No files written; no error thrown; result has `null` observations |
| 6 | AI invoker throws | Mock throws `Error('network')` | No error propagated; result has `null` observations |
| 7 | `classifyFact` with `[REPO]` prefix | Direct call | Returns `'repo'` |
| 8 | `classifyFact` with `[SYSTEM]` prefix | Direct call | Returns `'system'` |
| 9 | `classifyFact` fallback — file path present | `"Uses src/utils/logger.ts for logging"` | Returns `'repo'` |
| 10 | `classifyFact` fallback — general statement | `"Always handle async errors with try/catch"` | Returns `'system'` |
| 11 | `parseCaptureFacts` — dash bullets | `- [REPO] fact\n- [SYSTEM] fact` | Correct array with levels |
| 12 | `parseCaptureFacts` — asterisk bullets | `* [REPO] fact` | Correct parsing |
| 13 | `parseCaptureFacts` — numbered list | `1. [REPO] fact\n2. [SYSTEM] fact` | Correct parsing |
| 14 | `parseCaptureFacts` — mixed with blank lines | Facts separated by blank lines | Blank lines ignored, facts parsed |
| 15 | `formatRawObservation` — full metadata | All fields provided | Valid YAML frontmatter + bullet body |
| 16 | `formatRawObservation` — optional fields omitted | No `repo` or `model` | Frontmatter excludes those keys |

## Acceptance criteria

- [ ] Follow-up prompt includes original prompt + response as context
- [ ] `parseCaptureFacts` handles `-`, `*`, and numbered list formats
- [ ] `classifyFact` uses prefix tags with fallback heuristics
- [ ] Classification correctly separates repo vs system facts
- [ ] Errors in capture never propagate to pipeline execution
- [ ] Raw files written match the YAML frontmatter + markdown format from the design doc
- [ ] Tests cover happy path, all-repo, no-observations, empty, invoker failure, invoker throw
- [ ] All tests pass on Linux, macOS, and Windows (`npm run test:run` in `packages/pipeline-core`)
