/**
 * One-time seeding of a workspace's language-server configuration.
 *
 * A workspace with no `language-servers.json` has never been configured, so
 * there is nothing for the user to lose: detection picks the presets the repo's
 * own files call for and writes them enabled. Once the file exists the user's
 * toggles are the only thing that matters — detection never runs again, so
 * a server the user turned off stays off.
 *
 * An unparseable file is deliberately not seeded: it means a configuration
 * exists and needs fixing, and overwriting it would throw away the user's edit.
 */

import { detectWorkspaceLanguages } from './detection';
import { builtInLanguageServerDefinitions } from './presets';
import type { LanguageServerConfig, LanguageServerConfigReadResult } from './repository';
import { readLanguageServerConfigWithStatus, writeLanguageServerConfig } from './repository';
import type { LanguageServerDefinition } from './types';

export interface SeedLanguageServerConfigOptions {
    /** Override detection, for tests. Defaults to `detectWorkspaceLanguages`. */
    detect?: (workspaceRoot: string) => string[];
    /** Presets the detected ids are resolved against. Defaults to the built-ins. */
    definitions?: LanguageServerDefinition[];
}

/**
 * Read the workspace config, seeding it from detection when the file is absent.
 *
 * The result is what a plain read would return afterwards, so callers can treat
 * a seeded workspace exactly like a manually configured one.
 */
export function ensureLanguageServerConfigSeeded(
    dataDir: string,
    workspaceId: string,
    workspaceRoot: string,
    options: SeedLanguageServerConfigOptions = {},
): LanguageServerConfigReadResult {
    const read = readLanguageServerConfigWithStatus(dataDir, workspaceId);
    if (read.status !== 'missing' || !workspaceRoot) {
        return read;
    }
    try {
        const config = seededConfig(workspaceRoot, options);
        const result = writeLanguageServerConfig(dataDir, workspaceId, config);
        if (!result.ok) {
            return read;
        }
        return { value: result.config, status: 'ok', warnings: [] };
    } catch {
        // Detection walks the workspace and the write touches disk; neither is
        // worth failing a settings read over. The next read tries again.
        return read;
    }
}

/**
 * Detected presets as enabled overrides. Nothing detected still yields a
 * config — the disabled default — so the scan runs at most once per workspace.
 *
 * Overrides carry the whole preset, matching what the settings page writes when
 * a user ticks a checkbox, so a seeded file is indistinguishable from a manual one.
 */
function seededConfig(
    workspaceRoot: string,
    options: SeedLanguageServerConfigOptions,
): LanguageServerConfig {
    const detect = options.detect ?? ((root: string) => detectWorkspaceLanguages(root));
    const detected = new Set(detect(workspaceRoot));
    const presets = options.definitions ?? builtInLanguageServerDefinitions();
    const definitions = presets
        .filter((preset) => detected.has(preset.id))
        .map((preset) => ({ ...preset, enabled: true }));
    return { enabled: definitions.length > 0, definitions };
}
