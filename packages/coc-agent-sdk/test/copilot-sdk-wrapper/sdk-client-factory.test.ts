/**
 * Tests for sdk-client-factory.ts
 *
 * Verifies that createSdkClient() correctly handles working-directory
 * validation, folder-trust registration, and client instantiation.
 *
 * We mock the @github/copilot-sdk CopilotClient constructor so no real
 * CLI process is spawned.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';

// Suppress logger output during tests


// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/trusted-folder', () => ({
    ensureFolderTrusted: vi.fn(),
}));

vi.mock('../../src/internal/workspace-execution', () => ({
    resolveWorkspaceExecutionContext: vi.fn((cwd?: string) => cwd && (cwd.startsWith(String.raw`\\wsl$`) || cwd.startsWith('/home/tester/'))
        ? { kind: 'wsl', distro: 'Ubuntu', linuxWorkingDirectory: '/home/tester/repo', originalWorkingDirectory: cwd }
        : { kind: 'windows', workingDirectory: cwd }),
    translatePathForHostFilesystem: vi.fn((targetPath: string) => {
        if (targetPath.startsWith('/home/tester/')) {
            return String.raw`\\wsl$\Ubuntu` + targetPath.replace(/\//g, '\\');
        }
        return targetPath;
    }),
}));

vi.mock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs');
    return { ...actual, existsSync: vi.fn().mockReturnValue(true) };
});

const capturedOptions: any[] = [];
const mockClientInstance = { start: vi.fn(), stop: vi.fn(), createSession: vi.fn() };

class MockCopilotClient {
    constructor(options?: any) {
        capturedOptions.push(options);
        Object.assign(this, mockClientInstance);
    }
}

const mockRuntimeConnection = {
    forStdio: vi.fn((opts?: { path?: string; args?: readonly string[] }) => ({
        kind: 'stdio' as const,
        path: opts?.path,
        args: opts?.args,
    })),
};

vi.mock('../../src/sdk-esm-loader', () => ({
    getCachedCopilotSdk: () => ({ CopilotClient: MockCopilotClient, RuntimeConnection: mockRuntimeConnection }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
    createSdkClient,
    resetSystemNodePathCache,
    resolveElectronCopilotSpawn,
    buildElectronCopilotConnection,
    buildCopilotNativeConnection,
    findCopilotNativeCliPath,
    resolveCopilotCli,
    getLastCopilotElectronSpawn,
} from '../../src/sdk-client-factory';
import * as trustedFolder from '../../src/trusted-folder';
import * as fs from 'fs';
import * as workspaceExecution from '../../src/internal/workspace-execution';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSdkClient', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capturedOptions.length = 0;
        vi.mocked(fs.existsSync).mockReturnValue(true);
    });

    it('creates a client with no workingDirectory when called without options', () => {
        createSdkClient();

        expect(capturedOptions).toHaveLength(1);
        expect(capturedOptions[0].workingDirectory).toBeUndefined();
    });

    it('creates a client with no workingDirectory when workingDirectory is undefined', () => {
        createSdkClient({ workingDirectory: undefined });

        expect(capturedOptions).toHaveLength(1);
        expect(capturedOptions[0].workingDirectory).toBeUndefined();
    });

    it('passes workingDirectory to the CopilotClient constructor when provided', () => {
        createSdkClient({ workingDirectory: '/some/project' });

        expect(capturedOptions).toHaveLength(1);
        expect(capturedOptions[0].workingDirectory).toBe('/some/project');
    });

    it('calls ensureFolderTrusted with workingDirectory when provided', () => {
        createSdkClient({ workingDirectory: '/my/repo' });

        expect(trustedFolder.ensureFolderTrusted).toHaveBeenCalledOnce();
        expect(trustedFolder.ensureFolderTrusted).toHaveBeenCalledWith('/my/repo');
    });

    it('does NOT call ensureFolderTrusted when no workingDirectory is given', () => {
        createSdkClient();

        expect(trustedFolder.ensureFolderTrusted).not.toHaveBeenCalled();
    });

    it('still creates client successfully when ensureFolderTrusted throws', () => {
        vi.mocked(trustedFolder.ensureFolderTrusted).mockImplementation(() => {
            throw new Error('Permission denied');
        });

        const client = createSdkClient({ workingDirectory: '/protected/path' });

        expect(client).toBeDefined();
        expect(capturedOptions).toHaveLength(1);
        expect(capturedOptions[0].workingDirectory).toBe('/protected/path');
    });

    it('returns the created client instance', () => {
        const client = createSdkClient({ workingDirectory: '/project' });

        expect(typeof (client as any).start).toBe('function');
        expect(typeof (client as any).stop).toBe('function');
    });

    it('does NOT warn when workingDirectory exists', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        createSdkClient({ workingDirectory: '/existing/dir' });

        expect(fs.existsSync).toHaveBeenCalledWith('/existing/dir');
    });

    it('checks existsSync when workingDirectory is provided', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const client = createSdkClient({ workingDirectory: '/nonexistent/dir' });

        expect(client).toBeDefined();
        expect(fs.existsSync).toHaveBeenCalledWith('/nonexistent/dir');
    });

    it('does NOT validate a workingDirectory when none is given', () => {
        createSdkClient();

        // CLI-layout resolution probes node_modules paths; nothing else may be
        // stat'd when there is no workingDirectory to validate.
        const nonCliProbes = vi.mocked(fs.existsSync).mock.calls
            .map(([p]) => String(p))
            .filter((p) => !p.includes(path.join('node_modules', '@github')));
        expect(nonCliProbes).toEqual([]);
    });

    it('routes WSL working directories to the host filesystem for the Windows Copilot CLI', () => {
        const workingDirectory = String.raw`\\wsl$\Ubuntu\home\tester\repo`;
        createSdkClient({ workingDirectory });

        expect(workspaceExecution.resolveWorkspaceExecutionContext).toHaveBeenCalledWith(workingDirectory);
        expect(workspaceExecution.translatePathForHostFilesystem).toHaveBeenCalledWith(
            workingDirectory,
            expect.objectContaining({
                kind: 'wsl',
                linuxWorkingDirectory: '/home/tester/repo',
            }),
        );
        expect(capturedOptions[0].workingDirectory).toBe(workingDirectory);
        expect(capturedOptions[0].connection).toBeUndefined();
        expect(capturedOptions[0].env).toBeUndefined();
        expect(trustedFolder.ensureFolderTrusted).toHaveBeenCalledWith(workingDirectory);
        expect(fs.existsSync).toHaveBeenCalledWith(workingDirectory);
    });

    it('translates Linux-style WSL working directories to host UNC paths', () => {
        createSdkClient({ workingDirectory: '/home/tester/repo' });

        expect(workspaceExecution.translatePathForHostFilesystem).toHaveBeenCalledWith(
            '/home/tester/repo',
            expect.objectContaining({
                kind: 'wsl',
                linuxWorkingDirectory: '/home/tester/repo',
            }),
        );
        expect(capturedOptions[0].workingDirectory).toBe(String.raw`\\wsl$\Ubuntu\home\tester\repo`);
        expect(trustedFolder.ensureFolderTrusted).toHaveBeenCalledWith(String.raw`\\wsl$\Ubuntu\home\tester\repo`);
        expect(fs.existsSync).toHaveBeenCalledWith(String.raw`\\wsl$\Ubuntu\home\tester\repo`);
    });
});

// Path fragments used to distinguish the two CLI layouts in existsSync mocks.
const INDEX_JS_FRAGMENT = path.join('@github', 'copilot', 'index.js');
const NATIVE_PKG_FRAGMENT = path.join('@github', `copilot-${process.platform}-${process.arch}`);

/** existsSync mock: the >= 1.0.62 layout — no index.js, native binary present. */
function mockNativeOnlyLayout(): void {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
        const s = String(p);
        if (s.endsWith(INDEX_JS_FRAGMENT)) return false;
        if (s.includes(NATIVE_PKG_FRAGMENT)) return true;
        return true; // workingDirectory etc.
    });
}

