# Tasks: AI Context Clarification Menu

**Input**: Design documents from `/specs/001-ai-context-clarify/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: No test tasks included (not explicitly requested in specification).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: VSCode extension at repository root
- Extension code: `src/shortcuts/markdown-comments/`
- Webview code: `src/shortcuts/markdown-comments/webview-scripts/`
- Configuration: `package.json`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Type definitions and configuration that all user stories depend on

- [ ] T001 Add `ClarificationContext` and `AIToolType` types to src/shortcuts/markdown-comments/types.ts
- [ ] T002 Add `AskAIContext` interface to src/shortcuts/markdown-comments/webview-scripts/types.ts
- [ ] T003 [P] Add `askAI` case to `WebviewMessage` union type in src/shortcuts/markdown-comments/webview-scripts/types.ts
- [ ] T004 [P] Add VS Code setting schema for `workspaceShortcuts.aiClarification.tool` in package.json (contributes.configuration.properties)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core handler module that MUST be complete before user story implementation

**⚠️ CRITICAL**: User story work depends on this handler being in place

- [ ] T005 Create new file src/shortcuts/markdown-comments/ai-clarification-handler.ts with shell escaping utility function
- [ ] T006 Add `handleAskAI()` method skeleton to src/shortcuts/markdown-comments/review-editor-view-provider.ts
- [ ] T007 Add `askAI` message handler case in `handleWebviewMessage()` switch in src/shortcuts/markdown-comments/review-editor-view-provider.ts

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Clarify Selected Section via Context Menu (Priority: P1) 🎯 MVP

**Goal**: Add "Ask AI" option to context menu that sends selection to Copilot CLI

**Independent Test**: Select text in review editor → right-click → click "Ask AI" → verify terminal opens with copilot command

### Implementation for User Story 1

- [ ] T008 [P] [US1] Add "Ask AI" HTML menu item with icon to context menu in src/shortcuts/markdown-comments/webview-content.ts (after contextMenuAddComment div)
- [ ] T009 [P] [US1] Add `contextMenuAskAI` element reference in `initDomHandlers()` in src/shortcuts/markdown-comments/webview-scripts/dom-handlers.ts
- [ ] T010 [US1] Add click event listener for `contextMenuAskAI` in `setupContextMenuEventListeners()` in src/shortcuts/markdown-comments/webview-scripts/dom-handlers.ts
- [ ] T011 [US1] Implement `handleAskAI()` function in src/shortcuts/markdown-comments/webview-scripts/dom-handlers.ts to extract selection and call vscode-bridge
- [ ] T012 [US1] Add `requestAskAI()` function to src/shortcuts/markdown-comments/webview-scripts/vscode-bridge.ts that posts askAI message
- [ ] T013 [US1] Implement `handleAskAI()` in src/shortcuts/markdown-comments/review-editor-view-provider.ts to call ai-clarification-handler
- [ ] T014 [US1] Implement `invokeCopilotCLI()` function in src/shortcuts/markdown-comments/ai-clarification-handler.ts using vscode.window.createTerminal()
- [ ] T015 [US1] Add disabled state handling for "Ask AI" menu item when no selection (same pattern as contextMenuAddComment) in src/shortcuts/markdown-comments/webview-scripts/dom-handlers.ts handleContextMenu()

**Checkpoint**: User Story 1 complete - "Ask AI" menu item works with Copilot CLI

---

## Phase 4: User Story 2 - Configure AI Tool Target (Priority: P2)

**Goal**: Allow users to choose between Copilot CLI and clipboard via VS Code settings

**Independent Test**: Change setting to "clipboard" → trigger "Ask AI" → verify prompt copied to clipboard with notification

### Implementation for User Story 2

- [ ] T016 [US2] Add `getAIToolSetting()` function in src/shortcuts/markdown-comments/ai-clarification-handler.ts to read workspaceShortcuts.aiClarification.tool setting
- [ ] T017 [US2] Implement `copyToClipboard()` function in src/shortcuts/markdown-comments/ai-clarification-handler.ts using vscode.env.clipboard.writeText()
- [ ] T018 [US2] Update main handler in src/shortcuts/markdown-comments/ai-clarification-handler.ts to route to Copilot CLI or clipboard based on setting
- [ ] T019 [US2] Add user notification after successful clipboard copy in src/shortcuts/markdown-comments/ai-clarification-handler.ts using vscode.window.showInformationMessage()
- [ ] T020 [US2] Add fallback logic: if copilot-cli selected but command fails, fall back to clipboard with warning notification

**Checkpoint**: User Story 2 complete - users can configure their preferred AI tool

---

## Phase 5: User Story 3 - Include Document Context with Selection (Priority: P3)

**Goal**: Enrich the AI prompt with surrounding context (headers, file path, nearby content)

**Independent Test**: Select text under a heading → trigger "Ask AI" → verify prompt includes heading, file path, and surrounding lines

### Implementation for User Story 3

- [ ] T021 [P] [US3] Implement `extractDocumentContext()` function in src/shortcuts/markdown-comments/webview-scripts/dom-handlers.ts to gather headings and surrounding lines from state
- [ ] T022 [US3] Update `handleAskAI()` in src/shortcuts/markdown-comments/webview-scripts/dom-handlers.ts to call `extractDocumentContext()` and include in message
- [ ] T023 [US3] Implement `buildClarificationPrompt()` in src/shortcuts/markdown-comments/ai-clarification-handler.ts with markdown format (selected text, file path, heading, context)
- [ ] T024 [US3] Add prompt size validation (8000 char max) with context truncation in src/shortcuts/markdown-comments/ai-clarification-handler.ts
- [ ] T025 [US3] Add truncation warning notification when prompt exceeds limit in src/shortcuts/markdown-comments/ai-clarification-handler.ts

**Checkpoint**: User Story 3 complete - AI receives rich context with every clarification request

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final integration and code quality

- [ ] T026 [P] Ensure shell escaping handles all special characters (quotes, newlines, backslashes) in src/shortcuts/markdown-comments/ai-clarification-handler.ts
- [ ] T027 [P] Add JSDoc comments to all new public functions in ai-clarification-handler.ts
- [ ] T028 Verify TypeScript compilation passes with no errors (`npm run compile`)
- [ ] T029 Verify ESLint passes with no errors (`npm run lint`)
- [ ] T030 Manual end-to-end testing per quickstart.md verification checklist

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-5)**: All depend on Foundational phase completion
  - User stories can then proceed in priority order (P1 → P2 → P3)
  - US2 builds on US1's handler
  - US3 builds on US1's message flow
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - Core functionality, no story dependencies
- **User Story 2 (P2)**: Depends on US1 handler structure - Adds configuration branch
- **User Story 3 (P3)**: Depends on US1 message flow - Enriches context extraction

### Within Each User Story

- Webview HTML/UI before event handlers
- Event handlers before vscode-bridge function
- vscode-bridge before extension handler
- Extension handler before ai-clarification-handler functions

### Parallel Opportunities

**Phase 1 Setup (can run together):**
- T003 (webview types) and T004 (package.json) - different files

**Phase 3 User Story 1 (can run together):**
- T008 (HTML) and T009 (dom-handlers reference) - different files

**Phase 5 User Story 3:**
- T021 (context extraction) can start while T020 (fallback) finishes

**Phase 6 Polish (can run together):**
- T026 (escaping), T027 (JSDoc), T028 (compile), T029 (lint) - independent tasks

---

## Parallel Example: User Story 1

```bash
# Launch webview changes together:
Task: "T008 [P] [US1] Add Ask AI HTML menu item in webview-content.ts"
Task: "T009 [P] [US1] Add contextMenuAskAI reference in dom-handlers.ts"

