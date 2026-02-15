---
status: pending
---

# 000: `~/.coc/` Directory Structure Specification

## Summary

Define and document the canonical `~/.coc/` directory layout that all subsequent commits will implement. This serves as the single-source-of-truth for CoC's persistent state.

## Motivation

The user wants `~/.coc/` to be the **dedicated folder** containing config, state, and all conversation history. Before implementing persistence, we need a clear specification of what goes where, how migration works, and what guarantees we provide.

## Directory Layout

```
~/.coc/                          # Root data directory (chmod 0700)
├── config.yaml                  # CLI configuration (moved from ~/.coc.yaml)
├── processes.json               # AI process records (FileProcessStore)
├── workspaces.json              # Registered workspace metadata
├── queue.json                   # Pending task queue state (survives restarts)
└── outputs/                     # Full conversation output per process
    ├── <process-id-1>.md        # Markdown-formatted AI conversation
    ├── <process-id-2>.md
    └── ...
```

## File Specifications

### `config.yaml`
- **Format:** YAML (js-yaml)
- **Migration:** Auto-copied from `~/.coc.yaml` on first load if new location doesn't exist
- **Backward compat:** Falls back to `~/.coc.yaml` if `~/.coc/config.yaml` not found
- **Schema:** Same as current `CLIConfig` interface + new `persist` field

### `processes.json`
- **Format:** JSON array of `StoredProcessEntry` objects
- **Managed by:** `FileProcessStore` from pipeline-core
- **Retention:** Max 500 processes (configurable), oldest terminal entries pruned first
- **Atomic writes:** Temp file + rename pattern

### `workspaces.json`
- **Format:** JSON array of `WorkspaceInfo` objects
- **Managed by:** `FileProcessStore` from pipeline-core

### `queue.json`
- **Format:** JSON with version, savedAt, pending tasks, and history
- **Managed by:** New `QueuePersistence` class in CoC
- **Recovery:** Running tasks from previous session marked as failed on restore
- **Writes:** Debounced (300ms) on queue change events

### `outputs/<process-id>.md`
- **Format:** Markdown (accumulated streaming chunks)
- **Created by:** `OutputFileManager` in CoC server
- **Referenced by:** `AIProcess.rawStdoutFilePath` field
- **Cleanup:** Orphaned files pruned on server startup and when parent process is removed

## Migration Strategy

| Scenario | Behavior |
|----------|----------|
| Fresh install (no `~/.coc/`) | Directory created on first `coc serve` or `coc run --persist` |
| Existing `~/.coc.yaml` only | Auto-copied to `~/.coc/config.yaml` on first config load |
| Both config files exist | `~/.coc/config.yaml` takes precedence |
| Existing `~/.coc/` with no persistence files | Files created as needed (processes.json on first process, etc.) |

## Security & Permissions

- `~/.coc/` directory: `0700` (owner read/write/execute only)
- JSON files: `0600` (owner read/write only)
- Output files: `0600` (owner read/write only)
- No secrets stored in any file (API keys via environment, not config)

## Changes

### Files to Create
- This specification document (no code changes)

### Files to Modify
- None (this is a spec-only commit)

## Implementation Notes
- This spec is referenced by all subsequent commits (001-007)
- The directory is created lazily (only when first write needed)
- All file I/O uses atomic writes (temp + rename) for crash safety
- All reads handle missing/corrupt files gracefully (return defaults)

## Tests
- No code tests (spec document only)

## Acceptance Criteria
- [ ] Directory structure is documented and agreed upon
- [ ] Migration strategy covers all existing user scenarios
- [ ] File formats and ownership are clearly specified

## Dependencies
- Depends on: None
