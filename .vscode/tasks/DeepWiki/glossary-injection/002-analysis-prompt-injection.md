---
status: pending
commit: 2 of 4
feature: Glossary Injection into Phase 3 Analysis
package: deep-wiki
depends_on: 001-glossary-types-and-loader
---

# Commit 2: Thread Glossary into Analysis Pipeline & Inject into Prompt

## Goal

Wire the glossary context (loaded in commit 1) through the Phase 3 analysis pipeline so every module's AI prompt includes a `## Project Glossary` section with term definitions. No Phase 4/Writing changes.

## Prerequisites

- Commit 1 merged: `GlossaryEntry` type in `types.ts`, `loadGlossaryFile()`, `resolveGlossary()`, and `formatGlossaryForPrompt()` in `config-loader.ts`.

## Files to Change

| File | What |
|------|------|
| `src/types.ts` | Add `glossary?: GlossaryEntry[]` to `AnalysisOptions` (line ~323) |
| `src/analysis/analysis-executor.ts` | Add `glossaryContext?: string` to `AnalysisExecutorOptions`; pass it through `runAnalysisExecutor` → `executeAnalysisRound` → `moduleToPromptItem` |
| `src/analysis/prompts.ts` | Add `{{glossaryContext}}` section to the prompt template |
| `src/analysis/index.ts` | Format glossary and pass `glossaryContext` to `runAnalysisExecutor()` |

## Detailed Changes

### 1. `src/types.ts` — Add glossary to `AnalysisOptions`

```typescript
// In AnalysisOptions (line ~323):
export interface AnalysisOptions {
    graph: ModuleGraph;
    model?: string;
    timeout?: number;
    concurrency?: number;
    depth?: 'shallow' | 'normal' | 'deep';
    repoPath: string;
+   /** Optional glossary entries for term definitions in analysis prompts */
+   glossary?: GlossaryEntry[];
}
```

### 2. `src/analysis/analysis-executor.ts` — Thread glossary through executor

#### 2a. `AnalysisExecutorOptions` — add field

```typescript
export interface AnalysisExecutorOptions {
    // ... existing fields ...
+   /** Pre-formatted glossary string for prompt injection (empty string = no glossary) */
+   glossaryContext?: string;
}
```

#### 2b. `moduleToPromptItem()` — add `glossaryContext` parameter

Add a third parameter `glossaryContext: string` (default `''`). Include it in the returned `PromptItem`:

```typescript
export function moduleToPromptItem(
    module: ModuleInfo,
    graph: ModuleGraph,
+   glossaryContext: string = '',
): PromptItem {
    return {
        moduleId: module.id,
        moduleName: module.name,
        // ... existing fields ...
        architectureNotes: graph.architectureNotes || 'No architecture notes available.',
+       glossaryContext: glossaryContext || 'No project glossary provided.',
    };
}
```

#### 2c. `runAnalysisExecutor()` — destructure and forward

```typescript
export async function runAnalysisExecutor(options: AnalysisExecutorOptions) {
    const {
        // ... existing destructuring ...
+       glossaryContext = '',
    } = options;

    // Pass to executeAnalysisRound:
    const { analyses, failedModuleIds } = await executeAnalysisRound({
-       modules, graph, aiInvoker, promptTemplate, outputFields,
-       concurrency, timeoutMs, model, onProgress, isCancelled, onItemComplete,
+       modules, graph, aiInvoker, promptTemplate, outputFields,
+       concurrency, timeoutMs, model, onProgress, isCancelled, onItemComplete,
+       glossaryContext,
    });

    // Same for retry rounds
}
```

#### 2d. `AnalysisRoundOptions` — add field

```typescript
interface AnalysisRoundOptions {
    // ... existing fields ...
+   glossaryContext?: string;
}
```

#### 2e. `executeAnalysisRound()` — use when creating PromptItems

```typescript
async function executeAnalysisRound(options: AnalysisRoundOptions) {
-   const { modules, graph, aiInvoker, ... } = options;
-   const items: PromptItem[] = modules.map(m => moduleToPromptItem(m, graph));
+   const { modules, graph, aiInvoker, ..., glossaryContext } = options;
+   const items: PromptItem[] = modules.map(m => moduleToPromptItem(m, graph, glossaryContext || ''));
    // ... rest unchanged ...
}
```

### 3. `src/analysis/prompts.ts` — Inject glossary section into prompt template

In `buildAnalysisPromptTemplate()`, insert a glossary section AFTER `Architecture context: {{architectureNotes}}` and BEFORE the investigation steps (`${steps}`):

