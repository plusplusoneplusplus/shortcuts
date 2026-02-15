---
status: pending
---

# 010: Surface partial failures in deep-wiki pipeline output

## Summary

Introduce a `PartialFailureReport` type to collect and surface failures that currently get silenced across the deep-wiki pipeline. Domain discovery failures, cache write failures, and static-fallback article generation are aggregated into a structured report printed at pipeline completion, giving users visibility into why a generated wiki may be incomplete.

## Motivation

Deep-wiki's current design is fault-tolerant by default: domain discovery failures are logged with `printWarning` then discarded, cache write failures are caught in bare `catch {}` blocks with no logging at all, and article reduce failures silently degrade to static fallback pages. While this keeps the pipeline running, users receive an incomplete wiki with no indication of what went wrong or which sections are degraded. A user seeing 8 of 12 domains in their wiki has no way to know 4 domains failed discovery, nor that 2 articles fell back to static TOC pages.

The existing `--strict` / `--no-strict` flag already gates whether failures abort the pipeline (analysis-phase.ts and writing-phase.ts check `options.strict !== false`), but it operates as a binary kill-switch with no middle ground. This commit fills the gap: always collect failure details, always print a summary, and let `--strict` decide whether to exit non-zero.

## Changes

### Files to Create

1. **`packages/deep-wiki/src/types/partial-failure.ts`**
   - Define `PartialFailure` interface: `{ phase: 'discovery' | 'analysis' | 'cache' | 'writing'; domain?: string; componentId?: string; error: string; impact: string }`
   - Define `PartialFailureReport` class with:
     - `failures: PartialFailure[]` array
     - `add(failure: PartialFailure): void` — append a failure entry
     - `hasFailures(): boolean`
     - `countByPhase(phase: string): number`
     - `summarize(): string` — human-readable summary (e.g., "3 of 12 domains had discovery errors, 2 cache writes failed, 1 article used static fallback")
   - Export from `packages/deep-wiki/src/types/index.ts` (or add barrel export if one exists)

2. **`packages/deep-wiki/test/types/partial-failure.test.ts`**
   - Unit tests for `PartialFailureReport`: add, countByPhase, hasFailures, summarize formatting
   - Edge cases: empty report, single failure, mixed phases

3. **`packages/deep-wiki/test/commands/failure-reporting.test.ts`**
   - Integration-style tests verifying that generate command prints failure summary
   - Test `--strict` causes non-zero exit when failures present
   - Test `--no-strict` prints summary but exits successfully

### Files to Modify

4. **`packages/deep-wiki/src/discovery/large-repo-handler.ts`**
   - Accept `PartialFailureReport` parameter in `discoverLargeRepo()` (or accept it via `DiscoveryOptions`)
   - In the domain discovery catch block (~line 207-210): call `report.add({ phase: 'discovery', domain: domain.name, error: getErrorMessage(error), impact: 'Domain components missing from wiki' })` alongside the existing `printWarning`
   - In the structural scan cache write catch block (~line 158-162): add `report.add({ phase: 'cache', error: 'Structural scan cache write failed', impact: 'Discovery cache unavailable for next run' })`
   - In the domain sub-graph cache write catch block (~line 200-205): add `report.add({ phase: 'cache', domain: domain.name, error: 'Domain sub-graph cache write failed', impact: 'Domain discovery will not be cached' })`
   - Add `printWarning` calls to the two bare cache-write catch blocks that currently have no logging

5. **`packages/deep-wiki/src/cache/cache-utils.ts`**
   - No structural changes needed. Cache writes already throw on failure; callers will wrap them. Keep `writeCacheFile` as-is (callers decide whether to catch and report).

6. **`packages/deep-wiki/src/writing/article-executor.ts`**
   - Accept `PartialFailureReport` parameter in the executor function (or via options)
   - In flat-mode reduce fallback (~line 269-308): when `generateStaticIndexPages()` is called as fallback, call `report.add({ phase: 'writing', error: 'Index/architecture reduce failed, used static fallback', impact: 'Index and architecture pages are auto-generated TOCs, not AI-written' })`
   - In hierarchical domain reduce fallback (~line 506-512, 554-556): call `report.add({ phase: 'writing', domain: domainId, error: 'Domain reduce failed, used static fallback', impact: 'Domain summary is auto-generated, not AI-written' })`
   - In hierarchical project-level reduce fallback (~line 618-660): call `report.add({ phase: 'writing', error: 'Project-level reduce failed, used static fallback', impact: 'Project index is auto-generated, not AI-written' })`
   - For each failed component article (~line 214-216): call `report.add({ phase: 'writing', componentId, error: 'Article generation failed', impact: 'Component has no wiki article' })`

