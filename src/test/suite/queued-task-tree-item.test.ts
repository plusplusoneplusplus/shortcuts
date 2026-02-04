/**
 * Unit tests for Queued Task Tree Items
 * Tests the QueuedTaskItem and QueuedTasksSectionItem classes
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { QueuedTaskItem, QueuedTasksSectionItem } from '../../shortcuts/ai-service/queued-task-tree-item';
import { QueuedTask, TaskPriority } from '@plusplusoneplusplus/pipeline-core';

/**
 * Create a mock QueuedTask for testing
 */
function createMockQueuedTask(overrides: Partial<QueuedTask> = {}): QueuedTask {
    return {
        id: 'task-1',
        type: 'follow-prompt',
        priority: 'normal' as TaskPriority,
        status: 'queued',
        createdAt: Date.now() - 60000, // 1 minute ago
        payload: { type: 'follow-prompt' } as any,
        config: { timeoutMs: 30000 },
        displayName: 'Test Task',
        ...overrides,
    };
}

suite('QueuedTaskItem Tests', () => {

    suite('Basic Properties', () => {

        test('should create tree item with correct label from displayName', () => {
            const task = createMockQueuedTask({ displayName: 'My Custom Task' });
            const item = new QueuedTaskItem(task, 1);

            assert.strictEqual(item.label, 'My Custom Task');
        });

        test('should create tree item with fallback label from type', () => {
            const task = createMockQueuedTask({ displayName: undefined });
            const item = new QueuedTaskItem(task, 1);

            assert.strictEqual(item.label, 'follow-prompt task');
        });

        test('should have None collapsible state', () => {
            const task = createMockQueuedTask();
            const item = new QueuedTaskItem(task, 1);

            assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
        });

        test('should store task and position', () => {
            const task = createMockQueuedTask();
            const item = new QueuedTaskItem(task, 3);

            assert.strictEqual(item.task, task);
            assert.strictEqual(item.position, 3);
        });
    });

    suite('Context Values', () => {

        test('should have correct context value for normal priority', () => {
            const task = createMockQueuedTask({ priority: 'normal' });
            const item = new QueuedTaskItem(task, 1);

            assert.strictEqual(item.contextValue, 'queuedTask_normal');
        });

        test('should have correct context value for high priority', () => {
            const task = createMockQueuedTask({ priority: 'high' });
            const item = new QueuedTaskItem(task, 1);

            assert.strictEqual(item.contextValue, 'queuedTask_high');
        });

        test('should have correct context value for low priority', () => {
            const task = createMockQueuedTask({ priority: 'low' });
            const item = new QueuedTaskItem(task, 1);

            assert.strictEqual(item.contextValue, 'queuedTask_low');
        });
    });

    suite('Description', () => {

        test('should include position in description', () => {
            const task = createMockQueuedTask({ priority: 'normal' });
            const item = new QueuedTaskItem(task, 5);

            const description = String(item.description || '');
            assert.ok(description.includes('#5'));
        });

        test('should include high priority indicator in description', () => {
            const task = createMockQueuedTask({ priority: 'high' });
            const item = new QueuedTaskItem(task, 1);

            const description = String(item.description || '');
            assert.ok(description.includes('high priority'));
        });

        test('should include low priority indicator in description', () => {
            const task = createMockQueuedTask({ priority: 'low' });
            const item = new QueuedTaskItem(task, 1);

            const description = String(item.description || '');
            assert.ok(description.includes('low priority'));
        });

        test('should not include priority indicator for normal priority', () => {
            const task = createMockQueuedTask({ priority: 'normal' });
            const item = new QueuedTaskItem(task, 1);

            const description = String(item.description || '');
            assert.ok(!description.includes('normal priority'));
            assert.ok(!description.includes('high priority'));
            assert.ok(!description.includes('low priority'));
        });

        test('should include waiting time in description', () => {
            const task = createMockQueuedTask({ priority: 'normal' });
            const item = new QueuedTaskItem(task, 1);

            const description = String(item.description || '');
            assert.ok(description.includes('waiting'));
        });
    });

    suite('Icons', () => {

        test('should have flame icon for high priority', () => {
            const task = createMockQueuedTask({ priority: 'high' });
            const item = new QueuedTaskItem(task, 1);

            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'flame');
        });

        test('should have arrow-down icon for low priority', () => {
            const task = createMockQueuedTask({ priority: 'low' });
            const item = new QueuedTaskItem(task, 1);

            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'arrow-down');
        });

        test('should have circle-outline icon for normal priority', () => {
            const task = createMockQueuedTask({ priority: 'normal' });
            const item = new QueuedTaskItem(task, 1);

            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'circle-outline');
        });
    });

    suite('Tooltip', () => {

        test('should have markdown tooltip', () => {
            const task = createMockQueuedTask();
            const item = new QueuedTaskItem(task, 1);

            assert.ok(item.tooltip instanceof vscode.MarkdownString);
        });

        test('should include task type in tooltip', () => {
            const task = createMockQueuedTask({ type: 'follow-prompt' });
            const item = new QueuedTaskItem(task, 1);

            const tooltipValue = (item.tooltip as vscode.MarkdownString).value;
            assert.ok(tooltipValue.includes('follow-prompt'));
        });

        test('should include priority in tooltip', () => {
            const task = createMockQueuedTask({ priority: 'high' });
            const item = new QueuedTaskItem(task, 1);

            const tooltipValue = (item.tooltip as vscode.MarkdownString).value;
            assert.ok(tooltipValue.includes('high'));
        });

        test('should include position in tooltip', () => {
            const task = createMockQueuedTask();
            const item = new QueuedTaskItem(task, 7);

            const tooltipValue = (item.tooltip as vscode.MarkdownString).value;
            assert.ok(tooltipValue.includes('#7'));
        });

        test('should include task ID in tooltip', () => {
            const task = createMockQueuedTask({ id: 'unique-task-id-123' });
            const item = new QueuedTaskItem(task, 1);

            const tooltipValue = (item.tooltip as vscode.MarkdownString).value;
            assert.ok(tooltipValue.includes('unique-task-id-123'));
        });

        test('should include display name in tooltip if set', () => {
            const task = createMockQueuedTask({ displayName: 'My Special Task' });
            const item = new QueuedTaskItem(task, 1);

            const tooltipValue = (item.tooltip as vscode.MarkdownString).value;
            assert.ok(tooltipValue.includes('My Special Task'));
        });
    });
});

