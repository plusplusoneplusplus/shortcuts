---
status: pending
---

# 012: Enable retry configuration in consumer packages

## Summary
Wire the `pipeline-core` retry primitives (`RetryOptions`, `withRetry`, `isTransientError`) into the three consumer packages (CoC CLI, deep-wiki CLI, VS Code extension yaml-pipeline) and the extension AI invoker factory. Each consumer gets a user-facing opt-in switch that translates to a consistent `retry` option passed through to `sendMessage` and executor calls, using the pattern `retry: config.retryEnabled ? { maxAttempts: 3 } : undefined`.

## Motivation
Commits 001–011 built all the low-level resilience primitives inside `pipeline-core` (error classification, retry, circuit breaker, bulkhead, timeout policy). However, none of these are accessible to end users yet because the consumer packages hard-code `retryOnFailure: false` and never pass retry configuration through their option chains. This final commit is the integration layer that connects user intent ("I want retries") to the infrastructure, completing the resilience series. It is deliberately separated from the primitive commits so that each consumer's wiring can be reviewed and tested in isolation.

## Changes

### Files to Create
- `packages/coc/test/commands/run-retry.test.ts` — Integration tests for the `--retry` flag in CoC: verifies the flag is parsed, forwarded to `CLIAIInvokerOptions`, and propagated to `executePipeline` options. Tests both `--retry` present and absent cases.
- `packages/deep-wiki/test/ai-invoker-retry.test.ts` — Tests that `createAnalysisInvoker` and `createWritingInvoker` pass retry options through to `sendMessage`. Verifies transient errors trigger retry while permanent errors do not.
- `src/test/suite/yaml-pipeline-retry.test.ts` — Tests that the `retry` field in `pipeline.yaml` is parsed, validated, and forwarded to the executor. Tests the VS Code setting override.

