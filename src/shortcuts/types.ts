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
 * Main configuration structure for shortcuts
 */
export interface ShortcutsConfig {
    /** Array of shortcut configurations */
    shortcuts: ShortcutConfig[];
}

/**
 * Default empty configuration structure
 */
export const DEFAULT_SHORTCUTS_CONFIG: ShortcutsConfig = {
    shortcuts: []
};

/**
 * Configuration file name and path constants
 */
export const CONFIG_FILE_NAME = 'shortcuts.yaml';
export const CONFIG_DIRECTORY = '.vscode';