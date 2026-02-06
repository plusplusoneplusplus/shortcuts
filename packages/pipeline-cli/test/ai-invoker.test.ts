/**
 * AI Invoker Tests
 *
 * Tests for the CLI AI invoker factory, dry-run invoker, and availability checking.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    createDryRunAIInvoker,
    createCLIAIInvoker,
    checkAIAvailability,
} from '../src/ai-invoker';
import type { CLIAIInvokerOptions, AIAvailabilityResult } from '../src/ai-invoker';

describe('AI Invoker', () => {
    // ========================================================================
    // Dry Run Invoker
    // ========================================================================

    describe('createDryRunAIInvoker', () => {
        it('should create an invoker function', () => {
            const invoker = createDryRunAIInvoker();
            expect(typeof invoker).toBe('function');
        });

        it('should return success for any prompt', async () => {
            const invoker = createDryRunAIInvoker();
            const result = await invoker('Test prompt');
            expect(result.success).toBe(true);
        });

        it('should return JSON response', async () => {
            const invoker = createDryRunAIInvoker();
            const result = await invoker('Test prompt');
            const parsed = JSON.parse(result.response);
            expect(parsed._dryRun).toBe(true);
        });

        it('should include prompt length in response', async () => {
            const invoker = createDryRunAIInvoker();
            const prompt = 'Hello, World!';
            const result = await invoker(prompt);
            const parsed = JSON.parse(result.response);
            expect(parsed._promptLength).toBe(prompt.length);
        });

        it('should include dry run message', async () => {
            const invoker = createDryRunAIInvoker();
            const result = await invoker('test');
            const parsed = JSON.parse(result.response);
            expect(parsed._message).toContain('Dry run');
        });

        it('should handle empty prompt', async () => {
            const invoker = createDryRunAIInvoker();
            const result = await invoker('');
            expect(result.success).toBe(true);
            const parsed = JSON.parse(result.response);
            expect(parsed._promptLength).toBe(0);
        });

        it('should handle long prompts', async () => {
            const invoker = createDryRunAIInvoker();
            const longPrompt = 'x'.repeat(100000);
            const result = await invoker(longPrompt);
            expect(result.success).toBe(true);
            const parsed = JSON.parse(result.response);
            expect(parsed._promptLength).toBe(100000);
        });

        it('should ignore invoker options', async () => {
            const invoker = createDryRunAIInvoker();
            const result = await invoker('test', { model: 'gpt-4', timeoutMs: 5000 });
            expect(result.success).toBe(true);
        });
    });

    // ========================================================================
    // CLI AI Invoker
    // ========================================================================

    describe('createCLIAIInvoker', () => {
        it('should create an invoker function', () => {
            const invoker = createCLIAIInvoker();
            expect(typeof invoker).toBe('function');
        });

        it('should create an invoker with options', () => {
            const options: CLIAIInvokerOptions = {
                model: 'gpt-4',
                approvePermissions: true,
                workingDirectory: '/tmp',
                timeoutMs: 30000,
                loadMcpConfig: false,
            };
            const invoker = createCLIAIInvoker(options);
            expect(typeof invoker).toBe('function');
        });

        it('should create an invoker with empty options', () => {
            const invoker = createCLIAIInvoker({});
            expect(typeof invoker).toBe('function');
        });

        // Note: Actually calling the invoker would require Copilot SDK to be available,
        // which won't be the case in CI/CD. The creation tests above verify the factory works.
    });

    // ========================================================================
    // AI Availability
    // ========================================================================

    describe('checkAIAvailability', () => {
        it('should return an availability result', async () => {
            const result = await checkAIAvailability();
            expect(result).toHaveProperty('available');
            expect(typeof result.available).toBe('boolean');
        });

        it('should include reason when not available', async () => {
            const result = await checkAIAvailability();
            // In test environment, SDK is likely not available
            if (!result.available) {
                expect(typeof result.reason).toBe('string');
            }
        });
    });
});
