/**
 * Tests for sdk-client-factory.ts
 *
 * Verifies that createSdkClient() correctly handles working-directory
 * validation, folder-trust registration, and client instantiation.
 *
 * We mock the @github/copilot-sdk CopilotClient constructor so no real
 * CLI process is spawned.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setLogger, nullLogger } from '../../src/logger';

// Suppress logger output during tests
setLogger(nullLogger);

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/copilot-sdk-wrapper/trusted-folder', () => ({
    ensureFolderTrusted: vi.fn(),
    getCopilotConfigDir: vi.fn().mockReturnValue('C:\\Users\\tester\\.copilot'),
}));

vi.mock('../../src/utils/workspace-execution', () => ({
    resolveWorkspaceExecutionContext: vi.fn((cwd?: string) => cwd && cwd.startsWith(String.raw`\\wsl$`)
        ? { kind: 'wsl', distro: 'Ubuntu', linuxWorkingDirectory: '/home/tester/repo', originalWorkingDirectory: cwd }
        : { kind: 'windows', workingDirectory: cwd }),
    getWslExecutablePath: vi.fn().mockReturnValue('C:\\Windows\\System32\\wsl.exe'),
    buildWslCommandArgs: vi.fn((_context: unknown, argv: string[]) => ['-d', 'Ubuntu', '--cd', '/home/tester/repo', '--', ...argv]),
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

vi.mock('../../src/copilot-sdk-wrapper/sdk-esm-loader', () => ({
    getCachedCopilotSdk: () => ({ CopilotClient: MockCopilotClient }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createSdkClient } from '../../src/copilot-sdk-wrapper/sdk-client-factory';
import * as trustedFolder from '../../src/copilot-sdk-wrapper/trusted-folder';
import * as fs from 'fs';
import * as workspaceExecution from '../../src/utils/workspace-execution';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSdkClient', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capturedOptions.length = 0;
        vi.mocked(fs.existsSync).mockReturnValue(true);
    });

    it('creates a client with no cwd when called without options', () => {
        createSdkClient();

        expect(capturedOptions).toHaveLength(1);
        expect(capturedOptions[0].cwd).toBeUndefined();
    });

    it('creates a client with no cwd when cwd is undefined', () => {
        createSdkClient({ cwd: undefined });

        expect(capturedOptions).toHaveLength(1);
        expect(capturedOptions[0].cwd).toBeUndefined();
    });

    it('passes cwd to the CopilotClient constructor when cwd is provided', () => {
        createSdkClient({ cwd: '/some/project' });

        expect(capturedOptions).toHaveLength(1);
        expect(capturedOptions[0].cwd).toBe('/some/project');
    });

    it('calls ensureFolderTrusted with cwd when cwd is provided', () => {
        createSdkClient({ cwd: '/my/repo' });

        expect(trustedFolder.ensureFolderTrusted).toHaveBeenCalledOnce();
        expect(trustedFolder.ensureFolderTrusted).toHaveBeenCalledWith('/my/repo');
    });

    it('does NOT call ensureFolderTrusted when no cwd is given', () => {
        createSdkClient();

        expect(trustedFolder.ensureFolderTrusted).not.toHaveBeenCalled();
    });

    it('still creates client successfully when ensureFolderTrusted throws', () => {
        vi.mocked(trustedFolder.ensureFolderTrusted).mockImplementation(() => {
            throw new Error('Permission denied');
        });

        const client = createSdkClient({ cwd: '/protected/path' });

        expect(client).toBeDefined();
        expect(capturedOptions).toHaveLength(1);
        expect(capturedOptions[0].cwd).toBe('/protected/path');
    });

    it('returns the created client instance', () => {
        const client = createSdkClient({ cwd: '/project' });

        expect(typeof (client as any).start).toBe('function');
        expect(typeof (client as any).stop).toBe('function');
    });

    it('does NOT warn when cwd exists', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        createSdkClient({ cwd: '/existing/dir' });

        expect(fs.existsSync).toHaveBeenCalledWith('/existing/dir');
    });

    it('checks existsSync when cwd is provided', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const client = createSdkClient({ cwd: '/nonexistent/dir' });

        expect(client).toBeDefined();
        expect(fs.existsSync).toHaveBeenCalledWith('/nonexistent/dir');
    });

    it('does NOT call existsSync when cwd is absent', () => {
        createSdkClient();

        expect(fs.existsSync).not.toHaveBeenCalled();
    });

    it('routes WSL working directories through wsl.exe and Linux trust paths', () => {
        const cwd = String.raw`\\wsl$\Ubuntu\home\tester\repo`;
        createSdkClient({ cwd });

        expect(workspaceExecution.resolveWorkspaceExecutionContext).toHaveBeenCalledWith(cwd);
        expect(capturedOptions[0].cwd).toBeUndefined();
        expect(capturedOptions[0].cliPath).toBe('C:\\Windows\\System32\\wsl.exe');
        expect(capturedOptions[0].cliArgs).toEqual(['-d', 'Ubuntu', '--cd', '/home/tester/repo', '--', 'copilot']);
        expect(capturedOptions[0].env).toEqual(expect.objectContaining({
            COPILOT_HOME: '/mnt/c/Users/tester/.copilot',
            XDG_CONFIG_HOME: '/mnt/c/Users/tester/.copilot',
        }));
        expect(trustedFolder.ensureFolderTrusted).toHaveBeenCalledWith('/home/tester/repo');
        expect(fs.existsSync).not.toHaveBeenCalled();
    });
});
