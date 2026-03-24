---
name: test-gap-analysis
description: >-
  Identify test coverage gaps in a given code area. Supports three modes:
  unit-test (pure logic), functional-test (integration with real I/O), and
  mock-e2e (mock-based end-to-end). Use when you want to find missing tests,
  audit test coverage, or plan new test work for a package or module.
---

# Test Gap Analysis

Analyze source code against its existing tests and produce a prioritized list of missing test cases. Operates in three modes that can be run individually or combined.

## Modes
| Mode | Flag | What it looks for |
| --- | --- | --- |
| **unit** | `--mode unit` | Pure-logic functions/classes with no tests or thin coverage: missing edge cases, error paths, boundary values. |
| **functional** | `--mode functional` | Integration points (HTTP handlers, file I/O, CLI commands, database calls) that lack tests exercising real behavior with temp dirs, actual servers, or subprocess calls. |
| **mock-e2e** | `--mode mock-e2e` | Cross-module workflows where multiple components interact but external services (AI SDK, network, git) should be mocked. Looks for missing orchestration-level tests. |

Default when no mode is specified: run **all three** sequentially.

## Project Context

This monorepo uses **Vitest** (`*.test.ts`) for all packages and **Playwright** (`*.spec.ts`) for browser E2E in `packages/coc/`.
| Package | Source | Tests | Helpers |
| --- | --- | --- | --- |
| `packages/forge/` | `src/` | `test/` | `test/helpers/mock-sdk.ts` |
| `packages/coc/` | `src/` | `test/` | `test/helpers/mock-sdk-service.ts`, `test/helpers/mock-process-store.ts` |
| `packages/deep-wiki/` | `src/` | `test/` | Inline `vi.mock` + `vi.hoisted` |

Tests live in a **separate `test/` tree** that mirrors `src/`. Naming: `<module>.test.ts`.

## Instructions

### 1. Determine scope

Identify the target: a package (`packages/forge/`), a subdirectory (`packages/coc/src/server/`), or a specific module. If the user didn't specify, ask.

### 2. Discover source modules

List all `.ts` files under the target `src/` directory. For each file, note:
- Exported functions, classes, and interfaces
- Complexity indicators (conditionals, loops, error handling, async patterns)
- External dependencies (file system, network, child processes, AI SDK)

### 3. Discover existing tests

List all `.test.ts` / `.test.tsx` files under the corresponding `test/` directory. Map each test file back to the source module it covers. Flag source modules with **no corresponding test file**.

### 4. Analyze gaps per mode

Run the analysis for each requested mode:

#### Unit mode

For every exported function/class, check whether tests exist for:
- **Happy path** — basic correct-input → correct-output
- **Edge cases** — empty input, null/undefined, boundary values, large input
- **Error paths** — thrown exceptions, rejected promises, invalid arguments
- **Branch coverage** — each `if`/`switch`/ternary exercised

Report functions that have zero tests as **critical**. Functions with partial coverage are **moderate**.

#### Functional mode

For modules that perform I/O or side effects, check whether tests:
- Use **real temp directories** (not mocked `fs`) for file operations
- Spin up **actual HTTP servers** (port 0) for API handlers
- Execute **real CLI commands** via subprocess for CLI modules
- Test **WebSocket** message flow for real-time features
- Verify **error propagation** through the real call stack

Report I/O modules tested only with mocks (no real I/O test) as **gaps**.

#### Mock-E2E mode

For cross-cutting workflows (e.g., pipeline execution, wiki generation, AI-driven flows), check whether tests:
- Wire together **multiple real modules** with only external services mocked
- Test the **full request→response cycle** through the actual code path
- Verify **state changes** across module boundaries (e.g., process store updated after pipeline run)
- Cover **failure cascading** (one module fails → downstream handles gracefully)

Report workflows with no orchestration-level test as **critical**.

### 5. Produce the gap report

Write results as **individual files** inside a `test-gap-analysis/` subfolder under the task folder. The task folder is specified by the user; if not specified, use `.vscode/tasks/` as the default.

#### Output structure

```
{taskfolder}/test-gap-analysis/
├── 000-{module-name}.md
├── 001-{module-name}.md
├── ...
└── NNN-{module-name}.md
```

- **Prefix** is a zero-padded 3-digit sequence number starting at `000`.
- **`{module-name}`** is a kebab-case slug derived from the source file path (e.g., `src/memory/aggregator.ts` → `memory-aggregator`).
- Files are ordered: all **critical** gaps first (sorted by path), then **moderate** gaps (sorted by path).

#### File template

```markdown
# [<severity>] <source-file-path>

**Mode:** <unit | functional | mock-e2e>
**Severity:** critical | moderate
**Source:** `<relative path to source file>`
**Existing tests:** `<relative path to test file, or "none">`

## What's Missing

<description of the gap>

## Why It Matters

<risk if this remains untested>

## Suggested Tests

<concrete sketch of what tests to write — function names, assertions, setup>
```

### 6. Output location

Create the `{taskfolder}/test-gap-analysis/` directory. If the directory already exists, clear its contents before writing (to avoid stale files from a previous run). Report the output path and total file count to the user when done.

## Tips

- **Start with critical gaps.** A module with zero tests is always more important than one missing an edge case.
- **Check re-exports.** Index files (`index.ts`) that re-export from submodules don't need their own tests, but the submodules do.
- **Ignore type-only files.** Files that export only TypeScript types/interfaces don't need runtime tests.
- **Watch for test helpers masking gaps.** A test file that imports a helper and only tests the helper's behavior may not actually cover the source module.
- **Use sub-agents for large scopes.** When analyzing an entire package, use the `divide-conquer` pattern or launch parallel `explore` sub-agents per subdirectory to keep analysis tractable.
