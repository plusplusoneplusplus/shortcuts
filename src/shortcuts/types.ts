/**
 * Configuration interfaces and types for the shortcuts panel
 */

/**
 * Type of base path
 */
export type BasePathType = 'git' | 'workspace' | 'docs' | 'build' | 'config' | 'custom';

/**
 * Configuration for a base path alias (e.g., git root)
 */
export interface BasePath {
    /** Alias name used in path references (e.g., @myrepo) */
    alias: string;
    /** Actual filesystem path (can be relative to workspace or absolute) */
    path: string;
    /** Type of base path (e.g., 'git', 'workspace', 'project') */
    type?: BasePathType;
    /** Optional description of what this base path represents */
    description?: string;
}

/**
 * Type of logical group item
 */
export type LogicalGroupItemType = 'folder' | 'file' | 'command' | 'task' | 'note';

/**
 * Configuration for a logical group item (can be folder, file, command, task, or note)
 */
export interface LogicalGroupItem {
    /** Relative or absolute path to the folder or file. Can use base path aliases like @alias/path/to/file */
    path?: string;
    /** Display name for this item */
    name: string;
    /** Type of item: 'folder', 'file', 'command', 'task', or 'note' */
    type: LogicalGroupItemType;
    /** Command ID to execute (for command items) */
    command?: string;
    /** Task name to run (for task items) */
    task?: string;
    /** Note ID for storage reference (for note items) */
    noteId?: string;
    /** Optional arguments for command execution */
    args?: any[];
    /** Optional icon override */
    icon?: string;
}

/**
 * Configuration for a logical group
 */
export interface LogicalGroup {
    /** Group name/identifier */
    name: string;
    /** Optional description of the group */
    description?: string;
    /** Items in this logical group */
    items: LogicalGroupItem[];
    /** Optional nested groups within this group */
    groups?: LogicalGroup[];
    /** Optional icon for the group */
    icon?: string;
}

/**
 * VSCode sync provider configuration
 */
export interface VSCodeSyncConfig {
    enabled: boolean;
    scope: 'global' | 'workspace';
}

/**
 * Sync configuration for cloud providers
 */
export interface SyncConfig {
    /** Whether sync is enabled globally */
    enabled: boolean;
    /** Automatically sync on configuration changes */
    autoSync: boolean;
    /** Optional periodic sync interval in seconds */
    syncInterval?: number;
    /** Provider-specific configurations */
    providers: {
        vscodeSync?: VSCodeSyncConfig;
    };
}

/**
 * Configuration for a global note (not tied to any group)
 */
export interface GlobalNote {
    /** Display name for the note */
    name: string;
    /** Note ID for storage reference */
    noteId: string;
    /** Optional icon override */
    icon?: string;
}

/**
 * Main configuration structure for shortcuts
 */
export interface ShortcutsConfig {
    /** Base paths/aliases for organizing multiple git roots or common paths */
    basePaths?: BasePath[];
    /** Array of logical group configurations */
    logicalGroups: LogicalGroup[];
    /** Global notes that are not tied to any specific group */
    globalNotes?: GlobalNote[];
}

/**
 * Default configuration structure with Quick Actions group
 */
export const DEFAULT_SHORTCUTS_CONFIG: ShortcutsConfig = {
    logicalGroups: [
        {
            name: 'Quick Actions',
            description: 'Common VSCode commands for quick access',
            items: [
                {
                    name: 'Command Palette',
                    type: 'command',
                    command: 'workbench.action.showCommands',
                    icon: 'symbol-event'
                },
                {
                    name: 'Open Settings',
                    type: 'command',
                    command: 'workbench.action.openSettings',
                    icon: 'settings-gear'
                },
                {
                    name: 'Toggle Terminal',
                    type: 'command',
                    command: 'workbench.action.terminal.toggleTerminal',
                    icon: 'terminal'
                },
                {
                    name: 'Toggle Sidebar',
                    type: 'command',
                    command: 'workbench.action.toggleSidebarVisibility',
                    icon: 'layout-sidebar-left'
                },
                {
                    name: 'Quick Open Files',
                    type: 'command',
                    command: 'workbench.action.quickOpen',
                    icon: 'search'
                },
                {
                    name: 'Recent Files',
                    type: 'command',
                    command: 'workbench.action.openRecent',
                    icon: 'history'
                },
                {
                    name: 'Git: Commit',
                    type: 'command',
                    command: 'git.commit',
                    icon: 'source-control'
                },
                {
                    name: 'Format Document',
                    type: 'command',
                    command: 'editor.action.formatDocument',
                    icon: 'code'
                }
            ]
        }
    ]
};

/**
 * Configuration file name and path constants
 */
export const CONFIG_FILE_NAME = 'shortcuts.yaml';
export const CONFIG_DIRECTORY = '.vscode';