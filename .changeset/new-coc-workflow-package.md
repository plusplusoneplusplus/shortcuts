---
"@plusplusoneplusplus/coc-workflow": minor
---

Add @plusplusoneplusplus/coc-workflow as a published workspace package for the pure DAG workflow compiler and executor.

- New package: workflow compiler, executor, validator, scheduler/graph helpers, node executors, result adapter, cancellation/concurrency helpers, and legacy pipeline compatibility types
- Wire `coc-workflow` into root package build, test, coverage, link, and publish scripts
- Add package-level workflow engine tests copied from the existing Forge workflow coverage
