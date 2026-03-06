---
status: pending
---

# 004: Surface AI Commands Prominently in Pipeline UI

## Summary
Wire the AI pipeline commands from commits 002 and 003 into all discoverable UI surfaces: the create QuickPick, the tree view context menu, the view toolbar, and the welcome view. No new logic is introduced — this commit is pure configuration and delegation.

## Motivation
The `createWithAI` and `refineWithAI` commands registered in 002/003 are callable via the command palette but invisible in the UI. This commit makes them discoverable via the natural entry points users already use (right-click, toolbar, empty-state welcome text, create flow), without coupling logic to presentation in the same diff.

## Changes

### Files to Create
_None._

### Files to Modify

- `package.json` — Four targeted additions:
  1. **`contributes.commands`** — Add icons for `pipelinesViewer.createWithAI` and `pipelinesViewer.refineWithAI` so they render properly in toolbars/menus.
  2. **`contributes.menus["view/title"]`** — Add a toolbar button for "Create with AI" in the Pipelines panel header.
  3. **`contributes.menus["view/item/context"]`** — Add a "Refine with AI" entry on right-click of valid pipeline items.
  4. **`contributes.viewsWelcome`** — Update the existing `pipelinesView` welcome entry to mention AI creation.

- `src/shortcuts/yaml-pipeline/ui/commands.ts` — Prepend a "Create with AI" option to the `createPipelineFromTemplate` QuickPick; delegate to `createPipelineWithAI()` if selected.

### Files to Delete
_None._

## Implementation Notes

### 1. `package.json` — `contributes.commands` icon additions

Add `icon` fields to the two AI commands registered in 002/003 (find them by their `command` ID):

```jsonc
{
  "command": "pipelinesViewer.createWithAI",
  "title": "Pipelines: Create Pipeline with AI ✨",
  "icon": "$(sparkle)"
},
{
  "command": "pipelinesViewer.refineWithAI",
  "title": "Pipelines: Refine Pipeline with AI",
  "icon": "$(sparkle)"
}
```

### 2. `package.json` — `contributes.menus["view/title"]` toolbar button

The existing `view/title` entries for `pipelinesView` live around line 2185 and use `"group": "navigation"`. Add the AI create button in the same group, ordered before the plain create button by using a sort suffix:

```jsonc
// Add alongside the existing create / refresh / openFolder buttons
{
  "command": "pipelinesViewer.createWithAI",
  "when": "view == pipelinesView",
  "group": "navigation"
}
```

The view ID is `pipelinesView` (not `pipelinesViewer` — confirmed from `contributes.views`).

### 3. `package.json` — `contributes.menus["view/item/context"]` refine entry

Existing context menu entries (around line 3162) use the regex `viewItem =~ /^pipeline/` for broad matching and explicit values like `viewItem == pipeline` for destructive actions. Add refine in the `pipeline` group after validate:

```jsonc
{
  "command": "pipelinesViewer.refineWithAI",
  "when": "view == pipelinesView && viewItem == pipeline",
  "group": "pipeline@4a"
}
```

- `when` uses `viewItem == pipeline` (excludes `pipeline_invalid` and `pipeline_bundled` — refining a broken or read-only pipeline is not useful).
- Group `"pipeline@4a"` slots it between validate (`pipeline@4`) and rename (`pipeline@5`).

Confirmed `contextValue` values from `tree-data-provider.ts`:
| Tree item | `contextValue` |
|---|---|
| Valid workspace pipeline | `"pipeline"` |
| Invalid workspace pipeline | `"pipeline_invalid"` |
| Bundled (read-only) pipeline | `"pipeline_bundled"` |

### 4. `package.json` — `contributes.viewsWelcome` update

The existing welcome entry (confirmed view ID `pipelinesView`):

```jsonc
// Before
{
  "view": "pipelinesView",
  "contents": "📋 **Pipelines**\n\n[Create First Pipeline](command:pipelinesViewer.create)\n\nManage YAML-based AI pipelines.\n\n**Features:**\n• Pipelines stored in `.vscode/pipelines/`\n• One-click execution\n• Validation and error checking\n• Template-based AI processing"
}

// After
{
  "view": "pipelinesView",
  "contents": "📋 **Pipelines**\n\n[✨ Create with AI](command:pipelinesViewer.createWithAI) — describe your goal and let AI generate the pipeline.\n\n[Create from Template](command:pipelinesViewer.create)\n\nManage YAML-based AI pipelines.\n\n**Features:**\n• Pipelines stored in `.vscode/pipelines/`\n• One-click execution\n• Validation and error checking\n• Template-based or AI-generated pipelines"
}
```

