# Webview Refactoring Progress

## Overview

This document tracks the progress of refactoring webview-based editors and viewers to use shared infrastructure, eliminating code duplication and ensuring consistent behavior across all custom editors.

**Last Updated:** January 21, 2026

---

## Executive Summary

- **Total Editors/Viewers:** 9
- **Migrated:** 7 (78%)
- **Remaining:** 2 (22%)
- **Lines Saved:** ~265 lines (with ~850 more potential)
- **Status:** ✅ Active refactoring in progress

---

## Migration Status

### ✅ Completed Migrations (7/9)

| # | Component | Type | File | Lines | Migration Date | Commit |
|---|-----------|------|------|-------|----------------|--------|
| 1 | Code Review Viewer | Panel Viewer | `code-review-viewer.ts` | 770 | Jan 21, 2026 | `a6eed58` |
| 2 | Pipeline Result Viewer | Panel Viewer | `result-viewer-provider.ts` | 484 | Jan 21, 2026 | `9f59c0e` |
| 3 | Discovery Preview Panel | Panel Viewer | `discovery-preview-provider.ts` | 582 | Jan 21, 2026 | `7d8ccd8` |
| 4 | Pipeline Preview Editor | Custom Editor | `yaml-pipeline/ui/preview-provider.ts` | 714 | Jan 21, 2026 | `ffd51b8` |
| 5 | AI Process Document | Doc Provider | `ai-process-document-provider.ts` | - | Jan 20, 2026 | `5ced643` |
| 6 | Git Show Text Provider | Doc Provider | `git-show-text-document-provider.ts` | - | Jan 20, 2026 | `5ced643` |
| 7 | Bundled Pipeline Provider | Doc Provider | `bundled-readonly-provider.ts` | - | Jan 20, 2026 | `5ced643` |

### ❌ Pending Migrations (2/9)

| # | Component | Type | File | Lines | Complexity | Reason for Deferral |
|---|-----------|------|------|-------|------------|---------------------|
| 8 | Markdown Review Editor | Custom Editor | `review-editor-view-provider.ts` | 1,115 | 🔴 Very High | Production-critical, complex features (comments, AI, anchoring, line tracking, collapse) |
| 9 | Git Diff Review Editor | Custom Editor | `diff-review-editor-provider.ts` | 1,248 | 🔴 Very High | Production-critical, most complex (git integration, preview mode, diff rendering) |

---

## Shared Infrastructure

### Extension-Side Utilities (`src/shortcuts/shared/webview/`)

Created in commit `4830c6f` (Jan 21, 2026):

