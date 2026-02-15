---
commit: "010"
title: Add AI integration for review editor in serve mode
status: pending
---

# 010 — Add AI integration for review editor in serve mode

## Why

The VS Code review editor offers rich AI features — ask-AI clarification, queued background execution, prompt generation, and follow-prompt workflows. The CoC standalone server needs equivalent capabilities so the review SPA (commit 008+) can submit AI requests, track their progress, and consume results without VS Code.

pipeline-core already provides `CopilotSDKService` and `TaskQueueManager`/`QueueExecutor`; the CoC server already has `ProcessStore` wired to WebSocket broadcast. This commit bridges the gap by adding AI-specific REST endpoints and an executor that ties these pieces together.

### Scope decisions

| Feature | Status | Rationale |
|---------|--------|-----------|
| Ask AI (background) | **Include** | Uses `CopilotSDKService.sendMessage()` — no VS Code deps |
| Ask AI (queued) | **Include** | Uses existing `TaskQueueManager` + `QueueExecutor` in CoC |
| Prompt generation | **Include** | `PromptGenerator` / `PromptGeneratorBase` have zero `vscode` imports |
| Prompt file listing | **Include** | Pure `fs` walk for `*.prompt.md` — `getPromptFiles()` logic reusable |
| Interactive sessions | **Defer** | Requires external terminal (`InteractiveSessionManager`) |
| Copilot Chat | **Defer** | VS Code–only API (`vscode.commands.executeCommand`) |
| Update Document | **Defer** | Launches interactive terminal session |
| Refresh Plan | **Defer** | Launches interactive terminal session |

## Dependencies

- **002** — CommentsManager extracted to pure Node.js (prompt generation reads comments)
- **007** — Review handler routes landed (`review-handler.ts`, `registerReviewRoutes`)
- **Router / ProcessStore / WebSocket** — already wired in `packages/coc/src/server/`
- **pipeline-core AI SDK** — `CopilotSDKService`, `SendMessageOptions`, `SDKInvocationResult`
- **pipeline-core queue** — `TaskQueueManager`, `QueueExecutor`, `TaskExecutor`

## What changes

### 1. New file: `packages/coc/src/server/review-ai-handler.ts`

Single `registerReviewAIRoutes(routes, deps)` function following the same pattern as `review-handler.ts` and `queue-handler.ts`.

**Dependencies parameter:**

```typescript
interface ReviewAIDeps {
    projectDir: string;
    store: ProcessStore;
    queueManager: TaskQueueManager;
}
```

#### Routes

| Method | Pattern | Description |
|--------|---------|-------------|
| `POST` | `/api/review/files/:path/ask-ai` | Submit AI clarification request (background) |
| `POST` | `/api/review/files/:path/ask-ai-queued` | Submit AI request via task queue |
| `POST` | `/api/review/files/:path/generate-prompt` | Generate prompt from file's comments |
| `GET`  | `/api/review/prompts` | List available `.prompt.md` files |
| `GET`  | `/api/review/prompts/:path` | Read a single `.prompt.md` file content |

#### Route patterns (regex)

```typescript
// Ask AI (background — immediate SDK call)
{ method: 'POST', pattern: /^\/api\/review\/files\/(.+)\/ask-ai$/, handler: ... }

// Ask AI (queued — goes through TaskQueueManager)
{ method: 'POST', pattern: /^\/api\/review\/files\/(.+)\/ask-ai-queued$/, handler: ... }

// Generate prompt from comments
{ method: 'POST', pattern: /^\/api\/review\/files\/(.+)\/generate-prompt$/, handler: ... }

// List prompt files
{ method: 'GET', pattern: '/api/review/prompts', handler: ... }

// Read single prompt file
{ method: 'GET', pattern: /^\/api\/review\/prompts\/(.+)$/, handler: ... }
```

#### Request / response shapes

**`POST /api/review/files/:path/ask-ai`** — body:

```json
{
  "selectedText": "some markdown text",
  "startLine": 5,
  "endLine": 8,
  "surroundingLines": "context before and after",
  "nearestHeading": "## Installation",
  "instructionType": "clarify",
  "customInstruction": null,
  "promptFileContent": null,
  "model": null,
  "timeoutMs": null
}
```

Required: `selectedText`, `startLine`, `endLine`, `instructionType`.
Optional: everything else (defaults apply).

Response `202 Accepted`:

```json
{
  "processId": "ai-review-abc123",
  "status": "running",
  "message": "AI clarification started"
}
```

