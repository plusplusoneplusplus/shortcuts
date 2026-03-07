# Add `shell` Option to Workflow Script Node

## Problem

The workflow script node always uses `shell: true` in Node.js `spawn`, which defaults to
`cmd.exe` on Windows. This makes it difficult to write cross-platform workflows that use
PowerShell syntax (e.g. `ConvertTo-Json`, piped cmdlets) or bash syntax on Unix.

## Proposed Solution

Add an optional `shell` field to `ScriptNodeConfig` that lets the user choose the shell
explicitly. The executor resolves it to the appropriate `spawn` option.

## Supported Values

| Value | Behaviour |
|---|---|
| `'default'` (or omitted) | Current behaviour — `shell: true` (cmd.exe / /bin/sh) |
| `'powershell'` | `shell: 'powershell.exe'` — PowerShell on Windows |
| `'bash'` | `shell: 'bash'` — Bash on Unix/WSL |

Node.js `spawn` with a string shell value wraps the command automatically (equivalent to
`powershell.exe /c "..."` or `bash -c "..."`), so no changes are needed to `run` syntax.

## Files to Change

### 1. `packages/pipeline-core/src/workflow/types.ts`
- Add `shell?: 'default' | 'powershell' | 'bash'` field to `ScriptNodeConfig` with JSDoc.

### 2. `packages/pipeline-core/src/workflow/nodes/script.ts`
- Add `getShellOption(shell)` helper that maps the field value to `string | boolean`.
- Pass the result to `spawn` instead of the hardcoded `shell: true`.

### 3. `packages/pipeline-core/src/workflow/nodes/script.test.ts` (or nearest test file)
- Add tests for `shell: 'powershell'` and `shell: 'bash'` verifying the correct spawn
  option is derived (mock `spawn` or check the resolved value via unit test of the helper).

## Non-Goals

- No changes to the legacy pipeline YAML (input/map/reduce) — it has no script step.
- No auto-detection of OS — the field is always explicit.
- No validation that the chosen shell is installed on the host machine.

## Example YAML Usage (after change)

```yaml
nodes:
  - id: get-commits
    type: script
    shell: powershell
    run: |
      git log --grep='fix' --format='%H|||%s|||%an' |
        ForEach-Object {
          $p = $_ -split '\|\|\|'
          [PSCustomObject]@{ hash=$p[0]; subject=$p[1]; author=$p[2] }
        } | ConvertTo-Json -AsArray
    output: json

  - id: review
    type: ai
    dependsOn: [get-commits]
    skill: code-review
    parallel: 4
    prompt: "Review commit {{hash}}: {{subject}}"
```
