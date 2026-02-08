# Global Notes Module - Developer Reference

This module provides a global notes feature that allows users to create and manage quick-access notes available from any workspace. Notes are stored globally and persist across VSCode sessions.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    VSCode Tree View                             │
│              (Global Notes Panel in Side Bar)                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Renders
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Global Notes Module                           │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │           GlobalNotesTreeDataProvider                       ││
│  │  - Provides tree structure for notes                        ││
│  │  - Handles note CRUD operations                             ││
│  │  - Fires events on note changes                             ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              NoteDocumentProvider                           ││
│  │  - Virtual document provider (shortcuts-note: scheme)       ││
│  │  - Provides note content for editors                        ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │           NoteFileSystemProvider                             ││
│  │  - Implements vscode.FileSystemProvider                     ││
│  │  - Full file system operations (read, write, delete)       ││
│  │  - Retry logic with exponential backoff                    ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │           NoteDocumentManager                                ││
│  │  - Handles opening notes in editors                         ││
│  │  - Prevents double registration                             ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Storage
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│         VSCode Memento API (globalState)                        │
│         Note content stored globally                            │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### GlobalNotesTreeDataProvider

Tree data provider for the global notes view. **Extends `BaseTreeDataProvider`** (as of 2026-01 refactoring) for common functionality like EventEmitter, refresh, dispose, and error handling.

```typescript
import { GlobalNotesTreeDataProvider } from '../global-notes';

// The provider extends BaseTreeDataProvider (refactored in 2026-01)
// No need to implement EventEmitter or dispose() manually
// Built-in refresh(), error handling, and logging included
const provider = new GlobalNotesTreeDataProvider(context, configManager);

// Register with VSCode
vscode.window.createTreeView('workspaceShortcuts.globalNotes', {
    treeDataProvider: provider
});

// Create a new note
await provider.createNote('My Note');

// Rename a note
await provider.renameNote(noteId, 'New Name');

// Delete a note
await provider.deleteNote(noteId);

// Refresh the tree
provider.refresh();
```

### NoteDocumentProvider

Virtual document provider for note content.

```typescript
import { NoteDocumentProvider } from '../global-notes';

// Register the provider
const provider = new NoteDocumentProvider(context);
context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('shortcuts-note', provider)
);

// Open a note for editing
const uri = vscode.Uri.parse(`shortcuts-note:${noteId}`);
const doc = await vscode.workspace.openTextDocument(uri);
await vscode.window.showTextDocument(doc);

// Update note content
await provider.updateContent(noteId, 'New content');

// Get note content
const content = provider.getContent(noteId);
```

### NoteFileSystemProvider

Full file system provider that implements `vscode.FileSystemProvider` (not just `TextDocumentContentProvider`). Provides complete file system operations including read, write, delete, and stat operations. Includes retry logic with exponential backoff for content loading to handle transient failures.

```typescript
import { NoteFileSystemProvider } from '../global-notes';

// Register the file system provider
const fsProvider = new NoteFileSystemProvider(context);
context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('shortcuts-note', fsProvider, {
        isCaseSensitive: false
    })
);

// The provider handles:
// - readFile() - Loads note content with retry logic
// - writeFile() - Saves note content
// - delete() - Removes notes
// - stat() - Gets note metadata
// - readDirectory() - Lists all notes

// Retry logic uses exponential backoff:
// - Initial delay: 100ms
// - Max retries: 3
// - Backoff multiplier: 2x
```

### NoteDocumentManager

Manages opening notes in editors and prevents double registration in tests.

```typescript
import { NoteDocumentManager } from '../global-notes';

const manager = new NoteDocumentManager(context, noteProvider);

// Open a note in an editor
await manager.openNote(noteId, {
    preview: false,
    viewColumn: vscode.ViewColumn.One
});

// Check if note is already open
const isOpen = manager.isNoteOpen(noteId);

// Close a note
await manager.closeNote(noteId);

// Prevents double registration in tests by tracking
// which providers have been registered
```

## Usage Examples

### Example 1: Creating and Managing Notes

```typescript
import { GlobalNotesTreeDataProvider } from '../global-notes';

async function setupNotes(
    context: vscode.ExtensionContext,
    configManager: ConfigurationManager
) {
    const provider = new GlobalNotesTreeDataProvider(context, configManager);
    
    // Create a note
    const note = await provider.createNote('Project Ideas');
    
    // The note is now available in the tree view
    // and stored in globalNotes array in shortcuts.yaml
    
    return provider;
}
```

