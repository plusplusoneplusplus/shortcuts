# Optional Pipeline Name with AI-Suggested Name

## Problem

When creating an AI-generated pipeline in the CoC SPA dashboard (`AddPipelineDialog`), the user **must** provide a pipeline name before clicking "Generate Pipeline ✨". This is unnecessary friction because the AI can derive a meaningful name from the description itself.

## Proposed Approach

Make the **Name** field optional when the "AI Generated" template is selected. When the user leaves the name empty, the server-side generation endpoint will ask AI to also propose a pipeline name (kebab-case slug) alongside the YAML. The proposed name is shown in the preview phase, and the user can edit it before saving.

## Current Flow

1. User enters **Name** (required), selects **AI Generated** template, writes **Description**
2. Client calls `POST /api/workspaces/:id/pipelines/generate` with `{ name, description }`
3. Server sends description to AI → returns `{ yaml, valid }`
4. User reviews YAML preview → clicks "Save Pipeline ✓"
5. Client calls `POST /api/workspaces/:id/pipelines` with `{ name, content: yaml }`

## New Flow

1. User optionally enters **Name**, selects **AI Generated** template, writes **Description**
2. Client calls `POST /api/workspaces/:id/pipelines/generate` with `{ description }` (name omitted or empty)
3. Server sends description to AI with an augmented prompt that also requests a suggested `name` field in the YAML
4. Server extracts the `name` from the generated YAML and returns `{ yaml, valid, suggestedName }`
5. User reviews YAML preview; an editable **Name** field (pre-filled with `suggestedName`) appears in the preview phase
6. User edits name if desired → clicks "Save Pipeline ✓"
7. Client calls `POST /api/workspaces/:id/pipelines` with `{ name, content: yaml }`

## Files to Change

### 1. `packages/coc/src/server/spa/client/react/repos/AddPipelineDialog.tsx`
- Remove name-required validation in `handleGenerate()` when `isAiMode` is true
- Add visual hint (e.g., placeholder "Leave blank for AI suggestion") to the Name input when AI mode is selected
- In the **preview** phase, show an editable Name input pre-filled with `suggestedName` (from generation response) or the user-provided name
- Update `handleSave()` to read the name from the preview-phase input
- Keep name **required** for non-AI templates (no change to `handleSubmit`)

### 2. `packages/coc/src/server/spa/client/react/repos/pipeline-api.ts`
- Make `name` parameter optional in `generatePipeline()` function signature
- Update `GenerateResult` type to include optional `suggestedName?: string`

### 3. `packages/coc/src/server/pipelines-handler.ts`
- In the `/generate` handler: stop requiring `name` from request body
- Augment the AI system prompt to instruct: "The YAML must include a `name` field. Choose a short, descriptive kebab-case name based on the user's requirement."
- After extracting YAML, parse out the `name` field from the generated YAML
- Return `suggestedName` in the response alongside `yaml` and `valid`

### 4. Tests

#### `packages/coc/test/spa/react/PipelineUI.test.tsx`
- Update existing tests that check for "Name is required" error on generate — should no longer error when name is empty in AI mode
- Add test: AI mode with empty name → generation succeeds, preview shows editable name with suggested value
- Add test: AI mode with user-provided name → name is preserved (not overridden by AI suggestion)
- Add test: preview phase name input is editable and used by Save

#### `packages/coc/test/server/pipelines-generate-handler.test.ts`
- Add test: `/generate` with no name → succeeds and returns `suggestedName`
- Add test: `/generate` with name → still works (backward compat)
- Add test: AI response includes a parseable name → `suggestedName` is extracted

#### `packages/coc/test/spa/react/pipeline-api.test.ts`
- Update `generatePipeline` call signature tests for optional name

## Edge Cases & Considerations

- **Name collision**: The AI-suggested name might already exist. Keep existing server-side 409 handling at save time; the user can edit the name in preview.
- **AI doesn't include name in YAML**: Fallback to a generic slug like `"ai-pipeline"` or derive from the first few words of the description.
- **Name field in YAML vs directory name**: The `name` in the YAML is the display name; the directory name (used at save time) is what the user confirms in the preview. They can differ.
- **Non-AI templates**: No changes — name remains required for Custom, Data Fan-out, Model Fan-out.
- **Backward compatibility**: The `/generate` endpoint already ignores the `name` field on the server side. Making it optional on the client side is a non-breaking change.

## Todos

1. ~~**server-augment-prompt** — Update AI prompt in `/generate` handler to request a `name` field in YAML; extract `suggestedName` from response~~
2. ~~**api-optional-name** — Make `name` optional in `generatePipeline()` client API; add `suggestedName` to `GenerateResult`~~
3. ~~**dialog-optional-name** — Update `AddPipelineDialog` to make name optional in AI mode and show editable name in preview phase~~
4. ~~**tests-server** — Add/update server handler tests for optional name and suggestedName extraction~~
5. ~~**tests-ui** — Add/update React component tests for the new optional name flow~~
