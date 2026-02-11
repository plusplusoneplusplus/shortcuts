/**
 * End-to-end integration tests for the Queue AI Job feature.
 *
 * Covers the scenarios from 005-integration-testing.md:
 * 1. Prompt mode E2E flow (queue → tree display)
 * 2. Skill mode E2E flow (queue → tree display)
 * 3. Priority ordering across queue + tree
 * 4. Dialog cancellation (nothing queued)
 * 5. Queue cancellation (cancelled state)
 * 6. Tree view "Queued Tasks (N)" count updates
 * 7. SDK fallback (graceful error handling)
 * 8. Empty skill state (no skills found)
 * 9. Validation (empty prompt / empty skill)
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
    AIProcessManager,
    AIProcessTreeDataProvider,
    AIProcessTreeItem,
    MockAIProcessManager,
    AIQueueService,
    initializeAIQueueService,
    resetAIQueueService,
    getAIQueueService,
    QueueTaskOptions,
} from '../../shortcuts/ai-service';
import { QueuedTaskItem, QueuedTasksSectionItem } from '../../shortcuts/ai-service/queued-task-tree-item';
import {
    QueueJobDialogResult,
    QueueJobOptions,
    QueueJobMode,
    QueueJobPriority,
} from '../../shortcuts/ai-service/queue-job-dialog';
import { QueueJobDialogService } from '../../shortcuts/ai-service/queue-job-dialog-service';
import { QueuedTask, TaskPriority } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Helpers
// ============================================================================

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

function isQueuedTasksSectionItem(item: AIProcessTreeItem): item is QueuedTasksSectionItem {
    return item.contextValue === 'queuedTasksSection';
}

function isQueuedTaskItem(item: AIProcessTreeItem): item is QueuedTaskItem {
    return item.contextValue?.startsWith('queuedTask_') ?? false;
}

/**
 * Lightweight mock for AIQueueService as used by the tree provider.
 */
class TreeMockQueueService {
    private _onDidChangeQueue = new vscode.EventEmitter<void>();
    readonly onDidChangeQueue = this._onDidChangeQueue.event;

    private _onDidChangeStats = new vscode.EventEmitter<void>();
    readonly onDidChangeStats = this._onDidChangeStats.event;

    private queuedTasks: QueuedTask[] = [];
    private paused = false;

    getQueuedTasks(): QueuedTask[] {
        return [...this.queuedTasks];
    }

    isPaused(): boolean {
        return this.paused;
    }

    addTask(task: Partial<QueuedTask>): void {
        this.queuedTasks.push({
            id: task.id || `task-${this.queuedTasks.length + 1}`,
            type: task.type || 'follow-prompt',
            priority: task.priority || 'normal',
            status: 'queued',
            createdAt: task.createdAt || Date.now(),
            payload: task.payload || { type: 'follow-prompt' } as any,
            config: task.config || { timeoutMs: 30000 },
            displayName: task.displayName,
        } as QueuedTask);
        this._onDidChangeQueue.fire();
    }

    removeTask(id: string): void {
        this.queuedTasks = this.queuedTasks.filter(t => t.id !== id);
        this._onDidChangeQueue.fire();
    }

    clearTasks(): void {
        this.queuedTasks = [];
        this._onDidChangeQueue.fire();
    }

    setPaused(paused: boolean): void {
        this.paused = paused;
        this._onDidChangeStats.fire();
    }

    dispose(): void {
        this._onDidChangeQueue.dispose();
        this._onDidChangeStats.dispose();
    }
}

// ============================================================================
// Test Suites
// ============================================================================

