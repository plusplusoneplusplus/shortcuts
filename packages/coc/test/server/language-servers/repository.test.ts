/**
 * Workspace-scoped persistence of language-server configuration: isolation
 * between workspaces, recovery from corrupt files, rejection of invalid
 * definitions, and resolution of the definitions a workspace may start.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getRepoDataPath } from '../../../src/server/paths';
import {
    LANGUAGE_SERVERS_FILE_NAME,
    getLanguageServerConfigPath,
    onLanguageServerConfigChanged,
    readLanguageServerConfig,
    readLanguageServerConfigWithStatus,
    resolveLanguageServerDefinitions,
    writeLanguageServerConfig,
} from '../../../src/server/language-servers/repository';
import type { LanguageServerConfigChangedEvent } from '../../../src/server/language-servers/repository';
import type { LanguageServerDefinition } from '../../../src/server/language-servers/types';

function definition(overrides: Partial<LanguageServerDefinition> = {}): LanguageServerDefinition {
    return {
        id: 'fixture',
        displayName: 'Fixture Server',
        languageIds: ['fixture'],
        filePatterns: ['**/*.fixture'],
        command: 'fixture-language-server',
        args: ['--stdio'],
        rootMarkers: ['fixture.json'],
        ...overrides,
    };
}

let dataDir: string;

beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-lsp-repo-'));
});

afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('language server config location', () => {
    it('stores the file under the repo data path, not a new top-level directory', () => {
        const filePath = getLanguageServerConfigPath(dataDir, 'ws-1');
        expect(filePath).toBe(getRepoDataPath(dataDir, 'ws-1', LANGUAGE_SERVERS_FILE_NAME));
        expect(filePath.startsWith(dataDir)).toBe(true);
    });
});

describe('reading missing and corrupt configuration', () => {
    it('treats a missing file as language support never configured', () => {
        const result = readLanguageServerConfigWithStatus(dataDir, 'ws-1');
        expect(result.status).toBe('missing');
        expect(result.warnings).toEqual([]);
        expect(result.value).toEqual({ definitions: [] });
    });

    it('reports invalid JSON and uses built-in defaults', () => {
        const filePath = getLanguageServerConfigPath(dataDir, 'ws-1');
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, '{ not json', 'utf-8');

        const result = readLanguageServerConfigWithStatus(dataDir, 'ws-1');
        expect(result.status).toBe('invalid');
        expect(result.value).not.toHaveProperty('enabled');
        expect(result.warnings[0].kind).toBe('invalid-json');
        expect(result.warnings[0].filePath).toBe(filePath);
    });

    it('reports a non-object file shape', () => {
        const filePath = getLanguageServerConfigPath(dataDir, 'ws-1');
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, '[]', 'utf-8');

        const result = readLanguageServerConfigWithStatus(dataDir, 'ws-1');
        expect(result.status).toBe('invalid');
        expect(result.warnings[0].kind).toBe('invalid-shape');
    });

    it('keeps valid definitions when a sibling entry is invalid', () => {
        const filePath = getLanguageServerConfigPath(dataDir, 'ws-1');
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(
            filePath,
            JSON.stringify({
                definitions: [definition({ id: 'good' }), definition({ id: 'bad', command: 'sh -c "rm -rf /"' })],
            }),
            'utf-8',
        );

        const result = readLanguageServerConfigWithStatus(dataDir, 'ws-1');
        expect(result.status).toBe('ok');
        expect(result.value.definitions.map((d) => d.id)).toEqual(['good']);
        expect(result.warnings[0].kind).toBe('invalid-definition');
        expect(result.warnings[0].message).toContain('1.command');
    });

    it('does not treat a truthy non-boolean enabled value as enabled', () => {
        const filePath = getLanguageServerConfigPath(dataDir, 'ws-1');
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify({ enabled: 'yes' }), 'utf-8');

        expect(readLanguageServerConfig(dataDir, 'ws-1')).not.toHaveProperty('enabled');
    });
});