The caller tracks progress via WebSocket (`process-updated` events) or polls `GET /api/processes/:id`.

**`POST /api/review/files/:path/ask-ai-queued`** — same body as ask-ai.

Response `202 Accepted`:

```json
{
  "taskId": "queue-xyz789",
  "position": 3,
  "totalQueued": 5,
  "message": "Added to queue (#3)"
}
```

**`POST /api/review/files/:path/generate-prompt`** — body (all optional):

```json
{
  "outputFormat": "markdown",
  "groupByFile": true,
  "includeLineNumbers": true,
  "customPreamble": null,
  "customInstructions": null
}
```

Response `200`:

```json
{
  "prompts": [
    {
      "prompt": "## Review Comments\n\n### README.md\n...",
      "commentCount": 5,
      "chunkIndex": 0,
      "totalChunks": 1
    }
  ],
  "totalComments": 5
}
```

Returns empty `prompts: []` with `totalComments: 0` when no open comments exist.

**`GET /api/review/prompts`**

Response `200`:

```json
{
  "prompts": [
    {
      "name": "clarify",
      "relativePath": ".github/prompts/clarify.prompt.md",
      "absolutePath": "/home/user/project/.github/prompts/clarify.prompt.md",
      "sourceFolder": ".github/prompts"
    }
  ]
}
```

**`GET /api/review/prompts/:path`**

Response `200`:

```json
{
  "path": ".github/prompts/clarify.prompt.md",
  "name": "clarify",
  "content": "# Clarification Prompt\n\nPlease clarify..."
}
```

#### Error responses

Reuse `sendError()` from `api-handler.ts`:

- `400` — invalid JSON, missing required fields, path traversal
- `404` — file or prompt not found
- `503` — SDK not available (`CopilotSDKService.isAvailable()` returns false)

### 2. New file: `packages/coc/src/server/review-ai-executor.ts`

The AI execution logic, separated from HTTP concerns for testability.

```typescript
export interface ReviewAIClarificationRequest {
    filePath: string;
    selectedText: string;
    startLine: number;
    endLine: number;
    surroundingLines?: string;
    nearestHeading?: string;
    instructionType: 'clarify' | 'go-deeper' | 'custom';
    customInstruction?: string;
    promptFileContent?: string;
    model?: string;
    timeoutMs?: number;
}

export interface ReviewAIClarificationResult {
    processId: string;
    success: boolean;
    clarification?: string;
    error?: string;
    tokenUsage?: TokenUsage;
}
```

**`executeAIClarification(request, store): Promise<ReviewAIClarificationResult>`**

1. Check `CopilotSDKService.isAvailable()` — throw if not
2. Build prompt from request fields (reuse prompt-building logic from `ai-clarification-handler.ts`, adapted without vscode deps)
3. Create an `AIProcess` record in `ProcessStore` with status `running`, type `clarification`
4. Call `CopilotSDKService.getInstance().sendMessage({ prompt, model, workingDirectory, timeoutMs, onPermissionRequest: approveAllPermissions })`
5. On success: update process to `completed` with result
6. On failure: update process to `failed` with error
7. Return `ReviewAIClarificationResult`

ProcessStore's `onProcessChange` callback automatically broadcasts WebSocket events — no extra wiring needed.

**`buildClarificationPrompt(request): string`**

Extracted prompt builder that mirrors the logic in `src/shortcuts/markdown-comments/ai-clarification-handler.ts`:

```typescript
export function buildClarificationPrompt(request: ReviewAIClarificationRequest): string {
    const parts: string[] = [];

    if (request.promptFileContent) {
        parts.push('--- Instructions from template ---');
        parts.push(request.promptFileContent);
        parts.push('', '--- Document context ---');
    }

    parts.push(`File: ${request.filePath}`);
    if (request.nearestHeading) {
        parts.push(`Section: ${request.nearestHeading}`);
    }
    parts.push(`Lines: ${request.startLine}-${request.endLine}`, '');
    parts.push('Selected text:', '```', request.selectedText, '```', '');

    // Instruction
    const instructionMap: Record<string, string> = {
        'clarify': 'Please clarify and explain the selected text.',
        'go-deeper': 'Please provide a deep analysis of the selected text, including implications, edge cases, and related concepts.',
        'custom': request.customInstruction || 'Please help me understand the selected text.'
    };
    parts.push(instructionMap[request.instructionType] || instructionMap['clarify']);

    if (request.surroundingLines) {
        parts.push('', 'Surrounding context:', '```', request.surroundingLines, '```');
    }

    return parts.join('\n');
}
```

