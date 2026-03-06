---
status: pending
---

# 001: Backend — AI Pipeline Generation Endpoint

## Summary
Add a `POST /api/workspaces/:id/pipelines/generate` endpoint that accepts a natural language description and returns AI-generated pipeline YAML, and extend the existing `POST /api/workspaces/:id/pipelines` create endpoint to accept optional `content` (bypassing template lookup when provided).

## Motivation
This is a server-side only commit, testable with `curl` against `coc serve`. It has zero UI dependencies — the dashboard changes (Commit 2) will consume this endpoint. Separating backend from frontend allows independent testing, review, and rollback.

## Changes

### Files to Create
- (none — all changes are additions to existing files)

### Files to Modify

#### `packages/coc/src/server/pipelines-handler.ts`
1. **Add imports** for `getCopilotSDKService`, `denyAllPermissions`, and `DEFAULT_AI_TIMEOUT_MS` from `@plusplusoneplusplus/pipeline-core` (same import pattern as `task-generation-handler.ts` lines 29–33).
2. **Add a new `POST /api/workspaces/:id/pipelines/generate` route** inside `registerPipelineWriteRoutes()`. This route:
   - Accepts `{ description: string, model?: string }` in the JSON body.
   - Validates `description` is a non-empty string.
   - Builds a system prompt embedding the pipeline schema knowledge (see Implementation Notes).
   - Calls `getCopilotSDKService().sendMessage(...)` with `denyAllPermissions` (no tool use — pure text generation).
   - Extracts YAML from the AI response (strips ```yaml fences if present).
   - Optionally validates the extracted YAML with `yaml.load()` (syntax check only — not full `validatePipeline` since no file on disk).
   - Returns `{ yaml: string, raw: string }` on success (200), or error on failure.
   - The route regex: `/^\/api\/workspaces\/([^/]+)\/pipelines\/generate$/`
   - **Must be registered BEFORE the existing `POST /api/workspaces/:id/pipelines` route** to avoid regex collision (the existing pattern `\/pipelines$` would not match `/pipelines/generate`, so ordering is safe, but register it first for clarity).

3. **Extend the existing `POST /api/workspaces/:id/pipelines` handler** (the create-from-template route at line 385–448):
   - After parsing the body, check for an optional `content` field (string).
   - If `content` is provided and non-empty, use it directly as the pipeline YAML instead of looking up `TEMPLATES[templateKey]`.
   - Still validate YAML syntax with `yaml.load(content)` before writing.
   - The `template` field becomes optional when `content` is provided.
   - Response includes `template: 'custom'` (or omit) when content was provided directly.

### Files to Delete
- (none)

## Implementation Notes

### System Prompt Construction Strategy

The system prompt must embed enough schema knowledge for the AI to generate valid YAML without needing tool access. The prompt should be constructed from three parts:

**Part 1 — Role & constraints:**
```
You are a pipeline YAML generator. You produce valid pipeline YAML configurations and nothing else.
Output ONLY the raw YAML content. Do NOT wrap it in markdown code fences. Do NOT include any explanation before or after the YAML.
```

**Part 2 — Schema reference (embedded from `.github/skills/pipeline-generator/references/schema.md`):**
The full schema.md content should be embedded as a reference section. This gives the AI:
- Root configuration for both map-reduce and single-job modes
- InputConfig, MapConfig, ReduceConfig, FilterConfig, JobConfig schemas
- Template variable syntax (`{{var}}`)
- Validation rules and constraints
- Anti-patterns to avoid

**Part 3 — User request:**
```
Generate a pipeline YAML configuration for the following requirement:

{description}
```

**How to load the schema at runtime:**
The schema content should be a const string embedded directly in the source file (not loaded from disk at runtime), since:
- The `.github/skills/` directory may not exist in the deployed npm package
- It avoids filesystem I/O on every request
- The schema rarely changes

Extract the essential schema rules into a `PIPELINE_SCHEMA_REFERENCE` constant string (~100-150 lines) that covers:
- The two pipeline modes (map-reduce vs single-job) with their required fields
- Input configuration options (items, CSV, generate, multi-model)
- Map configuration (prompt, output, parallel, timeoutMs, batchSize)
- Reduce configuration (type options, AI reduce with prompt)
- Filter configuration (rule, ai, hybrid)
- Job configuration (prompt, output, model)
- Parameters syntax
- Template variables (`{{var}}`, `{{RESULTS}}`, `{{COUNT}}`, etc.)

### YAML Extraction from AI Response

The AI may return YAML in several formats. Extract with this strategy:

```typescript
function extractYamlFromResponse(response: string): string {
    // 1. Try to extract from ```yaml ... ``` code blocks
    const yamlBlockMatch = response.match(/```(?:yaml|yml)\s*\n([\s\S]*?)```/);
    if (yamlBlockMatch) {
        return yamlBlockMatch[1].trim();
    }
    // 2. Try to extract from generic ``` ... ``` code blocks
    const genericBlockMatch = response.match(/```\s*\n([\s\S]*?)```/);
    if (genericBlockMatch) {
        return genericBlockMatch[1].trim();
    }
    // 3. Assume the entire response is YAML (strip leading/trailing whitespace)
    return response.trim();
}
```

### Route Pattern (regex)

```typescript
{
    method: 'POST',
    pattern: /^\/api\/workspaces\/([^/]+)\/pipelines\/generate$/,
    handler: async (req, res, match) => { ... }
}
```

This does NOT conflict with the existing `POST /api/workspaces/:id/pipelines` route (pattern: `/^\/api\/workspaces\/([^/]+)\/pipelines$/`) because the `/generate` suffix differentiates them.

### Extending the Existing POST Create Endpoint

Current flow (line 402):
```typescript
const { name, template } = body || {};
```

New flow:
```typescript
const { name, template, content } = body || {};
// ... name validation unchanged ...

let yamlContent: string;
if (content && typeof content === 'string' && content.trim()) {
    // Validate YAML syntax
    try {
        yaml.load(content);
    } catch (err: any) {
        return sendError(res, 400, 'Invalid YAML: ' + (err.message || 'Parse error'));
    }
    yamlContent = content;
} else {
    const templateKey = (typeof template === 'string' && template) ? template : 'custom';
    const templateContent = TEMPLATES[templateKey];
    if (!templateContent) {
        return sendError(res, 400, `Unknown template: ${templateKey}. Valid templates: ${Object.keys(TEMPLATES).join(', ')}`);
    }
    yamlContent = templateContent;
}

// Write yamlContent instead of templateContent
fs.writeFileSync(path.join(resolvedDir, 'pipeline.yaml'), yamlContent, 'utf-8');
```

### AI Service Call Pattern

Following the pattern established in `task-generation-handler.ts` (lines 153–176):

```typescript
const service = getCopilotSDKService();
const available = await service.isAvailable();
if (!available.available) {
    return sendError(res, 503, 'AI service unavailable');
}

const result = await service.sendMessage({
    prompt: systemPrompt + '\n\n' + userPrompt,
    model: model || undefined,
    workingDirectory: ws.rootPath,
    timeoutMs: 120_000, // 2 min — generation is fast, no tool use
    onPermissionRequest: denyAllPermissions, // No tool use
});

if (!result.success) {
    return sendError(res, 500, result.error || 'Pipeline generation failed');
}
```

### Error Handling

| Scenario | Status Code | Message |
|----------|-------------|---------|
| Workspace not found | 404 | 'Workspace not found' |
| Missing/empty description | 400 | 'Missing required field: description' |
| AI service unavailable | 503 | 'AI service unavailable' |
| AI generation failed | 500 | 'Pipeline generation failed: {error}' |
| AI response has invalid YAML | 200 | Return the YAML anyway (let the client decide); set `valid: false` in response |
| Timeout | 504 | 'Pipeline generation timed out' |

### Response Shape

```typescript
// POST /api/workspaces/:id/pipelines/generate
{
    yaml: string;     // Extracted YAML (cleaned of code fences)
    raw: string;      // Original AI response (for debugging)
    valid: boolean;   // Whether yaml.load() succeeded
    validationError?: string; // If valid is false, the parse error
}
```

### Timeout Configuration

Use 120,000ms (2 min) as the AI timeout. Pipeline generation is a pure text-generation task with no tool calls, so it should complete in 10-30 seconds. The 2-minute timeout provides generous headroom.

## Tests

### Unit Tests (add to existing test file or create new)

1. **`extractYamlFromResponse`** — Test YAML extraction:
   - Input with ````yaml ... ```` fences → extracts inner content
   - Input with plain ```` ... ```` fences → extracts inner content
   - Input with no fences (raw YAML) → returns as-is
   - Input with leading/trailing whitespace → trimmed
   - Input with multiple code blocks → extracts first one

2. **Generate endpoint — happy path:**
   - Mock `getCopilotSDKService()` to return a valid pipeline YAML response
   - POST to `/api/workspaces/:id/pipelines/generate` with `{ description: "classify bugs" }`
   - Assert 200 with `{ yaml, raw, valid: true }`

3. **Generate endpoint — missing description:**
   - POST with `{}` or `{ description: "" }`
   - Assert 400

4. **Generate endpoint — AI service unavailable:**
   - Mock `isAvailable()` to return `{ available: false }`
   - Assert 503

5. **Generate endpoint — AI returns invalid YAML:**
   - Mock AI to return prose instead of YAML
   - Assert 200 with `valid: false` and `validationError` populated

6. **Generate endpoint — workspace not found:**
   - POST with non-existent workspace ID
   - Assert 404

7. **Create endpoint with content — happy path:**
   - POST to `/api/workspaces/:id/pipelines` with `{ name: "test", content: "name: Test\ninput: ..." }`
   - Assert pipeline.yaml written with the provided content (not a template)

8. **Create endpoint with content — invalid YAML:**
   - POST with `{ name: "test", content: "{{invalid yaml" }`
   - Assert 400 with YAML parse error

9. **Create endpoint with content — still works with template fallback:**
   - POST with `{ name: "test", template: "custom" }` (no content)
   - Assert existing behavior unchanged

## Acceptance Criteria
- [ ] `POST /api/workspaces/:id/pipelines/generate` endpoint exists and returns AI-generated YAML
- [ ] Response includes `yaml`, `raw`, `valid`, and optional `validationError` fields
- [ ] The `description` field is required and validated
- [ ] AI service unavailability returns 503
- [ ] Timeout returns 504
- [ ] YAML extraction handles ```yaml fences, plain fences, and raw YAML
- [ ] `POST /api/workspaces/:id/pipelines` accepts optional `content` field
- [ ] When `content` is provided, it is written directly (template lookup is skipped)
- [ ] When `content` has invalid YAML syntax, 400 is returned
- [ ] Existing template-based creation still works when `content` is not provided
- [ ] All new code has unit test coverage
- [ ] `npm run build` passes
- [ ] Existing tests still pass

## Dependencies
- Depends on: None

## Assumed Prior State
None — this is the first commit.