AI creation link appears first; template creation is demoted to second link.

### 5. `commands.ts` — prepend AI option to `createPipelineFromTemplate` QuickPick

Current QuickPick construction (around line 91) maps `PIPELINE_TEMPLATES` directly. Prepend a sentinel item:

```typescript
// Before (simplified)
const templateItems: vscode.QuickPickItem[] = Object.values(PIPELINE_TEMPLATES).map(template => ({
    label: template.displayName,
    description: template.type,
    detail: template.description
}));

// After
const AI_ITEM: vscode.QuickPickItem & { value: 'ai' } = {
    label: '$(sparkle) Create with AI',
    description: 'Describe your goal — AI generates the pipeline',
    detail: 'Opens an input prompt and uses Copilot to scaffold a pipeline.yaml for you.',
    value: 'ai',
};

const templateItems: vscode.QuickPickItem[] = [
    AI_ITEM,
    ...Object.values(PIPELINE_TEMPLATES).map(template => ({
        label: template.displayName,
        description: template.type,
        detail: template.description,
    })),
];
```

Selection handler — detect the AI sentinel by checking `description` or a cast to the extended type, then delegate:

```typescript
const selected = await vscode.window.showQuickPick(templateItems, {
    placeHolder: 'Select a template or create with AI',
});
if (!selected) return;

if ((selected as typeof AI_ITEM).value === 'ai') {
    return createPipelineWithAI();   // function registered in 002
}

// existing template-based creation continues unchanged …
const templateType = selected.description as PipelineTemplateType;
```

`createPipelineWithAI` is already imported/available in the same file from commit 002.

## Tests

- No new logic is added, so no new unit tests are required.
- Validate `package.json` is well-formed JSON after edits: `node -e "require('./package.json')"` (or `npm run lint` if the lint script covers JSON).
- Manual smoke test: open Pipelines panel → confirm "✨ Create with AI" is the first QuickPick option → confirm welcome view shows AI link first → right-click a valid pipeline → confirm "Refine with AI" appears → confirm toolbar shows sparkle icon.

## Acceptance Criteria

- [ ] "✨ Create with AI" appears as the **first** option in the create QuickPick (above all templates)
- [ ] Selecting "✨ Create with AI" in QuickPick delegates to `createPipelineWithAI()` (commit 002)
- [ ] Right-clicking a **valid** pipeline (`viewItem == pipeline`) shows "Refine with AI" in the context menu
- [ ] "Refine with AI" does **not** appear on `pipeline_bundled` or `pipeline_invalid` items
- [ ] Pipelines panel toolbar shows a sparkle/wand icon button for "Create with AI"
- [ ] Welcome view (empty Pipelines panel) shows AI creation link **before** the template link
- [ ] `contributes.commands` entries for both AI commands include an `icon` field
- [ ] `package.json` is valid JSON (`node -e "require('./package.json')"` exits 0)

## Dependencies

- Depends on: 002 (`pipelinesViewer.createWithAI` command + `createPipelineWithAI()` function), 003 (`pipelinesViewer.refineWithAI` command)

## Assumed Prior State

- `pipelinesViewer.createWithAI` and `pipelinesViewer.refineWithAI` are registered in `contributes.commands` (added in 002 and 003 respectively).
- `createPipelineWithAI()` is exported/importable from the yaml-pipeline commands module (002).
- `refineCurrentPipelineWithAI()` or equivalent is wired to `pipelinesViewer.refineWithAI` (003).
- The view ID for the pipelines panel is `pipelinesView` (confirmed in `contributes.views`).
- `contextValue` for a valid user-created pipeline item is the string `"pipeline"` (confirmed in `tree-data-provider.ts`).
- Existing `view/item/context` entries follow the group naming convention `pipeline@N` (confirmed ~line 3162 of `package.json`).
- JSON Schema for `pipeline.yaml` is registered (001) — no dependency from this commit, but provides a complete UX story.
