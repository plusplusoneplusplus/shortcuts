# Changelog

All notable changes to the CoC (Copilot of Copilot) CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-02-17

### Breaking Changes
- **Removed review page feature**: The `/review/:processId` endpoint and review UI have been removed. Task results now open directly in the task viewer with inline commenting support.

### Added
- **Task commenting**: Add inline comments directly on task results in the viewer
  - Keyboard shortcut: `Cmd/Ctrl+Shift+M` to add comments on selected text
  - Comment categories: Bug, Question, Suggestion, Praise, Nitpick, General
  - Comment persistence in `{dataDir}/tasks-comments/{workspaceId}/{sha256(filePath)}.json`
  - Comment filtering by category and status (open/resolved)
  - Anchor-based location tracking with fuzzy matching for resilience to content changes
  - AI integration: Generate prompts from comments

### Migration Guide
- Previous review page URLs (`/review/:processId`) will no longer work
- Use the task viewer directly for reviewing results
- Comments are stored locally per workspace — no data migration needed as old review data was session-only
- The new commenting system provides persistent storage, unlike the session-only review page

## [1.0.0] - 2026-01-11

### Added
- Initial release of CoC CLI
- `coc run <path>` — Execute a pipeline from a YAML file or package directory
- `coc validate <path>` — Validate pipeline YAML without executing
- `coc list [dir]` — List pipeline packages in a directory
- `coc serve` — Start the AI Execution Dashboard web server
- Configuration via `~/.coc.yaml` with CLI flag overrides
- Output formats: table, JSON, CSV, markdown
