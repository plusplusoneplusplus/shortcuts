---
status: pending
---

# 003: AI-Assisted Pipeline Refinement Command

## Summary
Adds a `pipelinesViewer.refineWithAI` right-click command on workspace pipeline tree items. The user describes desired changes in natural language; the current `pipeline.yaml` is loaded as context, the AI returns an updated YAML, which is backed up and written back to disk (with a diff-preview step before applying).

## Motivation
Mutating an existing file is a distinct operation from creating one: it requires reading current content, building a context-aware prompt, backing up before overwrite, and offering a diff preview before committing changes. Separating this from commit 002 (create) keeps each change reviewable and independently revertable.

## Changes

### Files to Create
- None

### Files to Modify
- `src/shortcuts/yaml-pipeline/ui/commands.ts` — Register `pipelinesViewer.refineWithAI` in `registerCommands()` and add `private async refinePipelineWithAI(item: PipelineItem): Promise<void>` method
- `src/shortcuts/yaml-pipeline/ui/pipeline-manager.ts` — Add `async refinePipelineWithAI(pipelinePath: string, changeDescription: string): Promise<string>` that reads current YAML, builds prompt, calls AI, validates, backs up, and writes
- `package.json` — Add `pipelinesViewer.refineWithAI` to `contributes.commands` and wire into the `pipeline` context menu under `view/item/context`

### Files to Delete
- None

## Implementation Notes

### `package.json` menu entry
The command must be scoped to workspace pipeline items only (not bundled/read-only).
The existing context values are:
- `"pipeline"` — valid workspace pipeline
- `"pipeline_invalid"` — invalid workspace pipeline
- `"pipeline_bundled"` — bundled (read-only, must be excluded)

Add to `contributes.menus["view/item/context"]`:
```json
{
  "command": "pipelinesViewer.refineWithAI",
  "when": "view == pipelinesViewer && (viewItem == pipeline || viewItem == pipeline_invalid)",
  "group": "pipeline@3"
}
```

### `commands.ts` — `registerCommands()` addition
Append to the existing `disposables.push(...)` call in `registerCommands()`:
```ts
vscode.commands.registerCommand('pipelinesViewer.refineWithAI', (item: PipelineItem) =>
    this.refinePipelineWithAI(item))
```

