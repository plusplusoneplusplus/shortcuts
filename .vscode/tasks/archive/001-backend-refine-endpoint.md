---
status: pending
---

# 001: Add POST /api/workspaces/:id/pipelines/refine Backend Endpoint

## Summary
Add a new `POST /api/workspaces/:id/pipelines/refine` endpoint to `pipelines-handler.ts` that accepts an existing pipeline YAML and a natural-language instruction, calls the AI to produce a modified YAML, and returns the refined result. This is the server-side foundation for the "Edit with AI" feature.

## Motivation
The generate endpoint creates pipelines from scratch. Refinement is a distinct operation: it needs the current YAML as context so the AI can make targeted edits rather than regenerating from nothing. Separating this into its own commit keeps the backend change reviewable in isolation before the UI work begins.

## Changes

### Files to Create
- `packages/coc/test/server/pipelines-refine-handler.test.ts` — integration tests for the new endpoint

### Files to Modify
- `packages/coc/src/server/pipelines-handler.ts` — add the `/refine` route inside `registerPipelineWriteRoutes`

### Files to Delete
- (none)

## Implementation Notes

### Route location
Add the new route as a `routes.push(...)` block inside `registerPipelineWriteRoutes` (line ~372), just after the `/generate` block (lines 381-470). It shares the same `aiService` parameter already threaded through that function signature.

### Route pattern
```
POST /api/workspaces/:id/pipelines/refine
Regex: /^\/api\/workspaces\/([^/]+)\/pipelines\/refine$/
```
This literal `/refine` path is unambiguous alongside the existing `/generate` literal and the parameterised `/:pipelineName` patterns.

### Request body shape
```typescript
{
  currentYaml: string;   // Required. The full YAML text to be modified.
  instruction: string;   // Required. Natural-language description of the change.
  model?: string;        // Optional. AI model override (passed straight to sendMessage).
}
```
Validation: both `currentYaml` and `instruction` must be non-empty strings; return `400` otherwise. Additionally, `currentYaml` must parse as valid YAML (use `yaml.load(currentYaml)`) before sending to AI — return `400 'Invalid YAML: ...'` if it does not.

### Response body shape
Identical to `/generate`:
```typescript
{
  yaml: string;              // Extracted (fence-stripped) YAML from AI response.
  raw: string;               // Raw AI response string.
  valid: boolean;            // Whether extractedYaml parses as valid YAML.
  validationError?: string;  // yaml.load error message when valid=false.
}
```
No `suggestedName` field — the pipeline name is already known.

### System prompt strategy
```
You are a pipeline YAML editor. You modify existing pipeline YAML configurations based on user instructions.
Output ONLY the complete modified YAML. Do NOT wrap in markdown code fences. Do NOT include any explanation before or after the YAML.

${PIPELINE_SCHEMA_REFERENCE}
```

### User prompt strategy
```
Here is the current pipeline YAML:

${currentYaml.trim()}

Apply the following change:

${instruction.trim()}

Return the complete modified pipeline YAML.
```

The full prompt passed to `sendMessage` is `systemPrompt + '\n\n' + userPrompt`, matching the `/generate` convention.

### AI service call
Reuse the exact same pattern as `/generate` (lines 423-429):
```typescript
const result = await service.sendMessage({
  prompt: systemPrompt + '\n\n' + userPrompt,
  model: model || undefined,
  workingDirectory: ws.rootPath,
  timeoutMs: GENERATION_TIMEOUT_MS,        // 120_000 — reuse existing constant
  onPermissionRequest: denyAllPermissions,
});
```

### Response processing
- `!result.success` → `500 'Pipeline refinement failed: ...'`
- Call `extractYamlFromResponse(result.response || '')` — reuse the existing exported helper (line 203)
- `yaml.load(extractedYaml)` to set `valid` / `validationError` — same pattern as lines 438-445
- Timeout detection: `message.toLowerCase().includes('timeout')` → `504` — same as lines 464-466
- **Do not** attempt to extract or return `suggestedName`

### Error codes (summary)
| Condition | Status |
|-----------|--------|
| Workspace not found | 404 |
| Missing / empty `currentYaml` or `instruction` | 400 |
| `currentYaml` fails YAML parse | 400 |
| `aiService` not configured | 503 |
| `isAvailable()` returns false | 503 |
| `result.success === false` | 500 |
| timeout error thrown | 504 |
| any other thrown error | 500 |
| happy path | 200 |

## Tests

File: `packages/coc/test/server/pipelines-refine-handler.test.ts`

Follow the exact structure of `pipelines-generate-handler.test.ts`: use `createExecutionServer` with port 0, `FileProcessStore` in a temp dir, `createMockSDKService`, and the shared `request`/`postJSON` helpers.

- **Happy path** — valid `currentYaml` + `instruction`, mock AI returns modified YAML; assert `status=200`, `data.yaml`, `data.raw`, `data.valid=true`, `data.validationError` undefined
- **Fence stripping** — AI returns `\`\`\`yaml\n...\n\`\`\``; assert `data.yaml` has no fences and `data.raw` does
- **Missing `currentYaml`** — body `{ instruction: '...' }`; assert `status=400`, `data.error` contains `currentYaml`
- **Missing `instruction`** — body `{ currentYaml: '...' }`; assert `status=400`, `data.error` contains `instruction`
- **Empty `currentYaml`** — `currentYaml: '   '`; assert `status=400`
- **Empty `instruction`** — `instruction: '   '`; assert `status=400`
- **Invalid `currentYaml` YAML** — `currentYaml: '{ bad: [yaml:'`; assert `status=400`, `data.error` contains `Invalid YAML`
- **AI returns invalid YAML** — mock returns non-parseable string; assert `status=200`, `data.valid=false`, `data.validationError` defined
- **AI unavailable** — `isAvailable` returns `false`; assert `status=503`
- **AI fails** — `result.success=false`; assert `status=500`, `data.error` contains mock error message
- **Timeout** — mock throws `new Error('Request timeout exceeded')`; assert `status=504`
- **Unknown workspace** — assert `status=404`
- **Model forwarded** — pass `model: 'gpt-4'`; assert `sendMessage` called with `callArgs.model === 'gpt-4'`
- **`denyAllPermissions` wired** — assert `callArgs.onPermissionRequest` is defined
- **Prompt includes currentYaml and instruction** — inspect `callArgs.prompt` for both strings and for `PIPELINE_SCHEMA_REFERENCE` sentinel text (`Pipeline YAML Schema Reference`)

## Acceptance Criteria
- [ ] `POST /api/workspaces/:id/pipelines/refine` returns `200` with `{ yaml, raw, valid }` for a valid request
- [ ] Returns `400` when `currentYaml` or `instruction` is missing or empty
- [ ] Returns `400` when `currentYaml` is not valid YAML
- [ ] Returns `503` when AI service is not configured or unavailable
- [ ] Returns `504` on timeout, `500` on other AI failure
- [ ] `denyAllPermissions` is always passed to `sendMessage`
- [ ] `GENERATION_TIMEOUT_MS` (120 s) is reused for the timeout
- [ ] `extractYamlFromResponse` is reused to strip fences
- [ ] `valid=false` + `validationError` returned (not `500`) when AI produces unparseable YAML
- [ ] All tests in `pipelines-refine-handler.test.ts` pass (`npm run test:run` in `packages/coc`)

## Dependencies
- Depends on: None

## Assumed Prior State
None
