# Implementation Plan: AI Context Clarification Menu

**Branch**: `001-ai-context-clarify` | **Date**: 2025-12-15 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-ai-context-clarify/spec.md`

## Summary

Add an "Ask AI" option to the review editor's context menu that sends selected text with document context to GitHub Copilot CLI for clarification. The feature leverages the existing webview context menu infrastructure in `dom-handlers.ts` and prompt generation logic in `prompt-generator.ts`, routing requests through a new VS Code terminal command.

## Technical Context

**Language/Version**: TypeScript 4.9.4 (strict mode enabled)
**Primary Dependencies**: VSCode Extension API ^1.95.0, js-yaml ^4.1.0
**Storage**: N/A (uses existing VS Code settings for configuration)
**Testing**: Mocha with @vscode/test-electron
**Target Platform**: VSCode Extension (Windows, macOS, Linux)
**Project Type**: Single VSCode extension with webview components
**Performance Goals**: <2 seconds from click to Copilot CLI invocation
**Constraints**: 8000 character max prompt size, must work when Copilot CLI unavailable (clipboard fallback)
**Scale/Scope**: Single feature addition to existing extension

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. User Experience First** | ✅ PASS | Context menu integrates seamlessly with existing UI; <2s response time target meets "no perceptible lag" requirement |
| **II. Cross-Platform Support** | ✅ PASS | Uses VSCode Terminal API (platform-agnostic); `copilot` CLI assumed available on user's PATH |
| **III. Type Safety and Quality** | ✅ PASS | TypeScript strict mode; new types will have explicit annotations; tests will be added |

**Accessibility Check:**
- ✅ Context menu items are keyboard-accessible via existing menu navigation
- ✅ New setting will be accessible via standard VS Code settings UI

**Performance Check:**
- ✅ Terminal command execution is non-blocking (async)
- ✅ Prompt generation reuses existing `PromptGenerator` logic

## Project Structure

### Documentation (this feature)

```text
specs/001-ai-context-clarify/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (internal message contracts)
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/
├── extension.ts                           # Entry point (no changes expected)
└── shortcuts/
    └── markdown-comments/
        ├── review-editor-view-provider.ts # Add message handler for 'askAI'
        ├── ai-clarification-handler.ts    # NEW: Copilot CLI invocation logic
        ├── prompt-generator.ts            # Extend for clarification prompts
        ├── types.ts                       # Add ClarificationRequest type
        └── webview-scripts/
            ├── dom-handlers.ts            # Add "Ask AI" context menu item
            └── vscode-bridge.ts           # Add askAI message type

# package.json updates:
#   - contributes.configuration: add workspaceShortcuts.aiClarification.tool setting
#   - No new commands needed (triggered via webview context menu)

src/test/suite/
└── ai-clarification.test.ts               # NEW: Tests for AI clarification feature
```

**Structure Decision**: Extends existing `markdown-comments` module with minimal new files. The `ai-clarification-handler.ts` encapsulates Copilot CLI invocation and fallback logic, keeping `review-editor-view-provider.ts` focused on message routing.

## Complexity Tracking

No constitution violations requiring justification.