describe('writing configuration', () => {
    it('round-trips a custom definition for the intended workspace only', () => {
        const write = writeLanguageServerConfig(dataDir, 'ws-1', {
            definitions: [definition({ id: 'custom' })],
        });
        expect(write.ok).toBe(true);

        const reopened = readLanguageServerConfig(dataDir, 'ws-1');
        expect(reopened).not.toHaveProperty('enabled');
        expect(reopened.definitions.map((d) => d.id)).toEqual(['custom']);

        const other = readLanguageServerConfigWithStatus(dataDir, 'ws-2');
        expect(other.status).toBe('missing');
        expect(other.value.definitions).toEqual([]);
    });

    it('rejects an invalid definition and preserves the last valid configuration', () => {
        writeLanguageServerConfig(dataDir, 'ws-1', { definitions: [definition({ id: 'custom' })] });

        const write = writeLanguageServerConfig(dataDir, 'ws-1', {
            definitions: [definition({ id: 'Invalid Id' })],
        });
        expect(write.ok).toBe(false);
        if (!write.ok) {
            expect(write.errors[0].field).toBe('0.id');
        }

        const stored = readLanguageServerConfig(dataDir, 'ws-1');
        expect(stored.definitions.map((d) => d.id)).toEqual(['custom']);
    });

    it('rejects duplicate ids without writing', () => {
        const write = writeLanguageServerConfig(dataDir, 'ws-1', {
            definitions: [definition({ id: 'dup' }), definition({ id: 'dup' })],
        });
        expect(write.ok).toBe(false);
        expect(fs.existsSync(getLanguageServerConfigPath(dataDir, 'ws-1'))).toBe(false);
    });

    it('leaves no temporary file behind', () => {
        writeLanguageServerConfig(dataDir, 'ws-1', { definitions: [] });
        const dir = path.dirname(getLanguageServerConfigPath(dataDir, 'ws-1'));
        expect(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    });

    it('notifies listeners with the validated config and stops after unsubscribe', () => {
        const events: LanguageServerConfigChangedEvent[] = [];
        const unsubscribe = onLanguageServerConfigChanged((event) => events.push(event));

        writeLanguageServerConfig(dataDir, 'ws-1', { definitions: [definition()] });
        expect(events).toHaveLength(1);
        expect(events[0].workspaceId).toBe('ws-1');
        expect(events[0].config.definitions[0].id).toBe('fixture');

        writeLanguageServerConfig(dataDir, 'ws-1', { definitions: [definition({ id: 'Invalid Id' })] });
        expect(events).toHaveLength(1);

        unsubscribe();
        writeLanguageServerConfig(dataDir, 'ws-1', { definitions: [] });
        expect(events).toHaveLength(1);
    });

    it('survives a throwing listener', () => {
        const unsubscribe = onLanguageServerConfigChanged(() => {
            throw new Error('listener boom');
        });
        try {
            expect(writeLanguageServerConfig(dataDir, 'ws-1', { definitions: [] }).ok).toBe(true);
        } finally {
            unsubscribe();
        }
    });
});

describe('resolving available definitions', () => {
    const builtIns = ['typescript', 'rust', 'python', 'clangd', 'coc-symbols'];
    it('offers all built-ins for an unconfigured workspace without creating a config', () => {
        expect(resolveLanguageServerDefinitions(dataDir, 'new').map(d => d.id)).toEqual(builtIns);
        expect(fs.existsSync(getLanguageServerConfigPath(dataDir, 'new'))).toBe(false);
    });

    it('ignores stale flags while preserving custom settings and preset executable overrides', () => {
        const filePath = getLanguageServerConfigPath(dataDir, 'existing');
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const custom = definition({ settings: { fixture: { mode: 'strict' } }, initializationOptions: { project: 'sample' } });
        const config = { enabled: false, definitions: [
            { ...definition({ id: 'typescript', command: 'my-tsserver' }), enabled: false },
            { ...custom, enabled: false },
        ] };
        fs.writeFileSync(filePath, JSON.stringify(config));
        const resolved = resolveLanguageServerDefinitions(dataDir, 'existing');
        expect(resolved.map(d => d.id)).toEqual([...builtIns, 'fixture']);
        expect(resolved[0]).toMatchObject({ command: 'my-tsserver', builtIn: true });
        expect(resolved.at(-1)).toEqual(custom);
        expect(resolved.every(d => !('enabled' in d))).toBe(true);
        expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual(config);
        expect(writeLanguageServerConfig(dataDir, 'existing', readLanguageServerConfig(dataDir, 'existing')).ok).toBe(true);
        expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({ definitions: [
            definition({ id: 'typescript', command: 'my-tsserver' }), custom,
        ] });
    });
});