### Example 2: Opening Note for Editing

```typescript
import { NoteDocumentManager } from '../global-notes';

async function editNote(noteId: string, manager: NoteDocumentManager) {
    await manager.openNote(noteId, {
        preview: false,
        viewColumn: vscode.ViewColumn.One
    });
}
```

### Example 3: Listening for Note Changes

```typescript
// The tree provider emits events when notes change
provider.onDidChangeTreeData((element) => {
    if (element) {
        console.log('Note changed:', element.noteId);
    } else {
        console.log('All notes refreshed');
    }
});

// Listen for document changes
vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.uri.scheme === 'shortcuts-note') {
        const noteId = e.document.uri.path;
        console.log('Note content changed:', noteId);
    }
});
```

### Example 4: Programmatic Note Operations

```typescript
import { GlobalNote } from '../types';

async function createQuickNote(
    provider: GlobalNotesTreeDataProvider,
    title: string,
    content: string
) {
    // Create the note
    const note = await provider.createNote(title);
    
    // Set initial content
    const noteProvider = getNoteDocumentProvider();
    await noteProvider.updateContent(note.noteId, content);
    
    return note;
}

async function searchNotes(
    provider: GlobalNotesTreeDataProvider,
    query: string
): Promise<GlobalNote[]> {
    const notes = provider.getNotes();
    return notes.filter(note => 
        note.name.toLowerCase().includes(query.toLowerCase())
    );
}
```

## Types

### GlobalNote

```typescript
interface GlobalNote {
    /** Unique note identifier */
    noteId: string;
    /** Display name */
    name: string;
    /** Icon (optional) */
    icon?: string;
    /** Creation timestamp */
    createdAt?: Date;
    /** Last modified timestamp */
    updatedAt?: Date;
}
```

### GlobalNoteItem (Tree Item)

```typescript
class GlobalNoteItem extends vscode.TreeItem {
    /** Note ID */
    noteId: string;
    /** Note name */
    name: string;
    /** Command to open the note */
    command: vscode.Command;
    /** Context value for menus */
    contextValue: 'globalNote';
}
```

## Storage

Notes are stored in two places:

1. **Note metadata**: Stored in `shortcuts.yaml` under `globalNotes` array
2. **Note content**: Stored in VSCode's `globalState` using the `noteId` as key

```yaml
# shortcuts.yaml
globalNotes:
  - noteId: "note-abc123"
    name: "Project Ideas"
  - noteId: "note-def456"
    name: "Quick Reference"
```

## Commands

The module registers these commands:

| Command | Description |
|---------|-------------|
| `shortcuts.createGlobalNote` | Create a new global note |
| `shortcuts.editGlobalNote` | Edit note content |
| `shortcuts.renameGlobalNote` | Rename a note |
| `shortcuts.deleteGlobalNote` | Delete a note |
| `shortcuts.openGlobalNote` | Open note in editor |

## Menu Contributions

```json
{
  "view/title": [
    {
      "command": "shortcuts.createGlobalNote",
      "when": "view == workspaceShortcuts.globalNotes",
      "group": "navigation"
    }
  ],
  "view/item/context": [
    {
      "command": "shortcuts.renameGlobalNote",
      "when": "viewItem == globalNote"
    },
    {
      "command": "shortcuts.deleteGlobalNote",
      "when": "viewItem == globalNote"
    }
  ]
}
```

## Best Practices

1. **Unique IDs**: Always generate unique note IDs to avoid conflicts.

2. **Handle missing content**: Notes might exist in config but have no stored content.

3. **Save on change**: Save note content when the document is saved, not on every keystroke.

4. **Cross-workspace**: Remember notes are global - they're available in all workspaces.

5. **Cleanup**: Clean up orphaned content when notes are deleted.

6. **Retry logic**: The `NoteFileSystemProvider` includes exponential backoff retry logic for content loading to handle transient failures gracefully.

7. **Prevent double registration**: Use `NoteDocumentManager` to prevent double registration of providers in tests.

## See Also

- `src/shortcuts/configuration-manager.ts` - Configuration storage
- `src/shortcuts/types.ts` - Type definitions
- VSCode Memento API documentation
- VSCode FileSystemProvider API documentation