### Files to Modify
- `packages/coc/src/ai-invoker.ts` — Add optional `retry?: RetryOptions` field to `CLIAIInvokerOptions`. When set, wrap the `service.sendMessage()` call inside `withRetry()` using the provided options merged with `{ retryOn: isTransientError }`. Import `withRetry`, `RetryOptions`, and `isTransientError` from `@plusplusoneplusplus/pipeline-core`.
- `packages/coc/src/cli.ts` — Add `--retry` boolean flag to the `run` command (`.option('--retry', 'Enable automatic retry for transient AI failures', false)`). Map it to `retry: opts.retry ? { attempts: 3 } : undefined` in the options object passed to `executeRun`.
- `packages/coc/src/commands/run.ts` — Add `retry?: RetryOptions` to `RunCommandOptions`. Forward `options.retry` into `CLIAIInvokerOptions` when calling `createCLIAIInvoker()`. Also forward `retryOnFailure: !!options.retry` and `retryAttempts: options.retry?.attempts` to the `executePipeline` options so the map-reduce executor respects the setting.
- `packages/deep-wiki/src/ai-invoker.ts` — Add optional `retry?: RetryOptions` field to the options accepted by `createAnalysisInvoker` and `createWritingInvoker`. When present, wrap `service.sendMessage()` inside `withRetry()` with `{ retryOn: isTransientError }` merged with the caller's options. `createConsolidationInvoker` is left unchanged (consolidation is idempotent and already short-running).
- `packages/deep-wiki/src/commands/generate.ts` — Pass `retry: { attempts: 3, retryOn: isTransientError }` to `runPhase3Analysis` and `runPhase4Writing` by default. Add `--no-retry` CLI flag to disable (retry is on by default for deep-wiki since its phases are long-running and transient failures are expected).
- `packages/deep-wiki/src/cli.ts` — Add `.option('--no-retry', 'Disable automatic retry on transient failures')` to the `generate` command. Map to `retry` field in `GenerateCommandOptions`.
- `packages/deep-wiki/src/analysis/analysis-executor.ts` — Accept `retry?: RetryOptions` in `AnalysisExecutorOptions`. When set, pass `retryOnFailure: true` and `retryAttempts: retry.attempts ?? 3` to the `MapReduceExecutor` options instead of the current hard-coded `retryOnFailure: false`.
- `packages/deep-wiki/src/writing/article-executor.ts` — Accept `retry?: RetryOptions` in `ArticleExecutorOptions`. When set, pass `retryOnFailure: true` and `retryAttempts: retry.attempts ?? 3` to executor options. Apply to both flat and hierarchical execution paths (the `createExecutor` calls at lines ~183, ~262, ~500, ~612).
- `packages/deep-wiki/src/commands/phases/analysis-phase.ts` — Thread `retry` from `GenerateCommandOptions` into `AnalysisExecutorOptions` when calling `runAnalysisExecutor`.
- `packages/pipeline-core/src/pipeline/types.ts` — Add optional `retry?: { enabled: boolean; maxAttempts?: number }` field to `MapConfig` interface for YAML pipeline schema support.
- `packages/pipeline-core/src/pipeline/executor.ts` — Read `config.map.retry` in `executePipeline`. When `retry.enabled` is `true`, set `retryOnFailure: true` and `retryAttempts: retry.maxAttempts ?? 3` on the `ExecutorOptions` (replacing the hard-coded `retryOnFailure: false` at line ~455). Add validation in `validateMapConfig` that `retry.maxAttempts` is a positive integer when provided.
- `src/shortcuts/ai-service/ai-config-helpers.ts` — Add `getRetryEnabledSetting(): boolean` that reads `workspaceShortcuts.aiService.retry.enabled` (default: `false`). Add `getRetryMaxAttemptsSetting(): number` that reads `workspaceShortcuts.aiService.retry.maxAttempts` (default: `3`).
- `src/shortcuts/ai-service/ai-invoker-factory.ts` — Add optional `retry?: RetryOptions` to `AIInvokerFactoryOptions`. When set, wrap the SDK `sendMessage` call in `withRetry()`. Read the VS Code setting via `getRetryEnabledSetting()` as the default when `retry` is not explicitly passed.
- `src/shortcuts/yaml-pipeline/ui/pipeline-executor-service.ts` — Before calling `executePipeline`, check `getRetryEnabledSetting()`. If enabled, merge `{ retryOnFailure: true, retryAttempts: getRetryMaxAttemptsSetting() }` into the executor options. This allows the VS Code setting to act as a global override even when the YAML doesn't specify `retry`.
- `package.json` — Add two new VS Code configuration entries under `workspaceShortcuts.aiService.retry`: `enabled` (boolean, default `false`, description: "Enable automatic retry for transient AI failures") and `maxAttempts` (number, default `3`, description: "Maximum number of retry attempts for transient failures").

### Files to Delete
- (none)

## Implementation Notes
- The consumer-facing `retry` option uses a simplified shape (`{ maxAttempts: 3 }` or `true/false`) rather than exposing the full `RetryOptions` from pipeline-core. Internal code converts this to the full `RetryOptions` with sensible defaults: `{ attempts: maxAttempts, backoff: 'exponential', delayMs: 1000, maxDelayMs: 30000, retryOn: isTransientError }`.
- CoC and YAML pipeline default to retry **off** (backward compatibility). Deep-wiki defaults to retry **on** because its phases are long-running (30+ minute timeouts) and transient failures from rate-limiting or network issues are common.
- The VS Code extension setting (`workspaceShortcuts.aiService.retry.enabled`) defaults to `false` to preserve existing behavior. Users must explicitly opt in.
- `isTransientError` from commit 001 is always used as the `retryOn` predicate — permanent errors (CSV parse, template error, permission denied) are never retried regardless of user configuration.
- The `consolidationInvoker` in deep-wiki is intentionally excluded from retry wiring. Consolidation runs once on already-cached discovery data and is deterministic; retrying it would not help.
- For the YAML pipeline `retry` field, the schema supports both a boolean shorthand (`retry: true`) and an object form (`retry: { enabled: true, maxAttempts: 5 }`). The parser normalizes both to the object form before passing to the executor.
- The map-reduce executor's existing `retryOnFailure` / `retryAttempts` fields (from `MapReduceOptions`) are reused rather than introducing a parallel mechanism. The `withRetry` wrapper is used only at the `sendMessage` level in CoC and deep-wiki invokers; the YAML pipeline relies on the executor-level retry since it already has the infrastructure.
- The deep-wiki analysis executor already has its own retry loop (lines 148-175 of `analysis-executor.ts`) using `retryAttempts`. The new `retry` option feeds into this existing mechanism rather than adding a second layer.

