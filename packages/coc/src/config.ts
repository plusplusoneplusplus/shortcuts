/**
 * CLI Configuration
 *
 * Resolves CLI configuration from config files and environment variables.
 * Configuration file: ~/.coc/config.yaml
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { validateConfigWithSchema } from './config/schema';

// ============================================================================
// Types
// ============================================================================

/**
 * CLI configuration as stored in the config file
 */
export interface CLIConfig {
    /** Default AI model */
    model?: string;
    /** Default parallelism limit */
    parallel?: number;
    /** Default output format */
    output?: 'table' | 'json' | 'csv' | 'markdown';
    /** Auto-approve all AI permission requests */
    approvePermissions?: boolean;
    /** Path to MCP config file */
    mcpConfig?: string;
    /** Default timeout in seconds */
    timeout?: number;
    /** Save CLI run results to process store (default: true) */
    persist?: boolean;
    /** Show report_intent tool calls in conversation views (default: false) */
    showReportIntent?: boolean;
    /** Serve command defaults */
    serve?: {
        port?: number;
        host?: string;
        dataDir?: string;
        theme?: 'auto' | 'light' | 'dark';
    };
}

/**
 * Resolved CLI configuration with all defaults applied
 */
export interface ResolvedCLIConfig {
    model?: string;
    parallel: number;
    output: 'table' | 'json' | 'csv' | 'markdown';
    approvePermissions: boolean;
    mcpConfig?: string;
    timeout?: number;
    persist: boolean;
    showReportIntent: boolean;
    serve?: {
        port: number;
        host: string;
        dataDir: string;
        theme: 'auto' | 'light' | 'dark';
    };
}

// ============================================================================
// Constants
// ============================================================================

/** CoC directory name under home */
export const COC_DIR = '.coc';

/** Default configuration file name (within COC_DIR) */
export const CONFIG_FILE_NAME = 'config.yaml';

/** Default configuration values */
export const DEFAULT_CONFIG: ResolvedCLIConfig = {
    parallel: 5,
    output: 'table',
    approvePermissions: false,
    persist: true,
    showReportIntent: false,
    serve: {
        port: 4000,
        host: '0.0.0.0',
        dataDir: '~/.coc',
        theme: 'auto',
    },
};

/**
 * Source indicator for each config field
 */
export type ConfigFieldSource = 'default' | 'file';

/**
 * All tracked config field keys (flat, with dot notation for nested serve fields)
 */
export const CONFIG_SOURCE_KEYS = [
    'model', 'parallel', 'output', 'approvePermissions', 'mcpConfig',
    'timeout', 'persist', 'showReportIntent', 'serve.port', 'serve.host', 'serve.dataDir', 'serve.theme',
] as const;

export type ConfigSourceKey = typeof CONFIG_SOURCE_KEYS[number];

/**
 * Resolved config with per-field source indicators
 */
export interface AdminConfigWithSource {
    /** Fully resolved config with defaults applied */
    resolved: ResolvedCLIConfig;
    /** Per-field source indicator: 'default' or 'file' */
    sources: Record<ConfigSourceKey, ConfigFieldSource>;
    /** Canonical config file path */
    configFilePath: string;
}

// ============================================================================
// Config Resolution
// ============================================================================

/**
 * Get the path to the config file (~/.coc/config.yaml)
 */
export function getConfigFilePath(): string {
    return path.join(os.homedir(), COC_DIR, CONFIG_FILE_NAME);
}

/**
 * Load CLI configuration from the config file (~/.coc/config.yaml).
 * Returns undefined if the file doesn't exist or can't be parsed.
 * When no explicit configPath is provided, loads from ~/.coc/config.yaml.
 */
export function loadConfigFile(configPath?: string): CLIConfig | undefined {
    return loadConfigFromPath(configPath ?? getConfigFilePath());
}

/**
 * Load and parse a config file from a specific path.
 * Returns undefined if the file does not exist.
 * @throws {Error} if the file exists but contains invalid config
 */
function loadConfigFromPath(filePath: string): CLIConfig | undefined {
    if (!fs.existsSync(filePath)) {
        return undefined;
    }
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const yaml = require('js-yaml');
        const config = yaml.load(content);
        return validateConfig(config);
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('Invalid config file:')) {
            throw new Error(`Failed to load ${filePath}: ${error.message}`);
        }
        throw new Error(`Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Validate and sanitize a config object using Zod schema.
 * @throws {Error} if config is invalid with detailed error message
 */
function validateConfig(config: unknown): CLIConfig | undefined {
    if (typeof config !== 'object' || config === null) {
        return undefined;
    }
    return validateConfigWithSchema(config);
}

/**
 * Write a CLIConfig to disk using atomic write (write-then-rename).
 * Creates parent directory if it does not exist.
 */
export function writeConfigFile(configPath: string, config: CLIConfig): void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const yaml = require('js-yaml');
    const dir = path.dirname(configPath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = configPath + '.tmp';
    fs.writeFileSync(tmpPath, yaml.dump(config, { lineWidth: -1 }), 'utf-8');
    fs.renameSync(tmpPath, configPath);
}

/**
 * Resolve CLI configuration by merging config file with defaults.
 * Command-line options should be applied on top of the result.
 */
export function resolveConfig(configPath?: string): ResolvedCLIConfig {
    const fileConfig = loadConfigFile(configPath);
    return mergeConfig(DEFAULT_CONFIG, fileConfig);
}

/**
 * Merge a partial config on top of a base config
 */
export function mergeConfig(base: ResolvedCLIConfig, override?: CLIConfig): ResolvedCLIConfig {
    if (!override) {
        return { ...base };
    }

    return {
        model: override.model ?? base.model,
        parallel: override.parallel ?? base.parallel,
        output: override.output ?? base.output,
        approvePermissions: override.approvePermissions ?? base.approvePermissions,
        mcpConfig: override.mcpConfig ?? base.mcpConfig,
        timeout: override.timeout ?? base.timeout,
        persist: override.persist ?? base.persist,
        showReportIntent: override.showReportIntent ?? base.showReportIntent,
        serve: {
            port: override.serve?.port ?? base.serve?.port ?? 4000,
            host: override.serve?.host ?? base.serve?.host ?? '0.0.0.0',
            dataDir: override.serve?.dataDir ?? base.serve?.dataDir ?? '~/.coc',
            theme: override.serve?.theme ?? base.serve?.theme ?? 'auto',
        },
    };
}

/**
 * Get resolved config with per-field source indicators.
 * For each field, reports whether the value comes from the config file or defaults.
 */
export function getResolvedConfigWithSource(configPath?: string): AdminConfigWithSource {
    const fileConfig = loadConfigFile(configPath);
    const resolved = mergeConfig(DEFAULT_CONFIG, fileConfig);

    const sources = {} as Record<ConfigSourceKey, ConfigFieldSource>;
    for (const key of CONFIG_SOURCE_KEYS) {
        sources[key] = getFieldSource(key, fileConfig);
    }

    return {
        resolved,
        sources,
        configFilePath: getConfigFilePath(),
    };
}

/**
 * Determine whether a config field value comes from file or default
 */
function getFieldSource(key: ConfigSourceKey, fileConfig: CLIConfig | undefined): ConfigFieldSource {
    if (!fileConfig) {
        return 'default';
    }

    if (key.startsWith('serve.')) {
        const subKey = key.slice('serve.'.length) as keyof NonNullable<CLIConfig['serve']>;
        return fileConfig.serve?.[subKey] !== undefined ? 'file' : 'default';
    }

    return (fileConfig as Record<string, unknown>)[key] !== undefined ? 'file' : 'default';
}
