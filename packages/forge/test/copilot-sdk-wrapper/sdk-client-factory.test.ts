/**
 * Tests for sdk-client-factory.ts
 *
 * Verifies that createSdkClient() correctly handles working-directory
 * validation, folder-trust registration, and client instantiation —
 * without depending on CopilotSDKService.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSdkClient, ClientOptions } from '../../src/copilot-sdk-wrapper/sdk-client-factory';
import type { SdkModule } from '../../src/copilot-sdk-wrapper/sdk-loader';
import { setLogger, nullLogger } from '../../src/logger';

// Suppress logger output during tests
setLogger(nullLogger);

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/copilot-sdk-wrapper/trusted-folder', () => ({
    ensureFolderTrusted: vi.fn(),
}));

vi.mock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs');
    return { ...actual, existsSync: vi.fn().mockReturnValue(true) };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import * as trustedFolder from '../../src/copilot-sdk-wrapper/trusted-folder';
import * as fs from 'fs';

function makeMockSdkModule(): {
    sdkModule: SdkModule;
    capturedOptions: ClientOptions[];
    mockInstance: Record<string, unknown>;
} {
    const capturedOptions: ClientOptions[] = [];
    const mockInstance = { start: vi.fn(), stop: vi.fn(), createSession: vi.fn() };

    class MockCopilotClient {
        constructor(options: ClientOptions) {
            capturedOptions.push(options);
            Object.assign(this, mockInstance);
        }
    }

    return {
        sdkModule: { CopilotClient: MockCopilotClient } as unknown as SdkModule,
        capturedOptions,
        mockInstance,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSdkClient', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(fs.existsSync).mockReturnValue(true);
    });

    it('creates a client with no cwd when called without options', () => {
        const { sdkModule, capturedOptions } = makeMockSdkModule();

        createSdkClient(sdkModule);

        expect(capturedOptions).toHaveLength(1);
        expect(capturedOptions[0].cwd).toBeUndefined();
    });

    it('creates a client with no cwd when cwd is undefined', () => {
        const { sdkModule, capturedOptions } = makeMockSdkModule();

        createSdkClient(sdkModule, { cwd: undefined });

        expect(capturedOptions).toHaveLength(1);
        expect(capturedOptions[0].cwd).toBeUndefined();
    });

    it('passes cwd to the CopilotClient constructor when cwd is provided', () => {
        const { sdkModule, capturedOptions } = makeMockSdkModule();

        createSdkClient(sdkModule, { cwd: '/some/project' });

        expect(capturedOptions).toHaveLength(1);
        expect(capturedOptions[0].cwd).toBe('/some/project');
    });

    it('calls ensureFolderTrusted with cwd when cwd is provided', () => {
        const { sdkModule } = makeMockSdkModule();

        createSdkClient(sdkModule, { cwd: '/my/repo' });

        expect(trustedFolder.ensureFolderTrusted).toHaveBeenCalledOnce();
        expect(trustedFolder.ensureFolderTrusted).toHaveBeenCalledWith('/my/repo');
    });

    it('does NOT call ensureFolderTrusted when no cwd is given', () => {
        const { sdkModule } = makeMockSdkModule();

        createSdkClient(sdkModule);

        expect(trustedFolder.ensureFolderTrusted).not.toHaveBeenCalled();
    });

    it('still creates client successfully when ensureFolderTrusted throws', () => {
        const { sdkModule, capturedOptions } = makeMockSdkModule();
        vi.mocked(trustedFolder.ensureFolderTrusted).mockImplementation(() => {
            throw new Error('Permission denied');
        });

        // Must not throw
        const client = createSdkClient(sdkModule, { cwd: '/protected/path' });

        expect(client).toBeDefined();
        expect(capturedOptions).toHaveLength(1);
        expect(capturedOptions[0].cwd).toBe('/protected/path');
    });

    it('returns the created client instance', () => {
        const { sdkModule, mockInstance } = makeMockSdkModule();

        const client = createSdkClient(sdkModule, { cwd: '/project' });

        // The instance should have all the mock methods attached
        expect(typeof (client as any).start).toBe('function');
        expect(typeof (client as any).stop).toBe('function');
    });

    it('does NOT warn when cwd exists', () => {
        const { sdkModule } = makeMockSdkModule();
        vi.mocked(fs.existsSync).mockReturnValue(true);

        // No way to directly assert on the logger in unit tests — but we can at
        // least verify that existsSync was called with the correct path.
        createSdkClient(sdkModule, { cwd: '/existing/dir' });

        expect(fs.existsSync).toHaveBeenCalledWith('/existing/dir');
    });

    it('checks existsSync when cwd is provided', () => {
        const { sdkModule } = makeMockSdkModule();
        vi.mocked(fs.existsSync).mockReturnValue(false);

        // Should still create a client (only warns, does not throw)
        const client = createSdkClient(sdkModule, { cwd: '/nonexistent/dir' });

        expect(client).toBeDefined();
        expect(fs.existsSync).toHaveBeenCalledWith('/nonexistent/dir');
    });

    it('does NOT call existsSync when cwd is absent', () => {
        const { sdkModule } = makeMockSdkModule();

        createSdkClient(sdkModule);

        expect(fs.existsSync).not.toHaveBeenCalled();
    });
});
