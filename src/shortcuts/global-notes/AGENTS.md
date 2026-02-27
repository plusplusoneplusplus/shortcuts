# Global Notes Module - Developer Reference

This module provides a global notes feature that allows users to create and manage quick-access notes available from any workspace. Notes are stored globally and persist across VSCode sessions.

## Architecture Overview

```
VSCode Tree View (Global Notes Panel in Side Bar)
  │ Renders
  ▼
Global Notes Module
  ├── GlobalNotesTreeDataProvider - Tree structure, extends BaseTreeDataProvider
  ├── NoteFileSystemProvider - vscode.FileSystemProvider with retry logic
  └── NoteDocumentManager - Opens notes in editors, prevents double registration
  │ Storage
  ▼
ConfigurationManager (note metadata in shortcuts.yaml, content via noteExists/getNoteContent/saveNoteContent)
```

## Key Components

### GlobalNotesTreeDataProvider

Tree data provider for the global notes view. **Extends `BaseTreeDataProvider`** (2026-01 refactoring) — built-in EventEmitter, refresh, dispose, and error handling.

```typescript
import { GlobalNotesTreeDataProvider } from '../global-notes';

const provider = new GlobalNotesTreeDataProvider(configManager);
vscode.window.createTreeView('workspaceShortcuts.globalNotes', { treeDataProvider: provider });

await provider.createNote('My Note');
await provider.renameNote(noteId, 'New Name');
await provider.deleteNote(noteId);
provider.refresh();
```

### NoteFileSystemProvider

Implements `vscode.FileSystemProvider` with retry logic (5 retries, 200ms initial delay, 2x backoff). Constructor takes `configurationManager: ConfigurationManager`.

```typescript
import { NoteFileSystemProvider } from '../global-notes';
const fsProvider = new NoteFileSystemProvider(configurationManager);
// Handles: readFile(), writeFile(), stat(), delete(), rename()
```

### NoteDocumentManager

Manages note document lifecycle. Registers `NoteFileSystemProvider` on construction (once per process). Constructor takes `(configurationManager, context)`.

```typescript
import { NoteDocumentManager } from '../global-notes';
const manager = new NoteDocumentManager(configurationManager, context);
await manager.openNote(noteId, noteName);
```

## Usage Example

```typescript
async function setupNotes(configManager: ConfigurationManager) {
    const provider = new GlobalNotesTreeDataProvider(configManager);
    const note = await provider.createNote('Project Ideas');
    return provider;
}
```

## Storage

- **Note metadata**: `globalNotes` array in `shortcuts.yaml`
- **Note content**: Managed via `ConfigurationManager` (`getNoteContent`, `saveNoteContent`, `noteExists`)

## Commands

| Command | Description |
|---------|-------------|
| `shortcuts.createGlobalNote` | Create a new global note |
| `shortcuts.editGlobalNote` | Edit note content |
| `shortcuts.renameGlobalNote` | Rename a note |
| `shortcuts.deleteGlobalNote` | Delete a note |
| `shortcuts.openGlobalNote` | Open note in editor |

## Best Practices

1. **Unique IDs**: Always generate unique note IDs to avoid conflicts.
2. **Handle missing content**: Notes might exist in config but have no stored content.
3. **Cross-workspace**: Notes are global — available in all workspaces.
4. **Retry logic**: `NoteFileSystemProvider` uses exponential backoff for transient failures.
5. **Prevent double registration**: `NoteDocumentManager` tracks registration state.

## Module Files

| File | Purpose |
|------|---------|
| `tree-data-provider.ts` | `GlobalNotesTreeDataProvider`: extends `BaseTreeDataProvider`, provides tree structure |
| `note-document-provider.ts` | `NoteFileSystemProvider`: vscode.FileSystemProvider with retry logic; `NoteDocumentManager`: note lifecycle |
| `index.ts` | Exports from: tree-data-provider, note-document-provider |

## See Also

- `src/shortcuts/configuration-manager.ts` - Configuration storage
- `src/shortcuts/types.ts` - Type definitions (`GlobalNote`, `GlobalNoteItem`)
