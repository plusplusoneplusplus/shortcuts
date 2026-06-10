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
