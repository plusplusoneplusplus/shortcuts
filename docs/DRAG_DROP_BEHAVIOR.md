# Drag-Drop Behavior Documentation

## Overview

This document describes the detailed behavior of drag-and-drop operations in the Workspace Shortcuts extension. Understanding these behaviors is crucial for both users and developers, as the extension supports two distinct types of operations: **physical file system moves** and **logical configuration changes**.

## Core Concepts

### Two Types of Operations

1. **Physical File System Move**
   - Uses `vscode.workspace.fs.rename()` to actually move files/folders on disk
   - Changes the file's location in the file system
   - Supports undo (Ctrl+Z) within 1 minute
   - Triggered when dropping on physical folders or files

2. **Logical Configuration Move/Copy**
   - Updates the shortcuts.yaml configuration only
   - Adds/removes items from logical groups
   - Does not move physical files
   - No undo support (edit configuration manually to revert)
   - Triggered when dropping on logical groups

### Drop Target Determines Behavior

The **type of drop target** determines which operation occurs:

| Drop Target Type | Operation Type | Example |
|-----------------|----------------|---------|
| Physical folder (expanded from tree) | Physical move | Drop on folder expanded from logical group |
| Physical file (drops on parent folder) | Physical move | Drop on file, moves to file's parent folder |
| Logical group header | Configuration change | Drop on group name |
| Logical subgroup header | Configuration change | Drop on nested group name |

### Item Types

Understanding item types helps predict behavior:

- **`FolderShortcutItem`**: Physical folder item (standalone or expanded)
- **`FileShortcutItem`**: Physical file item (standalone or expanded)
- **`LogicalGroupItem`**: A logical group container (top-level or nested)
- **`LogicalGroupChildItem`**: File/folder that's a member of a logical group
- **`NoteShortcutItem`**: Virtual note item (configuration-only)

## Behavior Scenarios

### Scenario 1: Moving File Between Physical Folders in Same Logical Group

**Setup:**
```yaml
logicalGroups:
  - name: "Project Files"
    items:
      - path: "/workspace/folderA"
        name: "Folder A"
        type: folder
      - path: "/workspace/folderB"
        name: "Folder B"
        type: folder
```

**Action:**
1. Expand "Folder A" to see its contents
2. Drag `file.txt` from inside Folder A
3. Drop on "Folder B" (the folder item itself)

**Code Path:**
- Source: `FileShortcutItem` or `FolderShortcutItem`
- Target: `LogicalGroupChildItem` or `FolderShortcutItem` (Folder B)
- Handler: `handlePhysicalFileMove()` (src/shortcuts/drag-drop-controller.ts:485)

**Result:**
- ✅ **Physical file system move**: `/workspace/folderA/file.txt` → `/workspace/folderB/file.txt`
- ❌ **No configuration change**: Both folders remain in "Project Files" group unchanged
- 🔄 **Undo available**: Press Ctrl+Z within 1 minute to revert
- 📢 **Notification**: "Moved 'file.txt' to 'folderB' (Ctrl+Z to undo)"

**Important Notes:**
- The file is actually moved on disk
- Logical group membership doesn't affect physical moves
- Tree view automatically refreshes to show new location

---

### Scenario 2: Moving File Between Physical Folders in Different Logical Groups

**Setup:**
```yaml
logicalGroups:
  - name: "Group 1"
    items:
      - path: "/workspace/folderA"
        name: "Folder A"
        type: folder
  - name: "Group 2"
    items:
      - path: "/workspace/folderB"
        name: "Folder B"
        type: folder
```

**Action:**
1. Expand "Folder A" in Group 1
2. Drag `file.txt` from inside Folder A
3. Drop on "Folder B" in Group 2

**Code Path:**
- Source: `FileShortcutItem` or `FolderShortcutItem`
- Target: `LogicalGroupChildItem` or `FolderShortcutItem` (Folder B)
- Handler: `handlePhysicalFileMove()` (src/shortcuts/drag-drop-controller.ts:485)

**Result:**
- ✅ **Physical file system move**: `/workspace/folderA/file.txt` → `/workspace/folderB/file.txt`
- ❌ **No configuration change**: Groups remain unchanged
- 🔄 **Undo available**: Press Ctrl+Z within 1 minute
- 📢 **Notification**: "Moved 'file.txt' to 'folderB' (Ctrl+Z to undo)"