suite('QueuedTasksSectionItem Tests', () => {

    suite('Basic Properties', () => {

        test('should create section with count', () => {
            const item = new QueuedTasksSectionItem(5, false);

            assert.strictEqual(item.label, 'Queued Tasks (5)');
        });

        test('should create section with zero count', () => {
            const item = new QueuedTasksSectionItem(0, false);

            assert.strictEqual(item.label, 'Queued Tasks');
        });

        test('should have Expanded collapsible state', () => {
            const item = new QueuedTasksSectionItem(3, false);

            assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
        });

        test('should have correct context value', () => {
            const item = new QueuedTasksSectionItem(3, false);

            assert.strictEqual(item.contextValue, 'queuedTasksSection');
        });
    });

    suite('Paused State', () => {

        test('should show paused in label when paused', () => {
            const item = new QueuedTasksSectionItem(3, true);

            assert.strictEqual(item.label, 'Queued Tasks (3, paused)');
        });

        test('should show paused in label with zero count', () => {
            const item = new QueuedTasksSectionItem(0, true);

            assert.strictEqual(item.label, 'Queued Tasks (paused)');
        });

        test('should have debug-pause icon when paused', () => {
            const item = new QueuedTasksSectionItem(3, true);

            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'debug-pause');
        });

        test('should have list-ordered icon when not paused', () => {
            const item = new QueuedTasksSectionItem(3, false);

            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'list-ordered');
        });
    });

    suite('Tooltip', () => {

        test('should have markdown tooltip', () => {
            const item = new QueuedTasksSectionItem(3, false);

            assert.ok(item.tooltip instanceof vscode.MarkdownString);
        });

        test('should indicate paused state in tooltip', () => {
            const item = new QueuedTasksSectionItem(3, true);

            const tooltipValue = (item.tooltip as vscode.MarkdownString).value;
            assert.ok(tooltipValue.includes('paused'));
        });

        test('should not indicate paused state when not paused', () => {
            const item = new QueuedTasksSectionItem(3, false);

            const tooltipValue = (item.tooltip as vscode.MarkdownString).value;
            assert.ok(!tooltipValue.includes('paused'));
        });
    });
});
