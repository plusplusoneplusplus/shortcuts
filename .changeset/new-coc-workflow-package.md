---
"@plusplusoneplusplus/coc": patch
"@plusplusoneplusplus/coc-workflow": minor
"@plusplusoneplusplus/forge": patch
---

Extract the pure DAG workflow compiler and executor into `@plusplusoneplusplus/coc-workflow` and wire package consumers to use the new boundary.

- Publish `@plusplusoneplusplus/coc-workflow` with the workflow compiler, executor, validator, scheduler/graph helpers, node executors, result adapter, cancellation/concurrency helpers, logger, CSV helpers, skill resolver helpers, and legacy pipeline compatibility types.
- Keep Forge workflow exports as thin compatibility re-exports over `@plusplusoneplusplus/coc-workflow`.
- Import CoC CLI/server workflow execution, validation, formatting, and preview types from `@plusplusoneplusplus/coc-workflow` directly.
- Wire `coc-workflow` into root package build, test, coverage, link, and publish scripts.
- Add package-level workflow engine tests copied from the existing Forge workflow coverage.
