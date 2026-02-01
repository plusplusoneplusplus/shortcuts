/**
 * Unit tests for AIQueueService
 * Tests the VS Code integration layer for the task queue system
 */

import * as assert from 'assert';
import {
    AIProcessManager,
    MockAIProcessManager,
    AIQueueService,
    initializeAIQueueService,
    resetAIQueueService,
    getAIQueueService
} from '../../shortcuts/ai-service';
import { buildFollowPromptText } from '../../shortcuts/ai-service/ai-queue-service';

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
    globalState = new MockGlobalState();
    workspaceState = new MockGlobalState();
}

suite('AIQueueService Tests', () => {

    let processManager: MockAIProcessManager;

    setup(() => {
        // Reset singleton before each test
        resetAIQueueService();
        processManager = new MockAIProcessManager();
    });

    teardown(() => {
        resetAIQueueService();
    });

    suite('Initialization', () => {

        test('should initialize queue service', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);
            assert.ok(service);
            assert.ok(service instanceof AIQueueService);
        });

        test('should return same instance on multiple initializations', () => {
            const service1 = initializeAIQueueService(processManager as unknown as AIProcessManager);
            const service2 = initializeAIQueueService(processManager as unknown as AIProcessManager);
            assert.strictEqual(service1, service2);
        });

        test('should get queue service after initialization', () => {
            initializeAIQueueService(processManager as unknown as AIProcessManager);
            const service = getAIQueueService();
            assert.ok(service);
        });

        test('should return undefined before initialization', () => {
            const service = getAIQueueService();
            assert.strictEqual(service, undefined);
        });
    });

    suite('Queue Operations', () => {

        test('should build follow-prompt text matching interactive/background format', () => {
            const text = buildFollowPromptText({
                promptFilePath: '/test/impl.prompt.md',
                planFilePath: '/test/task.plan.md',
                additionalContext: 'Focus on edge cases.'
            });

            assert.strictEqual(
                text,
                'Follow the instruction /test/impl.prompt.md. /test/task.plan.md\n\nAdditional context: Focus on edge cases.'
            );
        });

        test('should queue a task', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            const result = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/prompt.md' },
                displayName: 'Test Task'
            });

            assert.ok(result.taskId);
            assert.strictEqual(result.position, 1);
            assert.strictEqual(result.totalQueued, 1);
        });

        test('should queue multiple tasks', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            const result1 = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/prompt1.md' },
                displayName: 'Task 1'
            });

            const result2 = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/prompt2.md' },
                displayName: 'Task 2'
            });

            assert.strictEqual(result1.position, 1);
            assert.strictEqual(result2.position, 2);
            assert.strictEqual(result2.totalQueued, 2);
        });

        test('should queue task with priority', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            // Queue normal priority first
            service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/normal.md' },
                priority: 'normal'
            });

            // Queue high priority second - should be first
            const highResult = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/high.md' },
                priority: 'high'
            });

            assert.strictEqual(highResult.position, 1);
        });

        test('should get queued tasks', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/prompt.md' },
                displayName: 'Test Task'
            });

            const tasks = service.getQueuedTasks();
            assert.strictEqual(tasks.length, 1);
            assert.strictEqual(tasks[0].displayName, 'Test Task');
        });

        test('should get task by ID', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            const result = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/prompt.md' },
                displayName: 'Test Task'
            });

            const task = service.getTask(result.taskId);
            assert.ok(task);
            assert.strictEqual(task.id, result.taskId);
            assert.strictEqual(task.displayName, 'Test Task');
        });

        test('should get task position', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            const result1 = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/prompt1.md' }
            });

            const result2 = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/prompt2.md' }
            });

            assert.strictEqual(service.getPosition(result1.taskId), 1);
            assert.strictEqual(service.getPosition(result2.taskId), 2);
        });
    });

    suite('Queue Management', () => {

        test('should cancel a task', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            const result = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/prompt.md' }
            });

            const cancelled = service.cancelTask(result.taskId);
            assert.ok(cancelled);

            const task = service.getTask(result.taskId);
            assert.ok(task);
            assert.strictEqual(task.status, 'cancelled');
        });

        test('should move task to top', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            const result1 = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/prompt1.md' }
            });

            const result2 = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/prompt2.md' }
            });

            service.moveToTop(result2.taskId);

            assert.strictEqual(service.getPosition(result2.taskId), 1);
            assert.strictEqual(service.getPosition(result1.taskId), 2);
        });

        test('should move task up', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            const result1 = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/prompt1.md' }
            });

            const result2 = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/prompt2.md' }
            });

            service.moveUp(result2.taskId);

            assert.strictEqual(service.getPosition(result2.taskId), 1);
            assert.strictEqual(service.getPosition(result1.taskId), 2);
        });

        test('should move task down', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            const result1 = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/prompt1.md' }
            });

            const result2 = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/prompt2.md' }
            });

            service.moveDown(result1.taskId);

            assert.strictEqual(service.getPosition(result1.taskId), 2);
            assert.strictEqual(service.getPosition(result2.taskId), 1);
        });

        test('should clear queue', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/prompt1.md' }
            });

            service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/prompt2.md' }
            });

            service.clearQueue();

            const stats = service.getStats();
            assert.strictEqual(stats.queued, 0);
        });
    });

    suite('Pause/Resume', () => {

        test('should pause queue', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            assert.ok(!service.isPaused());

            service.pause();

            assert.ok(service.isPaused());
        });

        test('should resume queue', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            service.pause();
            assert.ok(service.isPaused());

            service.resume();
            assert.ok(!service.isPaused());
        });

        test('should include paused state in stats', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            let stats = service.getStats();
            assert.ok(!stats.isPaused);

            service.pause();

            stats = service.getStats();
            assert.ok(stats.isPaused);
        });
    });

    suite('Statistics', () => {

        test('should return correct stats', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/prompt1.md' }
            });

            service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/prompt2.md' }
            });

            const stats = service.getStats();
            assert.strictEqual(stats.queued, 2);
            assert.strictEqual(stats.running, 0);
            assert.strictEqual(stats.completed, 0);
            assert.strictEqual(stats.failed, 0);
            assert.strictEqual(stats.cancelled, 0);
        });

        test('should update stats when task is cancelled', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            const result = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/prompt.md' }
            });

            let stats = service.getStats();
            assert.strictEqual(stats.queued, 1);

            service.cancelTask(result.taskId);

            stats = service.getStats();
            assert.strictEqual(stats.queued, 0);
            assert.strictEqual(stats.cancelled, 1);
        });
    });

    suite('Events', () => {

        test('should emit change event when task is queued', (done) => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            const disposable = service.onDidChangeQueue((event) => {
                assert.strictEqual(event.type, 'added');
                disposable.dispose();
                done();
            });

            service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/prompt.md' }
            });
        });

        test('should emit stats change event', (done) => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            const disposable = service.onDidChangeStats((stats) => {
                assert.strictEqual(stats.queued, 1);
                disposable.dispose();
                done();
            });

            service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/prompt.md' }
            });
        });
    });

    suite('History', () => {

        test('should get task history', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            const result = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/test/prompt.md' }
            });

            service.cancelTask(result.taskId);

            const history = service.getHistory();
            assert.strictEqual(history.length, 1);
            assert.strictEqual(history[0].status, 'cancelled');
        });
    });
});
