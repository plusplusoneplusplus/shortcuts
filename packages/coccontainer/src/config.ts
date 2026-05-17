/**
 * CoCContainer Configuration
 *
 * Resolves configuration from ~/.coccontainer/config.yaml with CLI overrides.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import yaml from 'js-yaml';

export interface WhatsAppConfig {
    /** Enable WhatsApp bridge (default: false) */
    enabled?: boolean;
    /** Directory for Baileys auth state (default: ~/.coccontainer/whatsapp-session) */
    sessionDir?: string;
    /** WA group JID for broadcast (optional) */
    groupJid?: string;
    /** Display name for container in WA messages (default: "CoC") */
    userName?: string;
    /** Agent ID to host global sessions (falls back to first online agent) */
    defaultAgentId?: string;
}

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
    /** Messaging integrations */
    messaging?: {
        whatsapp?: WhatsAppConfig;
    };
}

export interface ResolvedWhatsAppConfig {
    enabled: boolean;
    sessionDir: string;
    groupJid?: string;
    userName: string;
    defaultAgentId?: string;
}

export interface ResolvedContainerConfig {
    serve: {
        port: number;
        host: string;
        dataDir: string;
    };
    healthCheckIntervalMs: number;
    tunnelBridgeBasePort: number;
    messaging: {
        whatsapp: ResolvedWhatsAppConfig;
    };
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
    messaging: {
        whatsapp: {
            enabled: false,
            sessionDir: path.join(DEFAULT_DATA_DIR, 'whatsapp-session'),
            userName: 'CoC',
        },
    },
};

export function getDefaultDataDir(): string {
    return DEFAULT_DATA_DIR;
}

/**
 * Resolve configuration by merging file config with defaults.
 */
export function resolveConfig(overrides?: Partial<ContainerConfig>): ResolvedContainerConfig {
    const fileConfig = loadConfigFile();
    const waFile = fileConfig.messaging?.whatsapp;
    const waOver = overrides?.messaging?.whatsapp;
    return {
        serve: {
            port: overrides?.serve?.port ?? fileConfig.serve?.port ?? DEFAULTS.serve.port,
            host: overrides?.serve?.host ?? fileConfig.serve?.host ?? DEFAULTS.serve.host,
            dataDir: overrides?.serve?.dataDir ?? fileConfig.serve?.dataDir ?? DEFAULTS.serve.dataDir,
        },
        healthCheckIntervalMs: overrides?.healthCheckIntervalMs ?? fileConfig.healthCheckIntervalMs ?? DEFAULTS.healthCheckIntervalMs,
        tunnelBridgeBasePort: overrides?.tunnelBridgeBasePort ?? fileConfig.tunnelBridgeBasePort ?? DEFAULTS.tunnelBridgeBasePort,
        messaging: {
            whatsapp: {
                enabled: waOver?.enabled ?? waFile?.enabled ?? DEFAULTS.messaging.whatsapp.enabled,
                sessionDir: waOver?.sessionDir ?? waFile?.sessionDir ?? DEFAULTS.messaging.whatsapp.sessionDir,
                groupJid: waOver?.groupJid ?? waFile?.groupJid ?? DEFAULTS.messaging.whatsapp.groupJid,
                userName: waOver?.userName ?? waFile?.userName ?? DEFAULTS.messaging.whatsapp.userName,
                defaultAgentId: waOver?.defaultAgentId ?? waFile?.defaultAgentId ?? DEFAULTS.messaging.whatsapp.defaultAgentId,
            },
        },
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
