# Change Log

All notable changes to the CoC monorepo will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Queue Task autocomplete**: Inline ghost-text suggestions in the Queue Task dialog and chat follow-up input. As you type, the single best completion (derived from past initial prompts and follow-up messages across all workspaces) appears as gray italic text after the cursor. Press **Tab** to accept or **Esc** to dismiss. Default enabled; disable via `promptAutocomplete.enabled = false` in global preferences.

### Changed
- CLI descriptions updated: "pipeline" → "workflow" in help text and output messages.
- `pipeline-generator` skill updated with unified schema documentation covering both linear and DAG formats.

### CoC CLI Package (1.1.0)

#### Breaking Changes
- Removed review page feature — see [`packages/coc/CHANGELOG.md`](packages/coc/CHANGELOG.md) for details

#### Added
- Task commenting feature with inline comments on task results
- Comment categories (Bug, Question, Suggestion, Praise, Nitpick, General), filtering, and anchor tracking
- AI prompt generation from comments
- See [`packages/coc/CHANGELOG.md`](packages/coc/CHANGELOG.md) for full details

## [3.4.0] - 2026-02-12

### Added
- Queue AI Job command with tree view button
- Ask AI context utilities and interactive menu
- Copy Path context menu for task folders

### Fixed
- AI session resume reliability
- Cross-view context menu contamination between tree views

### Changed
- Logical Groups panel hidden by default

## [3.2.15] - 2026-01-30

### Added
- Bundled skills: `go-deep` (deep research & verification), `skill-for-skills` (skill authoring), `pipeline-generator` (pipeline YAML scaffolding)
- Task name field in AI feature creation dialog
- Persistent AI model selection across task creation sessions

### Changed
- Bundled skills now use symlinks instead of file copies
- Default task meta file renamed to `placeholder.md`

## [3.1.0] - 2026-01-19

### Added
- CLI Interactive mode for AI-powered commenting and interactive terminal sessions

## [3.0.0] - 2026-01-11

### Added
- YAML Pipeline Framework for map-reduce style AI workflows