**Important Notes:**
- Logical group boundaries are irrelevant for physical folder operations
- Same behavior as Scenario 1 despite different group membership
- This is consistent with normal file system behavior

---

### Scenario 3a: Moving From Logical Subgroup Item to Physical Folder

**Setup:**
```yaml
logicalGroups:
  - name: "Project"
    items:
      - path: "/workspace/folderA"
        name: "Folder A"
        type: folder
    groups:
      - name: "Subgroup"
        items:
          - path: "/workspace/file.txt"
            name: "Important File"
            type: file
```

**Action:**
1. Drag "Important File" from Subgroup (a LogicalGroupChildItem)
2. Drop on "Folder A" (the physical folder item)

**Code Path:**
- Source: `LogicalGroupChildItem` (file from Subgroup)
- Target: `LogicalGroupChildItem` (Folder A)
- Handler: `handlePhysicalFileMove()` (src/shortcuts/drag-drop-controller.ts:485)

**Result:**
- ✅ **Physical file system move**: `/workspace/file.txt` → `/workspace/folderA/file.txt`
- ⚠️ **Configuration becomes stale**: Subgroup still references `/workspace/file.txt` (which no longer exists!)
- 🔄 **Undo available**: Press Ctrl+Z within 1 minute to restore file and fix configuration
- 📢 **Notification**: "Moved 'file.txt' to 'folderA' (Ctrl+Z to undo)"

**Important Notes:**
- **This creates a configuration/filesystem mismatch**
- The configuration is NOT automatically updated
- The Subgroup item will show an error or be invalid after the move
- **Best Practice**: Remove item from Subgroup manually after move, or use Scenario 3b instead

**Why This Happens:**
The drag-drop controller prioritizes physical operations when the target is a physical folder. It doesn't track whether the source item is also in a logical group configuration.

---

### Scenario 3b: Moving From Physical Folder Contents to Logical Subgroup

**Setup:**
```yaml
logicalGroups:
  - name: "Project"
    items:
      - path: "/workspace/folderA"
        name: "Folder A"
        type: folder
    groups:
      - name: "Subgroup"
        items: []
```

**Action:**
1. Expand "Folder A" to see its contents
2. Drag `file.txt` from inside Folder A
3. Drop on "Subgroup" (the logical group header itself)

**Code Path:**
- Source: `FileShortcutItem` or `FolderShortcutItem` (from expanding Folder A)
- Target: `LogicalGroupItem` (Subgroup)
- Handler: `handleDropOntoLogicalGroup()` (src/shortcuts/drag-drop-controller.ts:142)
- Decision: `sourceGroupItems` is empty because `FileShortcutItem ≠ LogicalGroupChildItem`
- Decision: `shouldMove = false` (line 248)

**Result:**
- ❌ **No physical file move**: File stays at `/workspace/folderA/file.txt`
- ✅ **Configuration change**: File is ADDED to Subgroup's items
- ℹ️ **No removal from source**: File not removed from Folder A (it was never in configuration)
- ❌ **No undo available**: This is a configuration operation only
- 📢 **Notification**: "1 item added to group 'Subgroup'"

**Important Notes:**
- This is an **ADD operation**, not a move
- The file appears in both places:
  1. Inside Folder A (physical location)
  2. In Subgroup (logical group membership)
- This is expected behavior for adding files to groups from the file system

---

### Scenario 4: Moving LogicalGroupChildItem Between Logical Groups

**Setup:**
```yaml
logicalGroups:
  - name: "Group A"
    items:
      - path: "/workspace/file.txt"
        name: "My File"
        type: file
  - name: "Group B"
    items: []
```

**Action:**
1. Drag "My File" from Group A (a LogicalGroupChildItem)
2. Drop on "Group B" (the logical group header)

**Code Path:**
- Source: `LogicalGroupChildItem` with `parentGroup="Group A"`
- Target: `LogicalGroupItem` (Group B)
- Handler: `handleDropOntoLogicalGroup()` (src/shortcuts/drag-drop-controller.ts:142)
- Decision: `sourceGroupItems.length > 0` (line 249)
- Decision: `shouldMove = true` because `sourceItem.parentGroup !== targetGroupPath` (line 252)

**Result:**
- ❌ **No physical file move**: File stays at `/workspace/file.txt`
- ✅ **Configuration move**:
  - File ADDED to Group B's items
  - File REMOVED from Group A's items (line 307-323)
