/**
 * Memory Config Handler
 *
 * REST API handlers for reading/writing the memory storage configuration.
 * Config is persisted to <dataDir>/memory-config.json using atomic write-then-rename.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { sendJson, readJsonBody, send400, send500 } from '../router';

// ============================================================================
// Types
// ============================================================================

export type MemoryBackend = 'file' | 'sqlite' | 'vector';

export interface MemoryConfig {
    /** Directory where memory entries are stored. Defaults to ~/.coc/memory/ */
    storageDir: string;
    /** Storage backend type. */
    backend: MemoryBackend;
    /** Maximum number of entries to retain (oldest deleted first). */
    maxEntries: number;
    /** Time-to-live in days; entries older than this are pruned. 0 = no TTL. */
    ttlDays: number;
    /** Automatically inject relevant memories as context into AI prompts. */
    autoInject: boolean;
}

// ============================================================================
// Constants
// ============================================================================

export const MEMORY_CONFIG_FILE_NAME = 'memory-config.json';

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
    storageDir: path.join(os.homedir(), '.coc', 'memory'),
    backend: 'file',
    maxEntries: 10000,
    ttlDays: 90,
    autoInject: false,
};

// ============================================================================
// Persistence Helpers
// ============================================================================

/**
 * Read memory config from disk.
 * Falls back to defaults when the file doesn't exist or is invalid.
 */
export function readMemoryConfig(dataDir: string): MemoryConfig {
    const filePath = path.join(dataDir, MEMORY_CONFIG_FILE_NAME);
    try {
        if (!fs.existsSync(filePath)) {
            return { ...DEFAULT_MEMORY_CONFIG };
        }
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return validateMemoryConfig(parsed);
    } catch {
        return { ...DEFAULT_MEMORY_CONFIG };
    }
}

/**
 * Write memory config to disk atomically (write-then-rename pattern).
 * Creates the data directory if it doesn't exist.
 */
export function writeMemoryConfig(dataDir: string, config: MemoryConfig): void {
    fs.mkdirSync(dataDir, { recursive: true });
    const filePath = path.join(dataDir, MEMORY_CONFIG_FILE_NAME);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
}

/**
 * Validate and sanitize a raw config object. Falls back to defaults for missing/invalid fields.
 */
export function validateMemoryConfig(raw: unknown): MemoryConfig {
    const defaults = DEFAULT_MEMORY_CONFIG;
    if (typeof raw !== 'object' || raw === null) {
        return { ...defaults };
    }
    const obj = raw as Record<string, unknown>;
    const result: MemoryConfig = { ...defaults };

    if (typeof obj.storageDir === 'string' && obj.storageDir.length > 0) {
        // Expand ~ to home directory
        result.storageDir = obj.storageDir.startsWith('~')
            ? path.join(os.homedir(), obj.storageDir.slice(1))
            : obj.storageDir;
    }
    if (obj.backend === 'file' || obj.backend === 'sqlite' || obj.backend === 'vector') {
        result.backend = obj.backend;
    }
    if (typeof obj.maxEntries === 'number' && obj.maxEntries > 0) {
        result.maxEntries = Math.floor(obj.maxEntries);
    }
    if (typeof obj.ttlDays === 'number' && obj.ttlDays >= 0) {
        result.ttlDays = Math.floor(obj.ttlDays);
    }
    if (typeof obj.autoInject === 'boolean') {
        result.autoInject = obj.autoInject;
    }

    return result;
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * Handle GET /api/memory/config — return current memory configuration.
 */
export function handleGetMemoryConfig(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    dataDir: string,
): void {
    try {
        const config = readMemoryConfig(dataDir);
        sendJson(res, config);
    } catch (err) {
        send500(res, err instanceof Error ? err.message : String(err));
    }
}

/**
 * Handle PUT /api/memory/config — replace memory configuration.
 */
export async function handlePutMemoryConfig(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    dataDir: string,
): Promise<void> {
    try {
        const body = await readJsonBody(req);
        const config = validateMemoryConfig(body);
        writeMemoryConfig(dataDir, config);
        sendJson(res, config);
    } catch (err) {
        if (err instanceof Error && err.message.includes('Invalid JSON')) {
            send400(res, 'Invalid JSON');
        } else {
            send500(res, err instanceof Error ? err.message : String(err));
        }
    }
}
