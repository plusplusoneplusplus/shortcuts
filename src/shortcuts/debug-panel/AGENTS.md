# Debug Panel Module - Developer Reference

This module provides a debug panel tree view for development and testing purposes. It exposes internal extension commands and state for debugging.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    VSCode Tree View                             │
│              (Debug Panel in Side Bar)                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Renders
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Debug Panel Module                           │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │           DebugPanelTreeDataProvider                        ││
│  │  - Provides tree structure for debug commands               ││
│  │  - Categories: Configuration, Git, AI Service, etc.         ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              DebugCommandItem                               ││
│  │  - Tree item representing a debug command                   ││
│  │  - Clickable to execute the command                         ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              DebugCommands                                  ││
│  │  - Registers debug commands with VSCode                     ││
│  │  - Implements command handlers                              ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### DebugPanelTreeDataProvider

The tree data provider that supplies debug commands to the tree view.

```typescript
import { DebugPanelTreeDataProvider } from '../debug-panel';

// Create provider
const provider = new DebugPanelTreeDataProvider(context);

// Register with VSCode
vscode.window.createTreeView('workspaceShortcuts.debugPanel', {
    treeDataProvider: provider
});

// Refresh the tree
provider.refresh();
```

### DebugCommandItem

Represents a single debug command in the tree.

```typescript
import { DebugCommandItem } from '../debug-panel';

// Create a debug command item
const item = new DebugCommandItem(
    'Reload Configuration',
    'shortcuts.debug.reloadConfig',
    'Reload and parse the shortcuts configuration file'
);
```

### DebugCommands

Registers and handles debug commands.

```typescript
import { DebugCommands } from '../debug-panel';

// Register debug commands
const debugCommands = new DebugCommands(context, configManager, gitService);
debugCommands.register();
```

## Debug Command Categories

### Configuration Commands

- **Reload Configuration**: Force reload the `shortcuts.yaml` file
- **Show Raw Config**: Display the raw configuration in output panel
- **Validate Config**: Run configuration validation and show results
- **Reset to Defaults**: Reset configuration to default values

### Git Commands

- **Refresh Git Status**: Force refresh git status
- **Show Git State**: Display internal git state
- **Clear Git Cache**: Clear cached git information

### AI Service Commands

- **Show Process List**: Display all AI processes
- **Clear Completed Processes**: Remove completed/failed processes
- **Test Copilot Connection**: Verify Copilot CLI is available

### Tree View Commands

- **Refresh Tree**: Force refresh the shortcuts tree
- **Expand All**: Expand all tree nodes
- **Collapse All**: Collapse all tree nodes

## Usage Examples

### Example 1: Adding a New Debug Command

```typescript
// In debug-commands.ts
private registerCommands(): void {
    // ... existing commands ...
    
    // Add new debug command
    this.context.subscriptions.push(
        vscode.commands.registerCommand('shortcuts.debug.myCommand', async () => {
            // Command implementation
            const result = await this.someService.doSomething();
            vscode.window.showInformationMessage(`Result: ${result}`);
        })
    );
}
```

Then add to the tree provider:

```typescript
// In debug-panel-tree-provider.ts
private getDebugCommands(): DebugCommandItem[] {
    return [
        // ... existing items ...
        new DebugCommandItem(
            'My Debug Command',
            'shortcuts.debug.myCommand',
            'Description of what this does'
        )
    ];
}
```

### Example 2: Organizing Commands by Category

```typescript
private getChildren(element?: TreeItem): ProviderResult<TreeItem[]> {
    if (!element) {
        // Return categories
        return [
            new DebugCategoryItem('Configuration'),
            new DebugCategoryItem('Git'),
            new DebugCategoryItem('AI Service')
        ];
    }
    
    if (element instanceof DebugCategoryItem) {
        // Return commands for this category
        return this.getCommandsForCategory(element.label);
    }
    
    return [];
}
```

## Types

### DebugCommandItem Properties

```typescript
class DebugCommandItem extends vscode.TreeItem {
    /** Display label */
    label: string;
    /** VSCode command ID to execute */
    commandId: string;
    /** Description shown as tooltip */
    description?: string;
    /** Icon for the tree item */
    iconPath?: vscode.ThemeIcon;
}
```

## Best Practices

1. **Development only**: Consider hiding the debug panel in production builds.

2. **Clear descriptions**: Each command should have a clear description of what it does.

3. **Non-destructive defaults**: Debug commands should be safe to run accidentally.

4. **Output channel**: Use an output channel for verbose debug output rather than modal dialogs.

5. **Organize logically**: Group related commands into categories for easier navigation.

## Enabling/Disabling

The debug panel can be conditionally enabled:

```typescript
// In extension.ts
if (process.env.NODE_ENV === 'development' || config.get('enableDebugPanel')) {
    const debugPanel = new DebugPanelTreeDataProvider(context);
    // Register...
}
```

## See Also

- `src/extension.ts` - Extension entry point where debug panel is registered
- `src/shortcuts/configuration-manager.ts` - Configuration that debug commands inspect