- ❌ **No undo available**: This is a configuration operation
- 📢 **Notification**: "1 item moved to group 'Group B'"

**Important Notes:**
- This is a true **MOVE operation** in configuration
- The file only appears in Group B after the operation
- Physical file location doesn't change
- This is the recommended way to reorganize items between groups

---

### Scenario 5: Moving Between Subgroups of Same Parent

**Setup:**
```yaml
logicalGroups:
  - name: "Project"
    groups:
      - name: "Subgroup A"
        items:
          - path: "/workspace/file.txt"
            name: "My File"
            type: file
      - name: "Subgroup B"
        items: []
```

**Action:**
1. Drag "My File" from "Subgroup A"
2. Drop on "Subgroup B" (nested group header)

**Code Path:**
- Source: `LogicalGroupChildItem` with `parentGroup="Project/Subgroup A"`
- Target: `LogicalGroupItem` with `parentGroupPath="Project"` and name "Subgroup B"
- Handler: `handleDropOntoLogicalGroup()` (src/shortcuts/drag-drop-controller.ts:142)
- Decision: `shouldMove = true` because both are subgroups of same parent (line 257-259)

**Result:**
- ❌ **No physical file move**: File stays at `/workspace/file.txt`
- ✅ **Configuration move**:
  - File ADDED to "Project/Subgroup B"
  - File REMOVED from "Project/Subgroup A"
- ❌ **No undo available**: Configuration operation
- 📢 **Notification**: "1 item moved to group 'Subgroup B'"

**Important Notes:**
- Nested groups are treated specially
- Moving between sibling subgroups is a move operation (not copy)
- The full group path is used for comparison: "Project/Subgroup A" vs "Project/Subgroup B"

---

### Scenario 6: Dropping External Files from VS Code Explorer

**Setup:**
Any logical group exists

**Action:**
1. Open VS Code Explorer (Ctrl+Shift+E)
2. Drag file(s) from Explorer
3. Drop on a logical group in Shortcuts panel

**Code Path:**
- Source: External (from VS Code Explorer)
- Target: `LogicalGroupItem`
- Handler: `handleDropOntoLogicalGroup()` (src/shortcuts/drag-drop-controller.ts:142)
- Data: Only `text/uri-list` is set (no internal tree data)

**Result:**
- ❌ **No physical file move**: File stays in original location
- ✅ **Configuration change**: File is ADDED to the logical group
- ❌ **No undo available**: Configuration operation
- 📢 **Notification**: "1 item added to group 'GroupName'"

**Important Notes:**
- This is always an ADD operation, never a move
- Files can be added from anywhere in the workspace
- External drops are distinguished by lack of internal data transfer

---

### Scenario 7: Moving Notes Between Groups

**Setup:**
```yaml
logicalGroups:
  - name: "Group A"
    notes:
      - id: "note-123"
        title: "My Note"
        content: "Note content"
  - name: "Group B"
    notes: []
```

**Action:**
1. Drag note from Group A
2. Drop on Group B

**Code Path:**
- Source: `NoteShortcutItem` with `parentGroup="Group A"`
- Target: `LogicalGroupItem` (Group B)
- Handler: `handleNoteMove()` (src/shortcuts/drag-drop-controller.ts:345)

**Result:**
- ❌ **No physical file operation**: Notes are virtual (no file system representation)
- ✅ **Configuration move**:
  - Note MOVED from Group A to Group B
  - Uses `configurationManager.moveNote()`
- ❌ **No undo available**: Configuration operation
- 📢 **Notification**: "1 note moved successfully"

**Important Notes:**
- Notes are handled separately from files/folders
- Notes are always configuration-only (no physical files)
- Note moves are always moves, never copies

---

## Summary Table

