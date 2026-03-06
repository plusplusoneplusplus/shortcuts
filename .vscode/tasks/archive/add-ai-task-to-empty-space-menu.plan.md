# Add "Generate Task with AI" to Empty-Space Right-Click Menu

## Problem

In the CoC server dashboard Tasks panel, right-clicking empty space inside a feature folder column shows only **"Create Folder"**. Users should also be able to generate a task with AI directly from this context menu, matching the option already available on folder-item right-click menus.

## Approach

Add a second menu item **"Generate Task with AI…"** (with ✨ icon) to the empty-space context menu, reusing the existing `generate-task-ai` action and `GenerateTaskDialog`.

## Change

**Single file:** `packages/coc/src/server/spa/client/react/tasks/TasksPanel.tsx`

In the `folderCtxMenu.source === 'empty-space'` branch (~line 477-484), add a second entry to the returned array:

```tsx
if (folderCtxMenu.source === 'empty-space') {
    return [
        {
            label: 'Create Folder',
            icon: '📁',
            onClick: () => handleFolderContextMenuAction('create-subfolder', folder),
        },
        {
            label: 'Generate Task with AI…',
            icon: '✨',
            onClick: () => handleFolderContextMenuAction('generate-task-ai', folder),
        },
    ];
}
```

## Why This Works

- The `handleFolderContextMenuAction` handler already supports `'generate-task-ai'` (line 235), which calls `onOpenGenerateDialog` with the folder path.
- `GenerateTaskDialog` already exists and handles model selection, prompt input, depth, priority, and image attachments.
- No new components, hooks, APIs, or props are needed.

## Testing

- Build: `npm run build` from repo root
- Manual: Open CoC dashboard → Tasks tab → right-click empty space in a feature folder column → verify both "Create Folder" and "Generate Task with AI…" appear
- Existing tests: Run `cd packages/coc && npm run test:run` to ensure no regressions
