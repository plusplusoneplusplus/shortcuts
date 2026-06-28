<!--
  Sync Impact Report
  ==================
  Version change: 1.0.0 -> 1.0.1 (CoC project framing clarification)

  Modified principles:
    - I. User Experience First (dashboard, CLI, and server workflow framing)
    - II. Cross-Platform Support (Node package and dashboard path handling)
    - III. Type Safety and Quality (package build command wording)

  Added sections: N/A

  Removed sections: N/A

  Templates requiring updates:
    - .specify/templates/plan-template.md ✅ (already has Constitution Check section)
    - .specify/templates/spec-template.md ✅ (requirements/scenarios align with UX-first approach)
    - .specify/templates/tasks-template.md ✅ (test-first structure supports quality standards)

  Follow-up TODOs: None
-->

# Workspace Shortcuts Constitution

## Core Principles

### I. User Experience First

All features and changes MUST prioritize end-user experience above implementation convenience.

**Requirements:**
- UI interactions MUST be responsive (no perceptible lag for common operations)
- Error messages MUST be actionable and user-friendly (avoid technical jargon)
- New features MUST NOT break existing workflows without migration path
- Keyboard navigation MUST be fully supported for dashboard lists, dialogs, and command surfaces
- Configuration changes MUST take effect without requiring process restart where feasible

**Rationale:** CoC is used through a web dashboard, CLI commands, and Node package APIs in daily development workflows. Friction or confusion directly impacts productivity and adoption.

### II. Cross-Platform Support

The CoC dashboard, CLI, server, and published Node packages MUST function consistently across Windows, macOS, and Linux.

**Requirements:**
- File path handling MUST use platform-agnostic APIs (`node:path`, URL/URI helpers, workspace-aware path helpers)
- Dashboard keyboard shortcuts MUST have appropriate platform variants (Ctrl vs Cmd)
- File picker, shell, and browser interactions MUST account for platform limitations (documented in README)
- All features MUST be manually tested on at least two platforms before release
- Configuration files MUST use forward slashes for path separators in YAML

**Rationale:** CoC spans Node.js CLIs, an HTTP server, and a browser-based dashboard. Users expect the same behavior regardless of OS, and platform-specific bugs erode trust.

### III. Type Safety and Quality

TypeScript strict mode and comprehensive testing MUST be maintained.

**Requirements:**
- TypeScript `strict: true` MUST remain enabled; `any` types require justification
- All public APIs MUST have explicit type annotations
- New features MUST include corresponding test coverage
- ESLint MUST pass with zero errors before merge
- Code MUST compile without warnings (`npm run build`)

**Rationale:** Type safety catches errors at compile time, reducing runtime bugs. Consistent quality gates prevent regression.

## Quality Standards

### Testing Requirements

- Unit tests MUST cover utility functions and data transformations
- Integration tests SHOULD cover major user workflows (dashboard operations, CLI commands, sync flows)
- Test commands: `npm run test`
- Tests MUST pass in CI before merge

### Performance Benchmarks

- Dashboard initial load: SHOULD complete in under 500ms for configurations with <100 items
- File operations: MUST NOT block the server event loop or long-running worker flows
- Memory: CoC processes SHOULD NOT leak memory during normal operation cycles

### Accessibility

- All interactive elements MUST be keyboard-accessible
- Dashboard lists and controls MUST have appropriate ARIA labels
- Theme-aware icons MUST maintain sufficient contrast in both light and dark themes

## Governance

### Amendment Process

1. Propose changes via pull request modifying this file
2. Document rationale for additions, modifications, or removals
3. Update version number following semantic versioning:
   - **MAJOR**: Principle removal or redefinition that breaks existing compliance
   - **MINOR**: New principle or section addition
   - **PATCH**: Clarifications, typo fixes, non-semantic refinements
4. All template files MUST be reviewed for consistency after amendments

### Compliance Review

- All pull requests MUST be checked against applicable principles
- Constitution violations MUST be resolved before merge
- Complexity or exceptions MUST be justified in PR description
- Use CLAUDE.md for runtime development guidance and implementation details

### Versioning Policy

This constitution follows semantic versioning. The version number reflects governance stability, not package version.

**Version**: 1.0.1 | **Ratified**: 2025-12-14 | **Last Amended**: 2026-06-28