```typescript
export function buildAnalysisPromptTemplate(depth: 'shallow' | 'normal' | 'deep'): string {
    const steps = getInvestigationSteps(depth);

    return `You are analyzing module "{{moduleName}}" in the {{projectName}} codebase.

Module ID: {{moduleId}}
Module path: {{modulePath}}
Purpose: {{purpose}}
Complexity: {{complexity}}
Category: {{category}}
Key files: {{keyFiles}}
Dependencies (other modules): {{dependencies}}
Dependents (modules that depend on this): {{dependents}}

Architecture context:
{{architectureNotes}}

## Project Glossary

The following terms have specific meanings in this project. Use these definitions
when writing the overview and descriptions. Expand acronyms on first use
(e.g., "the WAL (Write-Ahead Log)"):

{{glossaryContext}}
${steps}

**Output JSON Schema:**
...`;  // rest unchanged
}
```

The `{{glossaryContext}}` placeholder will be substituted with either:
- A markdown table of terms (from `formatGlossaryForPrompt()` in commit 1), or
- `"No project glossary provided."` (the fallback set in `moduleToPromptItem`)

### 4. `src/analysis/index.ts` — Format glossary and pass to executor

```typescript
+import { formatGlossaryForPrompt } from '../config-loader';

export async function analyzeModules(
    options: AnalysisOptions,
    aiInvoker: AIInvoker,
    onProgress?: (progress: JobProgress) => void,
    isCancelled?: () => boolean,
    onItemComplete?: ItemCompleteCallback,
): Promise<AnalysisResult> {
    const startTime = Date.now();

+   // Format glossary for prompt injection (empty string if no glossary)
+   const glossaryContext = options.glossary?.length
+       ? formatGlossaryForPrompt(options.glossary)
+       : '';

    const result = await runAnalysisExecutor({
        aiInvoker,
        graph: options.graph,
        depth: options.depth || 'normal',
        concurrency: options.concurrency || 5,
        timeoutMs: options.timeout || 1_800_000,
        model: options.model,
        onProgress,
        isCancelled,
        onItemComplete,
+       glossaryContext,
    });
    // ... rest unchanged ...
}
```

## Data Flow Summary

```
analyzeModules(options)                  -- options.glossary?: GlossaryEntry[]
  │
  ├─ formatGlossaryForPrompt(glossary)   -- → markdown table string (or '')
  │
  └─ runAnalysisExecutor({ ..., glossaryContext })
       │
       └─ executeAnalysisRound({ ..., glossaryContext })
            │
            └─ moduleToPromptItem(module, graph, glossaryContext)
                 │
                 └─ PromptItem { ..., glossaryContext: "| Term | ... |" }
                      │
                      └─ Template substitution: {{glossaryContext}} → table
```

## Testing

### Unit tests to add (`test/analysis/analysis-executor.test.ts`)

1. **`moduleToPromptItem` includes glossaryContext** — call with a glossary string, assert the returned PromptItem has `glossaryContext` key with that value.
2. **`moduleToPromptItem` uses fallback when glossary is empty** — call with `''`, assert PromptItem has `glossaryContext: 'No project glossary provided.'`.
3. **`buildAnalysisPromptTemplate` contains glossary placeholder** — assert returned string includes `{{glossaryContext}}` and `## Project Glossary`.

### Integration test (`test/analysis/index.test.ts`)

4. **`analyzeModules` passes glossaryContext through** — mock `runAnalysisExecutor`, call `analyzeModules` with a `glossary` array, assert the mock received a non-empty `glossaryContext` string.
5. **`analyzeModules` with no glossary passes empty string** — call without `glossary`, assert mock received `glossaryContext: ''`.

## Acceptance Criteria

- [ ] `AnalysisOptions.glossary` is optional and typed as `GlossaryEntry[]`
- [ ] `AnalysisExecutorOptions.glossaryContext` is optional string
- [ ] `moduleToPromptItem` adds `glossaryContext` to every PromptItem
- [ ] `moduleToPromptItem` falls back to `'No project glossary provided.'` when glossary is empty
- [ ] Prompt template includes `## Project Glossary` section with `{{glossaryContext}}`
- [ ] Glossary section is placed after architecture notes, before investigation steps
- [ ] `analyzeModules` formats glossary via `formatGlossaryForPrompt` and passes it through
- [ ] All existing tests pass (no regressions)
- [ ] New unit tests cover glossary threading and prompt template changes
- [ ] Phase 4 (Writing) is NOT modified in this commit
