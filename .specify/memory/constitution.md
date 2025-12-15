<!--
  Sync Impact Report
  ==================
  Version change: 0.0.0 → 1.0.0 (initial constitution creation)

  Modified principles: N/A (initial version)

  Added sections:
    - Core Principles (3 principles)
    - Quality Standards
    - Governance

  Removed sections: N/A (initial version)

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
- Keyboard navigation MUST be fully supported for all tree view operations
- Configuration changes MUST take effect without requiring extension reload where feasible

**Rationale:** A VSCode extension lives in the user's daily workflow. Friction or confusion directly impacts productivity and adoption.

### II. Cross-Platform Support

The extension MUST function consistently across Windows, macOS, and Linux.

**Requirements:**
- File path handling MUST use platform-agnostic APIs (VSCode URI, path.join)
- Keyboard shortcuts MUST have appropriate platform variants (Ctrl vs Cmd)
- Native file dialogs MUST account for platform limitations (documented in README)
- All features MUST be manually tested on at least two platforms before release
- Configuration files MUST use forward slashes for path separators in YAML

**Rationale:** VSCode's cross-platform nature means users expect extensions to work regardless of OS. Platform-specific bugs erode trust.

### III. Type Safety and Quality

TypeScript strict mode and comprehensive testing MUST be maintained.

**Requirements:**
- TypeScript `strict: true` MUST remain enabled; `any` types require justification
- All public APIs MUST have explicit type annotations
- New features MUST include corresponding test coverage
- ESLint MUST pass with zero errors before merge
- Code MUST compile without warnings (`npm run compile`)

**Rationale:** Type safety catches errors at compile time, reducing runtime bugs. Consistent quality gates prevent regression.

## Quality Standards

### Testing Requirements

- Unit tests MUST cover utility functions and data transformations
- Integration tests SHOULD cover major user workflows (group CRUD, sync operations)
- Test commands: `npm run pretest && npm test`
- Tests MUST pass in CI before merge

### Performance Benchmarks

- Tree view initial load: SHOULD complete in under 500ms for configurations with <100 items
- File operations: MUST NOT block the extension host
- Memory: Extension SHOULD NOT leak memory during normal operation cycles

### Accessibility

- All interactive elements MUST be keyboard-accessible
- Tree items MUST have appropriate ARIA labels
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

This constitution follows semantic versioning. The version number reflects governance stability, not extension version.

**Version**: 1.0.0 | **Ratified**: 2025-12-14 | **Last Amended**: 2025-12-14
