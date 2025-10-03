/**
 * Configuration interfaces and types for the shortcuts panel
 */

/**
 * Configuration for a base path alias (e.g., git root)
 */
export interface BasePath {
    /** Alias name used in path references (e.g., @myrepo) */
    alias: string;
    /** Actual filesystem path (can be relative to workspace or absolute) */
    path: string;
}

/**
 * Configuration for a logical group item (can be folder or file)
 */
export interface LogicalGroupItem {
    /** Relative or absolute path to the folder or file. Can use base path aliases like @alias/path/to/file */
    path: string;
    /** Display name for this item */
    name: string;
    /** Type of item: 'folder' or 'file' */
    type: 'folder' | 'file';
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
 * Main configuration structure for shortcuts
 */
export interface ShortcutsConfig {
    /** Base paths/aliases for organizing multiple git roots or common paths */
    basePaths?: BasePath[];
    /** Array of logical group configurations */
    logicalGroups: LogicalGroup[];
}

/**
 * Default empty configuration structure
 */
export const DEFAULT_SHORTCUTS_CONFIG: ShortcutsConfig = {
    logicalGroups: []
};

/**
 * Configuration file name and path constants
 */
export const CONFIG_FILE_NAME = 'shortcuts.yaml';
export const CONFIG_DIRECTORY = '.vscode';