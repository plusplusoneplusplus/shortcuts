---
status: pending
---

# 011: Add AI Task Generation and Discovery Features

## Summary

Add REST API endpoints and SPA UI for AI-powered task generation (from prompt or feature context) and feature-folder discovery to the CoC server, extracting reusable prompt-building logic from the VS Code extension into a shared module.

## Motivation

The VS Code extension already provides AI task creation (via `ai-task-commands.ts` and `ai-task-dialog.ts`) and feature-folder discovery (via `discovery-commands.ts`), but these features are tightly coupled to VS Code APIs (QuickPick, webview panels, `vscode.window.withProgress`). CoC's standalone server needs equivalent functionality exposed as HTTP endpoints so the SPA dashboard can offer the same capabilities without VS Code. This commit keeps the VS Code extension untouched and adds the server-side counterparts, reusing the existing `CLITaskExecutor` / `CopilotSDKService` infrastructure already wired up in `queue-executor-bridge.ts`.

## Changes

### Files to Create

- `packages/pipeline-core/src/tasks/task-prompt-builder.ts` — Pure-Node prompt-building functions extracted from `ai-task-commands.ts`: `buildCreateTaskPrompt`, `buildCreateTaskPromptWithName`, `buildCreateFromFeaturePrompt`, `buildDeepModePrompt`, `gatherFeatureContext`, `parseCreatedFilePath`, and `cleanAIResponse`. No VS Code imports. Accepts plain strings/objects for folder paths, context, etc. Also exports `FeatureContextInput` and `TaskGenerationOptions` interfaces mirroring the extension's `SelectedContext` / `AITaskCreationOptions` but without VS Code types.

- `packages/pipeline-core/src/tasks/index.ts` — Barrel export for the new `task-prompt-builder` module.

- `packages/pipeline-core/src/tasks/discovery-prompt-builder.ts` — Pure-Node prompt builder for feature-folder discovery. Extracts the concept of building a discovery request (feature description + keywords + scope) into a VS Code-free function. Reuses `DiscoveryRequest` types already in pipeline-core discovery module (or defines minimal equivalents if those types live in the extension).

- `packages/coc/src/server/task-generation-handler.ts` — API route handlers for task generation and discovery:
  - `POST /api/workspaces/:id/tasks/generate` — Accepts `{ prompt, targetFolder, name?, model?, mode?, depth? }`. Resolves workspace root from store, builds prompt via `task-prompt-builder`, invokes `CopilotSDKService` with `approveAllPermissions`, streams progress via SSE, returns `{ success, filePath, content }`.
  - `POST /api/workspaces/:id/tasks/discover` — Accepts `{ featureDescription, keywords?, scope? }`. Runs keyword/file search in workspace, returns `{ items: RelatedItem[] }`. Does **not** use the full `DiscoveryEngine` (which depends on VS Code EventEmitter); instead uses the extracted prompt builder + direct `CopilotSDKService` call.
  - Helper: `registerTaskGenerationRoutes(routes, store)` following the same pattern as `registerApiRoutes` and `registerQueueRoutes`.

- `packages/coc/src/server/spa/components/task-generation-dialog.js` — Inline JS component for the SPA: a modal dialog with fields for prompt/description, target folder dropdown (populated from workspace file listing), model selector, mode toggle (create vs. from-feature), depth toggle (simple/deep). Submit triggers `POST .../tasks/generate` and opens an SSE connection for progress.

- `packages/coc/test/server/task-generation-handler.test.ts` — Vitest tests for the two new endpoints: validates request validation (missing fields → 400), workspace-not-found → 404, successful generation with mocked AI invoker, SSE streaming format, and discovery result shape.

- `packages/pipeline-core/test/tasks/task-prompt-builder.test.ts` — Vitest tests for extracted prompt builders: verifies prompt includes target path, handles missing name, truncates long plan/spec content, deep-mode prepends go-deep instruction, `parseCreatedFilePath` extracts paths from various AI response formats.

### Files to Modify

- `packages/pipeline-core/src/index.ts` — Add re-export of `./tasks` barrel to make `task-prompt-builder` functions available to consumers.

- `packages/coc/src/server/index.ts` — Import and call `registerTaskGenerationRoutes(routes, store)` alongside existing `registerApiRoutes` and `registerQueueRoutes` calls so the new endpoints are wired into the router.

- `packages/coc/src/server/spa/index.ts` (or wherever the SPA HTML template is assembled) — Add "Generate Task with AI" button to the task panel header, include the `task-generation-dialog.js` component inline, add a "Discover" context-menu action on workspace folder items.

