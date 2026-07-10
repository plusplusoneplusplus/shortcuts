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

    it('does NOT call existsSync when workingDirectory is absent', () => {
        createSdkClient();

        expect(fs.existsSync).not.toHaveBeenCalled();
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
