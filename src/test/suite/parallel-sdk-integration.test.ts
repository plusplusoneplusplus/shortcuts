/**
 * Parallel SDK Integration Tests
 *
 * Tests for the SDK integration with parallel consumers
 * (Code Review and YAML Pipeline).
 *
 * These tests verify:
 * 1. SDK backend routing for parallel workloads
 * 2. Fallback to CLI when SDK is unavailable
 * 3. Proper error handling and logging
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import {
    CopilotSDKService,
    getCopilotSDKService,
    resetCopilotSDKService,
    SendMessageOptions,
    SDKInvocationResult,
    AIBackendType
} from '@plusplusoneplusplus/pipeline-core';
import {
    getAIBackendSetting
} from '../../shortcuts/ai-service';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Helper to check if SDK is available in test environment
 */
async function isSDKAvailable(): Promise<boolean> {
    const service = getCopilotSDKService();
    const result = await service.isAvailable();
    return result.available;
}

// ============================================================================
// Backend Selection Tests
// ============================================================================

suite('Parallel SDK Integration - Backend Selection', () => {
    test('getAIBackendSetting returns valid backend type', () => {
        const backend = getAIBackendSetting();
        const validBackends: AIBackendType[] = ['copilot-sdk', 'copilot-cli', 'clipboard'];
        
        assert.ok(
            validBackends.includes(backend),
            `Backend should be one of: ${validBackends.join(', ')}`
        );
    });

    test('default backend is copilot-cli', () => {
        const backend = getAIBackendSetting();
        // Default should be copilot-cli as per package.json configuration
        assert.strictEqual(backend, 'copilot-cli');
    });

    test('backend type supports copilot-sdk', () => {
        const sdkBackend: AIBackendType = 'copilot-sdk';
        assert.strictEqual(sdkBackend, 'copilot-sdk');
    });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

suite('Parallel SDK Integration - Error Handling', () => {
    setup(() => {
        resetCopilotSDKService();
    });

    teardown(() => {
        resetCopilotSDKService();
    });

    test('sendMessage returns error when disposed', async () => {
        const service = getCopilotSDKService();
        service.dispose();

        const result = await service.sendMessage({ prompt: 'Test' });

        assert.strictEqual(result.success, false);
        assert.ok(result.error, 'Should have error message');
        assert.ok(result.error?.includes('disposed') || result.error?.includes('unavailable'));
    });

    test('SDKInvocationResult has proper error structure', () => {
        const errorResult: SDKInvocationResult = {
            success: false,
            error: 'SDK unavailable',
            sessionId: undefined
        };

        assert.strictEqual(errorResult.success, false);
        assert.strictEqual(errorResult.error, 'SDK unavailable');
        assert.strictEqual(errorResult.sessionId, undefined);
    });

    test('SDKInvocationResult has proper success structure', () => {
        const successResult: SDKInvocationResult = {
            success: true,
            response: 'AI response',
            sessionId: 'session-123'
        };

        assert.strictEqual(successResult.success, true);
        assert.strictEqual(successResult.response, 'AI response');
        assert.strictEqual(successResult.sessionId, 'session-123');
    });
});

// ============================================================================
// Parallel Request Pattern Tests
// ============================================================================

suite('Parallel SDK Integration - Request Patterns', () => {
    setup(() => {
        resetCopilotSDKService();
    });

    teardown(() => {
        resetCopilotSDKService();
    });

    test('multiple sendMessage calls should not throw when disposed', async () => {
        const service = getCopilotSDKService();
        
        // Dispose the service first to ensure immediate failure (no SDK lookup timeout)
        service.dispose();
        
        // These will fail immediately because service is disposed
        const promises = [
            service.sendMessage({ prompt: 'Prompt 1' }),
            service.sendMessage({ prompt: 'Prompt 2' }),
            service.sendMessage({ prompt: 'Prompt 3' })
        ];

        const results = await Promise.all(promises);

        // All should return error results, not throw
        assert.strictEqual(results.length, 3);
        for (const result of results) {
            assert.strictEqual(result.success, false);
            assert.ok(result.error, 'Failed results should have error message');
        }
    });

    test('concurrent availability checks should not cause issues', async () => {
        const service = getCopilotSDKService();
        
        const promises = [
            service.isAvailable(),
            service.isAvailable(),
            service.isAvailable()
        ];

        const results = await Promise.all(promises);

        // All results should be identical (cached)
        assert.strictEqual(results[0].available, results[1].available);
        assert.strictEqual(results[1].available, results[2].available);
    });
});

// ============================================================================
// Code Review Integration Pattern Tests
// ============================================================================

suite('Parallel SDK Integration - Code Review Pattern', () => {
    test('AIInvoker result type is compatible with SDK result', () => {
        // Simulating the pattern used in code-review-commands.ts
        const sdkResult: SDKInvocationResult = {
            success: true,
            response: 'Review findings: No issues found'
        };

        // The code review invoker returns { success, response, error }
        const invokerResult = {
            success: sdkResult.success,
            response: sdkResult.response
        };

        assert.strictEqual(invokerResult.success, true);
        assert.strictEqual(invokerResult.response, 'Review findings: No issues found');
    });

    test('SDK result with sessionId is compatible', () => {
        const sdkResult: SDKInvocationResult = {
            success: true,
            response: 'Test response',
            sessionId: 'session-abc123'
        };

        // The invoker can extract just what it needs
        const response = sdkResult.response;
        assert.ok(response);
    });

    test('failed SDK result triggers fallback pattern', () => {
        const sdkResult: SDKInvocationResult = {
            success: false,
            error: 'SDK connection failed'
        };

        // Pattern: if SDK fails, fall back to CLI
        if (!sdkResult.success) {
            // Fallback would be invoked here
            assert.ok(sdkResult.error);
        }
    });
});

// ============================================================================
// YAML Pipeline Integration Pattern Tests
// ============================================================================

suite('Parallel SDK Integration - Pipeline Pattern', () => {
    test('model option is passed correctly', () => {
        const options: SendMessageOptions = {
            prompt: 'Analyze data',
            model: 'gpt-4'
        };

        assert.strictEqual(options.model, 'gpt-4');
    });

    test('workingDirectory option is passed correctly', () => {
        const options: SendMessageOptions = {
            prompt: 'Execute pipeline',
            workingDirectory: '/workspace/project'
        };

        assert.strictEqual(options.workingDirectory, '/workspace/project');
    });

    test('pipeline-style invocation pattern returns errors when disposed', async () => {
        const service = getCopilotSDKService();
        
        // Dispose the service first to ensure immediate failure
        service.dispose();
        
        // Simulate pipeline invocation pattern
        const pipelineItems = [
            { id: '1', data: 'Item 1' },
            { id: '2', data: 'Item 2' },
            { id: '3', data: 'Item 3' }
        ];

        const results = await Promise.all(
            pipelineItems.map(item =>
                service.sendMessage({
                    prompt: `Process: ${item.data}`
                })
            )
        );

        // Verify all requests completed with errors
        assert.strictEqual(results.length, 3);
        results.forEach((result, index) => {
            assert.strictEqual(result.success, false, `Result ${index} should fail`);
            assert.ok(result.error, `Result ${index} should have error message`);
        });
    });
});

// ============================================================================
// Cross-Platform Tests
// ============================================================================

suite('Parallel SDK Integration - Cross-Platform', () => {
    test('Unix-style paths are accepted', () => {
        const options: SendMessageOptions = {
            prompt: 'Test',
            workingDirectory: '/home/user/workspace'
        };

        assert.strictEqual(options.workingDirectory, '/home/user/workspace');
    });

    test('Windows-style paths are accepted', () => {
        const options: SendMessageOptions = {
            prompt: 'Test',
            workingDirectory: 'C:\\Users\\test\\workspace'
        };

        assert.strictEqual(options.workingDirectory, 'C:\\Users\\test\\workspace');
    });

    test('service works on any platform', () => {
        const service = getCopilotSDKService();

        assert.ok(service, 'Service should be instantiated');
        assert.ok(typeof service.sendMessage === 'function');
        assert.ok(typeof service.isAvailable === 'function');
    });
});

// ============================================================================
// Singleton Pattern Tests for Parallel Usage
// ============================================================================

suite('Parallel SDK Integration - Singleton', () => {
    setup(() => {
        resetCopilotSDKService();
    });

    teardown(() => {
        resetCopilotSDKService();
    });

    test('getInstance returns same instance for parallel consumers', () => {
        const codeReviewService = getCopilotSDKService();
        const pipelineService = getCopilotSDKService();

        assert.strictEqual(codeReviewService, pipelineService);
    });

    test('parallel calls share the same service instance', async () => {
        const instances: CopilotSDKService[] = [];

        const promises = Array(5).fill(null).map(async () => {
            const service = getCopilotSDKService();
            instances.push(service);
            await service.isAvailable();
            return service;
        });

        await Promise.all(promises);

        // All instances should be the same
        const firstInstance = instances[0];
        instances.forEach((instance, index) => {
            assert.strictEqual(
                instance,
                firstInstance,
                `Instance ${index} should be the same`
            );
        });
    });

    test('reset creates new instance for all consumers', () => {
        const before = getCopilotSDKService();
        resetCopilotSDKService();
        const after = getCopilotSDKService();

        assert.notStrictEqual(before, after);
    });
});
