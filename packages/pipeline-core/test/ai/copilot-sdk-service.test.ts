/**
 * Copilot SDK Service Tests (pipeline-core)
 *
 * Tests for the CopilotSDKService internals, focusing on client initialization
 * and automatic folder trust registration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CopilotSDKService, resetCopilotSDKService } from '../../src/ai/copilot-sdk-service';
import * as trustedFolder from '../../src/ai/trusted-folder';

// Mock the trusted-folder module so we can verify calls without touching disk
vi.mock('../../src/ai/trusted-folder', async () => {
    const actual = await vi.importActual('../../src/ai/trusted-folder');
    return {
        ...actual,
        ensureFolderTrusted: vi.fn(),
    };
});

/**
 * Create a mock SDK module that captures constructor options.
 */
function createMockSDKModule() {
    const capturedOptions: any[] = [];

    const mockClient = {
        createSession: vi.fn().mockResolvedValue({
            sessionId: 'test-session',
            sendAndWait: vi.fn().mockResolvedValue('response'),
            destroy: vi.fn().mockResolvedValue(undefined),
        }),
        stop: vi.fn().mockResolvedValue(undefined),
    };

    class MockCopilotClient {
        constructor(options?: any) {
            capturedOptions.push(options);
            Object.assign(this, mockClient);
        }
    }

    return { MockCopilotClient, capturedOptions, mockClient };
}

describe('CopilotSDKService - Client Initialization', () => {
    let service: CopilotSDKService;

    beforeEach(() => {
        resetCopilotSDKService();
        service = CopilotSDKService.getInstance();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        service.dispose();
        resetCopilotSDKService();
    });

    it('should call ensureFolderTrusted with cwd when working directory is specified', async () => {
        const { MockCopilotClient } = createMockSDKModule();

        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };

        await serviceAny.initializeClient('/some/project/path');

        expect(trustedFolder.ensureFolderTrusted).toHaveBeenCalledWith('/some/project/path');
    });

    it('should not call ensureFolderTrusted when no working directory is given', async () => {
        const { MockCopilotClient } = createMockSDKModule();

        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };

        await serviceAny.initializeClient(undefined);

        expect(trustedFolder.ensureFolderTrusted).not.toHaveBeenCalled();
    });

    it('should call ensureFolderTrusted for each new cwd when client is re-created', async () => {
        const { MockCopilotClient } = createMockSDKModule();

        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };

        await serviceAny.initializeClient('/first/path');
        await serviceAny.initializeClient('/second/path');

        expect(trustedFolder.ensureFolderTrusted).toHaveBeenCalledTimes(2);
        expect(trustedFolder.ensureFolderTrusted).toHaveBeenCalledWith('/first/path');
        expect(trustedFolder.ensureFolderTrusted).toHaveBeenCalledWith('/second/path');
    });

    it('should still create client successfully even if ensureFolderTrusted throws', async () => {
        const { MockCopilotClient, capturedOptions } = createMockSDKModule();
        vi.mocked(trustedFolder.ensureFolderTrusted).mockImplementation(() => {
            throw new Error('Permission denied');
        });

        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };

        // Should not throw — ensureFolderTrusted errors are non-fatal
        await serviceAny.initializeClient('/some/path');

        expect(capturedOptions).toHaveLength(1);
        expect(capturedOptions[0].cwd).toBe('/some/path');
    });
});
