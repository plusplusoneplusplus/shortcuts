---
name: impl
description: MUST BE LOADED for any code change in this repository. Implements the requested code change and adds comprehensive test coverage, ensuring tests pass across Linux, macOS, and Windows. Use whenever you are about to modify, add, refactor, fix, or delete source code in this repo — including bug fixes, feature work, refactors, and small tweaks. Use when you need to execute implementation work (not just planning) and must include tests. Commit the changes to the repository after the implementation is complete.
---

# Implementation (with Tests)

**MANDATORY:** This skill MUST be loaded and followed for ANY code change in this repository — including bug fixes, new features, refactors, small tweaks, and dependency updates that touch source code. If you are about to edit, add, or remove code in this repo, read and follow this skill first.

Use this skill when the user asks you to **implement** a change in the codebase (not just propose a plan) and expects **comprehensive tests** and cross-platform reliability.

## Instructions

1. **Stash uncommitted changes (if workspace is dirty)**
   - Run `git status --porcelain` to check for uncommitted changes.
   - If the output is non-empty, run `git stash push -m "impl-skill: auto-stash before implementation"` to save the current work.
   - Note that you stashed so you can restore later (see final step).

2. **Understand the request and scope**
   - Restate the requested behavior change in your own words.
   - Identify files/modules likely affected.
   - Confirm any ambiguous requirements before coding.

3. **Establish baseline**
   - Inspect the available scripts before running validation commands. For npm repositories, check `package.json` scripts first; do not assume `npm run build` exists at the repository root.
   - Run the repo’s existing lint/build/test commands to understand the current baseline. If the root package has no build script, use the documented root aggregate script (for example `build:packages`) or the relevant package/workspace build script for the files being changed.
   - If baseline fails, only address failures that are required for the requested change.

4. **Implement the change (minimal, surgical edits)**
   - Make the smallest possible code changes to achieve the requested behavior.
   - Prefer existing patterns and utilities already used in the repo.

5. **Add comprehensive tests**
   - Add or update tests to cover:
     - Happy path
     - Key edge cases
     - Regression coverage for the bug/behavior being changed
   - Ensure tests avoid OS-specific path assumptions (use `path` helpers, normalize separators, etc.).

6. **Verify build and tests pass before committing**
   - Run the repo's actual build command to confirm there are no compilation errors. Use only scripts that exist in `package.json` or are documented by the repository; do not invent root-level commands.
   - Run only the tests likely impacted by your changes (e.g. tests in the same package or files that import the changed modules). Do **not** run the full test suite unless there is no way to scope the run.
   - If the repo uses a monorepo/workspace structure, run the build and tests for the specific sub-packages that contain changed code — not all packages.
   - **Do not proceed to commit until the build is clean and all impacted tests pass.**
   - If tests are flaky or OS-dependent, fix them to be deterministic before committing.

7. **Update `AGENTS.md` files**
   - For each folder you changed, check the nearest relevant `AGENTS.md`.
   - If behavior, architecture, workflows, commands, or constraints changed, patch `AGENTS.md` to match the new state.
   - Keep updates concise, compact and current-state only. Do not add history text like "after this change..." or "it used to...".

8. **Update `coc-knowledge` skill if needed**
   - If the change touches any CoC subsystem covered by a reference file under `.github/skills/coc-knowledge/references/` (server, memory system, LLM tools, SDK wrapper, process store, workflow engine, deep-wiki, dashboard SPA, admin config, MCP settings, REST API, etc.), update the relevant reference file(s) to reflect the new behavior.
   - Make targeted edits only — do not rewrite sections that are still accurate.
   - Keep updates current-state only; no history text.

9. **If a plan file exists, keep it updated**
   - If a plan markdown file is provided with task checkboxes, mark tasks complete as you finish them.

10. **Commit when clean**
   - Only create a commit after the build succeeds and all related tests pass (step 6).
   - **Stay on the current branch — do NOT checkout or create a new branch.** Commit directly to whatever branch is currently checked out, even if it is the default branch.
   - Write a clear commit message describing the change and the test additions.

11. **Archive the task file**
   - If the task/plan file you followed lives under `.vscode/` or `~/.coc/repos/<repoId>/tasks/`, you must archive it after the commit succeeds:
```bash
     python3 .github/skills/impl/scripts/archive-task-file.py --task <path-to-task-file>
```

## Notes

- Prefer existing repo commands rather than introducing new tooling.
- For monorepos, prefer the smallest existing validation command that covers the changed package, then run documented aggregate commands when broader confidence is needed.
- If the change impacts multiple packages/workspaces, ensure the build and tests for each affected package pass — not just the root-level command.
- Pause commits if the build or any tests are failing. Resolve the issues first, verify that the build and tests pass, and then proceed with committing the changes.
- Never create or switch to a new branch. Always stay on the current branch and commit there.

## Scripts

- `scripts/archive-task-file.py` - Archives a task file from `.vscode/` (legacy) or `~/.coc/repos/<repoId>/tasks/` (modern) into the corresponding `archive/` subdirectory after a successful commit.
