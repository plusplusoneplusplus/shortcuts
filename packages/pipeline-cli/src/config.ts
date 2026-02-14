/**
 * CLI Configuration
 *
 * Resolves CLI configuration from config files and environment variables.
 * Configuration file: ~/.pipeline-cli.yaml
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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

/** Default configuration file name */
export const CONFIG_FILE_NAME = '.pipeline-cli.yaml';

/** Default configuration values */
export const DEFAULT_CONFIG: ResolvedCLIConfig = {
    parallel: 5,
    output: 'table',
    approvePermissions: false,
    serve: {
        port: 4000,
        host: 'localhost',
        dataDir: '~/.pipeline-server',
        theme: 'auto',
    },
};

// ============================================================================
// Config Resolution
// ============================================================================

/**
 * Get the path to the config file
 */
export function getConfigFilePath(): string {
    return path.join(os.homedir(), CONFIG_FILE_NAME);
}

/**
 * Load CLI configuration from the config file
 * Returns undefined if the file doesn't exist or can't be parsed
 */
export function loadConfigFile(configPath?: string): CLIConfig | undefined {
    const filePath = configPath || getConfigFilePath();
    try {
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        // Use js-yaml for parsing
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const yaml = require('js-yaml');
        const config = yaml.load(content) as CLIConfig;
        return validateConfig(config);
    } catch {
        return undefined;
    }
}

/**
 * Validate and sanitize a config object
 */
function validateConfig(config: unknown): CLIConfig | undefined {
    if (typeof config !== 'object' || config === null) {
        return undefined;
    }

    const raw = config as Record<string, unknown>;
    const result: CLIConfig = {};

    if (typeof raw.model === 'string') {
        result.model = raw.model;
    }

    if (typeof raw.parallel === 'number' && raw.parallel > 0) {
        result.parallel = Math.floor(raw.parallel);
    }

    if (typeof raw.output === 'string' && ['table', 'json', 'csv', 'markdown'].includes(raw.output)) {
        result.output = raw.output as CLIConfig['output'];
    }

    if (typeof raw.approvePermissions === 'boolean') {
        result.approvePermissions = raw.approvePermissions;
    }

    if (typeof raw.mcpConfig === 'string') {
        result.mcpConfig = raw.mcpConfig;
    }

    if (typeof raw.timeout === 'number' && raw.timeout > 0) {
        result.timeout = raw.timeout;
    }

    // Validate serve sub-object
    if (typeof raw.serve === 'object' && raw.serve !== null) {
        const s = raw.serve as Record<string, unknown>;
        const serve: CLIConfig['serve'] = {};
        if (typeof s.port === 'number' && s.port > 0) {
            serve.port = Math.floor(s.port);
        }
        if (typeof s.host === 'string') {
            serve.host = s.host;
        }
        if (typeof s.dataDir === 'string') {
            serve.dataDir = s.dataDir;
        }
        if (typeof s.theme === 'string' && ['auto', 'light', 'dark'].includes(s.theme)) {
            serve.theme = s.theme as 'auto' | 'light' | 'dark';
        }
        if (Object.keys(serve).length > 0) {
            result.serve = serve;
        }
    }

    return result;
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
        serve: {
            port: override.serve?.port ?? base.serve?.port ?? 4000,
            host: override.serve?.host ?? base.serve?.host ?? 'localhost',
            dataDir: override.serve?.dataDir ?? base.serve?.dataDir ?? '~/.pipeline-server',
            theme: override.serve?.theme ?? base.serve?.theme ?? 'auto',
        },
    };
}