### `commands.ts` — `refinePipelineWithAI` method
```ts
private async refinePipelineWithAI(item: PipelineItem): Promise<void> {
    if (!item?.pipeline) { return; }
    if (item.pipeline.source !== PipelineSource.Workspace) {
        vscode.window.showWarningMessage('Bundled pipelines are read-only. Copy to workspace first.');
        return;
    }

    const changeDescription = await vscode.window.showInputBox({
        prompt: 'Describe the changes you want to make to this pipeline',
        placeHolder: 'e.g. Add a reduce step that summarises all map outputs into a single markdown table',
        validateInput: (v) => (!v?.trim() ? 'Description cannot be empty' : null)
    });
    if (!changeDescription) { return; }

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Refining pipeline "${item.pipeline.name}" with AI…`, cancellable: false },
        async () => {
            try {
                const updatedYAML = await this.pipelineManager.refinePipelineWithAI(
                    item.pipeline.filePath, changeDescription.trim()
                );

                const action = await vscode.window.showQuickPick(
                    ['Apply Changes', 'Show Diff', 'Cancel'],
                    { placeHolder: 'AI has produced an updated pipeline.yaml. What would you like to do?' }
                );

                if (!action || action === 'Cancel') { return; }

                if (action === 'Show Diff') {
                    // Write proposed content to a temp untitled doc and open diff
                    const tempUri = vscode.Uri.parse(`untitled:pipeline-proposed.yaml`);
                    const edit = new vscode.WorkspaceEdit();
                    edit.createFile(tempUri, { ignoreIfExists: true, overwrite: true });
                    edit.insert(tempUri, new vscode.Position(0, 0), updatedYAML);
                    await vscode.workspace.applyEdit(edit);
                    await vscode.commands.executeCommand(
                        'vscode.diff',
                        vscode.Uri.file(item.pipeline.filePath),
                        tempUri,
                        `${item.pipeline.name}: Current ↔ AI Proposed`
                    );
                    // Ask again after viewing diff
                    const applyAfterDiff = await vscode.window.showInformationMessage(
                        'Apply the AI-proposed changes?', 'Apply', 'Cancel'
                    );
                    if (applyAfterDiff !== 'Apply') { return; }
                }

                // Backup + write (backup is already created by pipeline-manager)
                await this.pipelineManager.applyRefinedPipeline(item.pipeline.filePath, updatedYAML);
                this.treeDataProvider.refresh();
                vscode.window.showInformationMessage(
                    `Pipeline "${item.pipeline.name}" updated. Original saved as pipeline.yaml.bak`
                );
            } catch (error) {
                const err = error instanceof Error ? error : new Error('Unknown error');
                vscode.window.showErrorMessage(`Failed to refine pipeline: ${err.message}`);
            }
        }
    );
}
```

> **Note:** The method is split into two `pipeline-manager` calls to keep the diff/confirmation gate inside the command handler (VS Code UI layer) and keep the manager free of UI concerns:
> - `refinePipelineWithAI(filePath, changeDescription)` → returns candidate YAML string (no disk writes)
> - `applyRefinedPipeline(filePath, newYAML)` → backup + write

### `pipeline-manager.ts` — `refinePipelineWithAI` method
```ts
async refinePipelineWithAI(pipelinePath: string, changeDescription: string): Promise<string> {
    // 1. Read current YAML
    const readResult = safeReadFile(pipelinePath);
    if (!readResult.success || !readResult.data) {
        throw new Error(`Cannot read pipeline file: ${pipelinePath}`);
    }
    const currentYAML = readResult.data;

    // 2. Read SKILL.md from extension resources (same path as 002)
    const skillContent = this.loadSkillContent();   // reuse helper from 002

    // 3. Build prompt
    const prompt = [
        skillContent,
        '',
        'Here is the current pipeline.yaml:',
        '```yaml',
        currentYAML,
        '```',
        '',
        `Please modify it to: ${changeDescription}`,
        '',
        'Return ONLY the complete updated pipeline.yaml. No markdown fences. No explanation.'
    ].join('\n');

    // 4. Call AI (same createAIInvoker pattern as createPipelineWithAI in 002)
    const invoker = this.createAIInvoker();
    const rawResponse = await invoker.invoke(prompt);

    // 5. Strip fences (reuse same fence-stripping helper as 002)
    const candidateYAML = this.stripFences(rawResponse);

    // 6. Validate before returning — do NOT write yet
    const validation = await this.validatePipelineContent(candidateYAML);
    if (!validation.valid) {
        throw new Error(`AI returned invalid YAML:\n${validation.errors.join('\n')}`);
    }

    return candidateYAML;
}
```

### `pipeline-manager.ts` — `applyRefinedPipeline` method
```ts
async applyRefinedPipeline(pipelinePath: string, newYAML: string): Promise<void> {
    // 1. Backup
    const backupPath = pipelinePath.replace(/pipeline\.yaml$/, 'pipeline.yaml.bak');
    const readResult = safeReadFile(pipelinePath);
    if (readResult.success && readResult.data) {
        safeWriteFile(backupPath, readResult.data);
    }

    // 2. Overwrite
    safeWriteFile(pipelinePath, newYAML);
}
```

> `validatePipelineContent(yaml: string)` — if the existing `validatePipeline(filePath)` only works on disk, add an in-memory variant that parses the string then runs the same structural checks. If the existing method can be trivially called after a temp write, that is also acceptable as a fallback.

### Context guard in `refinePipelineWithAI`
`PipelineItem.pipeline.source` is `PipelineSource.Workspace` for editable items and `PipelineSource.Bundled` for read-only items (see `pipeline-item.ts:59-63`). The method must bail early for bundled items even if the menu `when` clause already filters them — defense in depth.

## Tests

### `pipeline-manager.test.ts` (or adjacent spec file)
- **Happy path:** Mock AI invoker returns valid YAML → `refinePipelineWithAI` returns the stripped YAML string; then `applyRefinedPipeline` creates `pipeline.yaml.bak` with original content and overwrites `pipeline.yaml` with new content.
- **Invalid AI output:** Mock AI returns structurally invalid YAML → `refinePipelineWithAI` throws with a descriptive error message; `pipeline.yaml` and `pipeline.yaml.bak` are NOT touched (because `applyRefinedPipeline` is never called).
- **Fence stripping:** Mock AI returns YAML wrapped in ` ```yaml ... ``` ` → output equals bare YAML (reuse / mirror existing 002 test).

### `commands.test.ts` (or adjacent spec file)
- **"Show Diff" path:** Spy on `vscode.commands.executeCommand`; verify `'vscode.diff'` is called with the current file URI and a `untitled:pipeline-proposed.yaml` URI.
- **"Cancel" path:** Verify `pipelineManager.applyRefinedPipeline` is never called.
- **Error handling:** Mock `pipelineManager.refinePipelineWithAI` to throw → verify `vscode.window.showErrorMessage` is called with the error text.

## Acceptance Criteria
- [ ] Command `pipelinesViewer.refineWithAI` appears in the right-click context menu on valid and invalid workspace pipeline items
- [ ] Command does NOT appear on bundled pipeline items
- [ ] User is prompted with an InputBox to describe the changes before any AI call is made
- [ ] `pipeline.yaml.bak` is created with the original content before `pipeline.yaml` is overwritten
- [ ] If the AI returns invalid YAML, an error message is shown and the original file is unchanged (no backup written)
- [ ] After AI completes, a QuickPick offers "Apply Changes", "Show Diff", and "Cancel"
- [ ] "Show Diff" opens VS Code's native diff editor comparing current vs AI-proposed content
- [ ] Selecting "Cancel" (at either QuickPick stage) leaves the file unchanged
- [ ] Tree view refreshes after a successful apply

## Dependencies
- Depends on: 002 (`createAIInvoker`, fence-stripping helper, and SKILL.md loading must already exist in `pipeline-manager.ts`)

## Assumed Prior State
- **From 001:** `resources/pipeline.schema.json` exists; `package.json` has `contributes.yamlValidation` wired to that schema.
- **From 002:** `pipeline-manager.ts` has `createPipelineWithAI(name, description): Promise<string>`, `createAIInvoker()` private helper, `stripFences(raw: string): string` private helper, and a SKILL.md loader. `commands.ts` has `pipelinesViewer.createWithAI` registered and the `createPipelineWithAI` command handler as the model for AI command structure.
- `PipelineItem` (from `pipeline-item.ts`) exposes `pipeline: PipelineInfo` with `filePath: string`, `name: string`, `packageName: string`, and `source: PipelineSource`.
- `safeReadFile` / `safeWriteFile` utilities are already imported in `pipeline-manager.ts`.
- `PipelineSource` enum is imported from `./types` in both `commands.ts` and `pipeline-manager.ts`.
