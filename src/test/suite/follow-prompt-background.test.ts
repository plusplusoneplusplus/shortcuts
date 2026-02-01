/**
 * Unit tests for Follow Prompt Background Execution
 * 
 * Tests for the "Run in Background" option in the Follow Prompt feature,
 * which allows AI processing to run asynchronously using the SDK while
 * tracking progress in the AI Processes panel.
 */

import * as assert from 'assert';
import * as path from 'path';
import { 
    MockAIProcessManager,
    FollowPromptExecutionOptions,
    FollowPromptProcessMetadata,
    AIProcess,
    VALID_MODELS
} from '../../shortcuts/ai-service';
import {
    getAvailableModels,
    getFollowPromptDefaultMode,
    getFollowPromptDefaultModel,
    getFollowPromptRememberSelection
} from '../../shortcuts/ai-service/ai-config-helpers';

suite('Follow Prompt Background Execution Tests', () => {

    suite('Process Registration', () => {

        test('should register a follow-prompt process with correct type', () => {
            const manager = new MockAIProcessManager();
            
            const prompt = 'Follow the instruction /path/to/prompt.md. /path/to/plan.md';
            const processId = manager.registerTypedProcess(prompt, {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt',
                metadata: {
                    type: 'follow-prompt',
                    promptFile: '/path/to/prompt.md',
                    planFile: '/path/to/plan.md',
                    model: 'claude-sonnet-4.5'
                }
            });

            const process = manager.getProcess(processId);
            assert.ok(process, 'Process should exist');
            assert.strictEqual(process.type, 'follow-prompt');
            assert.strictEqual(process.status, 'running');
            assert.ok(process.id.startsWith('follow-prompt-'));
        });

        test('should store follow-prompt metadata correctly', () => {
            const manager = new MockAIProcessManager();
            
            const metadata: FollowPromptProcessMetadata = {
                promptFile: '/workspace/.github/prompts/implement.prompt.md',
                planFile: '/workspace/.vscode/tasks/feature.md',
                model: 'claude-sonnet-4.5',
                additionalContext: 'Focus on error handling',
                skillName: undefined
            };

            const prompt = `Follow the instruction ${metadata.promptFile}. ${metadata.planFile}`;
            const processId = manager.registerTypedProcess(prompt, {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt',
                metadata: {
                    type: 'follow-prompt',
                    ...metadata
                }
            });

            const process = manager.getProcess(processId);
            assert.ok(process, 'Process should exist');
            assert.ok(process.metadata, 'Metadata should exist');
            
            const storedMetadata = process.metadata as unknown as FollowPromptProcessMetadata & { type: string };
            assert.strictEqual(storedMetadata.promptFile, metadata.promptFile);
            assert.strictEqual(storedMetadata.planFile, metadata.planFile);
            assert.strictEqual(storedMetadata.model, metadata.model);
            assert.strictEqual(storedMetadata.additionalContext, metadata.additionalContext);
        });

        test('should store skill name in metadata for skill-based execution', () => {
            const manager = new MockAIProcessManager();
            
            const metadata: FollowPromptProcessMetadata = {
                promptFile: '/workspace/.github/skills/code-review/SKILL.md',
                planFile: '/workspace/.vscode/tasks/task.md',
                model: 'claude-opus-4.5',
                skillName: 'code-review'
            };

            const processId = manager.registerTypedProcess('test prompt', {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt',
                metadata: {
                    type: 'follow-prompt',
                    ...metadata
                }
            });

            const process = manager.getProcess(processId);
            assert.ok(process, 'Process should exist');
            const storedMetadata = process.metadata as unknown as FollowPromptProcessMetadata & { type: string };
            assert.strictEqual(storedMetadata.skillName, 'code-review');
        });

        test('should generate unique process IDs with timestamp', () => {
            const manager = new MockAIProcessManager();
            
            const id1 = manager.registerTypedProcess('prompt 1', {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt'
            });

            const id2 = manager.registerTypedProcess('prompt 2', {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt'
            });

            assert.notStrictEqual(id1, id2, 'Process IDs should be unique');
            assert.ok(id1.startsWith('follow-prompt-'));
            assert.ok(id2.startsWith('follow-prompt-'));
        });
    });

    suite('Process Lifecycle', () => {

        test('should complete process successfully with result', () => {
            const manager = new MockAIProcessManager();
            
            const processId = manager.registerTypedProcess('test prompt', {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt'
            });

            const result = 'AI execution completed successfully. Changes applied.';
            manager.completeProcess(processId, result);

            const process = manager.getProcess(processId);
            assert.ok(process, 'Process should exist');
            assert.strictEqual(process.status, 'completed');
            assert.strictEqual(process.result, result);
            assert.ok(process.endTime, 'End time should be set');
        });

        test('should fail process with error message', () => {
            const manager = new MockAIProcessManager();
            
            const processId = manager.registerTypedProcess('test prompt', {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt'
            });

            const errorMessage = 'SDK session timed out after 10 minutes';
            manager.failProcess(processId, errorMessage);

            const process = manager.getProcess(processId);
            assert.ok(process, 'Process should exist');
            assert.strictEqual(process.status, 'failed');
            assert.strictEqual(process.error, errorMessage);
            assert.ok(process.endTime, 'End time should be set');
        });

        test('should cancel running process', () => {
            const manager = new MockAIProcessManager();
            
            const processId = manager.registerTypedProcess('test prompt', {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt'
            });

            const cancelled = manager.cancelProcess(processId);

            assert.strictEqual(cancelled, true);
            const process = manager.getProcess(processId);
            assert.ok(process, 'Process should exist');
            assert.strictEqual(process.status, 'cancelled');
        });

        test('should not cancel already completed process', () => {
            const manager = new MockAIProcessManager();
            
            const processId = manager.registerTypedProcess('test prompt', {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt'
            });

            manager.completeProcess(processId, 'done');
            const cancelled = manager.cancelProcess(processId);

            assert.strictEqual(cancelled, false);
            const process = manager.getProcess(processId);
            assert.strictEqual(process?.status, 'completed');
        });
    });

    suite('Prompt Building', () => {

        test('should build basic prompt without additional context', () => {
            const promptFilePath = '/workspace/.github/prompts/implement.prompt.md';
            const planFilePath = '/workspace/.vscode/tasks/feature.md';
            
            const fullPrompt = `Follow the instruction ${promptFilePath}. ${planFilePath}`;
            
            assert.ok(fullPrompt.includes('Follow the instruction'));
            assert.ok(fullPrompt.includes(promptFilePath));
            assert.ok(fullPrompt.includes(planFilePath));
            assert.ok(!fullPrompt.includes('Additional context'));
        });

        test('should include additional context when provided', () => {
            const promptFilePath = '/workspace/.github/prompts/implement.prompt.md';
            const planFilePath = '/workspace/.vscode/tasks/feature.md';
            const additionalContext = 'Focus on error handling';
            
            let fullPrompt = `Follow the instruction ${promptFilePath}. ${planFilePath}`;
            if (additionalContext && additionalContext.trim()) {
                fullPrompt += `\n\nAdditional context: ${additionalContext.trim()}`;
            }
            
            assert.ok(fullPrompt.includes('Additional context: Focus on error handling'));
        });

        test('should trim whitespace from additional context', () => {
            const additionalContext = '  Focus on error handling  ';
            
            let fullPrompt = 'Follow the instruction /path/to/prompt.md. /path/to/plan.md';
            if (additionalContext && additionalContext.trim()) {
                fullPrompt += `\n\nAdditional context: ${additionalContext.trim()}`;
            }
            
            assert.ok(fullPrompt.includes('Additional context: Focus on error handling'));
            assert.ok(!fullPrompt.includes('Additional context:   Focus'));
        });

        test('should not add additional context section for empty/whitespace input', () => {
            const emptyContexts = ['', '   ', '\t\n', undefined as string | undefined];
            
            for (const context of emptyContexts) {
                let fullPrompt = 'Follow the instruction /path/to/prompt.md. /path/to/plan.md';
                if (context && context.trim()) {
                    fullPrompt += `\n\nAdditional context: ${context.trim()}`;
                }
                
                assert.ok(!fullPrompt.includes('Additional context:'), 
                    `Empty context "${context}" should not add Additional context section`);
            }
        });
    });

    suite('Execution Options', () => {

        test('should validate interactive mode options', () => {
            const options: FollowPromptExecutionOptions = {
                mode: 'interactive',
                model: 'claude-sonnet-4.5'
            };
            
            assert.strictEqual(options.mode, 'interactive');
            assert.strictEqual(options.timeoutMs, undefined);
        });

        test('should validate background mode options with timeout', () => {
            const options: FollowPromptExecutionOptions = {
                mode: 'background',
                model: 'claude-sonnet-4.5',
                timeoutMs: 1800000 // 30 minutes default
            };
            
            assert.strictEqual(options.mode, 'background');
            assert.strictEqual(options.timeoutMs, 1800000);
        });

        test('should validate all supported AI models', () => {
            const availableModels = getAvailableModels();
            
            for (const model of availableModels) {
                const options: FollowPromptExecutionOptions = {
                    mode: 'background',
                    model: model.id
                };
                
                assert.ok(VALID_MODELS.includes(options.model as typeof VALID_MODELS[number]),
                    `Model ${model.id} should be in VALID_MODELS`);
            }
        });

        test('should allow custom timeout values', () => {
            const customTimeouts = [30000, 60000, 300000, 1800000, 3600000];
            
            for (const timeout of customTimeouts) {
                const options: FollowPromptExecutionOptions = {
                    mode: 'background',
                    model: 'claude-sonnet-4.5',
                    timeoutMs: timeout
                };
                
                assert.strictEqual(options.timeoutMs, timeout);
            }
        });
    });

    suite('Process Querying', () => {

        test('should find follow-prompt processes by type', () => {
            const manager = new MockAIProcessManager();
            
            // Register mixed processes
            manager.registerTypedProcess('follow prompt 1', {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt'
            });
            manager.registerTypedProcess('follow prompt 2', {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt'
            });
            manager.registerTypedProcess('code review', {
                type: 'code-review',
                idPrefix: 'code-review'
            });

            const allProcesses = manager.getProcesses();
            const followPromptProcesses = allProcesses.filter(p => p.type === 'follow-prompt');

            assert.strictEqual(followPromptProcesses.length, 2);
            for (const process of followPromptProcesses) {
                assert.strictEqual(process.type, 'follow-prompt');
            }
        });

        test('should get running follow-prompt processes', () => {
            const manager = new MockAIProcessManager();
            
            const id1 = manager.registerTypedProcess('running process', {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt'
            });
            const id2 = manager.registerTypedProcess('completed process', {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt'
            });
            
            manager.completeProcess(id2, 'done');

            const runningProcesses = manager.getRunningProcesses();
            const runningFollowPrompt = runningProcesses.filter(p => p.type === 'follow-prompt');

            assert.strictEqual(runningFollowPrompt.length, 1);
            assert.strictEqual(runningFollowPrompt[0].id, id1);
        });

        test('should correctly count follow-prompt processes by status', () => {
            const manager = new MockAIProcessManager();
            
            const id1 = manager.registerTypedProcess('running', { type: 'follow-prompt' });
            const id2 = manager.registerTypedProcess('completed', { type: 'follow-prompt' });
            const id3 = manager.registerTypedProcess('failed', { type: 'follow-prompt' });
            const id4 = manager.registerTypedProcess('cancelled', { type: 'follow-prompt' });

            manager.completeProcess(id2, 'done');
            manager.failProcess(id3, 'error');
            manager.cancelProcess(id4);

            const counts = manager.getProcessCounts();
            assert.strictEqual(counts.running, 1);
            assert.strictEqual(counts.completed, 1);
            assert.strictEqual(counts.failed, 1);
            assert.strictEqual(counts.cancelled, 1);
        });
    });

    suite('Error Handling', () => {

        test('should handle SDK unavailable error', () => {
            const manager = new MockAIProcessManager();
            
            const processId = manager.registerTypedProcess('test prompt', {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt'
            });

            const sdkError = 'Copilot SDK is not available. Please ensure you are signed in to GitHub Copilot.';
            manager.failProcess(processId, sdkError);

            const process = manager.getProcess(processId);
            assert.ok(process?.error?.includes('SDK'));
        });

        test('should handle timeout error', () => {
            const manager = new MockAIProcessManager();
            
            const processId = manager.registerTypedProcess('test prompt', {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt'
            });

            const timeoutError = 'Request timed out after 1800000ms';
            manager.failProcess(processId, timeoutError);

            const process = manager.getProcess(processId);
            assert.ok(process, 'Process should exist');
            assert.strictEqual(process.status, 'failed');
            assert.ok(process.error, 'Error should be set');
            assert.ok(process.error.toLowerCase().includes('timed out'), 
                `Error should include "timed out" but was: ${process.error}`);
        });

        test('should handle network error', () => {
            const manager = new MockAIProcessManager();
            
            const processId = manager.registerTypedProcess('test prompt', {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt'
            });

            const networkError = 'Network error: Connection refused';
            manager.failProcess(processId, networkError);

            const process = manager.getProcess(processId);
            assert.ok(process?.error?.includes('Network'));
        });

        test('should preserve error message in failed process', () => {
            const manager = new MockAIProcessManager();
            
            const processId = manager.registerTypedProcess('test prompt', {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt'
            });

            const complexError = 'Error during AI execution:\n  - SDK connection lost\n  - Retry limit exceeded (3 attempts)\n  - Last error: timeout';
            manager.failProcess(processId, complexError);

            const process = manager.getProcess(processId);
            assert.strictEqual(process?.error, complexError);
        });
    });

    suite('Cross-Platform Path Handling', () => {

        test('should handle Unix-style paths', () => {
            const manager = new MockAIProcessManager();
            
            const metadata: FollowPromptProcessMetadata = {
                promptFile: '/home/user/workspace/.github/prompts/implement.prompt.md',
                planFile: '/home/user/workspace/.vscode/tasks/feature.md',
                model: 'claude-sonnet-4.5'
            };

            const prompt = `Follow the instruction ${metadata.promptFile}. ${metadata.planFile}`;
            const processId = manager.registerTypedProcess(prompt, {
                type: 'follow-prompt',
                metadata: { type: 'follow-prompt', ...metadata }
            });

            const process = manager.getProcess(processId);
            const storedMeta = process?.metadata as unknown as FollowPromptProcessMetadata & { type: string };
            assert.ok(storedMeta.promptFile.includes('/home/user/'));
            assert.ok(storedMeta.planFile.includes('/home/user/'));
        });

        test('should handle Windows-style paths', () => {
            const manager = new MockAIProcessManager();
            
            const metadata: FollowPromptProcessMetadata = {
                promptFile: 'C:\\Users\\user\\workspace\\.github\\prompts\\implement.prompt.md',
                planFile: 'C:\\Users\\user\\workspace\\.vscode\\tasks\\feature.md',
                model: 'claude-sonnet-4.5'
            };

            const prompt = `Follow the instruction ${metadata.promptFile}. ${metadata.planFile}`;
            const processId = manager.registerTypedProcess(prompt, {
                type: 'follow-prompt',
                metadata: { type: 'follow-prompt', ...metadata }
            });

            const process = manager.getProcess(processId);
            const storedMeta = process?.metadata as unknown as FollowPromptProcessMetadata & { type: string };
            assert.ok(storedMeta.promptFile.includes('C:\\Users'));
            assert.ok(storedMeta.planFile.includes('C:\\Users'));
        });

        test('should handle macOS-style paths', () => {
            const manager = new MockAIProcessManager();
            
            const metadata: FollowPromptProcessMetadata = {
                promptFile: '/Users/developer/Projects/app/.github/prompts/implement.prompt.md',
                planFile: '/Users/developer/Projects/app/.vscode/tasks/feature.md',
                model: 'claude-sonnet-4.5'
            };

            const prompt = `Follow the instruction ${metadata.promptFile}. ${metadata.planFile}`;
            const processId = manager.registerTypedProcess(prompt, {
                type: 'follow-prompt',
                metadata: { type: 'follow-prompt', ...metadata }
            });

            const process = manager.getProcess(processId);
            const storedMeta = process?.metadata as unknown as FollowPromptProcessMetadata & { type: string };
            assert.ok(storedMeta.promptFile.includes('/Users/developer/'));
            assert.ok(storedMeta.planFile.includes('/Users/developer/'));
        });

        test('should handle paths with spaces', () => {
            const manager = new MockAIProcessManager();
            
            const metadata: FollowPromptProcessMetadata = {
                promptFile: '/Users/My User/My Project/.github/prompts/implement.prompt.md',
                planFile: '/Users/My User/My Project/.vscode/tasks/my feature.md',
                model: 'claude-sonnet-4.5'
            };

            const processId = manager.registerTypedProcess('test', {
                type: 'follow-prompt',
                metadata: { type: 'follow-prompt', ...metadata }
            });

            const process = manager.getProcess(processId);
            const storedMeta = process?.metadata as unknown as FollowPromptProcessMetadata & { type: string };
            assert.ok(storedMeta.promptFile.includes('My User'));
            assert.ok(storedMeta.planFile.includes('my feature.md'));
        });

        test('should handle paths with special characters', () => {
            const manager = new MockAIProcessManager();
            
            const metadata: FollowPromptProcessMetadata = {
                promptFile: '/workspace/项目/.github/prompts/implement.prompt.md',
                planFile: '/workspace/项目/.vscode/tasks/功能.md',
                model: 'claude-sonnet-4.5'
            };

            const processId = manager.registerTypedProcess('test', {
                type: 'follow-prompt',
                metadata: { type: 'follow-prompt', ...metadata }
            });

            const process = manager.getProcess(processId);
            const storedMeta = process?.metadata as unknown as FollowPromptProcessMetadata & { type: string };
            assert.ok(storedMeta.promptFile.includes('项目'));
            assert.ok(storedMeta.planFile.includes('功能.md'));
        });
    });

    suite('SDK Session Tracking', () => {

        test('should attach SDK session ID to process', () => {
            const manager = new MockAIProcessManager();
            
            const processId = manager.registerTypedProcess('test prompt', {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt'
            });

            const sessionId = 'sdk-session-12345';
            manager.attachSdkSessionId(processId, sessionId);

            const storedSessionId = manager.getSdkSessionId(processId);
            assert.strictEqual(storedSessionId, sessionId);
        });

        test('should attach session metadata for resume support', () => {
            const manager = new MockAIProcessManager();
            
            const processId = manager.registerTypedProcess('test prompt', {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt'
            });

            manager.attachSdkSessionId(processId, 'session-123');
            manager.attachSessionMetadata(processId, 'copilot-sdk', '/workspace');

            const metadata = manager.getSessionMetadata(processId);
            assert.ok(metadata);
            assert.strictEqual(metadata.sdkSessionId, 'session-123');
            assert.strictEqual(metadata.backend, 'copilot-sdk');
            assert.strictEqual(metadata.workingDirectory, '/workspace');
        });

        test('should check if process is resumable', () => {
            const manager = new MockAIProcessManager();
            
            const processId = manager.registerTypedProcess('test prompt', {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt'
            });

            // Before attaching session info
            assert.strictEqual(manager.isProcessResumable(processId), false);

            // Attach session info
            manager.attachSdkSessionId(processId, 'session-123');
            manager.attachSessionMetadata(processId, 'copilot-sdk', '/workspace');
            
            // Complete the process
            manager.completeProcess(processId, 'done');

            // After completing with SDK session
            assert.strictEqual(manager.isProcessResumable(processId), true);
        });
    });

    suite('Process Events', () => {

        test('should emit event when process is registered', (done) => {
            const manager = new MockAIProcessManager();
            
            const disposable = manager.onDidChangeProcesses((event) => {
                if (event.type === 'process-added' && event.process?.type === 'follow-prompt') {
                    disposable.dispose();
                    done();
                }
            });

            manager.registerTypedProcess('test prompt', {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt'
            });
        });

        test('should emit event when process status changes', (done) => {
            const manager = new MockAIProcessManager();
            
            const processId = manager.registerTypedProcess('test prompt', {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt'
            });

            const disposable = manager.onDidChangeProcesses((event) => {
                if (event.type === 'process-updated' && 
                    event.process?.id === processId && 
                    event.process?.status === 'completed') {
                    disposable.dispose();
                    done();
                }
            });

            manager.completeProcess(processId, 'done');
        });

        test('should emit event when process is removed', (done) => {
            const manager = new MockAIProcessManager();
            
            const processId = manager.registerTypedProcess('test prompt', {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt'
            });

            manager.completeProcess(processId, 'done');

            const disposable = manager.onDidChangeProcesses((event) => {
                if (event.type === 'process-removed' && event.process?.id === processId) {
                    disposable.dispose();
                    done();
                }
            });

            manager.removeProcess(processId);
        });
    });

    suite('Display Name Generation', () => {

        test('should generate display name for prompt file', () => {
            const promptFilePath = '/workspace/.github/prompts/implement.prompt.md';
            const planFilePath = '/workspace/.vscode/tasks/feature.md';
            
            const promptName = path.basename(promptFilePath, '.prompt.md');
            const planName = path.basename(planFilePath);
            const displayName = `Follow Prompt: ${promptName} → ${planName}`;

            assert.strictEqual(displayName, 'Follow Prompt: implement → feature.md');
        });

        test('should generate display name for skill', () => {
            const skillName = 'code-review';
            const planFilePath = '/workspace/.vscode/tasks/feature.md';
            
            const displayName = `Skill: ${skillName}`;
            const processName = `${displayName} → ${path.basename(planFilePath)}`;

            assert.ok(processName.includes('Skill: code-review'));
            assert.ok(processName.includes('feature.md'));
        });

        test('should handle prompt files without .prompt.md extension', () => {
            const promptFilePath = '/workspace/.github/prompts/review.md';
            const planFilePath = '/workspace/.vscode/tasks/task.md';
            
            // The implementation uses .prompt.md but should handle other extensions
            const promptName = path.basename(promptFilePath, '.prompt.md');
            // If no .prompt.md extension, basename returns full name
            assert.strictEqual(promptName, 'review.md');
        });
    });

    suite('Process Cleanup', () => {

        test('should clear completed follow-prompt processes', () => {
            const manager = new MockAIProcessManager();
            
            const id1 = manager.registerTypedProcess('running', { type: 'follow-prompt' });
            const id2 = manager.registerTypedProcess('completed', { type: 'follow-prompt' });
            const id3 = manager.registerTypedProcess('failed', { type: 'follow-prompt' });

            manager.completeProcess(id2, 'done');
            manager.failProcess(id3, 'error');

            manager.clearCompletedProcesses();

            // Only running process should remain
            assert.ok(manager.getProcess(id1), 'Running process should exist');
            assert.ok(!manager.getProcess(id2), 'Completed process should be removed');
            assert.ok(!manager.getProcess(id3), 'Failed process should be removed');
        });

        test('should clear all processes including running ones', () => {
            const manager = new MockAIProcessManager();
            
            manager.registerTypedProcess('running', { type: 'follow-prompt' });
            manager.registerTypedProcess('completed', { type: 'follow-prompt' });

            manager.clearAllProcesses();

            const allProcesses = manager.getProcesses();
            assert.strictEqual(allProcesses.length, 0);
        });
    });
});
