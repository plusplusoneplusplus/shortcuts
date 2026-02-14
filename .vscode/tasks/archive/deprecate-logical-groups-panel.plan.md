# Deprecate Logical Groups Panel

## Description

Deprecate the **Logical Groups** panel (`shortcutsView`) in the sidebar. Add a new VS Code setting to control its visibility and make it **hidden by default**. Users who still need the panel can re-enable it via settings.

## Background

The logical groups panel is currently always visible (`"when": "true"`) in the Shortcuts sidebar container. Other panels already follow the `enabled` setting pattern (e.g., `tasksViewer.enabled`, `pipelinesViewer.enabled`, `globalNotes.enabled`). This task aligns the logical groups panel with that pattern and deprecates it by defaulting to hidden.

## Acceptance Criteria

- [ ] A new VS Code setting `workspaceShortcuts.logicalGroups.enabled` is added (type: `boolean`, default: `false`)
- [ ] The `shortcutsView` panel is hidden by default (only shown when the setting is `true`)
- [ ] The `"when"` clause for `shortcutsView` in `package.json` uses a context key tied to the setting (e.g., `"when": "workspaceShortcuts.logicalGroups.enabled"`)
- [ ] The extension reads the setting on activation and sets the appropriate context key via `vscode.commands.executeCommand('setContext', ...)`
- [ ] Changes to the setting at runtime are detected and the panel visibility updates without requiring a reload
- [ ] A deprecation notice is shown in the setting description (e.g., "Deprecated: This panel will be removed in a future version")
- [ ] All existing commands and menus scoped to `shortcutsView` continue to work when the panel is enabled
- [ ] Existing tests remain passing

## Subtasks

1. **Add setting to `package.json`**
   - Add `workspaceShortcuts.logicalGroups.enabled` under `contributes.configuration`
   - Type: `boolean`, default: `false`
   - Description should include a deprecation notice
   - Mark with `"markdownDeprecationMessage"` if supported

2. **Update view `when` clause in `package.json`**
   - Change `shortcutsView` from `"when": "true"` to `"when": "workspaceShortcuts:logicalGroupsEnabled"`
   - Ensure the context key naming follows existing conventions

3. **Set context key in `src/extension.ts`**
   - On activation, read `workspaceShortcuts.logicalGroups.enabled` from configuration
   - Call `vscode.commands.executeCommand('setContext', 'workspaceShortcuts:logicalGroupsEnabled', value)`
   - Listen for `onDidChangeConfiguration` to update the context key at runtime

4. **Guard tree view creation**
   - Only create the `LogicalTreeDataProvider` and `createTreeView` when the setting is enabled (optional optimization)
   - Alternatively, always create but rely on `when` clause to hide — simpler approach

5. **Update CLAUDE.md / README**
   - Document the new setting
   - Note the deprecation status of the logical groups panel

6. **Test**
   - Verify panel is hidden by default on fresh install
   - Verify panel appears when setting is toggled to `true`
   - Verify all existing functionality works when enabled
   - Ensure no regressions in other panels

## Notes

- Follow the same pattern used by `globalNotes.enabled` (default `false`) since the behavior is similar — hidden by default
- The context key convention in this project uses colon-separated format: `workspaceShortcuts:logicalGroupsEnabled`
- Consider whether welcome view content for the shortcuts container should be updated when the groups panel is hidden
- If the logical groups panel is the "main" panel and hiding it leaves the sidebar container empty (when other panels are also disabled), consider showing a welcome message guiding users to enable at least one panel