| Scenario | Source Type | Target Type | Physical Move? | Config Change? | Undo? |
|----------|------------|-------------|----------------|----------------|-------|
| 1. Same group, folder→folder | File/Folder Item | Physical Folder | ✅ Yes | ❌ No | ✅ Yes (1 min) |
| 2. Different groups, folder→folder | File/Folder Item | Physical Folder | ✅ Yes | ❌ No | ✅ Yes (1 min) |
| 3a. Group item→physical folder | LogicalGroupChildItem | Physical Folder | ✅ Yes | ⚠️ Stale | ✅ Yes (1 min) |
| 3b. Folder contents→logical group | File/Folder Item | Logical Group | ❌ No | ✅ Add only | ❌ No |
| 4. Between different logical groups | LogicalGroupChildItem | Logical Group | ❌ No | ✅ Move | ❌ No |
| 5. Between sibling subgroups | LogicalGroupChildItem | Logical Group | ❌ No | ✅ Move | ❌ No |
| 6. External files from Explorer | External | Logical Group | ❌ No | ✅ Add only | ❌ No |
| 7. Notes between groups | NoteShortcutItem | Logical Group | ❌ N/A | ✅ Move | ❌ No |

---

## Decision Logic

### handleDrop() Flow

```
handleDrop(target, dataTransfer)
  │
  ├─ Is target LogicalGroupItem?
  │  ├─ YES → handleDropOntoLogicalGroup()
  │  │        ├─ Has internal data (LogicalGroupChildItem)?
  │  │        │  ├─ YES, contains NoteShortcutItem? → handleNoteMove()
  │  │        │  ├─ YES, contains LogicalGroupChildItem?
  │  │        │  │  └─ Different parent group? → MOVE (add + remove)
  │  │        │  │  └─ Same parent group? → Skip (no duplicate)
  │  │        │  └─ YES, contains File/FolderShortcutItem? → ADD only
  │  │        └─ Has external data (text/uri-list)? → ADD only
  │  │
  │  └─ NO → Continue...
  │
  ├─ Has internal data (application/vnd.code.tree.*)?
  │  └─ YES → handlePhysicalFileMove()
  │           └─ vscode.workspace.fs.rename()
  │
  └─ Has external data (text/uri-list)?
     └─ YES → handleExternalFileDrop()
              └─ vscode.workspace.fs.copy()
```

### shouldMove Logic (for Logical Groups)

When dropping `LogicalGroupChildItem` onto a `LogicalGroupItem`:

```javascript
if (sourceItem.parentGroup !== targetGroupPath) {
    // Check if both are subgroups of the same parent
    const sourceParent = getParentGroupPath(sourceItem.parentGroup);
    const targetParent = getParentGroupPath(targetGroupPath);

    if (sourceParent && targetParent && sourceParent === targetParent) {
        shouldMove = true;  // Sibling subgroups → MOVE
    } else if (sourceParent !== targetParent) {
        shouldMove = true;  // Different parent groups → MOVE
    }
}
```

**Examples:**
- "Group A" → "Group B": `shouldMove = true` (different parents: null vs null)
- "Project/Sub A" → "Project/Sub B": `shouldMove = true` (same parent: "Project")
- "Group A" → "Group A": `shouldMove = false` (same group, skip)

---

## Edge Cases and Warnings

### ⚠️ Configuration Staleness (Scenario 3a)

When moving a `LogicalGroupChildItem` to a physical folder, the configuration becomes stale:

```yaml
# Before
logicalGroups:
  - name: "Project"
    groups:
      - name: "Important"
        items:
          - path: "/workspace/file.txt"  # File exists here

# After physical move (file moved to /workspace/folderA/file.txt)
logicalGroups:
  - name: "Project"
    groups:
      - name: "Important"
        items:
          - path: "/workspace/file.txt"  # ⚠️ File no longer exists here!
```

**Solutions:**
1. Use undo (Ctrl+Z) immediately if unintended
2. Manually edit configuration to remove or update the path
3. Instead, use Scenario 4 (move between logical groups) + separate physical organization

### ⚠️ Overwrite Confirmation

When dropping on a physical folder, if a file with the same name exists:

```
Prompt: "file.txt already exists in the target location. Do you want to overwrite it?"
Actions: [Overwrite] [Skip]
```

- **Overwrite**: Replaces target file with source file
- **Skip**: Cancels move for this file (continues with remaining files if multiple)

### ⚠️ Prevent Moving Folder Into Itself

```
Action: Drag folderA → Drop on folderA (or subfolder of folderA)
Result: Warning "Cannot move 'folderA' into itself."
```

This check prevents filesystem corruption.

### ⚠️ Undo Timeout

Physical file moves can be undone within **1 minute** (60,000ms):

```javascript
private static readonly UNDO_TIMEOUT_MS = 60000; // 1 minute
```

After timeout:
- `canUndo()` returns `false`
- Undo command shows: "Cannot undo: Move operation is too old (> 1 minute)."

