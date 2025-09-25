/**
 * Configuration interfaces and types for the shortcuts panel
 */

/**
 * Configuration for a single shortcut entry
 */
export interface ShortcutConfig {
    /** Relative or absolute path to the folder */
    path: string;
    /** Optional display name (defaults to folder name if not provided) */
    name?: string;
}

/**
 * Configuration for a logical group item (can be folder or file)
 */
export interface LogicalGroupItem {
    /** Relative or absolute path to the folder or file */
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
    /** Optional icon for the group */
    icon?: string;
}

/**
 * Main configuration structure for shortcuts
 */
export interface ShortcutsConfig {
    /** Array of physical shortcut configurations */
    shortcuts: ShortcutConfig[];
    /** Array of logical group configurations */
    logicalGroups?: LogicalGroup[];
}

/**
 * Default empty configuration structure
 */
export const DEFAULT_SHORTCUTS_CONFIG: ShortcutsConfig = {
    shortcuts: [],
    logicalGroups: []
};

/**
 * Configuration file name and path constants
 */
export const CONFIG_FILE_NAME = 'shortcuts.yaml';
export const CONFIG_DIRECTORY = '.vscode';