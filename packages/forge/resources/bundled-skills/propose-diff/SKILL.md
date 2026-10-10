---
name: propose-diff
description: Propose a minimal unified diff for review without changing files. Use when the user asks to propose a diff, preview a patch, or review changes before applying them.
metadata:
  version: "0.0.1"
---

# Propose Diff

Inspect the relevant files and propose a minimal unified diff for the user's review.
Show the diff in a fenced `diff` block with repository-relative file paths, followed
by a brief explanation of the change and any risks.

Do not modify files, apply patches, or commit. Use read-only tools and commands;
do not delegate implementation or run commands that write files.
Wait for the user's explicit approval before making changes. Requests to revise
the proposal are not approval to apply it.
