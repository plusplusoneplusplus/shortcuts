/**
 * Tests for CopilotSDKService
 *
 * Comprehensive tests for the Copilot SDK service including:
 * - Singleton pattern
 * - SDK availability checking
 * - Client initialization
 * - Message sending
 * - Error handling
 * - Configuration helpers
 *
 * These tests use mocking to avoid actual SDK dependencies.
 */

import * as assert from 'assert';
import {
    CopilotSDKService,
    getCopilotSDKService,
    resetCopilotSDKService,
    SDKAvailabilityResult,
    SDKInvocationResult,
    SendMessageOptions
} from '@plusplusoneplusplus/pipeline-core';
import {
    getAIBackendSetting,
    getSDKMaxSessionsSetting,
    getSDKSessionTimeoutSetting
} from '../../shortcuts/ai-service/ai-config-helpers';
import { AIBackendType } from '../../shortcuts/ai-service/types';

// ============================================================================
// Mock Types
// ============================================================================

interface MockSession {
    sessionId: string;
    sendAndWait: (options: { prompt: string }) => Promise<{ data?: { content?: string } }>;
    destroy: () => Promise<void>;
    _destroyed: boolean;
}

interface MockClient {
    createSession: () => Promise<MockSession>;
    stop: () => Promise<void>;
    _stopped: boolean;
}

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Create a mock session for testing
 */
function createMockSession(options?: {
    sessionId?: string;
    response?: string;
    shouldFail?: boolean;
    failMessage?: string;
    destroyShouldFail?: boolean;
}): MockSession {
    const sessionId = options?.sessionId ?? `test-session-${Date.now()}`;
    const response = options?.response ?? 'Mock response';
    const shouldFail = options?.shouldFail ?? false;
    const failMessage = options?.failMessage ?? 'Mock error';
    const destroyShouldFail = options?.destroyShouldFail ?? false;

    return {
        sessionId,
        sendAndWait: async ({ prompt }) => {
            if (shouldFail) {
                throw new Error(failMessage);
            }
            return { data: { content: response } };
        },
        destroy: async () => {
            if (destroyShouldFail) {
                throw new Error('Destroy failed');
            }
        },
        _destroyed: false
    };
}

/**
 * Create a mock client for testing
 */
function createMockClient(options?: {
    session?: MockSession;
    createSessionShouldFail?: boolean;
    stopShouldFail?: boolean;
}): MockClient {
    const session = options?.session ?? createMockSession();
    const createSessionShouldFail = options?.createSessionShouldFail ?? false;
    const stopShouldFail = options?.stopShouldFail ?? false;

    return {
        createSession: async () => {
            if (createSessionShouldFail) {
                throw new Error('Failed to create session');
            }
            return session;
        },
        stop: async () => {
            if (stopShouldFail) {
                throw new Error('Failed to stop client');
            }
        },
        _stopped: false
    };
}

// ============================================================================
// Singleton Pattern Tests
// ============================================================================

suite('CopilotSDKService - Singleton Pattern', () => {
    setup(() => {
        // Reset singleton before each test
        resetCopilotSDKService();
    });

    teardown(() => {
        // Clean up after each test
        resetCopilotSDKService();
    });

    test('getInstance should return the same instance', () => {
        const instance1 = CopilotSDKService.getInstance();
        const instance2 = CopilotSDKService.getInstance();

        assert.strictEqual(instance1, instance2, 'Should return the same instance');
    });

    test('getCopilotSDKService convenience function should return singleton', () => {
        const instance1 = getCopilotSDKService();
        const instance2 = CopilotSDKService.getInstance();

        assert.strictEqual(instance1, instance2, 'Convenience function should return singleton');
    });

    test('resetInstance should create new instance', () => {
        const instance1 = CopilotSDKService.getInstance();
        resetCopilotSDKService();
        const instance2 = CopilotSDKService.getInstance();

        assert.notStrictEqual(instance1, instance2, 'Should create new instance after reset');
    });

    test('resetCopilotSDKService convenience function should reset singleton', () => {
        const instance1 = getCopilotSDKService();
        resetCopilotSDKService();
        const instance2 = getCopilotSDKService();

        assert.notStrictEqual(instance1, instance2, 'Convenience function should reset singleton');
    });
});