- `packages/coc/src/ai-invoker.ts` — Add an optional `streaming` callback parameter to `CLIAIInvokerOptions` and `createCLIAIInvoker` so the task-generation handler can pipe incremental AI output to the SSE stream. The callback signature: `onChunk?: (chunk: string) => void`.

- `packages/coc/src/server/router.ts` — No structural change needed if `registerTaskGenerationRoutes` follows the same `(routes, store)` convention; the router already iterates the routes array. Verify the regex pattern for `/api/workspaces/:id/tasks/generate` doesn't collide with existing workspace routes.

### Files to Delete

(none)

## Implementation Notes

1. **Prompt extraction strategy** — The extension's `buildCreateTaskPrompt`, `buildCreateFromFeaturePrompt`, `buildDeepModePrompt`, `gatherFeatureContext`, and `parseCreatedFilePath` functions are already pure logic with only `fs` and `path` imports (no VS Code API). They can be moved to pipeline-core almost verbatim. The extension file (`ai-task-commands.ts`) should then import from pipeline-core to avoid duplication, but that refactor is a **follow-up** (not in this commit) to keep the diff small and avoid breaking extension tests.

2. **Discovery vs. full DiscoveryEngine** — The VS Code `DiscoveryEngine` uses `vscode.EventEmitter` and `vscode.Disposable`. For CoC, we do NOT port the full engine. Instead, the `/tasks/discover` endpoint performs a simpler flow: build prompt from description + keywords → call CopilotSDKService → parse results. This mirrors how `CLITaskExecutor` already works in `queue-executor-bridge.ts`.

3. **SSE streaming** — The `/tasks/generate` endpoint should return an SSE stream (Content-Type: `text/event-stream`) with events: `event: progress` (phase updates), `event: chunk` (AI output fragments), `event: done` (final result with file path). Reuse the `sendEvent` helper pattern from `sse-handler.ts`.

4. **Workspace resolution** — Both endpoints extract workspace ID from the URL, look it up via `store.getWorkspaces()`, and use `ws.rootPath` as the working directory. If the workspace has a tasks folder configured (convention: `.vscode/tasks/`), use that as the target folder base.

5. **Permission model** — Task generation requires file-write permissions (`approveAllPermissions`) since the AI needs to create `.plan.md` files. Discovery is read-only (can use `denyAllPermissions`).

6. **Error handling** — Follow the existing `sendError(res, statusCode, message)` pattern. AI timeout → 504. AI unavailable → 503. Invalid input → 400.

7. **Model parameter** — Pass through the `model` field from the request body to `CopilotSDKService.sendMessage`. Default to whatever the SDK provides if omitted.

8. **SPA dialog** — Follow the existing inline-JS pattern used in `packages/coc/src/server/spa/`. The dialog should be a modal overlay with form fields, not a separate page. Use `fetch` + `EventSource` for the SSE stream.

## Tests

- **task-prompt-builder.test.ts** — 8-10 tests: prompt contains target path, prompt includes description, deep mode adds go-deep instruction, from-feature prompt includes plan/spec content, long content is truncated, parseCreatedFilePath finds absolute paths, backtick paths, and returns undefined for no match.
- **task-generation-handler.test.ts** — 10-12 tests: missing prompt → 400, workspace not found → 404, successful generate returns filePath, SSE stream sends progress + done events, discover endpoint returns items array, discover with no results → empty array, invalid scope fields ignored, model parameter forwarded to AI invoker.
- Existing CoC server tests (`api-handler.test.ts`, `integration.test.ts`) should continue to pass with no modifications.
- Run `npm run test:run` in both `packages/pipeline-core/` and `packages/coc/` directories.

## Acceptance Criteria

- [ ] `POST /api/workspaces/:id/tasks/generate` creates a `.plan.md` file in the workspace's tasks folder and returns its path
- [ ] `POST /api/workspaces/:id/tasks/discover` returns an array of related items (files and commits) with relevance scores
- [ ] SSE streaming sends `progress`, `chunk`, and `done` events during task generation
- [ ] SPA dashboard shows "Generate Task with AI" button that opens a dialog with prompt, folder, model, and mode fields
- [ ] SPA discovery button on feature folders triggers discover endpoint and displays results
- [ ] Prompt-building functions in pipeline-core have no VS Code dependencies and pass unit tests
- [ ] All existing CoC and pipeline-core tests continue to pass
- [ ] Request validation returns proper 400/404/503 errors for invalid inputs
- [ ] Works cross-platform (Linux, macOS, Windows) — no platform-specific path handling

## Dependencies

- Depends on: 009 (workspace management endpoints must exist for workspace resolution)