| Utility | Purpose | Status |
|---------|---------|--------|
| **WebviewSetupHelper** | Webview configuration, CSP, nonce generation, theme detection, resource roots | ✅ Used by 7 components |
| **WebviewMessageRouter** | Type-safe message routing with error handling (replaces switch-case) | ✅ Used by 7 components |
| **WebviewStateManager** | Panel tracking, state persistence, dirty state management | ✅ Available, partially used |
| **PreviewPanelManager** | Single-tab preview mode behavior (like VS Code's italic tabs) | ✅ Available, not yet used |
| **BaseCustomEditorProvider** | Abstract base class using template method pattern | ⚠️ Created but not yet adopted |

### Webview-Side Utilities (`src/shortcuts/shared/webview/`)

Already in use by webview scripts:

| Utility | Purpose | Used By |
|---------|---------|---------|
| **BasePanelManager** | Drag, positioning, viewport constraints | Markdown & Diff editors |
| **MarkdownRenderer** | Comment markdown rendering | Markdown & Diff editors |
| **SearchHandler** | Ctrl+F search functionality | Markdown & Diff editors |
| **ContextMenuManager** | Right-click context menus | Markdown & Diff editors |
| **CustomInstructionDialog** | AI instruction dialogs | Markdown & Diff editors |

---

## Code Savings Achieved

### Lines Eliminated (Jan 21, 2026)

| Component | Lines Saved | Details |
|-----------|-------------|---------|
| Code Review Viewer | ~55 | Removed manual webview setup, switch-case routing |
| Pipeline Result Viewer | ~60 | Removed duplicate nonce/escape functions, switch-case |
| Discovery Preview Panel | ~55 | Removed duplicate utilities, switch-case routing |
| Pipeline Preview Editor | ~95 | Removed duplicate utilities, 75-line switch-case |
| **Total** | **~265** | **+ improved type safety and consistency** |

### Remaining Opportunity

| Component | Estimated Savings | Challenges |
|-----------|-------------------|------------|
| Markdown Review Editor | ~400 lines | Complex comment anchoring, line change tracking |
| Git Diff Review Editor | ~450 lines | Non-standard pattern, preview mode, git integration |
| **Total Potential** | **~850 lines** | **Requires careful planning** |

---

## Migration Timeline

### Phase 1: Infrastructure Foundation ✅ COMPLETE
**Jan 20-21, 2026**

- ✅ Created `ReadOnlyDocumentProvider` with strategy pattern
- ✅ Migrated all 3 virtual document providers
- ✅ Created extension-side webview utilities
- ✅ Added 71 comprehensive unit tests

### Phase 2: Simple Viewers ✅ COMPLETE
**Jan 21, 2026**

- ✅ Migrated Code Review Viewer
- ✅ Migrated Pipeline Result Viewer
- ✅ Migrated Discovery Preview Panel
- ✅ All panel viewers now use shared utilities

### Phase 3: Custom Editors ⏳ IN PROGRESS
**Jan 21, 2026**

- ✅ Migrated Pipeline Preview Editor (simplest custom editor)
- ❌ Markdown Review Editor (deferred)
- ❌ Git Diff Review Editor (deferred)

### Phase 4: Complex Editors 📅 PLANNED
**Future**

- Migrate Markdown Review Editor after infrastructure stabilization
- Migrate Git Diff Review Editor (may need adapter pattern)
- Refine `BaseCustomEditorProvider` based on lessons learned

---

## Benefits Realized

### Code Quality
- ✅ **Type Safety:** Compile-time checks for message types (no more typos in switch-case)
- ✅ **Consistency:** All viewers use identical webview configuration
- ✅ **Testability:** Shared utilities have comprehensive test coverage
- ✅ **Maintainability:** Bug fixes apply to all components

### Developer Experience
- ✅ **Less Boilerplate:** New viewers need ~100 fewer lines
- ✅ **Clearer Intent:** Message routing reads like a DSL
- ✅ **Proper Cleanup:** Router disposal prevents memory leaks
- ✅ **Theme Support:** Automatic light/dark/high-contrast detection

### Examples

**Before (Switch-Case Pattern):**
```typescript
webview.onDidReceiveMessage(async (message) => {
    switch (message.type) {
        case 'openFile': 
            await this.handleOpenFile(message);
            break;
        case 'export':
            await this.handleExport(message);
            break;
        // ... 15 more cases
    }
});
```

**After (Type-Safe Router):**
```typescript
const router = new WebviewMessageRouter<MyMessage>({ /* options */ });
router
    .on('openFile', async (msg) => this.handleOpenFile(msg))
    .on('export', async (msg) => this.handleExport(msg));
    // ... fluent chain continues

webview.onDidReceiveMessage(msg => router.route(msg));
```

---

## Lessons Learned

### What Worked Well ✅
1. **Incremental Migration:** Starting with simple viewers validated the approach
2. **Comprehensive Tests:** 71 tests gave confidence in shared utilities
3. **Clear Patterns:** Documentation helped consistent adoption
4. **Strategy Pattern:** `ReadOnlyDocumentProvider` strategies were elegant

### Challenges Encountered ⚠️
1. **Complex Editors:** Markdown and Diff editors have unique patterns that don't fit the base class template
2. **Preview Mode:** Git Diff editor's single-tab preview needs special handling
3. **Comment Anchoring:** Markdown editor's line tracking is tightly coupled to content updates
4. **Active Development:** Both complex editors are receiving feature additions, making migration risky

### Recommendations for Future Migrations 💡
1. **Wait for Stabilization:** Let migrated viewers run in production before tackling complex editors
2. **Gather Feedback:** Monitor for issues with the shared utilities
3. **Plan Adapters:** `BaseCustomEditorProvider` may need extension points for complex patterns
4. **Migrate Incrementally:** Consider partial migrations (e.g., just message routing first)

---

## Testing Coverage

### Shared Utilities Tests
**File:** `src/test/suite/webview-base-provider.test.ts`

- ✅ 71 comprehensive tests
- ✅ WebviewSetupHelper: Nonce generation, CSP, theme detection, resource roots
- ✅ WebviewStateManager: Panel tracking, state changes, dirty state, preview mode
- ✅ WebviewMessageRouter: Handler registration, routing, error handling, disposal
- ✅ BaseCustomEditorProvider: Template method pattern, lifecycle hooks

### Integration Tests
**File:** `src/test/suite/webview-migration.test.ts` (Added: commit `61936fd`)

- ✅ Tests for all migrated providers
- ✅ Validates consistent behavior before/after migration
- ✅ Ensures message routing works correctly
- ✅ Checks proper resource cleanup

---

## Next Steps

### Immediate (No Action Required)
- Monitor migrated viewers for issues
- Collect user feedback on any behavior changes
- Document any edge cases discovered

### Short Term (Next 1-2 Weeks)
- Consider partial migration of Markdown editor (e.g., just WebviewSetupHelper)
- Evaluate if `BaseCustomEditorProvider` needs refinement
- Create adapter pattern if needed for Diff editor's preview mode

### Long Term (Next 1-2 Months)
- Full migration of Markdown Review Editor
- Full migration of Git Diff Review Editor
- Final cleanup and documentation update

---

## Related Documentation

- **Infrastructure Design:** `src/shortcuts/shared/webview/base-custom-editor-provider.ts` (inline docs)
- **Migration Guide:** See commit messages for detailed migration steps
  - `a6eed58` - Code Review Viewer migration
  - `9f59c0e` - Pipeline Result Viewer migration
  - `7d8ccd8` - Discovery Preview Panel migration
  - `ffd51b8` - Pipeline Preview Editor migration
- **Test Suite:** `src/test/suite/webview-base-provider.test.ts`

---

## Appendix: Editor/Viewer Inventory

### Custom Text Editors (CustomTextEditorProvider)
Full-featured interactive editors in the main editor area:

1. ✅ **Pipeline Preview Editor** - Visual preview of pipeline.yaml with Mermaid
2. ❌ **Markdown Review Editor** - Rich markdown editor with inline commenting
3. ❌ **Git Diff Review Editor** - Side-by-side diff viewer with comments (uses non-standard pattern)

### Webview Panel Viewers (createWebviewPanel)
Standalone panels for displaying rich content:

4. ✅ **Code Review Viewer** - Structured display of code review results
5. ✅ **Pipeline Result Viewer** - Interactive pipeline execution results
6. ✅ **Discovery Preview Panel** - File/folder discovery with relevance scoring

### Virtual Document Providers (TextDocumentContentProvider)
Read-only text documents without webview:

7. ✅ **AI Process Document** - Display AI process details as markdown
8. ✅ **Git Show Text Provider** - View file content at specific commits
9. ✅ **Bundled Pipeline Provider** - Read-only bundled pipeline templates

---

## Contact

For questions about this refactoring effort, see:
- Git history for detailed commit messages
- `CLAUDE.md` for architecture overview
- Test files for usage examples
