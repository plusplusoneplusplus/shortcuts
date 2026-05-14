/**
 * CoCContainer Configuration
 *
 * Resolves configuration from ~/.coccontainer/config.yaml with CLI overrides.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import yaml from 'js-yaml';

export interface ContainerConfig {
    serve?: {
        port?: number;
        host?: string;
        dataDir?: string;
    };
    /** Health check interval in milliseconds */
    healthCheckIntervalMs?: number;
    /** Base port for local tunnel bridge proxies (default: 10400) */
    tunnelBridgeBasePort?: number;
}

export interface ResolvedContainerConfig {
    serve: {
        port: number;
        host: string;
        dataDir: string;
    };
    healthCheckIntervalMs: number;
    tunnelBridgeBasePort: number;
}

const DEFAULT_DATA_DIR = path.join(os.homedir(), '.coccontainer');

const DEFAULTS: ResolvedContainerConfig = {
    serve: {
        port: 5000,
        host: 'localhost',
        dataDir: DEFAULT_DATA_DIR,
    },
    healthCheckIntervalMs: 30_000,
    tunnelBridgeBasePort: 10400,
};

export function getDefaultDataDir(): string {
    return DEFAULT_DATA_DIR;
}

/**
 * Resolve configuration by merging file config with defaults.
 */
export function resolveConfig(overrides?: Partial<ContainerConfig>): ResolvedContainerConfig {
    const fileConfig = loadConfigFile();
    return {
        serve: {
            port: overrides?.serve?.port ?? fileConfig.serve?.port ?? DEFAULTS.serve.port,
            host: overrides?.serve?.host ?? fileConfig.serve?.host ?? DEFAULTS.serve.host,
            dataDir: overrides?.serve?.dataDir ?? fileConfig.serve?.dataDir ?? DEFAULTS.serve.dataDir,
        },
        healthCheckIntervalMs: overrides?.healthCheckIntervalMs ?? fileConfig.healthCheckIntervalMs ?? DEFAULTS.healthCheckIntervalMs,
        tunnelBridgeBasePort: overrides?.tunnelBridgeBasePort ?? fileConfig.tunnelBridgeBasePort ?? DEFAULTS.tunnelBridgeBasePort,
    };
}

function loadConfigFile(): ContainerConfig {
    const configPath = path.join(DEFAULT_DATA_DIR, 'config.yaml');
    try {
        if (!fs.existsSync(configPath)) {
            return {};
        }
        const content = fs.readFileSync(configPath, 'utf8');
        return (yaml.load(content) as ContainerConfig) ?? {};
    } catch {
        return {};
    }
}

/**
 * Ensure the data directory exists.
 */
export function ensureDataDir(dataDir: string = DEFAULT_DATA_DIR): void {
    fs.mkdirSync(dataDir, { recursive: true });
}
