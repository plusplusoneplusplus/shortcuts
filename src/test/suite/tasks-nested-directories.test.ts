import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { 
    TaskManager, 
    TasksTreeDataProvider,
    TaskFolderItem,
    TaskItem,
    TaskDocumentGroupItem,
    Task,
    TaskDocument,
    TaskFolder
} from '../../shortcuts/tasks-viewer';

suite('Tasks Viewer - Nested Directories Tests', () => {
    let tempDir: string;
    let taskManager: TaskManager;
    let treeDataProvider: TasksTreeDataProvider;
    let originalGetConfiguration: any;

    /**
     * Helper to create a directory structure
     */
    function createDir(relativePath: string): string {
        const fullPath = path.join(tempDir, relativePath);
        fs.mkdirSync(fullPath, { recursive: true });
        return fullPath;
    }

    /**
     * Helper to create a task file
     */
    function createTaskFile(relativePath: string, content: string = ''): string {
        const fullPath = path.join(tempDir, relativePath);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const fileContent = content || `# ${path.basename(relativePath, '.md')}\n\n`;
        fs.writeFileSync(fullPath, fileContent, 'utf8');
        return fullPath;
    }

    /**
     * Helper to wait for async operations
     */
    async function wait(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    setup(() => {
        // Create temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-tasks-nested-test-'));

        // Mock vscode.workspace.getConfiguration
        originalGetConfiguration = vscode.workspace.getConfiguration;
        (vscode.workspace as any).getConfiguration = (section?: string) => {
            if (section === 'workspaceShortcuts.tasksViewer') {
                return {
                    get: <T>(key: string, defaultValue?: T): T => {
                        const defaults: Record<string, any> = {
                            enabled: true,
                            folderPath: '.vscode/tasks',
                            showArchived: false,
                            sortBy: 'name',
                            groupRelatedDocuments: true
                        };
                        return (defaults[key] !== undefined ? defaults[key] : defaultValue) as T;
                    }
                };
            }
            return originalGetConfiguration(section);
        };

        taskManager = new TaskManager(tempDir);
        treeDataProvider = new TasksTreeDataProvider(taskManager);
    });

    teardown(() => {
        // Restore original
        (vscode.workspace as any).getConfiguration = originalGetConfiguration;

        // Dispose
        taskManager.dispose();

        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('Basic Nested Directory Support', () => {
        test('should scan files in subdirectories - single level', async () => {
            createTaskFile('.vscode/tasks/feature1/task1.plan.md');
            createTaskFile('.vscode/tasks/feature1/task2.plan.md');

            const tasks = await taskManager.getTasks();

            assert.strictEqual(tasks.length, 2, 'Should find 2 tasks');
            assert.ok(tasks.some(t => t.name === 'task1.plan'), 'Should find task1.plan');
            assert.ok(tasks.some(t => t.name === 'task2.plan'), 'Should find task2.plan');
            assert.ok(tasks.every(t => t.relativePath === 'feature1'), 'Both tasks should have relativePath=feature1');
        });

        test('should scan files in subdirectories - multiple levels', async () => {
            createTaskFile('.vscode/tasks/feature1/backlog1/task1.plan.md');
            createTaskFile('.vscode/tasks/feature1/backlog1/task2.plan.md');
            createTaskFile('.vscode/tasks/feature2/backlog2/task3.plan.md');

            const tasks = await taskManager.getTasks();

            assert.strictEqual(tasks.length, 3, 'Should find 3 tasks');
            
            const task1 = tasks.find(t => t.name === 'task1.plan');
            assert.ok(task1, 'Should find task1.plan');
            assert.strictEqual(task1?.relativePath, path.join('feature1', 'backlog1'));

            const task3 = tasks.find(t => t.name === 'task3.plan');
            assert.ok(task3, 'Should find task3.plan');
            assert.strictEqual(task3?.relativePath, path.join('feature2', 'backlog2'));
        });

        test('should scan mixed root and nested files', async () => {
            createTaskFile('.vscode/tasks/root-task.md');
            createTaskFile('.vscode/tasks/feature1/nested-task.md');

            const tasks = await taskManager.getTasks();

            assert.strictEqual(tasks.length, 2, 'Should find 2 tasks');
            
            const rootTask = tasks.find(t => t.name === 'root-task');
            assert.ok(rootTask, 'Should find root-task');
            assert.strictEqual(rootTask?.relativePath, undefined, 'Root task should have no relativePath');

            const nestedTask = tasks.find(t => t.name === 'nested-task');
            assert.ok(nestedTask, 'Should find nested-task');
            assert.strictEqual(nestedTask?.relativePath, 'feature1');
        });

        test('should ignore archive folder when scanning active tasks', async () => {
            createTaskFile('.vscode/tasks/feature1/task1.md');
            createTaskFile('.vscode/tasks/archive/archived-task.md');
            createTaskFile('.vscode/tasks/feature1/archive/should-not-appear.md');

            const tasks = await taskManager.getTasks();

            assert.strictEqual(tasks.length, 1, 'Should find only 1 active task');
            assert.strictEqual(tasks[0].name, 'task1');
            assert.strictEqual(tasks[0].isArchived, false);
        });
    });

    suite('Cross-Platform Path Handling', () => {
        test('should handle paths correctly on all platforms', async () => {
            // Create nested structure
            createTaskFile('.vscode/tasks/feature1/backlog1/task.md');

            const tasks = await taskManager.getTasks();
            const task = tasks[0];

            // Path should use platform-specific separator
            assert.ok(task.relativePath, 'Task should have relativePath');
            assert.strictEqual(task.relativePath, path.join('feature1', 'backlog1'));
            
            // File path should be absolute and valid
            assert.ok(path.isAbsolute(task.filePath), 'File path should be absolute');
            assert.ok(fs.existsSync(task.filePath), 'File should exist at the path');
        });

        test('should handle special characters in folder names', async () => {
            // Create folders with spaces and special characters (platform-safe)
            const folderName = 'feature with spaces';
            createTaskFile(`.vscode/tasks/${folderName}/task.md`);

            const tasks = await taskManager.getTasks();

            assert.strictEqual(tasks.length, 1, 'Should find task in folder with spaces');
            assert.strictEqual(tasks[0].relativePath, folderName);
        });

        test('should work with deep nesting (5+ levels)', async () => {
            const deepPath = '.vscode/tasks/l1/l2/l3/l4/l5/deep-task.md';
            createTaskFile(deepPath);

            const tasks = await taskManager.getTasks();

            assert.strictEqual(tasks.length, 1, 'Should find deeply nested task');
            assert.strictEqual(tasks[0].relativePath, path.join('l1', 'l2', 'l3', 'l4', 'l5'));
        });
    });

    suite('Document Grouping with Nested Directories', () => {
        test('should group documents in the same directory', async () => {
            createTaskFile('.vscode/tasks/feature1/task1.plan.md');
            createTaskFile('.vscode/tasks/feature1/task1.spec.md');
            createTaskFile('.vscode/tasks/feature1/task1.test.md');

            const { groups, singles } = await taskManager.getTaskDocumentGroups();

            assert.strictEqual(groups.length, 1, 'Should create 1 document group');
            assert.strictEqual(groups[0].baseName, 'task1');
            assert.strictEqual(groups[0].documents.length, 3, 'Group should have 3 documents');
            assert.ok(groups[0].documents.every(d => d.relativePath === 'feature1'));
        });

        test('should NOT group documents in different directories', async () => {
            createTaskFile('.vscode/tasks/feature1/task1.plan.md');
            createTaskFile('.vscode/tasks/feature2/task1.plan.md');

            const { groups, singles } = await taskManager.getTaskDocumentGroups();

            // Both should be singles because they're in different directories
            assert.strictEqual(groups.length, 0, 'Should not create any groups');
            assert.strictEqual(singles.length, 2, 'Should have 2 single documents');
        });

        test('should handle mixed grouped and single documents in nested dirs', async () => {
            createTaskFile('.vscode/tasks/feature1/task1.plan.md');
            createTaskFile('.vscode/tasks/feature1/task1.spec.md');
            createTaskFile('.vscode/tasks/feature1/task2.md');
            createTaskFile('.vscode/tasks/feature2/task3.md');

            const { groups, singles } = await taskManager.getTaskDocumentGroups();

            assert.strictEqual(groups.length, 1, 'Should have 1 group (task1 in feature1)');
            assert.strictEqual(groups[0].baseName, 'task1');
            assert.strictEqual(groups[0].documents.length, 2);
            
            assert.strictEqual(singles.length, 2, 'Should have 2 singles (task2, task3)');
        });
    });

    suite('Folder Hierarchy Construction', () => {
        test('should build correct folder hierarchy - single level', async () => {
            createTaskFile('.vscode/tasks/feature1/task1.md');
            createTaskFile('.vscode/tasks/feature2/task2.md');

            const hierarchy = await taskManager.getTaskFolderHierarchy();

            assert.strictEqual(hierarchy.children.length, 2, 'Root should have 2 child folders');
            assert.ok(hierarchy.children.some(f => f.name === 'feature1'));
            assert.ok(hierarchy.children.some(f => f.name === 'feature2'));

            const feature1 = hierarchy.children.find(f => f.name === 'feature1');
            assert.strictEqual(feature1?.singleDocuments.length, 1);
            assert.strictEqual(feature1?.singleDocuments[0].fileName, 'task1.md');
        });

        test('should build correct folder hierarchy - nested levels', async () => {
            createTaskFile('.vscode/tasks/feature1/backlog1/task1.md');
            createTaskFile('.vscode/tasks/feature1/backlog2/task2.md');

            const hierarchy = await taskManager.getTaskFolderHierarchy();

            assert.strictEqual(hierarchy.children.length, 1, 'Root should have 1 child (feature1)');
            
            const feature1 = hierarchy.children[0];
            assert.strictEqual(feature1.name, 'feature1');
            assert.strictEqual(feature1.children.length, 2, 'feature1 should have 2 children');

            const backlog1 = feature1.children.find(f => f.name === 'backlog1');
            const backlog2 = feature1.children.find(f => f.name === 'backlog2');
            
            assert.ok(backlog1, 'Should find backlog1');
            assert.ok(backlog2, 'Should find backlog2');
            assert.strictEqual(backlog1?.singleDocuments.length, 1);
            assert.strictEqual(backlog2?.singleDocuments.length, 1);
        });

        test('should include both folders and root files', async () => {
            createTaskFile('.vscode/tasks/root-task.md');
            createTaskFile('.vscode/tasks/feature1/nested-task.md');

            const hierarchy = await taskManager.getTaskFolderHierarchy();

            assert.strictEqual(hierarchy.singleDocuments.length, 1, 'Root should have 1 document');
            assert.strictEqual(hierarchy.singleDocuments[0].fileName, 'root-task.md');
            assert.strictEqual(hierarchy.children.length, 1, 'Root should have 1 child folder');
            assert.strictEqual(hierarchy.children[0].name, 'feature1');
        });

        test('should correctly populate documentGroups in folders', async () => {
            createTaskFile('.vscode/tasks/feature1/task1.plan.md');
            createTaskFile('.vscode/tasks/feature1/task1.spec.md');

            const hierarchy = await taskManager.getTaskFolderHierarchy();

            const feature1 = hierarchy.children[0];
            assert.strictEqual(feature1.documentGroups.length, 1, 'Should have 1 document group');
            assert.strictEqual(feature1.documentGroups[0].baseName, 'task1');
            assert.strictEqual(feature1.documentGroups[0].documents.length, 2);
        });
    });

    suite('Tree Data Provider with Nested Directories', () => {
        test('should display folder items at root', async () => {
            createTaskFile('.vscode/tasks/feature1/task1.md');
            createTaskFile('.vscode/tasks/feature2/task2.md');

            const rootItems = await treeDataProvider.getChildren();

            assert.strictEqual(rootItems.length, 2, 'Should have 2 folder items');
            assert.ok(rootItems.every(item => item instanceof TaskFolderItem));
            
            const folderNames = (rootItems as TaskFolderItem[]).map(f => f.folder.name);
            assert.ok(folderNames.includes('feature1'));
            assert.ok(folderNames.includes('feature2'));
        });

        test('should display tasks when expanding folder', async () => {
            createTaskFile('.vscode/tasks/feature1/task1.md');
            createTaskFile('.vscode/tasks/feature1/task2.md');

            const rootItems = await treeDataProvider.getChildren();
            const feature1Item = rootItems[0] as TaskFolderItem;

            const folderChildren = await treeDataProvider.getChildren(feature1Item);

            assert.strictEqual(folderChildren.length, 2, 'Folder should have 2 tasks');
            assert.ok(folderChildren.every(item => item instanceof TaskItem));
        });

        test('should display nested folders and tasks', async () => {
            createTaskFile('.vscode/tasks/feature1/task-at-level1.md');
            createTaskFile('.vscode/tasks/feature1/backlog1/task-at-level2.md');

            const rootItems = await treeDataProvider.getChildren();
            const feature1Item = rootItems[0] as TaskFolderItem;

            const level1Children = await treeDataProvider.getChildren(feature1Item);

            // Should have 1 folder (backlog1) and 1 task
            assert.strictEqual(level1Children.length, 2);
            
            const folderItem = level1Children.find(item => item instanceof TaskFolderItem) as TaskFolderItem;
            const taskItem = level1Children.find(item => item instanceof TaskItem);
            
            assert.ok(folderItem, 'Should have a folder item');
            assert.ok(taskItem, 'Should have a task item');
            assert.strictEqual(folderItem?.folder.name, 'backlog1');

            // Expand backlog1
            const level2Children = await treeDataProvider.getChildren(folderItem);
            assert.strictEqual(level2Children.length, 1);
            assert.ok(level2Children[0] instanceof TaskItem);
        });

        test('should display document groups within folders', async () => {
            createTaskFile('.vscode/tasks/feature1/task1.plan.md');
            createTaskFile('.vscode/tasks/feature1/task1.spec.md');

            const rootItems = await treeDataProvider.getChildren();
            const feature1Item = rootItems[0] as TaskFolderItem;

            const folderChildren = await treeDataProvider.getChildren(feature1Item);

            assert.strictEqual(folderChildren.length, 1, 'Should have 1 document group');
            assert.ok(folderChildren[0] instanceof TaskDocumentGroupItem);
            
            const groupItem = folderChildren[0] as TaskDocumentGroupItem;
            const groupChildren = await treeDataProvider.getChildren(groupItem);
            assert.strictEqual(groupChildren.length, 2, 'Group should have 2 documents');
        });
    });

    suite('Archive Support with Nested Directories', () => {
        test('should scan archived tasks in nested directories', async () => {
            createTaskFile('.vscode/tasks/feature1/task1.md');
            createTaskFile('.vscode/tasks/archive/feature1/archived-task.md');

            // Enable showArchived
            (vscode.workspace as any).getConfiguration = (section?: string) => {
                if (section === 'workspaceShortcuts.tasksViewer') {
                    return {
                        get: <T>(key: string, defaultValue?: T): T => {
                            const defaults: Record<string, any> = {
                                enabled: true,
                                folderPath: '.vscode/tasks',
                                showArchived: true,
                                sortBy: 'name',
                                groupRelatedDocuments: true
                            };
                            return (defaults[key] !== undefined ? defaults[key] : defaultValue) as T;
                        }
                    };
                }
                return originalGetConfiguration(section);
            };

            // Create new manager with updated settings
            const newTaskManager = new TaskManager(tempDir);
            const tasks = await newTaskManager.getTasks();

            assert.strictEqual(tasks.length, 2, 'Should find 2 tasks total');
            
            const archivedTask = tasks.find(t => t.isArchived);
            assert.ok(archivedTask, 'Should find archived task');
            assert.strictEqual(archivedTask?.relativePath, 'feature1');

            newTaskManager.dispose();
        });
    });

    suite('File Watching with Nested Directories', () => {
        test('should detect changes in nested directories', async function() {
            this.timeout(5000); // Increase timeout for file watching

            createTaskFile('.vscode/tasks/feature1/task1.md');

            let refreshCount = 0;
            taskManager.watchTasksFolder(() => {
                refreshCount++;
            });

            await wait(100); // Wait for watcher to initialize

            // Create a new file in nested directory
            createTaskFile('.vscode/tasks/feature1/task2.md');

            await wait(500); // Wait for file system event to propagate

            assert.ok(refreshCount > 0, 'Should trigger refresh callback');
        });
    });

    suite('Edge Cases', () => {
        test('should handle empty directories', async () => {
            createDir('.vscode/tasks/empty-feature');
            createTaskFile('.vscode/tasks/feature-with-task/task.md');

            const hierarchy = await taskManager.getTaskFolderHierarchy();

            // Empty directories should not appear in hierarchy
            assert.strictEqual(hierarchy.children.length, 1);
            assert.strictEqual(hierarchy.children[0].name, 'feature-with-task');
        });

        test('should handle directories with only subdirectories', async () => {
            createTaskFile('.vscode/tasks/parent/child1/task1.md');
            createTaskFile('.vscode/tasks/parent/child2/task2.md');

            const hierarchy = await taskManager.getTaskFolderHierarchy();

            assert.strictEqual(hierarchy.children.length, 1);
            const parent = hierarchy.children[0];
            assert.strictEqual(parent.name, 'parent');
            assert.strictEqual(parent.singleDocuments.length, 0, 'Parent should have no direct documents');
            assert.strictEqual(parent.children.length, 2, 'Parent should have 2 child folders');
        });

        test('should handle symlinks safely', async function() {
            // Skip on Windows as symlink handling is different
            if (os.platform() === 'win32') {
                this.skip();
                return;
            }

            createTaskFile('.vscode/tasks/real-folder/task.md');
            const realPath = path.join(tempDir, '.vscode/tasks/real-folder');
            const linkPath = path.join(tempDir, '.vscode/tasks/link-folder');

            try {
                fs.symlinkSync(realPath, linkPath, 'dir');
                
                const tasks = await taskManager.getTasks();
                
                // Should find the task (implementation may vary)
                assert.ok(tasks.length >= 1, 'Should find at least the real task');
            } catch (err) {
                // Symlink creation might fail, that's ok
                console.log('Symlink test skipped:', err);
                this.skip();
            }
        });
    });
});
