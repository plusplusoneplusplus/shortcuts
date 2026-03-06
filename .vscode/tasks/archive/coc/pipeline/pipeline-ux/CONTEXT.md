# Context: AI-Assisted Pipeline UX Improvements

## User Story
The pipeline system is technically capable but hard to use — creation requires YAML expertise,
templates are hollow scaffolds, and there's no AI assistance during authoring. The user wants:
(1) AI to help create pipelines from natural language descriptions, and (2) AI to help update
existing pipelines when requirements change. The goal is to reduce friction and make the
pipeline-generator skill accessible directly from the VS Code pipeline panel.

## Goal
Add AI-assisted creation and refinement commands to the VS Code pipeline panel, and add a
JSON Schema to enable IDE autocomplete for pipeline.yaml, collectively making pipelines
significantly easier to author and evolve without deep YAML/DSL knowledge.

## Commit Sequence
1. JSON Schema for pipeline.yaml — autocomplete & validation in IDE
2. AI-assisted pipeline creation command — describe goal → AI generates pipeline.yaml
3. AI-assisted pipeline refinement command — describe changes → AI updates existing pipeline.yaml
4. Surface AI commands in UI — QuickPick, context menus, welcome view, toolbar button

## Key Decisions
- Commit 001 is pure configuration (no TypeScript) — independently deployable
- Commits 002 and 003 both use the existing `createAIInvoker` factory pattern from `ai-service/`
- The `pipeline-generator` SKILL.md is loaded as system context for both create and refine prompts
- Generated YAML is validated via `parsePipelineYAMLSync` before writing — never write invalid YAML
- Refinement creates a `.bak` backup and shows a diff gate before applying changes
- Commit 004 is pure wiring (no new logic) — surfaces commands already built in 002/003
- View ID is `pipelinesView`; context menu `when` clause: `view == pipelinesView && viewItem == pipeline`

## Conventions
- All AI calls use `createAIInvoker` from `src/shortcuts/ai-service/ai-invoker-factory.ts`
- Command IDs follow `pipelinesViewer.*` prefix convention
- Plan files live in `.vscode/tasks/coc/pipeline-ux/NNN-*.md`
- YAML feature folder: `src/shortcuts/yaml-pipeline/ui/`
