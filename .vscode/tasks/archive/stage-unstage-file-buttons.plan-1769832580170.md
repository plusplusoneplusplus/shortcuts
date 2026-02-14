# Stage/Unstage File Operations via Inline Buttons

## Description

Add support for staging and unstaging individual files directly from the Git panel tree view using inline action buttons. Users should be able to click a `+` button to stage a file and a `-` button to unstage a file, providing a quick and intuitive way to manage staged changes without using context menus or keyboard shortcuts.

## Acceptance Criteria

- [x] Unstaged files display a `+` (plus) button that stages the file when clicked
- [x] Staged files display a `-` (minus) button that unstages the file when clicked
- [x] Buttons appear as inline actions on hover (following VS Code conventions)
- [x] Stage operation moves file from "Changes" to "Staged Changes" section
- [x] Unstage operation moves file from "Staged Changes" to "Changes" section
- [x] Tree view refreshes automatically after stage/unstage operations
- [x] Operations handle errors gracefully with user-friendly notifications
- [x] Buttons have appropriate icons and tooltips

## Subtasks

- [x] **Define commands** - Register `shortcuts.git.stageFile` and `shortcuts.git.unstageFile` commands
- [x] **Implement stage logic** - Execute `git add <filepath>` for staging files
- [x] **Implement unstage logic** - Execute `git reset HEAD <filepath>` for unstaging files
- [x] **Add inline button contributions** - Configure `view/item/context` menu contributions with `inline` group
- [x] **Set up when clauses** - Use `viewItem` context to show correct button based on file state (staged vs unstaged)
- [x] **Add icons** - Use appropriate codicons (`add` for stage, `remove` for unstage)
- [x] **Handle refresh** - Trigger tree view refresh after operations complete
- [x] **Error handling** - Add try/catch with error notifications for git command failures
- [x] **Testing** - Add unit tests for stage/unstage command handlers

## Notes

- Follow VS Code's Source Control view pattern for button placement and behavior
- Consider using `$(add)` and `$(remove)` codicons for consistency with VS Code UI
- The `viewItem` context value should distinguish between staged and unstaged files (e.g., `gitFile_staged` vs `gitFile_unstaged`)
- May need to update tree item context values in the Git tree data provider
- Consider batch operations in the future (stage all, unstage all)
