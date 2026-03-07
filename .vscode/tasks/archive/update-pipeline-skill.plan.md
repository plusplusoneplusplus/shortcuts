# Update pipeline-generator Skill for `shell` Option

## Problem

The `pipeline-generator` skill and its reference docs don't know about the new `shell`
field being added to `ScriptNodeConfig`. When users ask for Windows-compatible workflows
with PowerShell, the skill will generate script nodes without `shell:`, leading to
failures or confusing workarounds.

Additionally, the skill lacks a canonical example for the "git log → parallel AI review"
pattern, which is a natural use case now that script nodes can drive input.

## Files to Change

### 1. `.github/skills/pipeline-generator/references/workflow-schema.md`

In the `script` node section, add the `shell` field to the YAML block and the
Input/Output modes table:

```yaml
# Add after `output?:`:
shell?: default | powershell | bash   # Shell to use (default: system shell)
```

Add a new **Shell modes** subsection:
- `shell: default` (or omitted) — system shell: `cmd.exe` on Windows, `/bin/sh` on Unix
- `shell: powershell` — `powershell.exe` — enables PowerShell cmdlets (`ConvertTo-Json`, etc.)
- `shell: bash` — `bash` — Bash syntax on Unix/WSL

Add a Windows note warning users that `output: json` requires the script to print a
JSON array to stdout, and that PowerShell's `ConvertTo-Json -AsArray` is the easiest
way to do this on Windows.

### 2. `.github/skills/pipeline-generator/SKILL.md`

**In the DAG-specific questions (Step 3w):**

Update question **3w. Script Nodes** to additionally ask:
> "Are you on Windows? PowerShell scripts are supported with `shell: powershell`."

**In the DAG Workflow example** (the `enrich` node):

Replace the `python3 enrich.py` example with a dual example showing both Unix and
Windows variants, making `shell:` visible in context.

**Add a new pattern to the "Common Patterns Quick Reference":**

> - **Git-driven code review** — script node runs `git log` → map node reviews each
>   commit in parallel with a skill

### 3. `.github/skills/pipeline-generator/references/patterns.md`

Add a new pattern section: **Git-Driven Parallel Review**

Show a complete DAG workflow with:
- `get-commits` script node using `shell: powershell` (Windows) or `shell: default`
  (Unix) to run `git log --grep=...` and output JSON
- `review` map node using `skill: code-review`, `concurrency: 4`
- Side-by-side Unix vs Windows variants of the script command

## Non-Goals

- No changes to `schema.md` (linear pipelines don't have script nodes)
- No changes to the executor or types (covered by the separate `add-shell-option` plan)
- No new clarifying questions for linear pipeline mode

## Example Snippet to Add (patterns.md)

```yaml
# Git-Driven Parallel Code Review (Windows / PowerShell)
name: "Git Commit Review"
description: "Find recent commits matching a keyword and review each in parallel"

settings:
  concurrency: 4
  model: "gpt-4o"

nodes:
  get-commits:
    type: script
    shell: powershell
    run: |
      git log --grep="fix" --since="7 days ago" --format="%H|||%s|||%an" |
        ForEach-Object {
          $p = $_ -split '\|\|\|'
          [PSCustomObject]@{ hash=$p[0]; subject=$p[1]; author=$p[2] }
        } | ConvertTo-Json -AsArray
    output: json

  review:
    type: map
    from: [get-commits]
    skill: code-review
    prompt: |
      Review commit {{hash}} by {{author}}:
      Subject: {{subject}}

      Fetch the diff with: git show {{hash}}
      Identify any issues or improvements.
    output: [findings, severity]
```

```yaml
# Unix variant (same workflow, no shell field needed)
  get-commits:
    type: script
    run: |
      git log --grep="fix" --since="7 days ago" \
        --format='{"hash":"%H","subject":"%s","author":"%an"}' | \
        jq -s '.'
    output: json
```

## Dependency

This plan depends on `.vscode/tasks/workflow-script-shell/add-shell-option.plan.md`
being implemented first (the `shell` field must exist in the actual types/executor
before the skill documents it).