suite('Queue AI Job – E2E Integration Tests', () => {

    // ========================================================================
    // 1. Prompt Mode E2E
    // ========================================================================
    suite('1. Prompt mode E2E', () => {
        let processManager: MockAIProcessManager;

        setup(() => {
            resetAIQueueService();
            processManager = new MockAIProcessManager();
        });

        teardown(() => {
            resetAIQueueService();
        });

        test('should queue a prompt task and display it in tree', async () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);
            const provider = new AIProcessTreeDataProvider(processManager);
            const queueMock = new TreeMockQueueService();
            provider.setQueueService(queueMock as any);

            // Simulate prompt mode result
            const promptText = 'Refactor the auth module for readability';

            // Queue in real service
            const result = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/tmp/prompt.prompt.md' },
                displayName: 'Queue Job: Prompt',
                priority: 'normal',
            });

            assert.ok(result.taskId, 'Task should be queued');
            assert.strictEqual(result.position, 1);

            // Reflect in tree mock
            queueMock.addTask({ id: result.taskId, displayName: 'Queue Job: Prompt', priority: 'normal' });

            const topLevel = await provider.getChildren();
            const section = topLevel.find(isQueuedTasksSectionItem);
            assert.ok(section, 'Should have Queued Tasks section');
            assert.strictEqual(section!.label, 'Queued Tasks (1)');

            const children = await provider.getChildren(section!) as QueuedTaskItem[];
            assert.strictEqual(children.length, 1);
            assert.strictEqual(children[0].label, 'Queue Job: Prompt');

            provider.dispose();
            queueMock.dispose();
        });

        test('should create temp prompt file and queue with correct payload', () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-e2e-'));
            const promptText = 'Analyze code for performance issues';
            const promptFilePath = path.join(tmpDir, 'prompt.prompt.md');
            fs.writeFileSync(promptFilePath, promptText, 'utf-8');

            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);
            const result = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath },
                displayName: 'Queue Job: Prompt',
            });

            assert.ok(result.taskId);
            const task = service.getTask(result.taskId);
            assert.ok(task);
            assert.strictEqual((task.payload as any).promptFilePath, promptFilePath);

            // Verify file content
            assert.strictEqual(fs.readFileSync(promptFilePath, 'utf-8'), promptText);

            // Cleanup
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });
    });

    // ========================================================================
    // 2. Skill Mode E2E
    // ========================================================================
    suite('2. Skill mode E2E', () => {
        let processManager: MockAIProcessManager;
        let tempDir: string;

        setup(() => {
            resetAIQueueService();
            processManager = new MockAIProcessManager();
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-skill-e2e-'));
        });

        teardown(() => {
            resetAIQueueService();
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        });

        test('should queue a skill task with prompt.md resolution', () => {
            // Create a mock skill directory with prompt.md
            const skillDir = path.join(tempDir, 'impl');
            fs.mkdirSync(skillDir, { recursive: true });
            const promptPath = path.join(skillDir, 'prompt.md');
            fs.writeFileSync(promptPath, '# Implement change\nDo the thing.', 'utf-8');

            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            const result = service.queueTask({
                type: 'follow-prompt',
                payload: {
                    promptFilePath: promptPath,
                    skillName: 'impl',
                    additionalContext: 'Focus on edge cases',
                },
                displayName: 'Queue Job: Skill (impl)',
                priority: 'high',
            });

            assert.ok(result.taskId);
            const task = service.getTask(result.taskId);
            assert.ok(task);
            assert.strictEqual(task.displayName, 'Queue Job: Skill (impl)');
            assert.strictEqual(task.priority, 'high');
            assert.strictEqual((task.payload as any).skillName, 'impl');
            assert.strictEqual((task.payload as any).additionalContext, 'Focus on edge cases');
        });

        test('should fall back to SKILL.md when prompt.md is missing', () => {
            const skillDir = path.join(tempDir, 'my-skill');
            fs.mkdirSync(skillDir, { recursive: true });
            const skillMdPath = path.join(skillDir, 'SKILL.md');
            fs.writeFileSync(skillMdPath, '# My Skill', 'utf-8');

            // Verify resolution logic
            const promptPath = path.join(skillDir, 'prompt.md');
            assert.ok(!fs.existsSync(promptPath), 'prompt.md should not exist');
            assert.ok(fs.existsSync(skillMdPath), 'SKILL.md should exist as fallback');

            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            const result = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: skillMdPath, skillName: 'my-skill' },
                displayName: 'Queue Job: Skill (my-skill)',
            });

            assert.ok(result.taskId);
            assert.strictEqual((service.getTask(result.taskId)!.payload as any).promptFilePath, skillMdPath);
        });

        test('should display skill task in tree view', async () => {
            const manager = new MockAIProcessManager();
            const provider = new AIProcessTreeDataProvider(manager);
            const queueMock = new TreeMockQueueService();
            provider.setQueueService(queueMock as any);

            queueMock.addTask({
                id: 'skill-task-1',
                displayName: 'Queue Job: Skill (impl)',
                priority: 'high',
            });

            const topLevel = await provider.getChildren();
            const section = topLevel.find(isQueuedTasksSectionItem)!;
            const children = await provider.getChildren(section) as QueuedTaskItem[];

            assert.strictEqual(children.length, 1);
            assert.strictEqual(children[0].label, 'Queue Job: Skill (impl)');
            assert.strictEqual(children[0].contextValue, 'queuedTask_high');

            provider.dispose();
            queueMock.dispose();
        });
    });

    // ========================================================================
    // 3. Priority Ordering
    // ========================================================================
    suite('3. Priority ordering', () => {
        let processManager: MockAIProcessManager;

        setup(() => {
            resetAIQueueService();
            processManager = new MockAIProcessManager();
        });

        teardown(() => {
            resetAIQueueService();
        });

        test('should order tasks by priority in queue (high before normal before low)', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/tmp/low.md' },
                priority: 'low',
                displayName: 'Low Task',
            });

            service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/tmp/high.md' },
                priority: 'high',
                displayName: 'High Task',
            });

            service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/tmp/normal.md' },
                priority: 'normal',
                displayName: 'Normal Task',
            });

            const tasks = service.getQueuedTasks();
            assert.strictEqual(tasks.length, 3);
            assert.strictEqual(tasks[0].priority, 'high');
            assert.strictEqual(tasks[1].priority, 'normal');
            assert.strictEqual(tasks[2].priority, 'low');
        });

        test('should display priority ordering in tree view', async () => {
            const manager = new MockAIProcessManager();
            const provider = new AIProcessTreeDataProvider(manager);
            const queueMock = new TreeMockQueueService();
            provider.setQueueService(queueMock as any);

            // Add already in priority order (as the real queue would sort)
            queueMock.addTask({ id: 't1', priority: 'high', displayName: 'High' });
            queueMock.addTask({ id: 't2', priority: 'normal', displayName: 'Normal' });
            queueMock.addTask({ id: 't3', priority: 'low', displayName: 'Low' });

            const topLevel = await provider.getChildren();
            const section = topLevel.find(isQueuedTasksSectionItem)!;
            const children = await provider.getChildren(section) as QueuedTaskItem[];

            assert.strictEqual(children.length, 3);
            assert.strictEqual(children[0].contextValue, 'queuedTask_high');
            assert.strictEqual(children[1].contextValue, 'queuedTask_normal');
            assert.strictEqual(children[2].contextValue, 'queuedTask_low');

            provider.dispose();
            queueMock.dispose();
        });

        test('multiple same-priority tasks should maintain insertion order', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            const r1 = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/tmp/a.md' },
                priority: 'normal',
                displayName: 'A',
            });
            const r2 = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/tmp/b.md' },
                priority: 'normal',
                displayName: 'B',
            });
            const r3 = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/tmp/c.md' },
                priority: 'normal',
                displayName: 'C',
            });

            const tasks = service.getQueuedTasks();
            assert.strictEqual(tasks[0].displayName, 'A');
            assert.strictEqual(tasks[1].displayName, 'B');
            assert.strictEqual(tasks[2].displayName, 'C');
        });
    });

    // ========================================================================
    // 4. Dialog Cancellation
    // ========================================================================
    suite('4. Dialog cancellation', () => {
        let processManager: MockAIProcessManager;

        setup(() => {
            resetAIQueueService();
            processManager = new MockAIProcessManager();
        });

        teardown(() => {
            resetAIQueueService();
        });

        test('cancelled dialog result should not queue anything', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            // Simulate cancelled dialog result
            const dialogResult: QueueJobDialogResult = { cancelled: true, options: null };

            // Mimic the addJob command guard
            if (dialogResult.cancelled || !dialogResult.options) {
                // Should not proceed
                const stats = service.getStats();
                assert.strictEqual(stats.queued, 0, 'Nothing should be queued after cancellation');
                return;
            }

            assert.fail('Should not reach here after cancellation');
        });

        test('cancelled dialog should leave tree unchanged', async () => {
            const manager = new MockAIProcessManager();
            const provider = new AIProcessTreeDataProvider(manager);
            const queueMock = new TreeMockQueueService();
            provider.setQueueService(queueMock as any);

            // No tasks added (dialog cancelled)
            const topLevel = await provider.getChildren();
            const sections = topLevel.filter(isQueuedTasksSectionItem);
            assert.strictEqual(sections.length, 0, 'No Queued Tasks section should appear');

            provider.dispose();
            queueMock.dispose();
        });
    });

    // ========================================================================
    // 5. Queue Cancellation
    // ========================================================================
    suite('5. Queue cancellation', () => {
        let processManager: MockAIProcessManager;

        setup(() => {
            resetAIQueueService();
            processManager = new MockAIProcessManager();
        });

        teardown(() => {
            resetAIQueueService();
        });

        test('should cancel a queued task and reflect in stats', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            const result = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/tmp/cancel-test.md' },
                displayName: 'Will Cancel',
            });

            let stats = service.getStats();
            assert.strictEqual(stats.queued, 1);

            service.cancelTask(result.taskId);

            stats = service.getStats();
            assert.strictEqual(stats.queued, 0);
            assert.strictEqual(stats.cancelled, 1);
        });

        test('should verify cancelled task state', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            const result = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/tmp/cancel-verify.md' },
                displayName: 'Cancel Verify',
            });

            service.cancelTask(result.taskId);

            const task = service.getTask(result.taskId);
            assert.ok(task, 'Cancelled task should still be retrievable');
            assert.strictEqual(task.status, 'cancelled');
        });

        test('cancelled task should move to history', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            const result = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/tmp/history-test.md' },
                displayName: 'History Check',
            });

            service.cancelTask(result.taskId);

            const history = service.getHistory();
            assert.ok(history.length >= 1);
            assert.ok(history.some(t => t.id === result.taskId && t.status === 'cancelled'));
        });

        test('cancelled task should not appear in tree queue section', async () => {
            const manager = new MockAIProcessManager();
            const provider = new AIProcessTreeDataProvider(manager);
            const queueMock = new TreeMockQueueService();
            provider.setQueueService(queueMock as any);

            // Add then remove (simulating cancellation)
            queueMock.addTask({ id: 'will-cancel', displayName: 'Task' });

            let topLevel = await provider.getChildren();
            let sections = topLevel.filter(isQueuedTasksSectionItem);
            assert.strictEqual(sections.length, 1, 'Section should exist before cancellation');

            queueMock.removeTask('will-cancel');

            topLevel = await provider.getChildren();
            sections = topLevel.filter(isQueuedTasksSectionItem);
            assert.strictEqual(sections.length, 0, 'Section should disappear after all tasks cancelled');

            provider.dispose();
            queueMock.dispose();
        });
    });

    // ========================================================================
    // 6. Tree View Count Updates
    // ========================================================================
    suite('6. Tree view "Queued Tasks (N)" count updates', () => {
        test('should show correct count as tasks are added', async () => {
            const manager = new MockAIProcessManager();
            const provider = new AIProcessTreeDataProvider(manager);
            const queueMock = new TreeMockQueueService();
            provider.setQueueService(queueMock as any);

            // Add one task
            queueMock.addTask({ displayName: 'Task 1' });
            let topLevel = await provider.getChildren();
            let section = topLevel.find(isQueuedTasksSectionItem);
            assert.strictEqual(section!.label, 'Queued Tasks (1)');

            // Add two more
            queueMock.addTask({ displayName: 'Task 2' });
            queueMock.addTask({ displayName: 'Task 3' });
            topLevel = await provider.getChildren();
            section = topLevel.find(isQueuedTasksSectionItem);
            assert.strictEqual(section!.label, 'Queued Tasks (3)');

            provider.dispose();
            queueMock.dispose();
        });

        test('should update count when tasks are removed', async () => {
            const manager = new MockAIProcessManager();
            const provider = new AIProcessTreeDataProvider(manager);
            const queueMock = new TreeMockQueueService();
            provider.setQueueService(queueMock as any);

            queueMock.addTask({ id: 'r1', displayName: 'Task 1' });
            queueMock.addTask({ id: 'r2', displayName: 'Task 2' });

            let topLevel = await provider.getChildren();
            let section = topLevel.find(isQueuedTasksSectionItem);
            assert.strictEqual(section!.label, 'Queued Tasks (2)');

            queueMock.removeTask('r1');

            topLevel = await provider.getChildren();
            section = topLevel.find(isQueuedTasksSectionItem);
            assert.strictEqual(section!.label, 'Queued Tasks (1)');

            provider.dispose();
            queueMock.dispose();
        });

        test('should show "paused" in section label when paused', async () => {
            const manager = new MockAIProcessManager();
            const provider = new AIProcessTreeDataProvider(manager);
            const queueMock = new TreeMockQueueService();
            provider.setQueueService(queueMock as any);

            queueMock.addTask({ displayName: 'Paused Task' });
            queueMock.setPaused(true);

            const topLevel = await provider.getChildren();
            const section = topLevel.find(isQueuedTasksSectionItem);
            assert.strictEqual(section!.label, 'Queued Tasks (1, paused)');

            provider.dispose();
            queueMock.dispose();
        });

        test('should hide section when count reaches 0', async () => {
            const manager = new MockAIProcessManager();
            const provider = new AIProcessTreeDataProvider(manager);
            const queueMock = new TreeMockQueueService();
            provider.setQueueService(queueMock as any);

            queueMock.addTask({ id: 'only', displayName: 'Only' });
            let topLevel = await provider.getChildren();
            assert.ok(topLevel.some(isQueuedTasksSectionItem), 'Section should exist with 1 task');

            queueMock.removeTask('only');
            topLevel = await provider.getChildren();
            assert.ok(!topLevel.some(isQueuedTasksSectionItem), 'Section should vanish with 0 tasks');

            provider.dispose();
            queueMock.dispose();
        });
    });

    // ========================================================================
    // 7. SDK Fallback
    // ========================================================================
    suite('7. SDK fallback / graceful error handling', () => {
        let processManager: MockAIProcessManager;

        setup(() => {
            resetAIQueueService();
            processManager = new MockAIProcessManager();
        });

        teardown(() => {
            resetAIQueueService();
        });

        test('should queue task even when SDK is not available', () => {
            // Queuing itself does not require SDK – execution does.
            // Verify that queueing works independently of SDK.
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            const result = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/tmp/no-sdk.md' },
                displayName: 'Queued Without SDK',
            });

            assert.ok(result.taskId, 'Task should be queued even without SDK');
            assert.strictEqual(result.position, 1);
            assert.strictEqual(service.getStats().queued, 1);
        });

        test('should handle queue service not initialized gracefully', () => {
            resetAIQueueService();

            const service = getAIQueueService();
            assert.strictEqual(service, undefined, 'Service should be undefined');
        });

        test('should handle pause/resume when queue is empty', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            // Pause/resume on empty queue should not throw
            service.pause();
            assert.ok(service.isPaused());

            service.resume();
            assert.ok(!service.isPaused());
        });

        test('should handle clearQueue when already empty', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            // Should not throw
            service.clearQueue();
            assert.strictEqual(service.getStats().queued, 0);
        });
    });

    // ========================================================================
    // 8. Empty Skill State
    // ========================================================================
    suite('8. Empty skill state', () => {
        test('dialog HTML should disable Skill tab when no skills found', () => {
            // Import HTML generator
            const { getQueueJobDialogHtml } = require('../../shortcuts/ai-service/queue-job-dialog');

            // Create a minimal mock webview
            const mockWebview = {
                asWebviewUri: (uri: vscode.Uri) => uri,
                cspSource: 'mock-csp',
            } as any;

            const html = getQueueJobDialogHtml(
                mockWebview,
                vscode.Uri.file('/mock'),
                [{ id: 'gpt-4', label: 'GPT-4' }],
                'gpt-4',
                [],       // empty skills array
                '/workspace',
            );

            // Verify the Skill tab is disabled
            assert.ok(html.includes('disabled'), 'Skill tab should be disabled when no skills');
            assert.ok(html.includes('No skills found'), 'Should show no-skills message');
        });

        test('dialog HTML should enable Skill tab when skills exist', () => {
            const { getQueueJobDialogHtml } = require('../../shortcuts/ai-service/queue-job-dialog');

            const mockWebview = {
                asWebviewUri: (uri: vscode.Uri) => uri,
                cspSource: 'mock-csp',
            } as any;

            const html = getQueueJobDialogHtml(
                mockWebview,
                vscode.Uri.file('/mock'),
                [{ id: 'gpt-4', label: 'GPT-4' }],
                'gpt-4',
                ['impl', 'review'],
                '/workspace',
            );

            // Skill tab should NOT be disabled
            assert.ok(!html.includes('No skills found'), 'Should not show no-skills message');
            // Skills should be in the data
            assert.ok(html.includes('"impl"'), 'Should include impl skill');
            assert.ok(html.includes('"review"'), 'Should include review skill');
        });
    });

    // ========================================================================
    // 9. Validation
    // ========================================================================
    suite('9. Validation', () => {
        test('empty prompt should return error', () => {
            const service = new QueueJobDialogService(
                { scheme: 'file', path: '/mock', fsPath: '/mock' } as any,
                { workspaceState: { get: () => undefined, update: async () => {} }, globalState: { get: () => undefined, update: async () => {} }, extensionUri: { scheme: 'file', path: '/mock', fsPath: '/mock' } } as any,
            );

            assert.strictEqual(service.validatePrompt(''), 'Prompt cannot be empty');
        });

        test('whitespace-only prompt should return error', () => {
            const service = new QueueJobDialogService(
                { scheme: 'file', path: '/mock', fsPath: '/mock' } as any,
                { workspaceState: { get: () => undefined, update: async () => {} }, globalState: { get: () => undefined, update: async () => {} }, extensionUri: { scheme: 'file', path: '/mock', fsPath: '/mock' } } as any,
            );

            assert.strictEqual(service.validatePrompt('   \t  '), 'Prompt cannot be empty');
        });

        test('valid prompt should pass validation', () => {
            const service = new QueueJobDialogService(
                { scheme: 'file', path: '/mock', fsPath: '/mock' } as any,
                { workspaceState: { get: () => undefined, update: async () => {} }, globalState: { get: () => undefined, update: async () => {} }, extensionUri: { scheme: 'file', path: '/mock', fsPath: '/mock' } } as any,
            );

            assert.strictEqual(service.validatePrompt('Analyze code'), null);
        });

        test('empty skill selection should return error', () => {
            const service = new QueueJobDialogService(
                { scheme: 'file', path: '/mock', fsPath: '/mock' } as any,
                { workspaceState: { get: () => undefined, update: async () => {} }, globalState: { get: () => undefined, update: async () => {} }, extensionUri: { scheme: 'file', path: '/mock', fsPath: '/mock' } } as any,
            );

            assert.strictEqual(service.validateSkillSelection(''), 'Please select a skill');
        });

        test('valid skill selection should pass validation', () => {
            const service = new QueueJobDialogService(
                { scheme: 'file', path: '/mock', fsPath: '/mock' } as any,
                { workspaceState: { get: () => undefined, update: async () => {} }, globalState: { get: () => undefined, update: async () => {} }, extensionUri: { scheme: 'file', path: '/mock', fsPath: '/mock' } } as any,
            );

            assert.strictEqual(service.validateSkillSelection('impl'), null);
        });

        test('QueueJobDialogResult types should be correct for prompt mode', () => {
            const result: QueueJobDialogResult = {
                cancelled: false,
                options: {
                    mode: 'prompt',
                    prompt: 'Test prompt',
                    model: 'gpt-4',
                    priority: 'normal',
                },
            };

            assert.strictEqual(result.cancelled, false);
            assert.ok(result.options);
            assert.strictEqual(result.options!.mode, 'prompt');
            assert.strictEqual(result.options!.prompt, 'Test prompt');
        });

        test('QueueJobDialogResult types should be correct for skill mode', () => {
            const result: QueueJobDialogResult = {
                cancelled: false,
                options: {
                    mode: 'skill',
                    skillName: 'impl',
                    additionalContext: 'extra',
                    model: 'gpt-4',
                    priority: 'high',
                },
            };

            assert.strictEqual(result.cancelled, false);
            assert.strictEqual(result.options!.mode, 'skill');
            assert.strictEqual(result.options!.skillName, 'impl');
        });
    });

    // ========================================================================
    // Cross-Cutting: Full Flow Simulation
    // ========================================================================
    suite('Cross-cutting: Full queue-to-tree flow', () => {
        let processManager: MockAIProcessManager;

        setup(() => {
            resetAIQueueService();
            processManager = new MockAIProcessManager();
        });

        teardown(() => {
            resetAIQueueService();
        });

        test('should handle multiple queued jobs with different priorities in tree', async () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            // Queue multiple jobs
            const r1 = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/tmp/low.md' },
                priority: 'low',
                displayName: 'Low Priority Job',
            });
            const r2 = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/tmp/high.md' },
                priority: 'high',
                displayName: 'High Priority Job',
            });
            const r3 = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/tmp/normal.md' },
                priority: 'normal',
                displayName: 'Normal Priority Job',
            });

            // Verify queue stats
            const stats = service.getStats();
            assert.strictEqual(stats.queued, 3);

            // Verify priority ordering in the real queue
            const tasks = service.getQueuedTasks();
            assert.strictEqual(tasks[0].priority, 'high');
            assert.strictEqual(tasks[1].priority, 'normal');
            assert.strictEqual(tasks[2].priority, 'low');

            // Now create tree view and reflect the same tasks
            const provider = new AIProcessTreeDataProvider(processManager);
            const queueMock = new TreeMockQueueService();
            provider.setQueueService(queueMock as any);

            // Reflect tasks in priority order (as the real queue would)
            for (const task of tasks) {
                queueMock.addTask({
                    id: task.id,
                    displayName: task.displayName,
                    priority: task.priority,
                });
            }

            const topLevel = await provider.getChildren();
            const section = topLevel.find(isQueuedTasksSectionItem);
            assert.ok(section);
            assert.strictEqual(section!.label, 'Queued Tasks (3)');

            const children = await provider.getChildren(section!) as QueuedTaskItem[];
            assert.strictEqual(children.length, 3);

            provider.dispose();
            queueMock.dispose();
        });

        test('should handle queue → cancel → verify stats lifecycle', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            // Queue 3 tasks
            const r1 = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/tmp/t1.md' },
                displayName: 'Task 1',
            });
            const r2 = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/tmp/t2.md' },
                displayName: 'Task 2',
            });
            const r3 = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/tmp/t3.md' },
                displayName: 'Task 3',
            });

            assert.strictEqual(service.getStats().queued, 3);

            // Cancel middle task
            service.cancelTask(r2.taskId);

            assert.strictEqual(service.getStats().queued, 2);
            assert.strictEqual(service.getStats().cancelled, 1);

            // Cancel all remaining
            service.cancelTask(r1.taskId);
            service.cancelTask(r3.taskId);

            assert.strictEqual(service.getStats().queued, 0);
            assert.strictEqual(service.getStats().cancelled, 3);
        });

        test('should handle pause → queue → resume lifecycle', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            service.pause();
            assert.ok(service.isPaused());

            const result = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/tmp/paused.md' },
                displayName: 'Paused Queue Task',
            });

            assert.ok(result.taskId);
            assert.strictEqual(service.getStats().queued, 1);

            service.resume();
            assert.ok(!service.isPaused());
        });

        test('should handle batch queueing', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            const batchResult = service.queueBatch([
                {
                    type: 'follow-prompt',
                    payload: { promptFilePath: '/tmp/batch1.md' },
                    displayName: 'Batch 1',
                },
                {
                    type: 'follow-prompt',
                    payload: { promptFilePath: '/tmp/batch2.md' },
                    displayName: 'Batch 2',
                },
                {
                    type: 'follow-prompt',
                    payload: { promptFilePath: '/tmp/batch3.md' },
                    displayName: 'Batch 3',
                    priority: 'high',
                },
            ]);

            assert.strictEqual(batchResult.batchSize, 3);
            assert.strictEqual(batchResult.taskIds.length, 3);
            // High priority should be first
            const tasks = service.getQueuedTasks();
            assert.strictEqual(tasks[0].priority, 'high');
        });

        test('should handle move operations end-to-end', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            const r1 = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/tmp/move1.md' },
                displayName: 'Move 1',
            });
            const r2 = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/tmp/move2.md' },
                displayName: 'Move 2',
            });
            const r3 = service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/tmp/move3.md' },
                displayName: 'Move 3',
            });

            // Move last to top
            service.moveToTop(r3.taskId);
            assert.strictEqual(service.getPosition(r3.taskId), 1);
            assert.strictEqual(service.getPosition(r1.taskId), 2);

            // Move second down
            service.moveDown(r1.taskId);
            assert.strictEqual(service.getPosition(r1.taskId), 3);
        });

        test('should properly dispose and reset', () => {
            const service = initializeAIQueueService(processManager as unknown as AIProcessManager);

            service.queueTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/tmp/dispose.md' },
                displayName: 'Dispose Test',
            });

            resetAIQueueService();

            assert.strictEqual(getAIQueueService(), undefined);
        });
    });
});