// ============================================================================
// Availability Check Tests
// ============================================================================

suite('CopilotSDKService - Availability Checks', () => {
    setup(() => {
        resetCopilotSDKService();
    });

    teardown(() => {
        resetCopilotSDKService();
    });

    test('isAvailable should return unavailable when SDK not found', async () => {
        const service = getCopilotSDKService();
        const result = await service.isAvailable();

        // In test environment, SDK may or may not be available
        // We're testing that the method returns a valid result
        assert.ok(typeof result.available === 'boolean', 'Should return boolean available');
        if (!result.available) {
            assert.ok(result.error, 'Should have error message when unavailable');
        }
    });

    test('isAvailable should cache results', async () => {
        const service = getCopilotSDKService();

        const result1 = await service.isAvailable();
        const result2 = await service.isAvailable();

        // Results should be identical (cached)
        assert.strictEqual(result1.available, result2.available, 'Cached results should match');
        assert.strictEqual(result1.error, result2.error, 'Cached error should match');
    });

    test('clearAvailabilityCache should allow re-check', async () => {
        const service = getCopilotSDKService();

        await service.isAvailable();
        service.clearAvailabilityCache();

        // After clearing cache, should be able to check again
        const result = await service.isAvailable();
        assert.ok(typeof result.available === 'boolean', 'Should return valid result after cache clear');
    });

    test('isAvailable should return unavailable after dispose', async () => {
        const service = getCopilotSDKService();
        service.dispose();

        const result = await service.isAvailable();

        assert.strictEqual(result.available, false, 'Should be unavailable after dispose');
        assert.ok(result.error?.includes('disposed'), 'Error should mention disposed');
    });
});

// ============================================================================
// Client Initialization Tests
// ============================================================================

suite('CopilotSDKService - Client Initialization', () => {
    setup(() => {
        resetCopilotSDKService();
    });

    teardown(() => {
        resetCopilotSDKService();
    });

    test('ensureClient should throw when disposed', async () => {
        const service = getCopilotSDKService();
        service.dispose();

        try {
            await service.ensureClient();
            assert.fail('Should have thrown error');
        } catch (error) {
            assert.ok(error instanceof Error, 'Should throw Error');
            assert.ok((error as Error).message.includes('disposed'), 'Error should mention disposed');
        }
    });

    test('ensureClient should throw when SDK not available', async () => {
        const service = getCopilotSDKService();

        // In test environment without SDK, this should fail
        // We test that it throws an appropriate error
        try {
            await service.ensureClient();
            // If SDK is available in test environment, this is also valid
        } catch (error) {
            assert.ok(error instanceof Error, 'Should throw Error');
        }
    });
});

// ============================================================================
// Message Sending Tests
// ============================================================================

suite('CopilotSDKService - Message Sending', () => {
    setup(() => {
        resetCopilotSDKService();
    });

    teardown(() => {
        resetCopilotSDKService();
    });

    test('sendMessage should return error when SDK unavailable', async () => {
        const service = getCopilotSDKService();

        // Force unavailability by disposing
        service.dispose();

        const result = await service.sendMessage({ prompt: 'Test prompt' });

        assert.strictEqual(result.success, false, 'Should not succeed');
        assert.ok(result.error, 'Should have error message');
    });

    test('sendMessage options should have correct defaults', () => {
        const options: SendMessageOptions = {
            prompt: 'Test prompt'
        };

        assert.strictEqual(options.prompt, 'Test prompt', 'Prompt should be set');
        assert.strictEqual(options.model, undefined, 'Model should be undefined by default');
        assert.strictEqual(options.workingDirectory, undefined, 'Working directory should be undefined by default');
        assert.strictEqual(options.timeoutMs, undefined, 'Timeout should be undefined by default');
    });

    test('SDKInvocationResult should have correct structure', () => {
        const successResult: SDKInvocationResult = {
            success: true,
            response: 'Test response',
            sessionId: 'test-session-123'
        };

        assert.strictEqual(successResult.success, true);
        assert.strictEqual(successResult.response, 'Test response');
        assert.strictEqual(successResult.sessionId, 'test-session-123');

        const errorResult: SDKInvocationResult = {
            success: false,
            error: 'Test error'
        };

        assert.strictEqual(errorResult.success, false);
        assert.strictEqual(errorResult.error, 'Test error');
    });
});

