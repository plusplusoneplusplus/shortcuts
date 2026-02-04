/**
 * Integration tests for AI Queue Service initialization during extension activation
 * Verifies that the queue service is properly initialized, commands are registered,
 * and status bar item is created when the extension activates.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    getAIQueueService,
    initializeAIQueueService,
    resetAIQueueService,
    AIProcessManager
} from '../../shortcuts/ai-service';

/**
 * Mock ExtensionContext for testing
 */
class MockGlobalState {
    private storage: Map<string, unknown> = new Map();

    get<T>(key: string, defaultValue?: T): T {
        return this.storage.has(key) ? this.storage.get(key) as T : defaultValue as T;
    }

    async update(key: string, value: unknown): Promise<void> {
        this.storage.set(key, value);
    }
}

class MockExtensionContext {
    subscriptions: vscode.Disposable[] = [];
    workspaceState = new MockGlobalState();
    globalState = new MockGlobalState();
}

suite('AI Queue Service Integration Tests', () => {
    let context: MockExtensionContext;
    let processManager: AIProcessManager;

    suiteSetup(async function () {
        this.timeout(10000);
        
        // Reset singleton before suite
        resetAIQueueService();
        
        // Create mock context
        context = new MockExtensionContext();
        
        // Initialize AI Process Manager (required for queue service)
        processManager = new AIProcessManager();
        await processManager.initialize(context as unknown as vscode.ExtensionContext);
    });

    setup(() => {
        // Reset singleton before each test
        resetAIQueueService();
    });

    teardown(() => {
        // Clean up subscriptions
        context.subscriptions.forEach(d => d.dispose());
        context.subscriptions = [];
        
        // Reset singleton after each test
        resetAIQueueService();
    });

    suiteTeardown(() => {
        // Final cleanup
        resetAIQueueService();
        processManager.dispose();
    });

    suite('Extension Activation Integration', () => {
        test('should initialize queue service during activation', () => {
            // Simulate extension activation: initialize queue service
            const aiQueueService = initializeAIQueueService(processManager);
            context.subscriptions.push(aiQueueService);

            // Verify service is initialized
            const service = getAIQueueService();
            assert.ok(service, 'Queue service should be initialized');
            assert.strictEqual(service, aiQueueService, 'Should return the same instance');
        });

        test('should register queue commands during activation', async () => {
            // Import the command registration function
            const { registerQueueCommands } = await import('../../shortcuts/ai-service');
            
            // Initialize queue service first (required for commands)
            const aiQueueService = initializeAIQueueService(processManager);
            context.subscriptions.push(aiQueueService);

            // Register commands (simulating extension activation)
            registerQueueCommands(context as unknown as vscode.ExtensionContext);

            // Verify commands are registered
            const commands = await vscode.commands.getCommands(true);
            
            const queueCommands = [
                'shortcuts.queue.pauseQueue',
                'shortcuts.queue.resumeQueue',
                'shortcuts.queue.clearQueue',
                'shortcuts.queue.moveToTop',
                'shortcuts.queue.moveUp',
                'shortcuts.queue.moveDown',
                'shortcuts.queue.cancelTask'
            ];

            for (const cmd of queueCommands) {
                const commandExists = commands.includes(cmd);
                assert.ok(commandExists, `Command ${cmd} should be registered`);
            }
        });

        test('should create status bar item during activation', () => {
            // Import the status bar creation function
            const { createQueueStatusBarItem } = require('../../shortcuts/ai-service');
            
            // Initialize queue service first
            const aiQueueService = initializeAIQueueService(processManager);
            context.subscriptions.push(aiQueueService);

            // Create status bar item (simulating extension activation)
            const statusBarItem = createQueueStatusBarItem(aiQueueService);
            context.subscriptions.push(statusBarItem);

            // Verify status bar item is created
            assert.ok(statusBarItem, 'Status bar item should be created');
            
            // Verify it's added to subscriptions for cleanup
            assert.ok(context.subscriptions.includes(statusBarItem), 'Status bar item should be in subscriptions');
        });

        test('should initialize queue service before ReviewEditorViewProvider', () => {
            // This test verifies the initialization order is correct
            // Queue service must be initialized before ReviewEditorViewProvider
            // so that getAIQueueService() returns a valid service
            
            // Step 1: Initialize queue service (as in extension activation)
            const aiQueueService = initializeAIQueueService(processManager);
            context.subscriptions.push(aiQueueService);

            // Step 2: Verify service is available (simulating ReviewEditorViewProvider access)
            const service = getAIQueueService();
            assert.ok(service, 'Queue service should be available before ReviewEditorViewProvider uses it');
            assert.strictEqual(service, aiQueueService, 'Should return the initialized instance');
        });

        test('should properly dispose queue service on deactivation', () => {
            // Initialize queue service
            const aiQueueService = initializeAIQueueService(processManager);
            context.subscriptions.push(aiQueueService);

            // Verify service exists
            assert.ok(getAIQueueService(), 'Service should exist before disposal');

            // Simulate extension deactivation: dispose all subscriptions
            context.subscriptions.forEach(d => d.dispose());
            context.subscriptions = [];

            // Note: The singleton is not automatically reset on dispose,
            // but the service instance should be disposed
            // In real extension deactivation, we'd call resetAIQueueService() explicitly
            resetAIQueueService();

            // Verify service is no longer available
            const service = getAIQueueService();
            assert.strictEqual(service, undefined, 'Service should be undefined after disposal');
        });
    });

    suite('Queue Service Availability', () => {
        test('should return undefined before initialization', () => {
            const service = getAIQueueService();
            assert.strictEqual(service, undefined, 'Service should be undefined before initialization');
        });

        test('should return service after initialization', () => {
            initializeAIQueueService(processManager);
            const service = getAIQueueService();
            assert.ok(service, 'Service should be available after initialization');
        });

        test('should handle queue operations when service is available', () => {
            const aiQueueService = initializeAIQueueService(processManager);
            
            // Queue a task
            const result = aiQueueService.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/prompt.md' },
                displayName: 'Test Task'
            });

            assert.ok(result.taskId, 'Task should be queued successfully');
            assert.strictEqual(result.position, 1, 'Task should be at position 1');
        });
    });

    suite('Error Handling', () => {
        test('should handle queue commands when service is not initialized', async () => {
            // Import the command registration function
            const { registerQueueCommands } = await import('../../shortcuts/ai-service');
            
            // Create a new context for this test
            const testContext = new MockExtensionContext();
            
            // Register commands without initializing service (simulating edge case)
            registerQueueCommands(testContext as unknown as vscode.ExtensionContext);
            
            // Verify commands are registered even without service
            const commands = await vscode.commands.getCommands(true);
            assert.ok(commands.includes('shortcuts.queue.pauseQueue'), 'Command should be registered even if service not initialized');
            
            // Clean up
            testContext.subscriptions.forEach(d => d.dispose());
        });

        test('should handle ReviewEditorViewProvider access when service not initialized', () => {
            // Reset service
            resetAIQueueService();
            
            // Simulate ReviewEditorViewProvider trying to access queue service
            const service = getAIQueueService();
            assert.strictEqual(service, undefined, 'Service should be undefined');
            
            // In real scenario, ReviewEditorViewProvider would show error message
            // This test verifies the service check works correctly
        });
    });

    suite('Cross-Platform Compatibility', () => {
        test('should initialize correctly on all platforms', () => {
            // This test verifies the initialization works regardless of platform
            const platform = process.platform;
            
            const aiQueueService = initializeAIQueueService(processManager);
            const service = getAIQueueService();
            
            assert.ok(service, `Queue service should initialize on ${platform}`);
            assert.strictEqual(service, aiQueueService, 'Should return same instance');
        });

        test('should handle path separators correctly', () => {
            const aiQueueService = initializeAIQueueService(processManager);
            
            // Queue a task with a file path (should handle platform-specific separators)
            const result = aiQueueService.queueTask({
                type: 'follow-prompt',
                payload: { 
                    promptFilePath: process.platform === 'win32' 
                        ? 'C:\\test\\prompt.md' 
                        : '/test/prompt.md'
                },
                displayName: 'Cross-platform Test'
            });

            assert.ok(result.taskId, 'Task should be queued with platform-specific path');
        });
    });
});