**`createReviewTaskExecutor(store): TaskExecutor`**

Factory that returns a `TaskExecutor` implementation for the queue. The executor:
- Extracts `ReviewAIClarificationRequest` from the task's payload
- Calls `executeAIClarification(request, store)`
- Returns the result for the queue to record

```typescript
export function createReviewTaskExecutor(store: ProcessStore): TaskExecutor {
    return {
        async execute(task: QueueTask): Promise<TaskResult> {
            const request = task.payload as ReviewAIClarificationRequest;
            const result = await executeAIClarification(request, store);
            return {
                success: result.success,
                output: result.clarification,
                error: result.error
            };
        }
    };
}
```

### 3. Prompt file utilities: `packages/coc/src/server/prompt-utils.ts`

Extract prompt file discovery logic without VS Code deps. Mirrors `src/shortcuts/shared/prompt-files-utils.ts`:

```typescript
export interface PromptFileInfo {
    name: string;
    relativePath: string;
    absolutePath: string;
    sourceFolder: string;
}

/** Discover .prompt.md files under the given directories. */
export async function discoverPromptFiles(
    projectDir: string,
    locations?: string[]
): Promise<PromptFileInfo[]>

/** Read a prompt file content, stripping YAML frontmatter. */
export async function readPromptFileContent(
    absolutePath: string
): Promise<string>
```

Default locations: `['.github/prompts']` (matching VS Code extension default `DEFAULT_PROMPT_LOCATION`).

Walk directories recursively for `*.prompt.md` files, skip `node_modules`/`.git`/hidden dirs. Use `safePath()` guard from `review-handler.ts` before reading.

### 4. Wire into server: `packages/coc/src/server/index.ts`

Add imports and registration:

```typescript
import { registerReviewAIRoutes } from './review-ai-handler';
import { createReviewTaskExecutor } from './review-ai-executor';
```

After existing `registerReviewRoutes(routes, projectDir)`:

```typescript
registerReviewAIRoutes(routes, {
    projectDir,
    store,
    queueManager
});
```

Register the review task executor with the QueueExecutor so queued AI tasks are processed:

```typescript
// If QueueExecutor supports registering task type handlers:
queueExecutor.registerExecutor('review-ai-clarification', createReviewTaskExecutor(store));
```

If `QueueExecutor` uses a single executor, wrap with a delegating executor that routes by task type.

### 5. Update types: `packages/coc/src/server/types.ts`

No new options needed — `projectDir` already exists from commit 007, `store` and `queueManager` already wired.

### 6. Re-exports: `packages/coc/src/server/index.ts`

```typescript
export { registerReviewAIRoutes } from './review-ai-handler';
export { createReviewTaskExecutor, executeAIClarification, buildClarificationPrompt } from './review-ai-executor';
export { discoverPromptFiles, readPromptFileContent } from './prompt-utils';
```

## Implementation notes

### SDK availability check

Before any AI request, call `CopilotSDKService.getInstance().isAvailable()`. If unavailable, return `503 Service Unavailable` with a clear error message. The SPA can use this to hide/disable AI buttons.

Add a lightweight health-check field:

```typescript
// GET /api/health already exists — extend its response
{ "status": "ok", "ai": { "available": true } }
```

### Process tracking flow

```
Client POST /ask-ai
  → review-ai-handler validates request
  → calls executeAIClarification()
    → creates AIProcess (status: running) in ProcessStore
      → ProcessStore.onProcessChange fires
        → WebSocket broadcasts { type: 'process-added', process }
    → CopilotSDKService.sendMessage()
    → updates AIProcess (status: completed/failed)
      → ProcessStore.onProcessChange fires
        → WebSocket broadcasts { type: 'process-updated', process }
  → returns 202 { processId }

Client listens on WebSocket for process-updated events
Client can also poll GET /api/processes/:id
```

No new WebSocket event types needed — the existing `process-added` / `process-updated` / `process-removed` events carry all needed data.

### Process metadata

Store review-specific metadata on the `AIProcess.metadata` field:

```typescript
{
    type: 'clarification',
    source: 'review-editor',
    filePath: 'docs/guide.md',
    startLine: 5,
    endLine: 8,
    instructionType: 'clarify'
}
```

