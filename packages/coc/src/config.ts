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
import yaml from 'js-yaml';
import { FileProcessStore, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { validateConfigWithSchema } from './config/schema';
import {
    CONFIG_NAMESPACE_SOURCE_KEYS,
    getNamespaceFieldSource,
    mergeConfigNamespaces,
} from './config/namespace-registry';

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
    /** How compact to render tool calls in conversation views: 0=full, 1=compact, 2=minimal, 3=whisper */
    toolCompactness?: 0 | 1 | 2 | 3;
    /** Density of task cards in the activity tab: 'compact' (default) or 'dense' (single-line) */
    taskCardDensity?: 'compact' | 'dense';
    /** Absorb single-line messages between same-category tool groups (default: true) */
    groupSingleLineMessages?: boolean;
    /** Chat settings */
    chat?: {
        followUpSuggestions?: {
            enabled?: boolean;
            count?: number;
        };
        askUser?: {
            enabled?: boolean;
        };
    };
    /** Serve command defaults */
    serve?: {
        port?: number;
        host?: string;
        dataDir?: string;
        theme?: 'auto' | 'light' | 'dark';
        /** Custom display name shown in the dashboard title bar (default: shortened os.hostname()) */
        serverName?: string;
    };
    /** Queue defaults */
    queue?: {
        historyLimit?: number;
        restartPolicy?: 'fail' | 'requeue' | 'requeue-if-retriable';
        restartPickupDelayMs?: number;
    };
    /** Models whitelist configuration */
    models?: {
        enabled?: string[];
    };
    /** Logging configuration */
    logging?: LoggingConfig;
    /** Terminal configuration */
    terminal?: {
        enabled?: boolean;
    };
    /** Notes configuration */
    notes?: {
        enabled?: boolean;
    };
    /** My Work configuration */
    myWork?: {
        enabled?: boolean;
    };
    /** My Life configuration */
    myLife?: {
        enabled?: boolean;
    };
    /** Scratchpad configuration */
    scratchpad?: {
        enabled?: boolean;
        layout?: 'horizontal' | 'vertical';
    };
    /** Workflows configuration */
    workflows?: {
        enabled?: boolean;
    };
    /** Pull Requests configuration */
    pullRequests?: {
        enabled?: boolean;
    };
    /** Servers configuration (multi-server connection manager). */
    servers?: {
        enabled?: boolean;
    };
    /** Ralph mode configuration (autonomous iterative coding loop). Disabled by default. */
    ralph?: {
        enabled?: boolean;
    };
    /** Loops/recurring follow-up subsystem configuration. Disabled by default. */
    loops?: {
        enabled?: boolean;
    };
    /** MCP OAuth support (auto-detect mcp.oauth_required events). Disabled by default. */
    mcpOauth?: {
        enabled?: boolean;
    };
    /** Vim-style navigation configuration (hjkl pane focus, j/k message stepping). Disabled by default. */
    vimNavigation?: {
        enabled?: boolean;
    };
    /** Development feature flags. */
    features?: {
        autoMemoryPromotion?: boolean;
        focusedDiff?: boolean;
    };
    /** Memory promotion configuration */
    memoryPromotion?: {
        batchSize?: number;
        timeoutMs?: number;
        model?: string;
        aiNormalization?: {
            enabled?: boolean;
            timeoutMs?: number;
            model?: string;
        };
    };
    /** Process store configuration */
    store?: {
        backend?: 'file' | 'sqlite';
    };
    /** Monitoring configuration */
    monitoring?: {
        heapCheck?: {
            enabled?: boolean;
            intervalMs?: number;
            warnThreshold?: number;
            criticalThreshold?: number;
        };
    };
    /** Skills configuration */
    skills?: {
        /** Auto-update globally-installed bundled skills on serve startup (default: true) */
        autoUpdate?: boolean;
        /** Bundled skills to auto-install on first serve startup if not already present */
        defaultSkills?: string[];
    };
}

// ============================================================================
// Logging Types
// ============================================================================

/** Per-store logging overrides */
export interface LoggingStoreConfig {
    level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
    file?: boolean;
}

/** Logging section of the config file */
export interface LoggingConfig {
    level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
    /** Log file directory, default '~/.coc/logs' */
    dir?: string;
    /** 'auto' = true if TTY, true/false to force */
    pretty?: 'auto' | boolean;
    stores?: {
        [store: string]: LoggingStoreConfig | undefined;
    };
}