describe('createSdkClient — Electron connection override', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capturedOptions.length = 0;
        vi.mocked(fs.existsSync).mockReturnValue(true);
        mockRuntimeConnection.forStdio.mockClear();
        resetSystemNodePathCache();
    });

    afterEach(() => {
        delete (process.versions as Record<string, string | undefined>).electron;
        resetSystemNodePathCache();
    });

    it('sets connection to use system node + copilot CLI when running under Electron', () => {
        (process.versions as Record<string, string | undefined>).electron = '30.0.0';

        createSdkClient({ workingDirectory: '/project' });

        expect(capturedOptions).toHaveLength(1);
        const conn = capturedOptions[0].connection;
        expect(conn).toBeDefined();
        expect(conn.kind).toBe('stdio');
        // The path must be an absolute path to the system node binary
        expect(path.isAbsolute(conn.path)).toBe(true);
        expect(conn.args).toHaveLength(1);
        expect(conn.args[0]).toContain(path.join('@github', 'copilot', 'index.js'));
        // Must set env without ELECTRON_RUN_AS_NODE
        expect(capturedOptions[0].env).toBeDefined();
        expect(capturedOptions[0].env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    });

    it('does NOT set connection when not running under Electron', () => {
        createSdkClient({ workingDirectory: '/project' });

        expect(capturedOptions[0].connection).toBeUndefined();
        expect(capturedOptions[0].env).toBeUndefined();
    });

    it('does NOT override an explicitly provided connection even under Electron', () => {
        (process.versions as Record<string, string | undefined>).electron = '30.0.0';
        const callerConnection = { kind: 'tcp' as const, port: 9001 };

        createSdkClient({ connection: callerConnection as any });

        expect(capturedOptions[0].connection).toBe(callerConnection);
        expect(mockRuntimeConnection.forStdio).not.toHaveBeenCalled();
    });

    it('does NOT set connection when copilot CLI cannot be found even under Electron', () => {
        (process.versions as Record<string, string | undefined>).electron = '30.0.0';
        vi.mocked(fs.existsSync).mockReturnValue(false);

        createSdkClient();

        expect(capturedOptions[0].connection).toBeUndefined();
        expect(mockRuntimeConnection.forStdio).not.toHaveBeenCalled();
    });

    it('records the electron spawn resolution for diagnostics', () => {
        (process.versions as Record<string, string | undefined>).electron = '30.0.0';

        createSdkClient({ workingDirectory: '/project' });

        const spawn = getLastCopilotElectronSpawn();
        expect(spawn).toBeDefined();
        expect(spawn!.cliPath).toContain(path.join('@github', 'copilot', 'index.js'));
        // `which node` resolves in the test runner, so a real system node is used.
        expect(spawn!.mode).toBe('system-node');
        expect(path.isAbsolute(spawn!.nodeRuntime)).toBe(true);
    });

    it('spawns the native platform binary directly when index.js is absent (copilot >= 1.0.62 layout)', () => {
        (process.versions as Record<string, string | undefined>).electron = '30.0.0';
        mockNativeOnlyLayout();

        createSdkClient({ workingDirectory: '/project' });

        const conn = capturedOptions[0].connection;
        expect(conn).toBeDefined();
        expect(conn.kind).toBe('stdio');
        expect(conn.path).toContain(NATIVE_PKG_FRAGMENT);
        // The native binary needs no wrapper args; the SDK appends --headless etc.
        expect(conn.args).toEqual([]);
        expect(capturedOptions[0].env).toBeDefined();
        expect(capturedOptions[0].env.ELECTRON_RUN_AS_NODE).toBeUndefined();

        const spawn = getLastCopilotElectronSpawn();
        expect(spawn!.mode).toBe('native-binary');
        expect(spawn!.cliPath).toContain(NATIVE_PKG_FRAGMENT);
    });
});

