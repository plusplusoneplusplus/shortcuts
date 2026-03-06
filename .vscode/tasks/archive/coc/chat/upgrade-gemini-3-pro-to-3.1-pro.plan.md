Tools are experiencing issues. I'll provide the revised document content directly based on the comment requesting `-preview` be added to the model name (`gemini-3.1-pro` → `gemini-3.1-pro-preview`):

# Upgrade gemini-3-pro-preview → gemini-3.1-pro-preview across the repo

## Problem
The model ID `gemini-3-pro-preview` needs to be upgraded to `gemini-3.1-pro-preview` everywhere it appears — source code, configuration, tests, and documentation.

## Approach
Straightforward find-and-replace across all affected files, updating both the model ID string and its human-readable label/description.

## Affected Files (8 files, ~15 occurrences)

### 1. Model Registry (source of truth)
- **`packages/pipeline-core/src/copilot-sdk-wrapper/model-registry.ts`**
  - Line 80: `id: 'gemini-3-pro-preview'` → `'gemini-3.1-pro-preview'`
  - Line 82: `label: 'Gemini 3 Pro'` → `'Gemini 3.1 Pro'`
  - Line 83: `description: '(Preview)'` → `'(Preview)'` (unchanged)
  - Line 108: `'gemini-3-pro-preview'` → `'gemini-3.1-pro-preview'` in VALID_MODELS tuple type

### 2. VS Code Extension Config (`package.json`)
- **`package.json`**
  - Line 385: enum value `"gemini-3-pro-preview"` → `"gemini-3.1-pro-preview"`
  - Line 393: description `"Gemini 3 Pro Preview - Google's latest model"` → `"Gemini 3.1 Pro Preview - Google's latest model"`
  - Line 547: enum value `"gemini-3-pro-preview"` → `"gemini-3.1-pro-preview"`
  - Line 555: description `"Gemini 3 Pro (Preview)"` → `"Gemini 3.1 Pro (Preview)"`

### 3. Tests
- **`packages/pipeline-core/test/ai/model-registry.test.ts`**
  - Line 121: `'gemini-3-pro-preview'` → `'gemini-3.1-pro-preview'`
  - Line 162: label expectation `'Gemini 3 Pro'` → `'Gemini 3.1 Pro'`
  - Line 176: description expectation `'(Preview)'` → `'(Preview)'` (unchanged)
  - Line 209: `'gemini-3-pro-preview'` → `'gemini-3.1-pro-preview'`
- **`src/test/suite/model-registry.test.ts`**
  - Line 195: `'gemini-3-pro-preview'` → `'gemini-3.1-pro-preview'`
- **`src/test/suite/ai-clarification.test.ts`**
  - Line 127: mock output `gemini-3-pro-preview` → `gemini-3.1-pro-preview` (test fixture)
  - Line 135: assertion `!result.includes('gemini-3-pro')` → `!result.includes('gemini-3.1-pro')` (or similar — verify the intent is "model names are stripped from parsed output")

### 4. Documentation / Reference
- **`resources/bundled-skills/pipeline-generator/references/patterns.md`**
  - Line 224: `model: gemini-3-pro` → `model: gemini-3.1-pro-preview`

## Todos

| ID | Title | Depends On |
|----|-------|------------|
| `model-registry` | Update model-registry.ts (ID, label, VALID_MODELS type) | — |
| `package-json` | Update package.json enum values and descriptions (2 locations) | — |
| `tests-pipeline-core` | Update pipeline-core model-registry tests | `model-registry` |
| `tests-extension` | Update extension model-registry + ai-clarification tests | `model-registry` |
| `docs-patterns` | Update patterns.md reference doc | — |
| `verify-build` | Run `npm run build` and `npm run test` to verify no breakage | all above |

## Notes
- The ai-clarification test on line 135 asserts that model names are stripped from parsed output. The assertion checks `!result.includes('gemini-3-pro')` — after rename this should become `!result.includes('gemini-3.1-pro')` or simply `!result.includes('gemini-')` to remain robust.
- No migration needed for user settings — VS Code will show the old value as invalid and users can reselect.
- The description `(Preview)` is retained since the model is still in preview.