This lets the SPA filter AI processes related to review (vs. pipeline executions, code reviews, etc.) when displaying in the sidebar.

### Prompt generation integration

`PromptGenerator` needs a `CommentsManager` instance. The `review-handler.ts` from commit 007 already instantiates one. Share that instance:

```typescript
// review-handler.ts exports the manager getter
export function getCommentsManager(): CommentsManager { ... }

// review-ai-handler.ts imports it
import { getCommentsManager } from './review-handler';
const generator = new PromptGenerator(getCommentsManager());
const prompts = generator.generatePrompts(options);
```

Alternatively, `registerReviewAIRoutes` receives the CommentsManager directly in its deps object. Prefer this for testability:

```typescript
interface ReviewAIDeps {
    projectDir: string;
    store: ProcessStore;
    queueManager: TaskQueueManager;
    commentsManager: CommentsManager;  // shared instance from review-handler
}
```

### Queue task type

Use a distinct task type `'review-ai-clarification'` so the executor knows how to deserialize the payload. The `displayName` auto-generated from payload follows the pattern in `queue-handler.ts`:

```typescript
`AI: ${instructionType} (${path.basename(filePath)}:${startLine})`
```

### Timeout handling

- Default timeout: `DEFAULT_AI_TIMEOUT_MS` from pipeline-core (30 minutes / 1800000ms)
- Client can override via `timeoutMs` in request body
- On timeout: process marked `failed` with `"AI request timed out"` error

### Working directory

`CopilotSDKService.sendMessage()` accepts `workingDirectory`. Default to `projectDir`. If `projectDir/src` exists, use that (matching VS Code extension behavior from `getWorkingDirectory()`).

## Files touched

| File | Action |
|------|--------|
| `packages/coc/src/server/review-ai-handler.ts` | **Create** — `registerReviewAIRoutes` + route handlers |
| `packages/coc/src/server/review-ai-executor.ts` | **Create** — `executeAIClarification`, `buildClarificationPrompt`, `createReviewTaskExecutor` |
| `packages/coc/src/server/prompt-utils.ts` | **Create** — `discoverPromptFiles`, `readPromptFileContent` |
| `packages/coc/src/server/index.ts` | **Edit** — import + wire AI routes, add re-exports |
| `packages/coc/src/server/review-handler.ts` | **Edit** — export CommentsManager getter or accept injection |

## Estimated size

- `review-ai-handler.ts` — ~180–220 lines (5 routes + validation)
- `review-ai-executor.ts` — ~150–180 lines (executor, prompt builder, process tracking)
- `prompt-utils.ts` — ~80–100 lines (discovery + reader)
- Edits to existing files — ~15–20 lines total

## Testing notes

Unit tests in `packages/coc/test/review-ai-handler.test.ts` and `packages/coc/test/review-ai-executor.test.ts` using Vitest.

### review-ai-handler tests

- **ask-ai happy path** — mock `executeAIClarification` → verify 202, processId returned
- **ask-ai missing required fields** — omit `selectedText` → 400
- **ask-ai SDK unavailable** — mock `isAvailable()` → false → 503
- **ask-ai-queued** — mock `queueManager.enqueue()` → verify 202 with position
- **generate-prompt with comments** — seed CommentsManager → verify prompt text returned
- **generate-prompt no comments** — empty manager → verify `prompts: [], totalComments: 0`
- **list prompts** — create temp `.prompt.md` files → verify listing
- **read prompt** — verify content returned with frontmatter stripped
- **read prompt not found** — 404
- **path traversal on prompt read** — `../../etc/passwd` → 400

### review-ai-executor tests

- **buildClarificationPrompt** — verify all instruction types produce correct prompt structure
- **buildClarificationPrompt with promptFileContent** — verify template section prepended
- **buildClarificationPrompt with surrounding context** — verify context appended
- **executeAIClarification happy path** — mock SDK, verify process created → updated to completed
- **executeAIClarification failure** — mock SDK throw → process marked failed
- **executeAIClarification timeout** — mock SDK timeout → process marked failed with timeout message
- **createReviewTaskExecutor** — verify TaskExecutor interface, delegates to executeAIClarification

### prompt-utils tests

- **discoverPromptFiles** — temp dir with nested `.prompt.md` → correct listing
- **discoverPromptFiles skips hidden dirs** — `.hidden/foo.prompt.md` not listed
- **readPromptFileContent** — file with YAML frontmatter → frontmatter stripped
- **readPromptFileContent no frontmatter** — returned as-is
