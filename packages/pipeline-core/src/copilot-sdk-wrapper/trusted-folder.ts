/**
 * Trusted Folder Management
 *
 * Manages the `trusted_folders` list in `~/.copilot/config.json` to
 * programmatically bypass the interactive folder trust confirmation dialog
 * that the Copilot CLI shows when working in a new directory.
 *
 * The config directory is determined by `XDG_CONFIG_HOME` or defaults
 * to `~/.copilot`.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getLogger, LogCategory } from '../logger';

/** Config directory name under home */
const CONFIG_DIR = '.copilot';
/** Config file name */
const CONFIG_FILE = 'config.json';

/** Override for home directory (used for testing) */
let homeDirectoryOverride: string | null = null;

/**
 * Set an override for the home directory.
 * Primarily used for testing purposes.
 */
export function setTrustedFolderHomeOverride(dir: string | null): void {
    homeDirectoryOverride = dir;
}

/**
 * Get the Copilot config directory path.
 * When a home override is set (testing), always uses that.
 * Otherwise respects XDG_CONFIG_HOME if set, falling back to ~/.copilot.
 */
function getConfigDir(): string {
    if (homeDirectoryOverride !== null) {
        return path.join(homeDirectoryOverride, CONFIG_DIR);
    }
    return process.env['XDG_CONFIG_HOME'] ?? path.join(os.homedir(), CONFIG_DIR);
}

/**
 * Get the full path to the Copilot config file.
 */
export function getCopilotConfigPath(): string {
    return path.join(getConfigDir(), CONFIG_FILE);
}

/**
 * Read and parse the Copilot config file.
 * Returns an empty object if the file doesn't exist or is invalid.
 */
function readConfig(configPath: string): Record<string, unknown> {
    try {
        if (!fs.existsSync(configPath)) {
            return {};
        }
        const content = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(content);
        return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
        return {};
    }
}

/**
 * Write the config object back to disk.
 * Creates the directory if it doesn't exist.
 */
function writeConfig(configPath: string, config: Record<string, unknown>): void {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/**
 * Normalize a folder path for comparison and storage.
 * Resolves to absolute and removes trailing separators.
 */
function normalizeFolderPath(folder: string): string {
    let resolved = path.resolve(folder);
    // Remove trailing separator (but not root like "/" or "C:\")
    while (resolved.length > 1 && (resolved.endsWith(path.sep) || resolved.endsWith('/'))) {
        resolved = resolved.slice(0, -1);
    }
    return resolved;
}

/**
 * Check whether a folder is already trusted (present in trusted_folders).
 */
export function isFolderTrusted(folder: string): boolean {
    const configPath = getCopilotConfigPath();
    const config = readConfig(configPath);
    const trustedFolders = Array.isArray(config['trusted_folders']) ? config['trusted_folders'] as string[] : [];
    const normalized = normalizeFolderPath(folder);
    return trustedFolders.some(f => normalizeFolderPath(f) === normalized);
}

/**
 * Ensure a folder is registered as trusted in `~/.copilot/config.json`.
 *
 * If the folder is already in `trusted_folders`, this is a no-op.
 * Otherwise, the folder is appended to the list and the config file is
 * written back to disk.
 *
 * This prevents the Copilot CLI from showing the interactive
 * "Confirm folder trust" dialog when creating sessions for new directories.
 *
 * @param folder - The folder path to trust
 */
export function ensureFolderTrusted(folder: string): void {
    const logger = getLogger();
    const normalized = normalizeFolderPath(folder);
    const configPath = getCopilotConfigPath();

    try {
        const config = readConfig(configPath);
        const trustedFolders = Array.isArray(config['trusted_folders']) ? config['trusted_folders'] as string[] : [];

        // Check if already trusted
        if (trustedFolders.some(f => normalizeFolderPath(f) === normalized)) {
            logger.debug(LogCategory.AI, `TrustedFolder: '${normalized}' is already trusted`);
            return;
        }

        // Add and persist
        trustedFolders.push(normalized);
        config['trusted_folders'] = trustedFolders;
        writeConfig(configPath, config);
        logger.debug(LogCategory.AI, `TrustedFolder: Added '${normalized}' to trusted_folders`);
    } catch (error) {
        // Non-fatal: if we can't update config, the trust dialog will appear
        logger.debug(LogCategory.AI, `TrustedFolder: Failed to update config: ${error}`);
    }
}
