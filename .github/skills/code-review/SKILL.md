---
name: code-review
description: Review commits, pull requests, diffs, or files against repository-specific standards by selecting relevant rule references and delegating each rule to a focused code-review subagent.
---

# Code Review Rules

This skill is the lightweight index for the repository's code review rules.
Do not inline rule details here. Load only the relevant reference files below, then run a separate `code-review` subagent for each selected rule.

## Workflow

1. Identify the review scope: commit, pull request, diff, or specific files.
2. Select only the rules that match that scope from the index below.
3. For each selected rule:
   - Read the linked reference file.
   - Launch a dedicated `code-review` subagent focused only on that rule.
   - Ask the subagent to report only concrete violations of that rule.
4. Merge the subagent outputs, remove duplicates, and label each finding with the rule that produced it.
5. If no indexed rule applies, say so instead of inventing new standards.

## Rule Index

| Rule | Use when reviewing | Reference |
| --- | --- | --- |
| `windows-compatibility` | Path handling, filesystem behavior, shell commands, env vars, line endings, or other cross-platform concerns | [Windows compatibility](references/windows-compatibility.md) |

## Subagent Prompt Template

Use a prompt in this shape for each selected rule:

```text
Review <scope> only against the `<rule-id>` rule described in `<reference-path>`.
Report only concrete, high-signal issues that violate this rule.
Ignore comments that are unrelated to this rule.
For each finding, include file paths, line numbers, and the exact checklist item that was violated.
```
