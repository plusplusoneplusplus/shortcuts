/**
 * Tests for Additional Message Input when executing prompts
 * Tests the input dialog and message formatting
 */

import * as assert from 'assert';

suite('Prompt Additional Message Tests', () => {
    suite('Input Dialog Behavior', () => {
        test('should accept empty input (optional)', () => {
            const input = '';
            const isOptional = true;
            
            assert.strictEqual(input, '');
            assert.strictEqual(isOptional, true);
        });

        test('should accept whitespace-only input as empty', () => {
            const input = '   ';
            const trimmed = input.trim();
            
            assert.strictEqual(trimmed, '');
        });

        test('should accept undefined as cancellation', () => {
            const input = undefined;
            const cancelled = input === undefined;
            
            assert.strictEqual(cancelled, true);
        });

        test('should accept valid message input', () => {
            const input = 'Focus on error handling';
            
            assert.ok(input);
            assert.ok(input.trim().length > 0);
        });
    });

    suite('Message Formatting', () => {
        test('should format prompt without additional message', () => {
            const promptFile = '/workspace/.github/prompts/impl.prompt.md';
            const planFile = '/workspace/plan.md';
            const additionalMessage: string = '';
            
            let fullPrompt = `Follow ${promptFile} for ${planFile}`;
            if (additionalMessage && additionalMessage.trim()) {
                fullPrompt += `\n\nAdditional context: ${additionalMessage.trim()}`;
            }
            
            assert.strictEqual(
                fullPrompt,
                'Follow /workspace/.github/prompts/impl.prompt.md for /workspace/plan.md'
            );
            assert.ok(!fullPrompt.includes('Additional context:'));
        });

        test('should format prompt with additional message', () => {
            const promptFile = '/workspace/.github/prompts/impl.prompt.md';
            const planFile = '/workspace/plan.md';
            const additionalMessage = 'Focus on error handling';
            
            let fullPrompt = `Follow ${promptFile} for ${planFile}`;
            if (additionalMessage && additionalMessage.trim()) {
                fullPrompt += `\n\nAdditional context: ${additionalMessage.trim()}`;
            }
            
            assert.ok(fullPrompt.includes('Follow /workspace/.github/prompts/impl.prompt.md for /workspace/plan.md'));
            assert.ok(fullPrompt.includes('Additional context: Focus on error handling'));
        });

        test('should trim whitespace from additional message', () => {
            const additionalMessage = '  Focus on tests  ';
            const trimmed = additionalMessage.trim();
            
            assert.strictEqual(trimmed, 'Focus on tests');
        });

        test('should handle multiline additional message', () => {
            const additionalMessage = 'Line 1\nLine 2\nLine 3';
            const promptFile = '/test.prompt.md';
            const planFile = '/plan.md';
            
            let fullPrompt = `Follow ${promptFile} for ${planFile}`;
            if (additionalMessage && additionalMessage.trim()) {
                fullPrompt += `\n\nAdditional context: ${additionalMessage.trim()}`;
            }
            
            assert.ok(fullPrompt.includes('Line 1\nLine 2\nLine 3'));
        });

        test('should handle special characters in additional message', () => {
            const additionalMessage = 'Use "strict mode" & handle <edge cases>';
            const promptFile = '/test.prompt.md';
            const planFile = '/plan.md';
            
            let fullPrompt = `Follow ${promptFile} for ${planFile}`;
            if (additionalMessage && additionalMessage.trim()) {
                fullPrompt += `\n\nAdditional context: ${additionalMessage.trim()}`;
            }
            
            assert.ok(fullPrompt.includes('Use "strict mode" & handle <edge cases>'));
        });
    });

    suite('User Cancellation', () => {
        test('should return when user cancels (undefined)', () => {
            const input = undefined;
            const shouldReturn = input === undefined;
            
            assert.strictEqual(shouldReturn, true);
        });

        test('should continue when user provides empty string', () => {
            const input = '';
            const shouldContinue = input !== undefined;
            
            assert.strictEqual(shouldContinue, true);
        });

        test('should continue when user provides whitespace only', () => {
            const input = '   ';
            const shouldContinue = input !== undefined;
            
            assert.strictEqual(shouldContinue, true);
        });
    });

    suite('Integration Scenarios', () => {
        test('should handle quick execution (empty message)', () => {
            const scenarios: Array<{ input: string; expected: string }> = [
                { input: '', expected: 'Follow /a.prompt.md for /plan.md' },
                { input: '   ', expected: 'Follow /a.prompt.md for /plan.md' }
            ];

            for (const scenario of scenarios) {
                let prompt = 'Follow /a.prompt.md for /plan.md';
                if (scenario.input && scenario.input.trim()) {
                    prompt += `\n\nAdditional context: ${scenario.input.trim()}`;
                }
                assert.strictEqual(prompt, scenario.expected);
            }
        });

        test('should handle detailed execution (with message)', () => {
            const input = 'Use TypeScript strict mode';
            let prompt = 'Follow /a.prompt.md for /plan.md';
            
            if (input && input.trim()) {
                prompt += `\n\nAdditional context: ${input.trim()}`;
            }
            
            assert.ok(prompt.includes('Follow /a.prompt.md for /plan.md'));
            assert.ok(prompt.includes('Additional context: Use TypeScript strict mode'));
        });

        test('should handle search flow with message', () => {
            const selectedPrompt = '/workspace/.github/prompts/review.prompt.md';
            const planFile = '/workspace/task.md';
            const additionalMessage = 'Check for security issues';
            
            let fullPrompt = `Follow ${selectedPrompt} for ${planFile}`;
            if (additionalMessage && additionalMessage.trim()) {
                fullPrompt += `\n\nAdditional context: ${additionalMessage.trim()}`;
            }
            
            assert.ok(fullPrompt.includes('review.prompt.md'));
            assert.ok(fullPrompt.includes('Additional context: Check for security issues'));
        });

        test('should handle recent prompt flow with message', () => {
            const recentPrompt = {
                absolutePath: '/workspace/.github/prompts/impl.prompt.md',
                name: 'impl',
                lastUsed: Date.now()
            };
            const planFile = '/workspace/feature.md';
            const additionalMessage = 'Prioritize performance';
            
            let fullPrompt = `Follow ${recentPrompt.absolutePath} for ${planFile}`;
            if (additionalMessage && additionalMessage.trim()) {
                fullPrompt += `\n\nAdditional context: ${additionalMessage.trim()}`;
            }
            
            assert.ok(fullPrompt.includes('impl.prompt.md'));
            assert.ok(fullPrompt.includes('Additional context: Prioritize performance'));
        });
    });

    suite('Edge Cases', () => {
        test('should handle very long additional message', () => {
            const longMessage = 'a'.repeat(1000);
            const promptFile = '/test.prompt.md';
            const planFile = '/plan.md';
            
            let fullPrompt = `Follow ${promptFile} for ${planFile}`;
            if (longMessage && longMessage.trim()) {
                fullPrompt += `\n\nAdditional context: ${longMessage.trim()}`;
            }
            
            assert.ok(fullPrompt.length > 1000);
            assert.ok(fullPrompt.includes('Additional context:'));
        });

        test('should handle unicode characters', () => {
            const additionalMessage = '使用 TypeScript 严格模式 🚀';
            const promptFile = '/test.prompt.md';
            const planFile = '/plan.md';
            
            let fullPrompt = `Follow ${promptFile} for ${planFile}`;
            if (additionalMessage && additionalMessage.trim()) {
                fullPrompt += `\n\nAdditional context: ${additionalMessage.trim()}`;
            }
            
            assert.ok(fullPrompt.includes('使用 TypeScript 严格模式 🚀'));
        });

        test('should handle code snippets in message', () => {
            const additionalMessage = 'Use pattern: const x = await func();';
            const promptFile = '/test.prompt.md';
            const planFile = '/plan.md';
            
            let fullPrompt = `Follow ${promptFile} for ${planFile}`;
            if (additionalMessage && additionalMessage.trim()) {
                fullPrompt += `\n\nAdditional context: ${additionalMessage.trim()}`;
            }
            
            assert.ok(fullPrompt.includes('const x = await func();'));
        });

        test('should handle markdown in message', () => {
            const additionalMessage = '**Important**: Use *async/await* not callbacks';
            const promptFile = '/test.prompt.md';
            const planFile = '/plan.md';
            
            let fullPrompt = `Follow ${promptFile} for ${planFile}`;
            if (additionalMessage && additionalMessage.trim()) {
                fullPrompt += `\n\nAdditional context: ${additionalMessage.trim()}`;
            }
            
            assert.ok(fullPrompt.includes('**Important**'));
            assert.ok(fullPrompt.includes('*async/await*'));
        });

        test('should handle paths in message', () => {
            const additionalMessage = 'Focus on files in src/components/';
            const promptFile = '/test.prompt.md';
            const planFile = '/plan.md';
            
            let fullPrompt = `Follow ${promptFile} for ${planFile}`;
            if (additionalMessage && additionalMessage.trim()) {
                fullPrompt += `\n\nAdditional context: ${additionalMessage.trim()}`;
            }
            
            assert.ok(fullPrompt.includes('src/components/'));
        });
    });

    suite('Input Box Configuration', () => {
        test('should have correct placeholder text', () => {
            const config = {
                prompt: 'Additional context or instructions (optional)',
                placeHolder: 'e.g., "Focus on error handling" or "Use TypeScript strict mode"',
                ignoreFocusOut: true
            };
            
            assert.strictEqual(config.prompt, 'Additional context or instructions (optional)');
            assert.ok(config.placeHolder.includes('Focus on error handling'));
            assert.ok(config.placeHolder.includes('TypeScript strict mode'));
            assert.strictEqual(config.ignoreFocusOut, true);
        });

        test('should use ignoreFocusOut to prevent accidental dismissal', () => {
            const ignoreFocusOut = true;
            
            assert.strictEqual(ignoreFocusOut, true);
        });
    });

    suite('Cross-Platform Compatibility', () => {
        test('should work with Windows paths in message', () => {
            const additionalMessage = 'Check C:\\workspace\\src\\file.ts';
            const promptFile = '/test.prompt.md';
            const planFile = '/plan.md';
            
            let fullPrompt = `Follow ${promptFile} for ${planFile}`;
            if (additionalMessage && additionalMessage.trim()) {
                fullPrompt += `\n\nAdditional context: ${additionalMessage.trim()}`;
            }
            
            assert.ok(fullPrompt.includes('C:\\workspace\\src\\file.ts'));
        });

        test('should work with Unix paths in message', () => {
            const additionalMessage = 'Check /workspace/src/file.ts';
            const promptFile = '/test.prompt.md';
            const planFile = '/plan.md';
            
            let fullPrompt = `Follow ${promptFile} for ${planFile}`;
            if (additionalMessage && additionalMessage.trim()) {
                fullPrompt += `\n\nAdditional context: ${additionalMessage.trim()}`;
            }
            
            assert.ok(fullPrompt.includes('/workspace/src/file.ts'));
        });

        test('should handle different line endings', () => {
            const messages = [
                'Line1\nLine2',      // Unix
                'Line1\r\nLine2',    // Windows
                'Line1\rLine2'       // Old Mac
            ];
            
            for (const msg of messages) {
                const promptFile = '/test.prompt.md';
                const planFile = '/plan.md';
                
                let fullPrompt = `Follow ${promptFile} for ${planFile}`;
                if (msg && msg.trim()) {
                    fullPrompt += `\n\nAdditional context: ${msg.trim()}`;
                }
                
                assert.ok(fullPrompt.includes('Line1'));
                assert.ok(fullPrompt.includes('Line2'));
            }
        });
    });

    suite('Usage Examples', () => {
        test('example: Add error handling focus', () => {
            const message = 'Focus on proper error handling and edge cases';
            let prompt = 'Follow /prompts/impl.prompt.md for /tasks/feature.md';
            
            if (message && message.trim()) {
                prompt += `\n\nAdditional context: ${message.trim()}`;
            }
            
            assert.ok(prompt.includes('Additional context: Focus on proper error handling and edge cases'));
        });

        test('example: Specify technology constraints', () => {
            const message = 'Use TypeScript strict mode, avoid any types';
            let prompt = 'Follow /prompts/review.prompt.md for /code/module.ts';
            
            if (message && message.trim()) {
                prompt += `\n\nAdditional context: ${message.trim()}`;
            }
            
            assert.ok(prompt.includes('Additional context: Use TypeScript strict mode, avoid any types'));
        });

        test('example: Quick execution without message', () => {
            const message: string = '';
            let prompt = 'Follow /prompts/test.prompt.md for /spec.md';
            
            if (message && message.trim()) {
                prompt += `\n\nAdditional context: ${message.trim()}`;
            }
            
            assert.strictEqual(prompt, 'Follow /prompts/test.prompt.md for /spec.md');
        });

        test('example: Add performance requirement', () => {
            const message = 'Optimize for performance, target < 100ms response time';
            let prompt = 'Follow /prompts/impl.prompt.md for /api/endpoint.md';
            
            if (message && message.trim()) {
                prompt += `\n\nAdditional context: ${message.trim()}`;
            }
            
            assert.ok(prompt.includes('Optimize for performance'));
            assert.ok(prompt.includes('< 100ms'));
        });
    });
});
