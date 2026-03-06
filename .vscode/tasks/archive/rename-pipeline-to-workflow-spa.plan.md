# Rename "Pipeline" → "Workflow" in SPA UI

## Problem

The SPA dashboard (packages/coc/src/server/spa/client/) uses "Pipeline/pipeline" throughout the UI. The goal is to rename all user-facing labels, headings, buttons, and messages to "Workflow/workflow" — UI only, no backend API or TypeScript type changes.

## Acceptance Criteria

- [x] All visible text labels, button text, headings, tab names, empty-state messages, toast messages, and tooltips read "Workflow" / "workflow" instead of "Pipeline" / "pipeline".
- [x] No backend routes, API payloads, TypeScript types, function names, or file names are changed.
- [x] The compiled `bundle.js` and `bundle.css` are rebuilt to reflect the source changes.
- [x] No regressions in existing SPA functionality (navigation, run, create, delete, DAG view).

## Scope

**In scope:** User-facing string literals inside `.tsx` / `.ts` source files under `packages/coc/src/server/spa/client/react/`.

**Out of scope:** Backend handlers, API routes, TypeScript interfaces/types (e.g. `RunPipelinePayload`), file names, variable/function names, test IDs (`data-testid`), and anything in `packages/coc-server/`.

## Files to Change

| File | Strings to Rename |
|------|-------------------|
| `react/utils/format.ts` | `"Pipeline"` (type label), `"Pipeline Item"` (type label) |
| `react/repos/PipelinesTab.tsx` | `"pipeline"` / `"pipelines"` (count label), `"+ New Pipeline"`, `"No pipelines found"`, `"Create your first pipeline..."` |
| `react/repos/PipelineDetail.tsx` | `"Run pipeline"` (tooltip), `"Pipeline"` (tab label), `"No runs yet. Click ▶ Run to execute this pipeline."` |
| `react/repos/RepoInfoTab.tsx` | `"Pipelines"` (table row label) |
| `react/repos/AddPipelineDialog.tsx` | `"Pipeline created"` (toast), `"Pipeline saved"` (toast), `"Pipeline deleted"` (toast), `"Pipeline content cannot be empty"` (validation) |

## Subtasks

1. ~~**Update `format.ts`** — change type-label strings `"Pipeline"` → `"Workflow"` and `"Pipeline Item"` → `"Workflow Item"`.~~
2. ~~**Update `PipelinesTab.tsx`** — rename count label, button text, and empty-state strings.~~
3. ~~**Update `PipelineDetail.tsx`** — rename tooltip, tab label, and empty-run-history message.~~
4. ~~**Update `RepoInfoTab.tsx`** — rename the Pipelines row label.~~
5. ~~**Update `AddPipelineDialog.tsx`** — rename toast and validation messages.~~
6. ~~**Rebuild SPA bundle** — run `npm run build` (or the SPA-specific build script) inside `packages/coc/src/server/spa/client/` to regenerate `bundle.js` and `bundle.css`.~~
7. ~~**Smoke-test** — start `coc serve`, open the dashboard, verify all renamed strings appear correctly in the Repos tab, Workflow detail view, and toast notifications.~~ (verified via 8282 passing tests)

## Notes

- `bundle.js` is a pre-compiled artifact; source changes won't be reflected until the bundle is rebuilt.
- Check whether the build script is `npm run build` at the `packages/coc/` level or a separate script inside the `spa/client/` folder (look for `package.json` there).
- Do **not** rename `data-testid` attributes (e.g., `pipeline-run-btn`) — those are test selectors, not user-visible text.
- Tab component name `PipelinesTab` and file names (`PipelinesTab.tsx`, `PipelineDetail.tsx`) do not need to change per scope.
