---
status: pending
---

# 005: Define DAG YAML Schema and Parser

## Summary
Design and implement the YAML schema for defining DAGs — allowing users to describe multi-step workflows in a familiar, declarative format — and build a parser that converts YAML into validated `DAGConfig` objects.

## Motivation
The existing pipeline framework uses YAML for single-pipeline definitions. Extending this to DAGs requires a new schema that supports task definitions, dependencies, branching, and configuration inheritance. The YAML format should feel natural to users familiar with both the existing pipeline.yaml and Airflow's DAG definitions.

## Changes

### Files to Create
- `packages/pipeline-core/src/dag/parser.ts` — YAML → DAGConfig parser:
  - `parseDAGYAML(yamlContent: string)` → `DAGConfig`
  - `parseDAGYAMLFile(filePath: string)` → `DAGConfig`
  - Validates required fields, resolves task references, checks dependency graph
  - Supports `default_args` inheritance (task-level overrides dag-level defaults)
  - Template variable resolution in task configs (`{{ dag_run.conf.param }}`)
- `packages/pipeline-core/src/dag/validator.ts` — DAG validation:
  - `validateDAGConfig(config: DAGConfig)` → `ValidationResult`
  - Checks: no cycles, all deps reference valid tasks, no orphan tasks, required fields present
  - Warns: unreachable tasks, excessive fan-out, missing timeouts
- `packages/pipeline-core/src/dag/schema.ts` — JSON Schema definition for DAG YAML:
  - Exportable schema for editor validation/autocomplete
  - Covers all node types, trigger rules, edge conditions

### Files to Modify
- `packages/pipeline-core/src/dag/index.ts` — Re-export parser and validator

## Implementation Notes
- **YAML Schema Design:**
```yaml
name: "data-processing-pipeline"
description: "ETL workflow with validation"
schedule: "0 6 * * *"  # Daily at 6 AM (parsed in 008)
tags: [etl, production]
concurrency: 3
max_active_runs: 1
catchup: false

default_args:
  model: "gpt-4"
  timeout: 300
  retries: 2
  retry_delay: 60

tasks:
  extract:
    type: pipeline
    pipeline: "./extract/pipeline.yaml"  # Reuse existing pipeline
    
  validate:
    type: ai_prompt
    prompt: |
      Validate the extracted data:
      {{ xcom.extract.output }}
      Return JSON: {"valid": true/false, "issues": [...]}
    output: [valid, issues]
    depends_on: [extract]
    
  transform_clean:
    type: pipeline
    pipeline: "./transform/pipeline.yaml"
    depends_on: [validate]
    trigger_rule: all_success
    
  transform_raw:
    type: shell
    command: "python scripts/raw_dump.py"
    depends_on: [validate]
    trigger_rule: all_done  # Run even if validate failed
    
  load:
    type: pipeline
    pipeline: "./load/pipeline.yaml"
    depends_on: [transform_clean, transform_raw]
    trigger_rule: one_success
    
  notify:
    type: ai_prompt
    prompt: "Summarize the pipeline run results: {{ xcom.load.output }}"
    depends_on: [load]
    trigger_rule: all_done  # Always notify
```

- Dependencies are declared via `depends_on` arrays on each task (edges inferred)
- `type` maps directly to task handler registry from 004
- `pipeline` type references existing pipeline.yaml files — zero rewrite needed
- XCom access uses `{{ xcom.<task_id>.<key> }}` template syntax
- `default_args` are merged with task-level config (task wins on conflict)
- Parser reuses `js-yaml` (already a dependency)

## Tests
- `packages/pipeline-core/test/dag/parser.test.ts`:
  - Parse minimal DAG (single task, no deps)
  - Parse full DAG with all task types and options
  - `default_args` merged correctly (task-level overrides)
  - `depends_on` converted to proper edges
  - Invalid YAML throws descriptive parse error
  - Missing required fields rejected with clear message
  - XCom template variables preserved for runtime resolution
- `packages/pipeline-core/test/dag/validator.test.ts`:
  - Cyclic dependency detected and rejected
  - Dangling dependency reference caught
  - Orphan task warned
  - Valid complex DAG passes validation
  - Excessive fan-out (>20 downstream) warned

## Acceptance Criteria
- [ ] YAML schema supports all task types: pipeline, ai_prompt, shell, python, noop
- [ ] `depends_on` is correctly converted to DAG edges
- [ ] `default_args` inheritance works with task-level overrides
- [ ] Validation catches cycles, dangling refs, missing fields
- [ ] XCom template variables are preserved for runtime
- [ ] Parser produces valid `DAGConfig` accepted by `DAGExecutor` from 004
- [ ] JSON Schema is exportable for editor tooling

## Dependencies
- Depends on: 001, 004