## Tests
- **CoC CLI flag parsing:** `--retry` flag is recognized and defaults to `false`; when present, `RunCommandOptions.retry` is populated with `{ attempts: 3 }`
- **CoC invoker retry:** With `retry` set, transient `AI_INVOCATION_FAILED` errors trigger up to 3 retries; permanent `CSV_PARSE_ERROR` errors fail immediately
- **CoC dry-run with retry:** `--retry --dry-run` parses without error (retry option is accepted but no AI calls made)
- **CoC pipeline execution:** `retryOnFailure: true` and `retryAttempts: 3` are forwarded to `executePipeline` when `--retry` is passed
- **Deep-wiki analysis retry:** `createAnalysisInvoker` with `retry` wraps sendMessage in `withRetry`; transient timeout triggers retry, permanent auth error does not
- **Deep-wiki writing retry:** `createWritingInvoker` with `retry` wraps sendMessage in `withRetry`; article executor receives `retryOnFailure: true`
- **Deep-wiki default retry on:** `generate` command enables retry by default; `--no-retry` disables it
- **Deep-wiki consolidation excluded:** `createConsolidationInvoker` does not accept or use retry options
- **YAML pipeline schema:** `retry: true` in pipeline.yaml is parsed to `{ enabled: true, maxAttempts: 3 }`; `retry: { enabled: true, maxAttempts: 5 }` preserves custom attempts
- **YAML pipeline validation:** `retry.maxAttempts` rejects non-positive integers and non-numeric values
- **YAML pipeline executor:** `retryOnFailure` is set to `true` when `config.map.retry.enabled` is `true`; defaults to `false` when `retry` is absent
- **VS Code setting:** `getRetryEnabledSetting()` returns `false` by default; returns `true` when setting is enabled
- **VS Code setting max attempts:** `getRetryMaxAttemptsSetting()` returns `3` by default; respects custom value
- **Extension invoker factory:** `AIInvokerFactoryOptions.retry` wraps SDK sendMessage in `withRetry` when provided
- **Extension invoker factory default:** When `retry` is not provided, reads VS Code setting; when setting is off, no retry wrapper is applied
- **Pipeline executor service:** VS Code retry setting overrides pipeline YAML when enabled; YAML `retry` field takes precedence when both are set
- **Backward compatibility:** All existing tests pass without modification; retry is opt-in everywhere except deep-wiki

## Acceptance Criteria
- [ ] `coc run --retry pipeline.yaml` enables retry for the pipeline execution with 3 max attempts
- [ ] `coc run pipeline.yaml` (no flag) executes without retry, preserving current behavior
- [ ] `deep-wiki generate` enables retry by default for analysis and writing phases
- [ ] `deep-wiki generate --no-retry` disables retry for all phases
- [ ] YAML pipeline with `retry: true` in `map:` section enables executor-level retry
- [ ] YAML pipeline without `retry` field preserves `retryOnFailure: false` behavior
- [ ] VS Code setting `workspaceShortcuts.aiService.retry.enabled` defaults to `false`
- [ ] VS Code setting override applies to both AI invoker factory and pipeline executor service
- [ ] Only transient errors (as classified by `isTransientError` from commit 001) trigger retries
- [ ] Permanent errors fail immediately without retry in all consumers
- [ ] `package.json` declares both new settings with correct types, defaults, and descriptions
- [ ] All existing tests in CoC, deep-wiki, pipeline-core, and extension continue to pass
- [ ] New integration tests cover retry-on/retry-off paths for each consumer
- [ ] `npm run test:run` passes in `packages/coc/`, `packages/deep-wiki/`, and `packages/pipeline-core/`
- [ ] `npm test` passes for the VS Code extension

## Dependencies
- Depends on: 001, 002, 004
