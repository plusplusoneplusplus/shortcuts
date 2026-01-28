/**
 * Unit tests for AI Process Document Provider
 * Tests the formatting of process details including backend display
 */

import * as assert from 'assert';
import { AIProcessDocumentProvider, MockAIProcessManager, AIProcess, AIBackendType } from '../../shortcuts/ai-service';

suite('AI Process Document Provider Tests', () => {

    suite('Backend Display', () => {

        test('should show backend section when backend is copilot-sdk', async () => {
            const manager = new MockAIProcessManager();
            const provider = new AIProcessDocumentProvider(manager);

            const processId = manager.registerProcess('Test prompt');
            manager.attachSessionMetadata(processId, 'copilot-sdk' as AIBackendType);
            manager.completeProcess(processId, 'Test result');

            const uri = provider.createUri(processId);
            const content = await provider.provideTextDocumentContent(uri);

            assert.ok(content.includes('## Backend'), 'Should include Backend section');
            assert.ok(content.includes('**Copilot SDK**'), 'Should show user-friendly Copilot SDK label');

            provider.dispose();
        });

        test('should show backend section when backend is copilot-cli', async () => {
            const manager = new MockAIProcessManager();
            const provider = new AIProcessDocumentProvider(manager);

            const processId = manager.registerProcess('Test prompt');
            manager.attachSessionMetadata(processId, 'copilot-cli' as AIBackendType);
            manager.completeProcess(processId, 'Test result');

            const uri = provider.createUri(processId);
            const content = await provider.provideTextDocumentContent(uri);

            assert.ok(content.includes('## Backend'), 'Should include Backend section');
            assert.ok(content.includes('**Copilot CLI**'), 'Should show user-friendly Copilot CLI label');

            provider.dispose();
        });

        test('should show backend section when backend is clipboard', async () => {
            const manager = new MockAIProcessManager();
            const provider = new AIProcessDocumentProvider(manager);

            const processId = manager.registerProcess('Test prompt');
            manager.attachSessionMetadata(processId, 'clipboard' as AIBackendType);
            manager.completeProcess(processId, 'Test result');

            const uri = provider.createUri(processId);
            const content = await provider.provideTextDocumentContent(uri);

            assert.ok(content.includes('## Backend'), 'Should include Backend section');
            assert.ok(content.includes('**Clipboard**'), 'Should show user-friendly Clipboard label');

            provider.dispose();
        });

        test('should not show backend section when backend is undefined', async () => {
            const manager = new MockAIProcessManager();
            const provider = new AIProcessDocumentProvider(manager);

            const processId = manager.registerProcess('Test prompt');
            // Don't attach any session metadata
            manager.completeProcess(processId, 'Test result');

            const uri = provider.createUri(processId);
            const content = await provider.provideTextDocumentContent(uri);

            assert.ok(!content.includes('## Backend'), 'Should not include Backend section when backend is undefined');

            provider.dispose();
        });

        test('should handle unknown backend values gracefully', async () => {
            const manager = new MockAIProcessManager();
            const provider = new AIProcessDocumentProvider(manager);

            const processId = manager.registerProcess('Test prompt');
            // Use a hypothetical unknown backend
            manager.attachSessionMetadata(processId, 'unknown-backend' as AIBackendType);
            manager.completeProcess(processId, 'Test result');

            const uri = provider.createUri(processId);
            const content = await provider.provideTextDocumentContent(uri);

            assert.ok(content.includes('## Backend'), 'Should include Backend section');
            assert.ok(content.includes('**unknown-backend**'), 'Should show the backend value as-is for unknown backends');

            provider.dispose();
        });

        test('should show backend after status section', async () => {
            const manager = new MockAIProcessManager();
            const provider = new AIProcessDocumentProvider(manager);

            const processId = manager.registerProcess('Test prompt');
            manager.attachSessionMetadata(processId, 'copilot-sdk' as AIBackendType);
            manager.completeProcess(processId, 'Test result');

            const uri = provider.createUri(processId);
            const content = await provider.provideTextDocumentContent(uri);

            const statusIndex = content.indexOf('## Status');
            const backendIndex = content.indexOf('## Backend');
            const timingIndex = content.indexOf('## Timing');

            assert.ok(statusIndex >= 0, 'Should have Status section');
            assert.ok(backendIndex >= 0, 'Should have Backend section');
            assert.ok(timingIndex >= 0, 'Should have Timing section');
            assert.ok(statusIndex < backendIndex, 'Status should come before Backend');
            assert.ok(backendIndex < timingIndex, 'Backend should come before Timing');

            provider.dispose();
        });

    });

    suite('Child Process Backend Display', () => {

        test('should show backend for child processes in code review group', async () => {
            const manager = new MockAIProcessManager();
            const provider = new AIProcessDocumentProvider(manager);

            // Create a code review group
            const groupId = manager.registerCodeReviewGroup({
                reviewType: 'commit',
                commitSha: 'abc123',
                rulesUsed: ['rule1.md']
            });

            // Create a child process
            const childId = manager.registerCodeReviewProcess(
                'Review prompt',
                {
                    reviewType: 'commit',
                    commitSha: 'abc123',
                    rulesUsed: ['rule1.md']
                },
                undefined,
                groupId
            );
            manager.attachSessionMetadata(childId, 'copilot-sdk' as AIBackendType);
            manager.completeCodeReviewProcess(childId, 'Review result', '{"issues": []}');

            // Complete the group
            manager.completeCodeReviewGroup(groupId, 'Group result', '{}', {
                totalRules: 1,
                successfulRules: 1,
                failedRules: 0,
                totalTimeMs: 1000
            });

            const uri = provider.createUri(groupId);
            const content = await provider.provideTextDocumentContent(uri);

            // The child process should have Backend section displayed
            assert.ok(content.includes('### Backend'), 'Should include Backend section for child process (### heading level)');
            assert.ok(content.includes('**Copilot SDK**'), 'Should show Copilot SDK label for child process');

            provider.dispose();
        });

    });

    suite('Process Not Found', () => {

        test('should return not found message for invalid process ID', async () => {
            const manager = new MockAIProcessManager();
            const provider = new AIProcessDocumentProvider(manager);

            const uri = provider.createUri('non-existent-id');
            const content = await provider.provideTextDocumentContent(uri);

            assert.ok(content.includes('Process Not Found'), 'Should show not found message');

            provider.dispose();
        });

    });

});
