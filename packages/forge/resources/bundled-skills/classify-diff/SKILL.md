---
name: classify-diff
description: Classify every hunk in a pull request diff by change type (logic, mechanical, test, generated) so reviewers can focus on what matters.
metadata:
  author: CoC
  version: "0.0.1"
---

# Classify Diff — Focused PR Review

Classify each `@@` hunk in a pull request diff into one of four categories so the UI can visually de-emphasize mechanical changes and highlight logic edits.

## When to Use

- The user clicks "Classify" on the PR Files Changed tab.
- The system needs to produce a per-hunk classification for a pull request diff.

## Classification Categories

| Category | Description | Examples |
|----------|-------------|---------|
| `logic` | Meaningful behavioral changes — new features, bug fixes, algorithm changes, API contract changes | New function, changed conditional, modified return value |
| `mechanical` | Structural changes with no behavioral impact — renames, moves, formatting, import reordering | Variable rename, whitespace cleanup, import sort |
| `test` | Test code — new tests, modified assertions, test fixtures, test utilities | New test case, updated assertion, mock data |
| `generated` | Auto-generated or machine-produced code — lock files, build artifacts, codegen output | `package-lock.json` changes, protobuf output, schema migrations |

## Intensity Levels

Each classification also includes an intensity:

| Intensity | Meaning |
|-----------|---------|
| `high` | Core change — deserves careful review (e.g. new business logic, critical bug fix, complex test) |
| `low` | Minor change within the category (e.g. small refactor, trivial test update, simple rename) |

## Output

When the runtime provides a `saveClassification` tool, call it exactly once at the end with the full array of per-hunk classifications. The tool persists the result and validates the schema — if it returns an error, fix the offending entries and call it again.

When the tool is NOT available, return the result as a single JSON object matching this shape, wrapped in a ```json code fence:

```json
{
  "classifications": [
    {
      "file": "src/server/auth.ts",
      "hunkIndex": 0,
      "category": "logic",
      "intensity": "high",
      "reason": "Adds JWT token refresh logic with expiry check"
    },
    {
      "file": "src/server/auth.ts",
      "hunkIndex": 1,
      "category": "mechanical",
      "intensity": "low",
      "reason": "Import reordering, no behavioral change"
    }
  ]
}
```

## Instructions

You are classifying the hunks of a pull request diff. You have access to git and gh CLI tools to investigate the PR context.

1. **Use the tools provided** to read the PR diff and understand each hunk. Do NOT rely solely on the file path — read the actual changes.
2. **Classify every `@@` hunk** in the diff. Each hunk gets exactly one category (the dominant one if mixed).
3. **Use file path heuristics as a starting signal**, but always verify:
   - Files in `test/`, `__tests__/`, `*.test.*`, `*.spec.*` → likely `test`
   - `package-lock.json`, `*.generated.*`, `*.g.ts` → likely `generated`
   - But a hunk in a test file that changes production imports is `logic`, not `test`
4. **Be precise with intensity**:
   - `high` = reviewer should read this carefully
   - `low` = reviewer can skim or skip
5. **Provide a brief reason** (one sentence) explaining why you chose that category and intensity.
6. **Persist the result**: if a `saveClassification` tool is available, call it once with the full array. Otherwise emit the JSON shape shown in the Output section above, wrapped in a ```json code fence.

## Anti-Patterns

- Do NOT classify an entire file as one category — classify each hunk independently.
- Do NOT default everything to `logic` — most PRs have significant mechanical/test/generated content.
- Do NOT skip hunks — every `@@` hunk must appear in the output.
- Do NOT inject the raw diff into the prompt — use tools to read it.