7. **`packages/deep-wiki/src/commands/generate.ts`**
   - Instantiate `PartialFailureReport` at the start of the generate function
   - Thread the report through discovery (Phase 1), analysis (Phase 3), and writing (Phase 4) calls
   - After the summary section (~line 303-348): add a "Partial Failures" section that calls `report.summarize()` and prints each failure with `printWarning`
   - After summary printing: if `options.strict !== false && report.hasFailures()`, exit with `EXIT_CODES.EXECUTION_ERROR` and print message like "Strict mode: N partial failure(s) detected. Use --no-strict to allow partial results."
   - This unifies the strict-mode check currently scattered across analysis-phase.ts and writing-phase.ts into a single final check

8. **`packages/deep-wiki/src/commands/analysis-phase.ts`**
   - Accept `PartialFailureReport` parameter
   - When component analysis fails and `strict` is false (~line 243-255): add failures to report instead of only logging, remove the phase-level strict abort (move to generate.ts final check)
   - For each failed component: `report.add({ phase: 'analysis', componentId, error: 'Analysis failed after retries', impact: 'Component article may lack deep analysis' })`

9. **`packages/deep-wiki/src/commands/writing-phase.ts`**
   - Accept `PartialFailureReport` parameter
   - Thread report to `article-executor`
   - When articles fail and `strict` is false (~line 223-234): add failures to report, remove the phase-level strict abort (move to generate.ts final check)

10. **`packages/deep-wiki/src/types.ts`** (or types/index.ts)
    - Re-export `PartialFailure` and `PartialFailureReport` from the new module
    - Add optional `failureReport?: PartialFailureReport` to `GenerateCommandOptions` if threading via options

### Files to Delete

None.

## Implementation Notes

- **Threading the report:** The cleanest approach is to instantiate `PartialFailureReport` in `generate.ts` and pass it down through phase functions. Avoid making it a global/singleton. If `DiscoveryOptions` or `GenerateCommandOptions` already has an extensible options pattern, add it there; otherwise pass as an explicit parameter.
- **Backward compatibility:** All `report.add()` calls are additive. When `PartialFailureReport` is not provided (e.g., in tests calling discovery directly), failures continue to be handled as they are today (logged or silently caught). Use optional parameter with a no-op default.
- **Strict mode consolidation:** Currently strict-mode aborts are scattered across analysis-phase.ts (~line 243) and writing-phase.ts (~line 223). This commit consolidates the strict check into a single point at the end of `generate.ts`, using the accumulated failure report. The per-phase strict checks can be removed since failures are now always collected and the pipeline continues.
- **Static fallback detection:** The article-executor already tracks `failedComponentIds`. The new report adds richer context (which reduce phases fell back to static content), which `failedComponentIds` alone doesn't capture.
- **Cache write warnings:** The two bare `catch {}` blocks in large-repo-handler.ts should get `printWarning` calls even without the failure report, as a basic observability improvement.
- **Exit code:** Use existing `EXIT_CODES.EXECUTION_ERROR` for strict-mode failure. The exit code path in generate.ts already handles this pattern.

## Tests

1. **`partial-failure.test.ts`** — Unit tests for the `PartialFailureReport` class:
   - `add()` appends entries; `hasFailures()` returns true/false correctly
   - `countByPhase('discovery')` returns correct count with mixed phases
   - `summarize()` produces human-readable string with counts per phase
   - Empty report: `hasFailures()` is false, `summarize()` returns empty or "No failures"

2. **`failure-reporting.test.ts`** — Integration tests for failure surfacing:
   - Generate command prints failure summary when domains fail discovery (mock discovery to throw for some domains)
   - Generate command prints cache write failures in summary
   - Generate command with `--strict` exits non-zero when report has failures
   - Generate command with `--no-strict` prints summary but exits zero
   - Failure report includes correct `impact` strings for each phase

3. **`large-repo-handler.test.ts`** (extend existing) — Add tests:
   - Domain discovery failure adds entry to report
   - Cache write failure adds entry to report with warning logged
   - All domains failing still throws (existing behavior preserved)

4. **`article-executor.test.ts`** (extend existing) — Add tests:
   - Static fallback for reduce adds entry to report
   - Failed component articles add entries to report
   - Report correctly distinguishes component failures from reduce fallbacks

## Acceptance Criteria

- [ ] `PartialFailureReport` type is defined with `add`, `hasFailures`, `countByPhase`, `summarize` methods
- [ ] Domain discovery failures in large-repo-handler are collected into the report (not just warned)
- [ ] Cache write failures in large-repo-handler log a warning AND add to failure report
- [ ] Static-fallback article generation in article-executor is tracked in the report
- [ ] Failed component analyses are tracked in the report
- [ ] Generate command prints a "Partial Failures" summary section when failures exist
- [ ] `--strict` mode (default) exits with `EXECUTION_ERROR` if any partial failures occurred
- [ ] `--no-strict` mode prints summary but exits successfully
- [ ] Strict-mode check is consolidated into generate.ts final check (removed from per-phase code)
- [ ] All new and modified code has test coverage
- [ ] Existing tests continue to pass (backward compatible — report parameter is optional)
- [ ] `npm run test:run` passes in `packages/deep-wiki/`

## Dependencies

- Depends on: None
