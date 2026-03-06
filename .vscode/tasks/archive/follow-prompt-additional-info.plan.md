# Follow Prompt – Additional Info Text Area

## Problem
The Follow Prompt dialog currently lets users pick a model, workspace, and a prompt/skill, but provides no way to pass contextual guidance to the AI. Users need an optional free-text field to supply extra context (e.g. "focus on the auth module", "output in JSON") that gets appended to the queued task payload.

## Acceptance Criteria
- [x] An optional `<textarea>` labeled "Additional info (optional)" is rendered below the Workspace selector in `FollowPromptDialog`.
- [x] The textarea is empty by default, multi-line, and accepts free text (no character limit enforced on the client).
- [x] When non-empty, its trimmed value is included in the queue payload as `additionalInfo`.
- [x] When empty, `additionalInfo` is **not** added to the payload (no change to existing behavior).
- [x] The textarea is disabled while a submission is in progress (`submitting === true`).
- [x] Pressing a prompt/skill button submits including any text currently in the textarea.
- [x] The `BulkFollowPromptDialog` receives the same textarea and passes `additionalInfo` the same way.
- [x] Existing tests continue to pass; new unit tests cover the textarea rendering and payload inclusion.

## Subtasks

### 1. UI – `FollowPromptDialog.tsx`
- Add `additionalInfo` state (`useState('')`).
- Render `<textarea>` below the Workspace `<select>`, same styling pattern as other form fields.
- Pass `additionalInfo.trim() || undefined` into `handleSubmit`.
- Update `handleSubmit` signature to accept `additionalInfo?: string`.
- Append `additionalInfo` to `payload` when present (both `prompt` and `skill` branches).

### 2. UI – `BulkFollowPromptDialog.tsx`
- Mirror the same textarea + state additions.

### 3. Tests – `FollowPromptDialog.test.tsx`
- Add test: textarea renders with placeholder.
- Add test: non-empty value is included in the POST body as `additionalInfo`.
- Add test: empty value does not add `additionalInfo` key.

### 4. (Optional) Backend – queue handler
- If the queue handler or task executor needs to surface `additionalInfo` to the AI prompt, update `queue-handler.ts` / the follow-prompt executor to append it to the prompt content.

## Notes
- `additionalInfo` is a UI-only addition to the existing `payload` object; no schema migration needed.
- The backend currently passes `payload` fields straight through, so the field will be available to the AI executor without backend changes unless explicit prompt injection is desired (see Subtask 4).
- Style the textarea consistently: `w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]`, `rows={3}`, `resize-y`.
