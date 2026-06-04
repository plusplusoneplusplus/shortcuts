---
name: classify-diff
description: Classify every hunk in a pull request or commit diff by change type (logic, mechanical, test, simple, generated) so reviewers can focus on what matters.
metadata:
  author: Yiheng Tao
  version: "0.0.2"
---

# Classify Diff — Focused PR Review

Classify each `@@` hunk in a pull request or commit diff into exactly one category so the UI can visually de-emphasize low-attention changes and highlight review-critical edits.

## When to Use

- The user clicks "Classify" on a PR or commit diff review surface.
- The system needs to produce a per-hunk classification for a pull request, commit, or branch-range diff.

## What Counts as a Hunk

A **hunk** is one `@@ ... @@` block in the unified diff — exactly as git emits it. The `hunkIndex` you assign is the 0-based position of that `@@` block within the file's diff (first `@@` block = 0, second = 1, ...).

**Emit exactly one classification entry per physical `@@` block.** Do NOT subdivide a single `@@` block into multiple conceptual entries (e.g. "imports" vs "implementation"), and do NOT emit more entries for a file than it has `@@` blocks. A large contiguous block with no intervening context lines is still a single `@@` hunk and gets a single entry — pick the **dominant** category for it (logic outranks test outranks mechanical outranks generated). Emitting an out-of-range `hunkIndex` causes that classification to be dropped from the reviewer's diff view.

## Classification Categories

| Category | Description | Examples |
|----------|-------------|---------|
| `logic` | Non-trivial behavior/API/data-flow/error-handling changes or high-intensity logic that reviewers should read | Changed conditional, modified return value, API contract change, persistence/error-handling behavior |
| `mechanical` | Structural changes with no behavioral impact — renames, moves, formatting, import reordering | Variable rename, whitespace cleanup, import sort |
| `test` | Test code — new tests, modified assertions, test fixtures, test utilities | New test case, updated assertion, mock data |
| `simple` | Straightforward deterministic function additions/changes with no meaningful branching, persistence, I/O, validation, authorization, error handling, concurrency, external calls, or cross-file side effects | Pure format helper, direct value mapper, simple deterministic string/array transform |
| `generated` | Auto-generated or machine-produced code — lock files, build artifacts, codegen output | `package-lock.json` changes, protobuf output, schema migrations |

## Intensity Levels

Each classification also includes an intensity:

| Intensity | Meaning |
|-----------|---------|
| `high` | Core change — deserves careful review (e.g. new business logic, critical bug fix, complex test) |
| `low` | Minor change within the category (e.g. small refactor, trivial test update, simple rename) |

## Output

Call the `saveClassification` tool exactly once at the end with the full array of per-hunk classifications. The tool persists the result and validates the schema — if it returns an error, fix the offending entries and call it again.

Each classification entry has this shape:

```json
{
  "file": "src/server/auth.ts",
  "hunkIndex": 0,
  "category": "logic",
  "intensity": "high",
  "reason": "Adds JWT token refresh logic with expiry check",
  "summaryComment": "Refresh now rejects expired tokens before issuing a new access token.",
  "critical": {
    "label": "auth API",
    "impactSummary": "Token refresh behavior affects every authenticated client.",
    "usages": [
      {
        "file": "src/server/routes/auth.ts",
        "symbol": "refreshToken",
        "line": 42,
        "description": "Route handler invokes the changed refresh helper."
      }
    ],
    "callPath": [
      { "file": "src/server/routes/auth.ts", "symbol": "POST /auth/refresh" },
      { "file": "src/server/auth.ts", "symbol": "refreshToken" }
    ]
  }
}
```

Additional fields:

- `testFidelityComment` is required for `test` hunks. State whether the test is high, medium, or low fidelity and why.
- `summaryComment` is required for `logic` hunks. Keep it concise and describe the behavior/API/data-flow/error-handling effect.
- `critical` is required when a hunk has a behavior-affecting change to an existing exported/public function, route/command/task handler, persistence/config/security/correctness-sensitive function, or a function with non-test callers. Include:
  - `label`: short criticality label.
  - `impactSummary`: one short impact summary.
  - `usages`: up to 3 usage entries (`file`, optional `symbol`, optional `line`, `description`).
  - `callPath`: one representative call path up to 4 frames (`file`, `symbol`, optional `line`, optional `description`).
  - If usage evidence cannot be determined, set `usages: []` and `usageNotDetermined: true`.
  - If call-stack evidence cannot be determined, set `callPath: []` and `callStackNotDetermined: true`.

Do NOT print the classifications as JSON in your response — the persistence layer reads them directly from the tool call.

## Instructions

You are classifying the hunks of a pull request diff. You have access to git and gh CLI tools to investigate the PR context.

1. **Use the tools provided** to read the PR diff and understand each hunk. Do NOT rely solely on the file path — read the actual changes.
2. **Classify every `@@` hunk** in the diff. Each physical `@@` block gets **exactly one** entry with the dominant category — never split one `@@` block into multiple entries, and never emit a `hunkIndex` greater than `(number of @@ blocks in the file − 1)`.
3. **Use file path heuristics as a starting signal**, but always verify:
   - Files in `test/`, `__tests__/`, `*.test.*`, `*.spec.*` → likely `test`
   - `package-lock.json`, `*.generated.*`, `*.g.ts` → likely `generated`
   - But a hunk in a test file that changes production imports is `logic`, not `test`
   - A getter/setter that is a direct field passthrough (no validation, transform, lazy init, or side effect) → `mechanical`/`low`; if it validates, transforms, computes lazily, or has side effects → `logic`
4. **Be precise with intensity**:
   - `high` = reviewer should read this carefully
   - `low` = reviewer can skim or skip
5. **Provide a brief reason** (one sentence) explaining why you chose that category and intensity.
6. **Add required rich fields**:
   - `testFidelityComment` for `test` hunks.
   - `summaryComment` for `logic` hunks.
   - `critical` metadata for critical existing-function changes.
7. **Persist the result** by calling the `saveClassification` tool once with the full array.

## Anti-Patterns

- Do NOT classify an entire file as one category when it has multiple `@@` hunks — classify each `@@` hunk independently. (A file with a single `@@` hunk correctly gets a single entry.)
- Do NOT split one `@@` hunk into multiple entries or invent extra hunk indices — emit exactly one entry per `@@` block, with the dominant category.
- Do NOT default everything to `logic` — most PRs have significant mechanical/test/generated content.
- Do NOT skip hunks — every `@@` hunk must appear in the output.
- Do NOT use `simple` for changes with meaningful branching, persistence, I/O, validation, authorization, error handling, concurrency, external calls, or cross-file side effects.
- Do NOT inject the raw diff into the prompt — use tools to read it.