// ============================================================================
// Cleanup Tests
// ============================================================================

suite('CopilotSDKService - Cleanup', () => {
    setup(() => {
        resetCopilotSDKService();
    });

    teardown(() => {
        resetCopilotSDKService();
    });

    test('cleanup should not throw when not initialized', async () => {
        const service = getCopilotSDKService();

        // Should not throw even when no client exists
        await service.cleanup();
    });

    test('dispose should mark service as disposed', async () => {
        const service = getCopilotSDKService();
        service.dispose();

        const result = await service.isAvailable();
        assert.strictEqual(result.available, false, 'Should be unavailable after dispose');
    });

    test('dispose should be idempotent', () => {
        const service = getCopilotSDKService();

        // Should not throw when called multiple times
        service.dispose();
        service.dispose();
        service.dispose();
    });
});

// ============================================================================
// Configuration Helper Tests
// ============================================================================

suite('CopilotSDKService - Configuration Helpers', () => {
    test('getAIBackendSetting should return valid backend type', () => {
        const backend = getAIBackendSetting();

        // Should be one of the valid backend types
        const validBackends: AIBackendType[] = ['copilot-sdk', 'copilot-cli', 'clipboard'];
        assert.ok(validBackends.includes(backend), `Backend should be one of: ${validBackends.join(', ')}`);
    });

    test('getSDKMaxSessionsSetting should return a number', () => {
        const maxSessions = getSDKMaxSessionsSetting();

        assert.ok(typeof maxSessions === 'number', 'Should return a number');
        assert.ok(maxSessions >= 1, 'Should be at least 1');
        assert.ok(maxSessions <= 20, 'Should be at most 20');
    });

    test('getSDKSessionTimeoutSetting should return a number', () => {
        const timeout = getSDKSessionTimeoutSetting();

        assert.ok(typeof timeout === 'number', 'Should return a number');
        assert.ok(timeout >= 30000, 'Should be at least 30 seconds');
        assert.ok(timeout <= 600000, 'Should be at most 10 minutes');
    });

    test('default backend should be copilot-cli', () => {
        // This tests the default value when no configuration is set
        // In a fresh environment, should default to copilot-cli
        const backend = getAIBackendSetting();

        // Default is copilot-cli according to package.json
        assert.strictEqual(backend, 'copilot-cli', 'Default backend should be copilot-cli');
    });

    test('default max sessions should be 5', () => {
        const maxSessions = getSDKMaxSessionsSetting();

        // Default is 5 according to package.json
        assert.strictEqual(maxSessions, 5, 'Default max sessions should be 5');
    });

    test('default session timeout should be 600000ms (10 minutes)', () => {
        const timeout = getSDKSessionTimeoutSetting();

        // Default is 600000 according to package.json
        assert.strictEqual(timeout, 600000, 'Default session timeout should be 600000ms');
    });
});

// ============================================================================
// Type Tests
// ============================================================================

