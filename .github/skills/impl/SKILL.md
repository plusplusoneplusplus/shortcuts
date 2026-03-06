---
name: impl
description: Implement the requested code change and add comprehensive test coverage, ensuring tests pass across Linux, macOS, and Windows. Use when you need to execute implementation work (not just planning) and must include tests.
---

# Implementation (with Tests)

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
   - Run the repo’s existing lint/build/test commands to understand the current baseline.
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
   - Run the repo's build command to confirm there are no compilation errors.
   - Run the full test suite and ensure all tests pass.
   - If the repo uses a monorepo/workspace structure, also run the build and tests for any sub-packages that contain changed code.
   - **Do not proceed to commit until the build is clean and all tests pass.**
   - If tests are flaky or OS-dependent, fix them to be deterministic before committing.

7. **Update `AGENTS.md` files**
   - For each folder you changed, check the nearest relevant `AGENTS.md`.
   - If behavior, architecture, workflows, commands, or constraints changed, patch `AGENTS.md` to match the new state.
   - Keep updates concise, compact and current-state only. Do not add history text like "after this change..." or "it used to...".

8. **If a plan file exists, keep it updated**
   - If a plan markdown file is provided with task checkboxes, mark tasks complete as you finish them.

9. **Commit when clean**
   - Only create a commit after the build succeeds and all related tests pass (step 6).
   - Write a clear commit message describing the change and the test additions.

10. **Archive the task file (if applicable)**
   - If the task/plan file you followed lives under `.vscode/`, archive it after the commit succeeds:
```bash
     python3 .github/skills/impl/scripts/archive-task-file.py --task <path-to-task-file>
```

   - This moves the file into `.vscode/tasks/archive/` (no-op if the file is not under `.vscode/`).

## Notes

- Prefer existing repo commands rather than introducing new tooling.
- If the change impacts multiple packages/workspaces, ensure the build and tests for each affected package pass — not just the root-level command.
- Pause commits if the build or any tests are failing. Resolve the issues first, verify that the build and tests pass, and then proceed with committing the changes.

## Scripts

- `scripts/archive-task-file.py` - Moves a task file under `.vscode/` into `.vscode/tasks/archive/` after a successful commit.
