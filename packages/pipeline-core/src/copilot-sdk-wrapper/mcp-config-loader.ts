/**
 * MCP Config Loader
 * 
 * Utility for loading MCP server configuration from the user's home directory.
 * The config file is located at ~/.copilot/mcp-config.json and follows the same
 * format used by the Copilot CLI.
 * 
 * Features:
 * - Cross-platform home directory resolution
 * - Graceful handling of missing files
 * - JSON parsing with error handling
 * - Config caching to avoid repeated file reads
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { MCPServerConfig } from './types';
import { getLogger, LogCategory } from '../logger';

/**
 * Structure of the MCP config file (~/.copilot/mcp-config.json)
 */
export interface MCPConfigFile {
    /** Map of server names to their configurations */
    mcpServers?: Record<string, MCPServerConfig>;
}

/**
 * Result of loading the MCP config
 */
export interface MCPConfigLoadResult {
    /** Whether the config was loaded successfully */
    success: boolean;
    /** The loaded MCP server configurations (empty object if not found or error) */
    mcpServers: Record<string, MCPServerConfig>;
    /** Path to the config file that was checked */
    configPath: string;
    /** Error message if loading failed */
    error?: string;
    /** Whether the config file exists */
    fileExists: boolean;
}

/** Default config file path relative to home directory */
const CONFIG_DIR = '.copilot';
const CONFIG_FILE = 'mcp-config.json';

/** Cached config to avoid repeated file reads */
let cachedConfig: MCPConfigLoadResult | null = null;

/** Override for home directory (used for testing) */
let homeDirectoryOverride: string | null = null;

/**
 * Set an override for the home directory.
 * This is primarily used for testing purposes.
 * 
 * @param dir - The directory to use as home, or null to use the system default
 */
export function setHomeDirectoryOverride(dir: string | null): void {
    homeDirectoryOverride = dir;
    // Clear cache when home directory changes
    cachedConfig = null;
}

/**
 * Get the user's home directory in a cross-platform manner.
 * If a home directory override is set (for testing), that is returned instead.
 * 
 * @returns The home directory path
 */
export function getHomeDirectory(): string {
    // Return override if set (for testing)
    if (homeDirectoryOverride !== null) {
        return homeDirectoryOverride;
    }
    // os.homedir() handles all platforms correctly:
    // - Windows: %USERPROFILE% or %HOMEDRIVE%%HOMEPATH%
    // - macOS/Linux: $HOME or from /etc/passwd
    return os.homedir();
}

/**
 * Get the path to the MCP config file.
 * 
 * @returns The full path to ~/.copilot/mcp-config.json
 */
export function getMcpConfigPath(): string {
    return path.join(getHomeDirectory(), CONFIG_DIR, CONFIG_FILE);
}

/**
 * Load MCP server configuration from the default config file.
 * Results are cached after the first successful load.
 * 
 * @param forceReload - If true, bypass the cache and reload from disk
 * @returns The load result with MCP server configurations
 */
export function loadDefaultMcpConfig(forceReload = false): MCPConfigLoadResult {
    const logger = getLogger();
    const configPath = getMcpConfigPath();

    // Return cached config if available and not forcing reload
    if (cachedConfig && !forceReload) {
        logger.debug(LogCategory.AI, 'MCPConfigLoader: Returning cached config');
        return cachedConfig;
    }

    logger.debug(LogCategory.AI, `MCPConfigLoader: Loading config from ${configPath}`);

    // Check if file exists
    if (!fs.existsSync(configPath)) {
        logger.debug(LogCategory.AI, 'MCPConfigLoader: Config file not found (this is normal if not configured)');
        cachedConfig = {
            success: true,
            mcpServers: {},
            configPath,
            fileExists: false
        };
        return cachedConfig;
    }

    try {
        // Read and parse the config file
        const content = fs.readFileSync(configPath, 'utf-8');
        const config: MCPConfigFile = JSON.parse(content);

        // Validate the structure
        const mcpServers = config.mcpServers || {};
        
        // Log what we found
        const serverCount = Object.keys(mcpServers).length;
        logger.debug(LogCategory.AI, `MCPConfigLoader: Loaded ${serverCount} MCP server(s) from config`);

        cachedConfig = {
            success: true,
            mcpServers,
            configPath,
            fileExists: true
        };
        return cachedConfig;

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(LogCategory.AI, `MCPConfigLoader: Failed to parse config file: ${errorMessage}`);

        cachedConfig = {
            success: false,
            mcpServers: {},
            configPath,
            fileExists: true,
            error: `Failed to parse MCP config: ${errorMessage}`
        };
        return cachedConfig;
    }
}

/**
 * Load MCP config asynchronously.
 * This is a convenience wrapper for async contexts.
 * 
 * @param forceReload - If true, bypass the cache and reload from disk
 * @returns Promise resolving to the load result
 */
export async function loadDefaultMcpConfigAsync(forceReload = false): Promise<MCPConfigLoadResult> {
    return loadDefaultMcpConfig(forceReload);
}

/**
 * Merge MCP server configurations.
 * Explicit configurations take precedence over default configurations.
 * 
 * @param defaultConfig - Default MCP servers from config file
 * @param explicitConfig - Explicit MCP servers passed in options
 * @returns Merged configuration with explicit taking precedence
 */
export function mergeMcpConfigs(
    defaultConfig: Record<string, MCPServerConfig>,
    explicitConfig?: Record<string, MCPServerConfig>
): Record<string, MCPServerConfig> {
    // If no explicit config, return default
    if (!explicitConfig) {
        return { ...defaultConfig };
    }

    // If explicit config is empty object, it means "disable all MCP servers"
    // This is a special case documented in the SDK
    if (Object.keys(explicitConfig).length === 0) {
        return {};
    }

    // Merge with explicit taking precedence
    return {
        ...defaultConfig,
        ...explicitConfig
    };
}

/**
 * Clear the cached MCP config.
 * Useful for testing or when the config file might have changed.
 */
export function clearMcpConfigCache(): void {
    const logger = getLogger();
    logger.debug(LogCategory.AI, 'MCPConfigLoader: Clearing config cache');
    cachedConfig = null;
}

/**
 * Check if an MCP config file exists at the default location.
 * 
 * @returns True if the config file exists
 */
export function mcpConfigExists(): boolean {
    return fs.existsSync(getMcpConfigPath());
}

/**
 * Get the cached config without loading from disk.
 * Returns null if no config has been loaded yet.
 * 
 * @returns The cached config or null
 */
export function getCachedMcpConfig(): MCPConfigLoadResult | null {
    return cachedConfig;
}