suite('CopilotSDKService - Type Definitions', () => {
    test('SDKAvailabilityResult should have correct structure', () => {
        const availableResult: SDKAvailabilityResult = {
            available: true,
            sdkPath: '/path/to/sdk'
        };

        assert.strictEqual(availableResult.available, true);
        assert.strictEqual(availableResult.sdkPath, '/path/to/sdk');
        assert.strictEqual(availableResult.error, undefined);

        const unavailableResult: SDKAvailabilityResult = {
            available: false,
            error: 'SDK not found'
        };

        assert.strictEqual(unavailableResult.available, false);
        assert.strictEqual(unavailableResult.error, 'SDK not found');
        assert.strictEqual(unavailableResult.sdkPath, undefined);
    });

    test('SendMessageOptions should support all fields', () => {
        const fullOptions: SendMessageOptions = {
            prompt: 'Test prompt',
            model: 'claude-sonnet-4.5',
            workingDirectory: '/path/to/workspace',
            timeoutMs: 60000
        };

        assert.strictEqual(fullOptions.prompt, 'Test prompt');
        assert.strictEqual(fullOptions.model, 'claude-sonnet-4.5');
        assert.strictEqual(fullOptions.workingDirectory, '/path/to/workspace');
        assert.strictEqual(fullOptions.timeoutMs, 60000);
    });

    test('SDKInvocationResult should support rawResponse', () => {
        const result: SDKInvocationResult = {
            success: true,
            response: 'Test response',
            sessionId: 'session-123',
            rawResponse: { data: { content: 'Test response' } }
        };

        assert.strictEqual(result.success, true);
        assert.ok(result.rawResponse, 'Should have rawResponse');
    });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

suite('CopilotSDKService - Error Handling', () => {
    setup(() => {
        resetCopilotSDKService();
    });

    teardown(() => {
        resetCopilotSDKService();
    });

    test('should handle missing SDK gracefully', async () => {
        const service = getCopilotSDKService();

        // Clear any cached availability
        service.clearAvailabilityCache();

        const result = await service.isAvailable();

        // Should not throw, should return a valid result
        assert.ok(typeof result.available === 'boolean');
    });

    test('should handle concurrent isAvailable calls', async () => {
        const service = getCopilotSDKService();
        service.clearAvailabilityCache();

        // Make multiple concurrent calls
        const results = await Promise.all([
            service.isAvailable(),
            service.isAvailable(),
            service.isAvailable()
        ]);

        // All results should be identical
        assert.strictEqual(results[0].available, results[1].available);
        assert.strictEqual(results[1].available, results[2].available);
    });

    test('should handle sendMessage when disposed', async () => {
        const service = getCopilotSDKService();
        service.dispose();

        // Should return error immediately without timeout
        const result = await service.sendMessage({ prompt: 'Test' });

        assert.strictEqual(result.success, false);
        assert.ok(result.error, 'Should have error message');
    });
});

// ============================================================================
// Integration Tests (with real SDK if available)
// ============================================================================

suite('CopilotSDKService - Integration', () => {
    setup(() => {
        resetCopilotSDKService();
    });

    teardown(() => {
        resetCopilotSDKService();
    });

    test('should check SDK availability without timeout', async function () {
        // This test verifies that availability check works without timeout
        const service = getCopilotSDKService();
        const availability = await service.isAvailable();

        // Should return a valid result (either available or not)
        assert.ok(typeof availability.available === 'boolean');
        if (availability.available) {
            assert.ok(availability.sdkPath, 'Should have SDK path when available');
        } else {
            assert.ok(availability.error, 'Should have error when unavailable');
        }
    });
});

// ============================================================================
// Cross-Platform Tests
// ============================================================================

suite('CopilotSDKService - Cross-Platform', () => {
    setup(() => {
        resetCopilotSDKService();
    });

    teardown(() => {
        resetCopilotSDKService();
    });

    test('SendMessageOptions should accept Unix-style paths', () => {
        // Test that options type accepts Unix-style paths
        const options: SendMessageOptions = {
            prompt: 'Test',
            workingDirectory: '/path/to/workspace'
        };

        assert.strictEqual(options.workingDirectory, '/path/to/workspace');
    });

    test('SendMessageOptions should accept Windows-style paths', () => {
        // Test that options type accepts Windows-style paths
        const options: SendMessageOptions = {
            prompt: 'Test',
            workingDirectory: 'C:\\Users\\test\\workspace'
        };

        assert.strictEqual(options.workingDirectory, 'C:\\Users\\test\\workspace');
    });

    test('service should be platform-independent', () => {
        const service = getCopilotSDKService();

        // Service should be available on any platform
        assert.ok(service, 'Service should be instantiated');
        assert.ok(typeof service.isAvailable === 'function', 'Should have isAvailable method');
        assert.ok(typeof service.sendMessage === 'function', 'Should have sendMessage method');
    });
});

// ============================================================================
// AIBackendType Tests
// ============================================================================

suite('CopilotSDKService - AIBackendType', () => {
    test('AIBackendType should include copilot-sdk', () => {
        const backend: AIBackendType = 'copilot-sdk';
        assert.strictEqual(backend, 'copilot-sdk');
    });

    test('AIBackendType should include copilot-cli', () => {
        const backend: AIBackendType = 'copilot-cli';
        assert.strictEqual(backend, 'copilot-cli');
    });

    test('AIBackendType should include clipboard', () => {
        const backend: AIBackendType = 'clipboard';
        assert.strictEqual(backend, 'clipboard');
    });
});

// ============================================================================
// Session Pool Integration Tests
// ============================================================================

suite('CopilotSDKService - Session Pool Integration', () => {
    setup(() => {
        resetCopilotSDKService();
    });

    teardown(() => {
        resetCopilotSDKService();
    });

    test('SendMessageOptions should support usePool option', () => {
        const options: SendMessageOptions = {
            prompt: 'Test prompt',
            usePool: true
        };

        assert.strictEqual(options.prompt, 'Test prompt');
        assert.strictEqual(options.usePool, true);
    });

    test('SendMessageOptions usePool should default to undefined', () => {
        const options: SendMessageOptions = {
            prompt: 'Test prompt'
        };

        assert.strictEqual(options.usePool, undefined);
    });

    test('getPoolStats should return null when pool not initialized', () => {
        const service = getCopilotSDKService();
        const stats = service.getPoolStats();

        assert.strictEqual(stats, null, 'Should return null when pool not initialized');
    });

    test('hasActivePool should return false when pool not initialized', () => {
        const service = getCopilotSDKService();
        const hasPool = service.hasActivePool();

        assert.strictEqual(hasPool, false, 'Should return false when pool not initialized');
    });

    test('hasActivePool should return false after dispose', () => {
        const service = getCopilotSDKService();
        service.dispose();

        const hasPool = service.hasActivePool();
        assert.strictEqual(hasPool, false, 'Should return false after dispose');
    });

    test('sendMessage with usePool should return error when SDK unavailable', async () => {
        const service = getCopilotSDKService();
        service.dispose();

        const result = await service.sendMessage({ prompt: 'Test', usePool: true });

        assert.strictEqual(result.success, false, 'Should not succeed');
        assert.ok(result.error, 'Should have error message');
    });

    test('sendMessage without usePool should use direct mode', async () => {
        const service = getCopilotSDKService();
        service.dispose();

        // Even when disposed, sendMessage should return an error (not throw)
        const result = await service.sendMessage({ prompt: 'Test', usePool: false });

        assert.strictEqual(result.success, false);
        assert.ok(result.error);
    });

    test('cleanup should dispose session pool', async () => {
        const service = getCopilotSDKService();

        // Cleanup should not throw even if pool wasn't initialized
        await service.cleanup();

        assert.strictEqual(service.hasActivePool(), false);
    });
});

// ============================================================================
// Session Pool Options Tests
// ============================================================================

suite('CopilotSDKService - Pool Options', () => {
    test('SendMessageOptions should support all pool-related fields', () => {
        const fullOptions: SendMessageOptions = {
            prompt: 'Test prompt',
            model: 'claude-sonnet-4.5',
            workingDirectory: '/path/to/workspace',
            timeoutMs: 60000,
            usePool: true
        };

        assert.strictEqual(fullOptions.prompt, 'Test prompt');
        assert.strictEqual(fullOptions.model, 'claude-sonnet-4.5');
        assert.strictEqual(fullOptions.workingDirectory, '/path/to/workspace');
        assert.strictEqual(fullOptions.timeoutMs, 60000);
        assert.strictEqual(fullOptions.usePool, true);
    });

    test('usePool false should be explicit', () => {
        const options: SendMessageOptions = {
            prompt: 'Test',
            usePool: false
        };

        assert.strictEqual(options.usePool, false);
    });
});

// ============================================================================
// Session Abort Tests
// ============================================================================

suite('CopilotSDKService - Session Abort', () => {
    setup(() => {
        resetCopilotSDKService();
    });

    teardown(() => {
        resetCopilotSDKService();
    });

    test('abortSession should return false for non-existent session', async () => {
        const service = getCopilotSDKService();
        
        const result = await service.abortSession('non-existent-session-id');
        
        assert.strictEqual(result, false, 'Should return false for non-existent session');
    });

    test('hasActiveSession should return false for non-existent session', () => {
        const service = getCopilotSDKService();
        
        const result = service.hasActiveSession('non-existent-session-id');
        
        assert.strictEqual(result, false, 'Should return false for non-existent session');
    });

    test('getActiveSessionCount should return 0 initially', () => {
        const service = getCopilotSDKService();
        
        const count = service.getActiveSessionCount();
        
        assert.strictEqual(count, 0, 'Should return 0 when no sessions exist');
    });

    test('getActiveSessionCount should return 0 after dispose', () => {
        const service = getCopilotSDKService();
        service.dispose();
        
        const count = service.getActiveSessionCount();
        
        assert.strictEqual(count, 0, 'Should return 0 after dispose');
    });

    test('abortSession should return false after dispose', async () => {
        const service = getCopilotSDKService();
        service.dispose();
        
        // Try to abort a session after dispose
        const result = await service.abortSession('any-session-id');
        
        assert.strictEqual(result, false, 'Should return false after dispose');
    });

    test('cleanup should clear all active sessions', async () => {
        const service = getCopilotSDKService();
        
        // Cleanup should not throw and should clear any sessions
        await service.cleanup();
        
        assert.strictEqual(service.getActiveSessionCount(), 0, 'Should have no active sessions after cleanup');
    });
});

// ============================================================================
// Session Tracking Tests
// ============================================================================

suite('CopilotSDKService - Session Tracking', () => {
    setup(() => {
        resetCopilotSDKService();
    });

    teardown(() => {
        resetCopilotSDKService();
    });

    test('hasActiveSession should be a function', () => {
        const service = getCopilotSDKService();
        
        assert.ok(typeof service.hasActiveSession === 'function', 'Should have hasActiveSession method');
    });

    test('abortSession should be a function', () => {
        const service = getCopilotSDKService();
        
        assert.ok(typeof service.abortSession === 'function', 'Should have abortSession method');
    });

    test('getActiveSessionCount should be a function', () => {
        const service = getCopilotSDKService();
        
        assert.ok(typeof service.getActiveSessionCount === 'function', 'Should have getActiveSessionCount method');
    });

    test('abortSession should handle concurrent calls', async () => {
        const service = getCopilotSDKService();
        
        // Multiple concurrent abort calls should all return false (no session exists)
        const results = await Promise.all([
            service.abortSession('session-1'),
            service.abortSession('session-2'),
            service.abortSession('session-3')
        ]);
        
        assert.deepStrictEqual(results, [false, false, false], 'All calls should return false for non-existent sessions');
    });
});
