---
status: pending
---

# 004: Comprehensive Tests for Glossary Injection

## Summary

Add Vitest tests covering all glossary functionality introduced in commits 1–3: types/loader, prompt formatting, config validation, analysis prompt injection, executor integration, and auto-discovery.

This is commit 4 of 4 for the "Glossary Injection into Phase 3 Analysis" feature.

## Motivation

Commits 1–3 added glossary types, a YAML loader, config-level support, prompt formatting, and wiring into the analysis executor. This commit locks down that behaviour with comprehensive tests so regressions are caught early.

## Test Conventions

- **Framework:** Vitest (`describe` / `it` / `expect`) — see `packages/deep-wiki/vitest.config.ts`
- **Mocking:** `vi.mock()` / `vi.fn()` from Vitest
- **File-system tests:** use `fs.mkdtempSync` + `os.tmpdir()` for temp dirs; clean up in `afterEach`
- **Pattern:** JSDoc file header, `// ====` section separators, helper factories for test data (see `analysis-executor.test.ts`)

## Files to Create / Modify

### New file: `packages/deep-wiki/test/glossary.test.ts`

Tests for the glossary loader and formatter (standalone, no analysis coupling).

### Extend: `packages/deep-wiki/test/config-loader.test.ts`

Add glossary-related validation and merge tests to existing `describe` blocks.

### Extend: `packages/deep-wiki/test/analysis/prompts.test.ts`

Add tests verifying the `{{glossaryContext}}` placeholder in the analysis prompt template.

### Extend: `packages/deep-wiki/test/analysis/analysis-executor.test.ts`

Add tests for `moduleToPromptItem` glossary field pass-through.

## Detailed Test Plan

### 1. Glossary Types & Loader — `test/glossary.test.ts` (new file)

```
describe('loadGlossaryFile')
  it('should load valid YAML and return GlossaryEntry[]')
  it('should throw on missing file')
  it('should throw on invalid YAML')
  it('should validate that every entry has a `term` field')
  it('should accept entries with only `term` (no expansion/definition)')

describe('resolveGlossary')
  it('should use inline glossary array when provided')
  it('should load entries from glossaryFile path')
  it('should merge inline + file, inline wins for duplicate terms')
  it('should return empty array when nothing is specified')
```

**Approach:**
- Create temp YAML files via `fs.mkdtempSync` (same pattern as `config-loader.test.ts`)
- Valid YAML fixture:
  ```yaml
  - term: API
    expansion: Application Programming Interface
    definition: A set of protocols for building software
  - term: SDK
    expansion: Software Development Kit
  ```
- Test merge precedence: file has `term: API, expansion: "File version"`, inline has `term: API, expansion: "Inline version"` → inline wins.

### 2. `formatGlossaryForPrompt` — `test/glossary.test.ts`

```
describe('formatGlossaryForPrompt')
  it('should format entries with expansion + definition into table')
  it('should format entries with only expansion (no definition)')
  it('should format entries with only definition (no expansion)')
  it('should return fallback message for empty array')
```

**Assertions:**
- Non-empty input → output contains each term, its expansion, and its definition
- Empty input → output contains a "No glossary" or equivalent fallback string

### 3. Config Validation — extend `test/config-loader.test.ts`

Add inside the existing `describe('validateConfig')` block:

```
it('should accept config with valid glossary array')
it('should accept config with valid glossaryFile string')
it('should reject glossary entries missing `term` field')
it('should reject glossaryFile that is not a string')
```

Add inside the existing `describe('mergeConfigWithCLI')` block:

```
it('should merge glossary and glossaryFile from config into merged result')
```

**Approach:**
- Call `validateConfig()` with `{ glossary: [...] }` and assert no throw
- Call `validateConfig()` with `{ glossary: [{ expansion: 'X' }] }` (missing `term`) and assert throw
- Call `mergeConfigWithCLI()` with config containing `glossary` and verify it appears in output

### 4. Analysis Prompt Injection — extend `test/analysis/prompts.test.ts`

Add inside the existing `describe('buildAnalysisPromptTemplate')` block:

```
it('should contain {{glossaryContext}} template variable')
```

Add a new describe block:

```
describe('glossary prompt injection')
  it('should include glossary section text in prompt when glossaryContext is present')
```

**Assertions:**
- `buildAnalysisPromptTemplate('normal')` result contains `'{{glossaryContext}}'`
- The prompt includes an instruction like "refer to the glossary" or similar contextual guidance

### 5. Analysis Executor — extend `test/analysis/analysis-executor.test.ts`

Add inside the existing `describe('moduleToPromptItem')` block:

```
it('should include glossaryContext field when glossary context is provided')
it('should use default message when glossaryContext is not provided')
```

**Approach:**
- Call `moduleToPromptItem(module, graph, { glossaryContext: '...' })` and assert `item.glossaryContext` equals the provided string
- Call `moduleToPromptItem(module, graph)` without glossary context and assert `item.glossaryContext` contains a default/fallback value (e.g., `'No glossary provided'`)

### 6. Auto-Discovery — `test/glossary.test.ts`

```
describe('discoverGlossaryFile')
  it('should find glossary.yaml in the given directory')
  it('should find glossary.yml in the given directory')
  it('should return undefined when no glossary file exists')
```

**Approach:**
- Create temp dir, write `glossary.yaml` → assert returns the path
- Create temp dir, write `glossary.yml` → assert returns the path
- Create empty temp dir → assert returns `undefined`

## Run & Verify

```bash
cd packages/deep-wiki
npm run test:run
```

All new and existing tests must pass. No changes to production source files in this commit.

## Estimated Test Count

~25 new test cases across 3 files (1 new, 2 extended).
