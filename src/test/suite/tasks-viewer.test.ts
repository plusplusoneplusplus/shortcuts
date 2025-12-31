import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskManager, TasksTreeDataProvider, TaskItem, Task } from '../../shortcuts/tasks-viewer';

suite('Tasks Viewer Tests', () => {
    let tempDir: string;
    let taskManager: TaskManager;

    setup(() => {
        // Create temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-tasks-test-'));

        // Mock vscode.workspace.getConfiguration
        const originalGetConfiguration = vscode.workspace.getConfiguration;
        (vscode.workspace as any).getConfiguration = (section?: string) => {
            if (section === 'workspaceShortcuts.tasksViewer') {
                return {
                    get: <T>(key: string, defaultValue?: T): T => {
                        const defaults: Record<string, any> = {
                            enabled: true,
                            folderPath: '.vscode/tasks',
                            showArchived: false,
                            sortBy: 'modifiedDate'
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
        // Dispose task manager
        taskManager.dispose();

        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('TaskManager', () => {
        suite('Folder Management', () => {
            test('should get correct tasks folder path', () => {
                const tasksFolder = taskManager.getTasksFolder();
                assert.strictEqual(tasksFolder, path.join(tempDir, '.vscode', 'tasks'));
            });

            test('should get correct archive folder path', () => {
                const archiveFolder = taskManager.getArchiveFolder();
                assert.strictEqual(archiveFolder, path.join(tempDir, '.vscode', 'tasks', 'archive'));
            });

            test('should create folders when ensureFoldersExist is called', () => {
                taskManager.ensureFoldersExist();

                const tasksFolder = taskManager.getTasksFolder();
                const archiveFolder = taskManager.getArchiveFolder();

                assert.ok(fs.existsSync(tasksFolder), 'Tasks folder should exist');
                assert.ok(fs.existsSync(archiveFolder), 'Archive folder should exist');
            });

            test('should not throw if folders already exist', () => {
                taskManager.ensureFoldersExist();
                // Call again - should not throw
                assert.doesNotThrow(() => taskManager.ensureFoldersExist());
            });
        });

        suite('Task Creation', () => {
            test('should create a new task file', async () => {
                const filePath = await taskManager.createTask('My First Task');

                assert.ok(fs.existsSync(filePath), 'Task file should exist');
                assert.ok(filePath.endsWith('.md'), 'Task file should be markdown');

                const content = fs.readFileSync(filePath, 'utf8');
                assert.ok(content.includes('# My First Task'), 'Task should have header');
            });

            test('should sanitize task name for file', async () => {
                const filePath = await taskManager.createTask('Task: With <Special> Chars!');

                assert.ok(fs.existsSync(filePath));
                assert.ok(!filePath.includes(':'), 'Filename should not contain colon');
                assert.ok(!filePath.includes('<'), 'Filename should not contain <');
                assert.ok(!filePath.includes('>'), 'Filename should not contain >');
            });

            test('should throw error if task already exists', async () => {
                await taskManager.createTask('Duplicate Task');

                await assert.rejects(
                    async () => await taskManager.createTask('Duplicate Task'),
                    /already exists/i
                );
            });

            test('should create task with spaces in name', async () => {
                const filePath = await taskManager.createTask('Task With Spaces');
                assert.ok(fs.existsSync(filePath));
            });
        });

        suite('Task Reading', () => {
            test('should return empty array when no tasks exist', async () => {
                taskManager.ensureFoldersExist();
                const tasks = await taskManager.getTasks();
                assert.strictEqual(tasks.length, 0);
            });

            test('should return tasks from folder', async () => {
                await taskManager.createTask('Task 1');
                await taskManager.createTask('Task 2');

                const tasks = await taskManager.getTasks();
                assert.strictEqual(tasks.length, 2);
            });

            test('should populate task properties correctly', async () => {
                await taskManager.createTask('Test Task');

                const tasks = await taskManager.getTasks();
                assert.strictEqual(tasks.length, 1);

                const task = tasks[0];
                assert.strictEqual(task.name, 'Test-Task');
                assert.ok(task.filePath.endsWith('.md'));
                assert.ok(task.modifiedTime instanceof Date);
                assert.strictEqual(task.isArchived, false);
            });

            test('should not include non-markdown files', async () => {
                taskManager.ensureFoldersExist();
                const tasksFolder = taskManager.getTasksFolder();

                // Create a non-markdown file
                fs.writeFileSync(path.join(tasksFolder, 'readme.txt'), 'Not a task');

                await taskManager.createTask('Real Task');

                const tasks = await taskManager.getTasks();
                assert.strictEqual(tasks.length, 1);
                assert.strictEqual(tasks[0].name, 'Real-Task');
            });
        });

        suite('Task Renaming', () => {
            test('should rename a task file', async () => {
                const originalPath = await taskManager.createTask('Original Name');
                const newPath = await taskManager.renameTask(originalPath, 'New Name');

                assert.ok(!fs.existsSync(originalPath), 'Original file should not exist');
                assert.ok(fs.existsSync(newPath), 'New file should exist');
            });

            test('should throw error when renaming to existing name', async () => {
                const path1 = await taskManager.createTask('Task One');
                const path2 = await taskManager.createTask('Task Two');

                await assert.rejects(
                    async () => await taskManager.renameTask(path1, 'Task-Two'),
                    /already exists/i
                );
            });

            test('should throw error when original file not found', async () => {
                await assert.rejects(
                    async () => await taskManager.renameTask('/non/existent/path.md', 'New Name'),
                    /not found/i
                );
            });
        });

        suite('Task Deletion', () => {
            test('should delete a task file', async () => {
                const filePath = await taskManager.createTask('To Delete');
                assert.ok(fs.existsSync(filePath));

                await taskManager.deleteTask(filePath);
                assert.ok(!fs.existsSync(filePath), 'File should be deleted');
            });

            test('should throw error when file not found', async () => {
                await assert.rejects(
                    async () => await taskManager.deleteTask('/non/existent/path.md'),
                    /not found/i
                );
            });
        });

        suite('Task Archiving', () => {
            test('should archive a task', async () => {
                const originalPath = await taskManager.createTask('To Archive');
                const archivedPath = await taskManager.archiveTask(originalPath);

                assert.ok(!fs.existsSync(originalPath), 'Original should not exist');
                assert.ok(fs.existsSync(archivedPath), 'Archived file should exist');
                assert.ok(archivedPath.includes('archive'), 'Path should contain archive');
            });

            test('should handle name collision in archive', async () => {
                // Create and archive first task
                const path1 = await taskManager.createTask('Same Name');
                await taskManager.archiveTask(path1);

                // Create another task with same name and archive
                const path2 = await taskManager.createTask('Same Name');
                const archivedPath = await taskManager.archiveTask(path2);

                // Both should exist in archive (second with timestamp)
                assert.ok(fs.existsSync(archivedPath));
            });

            test('should unarchive a task', async () => {
                const originalPath = await taskManager.createTask('To Unarchive');
                const archivedPath = await taskManager.archiveTask(originalPath);
                const restoredPath = await taskManager.unarchiveTask(archivedPath);

                assert.ok(!fs.existsSync(archivedPath), 'Archived should not exist');
                assert.ok(fs.existsSync(restoredPath), 'Restored file should exist');
                assert.ok(!restoredPath.includes('archive'), 'Path should not contain archive');
            });

            test('should show archived tasks when setting enabled', async () => {
                // Override settings to show archived
                const originalGetConfiguration = vscode.workspace.getConfiguration;
                (vscode.workspace as any).getConfiguration = (section?: string) => {
                    if (section === 'workspaceShortcuts.tasksViewer') {
                        return {
                            get: <T>(key: string, defaultValue?: T): T => {
                                const defaults: Record<string, any> = {
                                    enabled: true,
                                    folderPath: '.vscode/tasks',
                                    showArchived: true,
                                    sortBy: 'modifiedDate'
                                };
                                return (defaults[key] !== undefined ? defaults[key] : defaultValue) as T;
                            }
                        };
                    }
                    return originalGetConfiguration(section);
                };

                await taskManager.createTask('Active Task');
                const toArchive = await taskManager.createTask('Archived Task');
                await taskManager.archiveTask(toArchive);

                const tasks = await taskManager.getTasks();
                assert.strictEqual(tasks.length, 2);
                assert.ok(tasks.some(t => t.isArchived), 'Should have archived task');
                assert.ok(tasks.some(t => !t.isArchived), 'Should have active task');
            });
        });

        suite('File Watching', () => {
            test('should call refresh callback on file changes', (done) => {
                taskManager.ensureFoldersExist();

                let callCount = 0;
                taskManager.watchTasksFolder(() => {
                    callCount++;
                    if (callCount === 1) {
                        done();
                    }
                });

                // Create a file to trigger the watcher
                const tasksFolder = taskManager.getTasksFolder();
                fs.writeFileSync(path.join(tasksFolder, 'trigger.md'), '# Test');
            });
        });

        suite('Settings', () => {
            test('should get settings from configuration', () => {
                const settings = taskManager.getSettings();

                assert.strictEqual(settings.enabled, true);
                assert.strictEqual(settings.folderPath, '.vscode/tasks');
                assert.strictEqual(settings.showArchived, false);
                assert.strictEqual(settings.sortBy, 'modifiedDate');
            });
        });
    });

    suite('TaskItem', () => {
        test('should create task item with correct properties', () => {
            const task: Task = {
                name: 'Test Task',
                filePath: '/path/to/task.md',
                modifiedTime: new Date(),
                isArchived: false
            };

            const item = new TaskItem(task);

            assert.strictEqual(item.label, 'Test Task');
            assert.strictEqual(item.filePath, '/path/to/task.md');
            assert.strictEqual(item.isArchived, false);
            assert.strictEqual(item.contextValue, 'task');
            assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
        });

        test('should set correct context value for archived task', () => {
            const task: Task = {
                name: 'Archived Task',
                filePath: '/path/to/archived.md',
                modifiedTime: new Date(),
                isArchived: true
            };

            const item = new TaskItem(task);

            assert.strictEqual(item.contextValue, 'archivedTask');
            assert.strictEqual(item.isArchived, true);
        });

        test('should set open command', () => {
            const task: Task = {
                name: 'Task',
                filePath: '/path/to/task.md',
                modifiedTime: new Date(),
                isArchived: false
            };

            const item = new TaskItem(task);

            assert.ok(item.command);
            assert.strictEqual(item.command.command, 'vscode.open');
            assert.ok(item.command.arguments);
            assert.strictEqual(item.command.arguments.length, 1);
        });

        test('should set tooltip to file path', () => {
            const task: Task = {
                name: 'Task',
                filePath: '/path/to/task.md',
                modifiedTime: new Date(),
                isArchived: false
            };

            const item = new TaskItem(task);
            assert.strictEqual(item.tooltip, '/path/to/task.md');
        });

        test('should format modified time for today', () => {
            const task: Task = {
                name: 'Task',
                filePath: '/path/to/task.md',
                modifiedTime: new Date(),
                isArchived: false
            };

            const item = new TaskItem(task);
            assert.ok(item.description); // Should have time format
        });

        test('should format modified time for yesterday', () => {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);

            const task: Task = {
                name: 'Task',
                filePath: '/path/to/task.md',
                modifiedTime: yesterday,
                isArchived: false
            };

            const item = new TaskItem(task);
            assert.strictEqual(item.description, 'Yesterday');
        });

        test('should format modified time for days ago', () => {
            const daysAgo = new Date();
            daysAgo.setDate(daysAgo.getDate() - 3);

            const task: Task = {
                name: 'Task',
                filePath: '/path/to/task.md',
                modifiedTime: daysAgo,
                isArchived: false
            };

            const item = new TaskItem(task);
            assert.strictEqual(item.description, '3 days ago');
        });
    });

    suite('TasksTreeDataProvider', () => {
        let treeDataProvider: TasksTreeDataProvider;

        setup(() => {
            treeDataProvider = new TasksTreeDataProvider(taskManager);
        });

        teardown(() => {
            treeDataProvider.dispose();
        });

        test('should implement TreeDataProvider interface', () => {
            assert.ok(treeDataProvider.onDidChangeTreeData);
            assert.ok(typeof treeDataProvider.getTreeItem === 'function');
            assert.ok(typeof treeDataProvider.getChildren === 'function');
        });

        test('should return empty array when no tasks', async () => {
            taskManager.ensureFoldersExist();
            const children = await treeDataProvider.getChildren();
            assert.strictEqual(children.length, 0);
        });

        test('should return task items', async () => {
            await taskManager.createTask('Task 1');
            await taskManager.createTask('Task 2');

            const children = await treeDataProvider.getChildren();
            assert.strictEqual(children.length, 2);
            assert.ok(children.every(c => c instanceof TaskItem));
        });

        test('should return empty array for task children', async () => {
            await taskManager.createTask('Task');
            const children = await treeDataProvider.getChildren();
            const taskItem = children[0];

            const taskChildren = await treeDataProvider.getChildren(taskItem);
            assert.strictEqual(taskChildren.length, 0);
        });

        test('should fire change event on refresh', (done) => {
            const disposable = treeDataProvider.onDidChangeTreeData(() => {
                disposable.dispose();
                done();
            });

            treeDataProvider.refresh();
        });

        test('should filter tasks by name', async () => {
            await taskManager.createTask('Apple Task');
            await taskManager.createTask('Banana Task');
            await taskManager.createTask('Cherry Task');

            treeDataProvider.setFilter('banana');

            const children = await treeDataProvider.getChildren();
            assert.strictEqual(children.length, 1);
            assert.strictEqual((children[0] as TaskItem).label, 'Banana-Task');
        });

        test('should clear filter', async () => {
            await taskManager.createTask('Task 1');
            await taskManager.createTask('Task 2');

            treeDataProvider.setFilter('1');
            let children = await treeDataProvider.getChildren();
            assert.strictEqual(children.length, 1);

            treeDataProvider.clearFilter();
            children = await treeDataProvider.getChildren();
            assert.strictEqual(children.length, 2);
        });

        test('should get current filter', () => {
            assert.strictEqual(treeDataProvider.getFilter(), '');

            treeDataProvider.setFilter('test');
            assert.strictEqual(treeDataProvider.getFilter(), 'test');
        });

        test('should sort tasks by name', async () => {
            // Override settings for name sorting
            const originalGetConfiguration = vscode.workspace.getConfiguration;
            (vscode.workspace as any).getConfiguration = (section?: string) => {
                if (section === 'workspaceShortcuts.tasksViewer') {
                    return {
                        get: <T>(key: string, defaultValue?: T): T => {
                            const defaults: Record<string, any> = {
                                enabled: true,
                                folderPath: '.vscode/tasks',
                                showArchived: false,
                                sortBy: 'name'
                            };
                            return (defaults[key] !== undefined ? defaults[key] : defaultValue) as T;
                        }
                    };
                }
                return originalGetConfiguration(section);
            };

            await taskManager.createTask('Zebra');
            await taskManager.createTask('Apple');
            await taskManager.createTask('Mango');

            const children = await treeDataProvider.getChildren();
            const names = children.map(c => (c as TaskItem).label);

            assert.strictEqual(names[0], 'Apple');
            assert.strictEqual(names[1], 'Mango');
            assert.strictEqual(names[2], 'Zebra');
        });

        test('should return tree item unchanged', () => {
            const task: Task = {
                name: 'Task',
                filePath: '/path/to/task.md',
                modifiedTime: new Date(),
                isArchived: false
            };
            const item = new TaskItem(task);

            const returned = treeDataProvider.getTreeItem(item);
            assert.strictEqual(returned, item);
        });

        test('should get task manager', () => {
            const manager = treeDataProvider.getTaskManager();
            assert.strictEqual(manager, taskManager);
        });
    });

    suite('Integration Tests', () => {
        test('should complete full task lifecycle', async () => {
            // Create task
            const filePath = await taskManager.createTask('Lifecycle Task');
            assert.ok(fs.existsSync(filePath));

            // Verify in list
            let tasks = await taskManager.getTasks();
            assert.strictEqual(tasks.length, 1);

            // Rename task
            const renamedPath = await taskManager.renameTask(filePath, 'Renamed Task');
            assert.ok(fs.existsSync(renamedPath));

            // Archive task
            const archivedPath = await taskManager.archiveTask(renamedPath);
            tasks = await taskManager.getTasks();
            assert.strictEqual(tasks.length, 0); // Not showing archived by default

            // Unarchive task
            const restoredPath = await taskManager.unarchiveTask(archivedPath);
            tasks = await taskManager.getTasks();
            assert.strictEqual(tasks.length, 1);

            // Delete task
            await taskManager.deleteTask(restoredPath);
            tasks = await taskManager.getTasks();
            assert.strictEqual(tasks.length, 0);
        });

        test('should handle multiple tasks', async () => {
            const count = 10;
            const paths: string[] = [];

            for (let i = 0; i < count; i++) {
                const filePath = await taskManager.createTask(`Task ${i}`);
                paths.push(filePath);
            }

            const tasks = await taskManager.getTasks();
            assert.strictEqual(tasks.length, count);

            // Delete half
            for (let i = 0; i < count / 2; i++) {
                await taskManager.deleteTask(paths[i]);
            }

            const remainingTasks = await taskManager.getTasks();
            assert.strictEqual(remainingTasks.length, count / 2);
        });

        test('should tree provider reflect changes', async () => {
            const treeDataProvider = new TasksTreeDataProvider(taskManager);

            // Initially empty
            let children = await treeDataProvider.getChildren();
            assert.strictEqual(children.length, 0);

            // Add task
            await taskManager.createTask('New Task');
            treeDataProvider.refresh();

            children = await treeDataProvider.getChildren();
            assert.strictEqual(children.length, 1);

            treeDataProvider.dispose();
        });
    });
});
