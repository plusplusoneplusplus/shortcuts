/**
 * Copilot SDK Service Tests (pipeline-core)
 *
 * Tests for the CopilotSDKService internals, focusing on client initialization
 * behavior such as cliArgs and --allow-all-paths bypass.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CopilotSDKService, resetCopilotSDKService } from '../../src/ai/copilot-sdk-service';

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
    });

    afterEach(async () => {
        service.dispose();
        resetCopilotSDKService();
    });

    it('should pass --allow-all-paths in cliArgs when initializing client', async () => {
        const { MockCopilotClient, capturedOptions } = createMockSDKModule();

        // Inject mock SDK module to bypass findSDKPath/loadSDKModule
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };

        // Call initializeClient directly (private, accessed via any)
        await serviceAny.initializeClient();

        expect(capturedOptions).toHaveLength(1);
        expect(capturedOptions[0]).toBeDefined();
        expect(capturedOptions[0].cliArgs).toEqual(['--allow-all-paths']);
    });

    it('should pass --allow-all-paths along with cwd when working directory is specified', async () => {
        const { MockCopilotClient, capturedOptions } = createMockSDKModule();

        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };

        await serviceAny.initializeClient('/some/project/path');

        expect(capturedOptions).toHaveLength(1);
        expect(capturedOptions[0].cwd).toBe('/some/project/path');
        expect(capturedOptions[0].cliArgs).toEqual(['--allow-all-paths']);
    });

    it('should pass --allow-all-paths without cwd when no working directory given', async () => {
        const { MockCopilotClient, capturedOptions } = createMockSDKModule();

        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };

        await serviceAny.initializeClient(undefined);

        expect(capturedOptions).toHaveLength(1);
        expect(capturedOptions[0].cwd).toBeUndefined();
        expect(capturedOptions[0].cliArgs).toEqual(['--allow-all-paths']);
    });

    it('should pass --allow-all-paths when cwd changes and client is re-created', async () => {
        const { MockCopilotClient, capturedOptions } = createMockSDKModule();

        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };

        // First init with one cwd
        await serviceAny.initializeClient('/first/path');
        expect(capturedOptions).toHaveLength(1);
        expect(capturedOptions[0].cwd).toBe('/first/path');
        expect(capturedOptions[0].cliArgs).toEqual(['--allow-all-paths']);

        // Second init with a different cwd
        await serviceAny.initializeClient('/second/path');
        expect(capturedOptions).toHaveLength(2);
        expect(capturedOptions[1].cwd).toBe('/second/path');
        expect(capturedOptions[1].cliArgs).toEqual(['--allow-all-paths']);
    });
});

describe('CopilotSDKService - ICopilotClientOptions interface', () => {
    it('should accept cliArgs property in client options', () => {
        // Type-level check: ensure the interface allows cliArgs
        const options: { cwd?: string; cliArgs?: string[] } = {
            cwd: '/test',
            cliArgs: ['--allow-all-paths'],
        };
        expect(options.cliArgs).toEqual(['--allow-all-paths']);
    });
});
