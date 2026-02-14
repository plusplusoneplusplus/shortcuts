---
status: pending
---

# 006: Implement Conditional Branching and Join Logic

## Summary
Add branch and join node types that enable conditional execution paths within a DAG — allowing workflows to take different routes based on task outputs or runtime conditions.

## Motivation
Airflow's `BranchPythonOperator` and `ShortCircuitOperator` enable dynamic workflow routing. Without branching, every DAG is a static graph. This commit adds the ability to conditionally skip paths, enabling patterns like "if validation passes → continue, else → alert and stop".

## Changes

### Files to Create
- `packages/pipeline-core/src/dag/task-handlers/branch-handler.ts` — `BranchHandler`:
  - Evaluates a condition expression against upstream XCom data
  - Returns list of downstream task IDs to execute (others get 'skipped')
  - Supports:
    - `condition` field: simple expression (`{{ xcom.validate.valid }} == true`)
    - `branches` map: condition → task_ids to follow
    - `default` branch: fallback if no condition matches
- `packages/pipeline-core/src/dag/task-handlers/join-handler.ts` — `JoinHandler`:
  - Synchronization point after branches converge
  - Collects XCom from all non-skipped upstream paths
  - Trigger rule determines behavior (default `none_failed_min_one_success`)
- `packages/pipeline-core/src/dag/condition-evaluator.ts` — Expression evaluator:
  - Evaluates simple conditions: `==`, `!=`, `>`, `<`, `>=`, `<=`, `in`, `not_in`
  - Supports boolean logic: `and`, `or`, `not`
  - Resolves `{{ xcom.task.key }}` references from task context
  - No `eval()` — safe expression parsing only

### Files to Modify
- `packages/pipeline-core/src/dag/types.ts` — Add `branch` and `join` to `DAGNode.type`, add `BranchNodeConfig` and `JoinNodeConfig` types
- `packages/pipeline-core/src/dag/task-handlers/handler-registry.ts` — Register branch and join handlers
- `packages/pipeline-core/src/dag/executor.ts` — After branch task completes, mark non-selected downstream paths as 'skipped'
- `packages/pipeline-core/src/dag/parser.ts` — Support `branch` and `join` task types in YAML

## Implementation Notes
- **YAML example:**
```yaml
tasks:
  validate:
    type: ai_prompt
    prompt: "Validate data. Return JSON: {valid: true/false}"
    output: [valid]
    
  check_valid:
    type: branch
    depends_on: [validate]
    branches:
      "{{ xcom.validate.valid }} == true":
        follow: [transform]
      "{{ xcom.validate.valid }} == false":
        follow: [alert, cleanup]
    default:
      follow: [alert]
      
  transform:
    type: pipeline
    pipeline: "./transform/pipeline.yaml"
    depends_on: [check_valid]
    
  alert:
    type: ai_prompt
    prompt: "Generate alert for invalid data"
    depends_on: [check_valid]
    
  cleanup:
    type: shell
    command: "rm -rf /tmp/staging/*"
    depends_on: [check_valid]
    
  done:
    type: join
    depends_on: [transform, alert, cleanup]
    trigger_rule: none_failed_min_one_success
```

- Branch evaluation happens at runtime, not parse time
- Skipping propagates: if task B is skipped, all downstream-only tasks of B are also skipped (unless they have other non-skipped upstream via trigger rules)
- Join node uses its trigger_rule to decide — `none_failed_min_one_success` means "as long as no upstream failed and at least one succeeded (vs skipped)"
- Condition evaluator is intentionally simple — no Turing-complete expressions (security)
- Expression parser uses a recursive descent approach, not regex

## Tests
- `packages/pipeline-core/test/dag/branch-handler.test.ts`:
  - Branch selects correct downstream based on XCom value
  - Non-selected branches are skipped
  - Default branch taken when no condition matches
  - Multiple conditions with first-match semantics
- `packages/pipeline-core/test/dag/join-handler.test.ts`:
  - Join waits for all non-skipped upstream
  - Join collects XCom from non-skipped paths
  - `none_failed_min_one_success`: passes with mix of success/skipped
- `packages/pipeline-core/test/dag/condition-evaluator.test.ts`:
  - Equality, comparison operators
  - Boolean AND/OR/NOT
  - XCom variable resolution
  - Invalid expression → clear error (no crash)
  - Injection attempts rejected (no eval)
- `packages/pipeline-core/test/dag/executor-branching.test.ts`:
  - Full DAG with branch → two paths → join, verify correct path taken
  - Skip propagation through multi-level downstream

## Acceptance Criteria
- [ ] Branch node selects downstream tasks based on XCom conditions
- [ ] Non-selected paths are correctly skipped (including transitive downstream)
- [ ] Join node synchronizes converging branches
- [ ] Condition evaluator is safe (no code injection)
- [ ] YAML schema supports branch/join task types
- [ ] Works correctly with DAG executor from 004
- [ ] Existing tests pass

## Dependencies
- Depends on: 004, 005
