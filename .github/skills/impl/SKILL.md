---
name: impl
description: Implement the requested code change and add comprehensive test coverage, ensuring tests pass across Linux, macOS, and Windows. Use when you need to execute implementation work (not just planning) and must include tests.
---

# Implementation (with Tests)

Use this skill when the user asks you to **implement** a change in the codebase (not just propose a plan) and expects **comprehensive tests** and cross-platform reliability.

## Instructions

1. **Understand the request and scope**
   - Restate the requested behavior change in your own words.
   - Identify files/modules likely affected.
   - Confirm any ambiguous requirements before coding.

2. **Establish baseline**
   - Run the repo’s existing lint/build/test commands to understand the current baseline.
   - If baseline fails, only address failures that are required for the requested change.

3. **Implement the change (minimal, surgical edits)**
   - Make the smallest possible code changes to achieve the requested behavior.
   - Prefer existing patterns and utilities already used in the repo.

4. **Add comprehensive tests**
   - Add or update tests to cover:
     - Happy path
     - Key edge cases
     - Regression coverage for the bug/behavior being changed
   - Ensure tests avoid OS-specific path assumptions (use `path` helpers, normalize separators, etc.).

5. **Run the full test suite**
   - Ensure all tests pass.
   - If tests are flaky or OS-dependent, fix the test to be deterministic.

6. **If a plan file exists, keep it updated**
   - If a plan markdown file is provided with task checkboxes, mark tasks complete as you finish them.

7. **Commit when clean**
   - When tests pass, create a commit with a clear message describing the change and test additions.

## Notes

- Prefer existing repo commands (e.g. `npm test`, `npm run lint`) rather than introducing new tooling.
- If the user requests a change that impacts multiple packages/workspaces, ensure the relevant package tests run as well.

## References

- [impl.prompt.md](references/impl.prompt.md) - Original short-form prompt this skill was derived from.
