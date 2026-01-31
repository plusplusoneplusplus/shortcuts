import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { 
    TaskManager, 
    TasksTreeDataProvider, 
    TaskItem, 
    Task, 
    TaskDocument,
    TaskDocumentItem,
    TaskStatus,
    updateTaskStatus
} from '../../shortcuts/tasks-viewer';

suite('Task Future Status Tests', () => {
    let tempDir: string;
    let taskManager: TaskManager;
    let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
    let mockSettings: Record<string, any>;

    setup(() => {
        // Create temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-tasks-future-test-'));

        // Default mock settings
        mockSettings = {
            enabled: true,
            folderPath: '.vscode/tasks',
            showArchived: false,
            showFuture: true,
            sortBy: 'modifiedDate',
            groupRelatedDocuments: true
        };

        // Mock vscode.workspace.getConfiguration
        originalGetConfiguration = vscode.workspace.getConfiguration;
        (vscode.workspace as any).getConfiguration = (section?: string) => {
            if (section === 'workspaceShortcuts.tasksViewer') {
                return {
                    get: <T>(key: string, defaultValue?: T): T => {
                        return (mockSettings[key] !== undefined ? mockSettings[key] : defaultValue) as T;
                    }
                };
            }
            if (section === 'workspaceShortcuts.tasksViewer.discovery') {
                return {
                    get: <T>(key: string, defaultValue?: T): T => {
                        const defaults: Record<string, any> = {
                            enabled: false,
                            showRelatedInTree: false,
                            groupByCategory: false,
                            defaultScope: {
                                includeSourceFiles: true,
                                includeDocs: true,
                                includeConfigFiles: true,
                                includeGitHistory: true,
                                maxCommits: 50
                            }
                        };
                        return (defaults[key] !== undefined ? defaults[key] : defaultValue) as T;
                    }
                };
            }
            return originalGetConfiguration(section);
        };

        taskManager = new TaskManager(tempDir);
    });

    teardown(() => {
        // Restore original getConfiguration
        (vscode.workspace as any).getConfiguration = originalGetConfiguration;

        // Dispose task manager
        taskManager.dispose();

        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    /**
     * Helper to create a task file with frontmatter
     */
    function createTaskWithStatus(name: string, status: TaskStatus): string {
        taskManager.ensureFoldersExist();
        const filePath = path.join(taskManager.getTasksFolder(), `${name}.md`);
        const content = `---
status: ${status}
---

# ${name}

Task content here.
`;
        fs.writeFileSync(filePath, content, 'utf-8');
        return filePath;
    }

    /**
     * Helper to create a task file without frontmatter
     */
    function createTaskWithoutStatus(name: string): string {
        taskManager.ensureFoldersExist();
        const filePath = path.join(taskManager.getTasksFolder(), `${name}.md`);
        const content = `# ${name}

Task content here.
`;
        fs.writeFileSync(filePath, content, 'utf-8');
        return filePath;
    }

    suite('TaskStatus Type', () => {
        test('should support all valid status values', () => {
            const validStatuses: TaskStatus[] = ['pending', 'in-progress', 'done', 'future'];
            for (const status of validStatuses) {
                assert.ok(typeof status === 'string', `${status} should be a valid TaskStatus`);
            }
        });
    });

    suite('Frontmatter Parsing', () => {
        test('should parse status: future from frontmatter', async () => {
            createTaskWithStatus('future-task', 'future');
            
            const tasks = await taskManager.getTasks();
            const futureTask = tasks.find(t => t.name === 'future-task');
            
            assert.ok(futureTask, 'Task should be found');
            assert.strictEqual(futureTask.status, 'future', 'Status should be future');
        });

        test('should parse status: pending from frontmatter', async () => {
            createTaskWithStatus('pending-task', 'pending');
            
            const tasks = await taskManager.getTasks();
            const pendingTask = tasks.find(t => t.name === 'pending-task');
            
            assert.ok(pendingTask, 'Task should be found');
            assert.strictEqual(pendingTask.status, 'pending', 'Status should be pending');
        });

        test('should parse status: in-progress from frontmatter', async () => {
            createTaskWithStatus('progress-task', 'in-progress');
            
            const tasks = await taskManager.getTasks();
            const progressTask = tasks.find(t => t.name === 'progress-task');
            
            assert.ok(progressTask, 'Task should be found');
            assert.strictEqual(progressTask.status, 'in-progress', 'Status should be in-progress');
        });

        test('should parse status: done from frontmatter', async () => {
            createTaskWithStatus('done-task', 'done');
            
            const tasks = await taskManager.getTasks();
            const doneTask = tasks.find(t => t.name === 'done-task');
            
            assert.ok(doneTask, 'Task should be found');
            assert.strictEqual(doneTask.status, 'done', 'Status should be done');
        });

        test('should return undefined status for task without frontmatter', async () => {
            createTaskWithoutStatus('no-status-task');
            
            const tasks = await taskManager.getTasks();
            const task = tasks.find(t => t.name === 'no-status-task');
            
            assert.ok(task, 'Task should be found');
            assert.strictEqual(task.status, undefined, 'Status should be undefined');
        });

        test('should return undefined status for invalid status value', async () => {
            taskManager.ensureFoldersExist();
            const filePath = path.join(taskManager.getTasksFolder(), 'invalid-status.md');
            const content = `---
status: invalid-value
---

# Invalid Status Task
`;
            fs.writeFileSync(filePath, content, 'utf-8');
            
            const tasks = await taskManager.getTasks();
            const task = tasks.find(t => t.name === 'invalid-status');
            
            assert.ok(task, 'Task should be found');
            assert.strictEqual(task.status, undefined, 'Status should be undefined for invalid value');
        });

        test('should handle frontmatter with other fields', async () => {
            taskManager.ensureFoldersExist();
            const filePath = path.join(taskManager.getTasksFolder(), 'multi-field.md');
            const content = `---
title: My Task
status: future
created: 2026-01-31
tags:
  - research
  - auth
---

# Multi Field Task
`;
            fs.writeFileSync(filePath, content, 'utf-8');
            
            const tasks = await taskManager.getTasks();
            const task = tasks.find(t => t.name === 'multi-field');
            
            assert.ok(task, 'Task should be found');
            assert.strictEqual(task.status, 'future', 'Status should be parsed correctly');
        });
    });

    suite('updateTaskStatus Function', () => {
        test('should add status to file without frontmatter', async () => {
            const filePath = createTaskWithoutStatus('add-status');
            
            await updateTaskStatus(filePath, 'future');
            
            const content = fs.readFileSync(filePath, 'utf-8');
            assert.ok(content.startsWith('---'), 'Should have frontmatter');
            assert.ok(content.includes('status: future'), 'Should have future status');
        });

        test('should update existing status in frontmatter', async () => {
            const filePath = createTaskWithStatus('update-status', 'pending');
            
            await updateTaskStatus(filePath, 'future');
            
            const content = fs.readFileSync(filePath, 'utf-8');
            assert.ok(content.includes('status: future'), 'Should have updated status');
            assert.ok(!content.includes('status: pending'), 'Should not have old status');
        });

        test('should preserve other frontmatter fields when updating status', async () => {
            taskManager.ensureFoldersExist();
            const filePath = path.join(taskManager.getTasksFolder(), 'preserve-fields.md');
            const content = `---
title: My Task
status: pending
created: 2026-01-31
---

# Preserve Fields Task
`;
            fs.writeFileSync(filePath, content, 'utf-8');
            
            await updateTaskStatus(filePath, 'future');
            
            const updatedContent = fs.readFileSync(filePath, 'utf-8');
            assert.ok(updatedContent.includes('status: future'), 'Should have updated status');
            assert.ok(updatedContent.includes('title: My Task'), 'Should preserve title');
            assert.ok(updatedContent.includes('created:'), 'Should preserve created date');
        });

        test('should preserve body content when updating status', async () => {
            const filePath = createTaskWithStatus('preserve-body', 'pending');
            
            await updateTaskStatus(filePath, 'in-progress');
            
            const content = fs.readFileSync(filePath, 'utf-8');
            assert.ok(content.includes('# preserve-body'), 'Should preserve header');
            assert.ok(content.includes('Task content here.'), 'Should preserve body');
        });

        test('should handle all status transitions', async () => {
            const filePath = createTaskWithStatus('transitions', 'pending');
            
            // pending -> future
            await updateTaskStatus(filePath, 'future');
            let tasks = await taskManager.getTasks();
            let task = tasks.find(t => t.name === 'transitions');
            assert.strictEqual(task?.status, 'future');
            
            // future -> pending
            await updateTaskStatus(filePath, 'pending');
            tasks = await taskManager.getTasks();
            task = tasks.find(t => t.name === 'transitions');
            assert.strictEqual(task?.status, 'pending');
            
            // pending -> in-progress
            await updateTaskStatus(filePath, 'in-progress');
            tasks = await taskManager.getTasks();
            task = tasks.find(t => t.name === 'transitions');
            assert.strictEqual(task?.status, 'in-progress');
            
            // in-progress -> done
            await updateTaskStatus(filePath, 'done');
            tasks = await taskManager.getTasks();
            task = tasks.find(t => t.name === 'transitions');
            assert.strictEqual(task?.status, 'done');
        });
    });

    suite('TaskItem with Status', () => {
        test('should create TaskItem with future status', () => {
            const task: Task = {
                name: 'future-task',
                filePath: '/path/to/task.md',
                modifiedTime: new Date(),
                isArchived: false,
                status: 'future'
            };
            
            const item = new TaskItem(task);
            
            assert.strictEqual(item.taskStatus, 'future');
            assert.ok(item.contextValue.includes('future'), 'Context value should include future');
        });

        test('should create TaskItem with in-progress status', () => {
            const task: Task = {
                name: 'progress-task',
                filePath: '/path/to/task.md',
                modifiedTime: new Date(),
                isArchived: false,
                status: 'in-progress'
            };
            
            const item = new TaskItem(task);
            
            assert.strictEqual(item.taskStatus, 'in-progress');
            assert.ok(item.contextValue.includes('inProgress'), 'Context value should include inProgress');
        });

        test('should create TaskItem with done status', () => {
            const task: Task = {
                name: 'done-task',
                filePath: '/path/to/task.md',
                modifiedTime: new Date(),
                isArchived: false,
                status: 'done'
            };
            
            const item = new TaskItem(task);
            
            assert.strictEqual(item.taskStatus, 'done');
            assert.ok(item.contextValue.includes('done'), 'Context value should include done');
        });

        test('should create TaskItem without status (pending default)', () => {
            const task: Task = {
                name: 'no-status-task',
                filePath: '/path/to/task.md',
                modifiedTime: new Date(),
                isArchived: false
            };
            
            const item = new TaskItem(task);
            
            assert.strictEqual(item.taskStatus, undefined);
            assert.strictEqual(item.contextValue, 'task');
        });

        test('should show status in description for future tasks', () => {
            const task: Task = {
                name: 'future-task',
                filePath: '/path/to/task.md',
                modifiedTime: new Date(),
                isArchived: false,
                status: 'future'
            };
            
            const item = new TaskItem(task);
            
            assert.ok(item.description?.toString().includes('future'), 'Description should include future');
        });

        test('should show status in tooltip', () => {
            const task: Task = {
                name: 'future-task',
                filePath: '/path/to/task.md',
                modifiedTime: new Date(),
                isArchived: false,
                status: 'future'
            };
            
            const item = new TaskItem(task);
            
            assert.ok(item.tooltip?.toString().includes('future'), 'Tooltip should include status');
        });
    });

    suite('TaskDocumentItem with Status', () => {
        test('should create TaskDocumentItem with future status', () => {
            const doc: TaskDocument = {
                baseName: 'future-doc',
                fileName: 'future-doc.md',
                filePath: '/path/to/future-doc.md',
                modifiedTime: new Date(),
                isArchived: false,
                status: 'future'
            };
            
            const item = new TaskDocumentItem(doc);
            
            assert.strictEqual(item.taskStatus, 'future');
            assert.ok(item.contextValue.includes('future'), 'Context value should include future');
        });

        test('should show status in description for future documents', () => {
            const doc: TaskDocument = {
                baseName: 'future-doc',
                fileName: 'future-doc.md',
                filePath: '/path/to/future-doc.md',
                modifiedTime: new Date(),
                isArchived: false,
                status: 'future'
            };
            
            const item = new TaskDocumentItem(doc);
            
            assert.ok(item.description?.toString().includes('future'), 'Description should include future');
        });
    });

    suite('showFuture Setting', () => {
        test('should include future tasks when showFuture is true', async () => {
            mockSettings.showFuture = true;
            
            createTaskWithStatus('future-task', 'future');
            createTaskWithStatus('pending-task', 'pending');
            
            const treeProvider = new TasksTreeDataProvider(taskManager);
            const items = await treeProvider.getChildren();
            
            // Should have both tasks
            assert.ok(items.length >= 2, 'Should have at least 2 items');
        });

        test('should exclude future tasks when showFuture is false', async () => {
            mockSettings.showFuture = false;
            mockSettings.groupRelatedDocuments = false;
            
            createTaskWithStatus('future-task', 'future');
            createTaskWithStatus('pending-task', 'pending');
            
            const treeProvider = new TasksTreeDataProvider(taskManager);
            const items = await treeProvider.getChildren();
            
            // Should only have the pending task
            const taskItems = items.filter(i => i instanceof TaskItem);
            assert.strictEqual(taskItems.length, 1, 'Should have only 1 task');
            
            const pendingItem = taskItems[0] as TaskItem;
            assert.ok(pendingItem.label === 'pending-task', 'Should be the pending task');
        });

        test('should filter future tasks in nested folders', async () => {
            mockSettings.showFuture = false;
            mockSettings.groupRelatedDocuments = true;
            
            // Create a feature folder with tasks
            const featurePath = path.join(taskManager.getTasksFolder(), 'my-feature');
            fs.mkdirSync(featurePath, { recursive: true });
            
            // Create future task in feature folder
            const futureContent = `---
status: future
---

# Future Task
`;
            fs.writeFileSync(path.join(featurePath, 'future-task.md'), futureContent, 'utf-8');
            
            // Create pending task in feature folder
            const pendingContent = `---
status: pending
---

# Pending Task
`;
            fs.writeFileSync(path.join(featurePath, 'pending-task.md'), pendingContent, 'utf-8');
            
            const treeProvider = new TasksTreeDataProvider(taskManager);
            const rootItems = await treeProvider.getChildren();
            
            // Find the feature folder
            const folderItem = rootItems.find(i => i.label === 'my-feature');
            assert.ok(folderItem, 'Feature folder should exist');
            
            // Get children of the folder
            const folderChildren = await treeProvider.getChildren(folderItem);
            const taskItems = folderChildren.filter(i => i instanceof TaskItem);
            
            // Should only have the pending task
            assert.strictEqual(taskItems.length, 1, 'Should have only 1 task in folder');
        });

        test('should show future tasks by default (showFuture defaults to true)', () => {
            const settings = taskManager.getSettings();
            assert.strictEqual(settings.showFuture, true, 'showFuture should default to true');
        });
    });

    suite('Document Grouping with Status', () => {
        test('should parse status for documents in groups', async () => {
            mockSettings.groupRelatedDocuments = true;
            
            taskManager.ensureFoldersExist();
            const tasksFolder = taskManager.getTasksFolder();
            
            // Create grouped documents with different statuses
            fs.writeFileSync(path.join(tasksFolder, 'task1.plan.md'), `---
status: future
---

# Plan
`, 'utf-8');
            
            fs.writeFileSync(path.join(tasksFolder, 'task1.spec.md'), `---
status: pending
---

# Spec
`, 'utf-8');
            
            const documents = await taskManager.getTaskDocuments();
            
            const planDoc = documents.find(d => d.fileName === 'task1.plan.md');
            const specDoc = documents.find(d => d.fileName === 'task1.spec.md');
            
            assert.ok(planDoc, 'Plan document should exist');
            assert.strictEqual(planDoc.status, 'future', 'Plan should have future status');
            
            assert.ok(specDoc, 'Spec document should exist');
            assert.strictEqual(specDoc.status, 'pending', 'Spec should have pending status');
        });

        test('should filter document groups when all documents are future', async () => {
            mockSettings.showFuture = false;
            mockSettings.groupRelatedDocuments = true;
            
            taskManager.ensureFoldersExist();
            const tasksFolder = taskManager.getTasksFolder();
            
            // Create grouped documents all with future status
            fs.writeFileSync(path.join(tasksFolder, 'future-group.plan.md'), `---
status: future
---

# Plan
`, 'utf-8');
            
            fs.writeFileSync(path.join(tasksFolder, 'future-group.spec.md'), `---
status: future
---

# Spec
`, 'utf-8');
            
            // Create a non-future task
            fs.writeFileSync(path.join(tasksFolder, 'active-task.md'), `---
status: pending
---

# Active
`, 'utf-8');
            
            const treeProvider = new TasksTreeDataProvider(taskManager);
            const items = await treeProvider.getChildren();
            
            // The future-group should be filtered out
            const groupLabels = items.map(i => i.label);
            assert.ok(!groupLabels.includes('future-group'), 'Future group should be filtered');
            assert.ok(groupLabels.includes('active-task'), 'Active task should be visible');
        });

        test('should show document group if at least one document is not future', async () => {
            mockSettings.showFuture = false;
            mockSettings.groupRelatedDocuments = true;
            
            taskManager.ensureFoldersExist();
            const tasksFolder = taskManager.getTasksFolder();
            
            // Create grouped documents with mixed statuses
            fs.writeFileSync(path.join(tasksFolder, 'mixed-group.plan.md'), `---
status: future
---

# Plan
`, 'utf-8');
            
            fs.writeFileSync(path.join(tasksFolder, 'mixed-group.spec.md'), `---
status: pending
---

# Spec
`, 'utf-8');
            
            const treeProvider = new TasksTreeDataProvider(taskManager);
            const items = await treeProvider.getChildren();
            
            // The mixed-group should be visible (has non-future document)
            const groupLabels = items.map(i => i.label);
            assert.ok(groupLabels.includes('mixed-group'), 'Mixed group should be visible');
        });
    });

    suite('Cross-Platform Compatibility', () => {
        test('should handle frontmatter parsing on all platforms', async () => {
            // Test with different line endings
            taskManager.ensureFoldersExist();
            const filePath = path.join(taskManager.getTasksFolder(), 'cross-platform.md');
            
            // Use Unix line endings
            const unixContent = '---\nstatus: future\n---\n\n# Task\n';
            fs.writeFileSync(filePath, unixContent, 'utf-8');
            
            let tasks = await taskManager.getTasks();
            let task = tasks.find(t => t.name === 'cross-platform');
            assert.strictEqual(task?.status, 'future', 'Should parse Unix line endings');
            
            // Use Windows line endings
            const windowsContent = '---\r\nstatus: pending\r\n---\r\n\r\n# Task\r\n';
            fs.writeFileSync(filePath, windowsContent, 'utf-8');
            
            tasks = await taskManager.getTasks();
            task = tasks.find(t => t.name === 'cross-platform');
            assert.strictEqual(task?.status, 'pending', 'Should parse Windows line endings');
        });

        test('should handle paths correctly on all platforms', async () => {
            // Create nested structure
            const featurePath = path.join(taskManager.getTasksFolder(), 'feature', 'subfolder');
            fs.mkdirSync(featurePath, { recursive: true });
            
            const filePath = path.join(featurePath, 'nested-task.md');
            fs.writeFileSync(filePath, `---
status: future
---

# Nested Task
`, 'utf-8');
            
            const tasks = await taskManager.getTasks();
            const nestedTask = tasks.find(t => t.name === 'nested-task');
            
            assert.ok(nestedTask, 'Nested task should be found');
            assert.strictEqual(nestedTask.status, 'future', 'Status should be parsed');
            assert.ok(nestedTask.relativePath, 'Should have relative path');
        });
    });
});
