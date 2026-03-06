# Plan: Show Detailed Prompt Info for Queued Tasks

## Problem

When viewing a queued task in the dashboard's Queue tab, the detail panel only shows the brief `promptContent` (e.g., "Use the impl skill.") under the **Prompt** heading. The payload contains much richer metadata — skill name, plan file path, additional context — that is not displayed. Users cannot see **what** a queued task will actually do without inspecting the raw payload.

## Proposed Approach

Enhance the SPA's pending-task detail view to surface all available payload fields in a structured, readable layout. Add a server-side endpoint to resolve plan file content so the dashboard can display it inline.

## Changes

### 1. Enhance `follow-prompt` detail rendering
**File:** `packages/coc/src/server/spa/client/detail.ts` → `renderPendingTaskPayload()`

Currently shows:
- Prompt file path (small gray text)
- Prompt content (pre block)

Add these fields to the metadata grid (before the Prompt pre block):
- **Skill Name** — from `payload.skillName`
- **Plan File** — from `payload.planFilePath` (clickable/readable path)
- **Additional Context** — from `payload.additionalContext` (collapsible pre block)

### 2. Enhance `ai-clarification` detail rendering
**File:** same function

Currently shows:
- File path, selected text, prompt

Add:
- **Skill Name** — from `payload.skillName`
- **Instruction Type** — from `payload.instructionType`
- **Custom Instruction** — from `payload.customInstruction`
- **Model** — from `payload.model` (if not already shown in the metadata grid)
- **Nearest Heading** — from `payload.nearestHeading`

### 3. Add `task-generation` detail rendering
**File:** same function

Currently falls through to generic JSON dump. Add a dedicated section:
- **Prompt** — from `payload.prompt`
- **Target Folder** — from `payload.targetFolder`
- **Task Name** — from `payload.name`
- **Depth** — from `payload.depth`
- **Mode** — from `payload.mode`

### 4. Add server-side plan file content resolution (optional stretch)
**File:** `packages/coc/src/server/queue-handler.ts`

Add a new endpoint `GET /api/queue/:id/resolved-prompt` that:
- Reads `payload.planFilePath` content (if file exists)
- Returns the assembled full prompt using `buildFollowPromptText()` logic
- Returns plan file content for inline display

The SPA can then optionally fetch and show the plan file content in a collapsible section.

### 5. Add "Resolved Prompt" collapsible section
**File:** `packages/coc/src/server/spa/client/detail.ts`

After showing the raw payload fields, add a **"Full Prompt (Resolved)"** section that:
- Calls the new endpoint to get the assembled prompt
- Shows it in a collapsible `<details>` block
- Includes plan file content if available

## Todos

- [x] `enhance-follow-prompt-detail` — Show skill name, plan file path, and additional context for follow-prompt tasks
- [x] `enhance-ai-clarification-detail` — Show instruction type, custom instruction, skill name for ai-clarification tasks
- [x] `add-task-generation-detail` — Add dedicated rendering for task-generation tasks
- [x] `add-resolved-prompt-endpoint` — Server endpoint to resolve plan file content and assemble full prompt
- [x] `add-resolved-prompt-section` — Collapsible "Full Prompt" section in detail view that fetches resolved prompt
- [x] `add-tests` — Tests for the new endpoint and rendering logic

## Notes

- The `renderPendingTaskPayload()` function at `detail.ts:407` is the single point of change for the SPA rendering.
- Plan file content is only available server-side (requires `fs.readFileSync`), hence the need for a new API endpoint.
- `buildFollowPromptText()` in `ai-queue-service.ts:102` shows how the VS Code extension assembles the full prompt — the server endpoint should replicate this logic.
- The `resolveContextBlock()` method in `queue-executor-bridge.ts:680` already reads plan files — can be reused.