---

## Implementation Details

### Key Files

- **`src/shortcuts/drag-drop-controller.ts`**: Main drag-drop logic
- **`src/shortcuts/tree-items.ts`**: Item type definitions
- **`src/shortcuts/configuration-manager.ts`**: Configuration operations
- **`src/test/suite/drag-drop.test.ts`**: Comprehensive test suite

### MIME Types

The extension uses custom MIME types to distinguish internal vs external drags:

```typescript
dragMimeTypes = [
    'application/vnd.code.tree.shortcutsphysical',
    'application/vnd.code.tree.shortcutslogical',
    'text/uri-list'
];

dropMimeTypes = [
    'application/vnd.code.tree.shortcutsphysical',
    'application/vnd.code.tree.shortcutslogical',
    'text/uri-list'
];
```

**Priority in handleDrop():**
1. Check if dropping on `LogicalGroupItem` → logical operations
2. Check for internal data → physical move
3. Check for `text/uri-list` → external copy

### Undo Mechanism

```typescript
interface MoveOperation {
    sourcePath: string;
    targetPath: string;
    timestamp: number;
}

private lastMoveOperation: MoveOperation | null = null;
```

- Only **one** operation can be undone at a time
- Only applies to **physical file moves**
- Undo uses `vscode.workspace.fs.rename()` to move back

---

## Testing

The extension includes comprehensive tests in `src/test/suite/drag-drop.test.ts` covering all documented scenarios:

### Core Functionality Tests
- ✅ Drag from internal tree items
- ✅ Drop external files onto logical group
- ✅ Drop external folders onto logical group
- ✅ Drop multiple files
- ✅ Drop onto nested logical groups
- ✅ Move items between groups
- ✅ Prevent duplication when moving within same group
- ✅ Handle physical file moves
- ✅ Undo functionality
- ✅ Prevent dropping files into themselves
- ✅ Skip duplicate items
- ✅ Handle external file drops

### Scenario-Specific Tests
- ✅ **Scenario 1**: Physical move between folders in same logical group
- ✅ **Scenario 2**: Physical move between folders in different logical groups
- ✅ **Scenario 3a**: LogicalGroupChildItem to physical folder (creates stale config)
- ✅ **Scenario 3b**: Physical folder contents to logical subgroup (config add only)
- ✅ **Scenario 4**: Moving LogicalGroupChildItem between logical groups
- ✅ **Scenario 5**: Moving between sibling subgroups
- ✅ **Scenario 6**: External files from VS Code Explorer
- ✅ **Scenario 7**: Moving notes between groups

Run tests with:
```bash
npm test
```

All scenarios documented in this file have corresponding test coverage.

---

## Best Practices

### For Users

1. **Organize logically, not physically**: Use logical groups to organize shortcuts without moving files
2. **Understand the target**: Dropping on a folder = physical move, dropping on a group = logical change
3. **Use undo quickly**: Physical moves can only be undone within 1 minute
4. **Avoid Scenario 3a**: Don't move LogicalGroupChildItems to physical folders (creates stale config)
5. **Use Scenario 4 instead**: Move items between logical groups to reorganize without filesystem changes

### For Developers

1. **Test both paths**: Always test both physical and logical operations
2. **Check item types**: Use `instanceof` to determine item type before operations
3. **Update configuration atomically**: Use ConfigurationManager methods, don't edit YAML directly
4. **Consider undo**: Only physical operations support undo; inform users accordingly
5. **Handle edge cases**: Check for overwrite, self-moves, and permission errors

---

## Future Improvements

Potential enhancements to drag-drop behavior:

1. **Auto-update configuration** when LogicalGroupChildItem is physically moved (Scenario 3a)
2. **Undo for configuration changes** using configuration history
3. **Batch undo** for multiple operations
4. **Conflict resolution UI** for overwrite scenarios
5. **Drag-to-reorder** items within groups
6. **Cross-workspace moves** with base path alias support
7. **Progress indicators** for large file moves
8. **Confirmation prompts** for destructive physical moves

---

## Related Documentation

- **Testing**: See `docs/INTEGRATION_TESTS.md`
- **Configuration**: See `CLAUDE.md` for configuration structure
- **Tree Items**: See `src/shortcuts/tree-items.ts` for item definitions
- **Commands**: See `src/shortcuts/commands.ts` for related commands