# After those complete, sequential:
Task: "T010 [US1] Add click event listener"
Task: "T011 [US1] Implement handleAskAI()"
Task: "T012 [US1] Add requestAskAI() to vscode-bridge"
Task: "T013 [US1] Implement handleAskAI() in view-provider"
Task: "T014 [US1] Implement invokeCopilotCLI()"
Task: "T015 [US1] Add disabled state handling"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (types and settings)
2. Complete Phase 2: Foundational (handler skeleton)
3. Complete Phase 3: User Story 1 (core "Ask AI" functionality)
4. **STOP and VALIDATE**: Test context menu → Copilot CLI flow
5. Deploy/demo if ready - users can clarify text via Copilot CLI!

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → **MVP complete!**
3. Add User Story 2 → Test independently → Users can now choose clipboard
4. Add User Story 3 → Test independently → Prompts include rich context
5. Each story adds value without breaking previous stories

### File Touch Summary

| File | Tasks | User Stories |
|------|-------|--------------|
| `types.ts` (extension) | T001 | Setup |
| `types.ts` (webview) | T002, T003 | Setup |
| `package.json` | T004 | Setup |
| `ai-clarification-handler.ts` (NEW) | T005, T014, T016-T020, T023-T027 | Foundation, US1, US2, US3 |
| `review-editor-view-provider.ts` | T006, T007, T013 | Foundation, US1 |
| `webview-content.ts` | T008 | US1 |
| `dom-handlers.ts` | T009-T011, T015, T021, T022 | US1, US3 |
| `vscode-bridge.ts` | T012 | US1 |

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Total: 30 tasks across 6 phases
