/**
 * Providers Config
 *
 * Read/write ~/.coc/providers.json for storing provider credentials.
 * Atomic write pattern: write to .tmp then rename (matches FileProcessStore pattern).
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface ProvidersFileConfig {
    providers: {
        github?: { token: string };
        ado?: { orgUrl: string };
    };
}

// ============================================================================
// Helpers
// ============================================================================

const PROVIDERS_FILE = 'providers.json';

// ============================================================================
// API
// ============================================================================

/**
 * Read providers config from <dataDir>/providers.json.
 * Returns empty config if the file is absent or unparseable.
 */
export async function readProvidersConfig(dataDir: string): Promise<ProvidersFileConfig> {
    const filePath = path.join(dataDir, PROVIDERS_FILE);
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        return JSON.parse(raw) as ProvidersFileConfig;
    } catch {
        return { providers: {} };
    }
}

/**
 * Atomically write providers config to <dataDir>/providers.json.
 * Writes to a .tmp file first, then renames to avoid partial writes.
 */
export async function writeProvidersConfig(
    config: ProvidersFileConfig,
    dataDir: string,
): Promise<void> {
    const filePath = path.join(dataDir, PROVIDERS_FILE);
    const tmpPath = filePath + '.tmp';
    await fs.writeFile(tmpPath, JSON.stringify(config, null, 2), 'utf8');
    await fs.rename(tmpPath, filePath);
}