describe('createSdkClient — native binary override outside Electron', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capturedOptions.length = 0;
        mockRuntimeConnection.forStdio.mockClear();
        resetSystemNodePathCache();
    });

    afterEach(() => {
        resetSystemNodePathCache();
    });

    it('overrides the connection under plain Node when only the native layout is installed', () => {
        // The copilot-sdk's own bundled-CLI default requires index.js, so with
        // the native-only layout it cannot start the CLI even under plain Node.
        mockNativeOnlyLayout();

        createSdkClient({ workingDirectory: '/project' });

        const conn = capturedOptions[0].connection;
        expect(conn).toBeDefined();
        expect(conn.path).toContain(NATIVE_PKG_FRAGMENT);
        expect(conn.args).toEqual([]);
    });

    it('leaves the SDK default in place under plain Node when index.js exists', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        createSdkClient({ workingDirectory: '/project' });

        expect(capturedOptions[0].connection).toBeUndefined();
        expect(capturedOptions[0].env).toBeUndefined();
    });
});

describe('resolveElectronCopilotSpawn', () => {
    it('prefers a real system node when one is found', () => {
        const spawn = resolveElectronCopilotSpawn('/cli/index.js', '/usr/bin/node', '/Apps/CoC/Electron');
        expect(spawn).toEqual({ nodeRuntime: '/usr/bin/node', cliPath: '/cli/index.js', mode: 'system-node' });
    });

    it('falls back to the Electron binary (Node mode) when no system node is found', () => {
        // e.g. an nvm-only machine whose `node` is not on a GUI app's PATH.
        const spawn = resolveElectronCopilotSpawn('/cli/index.js', undefined, '/Apps/CoC/Electron');
        expect(spawn).toEqual({ nodeRuntime: '/Apps/CoC/Electron', cliPath: '/cli/index.js', mode: 'electron-node' });
    });
});

