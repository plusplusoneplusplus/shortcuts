# Context: Migrate Task Types out of pipeline-core

## User Story
The `TaskType` union and domain-specific payload types (e.g., `FollowPromptPayload`, `RunPipelinePayload`) are defined in pipeline-core but pipeline-core's queue executor is type-agnostic — it never inspects task types. These are application-level concerns that leak into the generic engine. The user wants to clean this up by moving types to where they're actually used.

## Goal
Remove domain-specific task type definitions from pipeline-core's queue system, making it truly generic (`string`-typed), and relocate them to the consumer packages (coc-server for CoC CLI, local definitions for VS Code extension).

## Commit Sequence
1. Generify pipeline-core queue types
2. Move task types to coc-server, update coc CLI
3. Update VS Code extension to use local task types

## Key Decisions
- No backward compatibility — clean break
- VS Code extension gets local type definitions (only uses 2 of 7 types), avoiding a new dependency on coc-server
- coc-server is the natural home for the full type set since coc CLI already depends on it
- `CodeReviewPayload` is dropped entirely (unused, no guard, no external consumers)

## Conventions
- Payload types use `readonly kind` discriminants where they exist (`TaskGenerationPayload`, `RunPipelinePayload`)
- Type guards follow `is<Name>Payload` naming convention
- `QueuedTask.type` becomes `string` — consumers cast or narrow as needed
