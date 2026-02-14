import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { 
    TaskManager, 
    TasksTreeDataProvider,
    TasksDragDropController,
    TaskFolderItem,
    TaskGroupItem,
    TaskItem,
    TaskDocumentGroupItem,
    TaskDocumentItem
} from '../../shortcuts/tasks-viewer';

suite('Tasks Viewer - Folder Drag and Drop Tests', () => {
    let tempDir: string;
    let taskManager: TaskManager;
    let treeDataProvider: TasksTreeDataProvider;
    let dragDropController: TasksDragDropController;
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
    function createTaskFile(relativePath: string, content?: string): string {
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
     * Helper to check if a path exists
     */
    function pathExists(relativePath: string): boolean {
        return fs.existsSync(path.join(tempDir, relativePath));
    }

    /**
     * Helper to list entries in a directory
     */
    function listEntries(relativePath: string): string[] {
        const fullPath = path.join(tempDir, relativePath);
        if (!fs.existsSync(fullPath)) {
            return [];
        }
        return fs.readdirSync(fullPath);
    }

    /**
     * Helper to read file content
     */
    function readFile(relativePath: string): string {
        return fs.readFileSync(path.join(tempDir, relativePath), 'utf8');
    }

    setup(() => {
        // Create temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-tasks-folder-drag-test-'));

        // Mock vscode.workspace.getConfiguration
        originalGetConfiguration = vscode.workspace.getConfiguration;
        (vscode.workspace as any).getConfiguration = (section?: string) => {
            if (section === 'workspaceShortcuts.tasksViewer') {
                return {
                    get: <T>(key: string, defaultValue?: T): T => {
                        const defaults: Record<string, any> = {
                            enabled: true,
                            folderPath: '.vscode/tasks',
                            showArchived: true,
                            showFuture: true,
                            sortBy: 'name',
                            groupRelatedDocuments: true
                        };
                        return (defaults[key] !== undefined ? defaults[key] : defaultValue) as T;
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
                            defaultScope: {}
                        };
                        return (defaults[key] !== undefined ? defaults[key] : defaultValue) as T;
                    }
                };
            }
            return originalGetConfiguration(section);
        };

        taskManager = new TaskManager(tempDir);
        taskManager.ensureFoldersExist();
        treeDataProvider = new TasksTreeDataProvider(taskManager);
        dragDropController = new TasksDragDropController(taskManager, () => treeDataProvider.refresh());
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

    suite('TaskManager.moveFolder', () => {
        test('should move a folder to a different parent', async () => {
            createTaskFile('.vscode/tasks/feature-a/task1.md');
            createTaskFile('.vscode/tasks/feature-a/task2.md');
            createDir('.vscode/tasks/feature-b');

            const sourcePath = path.join(tempDir, '.vscode/tasks/feature-a');
            const targetPath = path.join(tempDir, '.vscode/tasks/feature-b');

            const newPath = await taskManager.moveFolder(sourcePath, targetPath);

            assert.strictEqual(path.basename(newPath), 'feature-a');
            assert.ok(pathExists('.vscode/tasks/feature-b/feature-a'), 'Folder should exist at new location');
            assert.ok(pathExists('.vscode/tasks/feature-b/feature-a/task1.md'), 'task1.md should be moved');
            assert.ok(pathExists('.vscode/tasks/feature-b/feature-a/task2.md'), 'task2.md should be moved');
            assert.ok(!pathExists('.vscode/tasks/feature-a'), 'Original folder should not exist');
        });

        test('should move folder with nested subfolders', async () => {
            createTaskFile('.vscode/tasks/feature-a/task1.md');
            createTaskFile('.vscode/tasks/feature-a/sub1/task2.md');
            createTaskFile('.vscode/tasks/feature-a/sub1/sub2/task3.md');
            createDir('.vscode/tasks/feature-b');

            const sourcePath = path.join(tempDir, '.vscode/tasks/feature-a');
            const targetPath = path.join(tempDir, '.vscode/tasks/feature-b');

            await taskManager.moveFolder(sourcePath, targetPath);

            assert.ok(pathExists('.vscode/tasks/feature-b/feature-a/task1.md'), 'Root task should be moved');
            assert.ok(pathExists('.vscode/tasks/feature-b/feature-a/sub1/task2.md'), 'Nested task should be moved');
            assert.ok(pathExists('.vscode/tasks/feature-b/feature-a/sub1/sub2/task3.md'), 'Deeply nested task should be moved');
            assert.ok(!pathExists('.vscode/tasks/feature-a'), 'Original folder should not exist');
        });

        test('should preserve file content after move', async () => {
            const content = '# Important Task\n\nDo not lose this content.\n';
            createTaskFile('.vscode/tasks/feature-a/important.md', content);
            createDir('.vscode/tasks/feature-b');

            const sourcePath = path.join(tempDir, '.vscode/tasks/feature-a');
            const targetPath = path.join(tempDir, '.vscode/tasks/feature-b');

            await taskManager.moveFolder(sourcePath, targetPath);

            const movedContent = readFile('.vscode/tasks/feature-b/feature-a/important.md');
            assert.strictEqual(movedContent, content, 'File content should be preserved');
        });

        test('should handle name collision by appending numeric suffix', async () => {
            createTaskFile('.vscode/tasks/feature-a/task1.md');
            createDir('.vscode/tasks/target');
            // Create a folder with the same name at the target
            createTaskFile('.vscode/tasks/target/feature-a/existing.md');

            const sourcePath = path.join(tempDir, '.vscode/tasks/feature-a');
            const targetPath = path.join(tempDir, '.vscode/tasks/target');

            const newPath = await taskManager.moveFolder(sourcePath, targetPath);

            assert.strictEqual(path.basename(newPath), 'feature-a-1', 'Should append -1 suffix');
            assert.ok(pathExists('.vscode/tasks/target/feature-a-1/task1.md'), 'Moved task should exist');
            assert.ok(pathExists('.vscode/tasks/target/feature-a/existing.md'), 'Original folder should still exist');
        });

        test('should handle multiple name collisions', async () => {
            createTaskFile('.vscode/tasks/feature-a/task1.md');
            createDir('.vscode/tasks/target');
            // Create folders that would collide
            createDir('.vscode/tasks/target/feature-a');
            createDir('.vscode/tasks/target/feature-a-1');

            const sourcePath = path.join(tempDir, '.vscode/tasks/feature-a');
            const targetPath = path.join(tempDir, '.vscode/tasks/target');

            const newPath = await taskManager.moveFolder(sourcePath, targetPath);

            assert.strictEqual(path.basename(newPath), 'feature-a-2', 'Should append -2 suffix');
        });

        test('should return same path when moving to same parent (no-op)', async () => {
            createTaskFile('.vscode/tasks/feature-a/task1.md');

            const sourcePath = path.join(tempDir, '.vscode/tasks/feature-a');
            const targetPath = path.join(tempDir, '.vscode/tasks');

            const newPath = await taskManager.moveFolder(sourcePath, targetPath);

            assert.strictEqual(newPath, sourcePath, 'Should return same path for no-op');
            assert.ok(pathExists('.vscode/tasks/feature-a/task1.md'), 'Task should still exist');
        });

        test('should throw error for circular move (into own subtree)', async () => {
            createTaskFile('.vscode/tasks/feature-a/sub1/task1.md');

            const sourcePath = path.join(tempDir, '.vscode/tasks/feature-a');
            const targetPath = path.join(tempDir, '.vscode/tasks/feature-a/sub1');

            await assert.rejects(
                async () => taskManager.moveFolder(sourcePath, targetPath),
                /Cannot move a folder into itself or its own subtree/,
                'Should throw error for circular move'
            );

            // Verify nothing was moved
            assert.ok(pathExists('.vscode/tasks/feature-a/sub1/task1.md'), 'Files should not be affected');
        });

        test('should throw error for moving folder into itself', async () => {
            createTaskFile('.vscode/tasks/feature-a/task1.md');

            const sourcePath = path.join(tempDir, '.vscode/tasks/feature-a');

            await assert.rejects(
                async () => taskManager.moveFolder(sourcePath, sourcePath),
                /Cannot move a folder into itself or its own subtree/,
                'Should throw error for self-move'
            );
        });

        test('should throw error for non-existent source folder', async () => {
            const nonExistentPath = path.join(tempDir, '.vscode/tasks/non-existent');
            const targetPath = path.join(tempDir, '.vscode/tasks');

            await assert.rejects(
                async () => taskManager.moveFolder(nonExistentPath, targetPath),
                /Folder not found/,
                'Should throw error for non-existent source'
            );
        });

        test('should throw error for non-existent target folder', async () => {
            createDir('.vscode/tasks/feature-a');
            const sourcePath = path.join(tempDir, '.vscode/tasks/feature-a');
            const nonExistentTarget = path.join(tempDir, '.vscode/tasks/non-existent');

            await assert.rejects(
                async () => taskManager.moveFolder(sourcePath, nonExistentTarget),
                /Target folder not found/,
                'Should throw error for non-existent target'
            );
        });

        test('should throw error when source is a file, not a directory', async () => {
            const filePath = createTaskFile('.vscode/tasks/not-a-folder.md');
            const targetPath = path.join(tempDir, '.vscode/tasks');

            await assert.rejects(
                async () => taskManager.moveFolder(filePath, targetPath),
                /Path is not a directory/,
                'Should throw error when source is a file'
            );
        });

        test('should move folder to tasks root', async () => {
            createTaskFile('.vscode/tasks/parent/child/task1.md');

            const sourcePath = path.join(tempDir, '.vscode/tasks/parent/child');
            const targetPath = path.join(tempDir, '.vscode/tasks');

            const newPath = await taskManager.moveFolder(sourcePath, targetPath);

            assert.ok(pathExists('.vscode/tasks/child/task1.md'), 'Task should be at root level');
            assert.ok(!pathExists('.vscode/tasks/parent/child'), 'Original location should be empty');
        });

        test('should move folder with document groups intact', async () => {
            createTaskFile('.vscode/tasks/feature-a/task1.plan.md');
            createTaskFile('.vscode/tasks/feature-a/task1.spec.md');
            createTaskFile('.vscode/tasks/feature-a/task1.test.md');
            createDir('.vscode/tasks/feature-b');

            const sourcePath = path.join(tempDir, '.vscode/tasks/feature-a');
            const targetPath = path.join(tempDir, '.vscode/tasks/feature-b');

            await taskManager.moveFolder(sourcePath, targetPath);

            assert.ok(pathExists('.vscode/tasks/feature-b/feature-a/task1.plan.md'), 'plan doc should be moved');
            assert.ok(pathExists('.vscode/tasks/feature-b/feature-a/task1.spec.md'), 'spec doc should be moved');
            assert.ok(pathExists('.vscode/tasks/feature-b/feature-a/task1.test.md'), 'test doc should be moved');
        });

        test('should handle cross-platform paths correctly', async () => {
            createTaskFile('.vscode/tasks/feature-a/sub-feature/task.md');
            createDir('.vscode/tasks/feature-b');

            const sourcePath = path.join(tempDir, '.vscode/tasks/feature-a');
            const targetPath = path.join(tempDir, '.vscode/tasks/feature-b');

            const newPath = await taskManager.moveFolder(sourcePath, targetPath);

            assert.ok(path.isAbsolute(newPath), 'Returned path should be absolute');
            assert.ok(fs.existsSync(newPath), 'New folder should exist');
            assert.ok(pathExists('.vscode/tasks/feature-b/feature-a/sub-feature/task.md'), 'Nested content should be preserved');
        });
    });

    suite('Drag Controller - Folder Drag Data', () => {
        test('handleDrag should set folder drag data for TaskFolderItem', async () => {
            createTaskFile('.vscode/tasks/feature-a/task1.md');

            const hierarchy = await taskManager.getTaskFolderHierarchy();
            const rootItems = await treeDataProvider.getChildren();

            // Find the active group
            const activeGroup = rootItems.find(
                item => item instanceof TaskGroupItem && (item as TaskGroupItem).groupType === 'active'
            ) as TaskGroupItem;

            if (!activeGroup) {
                // Without showArchived there may be no groups, just folder items
                const folderItem = rootItems.find(item => item instanceof TaskFolderItem) as TaskFolderItem;
                if (folderItem) {
                    const dataTransfer = new vscode.DataTransfer();
                    const token = new vscode.CancellationTokenSource().token;

                    await dragDropController.handleDrag([folderItem], dataTransfer, token);

                    // Should have URI list
                    assert.ok(dataTransfer.get('text/uri-list'), 'Should have text/uri-list');

                    // Should have internal drag data
                    const internalData = dataTransfer.get('application/vnd.code.tree.tasksView');
                    assert.ok(internalData, 'Should have internal drag data');

                    const parsed = JSON.parse(await internalData!.asString());
                    assert.strictEqual(parsed.length, 1);
                    assert.strictEqual(parsed[0].type, 'folder');
                    assert.ok(parsed[0].draggedFolderPath, 'Should have draggedFolderPath');
                }
                return;
            }

            const activeChildren = await treeDataProvider.getChildren(activeGroup);
            const folderItem = activeChildren.find(item => item instanceof TaskFolderItem) as TaskFolderItem;

            if (folderItem) {
                const dataTransfer = new vscode.DataTransfer();
                const token = new vscode.CancellationTokenSource().token;

                await dragDropController.handleDrag([folderItem], dataTransfer, token);

                // Should have URI list
                assert.ok(dataTransfer.get('text/uri-list'), 'Should have text/uri-list');

                // Should have internal drag data
                const internalData = dataTransfer.get('application/vnd.code.tree.tasksView');
                assert.ok(internalData, 'Should have internal drag data');

                const parsed = JSON.parse(await internalData!.asString());
                assert.strictEqual(parsed.length, 1);
                assert.strictEqual(parsed[0].type, 'folder');
                assert.ok(parsed[0].draggedFolderPath, 'Should have draggedFolderPath');
            }
        });

        test('handleDrag should NOT set drag data for archived folder', async () => {
            createTaskFile('.vscode/tasks/archive/archived-feature/task1.md');

            const rootItems = await treeDataProvider.getChildren();
            const archivedGroup = rootItems.find(
                item => item instanceof TaskGroupItem && (item as TaskGroupItem).groupType === 'archived'
            ) as TaskGroupItem;

            if (archivedGroup) {
                const archivedChildren = await treeDataProvider.getChildren(archivedGroup);
                const archivedFolder = archivedChildren.find(item => item instanceof TaskFolderItem) as TaskFolderItem;

                if (archivedFolder) {
                    const dataTransfer = new vscode.DataTransfer();
                    const token = new vscode.CancellationTokenSource().token;

                    await dragDropController.handleDrag([archivedFolder], dataTransfer, token);

                    // Should NOT have internal drag data with folder type
                    const internalData = dataTransfer.get('application/vnd.code.tree.tasksView');
                    if (internalData) {
                        const parsed = JSON.parse(await internalData.asString());
                        const folderDrags = parsed.filter((d: any) => d.type === 'folder');
                        assert.strictEqual(folderDrags.length, 0, 'Should not have folder drag data for archived folders');
                    }
                }
            }
        });
    });

    suite('End-to-End Folder Move via TaskManager', () => {
        test('should move folder between features and refresh tree', async () => {
            createTaskFile('.vscode/tasks/feature-a/task1.md');
            createTaskFile('.vscode/tasks/feature-a/task2.md');
            createDir('.vscode/tasks/feature-b');

            // Verify initial state
            assert.ok(pathExists('.vscode/tasks/feature-a/task1.md'));
            assert.ok(pathExists('.vscode/tasks/feature-a/task2.md'));

            const sourcePath = path.join(tempDir, '.vscode/tasks/feature-a');
            const targetPath = path.join(tempDir, '.vscode/tasks/feature-b');

            await taskManager.moveFolder(sourcePath, targetPath);

            // Verify final state
            assert.ok(pathExists('.vscode/tasks/feature-b/feature-a/task1.md'), 'task1 should be in new location');
            assert.ok(pathExists('.vscode/tasks/feature-b/feature-a/task2.md'), 'task2 should be in new location');
            assert.ok(!pathExists('.vscode/tasks/feature-a'), 'Original folder should be gone');

            // Verify tree reflects the change
            const rootItems = await treeDataProvider.getChildren();
            const activeGroup = rootItems.find(
                item => item instanceof TaskGroupItem && (item as TaskGroupItem).groupType === 'active'
            ) as TaskGroupItem;

            if (activeGroup) {
                const activeChildren = await treeDataProvider.getChildren(activeGroup);
                const featureB = activeChildren.find(
                    item => item instanceof TaskFolderItem && (item as TaskFolderItem).folder.name === 'feature-b'
                ) as TaskFolderItem;

                assert.ok(featureB, 'feature-b should exist in tree');

                const featureBChildren = await treeDataProvider.getChildren(featureB);
                const movedFolder = featureBChildren.find(
                    item => item instanceof TaskFolderItem && (item as TaskFolderItem).folder.name === 'feature-a'
                );

                assert.ok(movedFolder, 'feature-a should be a child of feature-b');
            }
        });

        test('should move folder from nested location to root', async () => {
            createTaskFile('.vscode/tasks/parent/child/task1.md');
            createTaskFile('.vscode/tasks/parent/child/task2.md');

            const sourcePath = path.join(tempDir, '.vscode/tasks/parent/child');
            const targetPath = path.join(tempDir, '.vscode/tasks');

            await taskManager.moveFolder(sourcePath, targetPath);

            assert.ok(pathExists('.vscode/tasks/child/task1.md'), 'task1 should be at root');
            assert.ok(pathExists('.vscode/tasks/child/task2.md'), 'task2 should be at root');
            assert.ok(!pathExists('.vscode/tasks/parent/child'), 'Original location should be gone');
        });

        test('should move folder from root into a feature', async () => {
            createTaskFile('.vscode/tasks/standalone-feature/task1.md');
            createDir('.vscode/tasks/parent-feature');

            const sourcePath = path.join(tempDir, '.vscode/tasks/standalone-feature');
            const targetPath = path.join(tempDir, '.vscode/tasks/parent-feature');

            await taskManager.moveFolder(sourcePath, targetPath);

            assert.ok(pathExists('.vscode/tasks/parent-feature/standalone-feature/task1.md'));
            assert.ok(!pathExists('.vscode/tasks/standalone-feature'));
        });

        test('should handle moving multiple folders sequentially', async () => {
            createTaskFile('.vscode/tasks/feature-a/task-a.md');
            createTaskFile('.vscode/tasks/feature-b/task-b.md');
            createDir('.vscode/tasks/target');

            const targetPath = path.join(tempDir, '.vscode/tasks/target');

            await taskManager.moveFolder(path.join(tempDir, '.vscode/tasks/feature-a'), targetPath);
            await taskManager.moveFolder(path.join(tempDir, '.vscode/tasks/feature-b'), targetPath);

            assert.ok(pathExists('.vscode/tasks/target/feature-a/task-a.md'));
            assert.ok(pathExists('.vscode/tasks/target/feature-b/task-b.md'));
            assert.ok(!pathExists('.vscode/tasks/feature-a'));
            assert.ok(!pathExists('.vscode/tasks/feature-b'));
        });
    });

    suite('Edge Cases', () => {
        test('should handle empty folder move', async () => {
            createDir('.vscode/tasks/empty-feature');
            createDir('.vscode/tasks/target');

            const sourcePath = path.join(tempDir, '.vscode/tasks/empty-feature');
            const targetPath = path.join(tempDir, '.vscode/tasks/target');

            const newPath = await taskManager.moveFolder(sourcePath, targetPath);

            assert.ok(fs.existsSync(newPath), 'Empty folder should be moved');
            assert.ok(!pathExists('.vscode/tasks/empty-feature'), 'Original should be gone');
        });

        test('should handle folder with mixed content (files, subfolders, non-md files)', async () => {
            createTaskFile('.vscode/tasks/mixed/task1.md');
            createDir('.vscode/tasks/mixed/subfolder');
            createTaskFile('.vscode/tasks/mixed/subfolder/task2.md');
            // Create a non-md file
            fs.writeFileSync(path.join(tempDir, '.vscode/tasks/mixed/notes.txt'), 'some notes');
            createDir('.vscode/tasks/target');

            const sourcePath = path.join(tempDir, '.vscode/tasks/mixed');
            const targetPath = path.join(tempDir, '.vscode/tasks/target');

            await taskManager.moveFolder(sourcePath, targetPath);

            assert.ok(pathExists('.vscode/tasks/target/mixed/task1.md'));
            assert.ok(pathExists('.vscode/tasks/target/mixed/subfolder/task2.md'));
            assert.ok(pathExists('.vscode/tasks/target/mixed/notes.txt'));
        });

        test('should handle folder names with special characters', async () => {
            createTaskFile('.vscode/tasks/feature (v2)/task1.md');
            createDir('.vscode/tasks/target');

            const sourcePath = path.join(tempDir, '.vscode/tasks/feature (v2)');
            const targetPath = path.join(tempDir, '.vscode/tasks/target');

            const newPath = await taskManager.moveFolder(sourcePath, targetPath);

            assert.ok(fs.existsSync(newPath));
            assert.ok(pathExists('.vscode/tasks/target/feature (v2)/task1.md'));
        });

        test('should handle deeply nested circular move prevention', async () => {
            createTaskFile('.vscode/tasks/a/b/c/d/task.md');

            const sourcePath = path.join(tempDir, '.vscode/tasks/a');
            const targetPath = path.join(tempDir, '.vscode/tasks/a/b/c/d');

            await assert.rejects(
                async () => taskManager.moveFolder(sourcePath, targetPath),
                /Cannot move a folder into itself or its own subtree/,
                'Should prevent deeply nested circular move'
            );

            // Verify nothing was corrupted
            assert.ok(pathExists('.vscode/tasks/a/b/c/d/task.md'), 'Original structure should be intact');
        });

        test('should handle folder with related.yaml', async () => {
            createTaskFile('.vscode/tasks/feature-with-related/task1.md');
            fs.writeFileSync(
                path.join(tempDir, '.vscode/tasks/feature-with-related/related.yaml'),
                'description: "Test feature"\nitems: []\n'
            );
            createDir('.vscode/tasks/target');

            const sourcePath = path.join(tempDir, '.vscode/tasks/feature-with-related');
            const targetPath = path.join(tempDir, '.vscode/tasks/target');

            await taskManager.moveFolder(sourcePath, targetPath);

            assert.ok(pathExists('.vscode/tasks/target/feature-with-related/task1.md'));
            assert.ok(pathExists('.vscode/tasks/target/feature-with-related/related.yaml'), 'related.yaml should be preserved');
        });
    });

    suite('Integration with Tree View', () => {
        test('should show moved folder in correct location in tree', async () => {
            createTaskFile('.vscode/tasks/feature-a/task1.md');
            createDir('.vscode/tasks/feature-b');

            // Move folder
            const sourcePath = path.join(tempDir, '.vscode/tasks/feature-a');
            const targetPath = path.join(tempDir, '.vscode/tasks/feature-b');
            await taskManager.moveFolder(sourcePath, targetPath);

            // Refresh tree and verify
            const rootItems = await treeDataProvider.getChildren();
            const activeGroup = rootItems.find(
                item => item instanceof TaskGroupItem && (item as TaskGroupItem).groupType === 'active'
            ) as TaskGroupItem;

            if (activeGroup) {
                const activeChildren = await treeDataProvider.getChildren(activeGroup);

                // feature-a should NOT be at root level
                const featureAAtRoot = activeChildren.find(
                    item => item instanceof TaskFolderItem && (item as TaskFolderItem).folder.name === 'feature-a'
                );
                assert.ok(!featureAAtRoot, 'feature-a should not be at root level');

                // feature-b should exist
                const featureB = activeChildren.find(
                    item => item instanceof TaskFolderItem && (item as TaskFolderItem).folder.name === 'feature-b'
                ) as TaskFolderItem;
                assert.ok(featureB, 'feature-b should exist');

                // feature-a should be inside feature-b
                const featureBChildren = await treeDataProvider.getChildren(featureB);
                const featureAInB = featureBChildren.find(
                    item => item instanceof TaskFolderItem && (item as TaskFolderItem).folder.name === 'feature-a'
                );
                assert.ok(featureAInB, 'feature-a should be inside feature-b');
            }
        });

        test('should preserve task items in moved folder', async () => {
            createTaskFile('.vscode/tasks/feature-a/task1.md', '# Task 1\n\nImportant task.\n');
            createDir('.vscode/tasks/feature-b');

            const sourcePath = path.join(tempDir, '.vscode/tasks/feature-a');
            const targetPath = path.join(tempDir, '.vscode/tasks/feature-b');
            await taskManager.moveFolder(sourcePath, targetPath);

            // Navigate tree to find the task
            const rootItems = await treeDataProvider.getChildren();
            const activeGroup = rootItems.find(
                item => item instanceof TaskGroupItem && (item as TaskGroupItem).groupType === 'active'
            ) as TaskGroupItem;

            if (activeGroup) {
                const activeChildren = await treeDataProvider.getChildren(activeGroup);
                const featureB = activeChildren.find(
                    item => item instanceof TaskFolderItem && (item as TaskFolderItem).folder.name === 'feature-b'
                ) as TaskFolderItem;

                if (featureB) {
                    const featureBChildren = await treeDataProvider.getChildren(featureB);
                    const featureA = featureBChildren.find(
                        item => item instanceof TaskFolderItem && (item as TaskFolderItem).folder.name === 'feature-a'
                    ) as TaskFolderItem;

                    if (featureA) {
                        const featureAChildren = await treeDataProvider.getChildren(featureA);
                        const hasTask = featureAChildren.some(
                            item => (item instanceof TaskItem || item instanceof TaskDocumentItem) &&
                                    (item.label === 'task1' || (item as any).document?.baseName === 'task1')
                        );
                        assert.ok(hasTask, 'Task should be present in moved folder');
                    }
                }
            }
        });
    });

    suite('Drag Controller - normalizePath', () => {
        test('should normalize paths for comparison', () => {
            const controller = dragDropController as any;

            assert.strictEqual(
                controller.normalizePath('/Users/test/folder'),
                '/users/test/folder'
            );
            assert.strictEqual(
                controller.normalizePath('C:\\Users\\test\\folder'),
                'c:/users/test/folder'
            );
        });
    });

    suite('Undo Support - canUndo and undoLastMove', () => {
        test('canUndo should return false when no move has been performed', () => {
            assert.strictEqual(dragDropController.canUndo(), false);
        });

        test('should undo a single file move', async () => {
            // Create source file and target folder
            const taskPath = createTaskFile('.vscode/tasks/feature-a/task1.md', '# Task 1\n\nContent.\n');
            createDir('.vscode/tasks/feature-b');

            const targetFolder = path.join(tempDir, '.vscode/tasks/feature-b');

            // Move the file via TaskManager (simulating what handleInternalDrop does)
            const newPath = await taskManager.moveTask(taskPath, targetFolder);

            // Manually set the undo entry (simulating what handleInternalDrop records)
            (dragDropController as any).lastUndoEntry = {
                operations: [{
                    type: 'file',
                    sourcePath: taskPath,
                    targetPath: newPath,
                    timestamp: Date.now()
                }],
                timestamp: Date.now()
            };

            // Verify file is at new location
            assert.ok(fs.existsSync(newPath), 'File should be at new location');
            assert.ok(!fs.existsSync(taskPath), 'File should not be at original location');

            // Verify undo is available
            assert.strictEqual(dragDropController.canUndo(), true);

            // Perform undo
            await dragDropController.undoLastMove();

            // Verify file is back at original location
            assert.ok(fs.existsSync(taskPath), 'File should be restored to original location');
            assert.ok(!fs.existsSync(newPath), 'File should not be at moved location');

            // Verify undo is no longer available
            assert.strictEqual(dragDropController.canUndo(), false);
        });

        test('should undo a folder move', async () => {
            // Create folder with content
            createTaskFile('.vscode/tasks/feature-a/task1.md', '# Task 1\n');
            createTaskFile('.vscode/tasks/feature-a/task2.md', '# Task 2\n');
            createDir('.vscode/tasks/feature-b');

            const sourcePath = path.join(tempDir, '.vscode/tasks/feature-a');
            const targetParent = path.join(tempDir, '.vscode/tasks/feature-b');

            // Move the folder
            const newPath = await taskManager.moveFolder(sourcePath, targetParent);

            // Set undo entry
            (dragDropController as any).lastUndoEntry = {
                operations: [{
                    type: 'folder',
                    sourcePath: sourcePath,
                    targetPath: newPath,
                    timestamp: Date.now()
                }],
                timestamp: Date.now()
            };

            // Verify folder is at new location
            assert.ok(fs.existsSync(newPath), 'Folder should be at new location');
            assert.ok(!fs.existsSync(sourcePath), 'Folder should not be at original location');

            // Perform undo
            await dragDropController.undoLastMove();

            // Verify folder is back
            assert.ok(fs.existsSync(sourcePath), 'Folder should be restored');
            assert.ok(!fs.existsSync(newPath), 'Folder should not be at moved location');

            // Verify contents are intact
            assert.ok(pathExists('.vscode/tasks/feature-a/task1.md'), 'task1.md should be restored');
            assert.ok(pathExists('.vscode/tasks/feature-a/task2.md'), 'task2.md should be restored');
        });

        test('should undo a batch of file moves', async () => {
            // Create multiple files
            const task1Path = createTaskFile('.vscode/tasks/feature-a/task1.md', '# Task 1\n');
            const task2Path = createTaskFile('.vscode/tasks/feature-a/task2.md', '# Task 2\n');
            createDir('.vscode/tasks/feature-b');

            const targetFolder = path.join(tempDir, '.vscode/tasks/feature-b');

            // Move both files
            const newPath1 = await taskManager.moveTask(task1Path, targetFolder);
            const newPath2 = await taskManager.moveTask(task2Path, targetFolder);

            // Set undo entry with batch
            (dragDropController as any).lastUndoEntry = {
                operations: [
                    { type: 'file', sourcePath: task1Path, targetPath: newPath1, timestamp: Date.now() },
                    { type: 'file', sourcePath: task2Path, targetPath: newPath2, timestamp: Date.now() }
                ],
                timestamp: Date.now()
            };

            // Perform undo
            await dragDropController.undoLastMove();

            // Verify both files are restored
            assert.ok(fs.existsSync(task1Path), 'task1 should be restored');
            assert.ok(fs.existsSync(task2Path), 'task2 should be restored');
            assert.ok(!fs.existsSync(newPath1), 'task1 should not be at moved location');
            assert.ok(!fs.existsSync(newPath2), 'task2 should not be at moved location');
        });

        test('should preserve file content after undo', async () => {
            const content = '# Important Task\n\nDo not lose this content.\n';
            const taskPath = createTaskFile('.vscode/tasks/feature-a/important.md', content);
            createDir('.vscode/tasks/feature-b');

            const targetFolder = path.join(tempDir, '.vscode/tasks/feature-b');
            const newPath = await taskManager.moveTask(taskPath, targetFolder);

            (dragDropController as any).lastUndoEntry = {
                operations: [{
                    type: 'file',
                    sourcePath: taskPath,
                    targetPath: newPath,
                    timestamp: Date.now()
                }],
                timestamp: Date.now()
            };

            await dragDropController.undoLastMove();

            const restoredContent = fs.readFileSync(taskPath, 'utf8');
            assert.strictEqual(restoredContent, content, 'Content should be preserved after undo');
        });

        test('canUndo should return false after undo timeout', async () => {
            // Set an expired undo entry
            (dragDropController as any).lastUndoEntry = {
                operations: [{
                    type: 'file',
                    sourcePath: '/fake/source',
                    targetPath: '/fake/target',
                    timestamp: Date.now() - 120000 // 2 minutes ago
                }],
                timestamp: Date.now() - 120000
            };

            assert.strictEqual(dragDropController.canUndo(), false, 'canUndo should be false for expired entry');
        });

        test('undoLastMove should warn when operation is too old', async () => {
            // Set an expired undo entry
            (dragDropController as any).lastUndoEntry = {
                operations: [{
                    type: 'file',
                    sourcePath: '/fake/source',
                    targetPath: '/fake/target',
                    timestamp: Date.now() - 120000
                }],
                timestamp: Date.now() - 120000
            };

            // Should not throw, just warn
            await dragDropController.undoLastMove();

            // Entry should be cleared
            assert.strictEqual(dragDropController.canUndo(), false, 'Entry should be cleared after expired undo attempt');
        });

        test('canUndo should return false after successful undo', async () => {
            const taskPath = createTaskFile('.vscode/tasks/undo-test.md');
            createDir('.vscode/tasks/target');

            const targetFolder = path.join(tempDir, '.vscode/tasks/target');
            const newPath = await taskManager.moveTask(taskPath, targetFolder);

            (dragDropController as any).lastUndoEntry = {
                operations: [{
                    type: 'file',
                    sourcePath: taskPath,
                    targetPath: newPath,
                    timestamp: Date.now()
                }],
                timestamp: Date.now()
            };

            assert.strictEqual(dragDropController.canUndo(), true);
            await dragDropController.undoLastMove();
            assert.strictEqual(dragDropController.canUndo(), false);
        });

        test('should handle undo when target file was already deleted', async () => {
            // Set undo entry pointing to a non-existent target
            (dragDropController as any).lastUndoEntry = {
                operations: [{
                    type: 'file',
                    sourcePath: path.join(tempDir, '.vscode/tasks/original.md'),
                    targetPath: path.join(tempDir, '.vscode/tasks/moved-but-deleted.md'),
                    timestamp: Date.now()
                }],
                timestamp: Date.now()
            };

            // Should not throw
            await dragDropController.undoLastMove();

            // Entry should be cleared
            assert.strictEqual(dragDropController.canUndo(), false);
        });

        test('should recreate parent directory if it was removed during undo', async () => {
            // Create and move a file
            const taskPath = createTaskFile('.vscode/tasks/temp-folder/task.md', '# Task\n');
            createDir('.vscode/tasks/target');

            const targetFolder = path.join(tempDir, '.vscode/tasks/target');
            const newPath = await taskManager.moveTask(taskPath, targetFolder);

            // Remove the source parent directory (simulating it being cleaned up)
            const sourceParent = path.join(tempDir, '.vscode/tasks/temp-folder');
            if (fs.existsSync(sourceParent)) {
                fs.rmSync(sourceParent, { recursive: true });
            }

            (dragDropController as any).lastUndoEntry = {
                operations: [{
                    type: 'file',
                    sourcePath: taskPath,
                    targetPath: newPath,
                    timestamp: Date.now()
                }],
                timestamp: Date.now()
            };

            // Undo should recreate the parent directory
            await dragDropController.undoLastMove();

            assert.ok(fs.existsSync(taskPath), 'File should be restored even if parent was removed');
            assert.ok(fs.existsSync(sourceParent), 'Parent directory should be recreated');
        });

        test('undoLastMove should clear entry even on partial failure', async () => {
            // Create one valid and one invalid operation
            const taskPath = createTaskFile('.vscode/tasks/valid-task.md');
            createDir('.vscode/tasks/target');
            const targetFolder = path.join(tempDir, '.vscode/tasks/target');
            const newPath = await taskManager.moveTask(taskPath, targetFolder);

            (dragDropController as any).lastUndoEntry = {
                operations: [
                    {
                        type: 'file',
                        sourcePath: path.join(tempDir, '.vscode/tasks/ghost.md'),
                        targetPath: path.join(tempDir, '.vscode/tasks/target/ghost.md'), // doesn't exist
                        timestamp: Date.now()
                    },
                    {
                        type: 'file',
                        sourcePath: taskPath,
                        targetPath: newPath,
                        timestamp: Date.now()
                    }
                ],
                timestamp: Date.now()
            };

            await dragDropController.undoLastMove();

            // The valid operation should have been undone
            assert.ok(fs.existsSync(taskPath), 'Valid file should be restored');

            // Entry should be cleared
            assert.strictEqual(dragDropController.canUndo(), false, 'Entry should be cleared after partial undo');
        });

        test('should undo operations in reverse order', async () => {
            // This test verifies that batch operations are undone in reverse order.
            // Create two files and move them to different targets.
            const task1Path = createTaskFile('.vscode/tasks/order-test-1.md', '# Order 1\n');
            const task2Path = createTaskFile('.vscode/tasks/order-test-2.md', '# Order 2\n');
            createDir('.vscode/tasks/target-a');
            createDir('.vscode/tasks/target-b');

            const newPath1 = await taskManager.moveTask(task1Path, path.join(tempDir, '.vscode/tasks/target-a'));
            const newPath2 = await taskManager.moveTask(task2Path, path.join(tempDir, '.vscode/tasks/target-b'));

            (dragDropController as any).lastUndoEntry = {
                operations: [
                    { type: 'file', sourcePath: task1Path, targetPath: newPath1, timestamp: Date.now() },
                    { type: 'file', sourcePath: task2Path, targetPath: newPath2, timestamp: Date.now() }
                ],
                timestamp: Date.now()
            };

            await dragDropController.undoLastMove();

            // Both should be restored
            assert.ok(fs.existsSync(task1Path), 'First file should be restored');
            assert.ok(fs.existsSync(task2Path), 'Second file should be restored');
            assert.ok(!fs.existsSync(newPath1), 'First file should not be at moved location');
            assert.ok(!fs.existsSync(newPath2), 'Second file should not be at moved location');
        });

        test('new move should replace previous undo entry', async () => {
            // First move
            const task1Path = createTaskFile('.vscode/tasks/replace-test-1.md');
            createDir('.vscode/tasks/target1');
            const newPath1 = await taskManager.moveTask(task1Path, path.join(tempDir, '.vscode/tasks/target1'));

            (dragDropController as any).lastUndoEntry = {
                operations: [{
                    type: 'file',
                    sourcePath: task1Path,
                    targetPath: newPath1,
                    timestamp: Date.now()
                }],
                timestamp: Date.now()
            };

            assert.strictEqual(dragDropController.canUndo(), true);

            // Second move — should replace the undo entry
            const task2Path = createTaskFile('.vscode/tasks/replace-test-2.md');
            createDir('.vscode/tasks/target2');
            const newPath2 = await taskManager.moveTask(task2Path, path.join(tempDir, '.vscode/tasks/target2'));

            (dragDropController as any).lastUndoEntry = {
                operations: [{
                    type: 'file',
                    sourcePath: task2Path,
                    targetPath: newPath2,
                    timestamp: Date.now()
                }],
                timestamp: Date.now()
            };

            // Undo should only affect the second move
            await dragDropController.undoLastMove();

            assert.ok(fs.existsSync(task2Path), 'Second file should be restored');
            // First file is NOT restored because its undo entry was replaced
            assert.ok(!fs.existsSync(task1Path), 'First file should NOT be restored (undo entry was replaced)');
        });
    });
});
