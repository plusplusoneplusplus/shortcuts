import * as yaml from 'js-yaml';
import {
    createSentinelBoardStorage,
    SENTINEL_CONFIG_TEMPLATE,
} from './sentinel-board';

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export interface SentinelConfig {
    tickIntervalMs: number;
    recencyWindowMs: number;
    muteProcessIds: string[];
    maxNudgesPerChat: number;
}

export const DEFAULT_SENTINEL_CONFIG: SentinelConfig = {
    tickIntervalMs: HOUR_MS,
    recencyWindowMs: 7 * DAY_MS,
    muteProcessIds: [],
    maxNudgesPerChat: 3,
};

function parseDuration(value: unknown, field: string): number {
    if (typeof value !== 'string') {
        throw new Error(`Sentinel ${field} must be a duration string`);
    }
    const match = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)$/.exec(value.trim());
    if (!match) {
        throw new Error(`Sentinel ${field} must use s, m, h, or d`);
    }
    const units = { s: SECOND_MS, m: MINUTE_MS, h: HOUR_MS, d: DAY_MS };
    const duration = Number(match[1]) * units[match[2] as keyof typeof units];
    if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error(`Sentinel ${field} must be positive`);
    }
    return duration;
}

export function parseSentinelConfig(content: string): SentinelConfig {
    const loaded = yaml.load(content);
    const value = loaded === undefined || loaded === null ? {} : loaded;
    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Sentinel.md must contain a YAML object');
    }
    const config = value as Record<string, unknown>;
    const tickIntervalMs = config.tickInterval === undefined
        ? DEFAULT_SENTINEL_CONFIG.tickIntervalMs
        : parseDuration(config.tickInterval, 'tickInterval');
    if (tickIntervalMs < 10 * SECOND_MS) {
        throw new Error('Sentinel tickInterval must be at least 10s');
    }
    const recencyWindowMs = config.recencyWindow === undefined
        ? DEFAULT_SENTINEL_CONFIG.recencyWindowMs
        : parseDuration(config.recencyWindow, 'recencyWindow');
    const muteProcessIds = config.mute === undefined
        ? []
        : Array.isArray(config.mute)
            && config.mute.every(item => typeof item === 'string' && item.length > 0)
            ? [...new Set(config.mute as string[])].sort()
            : undefined;
    if (!muteProcessIds) {
        throw new Error('Sentinel mute must be a list of process IDs');
    }
    const maxNudgesPerChat = config.maxNudgesPerChat === undefined
        ? DEFAULT_SENTINEL_CONFIG.maxNudgesPerChat
        : config.maxNudgesPerChat;
    if (!Number.isInteger(maxNudgesPerChat) || (maxNudgesPerChat as number) < 0) {
        throw new Error('Sentinel maxNudgesPerChat must be a non-negative integer');
    }
    return {
        tickIntervalMs,
        recencyWindowMs,
        muteProcessIds,
        maxNudgesPerChat: maxNudgesPerChat as number,
    };
}

export async function readSentinelConfig(
    dataDir: string,
    workspaceId: string,
): Promise<SentinelConfig> {
    const storage = createSentinelBoardStorage(dataDir, workspaceId);
    await storage.ensureConfig();
    return parseSentinelConfig(await storage.readConfig());
}

export { SENTINEL_CONFIG_TEMPLATE };
