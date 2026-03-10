---
name: safe-refactoring-sweep
description: Run a parallelized safe-refactoring sweep across an entire codebase. Discovers top-level areas, launches one sub-agent per area to audit for zero-risk refactorings, and produces atomic commit plan files in ./refactoring-plans/. Use when the user asks to clean up, sweep, or audit a codebase for safe refactoring opportunities.
---

# Safe Refactoring Sweep

Orchestrate a full-codebase refactoring audit that is **safe by design**: every proposed change must be zero-risk, behaviour-preserving, and described as an atomic commit plan — no source code is modified.

## Parameters

Before starting, determine the **root folder** for plan output:

| Parameter | Default | Description |
|---|---|---|
| `{{ROOT_FOLDER}}` | `./refactoring-plans` | Base directory where all plan files are written. The user may override this (e.g. `.vscode/tasks/refactoring`, `/tmp/refactor-audit`). |

If the user provides a custom root folder path, use it in place of the default throughout the workflow. Ask the user if they want a custom path; if they decline or don't specify one, use `./refactoring-plans`.

## Workflow

Execute the following three steps in order.

### Step 1 — Discover Areas

Use the `explore` agent to list the top-level components, modules, or packages in this repository. Group them into logical areas (by directory, feature domain, or package).

Print the discovered list and **ask the user to confirm** before proceeding to Step 2. The user may remove areas or add custom ones.

### Step 2 — Launch One Sub-Agent per Area

For **each confirmed area**, launch a `general-purpose` sub-agent **in parallel** using the prompt template in [references/sub-agent-prompt.md](references/sub-agent-prompt.md).

Fill in the three placeholders before dispatching:

| Placeholder | Value |
|---|---|
| `{{ROOT_FOLDER}}` | The resolved root folder path (default or user-provided) |
| `{{AREA_PATH}}` | Relative path to the area root (e.g. `packages/coc/`) |
| `{{AREA_NAME}}` | Short kebab-case label used for the output directory (e.g. `coc`) |

Every sub-agent writes its output to `{{ROOT_FOLDER}}/{{AREA_NAME}}/` and **must not modify any source file**.

### Step 3 — Consolidated Summary

After all sub-agents complete, print a summary table:

```
| Area | # Plans | Titles |
|------|---------|--------|
```

Then remind the user that they can review all plans in `{{ROOT_FOLDER}}/` before applying any of them.

## References

- [Sub-agent prompt template](references/sub-agent-prompt.md) — the full prompt dispatched to each area agent
- [Allowed refactoring categories](references/allowed-categories.md) — the strict allowlist of refactoring types
