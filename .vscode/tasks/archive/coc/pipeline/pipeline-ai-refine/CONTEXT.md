# Context: Pipeline AI Refine

## User Story
Users currently edit pipeline YAML files in a raw textarea. They want to describe a change in
natural language (e.g., "add retry logic", "add a filter step") and have AI apply the edit,
with a diff shown before the change is committed.

## Goal
Extend the pipeline editor with an "Edit with AI" flow that takes a natural language instruction,
calls a new `/refine` endpoint, and shows a unified diff the user can accept or discard.

## Commit Sequence
1. `backend: add /refine endpoint` — POST /api/workspaces/:id/pipelines/:name/refine accepts `{instruction, currentYaml, model?}`, returns modified YAML
2. `client-api: add refinePipeline()` — typed API wrapper; also fixes GenerateResult/validationError type mismatch
3. `ui: PipelineAIRefinePanel component` — self-contained panel with instruction → generating → preview state machine and UnifiedDiffViewer
4. `ui: wire Edit with AI into PipelineDetail` — extends mode type, adds "Edit with AI ✨" toolbar button, renders the panel

## Key Decisions
- `/refine` is separate from `/generate`; it receives `currentYaml` so AI modifies rather than regenerates from scratch
- Diff computation is client-side only — no new server dependency
- `PipelineAIRefinePanel` is a pure UI component; it delegates `onApply`/`onCancel` to the parent
- State machine mirrors the existing `AddPipelineDialog` pattern (instruction → generating → preview)

## Conventions
- Server routes live in `packages/coc-server/src/`; new route follows existing handler registration pattern
- Client API wrappers live alongside other typed fetchers in the dashboard source
- UI components follow the `AddPipelineDialog` instruction→preview pattern as the canonical reference
- No direct API calls inside leaf UI components; side effects bubble up via callbacks