describe('findCopilotNativeCliPath / resolveCopilotCli', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('finds the native platform binary by walking up node_modules', () => {
        mockNativeOnlyLayout();

        const found = findCopilotNativeCliPath('/repo/packages/coc-agent-sdk/dist');

        expect(found).toBeDefined();
        expect(found).toContain(NATIVE_PKG_FRAGMENT);
        const expectedName = process.platform === 'win32' ? 'copilot.exe' : 'copilot';
        expect(path.basename(found!)).toBe(expectedName);
    });

    it('returns undefined when no native platform package exists', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        expect(findCopilotNativeCliPath('/repo')).toBeUndefined();
    });

    it('resolveCopilotCli prefers index.js when both layouts are present', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        const resolution = resolveCopilotCli('/repo');

        expect(resolution).toEqual({ kind: 'js', path: expect.stringContaining(INDEX_JS_FRAGMENT) });
    });

    it('resolveCopilotCli falls back to the native binary when index.js is absent', () => {
        mockNativeOnlyLayout();

        const resolution = resolveCopilotCli('/repo');

        expect(resolution).toEqual({ kind: 'native', path: expect.stringContaining(NATIVE_PKG_FRAGMENT) });
    });

    it('resolveCopilotCli returns undefined when neither layout is installed', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        expect(resolveCopilotCli('/repo')).toBeUndefined();
    });

    it('resolveCopilotCli rewrites asar paths to the unpacked copy', () => {
        const sep = path.sep;
        const asarStart = `${sep}Apps${sep}CoC${sep}resources${sep}app.asar${sep}dist`;
        mockNativeOnlyLayout();

        const resolution = resolveCopilotCli(asarStart);

        expect(resolution!.kind).toBe('native');
        expect(resolution!.path).toContain(`app.asar.unpacked${sep}`);
        expect(resolution!.path).not.toContain(`app.asar${sep}node_modules`);
    });
});

describe('buildCopilotNativeConnection', () => {
    const forStdio = (opts: { path: string; args: string[] }) => ({ kind: 'stdio' as const, ...opts });

    it('spawns the binary directly with no wrapper args and strips ELECTRON_RUN_AS_NODE', () => {
        const { connection, env, spawn } = buildCopilotNativeConnection(
            forStdio,
            '/unpacked/@github/copilot-darwin-arm64/copilot',
            { PATH: '/x', ELECTRON_RUN_AS_NODE: '1', FOO: 'bar' },
        );

        expect(connection.path).toBe('/unpacked/@github/copilot-darwin-arm64/copilot');
        expect(connection.args).toEqual([]);
        expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
        expect(env.FOO).toBe('bar');
        expect(spawn).toEqual({
            nodeRuntime: '/unpacked/@github/copilot-darwin-arm64/copilot',
            cliPath: '/unpacked/@github/copilot-darwin-arm64/copilot',
            mode: 'native-binary',
        });
    });
});

describe('buildElectronCopilotConnection', () => {
    const forStdio = (opts: { path: string; args: string[] }) => ({ kind: 'stdio' as const, ...opts });

    it('uses system node and strips ELECTRON_RUN_AS_NODE from the child env', () => {
        const { connection, env, spawn } = buildElectronCopilotConnection(
            forStdio,
            '/unpacked/@github/copilot/index.js',
            '/usr/bin/node',
            '/Apps/CoC/Electron',
            { PATH: '/x', ELECTRON_RUN_AS_NODE: '1', FOO: 'bar' },
        );

        expect(spawn.mode).toBe('system-node');
        expect(connection.path).toBe('/usr/bin/node');
        expect(connection.args).toEqual(['/unpacked/@github/copilot/index.js']);
        expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
        expect(env.FOO).toBe('bar');
    });

    it('runs the Electron binary in Node mode when no system node is found', () => {
        const { connection, env, spawn } = buildElectronCopilotConnection(
            forStdio,
            '/cli/index.js',
            undefined,
            '/Apps/CoC/Electron',
            { PATH: '/x', ELECTRON_RUN_AS_NODE: '1' },
        );

        expect(spawn.mode).toBe('electron-node');
        expect(connection.path).toBe('/Apps/CoC/Electron');
        expect(connection.args).toEqual(['/cli/index.js']);
        // The child must run the Electron binary AS Node to execute index.js.
        expect(env.ELECTRON_RUN_AS_NODE).toBe('1');
    });
});
