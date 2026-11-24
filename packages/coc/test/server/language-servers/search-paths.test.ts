/**
 * Workspace executable search paths.
 *
 * Regression: a desktop-launched server inherits a PATH without per-user tool
 * folders such as `~/.cargo/bin`, so rust-analyzer and rustup report
 * "executable not found". Search paths must reach discovery, the server
 * process, and the tools that process runs itself.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LanguageServerManager } from '../../../src/server/language-servers/manager';
import { RUST_PRESET } from '../../../src/server/language-servers/presets';
import {
    readLanguageServerConfig,
    readLanguageServerConfigWithStatus,
    writeLanguageServerConfig,
    getLanguageServerConfigPath,
} from '../../../src/server/language-servers/repository';
import { resolveRustRuntime } from '../../../src/server/language-servers/rust-adapter';
import {
    MAX_SEARCH_PATHS,
    buildLanguageServerEnv,
    validateSearchPaths,
} from '../../../src/server/language-servers/search-paths';
import type { LanguageServerDefinition } from '../../../src/server/language-servers/types';
import { safeRm } from '../../helpers/safe-rm';

const FIXTURE_SERVER = path.join(__dirname, 'fixtures', 'echo-language-server.mjs');
const tempDirs: string[] = [];
const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
        await cleanup();
    }
    for (const dir of tempDirs.splice(0)) {
        await safeRm(dir);
    }
});

function tempDir(prefix: string): string {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    tempDirs.push(dir);
    return dir;
}

function writeScript(dir: string, name: string, body: string): string {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return file;
}

describe('validateSearchPaths', () => {
    it('accepts absolute folders and ~ on POSIX, trimming and dropping duplicates', () => {
        expect(validateSearchPaths(['  /opt/tools/bin ', '~/.cargo/bin', '~', '/opt/tools/bin'], { platform: 'linux' }))
            .toEqual({ searchPaths: ['/opt/tools/bin', '~/.cargo/bin', '~'], errors: [] });
    });

    it('rejects relative, empty, joined and control-character entries by index', () => {
        const { searchPaths, errors } = validateSearchPaths(
            ['bin', '', '/a:/b', '/ok', '/bad\nline', 42],
            { platform: 'darwin' },
        );
        expect(searchPaths).toEqual(['/ok']);
        expect(errors.map((e) => e.field)).toEqual(['0', '1', '2', '4', '5']);
        expect(errors[0].message).toMatch(/absolute/);
        expect(errors[2].message).toMatch(/one folder per entry/i);
    });

    it('applies Windows rules: drive letters are absolute, ";" joins folders', () => {
        expect(validateSearchPaths(['C:\\Users\\me\\.cargo\\bin', '~\\bin'], { platform: 'win32' }).errors).toEqual([]);
        const { errors } = validateSearchPaths(['C:\\a;C:\\b', 'relative\\bin', 'C:relative'], { platform: 'win32' });
        expect(errors.map((e) => e.field)).toEqual(['0', '1', '2']);
    });

    it('caps the number of entries and rejects a non-list', () => {
        const many = Array.from({ length: MAX_SEARCH_PATHS + 1 }, (_, i) => `/p${i}`);
        expect(validateSearchPaths(many, { platform: 'linux' }).errors[0]).toMatchObject({ field: '' });
        expect(validateSearchPaths('/a', { platform: 'linux' }).errors).toHaveLength(1);
    });
});

describe('buildLanguageServerEnv', () => {
    it('returns undefined when nothing is configured so the environment is inherited unchanged', () => {
        expect(buildLanguageServerEnv(undefined)).toBeUndefined();
        expect(buildLanguageServerEnv([])).toBeUndefined();
    });

    it('puts expanded search paths before the inherited PATH and keeps other variables', () => {
        const base = { PATH: '/usr/bin:/bin', HOME: '/home/me', CARGO_HOME: '/home/me/.cargo' };
        const env = buildLanguageServerEnv(['~/.cargo/bin', '/opt/bin'], { env: base, platform: 'linux', homeDir: '/home/me' });
        expect(env).toEqual({ ...base, PATH: '/home/me/.cargo/bin:/opt/bin:/usr/bin:/bin' });
        expect(base.PATH).toBe('/usr/bin:/bin');
    });

    it('works when the inherited environment has no PATH at all', () => {
        expect(buildLanguageServerEnv(['/opt/bin'], { env: {}, platform: 'darwin', homeDir: '/h' })).toEqual({ PATH: '/opt/bin' });
    });

    it('keeps the inherited Windows PATH key spelling and uses ";"', () => {
        const env = buildLanguageServerEnv(['~\\.cargo\\bin'], {
            env: { Path: 'C:\\Windows', SystemRoot: 'C:\\Windows' },
            platform: 'win32',
            homeDir: 'C:\\Users\\me',
        });
        expect(env).toEqual({ Path: 'C:\\Users\\me\\.cargo\\bin;C:\\Windows', SystemRoot: 'C:\\Windows' });
    });
});

describe('search paths in workspace config', () => {
    it('persists normalized paths and keeps the last valid config on an invalid write', () => {
        const dataDir = tempDir('coc-lsp-search-config-');
        expect(writeLanguageServerConfig(dataDir, 'ws', { definitions: [], searchPaths: [' ~/.cargo/bin '] }).ok).toBe(true);
        expect(readLanguageServerConfig(dataDir, 'ws').searchPaths).toEqual(['~/.cargo/bin']);

        const rejected = writeLanguageServerConfig(dataDir, 'ws', { definitions: [], searchPaths: ['relative'] });
        expect(rejected).toMatchObject({ ok: false, errors: [{ field: 'searchPaths.0' }] });
        expect(readLanguageServerConfig(dataDir, 'ws').searchPaths).toEqual(['~/.cargo/bin']);

        expect(writeLanguageServerConfig(dataDir, 'ws', { definitions: [], searchPaths: [] }).ok).toBe(true);
        expect(readLanguageServerConfig(dataDir, 'ws').searchPaths).toBeUndefined();
    });

    it('drops invalid stored entries with a warning', () => {
        const dataDir = tempDir('coc-lsp-search-warn-');
        const file = getLanguageServerConfigPath(dataDir, 'ws');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ definitions: [], searchPaths: ['relative', path.resolve('/opt/bin')] }));
        const read = readLanguageServerConfigWithStatus(dataDir, 'ws');
        expect(read.value.searchPaths).toEqual([path.resolve('/opt/bin')]);
        expect(read.warnings).toMatchObject([{ kind: 'invalid-search-path' }]);
    });
});

describe.skipIf(process.platform === 'win32')('runtime with a missing inherited PATH', () => {
    it('finds rustup through a search path and resolves the toolchain rust-analyzer', () => {
        const toolDir = tempDir('coc-lsp-cargo-bin-');
        const analyzer = path.join(toolDir, 'toolchain-rust-analyzer');
        writeScript(toolDir, 'rustup', `[ "$1 $2" = "which rust-analyzer" ] && echo "${analyzer}"`);
        const root = tempDir('coc-lsp-rust-root-');

        const without = resolveRustRuntime(RUST_PRESET, root, { env: buildLanguageServerEnv([], { env: {} }) ?? {} });
        expect(without.origin).toBe('unavailable');

        const runtime = resolveRustRuntime(RUST_PRESET, root, { env: buildLanguageServerEnv([toolDir], { env: {} }) });
        expect(runtime).toMatchObject({ command: analyzer, origin: 'rustup' });
    });

    it('spawns a bare-name server from a search path and gives its child tools the same PATH', async () => {
        const toolDir = tempDir('coc-lsp-tools-');
        writeScript(toolDir, 'fake-cargo', 'exit 0');
        // The server refuses to start unless it can find its own child tool on PATH.
        writeScript(toolDir, 'fake-ls', `command -v fake-cargo >/dev/null || exit 7\nexec "${process.execPath}" "${FIXTURE_SERVER}" "$@"`);
        const workspaceRoot = tempDir('coc-lsp-ws-');
        const dataDir = tempDir('coc-lsp-data-');
        const definition: LanguageServerDefinition = {
            id: 'fake',
            displayName: 'Fake',
            languageIds: ['plaintext'],
            filePatterns: ['**/*.txt'],
            command: 'fake-ls',
            args: [],
            rootMarkers: [],
        };
        expect(writeLanguageServerConfig(dataDir, 'ws', { definitions: [definition] }).ok).toBe(true);
        // The inherited environment has no PATH, like a GUI-launched app at worst.
        const manager = new LanguageServerManager({ dataDir, env: {}, startTimeoutMs: 10_000 });
        cleanups.push(() => manager.dispose());
        const request = { workspaceId: 'ws', workspaceRoot, editingSessionId: 'e1', relativePath: 'a.txt' };

        const first = manager.acquire(request);
        if (!first.ok) throw new Error(first.detail);
        await first.handle.session.start().catch(() => undefined);
        expect(first.handle.session.getState().status).toBe('unavailable');
        expect(first.handle.session.getState().detail).toContain('Executable not found: fake-ls');

        const closed: string[] = [];
        manager.onSessionClosed((event) => closed.push(event.reason));
        expect(writeLanguageServerConfig(dataDir, 'ws', { definitions: [definition], searchPaths: [toolDir] }).ok).toBe(true);
        await new Promise((resolve) => setImmediate(resolve));
        expect(closed).toContain('config-changed');

        const second = manager.acquire(request);
        if (!second.ok) throw new Error(second.detail);
        await second.handle.session.start();
        const state = second.handle.session.getState();
        expect(state.status).toBe('ready');
        expect(JSON.stringify(state)).not.toContain(toolDir);
    });
});
