import * as fs from 'fs';
import * as path from 'path';
import { getRepoDataPath } from '../paths';
import { validateLanguageServerDefinitions } from './definition-schema';
import { mergeWithBuiltIns } from './presets';
import type { LanguageServerDefinition, LanguageServerDefinitionError } from './types';

/** Name of the language-server configuration file within a repo's data directory. */
export const LANGUAGE_SERVERS_FILE_NAME = 'language-servers.json';

/**
 * Per-workspace language-server configuration. Only configuration is persisted:
 * open buffers, diagnostics, and connections stay in memory.
 */
export interface LanguageServerConfig {
    /** Language support is opt-in per workspace and starts off. */
    enabled: boolean;
    /** Workspace definitions. An entry sharing a preset id overrides that preset. */
    definitions: LanguageServerDefinition[];
}

export type LanguageServerConfigReadStatus = 'ok' | 'missing' | 'invalid';

export interface LanguageServerConfigWarning {
    filePath: string;
    kind: 'invalid-json' | 'invalid-shape' | 'invalid-definition';
    message: string;
}

export interface LanguageServerConfigReadResult {
    value: LanguageServerConfig;
    status: LanguageServerConfigReadStatus;
    warnings: LanguageServerConfigWarning[];
}

export type LanguageServerConfigWriteResult =
    | { ok: true; config: LanguageServerConfig }
    | { ok: false; errors: LanguageServerDefinitionError[] };

export interface LanguageServerConfigChangedEvent {
    workspaceId: string;
    config: LanguageServerConfig;
}

const listeners = new Set<(event: LanguageServerConfigChangedEvent) => void>();

/**
 * Subscribe to configuration changes so a running session can be replaced.
 * Returns an unsubscribe function.
 */
export function onLanguageServerConfigChanged(
    listener: (event: LanguageServerConfigChangedEvent) => void,
): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function emitChanged(event: LanguageServerConfigChangedEvent): void {
    for (const listener of listeners) {
        try { listener(event); } catch { /* config listeners are non-fatal */ }
    }
}

function emptyConfig(): LanguageServerConfig {
    return { enabled: false, definitions: [] };
}

export function getLanguageServerConfigPath(dataDir: string, workspaceId: string): string {
    return getRepoDataPath(dataDir, workspaceId, LANGUAGE_SERVERS_FILE_NAME);
}

/**
 * A missing file is not a warning — it means language support was never
 * configured. A corrupt file yields the disabled default plus a warning, so a
 * bad edit can never start a server the user did not configure. Individual
 * invalid definitions are dropped with a warning while the valid ones survive.
 */
export function readLanguageServerConfigWithStatus(
    dataDir: string,
    workspaceId: string,
): LanguageServerConfigReadResult {
    const filePath = getLanguageServerConfigPath(dataDir, workspaceId);
    try {
        if (!fs.existsSync(filePath)) {
            return { value: emptyConfig(), status: 'missing', warnings: [] };
        }
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return invalidRead(filePath, 'invalid-shape', 'Language server config must contain a JSON object');
        }
        const obj = parsed as Record<string, unknown>;
        const warnings: LanguageServerConfigWarning[] = [];

        let definitions: LanguageServerDefinition[] = [];
        if (obj.definitions !== undefined) {
            const result = validateLanguageServerDefinitions(obj.definitions);
            definitions = result.definitions;
            for (const error of result.errors) {
                warnings.push({
                    filePath,
                    kind: 'invalid-definition',
                    message: error.field ? `${error.field}: ${error.message}` : error.message,
                });
            }
        }

        return {
            value: { enabled: obj.enabled === true, definitions },
            status: 'ok',
            warnings,
        };
    } catch (err) {
        return invalidRead(filePath, 'invalid-json', getErrorMessage(err));
    }
}

/** Returns the disabled default when the file is missing or unreadable. */
export function readLanguageServerConfig(dataDir: string, workspaceId: string): LanguageServerConfig {
    return readLanguageServerConfigWithStatus(dataDir, workspaceId).value;
}

/**
 * Validate and persist atomically (write-then-rename). Any field-level error
 * aborts the whole write, so the last valid configuration stays on disk.
 */
export function writeLanguageServerConfig(
    dataDir: string,
    workspaceId: string,
    config: LanguageServerConfig,
): LanguageServerConfigWriteResult {
    const { definitions, errors } = validateLanguageServerDefinitions(config.definitions ?? []);
    if (errors.length > 0) {
        return { ok: false, errors };
    }
    const validated: LanguageServerConfig = { enabled: config.enabled === true, definitions };
    const filePath = getLanguageServerConfigPath(dataDir, workspaceId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(validated, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
    emitChanged({ workspaceId, config: validated });
    return { ok: true, config: validated };
}

/**
 * The definitions a workspace may actually start: presets layered with
 * workspace overrides, filtered to enabled entries. A workspace with language
 * support turned off resolves to nothing, so no caller has to re-check the flag.
 */
export function resolveLanguageServerDefinitions(
    dataDir: string,
    workspaceId: string,
): LanguageServerDefinition[] {
    const config = readLanguageServerConfig(dataDir, workspaceId);
    if (!config.enabled) {
        return [];
    }
    return mergeWithBuiltIns(config.definitions).filter((definition) => definition.enabled === true);
}

function invalidRead(
    filePath: string,
    kind: LanguageServerConfigWarning['kind'],
    message: string,
): LanguageServerConfigReadResult {
    return {
        value: emptyConfig(),
        status: 'invalid',
        warnings: [{ filePath, kind, message }],
    };
}

function getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
