# Remove Auto-Attached Context from "Generate Task" AI Prompt

## Problem

When using the **Generate Task** dialog in the CoC SPA dashboard, the system always sends `mode: 'from-feature'` which causes the server to call `gatherFeatureContext()` on the target folder. This reads `plan.md`, `spec.md`, `*.plan.md`, `*.spec.md`, `related.yaml`, and related source files from the target folder, then injects all of that content into the AI prompt under a `Context:` section.

This is problematic because:
- The user may not want existing folder content to influence the new task being generated
- The context from unrelated existing plan/spec documents pollutes the AI prompt (as shown in the screenshot where a Miller Column bug fix plan was attached as context to a completely unrelated task generation)
- The user has no way to control whether context is attached or not

## Current Flow

1. **Client** (`GenerateTaskDialog.tsx` line 126): Always sends `mode: 'from-feature'`
2. **Queue handler** (`task-generation-handler.ts` line 297): Passes `mode` through to `TaskGenerationPayload`
3. **Executor** (`queue-executor-bridge.ts` line 689): Checks `payload.mode === 'from-feature'` → calls `gatherFeatureContext()` → builds prompt with context
4. **Prompt builder** (`task-prompt-builder.ts` line 140-188): `buildCreateFromFeaturePrompt()` embeds plan, spec, description, related files in the AI prompt

## Approach

Add an **"Include folder context"** checkbox to the Generate Task dialog (default: **off**). When unchecked, send `mode: undefined` instead of `'from-feature'`. The existing server-side branching already handles this: when `mode !== 'from-feature'`, it uses `buildCreateTaskPrompt()` or `buildCreateTaskPromptWithName()` which don't gather folder context.

This is a **client-only change** — no server or pipeline-core modifications needed.

## Todos

### 1. Add `includeContext` toggle state to GenerateTaskDialog
- **File**: `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx`
- Add `const [includeContext, setIncludeContext] = useState(false);` (default off)
- In `handleGenerate`, change `mode: 'from-feature'` to `mode: includeContext ? 'from-feature' : undefined`

### 2. Add checkbox UI for "Include folder context"
- **File**: `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx`
- Add a checkbox between the "Target folder" and "Model" dropdowns (or after Depth)
- Label: "Include folder context" with a subtitle hint like "Attach plan.md, spec.md, and related files from the target folder"
- Style consistently with existing form elements

### 3. Update tests if any exist for GenerateTaskDialog
- Check for existing tests and update to cover both `includeContext: true` and `includeContext: false` paths

## Files to Modify

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx` | Add state + checkbox + conditional mode |

## Notes

- The server-side code already correctly handles `mode !== 'from-feature'` by falling through to `buildCreateTaskPrompt` / `buildCreateTaskPromptWithName` — no server changes needed
- Default is **off** (no context) since the user reported this as unwanted behavior
- Persisting the preference via `usePreferences` could be a follow-up enhancement