/** Fully resolved logging configuration with defaults applied */
export interface ResolvedLoggingConfig {
    /** Effective log level */
    level: string;
    /** Log file directory. No file logging when undefined. */
    dir?: string;
    /** Pretty mode: 'auto' means use TTY detection at logger creation time */
    pretty: 'auto' | boolean;
    /** Per-store level/file overrides */
    stores: {
        [store: string]: LoggingStoreConfig | undefined;
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
    toolCompactness: 0 | 1 | 2 | 3;
    taskCardDensity: 'compact' | 'dense';
    groupSingleLineMessages: boolean;
    chat: {
        followUpSuggestions: {
            enabled: boolean;
            count: number;
        };
        askUser: {
            enabled: boolean;
        };
    };
    serve?: {
        port: number;
        host: string;
        dataDir: string;
        theme: 'auto' | 'light' | 'dark';
        serverName?: string;
    };
    queue?: {
        historyLimit?: number;
        restartPolicy?: 'fail' | 'requeue' | 'requeue-if-retriable';
        restartPickupDelayMs?: number;
    };
    /** Models whitelist — list of enabled model IDs */
    models?: {
        enabled?: string[];
    };
    /** Logging config passed through from file (not fully resolved — use resolveLoggingConfig) */
    logging?: LoggingConfig;
    /** Terminal configuration */
    terminal: {
        enabled: boolean;
    };
    /** Notes configuration */
    notes: {
        enabled: boolean;
    };
    /** My Work configuration */
    myWork: {
        enabled: boolean;
    };
    /** My Life configuration */
    myLife: {
        enabled: boolean;
    };
    /** Scratchpad configuration */
    scratchpad: {
        enabled: boolean;
        layout: 'horizontal' | 'vertical';
    };
    /** Workflows configuration */
    workflows: {
        enabled: boolean;
    };
    /** Pull Requests configuration */
    pullRequests: {
        enabled: boolean;
    };
    /** Servers configuration (multi-server connection manager). */
    servers: {
        enabled: boolean;
    };
    /** Ralph orchestration mode configuration. */
    ralph: {
        enabled: boolean;
    };
    /** Loops/recurring follow-up subsystem configuration. */
    loops: {
        enabled: boolean;
    };
    /** MCP OAuth subsystem configuration. */
    mcpOauth: {
        enabled: boolean;
    };
    /** Vim-style navigation configuration. */
    vimNavigation: {
        enabled: boolean;
    };
    /** Development feature flags. */
    features: {
        autoMemoryPromotion: boolean;
        focusedDiff: boolean;
    };
    /** Memory promotion configuration */
    memoryPromotion: {
        batchSize: number;
        timeoutMs: number;
        model?: string;
        aiNormalization: {
            enabled: boolean;
            timeoutMs: number;
            model?: string;
        };
    };
    /** Process store configuration */
    store: {
        backend: 'file' | 'sqlite';
    };
    /** Monitoring configuration */
    monitoring: {
        heapCheck: {
            enabled: boolean;
            intervalMs: number;
            warnThreshold: number;
            criticalThreshold: number;
        };
    };
    /** Skills configuration */
    skills: {
        /** Auto-update globally-installed bundled skills on serve startup */
        autoUpdate: boolean;
        /** Bundled skills to auto-install on first serve startup if not already present */
        defaultSkills: string[];
    };
}

// ============================================================================
// Constants
// ============================================================================

/** CoC directory name under home */
export const COC_DIR = '.coc';

/** Default configuration file name (within COC_DIR) */
export const CONFIG_FILE_NAME = 'config.yaml';

/**
 * Bundled skills that `coc serve` auto-installs into `~/.coc/skills/` on first
 * startup when they are not already present. Single source of truth — referenced
 * by `DEFAULT_CONFIG` and the `resolveConfig` fallback.
 */
export const DEFAULT_BUNDLED_SKILLS: readonly string[] = [
    'rethink',
    'kb-refresh',
    'fresh-written',
    'terse-replies',
    'for-each',
    'map-reduce',
    'grill-me',
];

/** Default configuration values */
export const DEFAULT_CONFIG: ResolvedCLIConfig = {
    parallel: 5,
    output: 'table',
    approvePermissions: false,
    persist: true,
    showReportIntent: false,
    toolCompactness: 3,
    taskCardDensity: 'dense',
    groupSingleLineMessages: true,
    chat: {
        followUpSuggestions: {
            enabled: true,
            count: 3,
        },
        askUser: {
            enabled: false,
        },
    },
    serve: {
        port: 4000,
        host: '127.0.0.1',
        dataDir: '~/.coc',
        theme: 'auto',
    },
    terminal: {
        enabled: true,
    },
    notes: {
        enabled: true,
    },
    myWork: {
        enabled: false,
    },
    myLife: {
        enabled: false,
    },
    scratchpad: {
        enabled: false,
        layout: 'vertical',
    },
    workflows: {
        enabled: false,
    },
    pullRequests: {
        enabled: false,
    },
    servers: {
        enabled: false,
    },
    ralph: {
        enabled: false,
    },
    loops: {
        enabled: false,
    },
    mcpOauth: {
        enabled: false,
    },
    vimNavigation: {
        enabled: false,
    },
    features: {
        autoMemoryPromotion: false,
        focusedDiff: false,
    },
    memoryPromotion: {
        batchSize: 50,
        timeoutMs: 90_000,
        model: undefined,
        aiNormalization: {
            enabled: false,
            timeoutMs: 60_000,
            model: undefined,
        },
    },
    store: {
        backend: 'sqlite',
    },
    monitoring: {
        heapCheck: {
            enabled: true,
            intervalMs: 30000,
            warnThreshold: 70,
            criticalThreshold: 85,
        },
    },
    skills: {
        autoUpdate: true,
        defaultSkills: [...DEFAULT_BUNDLED_SKILLS],
    },
};

/**
 * Source indicator for each config field
 */
export type ConfigFieldSource = 'default' | 'file';

const TOP_LEVEL_CONFIG_SOURCE_KEYS = [
    'model', 'parallel', 'output', 'approvePermissions', 'mcpConfig',
    'timeout', 'persist', 'showReportIntent', 'toolCompactness', 'taskCardDensity', 'groupSingleLineMessages',
] as const;

/**
 * All tracked config field keys (flat, with dot notation for nested fields)
 */
export const CONFIG_SOURCE_KEYS = [
    ...TOP_LEVEL_CONFIG_SOURCE_KEYS,
    ...CONFIG_NAMESPACE_SOURCE_KEYS,
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
    return validateConfigWithSchema(config) as CLIConfig;
}

/**
 * Write a CLIConfig to disk using atomic write (write-then-rename).
 * Creates parent directory if it does not exist.
 */
export function writeConfigFile(configPath: string, config: CLIConfig): void {
    const dir = path.dirname(configPath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = configPath + '.tmp';
    fs.writeFileSync(tmpPath, yaml.dump(config, { lineWidth: -1 }), 'utf-8');
    fs.renameSync(tmpPath, configPath);
}

/**
 * Resolve CLI configuration by merging config file with defaults.
 * Command-line options should be applied on top of the result.
 *
 * @param configPath - Optional path to the config file.
 * @param preloaded  - Optional pre-loaded config (skips file I/O when provided).
 */
export function resolveConfig(configPath?: string, preloaded?: CLIConfig): ResolvedCLIConfig {
    const fileConfig = preloaded ?? loadConfigFile(configPath);
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
        toolCompactness: (override.toolCompactness ?? base.toolCompactness) as 0 | 1 | 2 | 3,
        taskCardDensity: (override.taskCardDensity ?? base.taskCardDensity) as 'compact' | 'dense',
        groupSingleLineMessages: override.groupSingleLineMessages ?? base.groupSingleLineMessages,
        ...mergeConfigNamespaces(base, override, DEFAULT_BUNDLED_SKILLS),
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

    const namespaceSource = getNamespaceFieldSource(key, fileConfig);
    if (namespaceSource) {
        return namespaceSource;
    }

    return (fileConfig as Record<string, unknown>)[key] !== undefined ? 'file' : 'default';
}

// ============================================================================
// Logging Config Resolution
// ============================================================================

/**
 * Resolve logging configuration by merging CLI flags with config file values and defaults.
 *
 * Precedence: CLI flag > config file logging section > defaults
 *
 * @param cliFlags - CLI flag values (--log-level, --log-dir, --verbose)
 * @param loggingConfig - The `logging:` section from the loaded config file
 */
export function resolveLoggingConfig(
    cliFlags: { logLevel?: string; logDir?: string; verbose?: boolean },
    loggingConfig?: LoggingConfig
): ResolvedLoggingConfig {
    const fileLevel = loggingConfig?.level;
    const level = cliFlags.verbose ? 'debug' : (cliFlags.logLevel ?? fileLevel ?? 'info');
    const dir = cliFlags.logDir ?? loggingConfig?.dir;
    const pretty = loggingConfig?.pretty ?? 'auto';
    const stores = loggingConfig?.stores ?? {};
    return { level, dir, pretty, stores };
}

// ============================================================================
// Process Store Factory
// ============================================================================

/**
 * Create a process store based on the configured backend.
 * Defaults to SQLite when no backend is specified.
 */
export function createProcessStore(
    dataDir: string,
    backend?: 'file' | 'sqlite',
): FileProcessStore | SqliteProcessStore {
    const resolved = backend ?? 'sqlite';
    return resolved === 'sqlite'
        ? new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') })
        : new FileProcessStore({ dataDir });
}
