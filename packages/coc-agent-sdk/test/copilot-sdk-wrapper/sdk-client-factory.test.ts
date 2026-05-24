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

vi.mock('../../src/sdk-esm-loader', () => ({
    getCachedCopilotSdk: () => ({ CopilotClient: MockCopilotClient }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createSdkClient } from '../../src/sdk-client-factory';
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

    it('routes WSL working directories to the host filesystem for the Windows Copilot CLI', () => {
        const cwd = String.raw`\\wsl$\Ubuntu\home\tester\repo`;
        createSdkClient({ cwd });

        expect(workspaceExecution.resolveWorkspaceExecutionContext).toHaveBeenCalledWith(cwd);
        expect(workspaceExecution.translatePathForHostFilesystem).toHaveBeenCalledWith(
            cwd,
            expect.objectContaining({
                kind: 'wsl',
                linuxWorkingDirectory: '/home/tester/repo',
            }),
        );
        expect(capturedOptions[0].cwd).toBe(cwd);
        expect(capturedOptions[0].cliPath).toBeUndefined();
        expect(capturedOptions[0].cliArgs).toBeUndefined();
        expect(capturedOptions[0].env).toBeUndefined();
        expect(trustedFolder.ensureFolderTrusted).toHaveBeenCalledWith(cwd);
        expect(fs.existsSync).toHaveBeenCalledWith(cwd);
    });

    it('translates Linux-style WSL working directories to host UNC paths', () => {
        createSdkClient({ cwd: '/home/tester/repo' });

        expect(workspaceExecution.translatePathForHostFilesystem).toHaveBeenCalledWith(
            '/home/tester/repo',
            expect.objectContaining({
                kind: 'wsl',
                linuxWorkingDirectory: '/home/tester/repo',
            }),
        );
        expect(capturedOptions[0].cwd).toBe(String.raw`\\wsl$\Ubuntu\home\tester\repo`);
        expect(trustedFolder.ensureFolderTrusted).toHaveBeenCalledWith(String.raw`\\wsl$\Ubuntu\home\tester\repo`);
        expect(fs.existsSync).toHaveBeenCalledWith(String.raw`\\wsl$\Ubuntu\home\tester\repo`);
    });
});
