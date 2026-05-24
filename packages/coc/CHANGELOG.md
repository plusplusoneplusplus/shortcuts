# Changelog

## 1.3.0

### Minor Changes

- 9413f77: Add AI-powered focused diff classification for PR review

  - New `/classify-diff` bundled skill with structured JSON output schema for per-hunk classification
  - Feature-flag gated `focusedDiff` (disabled by default) with admin panel toggle
  - REST API endpoints: POST to trigger classification, GET for cached results
  - Dashboard filter bar with Logic/Mechanical/Test/Generated checkboxes on PR Files Changed tab
  - File tree badges showing max hunk intensity per file
  - Visual dimming of non-logic hunks in focused mode
  - Classification stored as CoC conversation in process store, cached by PR ID + head SHA
  - `headSha` and `baseSha` added to canonical `PullRequest` type (GitHub and ADO adapters)
  - `PullRequestsClient` extended with `classify()` and `getClassification()` methods

### Patch Changes

- Updated dependencies [9413f77]
  - @plusplusoneplusplus/forge@1.3.0
  - @plusplusoneplusplus/coc-client@0.2.0

## 1.2.0

### Minor Changes

- Migrate the storage to SQLite
- Add Reconnect action for DevTunnel servers (connector, route, and UI)

### Patch Changes

- Updated dependencies
  - @plusplusoneplusplus/forge@1.2.0

## 1.1.0

### Minor Changes

- Improvements and bug fixes.

### Patch Changes

- Updated dependencies
  - @plusplusoneplusplus/forge@1.1.0

## 1.0.8

### Patch Changes

- bug fixes
- Updated dependencies
  - @plusplusoneplusplus/forge@1.0.3

## 1.0.7

### Patch Changes

- Minor updates
- Updated dependencies
  - @plusplusoneplusplus/forge@1.0.2

## 1.0.6

### Patch Changes

- 62faf71: Publish the packages in separate ones.
- Updated dependencies [62faf71]
  - @plusplusoneplusplus/forge@1.0.1

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
