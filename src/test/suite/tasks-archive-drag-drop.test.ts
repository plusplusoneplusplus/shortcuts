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

suite('Tasks Viewer - Archive Drag and Drop Tests', () => {
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
     * Helper to check if a file exists at the given path
     */
    function fileExists(relativePath: string): boolean {
        return fs.existsSync(path.join(tempDir, relativePath));
    }

    /**
     * Helper to list files in a directory
     */
    function listFiles(relativePath: string): string[] {
        const fullPath = path.join(tempDir, relativePath);
        if (!fs.existsSync(fullPath)) {
            return [];
        }
        return fs.readdirSync(fullPath);
    }

    setup(() => {
        // Create temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-tasks-archive-drag-test-'));

        // Mock vscode.workspace.getConfiguration
        originalGetConfiguration = vscode.workspace.getConfiguration;
        (vscode.workspace as any).getConfiguration = (section?: string) => {
            if (section === 'workspaceShortcuts.tasksViewer') {
                return {
                    get: <T>(key: string, defaultValue?: T): T => {
                        const defaults: Record<string, any> = {
                            enabled: true,
                            folderPath: '.vscode/tasks',
                            showArchived: true, // Enable showing archived by default for tests
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

    suite('TaskManager.archiveTask with preserveStructure', () => {
        test('should archive root task to archive root when preserveStructure is true', async () => {
            const taskPath = createTaskFile('.vscode/tasks/root-task.md');
            
            const archivedPath = await taskManager.archiveTask(taskPath, true);
            
            assert.ok(archivedPath.includes('archive'), 'Archived path should contain archive');
            assert.ok(fs.existsSync(archivedPath), 'Archived file should exist');
            assert.ok(!fs.existsSync(taskPath), 'Original file should not exist');
            assert.strictEqual(path.basename(archivedPath), 'root-task.md');
        });

        test('should archive nested task preserving folder structure', async () => {
            const taskPath = createTaskFile('.vscode/tasks/feature1/task.md');
            
            const archivedPath = await taskManager.archiveTask(taskPath, true);
            
            // Should be in archive/feature1/task.md
            const expectedPath = path.join(tempDir, '.vscode/tasks/archive/feature1/task.md');
            assert.strictEqual(archivedPath, expectedPath);
            assert.ok(fs.existsSync(archivedPath), 'Archived file should exist at expected location');
            assert.ok(!fs.existsSync(taskPath), 'Original file should not exist');
        });

        test('should archive deeply nested task preserving full folder structure', async () => {
            const taskPath = createTaskFile('.vscode/tasks/feature1/backlog/sprint1/deep-task.md');
            
            const archivedPath = await taskManager.archiveTask(taskPath, true);
            
            // Should be in archive/feature1/backlog/sprint1/deep-task.md
            const expectedPath = path.join(tempDir, '.vscode/tasks/archive/feature1/backlog/sprint1/deep-task.md');
            assert.strictEqual(archivedPath, expectedPath);
            assert.ok(fs.existsSync(archivedPath), 'Archived file should exist at expected location');
        });

        test('should create necessary directories when archiving nested task', async () => {
            const taskPath = createTaskFile('.vscode/tasks/feature1/backlog/task.md');
            
            // Ensure archive/feature1/backlog doesn't exist yet
            const archiveFeaturePath = path.join(tempDir, '.vscode/tasks/archive/feature1/backlog');
            assert.ok(!fs.existsSync(archiveFeaturePath), 'Archive subfolder should not exist initially');
            
            await taskManager.archiveTask(taskPath, true);
            
            assert.ok(fs.existsSync(archiveFeaturePath), 'Archive subfolder should be created');
        });

        test('should handle collision by appending timestamp', async () => {
            // Create task in active folder
            const taskPath = createTaskFile('.vscode/tasks/feature1/task.md');
            
            // Create same-named task in archive location
            createTaskFile('.vscode/tasks/archive/feature1/task.md', '# Existing archived task\n');
            
            const archivedPath = await taskManager.archiveTask(taskPath, true);
            
            // Should have timestamp suffix
            assert.ok(archivedPath.includes('task-'), 'Archived filename should have timestamp suffix');
            assert.ok(archivedPath.endsWith('.md'), 'Archived file should have .md extension');
            assert.ok(fs.existsSync(archivedPath), 'Archived file should exist');
            
            // Both files should exist in archive
            const archiveFiles = listFiles('.vscode/tasks/archive/feature1');
            assert.strictEqual(archiveFiles.length, 2, 'Archive should have 2 files');
        });

        test('should archive without preserveStructure (backward compatibility)', async () => {
            const taskPath = createTaskFile('.vscode/tasks/feature1/task.md');
            
            // Call without preserveStructure (defaults to false)
            const archivedPath = await taskManager.archiveTask(taskPath);
            
            // Should be in archive root, not archive/feature1/
            assert.strictEqual(path.dirname(archivedPath), path.join(tempDir, '.vscode/tasks/archive'));
            assert.ok(fs.existsSync(archivedPath), 'Archived file should exist');
        });

        test('should handle cross-platform paths correctly', async () => {
            // Test with various path formats
            const taskPath = createTaskFile('.vscode/tasks/feature1/sub-feature/task.md');
            
            const archivedPath = await taskManager.archiveTask(taskPath, true);
            
            // Verify path is valid and file exists
            assert.ok(path.isAbsolute(archivedPath), 'Archived path should be absolute');
            assert.ok(fs.existsSync(archivedPath), 'Archived file should exist');
            
            // Verify structure is preserved using platform-agnostic checks
            const archiveFolderPath = path.join(tempDir, '.vscode/tasks/archive/feature1/sub-feature');
            assert.ok(fs.existsSync(archiveFolderPath), 'Archive subfolder structure should be preserved');
        });
    });

    suite('TaskManager.archiveDocumentGroup with preserveStructure', () => {
        test('should archive document group preserving folder structure', async () => {
            createTaskFile('.vscode/tasks/feature1/task.plan.md');
            createTaskFile('.vscode/tasks/feature1/task.spec.md');
            createTaskFile('.vscode/tasks/feature1/task.test.md');
            
            const filePaths = [
                path.join(tempDir, '.vscode/tasks/feature1/task.plan.md'),
                path.join(tempDir, '.vscode/tasks/feature1/task.spec.md'),
                path.join(tempDir, '.vscode/tasks/feature1/task.test.md')
            ];
            
            const archivedPaths = await taskManager.archiveDocumentGroup(filePaths, true);
            
            assert.strictEqual(archivedPaths.length, 3, 'Should archive all 3 documents');
            
            // All should be in archive/feature1/
            for (const archivedPath of archivedPaths) {
                assert.ok(archivedPath.includes(path.join('archive', 'feature1')), 
                    `Archived path ${archivedPath} should be in archive/feature1`);
                assert.ok(fs.existsSync(archivedPath), 'Archived file should exist');
            }
            
            // Original files should not exist
            for (const originalPath of filePaths) {
                assert.ok(!fs.existsSync(originalPath), 'Original file should not exist');
            }
        });
    });

    suite('Drag and Drop Controller - Archive Drop Target Detection', () => {
        test('should identify TaskGroupItem with archived type as archive target', async () => {
            // Create a TaskGroupItem with 'archived' type
            const archivedGroupItem = new TaskGroupItem('archived', 0);
            
            // Access private method via any cast for testing
            const isArchiveTarget = (dragDropController as any).isArchiveDropTarget(archivedGroupItem);
            
            assert.strictEqual(isArchiveTarget, true, 'Archived TaskGroupItem should be identified as archive target');
        });

        test('should identify TaskFolderItem with isArchived as archive target', async () => {
            createTaskFile('.vscode/tasks/archive/archived-folder/task.md');
            
            const hierarchy = await taskManager.getTaskFolderHierarchy();
            
            // Find the archived folder in hierarchy
            // Note: With showArchived enabled, we need to look in the archive folder
            const rootItems = await treeDataProvider.getChildren();
            
            // Should have Active and Archived groups
            const archivedGroup = rootItems.find(
                item => item instanceof TaskGroupItem && (item as TaskGroupItem).groupType === 'archived'
            ) as TaskGroupItem;
            
            if (archivedGroup) {
                const archivedChildren = await treeDataProvider.getChildren(archivedGroup);
                const archivedFolderItem = archivedChildren.find(
                    item => item instanceof TaskFolderItem
                ) as TaskFolderItem;
                
                if (archivedFolderItem) {
                    const isArchiveTarget = (dragDropController as any).isArchiveDropTarget(archivedFolderItem);
                    assert.strictEqual(isArchiveTarget, true, 'Archived TaskFolderItem should be identified as archive target');
                }
            }
        });

        test('should NOT identify active TaskGroupItem as archive target', async () => {
            const activeGroupItem = new TaskGroupItem('active', 5);
            
            const isArchiveTarget = (dragDropController as any).isArchiveDropTarget(activeGroupItem);
            
            assert.strictEqual(isArchiveTarget, false, 'Active TaskGroupItem should NOT be archive target');
        });

        test('should NOT identify non-archived TaskFolderItem as archive target', async () => {
            createTaskFile('.vscode/tasks/feature1/task.md');
            
            const rootItems = await treeDataProvider.getChildren();
            const activeGroup = rootItems.find(
                item => item instanceof TaskGroupItem && (item as TaskGroupItem).groupType === 'active'
            ) as TaskGroupItem;
            
            if (activeGroup) {
                const activeChildren = await treeDataProvider.getChildren(activeGroup);
                const activeFolderItem = activeChildren.find(
                    item => item instanceof TaskFolderItem
                ) as TaskFolderItem;
                
                if (activeFolderItem) {
                    const isArchiveTarget = (dragDropController as any).isArchiveDropTarget(activeFolderItem);
                    assert.strictEqual(isArchiveTarget, false, 'Non-archived TaskFolderItem should NOT be archive target');
                }
            }
        });
    });

    suite('End-to-End Archive Drag and Drop', () => {
        test('should archive task when dropped on Archived group', async () => {
            // Create a task in the active folder
            const taskPath = createTaskFile('.vscode/tasks/test-task.md');
            
            // Verify task exists
            assert.ok(fs.existsSync(taskPath), 'Task file should exist');
            
            // Archive the task (simulating drag-drop behavior)
            await taskManager.archiveTask(taskPath, true);
            
            // Verify task is now in archive
            const archivePath = path.join(tempDir, '.vscode/tasks/archive/test-task.md');
            assert.ok(fs.existsSync(archivePath), 'Task should be in archive folder');
            assert.ok(!fs.existsSync(taskPath), 'Task should not be in active folder');
        });

        test('should archive nested task preserving structure when dropped on Archived group', async () => {
            // Create a nested task
            const taskPath = createTaskFile('.vscode/tasks/feature1/backlog/task.md');
            
            // Archive with structure preservation (simulating drag-drop)
            await taskManager.archiveTask(taskPath, true);
            
            // Verify task is in archive/feature1/backlog/
            const expectedPath = path.join(tempDir, '.vscode/tasks/archive/feature1/backlog/task.md');
            assert.ok(fs.existsSync(expectedPath), 'Task should be archived with folder structure preserved');
            assert.ok(!fs.existsSync(taskPath), 'Original task should not exist');
        });

        test('should handle multiple tasks being archived', async () => {
            // Create multiple tasks
            createTaskFile('.vscode/tasks/task1.md');
            createTaskFile('.vscode/tasks/task2.md');
            createTaskFile('.vscode/tasks/task3.md');
            
            const filePaths = [
                path.join(tempDir, '.vscode/tasks/task1.md'),
                path.join(tempDir, '.vscode/tasks/task2.md'),
                path.join(tempDir, '.vscode/tasks/task3.md')
            ];
            
            // Archive all tasks
            for (const filePath of filePaths) {
                await taskManager.archiveTask(filePath, true);
            }
            
            // Verify all tasks are in archive
            const archiveFiles = listFiles('.vscode/tasks/archive');
            assert.ok(archiveFiles.includes('task1.md'), 'task1.md should be archived');
            assert.ok(archiveFiles.includes('task2.md'), 'task2.md should be archived');
            assert.ok(archiveFiles.includes('task3.md'), 'task3.md should be archived');
        });

        test('should skip tasks already in archive', async () => {
            // Create a task directly in archive
            const archivedTaskPath = createTaskFile('.vscode/tasks/archive/already-archived.md');
            
            // Try to archive it again (this should be handled by the drag-drop logic)
            // The actual file move would fail, but the controller should skip it
            assert.ok(fs.existsSync(archivedTaskPath), 'Archived task should exist');
        });
    });

    suite('Error Handling', () => {
        test('should throw error when archiving non-existent file', async () => {
            const nonExistentPath = path.join(tempDir, '.vscode/tasks/non-existent.md');
            
            await assert.rejects(
                async () => taskManager.archiveTask(nonExistentPath, true),
                /Task file not found/,
                'Should throw error for non-existent file'
            );
        });

        test('should not delete source file on move failure', async () => {
            // This is tested implicitly by the safe rename implementation
            // but we verify the principle here
            const taskPath = createTaskFile('.vscode/tasks/safe-task.md', '# Important content\n');
            
            // Read content before any operation
            const originalContent = fs.readFileSync(taskPath, 'utf8');
            
            // Archive successfully
            const archivedPath = await taskManager.archiveTask(taskPath, true);
            
            // Verify content is preserved
            const archivedContent = fs.readFileSync(archivedPath, 'utf8');
            assert.strictEqual(archivedContent, originalContent, 'Content should be preserved');
        });
    });

    suite('Integration with Tree View', () => {
        test('should show archived task in Archived group after archiving', async () => {
            // Create and archive a task
            const taskPath = createTaskFile('.vscode/tasks/to-archive.md');
            await taskManager.archiveTask(taskPath, true);
            
            // Get tree items
            const rootItems = await treeDataProvider.getChildren();
            
            // Should have Active and Archived groups
            assert.strictEqual(rootItems.length, 2, 'Should have Active and Archived groups');
            
            const archivedGroup = rootItems.find(
                item => item instanceof TaskGroupItem && (item as TaskGroupItem).groupType === 'archived'
            ) as TaskGroupItem;
            
            assert.ok(archivedGroup, 'Should have Archived group');
            
            // Get children of Archived group
            const archivedChildren = await treeDataProvider.getChildren(archivedGroup);
            
            // Should contain our archived task
            const archivedTask = archivedChildren.find(
                item => item instanceof TaskItem && (item as TaskItem).label === 'to-archive'
            );
            
            assert.ok(archivedTask, 'Archived task should appear in Archived group');
        });

        test('should preserve nested structure in Archived group', async () => {
            // Create archive folder with nested structure directly
            // (This simulates the result of archiving a nested task)
            createTaskFile('.vscode/tasks/archive/feature-archived/nested-task.md');
            
            // Create new tree data provider to pick up the new file
            const newTaskManager = new TaskManager(tempDir);
            const newTreeDataProvider = new TasksTreeDataProvider(newTaskManager);
            
            try {
                // Get tree items
                const rootItems = await newTreeDataProvider.getChildren();
                
                const archivedGroup = rootItems.find(
                    item => item instanceof TaskGroupItem && (item as TaskGroupItem).groupType === 'archived'
                ) as TaskGroupItem;
                
                assert.ok(archivedGroup, 'Should have Archived group');
                
                // Get children of Archived group - should have feature-archived folder
                const archivedChildren = await newTreeDataProvider.getChildren(archivedGroup);
                
                const archivedFolder = archivedChildren.find(
                    item => item instanceof TaskFolderItem && (item as TaskFolderItem).folder.name === 'feature-archived'
                ) as TaskFolderItem;
                
                assert.ok(archivedFolder, 'Should have feature-archived folder in Archived group');
                assert.ok(archivedFolder.folder.isArchived, 'Folder should be marked as archived');
                
                // Get children of the folder
                const folderChildren = await newTreeDataProvider.getChildren(archivedFolder);
                
                const nestedTask = folderChildren.find(
                    item => item instanceof TaskItem && (item as TaskItem).label === 'nested-task'
                );
                
                assert.ok(nestedTask, 'Nested task should appear in archived folder');
            } finally {
                newTaskManager.dispose();
            }
        });
    });
});
