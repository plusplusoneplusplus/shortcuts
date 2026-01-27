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
    TaskGroupItem, 
    TasksDragDropController,
    TaskDocument,
    TaskDocumentGroup,
    TaskDocumentGroupItem,
    TaskDocumentItem
} from '../../shortcuts/tasks-viewer';

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
                const fileName = path.basename(filePath);

                assert.ok(fs.existsSync(filePath));
                // Check only the filename (not full path) to avoid Windows drive letter colon
                assert.ok(!fileName.includes(':'), 'Filename should not contain colon');
                assert.ok(!fileName.includes('<'), 'Filename should not contain <');
                assert.ok(!fileName.includes('>'), 'Filename should not contain >');
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

        suite('Feature Creation', () => {
            test('should create a new feature folder', async () => {
                const folderPath = await taskManager.createFeature('My Feature');

                assert.ok(fs.existsSync(folderPath), 'Feature folder should exist');
                assert.ok(fs.statSync(folderPath).isDirectory(), 'Feature should be a directory');
            });

            test('should sanitize feature name for folder', async () => {
                const folderPath = await taskManager.createFeature('Feature: With <Special> Chars!');
                const folderName = path.basename(folderPath);

                assert.ok(fs.existsSync(folderPath));
                assert.ok(!folderName.includes(':'), 'Folder name should not contain colon');
                assert.ok(!folderName.includes('<'), 'Folder name should not contain <');
                assert.ok(!folderName.includes('>'), 'Folder name should not contain >');
            });

            test('should throw error if feature already exists', async () => {
                await taskManager.createFeature('Duplicate Feature');

                await assert.rejects(
                    async () => await taskManager.createFeature('Duplicate Feature'),
                    /already exists/i
                );
            });

            test('should create feature with spaces in name', async () => {
                const folderPath = await taskManager.createFeature('Feature With Spaces');
                assert.ok(fs.existsSync(folderPath));
                assert.ok(fs.statSync(folderPath).isDirectory());
            });

            test('should create feature folder inside tasks folder', async () => {
                const folderPath = await taskManager.createFeature('My Feature');
                const tasksFolder = taskManager.getTasksFolder();

                assert.ok(folderPath.startsWith(tasksFolder), 'Feature should be inside tasks folder');
            });

            test('should create meta.md file in feature folder', async () => {
                const folderPath = await taskManager.createFeature('My Feature');
                const metaFilePath = path.join(folderPath, 'meta.md');
                
                assert.ok(fs.existsSync(metaFilePath), 'meta.md should exist in feature folder');
                
                const content = fs.readFileSync(metaFilePath, 'utf8');
                assert.strictEqual(content, '', 'meta.md should be empty initially');
            });

            test('should make feature visible in task tree after creation', async () => {
                await taskManager.createFeature('Test Feature');

                // The meta.md file should make the feature visible
                const tasks = await taskManager.getTasks();
                const featureTask = tasks.find(t => t.relativePath === 'Test-Feature');
                assert.ok(featureTask, 'Feature should be visible with meta.md file');
                assert.strictEqual(featureTask.name, 'meta', 'meta.md should be found');
            });

            test('should allow creating tasks inside feature folder', async () => {
                const featurePath = await taskManager.createFeature('Test Feature');

                // Create a task file inside the feature folder
                const taskFile = path.join(featurePath, 'task.md');
                fs.writeFileSync(taskFile, '# Task in Feature');

                assert.ok(fs.existsSync(taskFile));

                // The task should be visible in getTasks (with relativePath)
                const tasks = await taskManager.getTasks();
                const featureTask = tasks.find(t => t.relativePath === 'Test-Feature');
                assert.ok(featureTask, 'Task in feature should be found');
            });
        });

        suite('Subfolder Creation', () => {
            test('should create a new subfolder inside feature folder', async () => {
                const featurePath = await taskManager.createFeature('Parent Feature');
                const subfolderPath = await taskManager.createSubfolder(featurePath, 'Child Folder');

                assert.ok(fs.existsSync(subfolderPath), 'Subfolder should exist');
                assert.ok(fs.statSync(subfolderPath).isDirectory(), 'Subfolder should be a directory');
            });

            test('should sanitize subfolder name', async () => {
                const featurePath = await taskManager.createFeature('Parent Feature');
                const subfolderPath = await taskManager.createSubfolder(featurePath, 'Sub: With <Special> Chars!');
                const folderName = path.basename(subfolderPath);

                assert.ok(fs.existsSync(subfolderPath));
                assert.ok(!folderName.includes(':'), 'Folder name should not contain colon');
                assert.ok(!folderName.includes('<'), 'Folder name should not contain <');
                assert.ok(!folderName.includes('>'), 'Folder name should not contain >');
            });

            test('should throw error if subfolder already exists', async () => {
                const featurePath = await taskManager.createFeature('Parent Feature');
                await taskManager.createSubfolder(featurePath, 'Duplicate Sub');

                await assert.rejects(
                    async () => await taskManager.createSubfolder(featurePath, 'Duplicate Sub'),
                    /already exists/i
                );
            });

            test('should throw error if parent folder does not exist', async () => {
                const nonExistentPath = path.join(tempDir, 'non-existent-folder');

                await assert.rejects(
                    async () => await taskManager.createSubfolder(nonExistentPath, 'Child'),
                    /Parent folder not found/i
                );
            });

            test('should create subfolder with spaces in name', async () => {
                const featurePath = await taskManager.createFeature('Parent Feature');
                const subfolderPath = await taskManager.createSubfolder(featurePath, 'Subfolder With Spaces');

                assert.ok(fs.existsSync(subfolderPath));
                assert.ok(fs.statSync(subfolderPath).isDirectory());
            });

            test('should create subfolder inside parent feature folder', async () => {
                const featurePath = await taskManager.createFeature('Parent Feature');
                const subfolderPath = await taskManager.createSubfolder(featurePath, 'My Sub');

                assert.ok(subfolderPath.startsWith(featurePath), 'Subfolder should be inside parent folder');
            });

            test('should create meta.md file in subfolder', async () => {
                const featurePath = await taskManager.createFeature('Parent Feature');
                const subfolderPath = await taskManager.createSubfolder(featurePath, 'My Sub');
                const metaFilePath = path.join(subfolderPath, 'meta.md');

                assert.ok(fs.existsSync(metaFilePath), 'meta.md should exist in subfolder');

                const content = fs.readFileSync(metaFilePath, 'utf8');
                assert.strictEqual(content, '', 'meta.md should be empty initially');
            });

            test('should make subfolder visible in task tree after creation', async () => {
                const featurePath = await taskManager.createFeature('Parent Feature');
                await taskManager.createSubfolder(featurePath, 'Test Sub');

                // The meta.md file should make the subfolder visible
                const tasks = await taskManager.getTasks();
                // Subfolder path should be Parent-Feature/Test-Sub
                const subfolderTask = tasks.find(t => t.relativePath === path.join('Parent-Feature', 'Test-Sub'));
                assert.ok(subfolderTask, 'Subfolder should be visible with meta.md file');
                assert.strictEqual(subfolderTask.name, 'meta', 'meta.md should be found');
            });

            test('should support arbitrary nesting depth', async () => {
                const featurePath = await taskManager.createFeature('Level1');
                const level2Path = await taskManager.createSubfolder(featurePath, 'Level2');
                const level3Path = await taskManager.createSubfolder(level2Path, 'Level3');
                const level4Path = await taskManager.createSubfolder(level3Path, 'Level4');

                assert.ok(fs.existsSync(level4Path), 'Deeply nested folder should exist');

                // Verify all meta.md files exist
                assert.ok(fs.existsSync(path.join(featurePath, 'meta.md')));
                assert.ok(fs.existsSync(path.join(level2Path, 'meta.md')));
                assert.ok(fs.existsSync(path.join(level3Path, 'meta.md')));
                assert.ok(fs.existsSync(path.join(level4Path, 'meta.md')));

                // Verify deeply nested folder is visible in task tree
                const tasks = await taskManager.getTasks();
                const deepTask = tasks.find(t => 
                    t.relativePath === path.join('Level1', 'Level2', 'Level3', 'Level4')
                );
                assert.ok(deepTask, 'Deeply nested subfolder should be visible');
            });

            test('should allow creating tasks inside subfolder', async () => {
                const featurePath = await taskManager.createFeature('Parent Feature');
                const subfolderPath = await taskManager.createSubfolder(featurePath, 'Test Sub');

                // Create a task file inside the subfolder
                const taskFile = path.join(subfolderPath, 'task-in-sub.md');
                fs.writeFileSync(taskFile, '# Task in Subfolder');

                assert.ok(fs.existsSync(taskFile));

                // The task should be visible in getTasks (with relativePath)
                const tasks = await taskManager.getTasks();
                const subTask = tasks.find(t => 
                    t.relativePath === path.join('Parent-Feature', 'Test-Sub') && t.name === 'task-in-sub'
                );
                assert.ok(subTask, 'Task in subfolder should be found');
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

        suite('Folder Renaming', () => {
            test('should rename a folder', async () => {
                const originalPath = await taskManager.createFeature('Original Folder');
                const newPath = await taskManager.renameFolder(originalPath, 'New Folder');

                assert.ok(!fs.existsSync(originalPath), 'Original folder should not exist');
                assert.ok(fs.existsSync(newPath), 'New folder should exist');
                assert.ok(fs.statSync(newPath).isDirectory(), 'New path should be a directory');
            });

            test('should throw error when renaming to existing name', async () => {
                const path1 = await taskManager.createFeature('Folder One');
                const path2 = await taskManager.createFeature('Folder Two');

                await assert.rejects(
                    async () => await taskManager.renameFolder(path1, 'Folder-Two'),
                    /already exists/i
                );
            });

            test('should throw error when folder not found', async () => {
                await assert.rejects(
                    async () => await taskManager.renameFolder('/non/existent/folder', 'New Name'),
                    /not found/i
                );
            });

            test('should throw error when path is not a directory', async () => {
                const filePath = await taskManager.createTask('Test Task');

                await assert.rejects(
                    async () => await taskManager.renameFolder(filePath, 'New Name'),
                    /not a directory/i
                );
            });

            test('should preserve folder contents after rename', async () => {
                const originalPath = await taskManager.createFeature('Feature With Content');
                const taskFile = path.join(originalPath, 'task.md');
                fs.writeFileSync(taskFile, '# Task Content');
                
                const newPath = await taskManager.renameFolder(originalPath, 'Renamed Feature');
                
                const newTaskFile = path.join(newPath, 'task.md');
                assert.ok(fs.existsSync(newTaskFile), 'Task file should exist in renamed folder');
                const content = fs.readFileSync(newTaskFile, 'utf8');
                assert.ok(content.includes('# Task Content'), 'Content should be preserved');
            });

            test('should allow renaming nested subfolder', async () => {
                const featurePath = await taskManager.createFeature('Parent');
                const subfolderPath = await taskManager.createSubfolder(featurePath, 'Child');
                
                const newPath = await taskManager.renameFolder(subfolderPath, 'Renamed Child');
                
                assert.ok(!fs.existsSync(subfolderPath), 'Original subfolder should not exist');
                assert.ok(fs.existsSync(newPath), 'Renamed subfolder should exist');
                assert.ok(newPath.includes('Parent'), 'Should still be inside parent folder');
            });
        });

        suite('Document Group Renaming', () => {
            test('should rename all documents in a group', async () => {
                const featurePath = await taskManager.createFeature('Feature');
                
                // Create document group: task1.plan.md, task1.spec.md, task1.test.md
                fs.writeFileSync(path.join(featurePath, 'task1.plan.md'), '# Plan');
                fs.writeFileSync(path.join(featurePath, 'task1.spec.md'), '# Spec');
                fs.writeFileSync(path.join(featurePath, 'task1.test.md'), '# Test');
                
                const newPaths = await taskManager.renameDocumentGroup(featurePath, 'task1', 'renamed-task');
                
                assert.strictEqual(newPaths.length, 3, 'Should have renamed 3 documents');
                
                // Verify old files don't exist
                assert.ok(!fs.existsSync(path.join(featurePath, 'task1.plan.md')));
                assert.ok(!fs.existsSync(path.join(featurePath, 'task1.spec.md')));
                assert.ok(!fs.existsSync(path.join(featurePath, 'task1.test.md')));
                
                // Verify new files exist
                assert.ok(fs.existsSync(path.join(featurePath, 'renamed-task.plan.md')));
                assert.ok(fs.existsSync(path.join(featurePath, 'renamed-task.spec.md')));
                assert.ok(fs.existsSync(path.join(featurePath, 'renamed-task.test.md')));
            });

            test('should throw error if folder not found', async () => {
                await assert.rejects(
                    async () => await taskManager.renameDocumentGroup('/non/existent/folder', 'old', 'new'),
                    /not found/i
                );
            });

            test('should throw error if no documents with base name exist', async () => {
                const featurePath = await taskManager.createFeature('Empty Feature');
                
                await assert.rejects(
                    async () => await taskManager.renameDocumentGroup(featurePath, 'nonexistent', 'new'),
                    /No documents found/i
                );
            });

            test('should throw error if new name would cause collision', async () => {
                const featurePath = await taskManager.createFeature('Feature');
                
                // Create two groups
                fs.writeFileSync(path.join(featurePath, 'task1.plan.md'), '# Task 1');
                fs.writeFileSync(path.join(featurePath, 'task2.plan.md'), '# Task 2');
                
                await assert.rejects(
                    async () => await taskManager.renameDocumentGroup(featurePath, 'task1', 'task2'),
                    /already exists/i
                );
            });

            test('should rename single document without doc type suffix', async () => {
                const featurePath = await taskManager.createFeature('Feature');
                
                // Create single document without doc type suffix
                fs.writeFileSync(path.join(featurePath, 'simple-task.md'), '# Simple');
                
                const newPaths = await taskManager.renameDocumentGroup(featurePath, 'simple-task', 'renamed-simple');
                
                assert.strictEqual(newPaths.length, 1);
                assert.ok(!fs.existsSync(path.join(featurePath, 'simple-task.md')));
                assert.ok(fs.existsSync(path.join(featurePath, 'renamed-simple.md')));
            });

            test('should preserve file contents after rename', async () => {
                const featurePath = await taskManager.createFeature('Feature');
                
                fs.writeFileSync(path.join(featurePath, 'task1.plan.md'), '# Original Plan Content');
                
                await taskManager.renameDocumentGroup(featurePath, 'task1', 'renamed');
                
                const content = fs.readFileSync(path.join(featurePath, 'renamed.plan.md'), 'utf8');
                assert.ok(content.includes('# Original Plan Content'), 'Content should be preserved');
            });
        });

        suite('Single Document Renaming', () => {
            test('should rename a single document preserving doc type', async () => {
                const featurePath = await taskManager.createFeature('Feature');
                const oldPath = path.join(featurePath, 'task1.plan.md');
                fs.writeFileSync(oldPath, '# Plan');
                
                const newPath = await taskManager.renameDocument(oldPath, 'renamed-task');
                
                assert.ok(!fs.existsSync(oldPath), 'Original file should not exist');
                assert.ok(fs.existsSync(newPath), 'Renamed file should exist');
                assert.ok(newPath.endsWith('renamed-task.plan.md'), 'Should preserve doc type suffix');
            });

            test('should rename document without doc type suffix', async () => {
                const featurePath = await taskManager.createFeature('Feature');
                const oldPath = path.join(featurePath, 'simple.md');
                fs.writeFileSync(oldPath, '# Simple');
                
                const newPath = await taskManager.renameDocument(oldPath, 'renamed');
                
                assert.ok(!fs.existsSync(oldPath));
                assert.ok(fs.existsSync(newPath));
                assert.ok(newPath.endsWith('renamed.md'));
            });

            test('should throw error when document not found', async () => {
                await assert.rejects(
                    async () => await taskManager.renameDocument('/non/existent/doc.md', 'new'),
                    /not found/i
                );
            });

            test('should throw error if new name would cause collision', async () => {
                const featurePath = await taskManager.createFeature('Feature');
                
                fs.writeFileSync(path.join(featurePath, 'doc1.plan.md'), '# Doc 1');
                fs.writeFileSync(path.join(featurePath, 'doc2.plan.md'), '# Doc 2');
                
                await assert.rejects(
                    async () => await taskManager.renameDocument(
                        path.join(featurePath, 'doc1.plan.md'),
                        'doc2'
                    ),
                    /already exists/i
                );
            });

            test('should preserve file contents after rename', async () => {
                const featurePath = await taskManager.createFeature('Feature');
                const oldPath = path.join(featurePath, 'original.spec.md');
                fs.writeFileSync(oldPath, '# Original Spec Content');
                
                const newPath = await taskManager.renameDocument(oldPath, 'renamed');
                
                const content = fs.readFileSync(newPath, 'utf8');
                assert.ok(content.includes('# Original Spec Content'), 'Content should be preserved');
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
                const originalPath = await taskManager.createTask('To Restore');
                const archivedPath = await taskManager.archiveTask(originalPath);
                const restoredPath = await taskManager.unarchiveTask(archivedPath);

                assert.ok(!fs.existsSync(archivedPath), 'Archived should not exist');
                assert.ok(fs.existsSync(restoredPath), 'Restored file should exist');
                // Check that the path doesn't include the archive folder (use path separator to be precise)
                assert.ok(!restoredPath.includes(path.sep + 'archive' + path.sep), 'Path should not be in archive folder');
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

            test('should archive a document', async () => {
                const tasksFolder = taskManager.getTasksFolder();
                taskManager.ensureFoldersExist();
                
                // Create a document file
                const docPath = path.join(tasksFolder, 'test-doc.plan.md');
                fs.writeFileSync(docPath, '# Test Document');
                
                const archivedPath = await taskManager.archiveDocument(docPath);
                
                assert.ok(!fs.existsSync(docPath), 'Original document should not exist');
                assert.ok(fs.existsSync(archivedPath), 'Archived document should exist');
                assert.ok(archivedPath.includes('archive'), 'Path should contain archive');
            });

            test('should unarchive a document', async () => {
                const tasksFolder = taskManager.getTasksFolder();
                const archiveFolder = taskManager.getArchiveFolder();
                taskManager.ensureFoldersExist();
                
                // Create document directly in archive
                const docPath = path.join(archiveFolder, 'archived-doc.spec.md');
                fs.writeFileSync(docPath, '# Archived Document');
                
                const unarchivedPath = await taskManager.unarchiveDocument(docPath);
                
                assert.ok(!fs.existsSync(docPath), 'Archived document should not exist');
                assert.ok(fs.existsSync(unarchivedPath), 'Unarchived document should exist');
                assert.ok(!unarchivedPath.includes(path.sep + 'archive' + path.sep), 'Path should not be in archive folder');
            });

            test('should archive a document group', async () => {
                const tasksFolder = taskManager.getTasksFolder();
                taskManager.ensureFoldersExist();
                
                // Create multiple documents in a group
                const doc1 = path.join(tasksFolder, 'feature1.plan.md');
                const doc2 = path.join(tasksFolder, 'feature1.spec.md');
                const doc3 = path.join(tasksFolder, 'feature1.test.md');
                fs.writeFileSync(doc1, '# Plan');
                fs.writeFileSync(doc2, '# Spec');
                fs.writeFileSync(doc3, '# Test');
                
                const archivedPaths = await taskManager.archiveDocumentGroup([doc1, doc2, doc3]);
                
                assert.strictEqual(archivedPaths.length, 3, 'Should return 3 archived paths');
                assert.ok(!fs.existsSync(doc1), 'Doc1 should not exist');
                assert.ok(!fs.existsSync(doc2), 'Doc2 should not exist');
                assert.ok(!fs.existsSync(doc3), 'Doc3 should not exist');
                for (const archivedPath of archivedPaths) {
                    assert.ok(fs.existsSync(archivedPath), 'Archived file should exist');
                    assert.ok(archivedPath.includes('archive'), 'Path should contain archive');
                }
            });

            test('should unarchive a document group', async () => {
                const archiveFolder = taskManager.getArchiveFolder();
                taskManager.ensureFoldersExist();
                
                // Create documents directly in archive
                const doc1 = path.join(archiveFolder, 'feature2.plan.md');
                const doc2 = path.join(archiveFolder, 'feature2.spec.md');
                fs.writeFileSync(doc1, '# Plan');
                fs.writeFileSync(doc2, '# Spec');
                
                const unarchivedPaths = await taskManager.unarchiveDocumentGroup([doc1, doc2]);
                
                assert.strictEqual(unarchivedPaths.length, 2, 'Should return 2 unarchived paths');
                assert.ok(!fs.existsSync(doc1), 'Archived doc1 should not exist');
                assert.ok(!fs.existsSync(doc2), 'Archived doc2 should not exist');
                for (const unarchivedPath of unarchivedPaths) {
                    assert.ok(fs.existsSync(unarchivedPath), 'Unarchived file should exist');
                    assert.ok(!unarchivedPath.includes(path.sep + 'archive' + path.sep), 'Path should not be in archive folder');
                }
            });

            test('should handle name collision when archiving document', async () => {
                const tasksFolder = taskManager.getTasksFolder();
                const archiveFolder = taskManager.getArchiveFolder();
                taskManager.ensureFoldersExist();
                
                // Create first document and archive it
                const docPath1 = path.join(tasksFolder, 'collision-doc.md');
                fs.writeFileSync(docPath1, '# Document 1');
                await taskManager.archiveDocument(docPath1);
                
                // Create another document with same name and archive it
                const docPath2 = path.join(tasksFolder, 'collision-doc.md');
                fs.writeFileSync(docPath2, '# Document 2');
                const archivedPath2 = await taskManager.archiveDocument(docPath2);
                
                // Should have timestamp suffix to avoid collision
                assert.ok(fs.existsSync(archivedPath2), 'Second archived file should exist');
                const archivedFiles = fs.readdirSync(archiveFolder).filter(f => f.startsWith('collision-doc'));
                assert.strictEqual(archivedFiles.length, 2, 'Should have 2 archived files');
            });

            test('should handle name collision when unarchiving document', async () => {
                const tasksFolder = taskManager.getTasksFolder();
                const archiveFolder = taskManager.getArchiveFolder();
                taskManager.ensureFoldersExist();
                
                // Create a document in tasks folder
                const existingDoc = path.join(tasksFolder, 'existing-doc.md');
                fs.writeFileSync(existingDoc, '# Existing');
                
                // Create an archived document with same name
                const archivedDoc = path.join(archiveFolder, 'existing-doc.md');
                fs.writeFileSync(archivedDoc, '# Archived');
                
                // Unarchive should handle collision
                const unarchivedPath = await taskManager.unarchiveDocument(archivedDoc);
                
                assert.ok(fs.existsSync(existingDoc), 'Existing document should still exist');
                assert.ok(fs.existsSync(unarchivedPath), 'Unarchived document should exist');
                assert.notStrictEqual(unarchivedPath, existingDoc, 'Unarchived path should be different');
            });
        });

        suite('Task Moving', () => {
            test('should move a task file to a feature folder', async () => {
                // Create task in root
                const taskPath = await taskManager.createTask('Task To Move');
                assert.ok(fs.existsSync(taskPath));

                // Create feature folder
                const featurePath = await taskManager.createFeature('Target Feature');
                assert.ok(fs.existsSync(featurePath));

                // Move task into feature
                const newPath = await taskManager.moveTask(taskPath, featurePath);

                assert.ok(!fs.existsSync(taskPath), 'Original file should not exist');
                assert.ok(fs.existsSync(newPath), 'Moved file should exist');
                assert.ok(newPath.includes('Target-Feature'), 'Path should include feature folder');
            });

            test('should move a task file out of feature folder to root', async () => {
                // Create feature folder and task inside it
                const featurePath = await taskManager.createFeature('Source Feature');
                const taskInFeature = path.join(featurePath, 'task-in-feature.md');
                fs.writeFileSync(taskInFeature, '# Task In Feature');

                // Move task to root
                const rootFolder = taskManager.getTasksFolder();
                const newPath = await taskManager.moveTask(taskInFeature, rootFolder);

                assert.ok(!fs.existsSync(taskInFeature), 'Original file should not exist');
                assert.ok(fs.existsSync(newPath), 'Moved file should exist');
                assert.ok(!newPath.includes('Source-Feature'), 'Path should not include feature folder');
            });

            test('should handle collision when moving task', async () => {
                // Create task in root
                const taskPath = await taskManager.createTask('Collision Task');

                // Create feature folder with a task of the same name
                const featurePath = await taskManager.createFeature('Collision Feature');
                const existingTask = path.join(featurePath, 'Collision-Task.md');
                fs.writeFileSync(existingTask, '# Existing Task');

                // Move task into feature - should get renamed
                const newPath = await taskManager.moveTask(taskPath, featurePath);

                assert.ok(!fs.existsSync(taskPath), 'Original file should not exist');
                assert.ok(fs.existsSync(newPath), 'Moved file should exist');
                assert.ok(fs.existsSync(existingTask), 'Existing file should still exist');
                assert.notStrictEqual(newPath, existingTask, 'New path should be different from existing');
            });

            test('should not move if source and target are the same folder', async () => {
                // Create task in root
                const taskPath = await taskManager.createTask('Same Folder Task');
                const rootFolder = taskManager.getTasksFolder();

                // Try to move to the same folder
                const newPath = await taskManager.moveTask(taskPath, rootFolder);

                assert.strictEqual(newPath, taskPath, 'Path should remain unchanged');
                assert.ok(fs.existsSync(taskPath), 'File should still exist at original location');
            });

            test('should move task between different feature folders', async () => {
                // Create two feature folders
                const feature1Path = await taskManager.createFeature('Feature One');
                const feature2Path = await taskManager.createFeature('Feature Two');

                // Create task in feature 1
                const taskInFeature1 = path.join(feature1Path, 'cross-feature-task.md');
                fs.writeFileSync(taskInFeature1, '# Cross Feature Task');

                // Move to feature 2
                const newPath = await taskManager.moveTask(taskInFeature1, feature2Path);

                assert.ok(!fs.existsSync(taskInFeature1), 'Original file should not exist');
                assert.ok(fs.existsSync(newPath), 'Moved file should exist');
                assert.ok(newPath.includes('Feature-Two'), 'Path should include target feature');
            });

            test('should throw error when source file not found', async () => {
                const featurePath = await taskManager.createFeature('Target');
                
                await assert.rejects(
                    async () => await taskManager.moveTask('/non/existent/path.md', featurePath),
                    /not found/i
                );
            });

            test('should move multiple files via moveTaskGroup', async () => {
                // Create document group files in root
                taskManager.ensureFoldersExist();
                const rootFolder = taskManager.getTasksFolder();
                const planFile = path.join(rootFolder, 'grouped-task.plan.md');
                const specFile = path.join(rootFolder, 'grouped-task.spec.md');
                fs.writeFileSync(planFile, '# Plan');
                fs.writeFileSync(specFile, '# Spec');

                // Create feature folder
                const featurePath = await taskManager.createFeature('Group Target');

                // Move all group files
                const newPaths = await taskManager.moveTaskGroup([planFile, specFile], featurePath);

                assert.strictEqual(newPaths.length, 2, 'Should return two paths');
                assert.ok(!fs.existsSync(planFile), 'Original plan file should not exist');
                assert.ok(!fs.existsSync(specFile), 'Original spec file should not exist');
                assert.ok(newPaths.every(p => fs.existsSync(p)), 'All moved files should exist');
                assert.ok(newPaths.every(p => p.includes('Group-Target')), 'All paths should include feature folder');
            });
        });

        suite('File Watching', () => {
            test('should call refresh callback on file changes', async function () {
                // File watching tests are unreliable in test environments due to VSCode's
                // file system watcher implementation. Skip in automated test runs.
                // These tests can be run manually for verification if needed.
                this.skip();
                return;

                /* eslint-disable no-unreachable */
                taskManager.ensureFoldersExist();

                let callCount = 0;
                taskManager.watchTasksFolder(() => {
                    callCount++;
                });

                // Wait for watcher to initialize
                await new Promise(resolve => setTimeout(resolve, 500));

                // Create a file to trigger the watcher
                const tasksFolder = taskManager.getTasksFolder();
                fs.writeFileSync(path.join(tasksFolder, 'trigger.md'), '# Test');

                // Wait for file system event with retry logic (accounting for 300ms debounce + buffer)
                const maxWaitTime = 5000;
                const checkInterval = 150;
                let waited = 0;
                while (callCount === 0 && waited < maxWaitTime) {
                    await new Promise(resolve => setTimeout(resolve, checkInterval));
                    waited += checkInterval;
                }

                assert.ok(callCount > 0, 'Should call refresh callback');
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

        test('should set open command with Review Editor', () => {
            const task: Task = {
                name: 'Task',
                filePath: '/path/to/task.md',
                modifiedTime: new Date(),
                isArchived: false
            };

            const item = new TaskItem(task);

            assert.ok(item.command);
            assert.strictEqual(item.command.command, 'vscode.openWith');
            assert.ok(item.command.arguments);
            assert.strictEqual(item.command.arguments.length, 2);
            assert.strictEqual(item.command.arguments[1], 'reviewEditorView');
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

        // Filter functionality removed - tests disabled
        test.skip('should filter tasks by name', async () => {
            await taskManager.createTask('Apple Task');
            await taskManager.createTask('Banana Task');
            await taskManager.createTask('Cherry Task');

            // treeDataProvider.setFilter('banana');

            const children = await treeDataProvider.getChildren();
            assert.strictEqual(children.length, 1);
            // assert.strictEqual((children[0] as TaskItem).label, 'Banana-Task');
        });

        test.skip('should clear filter', async () => {
            await taskManager.createTask('Task 1');
            await taskManager.createTask('Task 2');

            // treeDataProvider.setFilter('1');
            let children = await treeDataProvider.getChildren();
            assert.strictEqual(children.length, 1);

            // treeDataProvider.clearFilter();
            children = await treeDataProvider.getChildren();
            assert.strictEqual(children.length, 2);
        });

        test.skip('should get current filter', () => {
            // assert.strictEqual(treeDataProvider.getFilter(), '');

            // treeDataProvider.setFilter('test');
            // assert.strictEqual(treeDataProvider.getFilter(), 'test');
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

    suite('TaskGroupItem', () => {
        test('should create active group item with correct properties', () => {
            const groupItem = new TaskGroupItem('active', 5);

            assert.strictEqual(groupItem.label, 'Active Tasks');
            assert.strictEqual(groupItem.groupType, 'active');
            assert.strictEqual(groupItem.taskCount, 5);
            assert.strictEqual(groupItem.description, '5');
            assert.strictEqual(groupItem.contextValue, 'taskGroup_active');
            assert.strictEqual(groupItem.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
        });

        test('should create archived group item with correct properties', () => {
            const groupItem = new TaskGroupItem('archived', 3);

            assert.strictEqual(groupItem.label, 'Archived Tasks');
            assert.strictEqual(groupItem.groupType, 'archived');
            assert.strictEqual(groupItem.taskCount, 3);
            assert.strictEqual(groupItem.description, '3');
            assert.strictEqual(groupItem.contextValue, 'taskGroup_archived');
            // Archived tasks should be collapsed by default
            assert.strictEqual(groupItem.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
        });

        test('should handle zero count', () => {
            const groupItem = new TaskGroupItem('active', 0);

            assert.strictEqual(groupItem.taskCount, 0);
            assert.strictEqual(groupItem.description, '0');
        });
    });

    suite('Grouped Tree View', () => {
        let treeDataProvider: TasksTreeDataProvider;

        setup(() => {
            // Override settings to show archived (grouped view)
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

            treeDataProvider = new TasksTreeDataProvider(taskManager);
        });

        teardown(() => {
            treeDataProvider.dispose();
        });

        test('should return group items when showArchived is enabled', async () => {
            taskManager.ensureFoldersExist();

            const children = await treeDataProvider.getChildren();

            // Should have 2 groups: Active and Archived
            assert.strictEqual(children.length, 2);
            assert.ok(children[0] instanceof TaskGroupItem);
            assert.ok(children[1] instanceof TaskGroupItem);

            const activeGroup = children[0] as TaskGroupItem;
            const archivedGroup = children[1] as TaskGroupItem;

            assert.strictEqual(activeGroup.groupType, 'active');
            assert.strictEqual(archivedGroup.groupType, 'archived');
        });

        test('should show tasks under correct groups', async () => {
            // Create active and archived tasks
            await taskManager.createTask('Active Task');
            const toArchive = await taskManager.createTask('Archived Task');
            await taskManager.archiveTask(toArchive);

            const rootChildren = await treeDataProvider.getChildren();
            assert.strictEqual(rootChildren.length, 2);

            const activeGroup = rootChildren[0] as TaskGroupItem;
            const archivedGroup = rootChildren[1] as TaskGroupItem;

            // Check counts
            assert.strictEqual(activeGroup.taskCount, 1);
            assert.strictEqual(archivedGroup.taskCount, 1);

            // Check children of active group
            const activeChildren = await treeDataProvider.getChildren(activeGroup);
            assert.strictEqual(activeChildren.length, 1);
            assert.ok(activeChildren[0] instanceof TaskItem);
            assert.strictEqual((activeChildren[0] as TaskItem).isArchived, false);

            // Check children of archived group
            const archivedChildren = await treeDataProvider.getChildren(archivedGroup);
            assert.strictEqual(archivedChildren.length, 1);
            assert.ok(archivedChildren[0] instanceof TaskItem);
            assert.strictEqual((archivedChildren[0] as TaskItem).isArchived, true);
        });

        test('should show empty groups when no tasks', async () => {
            taskManager.ensureFoldersExist();

            const children = await treeDataProvider.getChildren();

            const activeGroup = children[0] as TaskGroupItem;
            const archivedGroup = children[1] as TaskGroupItem;

            assert.strictEqual(activeGroup.taskCount, 0);
            assert.strictEqual(archivedGroup.taskCount, 0);

            const activeChildren = await treeDataProvider.getChildren(activeGroup);
            const archivedChildren = await treeDataProvider.getChildren(archivedGroup);

            assert.strictEqual(activeChildren.length, 0);
            assert.strictEqual(archivedChildren.length, 0);
        });

        // Filter functionality removed - test disabled
        test.skip('should apply filter to grouped view', async () => {
            await taskManager.createTask('Apple Task');
            await taskManager.createTask('Banana Task');
            const toArchive = await taskManager.createTask('Apple Archived');
            await taskManager.archiveTask(toArchive);

            // treeDataProvider.setFilter('apple');

            const rootChildren = await treeDataProvider.getChildren();
            const activeGroup = rootChildren[0] as TaskGroupItem;
            const archivedGroup = rootChildren[1] as TaskGroupItem;

            // Should filter both active and archived
            // assert.strictEqual(activeGroup.taskCount, 1);
            // assert.strictEqual(archivedGroup.taskCount, 1);
        });
    });

    suite('TasksDragDropController', () => {
        let dragDropController: TasksDragDropController;
        let refreshCalled: boolean;

        setup(() => {
            refreshCalled = false;
            dragDropController = new TasksDragDropController(taskManager, () => { refreshCalled = true; });
        });

        test('should have correct drag MIME types', () => {
            assert.deepStrictEqual(dragDropController.dragMimeTypes, ['text/uri-list', 'application/vnd.code.tree.tasksView']);
        });

        test('should have correct drop MIME types', () => {
            assert.deepStrictEqual(dragDropController.dropMimeTypes, ['text/uri-list', 'application/vnd.code.tree.tasksView']);
        });

        test('should handle drag with TaskItem', async () => {
            const task: Task = {
                name: 'Test Task',
                filePath: '/path/to/task.md',
                modifiedTime: new Date(),
                isArchived: false
            };
            const taskItem = new TaskItem(task);

            const dataTransfer = new vscode.DataTransfer();
            const token = new vscode.CancellationTokenSource().token;

            await dragDropController.handleDrag([taskItem], dataTransfer, token);

            const uriList = dataTransfer.get('text/uri-list');
            assert.ok(uriList, 'Should have uri-list in data transfer');
            assert.ok(uriList.value.includes('file://'), 'Should contain file URI');
        });

        test('should handle drag with multiple TaskItems', async () => {
            const tasks: Task[] = [
                { name: 'Task 1', filePath: '/path/to/task1.md', modifiedTime: new Date(), isArchived: false },
                { name: 'Task 2', filePath: '/path/to/task2.md', modifiedTime: new Date(), isArchived: false }
            ];
            const taskItems = tasks.map(t => new TaskItem(t));

            const dataTransfer = new vscode.DataTransfer();
            const token = new vscode.CancellationTokenSource().token;

            await dragDropController.handleDrag(taskItems, dataTransfer, token);

            const uriList = dataTransfer.get('text/uri-list');
            assert.ok(uriList, 'Should have uri-list in data transfer');
            // Should have two URIs separated by CRLF
            const uris = uriList.value.split('\r\n');
            assert.strictEqual(uris.length, 2, 'Should have 2 URIs');
        });

        test('should not add to data transfer for non-TaskItem', async () => {
            const groupItem = new TaskGroupItem('active', 5);

            const dataTransfer = new vscode.DataTransfer();
            const token = new vscode.CancellationTokenSource().token;

            await dragDropController.handleDrag([groupItem], dataTransfer, token);

            const uriList = dataTransfer.get('text/uri-list');
            assert.ok(!uriList, 'Should not have uri-list for group items');
        });

        test('should reject drop when target is not TaskGroupItem', async () => {
            const task: Task = {
                name: 'Test Task',
                filePath: '/path/to/task.md',
                modifiedTime: new Date(),
                isArchived: false
            };
            const taskItem = new TaskItem(task);

            const dataTransfer = new vscode.DataTransfer();
            dataTransfer.set('text/uri-list', new vscode.DataTransferItem('file:///path/to/source.md'));
            const token = new vscode.CancellationTokenSource().token;

            // Should silently reject
            await dragDropController.handleDrop(taskItem, dataTransfer, token);
            assert.ok(!refreshCalled, 'Should not refresh when drop is rejected');
        });

        test('should reject drop on archived group', async () => {
            const archivedGroup = new TaskGroupItem('archived', 5);

            const dataTransfer = new vscode.DataTransfer();
            dataTransfer.set('text/uri-list', new vscode.DataTransferItem('file:///path/to/source.md'));
            const token = new vscode.CancellationTokenSource().token;

            await dragDropController.handleDrop(archivedGroup, dataTransfer, token);
            assert.ok(!refreshCalled, 'Should not refresh when drop is rejected on archived group');
        });

        test('should reject drop when no text/uri-list in dataTransfer', async () => {
            const activeGroup = new TaskGroupItem('active', 5);

            const dataTransfer = new vscode.DataTransfer();
            const token = new vscode.CancellationTokenSource().token;

            await dragDropController.handleDrop(activeGroup, dataTransfer, token);
            assert.ok(!refreshCalled, 'Should not refresh when no URIs in data transfer');
        });

        test('should reject drop when no .md files in URIs', async () => {
            const activeGroup = new TaskGroupItem('active', 5);

            const dataTransfer = new vscode.DataTransfer();
            // Non-md files
            dataTransfer.set('text/uri-list', new vscode.DataTransferItem('file:///path/to/source.txt\r\nfile:///path/to/other.js'));
            const token = new vscode.CancellationTokenSource().token;

            // Mock showInformationMessage to capture the message
            const originalShowInfo = vscode.window.showInformationMessage;
            let infoMessage = '';
            (vscode.window as any).showInformationMessage = (message: string) => {
                infoMessage = message;
                return Promise.resolve(undefined);
            };

            await dragDropController.handleDrop(activeGroup, dataTransfer, token);
            
            (vscode.window as any).showInformationMessage = originalShowInfo;
            assert.ok(infoMessage.includes('No markdown files'), 'Should show info about no markdown files');
            assert.ok(!refreshCalled, 'Should not refresh when no md files');
        });
    });

    suite('TasksDragDropController - File Import', () => {
        let dragDropController: TasksDragDropController;
        let refreshCalled: boolean;
        let sourceFile: string;

        setup(() => {
            refreshCalled = false;
            dragDropController = new TasksDragDropController(taskManager, () => { refreshCalled = true; });
            
            // Ensure tasks folder exists
            taskManager.ensureFoldersExist();
            
            // Create a source file to import
            sourceFile = path.join(tempDir, 'source-task.md');
            fs.writeFileSync(sourceFile, '# Source Task\n\nContent here');
        });

        test('should import single .md file on drop to active group', async () => {
            const activeGroup = new TaskGroupItem('active', 0);

            const dataTransfer = new vscode.DataTransfer();
            const uri = vscode.Uri.file(sourceFile);
            dataTransfer.set('text/uri-list', new vscode.DataTransferItem(uri.toString()));
            const token = new vscode.CancellationTokenSource().token;

            // Mock showInformationMessage
            const originalShowInfo = vscode.window.showInformationMessage;
            let infoMessage = '';
            (vscode.window as any).showInformationMessage = (message: string) => {
                infoMessage = message;
                return Promise.resolve(undefined);
            };

            await dragDropController.handleDrop(activeGroup, dataTransfer, token);

            (vscode.window as any).showInformationMessage = originalShowInfo;

            // Check file was imported
            const importedPath = path.join(taskManager.getTasksFolder(), 'source-task.md');
            assert.ok(fs.existsSync(importedPath), 'File should be imported');
            
            // Check content was copied
            const content = fs.readFileSync(importedPath, 'utf-8');
            assert.ok(content.includes('Source Task'), 'Content should be preserved');
            
            // Check refresh was called
            assert.ok(refreshCalled, 'Should call refresh after import');
            
            // Check success message
            assert.ok(infoMessage.includes('imported'), 'Should show success message');
        });

        test('should import multiple .md files', async () => {
            // Create a second source file
            const sourceFile2 = path.join(tempDir, 'source-task2.md');
            fs.writeFileSync(sourceFile2, '# Source Task 2');

            const activeGroup = new TaskGroupItem('active', 0);

            const dataTransfer = new vscode.DataTransfer();
            const uri1 = vscode.Uri.file(sourceFile);
            const uri2 = vscode.Uri.file(sourceFile2);
            dataTransfer.set('text/uri-list', new vscode.DataTransferItem(`${uri1.toString()}\r\n${uri2.toString()}`));
            const token = new vscode.CancellationTokenSource().token;

            // Mock showInformationMessage
            const originalShowInfo = vscode.window.showInformationMessage;
            let infoMessage = '';
            (vscode.window as any).showInformationMessage = (message: string) => {
                infoMessage = message;
                return Promise.resolve(undefined);
            };

            await dragDropController.handleDrop(activeGroup, dataTransfer, token);

            (vscode.window as any).showInformationMessage = originalShowInfo;

            // Check both files were imported
            const importedPath1 = path.join(taskManager.getTasksFolder(), 'source-task.md');
            const importedPath2 = path.join(taskManager.getTasksFolder(), 'source-task2.md');
            assert.ok(fs.existsSync(importedPath1), 'First file should be imported');
            assert.ok(fs.existsSync(importedPath2), 'Second file should be imported');
            
            // Check message mentions count
            assert.ok(infoMessage.includes('2'), 'Should mention 2 tasks');
        });

        test('should preserve original file after import (copy not move)', async () => {
            const activeGroup = new TaskGroupItem('active', 0);

            const dataTransfer = new vscode.DataTransfer();
            const uri = vscode.Uri.file(sourceFile);
            dataTransfer.set('text/uri-list', new vscode.DataTransferItem(uri.toString()));
            const token = new vscode.CancellationTokenSource().token;

            // Mock showInformationMessage
            const originalShowInfo = vscode.window.showInformationMessage;
            (vscode.window as any).showInformationMessage = () => Promise.resolve(undefined);

            await dragDropController.handleDrop(activeGroup, dataTransfer, token);

            (vscode.window as any).showInformationMessage = originalShowInfo;

            // Check original file still exists
            assert.ok(fs.existsSync(sourceFile), 'Original file should still exist');
        });

        test('should filter out non-.md files from mixed drop', async () => {
            const txtFile = path.join(tempDir, 'not-a-task.txt');
            fs.writeFileSync(txtFile, 'Text content');

            const activeGroup = new TaskGroupItem('active', 0);

            const dataTransfer = new vscode.DataTransfer();
            const mdUri = vscode.Uri.file(sourceFile);
            const txtUri = vscode.Uri.file(txtFile);
            dataTransfer.set('text/uri-list', new vscode.DataTransferItem(`${mdUri.toString()}\r\n${txtUri.toString()}`));
            const token = new vscode.CancellationTokenSource().token;

            // Mock showInformationMessage
            const originalShowInfo = vscode.window.showInformationMessage;
            (vscode.window as any).showInformationMessage = () => Promise.resolve(undefined);

            await dragDropController.handleDrop(activeGroup, dataTransfer, token);

            (vscode.window as any).showInformationMessage = originalShowInfo;

            // Check only md file was imported
            const importedMd = path.join(taskManager.getTasksFolder(), 'source-task.md');
            const importedTxt = path.join(taskManager.getTasksFolder(), 'not-a-task.txt');
            assert.ok(fs.existsSync(importedMd), 'MD file should be imported');
            assert.ok(!fs.existsSync(importedTxt), 'TXT file should not be imported');
        });
    });

    suite('TaskManager importTask', () => {
        test('should import task with original name', async () => {
            taskManager.ensureFoldersExist();
            const sourceFile = path.join(tempDir, 'external-task.md');
            fs.writeFileSync(sourceFile, '# External Task Content');

            const importedPath = await taskManager.importTask(sourceFile);

            const expectedPath = path.join(taskManager.getTasksFolder(), 'external-task.md');
            assert.strictEqual(importedPath, expectedPath, 'Should return correct path');
            assert.ok(fs.existsSync(importedPath), 'File should exist');
            
            const content = fs.readFileSync(importedPath, 'utf-8');
            assert.strictEqual(content, '# External Task Content', 'Content should match');
        });

        test('should import task with new name', async () => {
            taskManager.ensureFoldersExist();
            const sourceFile = path.join(tempDir, 'external-task.md');
            fs.writeFileSync(sourceFile, '# External Task Content');

            const importedPath = await taskManager.importTask(sourceFile, 'renamed-task');

            const expectedPath = path.join(taskManager.getTasksFolder(), 'renamed-task.md');
            assert.strictEqual(importedPath, expectedPath, 'Should use new name');
            assert.ok(fs.existsSync(importedPath), 'File should exist');
        });

        test('should throw error on name collision', async () => {
            taskManager.ensureFoldersExist();
            
            // Create existing task
            await taskManager.createTask('existing-task');

            // Try to import with same name
            const sourceFile = path.join(tempDir, 'existing-task.md');
            fs.writeFileSync(sourceFile, '# New content');

            await assert.rejects(
                () => taskManager.importTask(sourceFile),
                /already exists/,
                'Should throw on collision'
            );
        });

        test('should sanitize file name', async () => {
            taskManager.ensureFoldersExist();
            const sourceFile = path.join(tempDir, 'source.md');
            fs.writeFileSync(sourceFile, '# Content');

            const importedPath = await taskManager.importTask(sourceFile, 'task with spaces/invalid:chars');

            // Should sanitize the name - check filename only (not full path which contains path separators)
            const fileName = path.basename(importedPath);
            assert.ok(!fileName.includes(' '), 'Filename should not have spaces');
            assert.ok(!fileName.includes('/'), 'Filename should not have slashes');
            assert.ok(!fileName.includes(':'), 'Filename should not have colons');
            assert.ok(fs.existsSync(importedPath), 'File should exist');
        });
    });

    suite('TaskManager taskExists', () => {
        test('should return true for existing task', async () => {
            taskManager.ensureFoldersExist();
            await taskManager.createTask('my-task');

            assert.ok(taskManager.taskExists('my-task'), 'Should find existing task');
        });

        test('should return false for non-existing task', () => {
            taskManager.ensureFoldersExist();

            assert.ok(!taskManager.taskExists('non-existent'), 'Should not find non-existing task');
        });

        test('should handle names that need sanitization', async () => {
            taskManager.ensureFoldersExist();
            await taskManager.createTask('my task');

            // The name gets sanitized to 'my-task'
            assert.ok(taskManager.taskExists('my task'), 'Should handle sanitization');
        });
    });

    suite('TaskItem resourceUri', () => {
        test('should have resourceUri set for drag-and-drop', () => {
            const task: Task = {
                name: 'Test Task',
                filePath: '/path/to/task.md',
                modifiedTime: new Date(),
                isArchived: false
            };

            const item = new TaskItem(task);

            assert.ok(item.resourceUri, 'Should have resourceUri');
            // Use Uri.path for cross-platform comparison (always uses forward slashes)
            assert.strictEqual(item.resourceUri.path, '/path/to/task.md');
        });
    });

    suite('TaskManager parseFileName', () => {
        test('should parse simple filename without doc type', () => {
            const result = taskManager.parseFileName('task1.md');
            assert.strictEqual(result.baseName, 'task1');
            assert.strictEqual(result.docType, undefined);
        });

        test('should parse filename with plan doc type', () => {
            const result = taskManager.parseFileName('task1.plan.md');
            assert.strictEqual(result.baseName, 'task1');
            assert.strictEqual(result.docType, 'plan');
        });

        test('should parse filename with spec doc type', () => {
            const result = taskManager.parseFileName('task1.spec.md');
            assert.strictEqual(result.baseName, 'task1');
            assert.strictEqual(result.docType, 'spec');
        });

        test('should parse filename with test doc type', () => {
            const result = taskManager.parseFileName('task1.test.md');
            assert.strictEqual(result.baseName, 'task1');
            assert.strictEqual(result.docType, 'test');
        });

        test('should parse filename with notes doc type', () => {
            const result = taskManager.parseFileName('my-feature.notes.md');
            assert.strictEqual(result.baseName, 'my-feature');
            assert.strictEqual(result.docType, 'notes');
        });

        test('should parse filename with version doc type (v1)', () => {
            const result = taskManager.parseFileName('design.v1.md');
            assert.strictEqual(result.baseName, 'design');
            assert.strictEqual(result.docType, 'v1');
        });

        test('should parse filename with version doc type (v10)', () => {
            const result = taskManager.parseFileName('design.v10.md');
            assert.strictEqual(result.baseName, 'design');
            assert.strictEqual(result.docType, 'v10');
        });

        test('should not treat arbitrary suffix as doc type', () => {
            const result = taskManager.parseFileName('task1.feature.md');
            assert.strictEqual(result.baseName, 'task1.feature');
            assert.strictEqual(result.docType, undefined);
        });

        test('should handle multi-part base name with doc type', () => {
            const result = taskManager.parseFileName('task1.feature.plan.md');
            assert.strictEqual(result.baseName, 'task1.feature');
            assert.strictEqual(result.docType, 'plan');
        });

        test('should handle case-insensitive .md extension', () => {
            const result = taskManager.parseFileName('task1.plan.MD');
            assert.strictEqual(result.baseName, 'task1');
            assert.strictEqual(result.docType, 'plan');
        });

        test('should preserve doc type case in result', () => {
            const result = taskManager.parseFileName('task1.PLAN.md');
            assert.strictEqual(result.baseName, 'task1');
            assert.strictEqual(result.docType, 'PLAN');
        });
    });

    suite('TaskManager getTaskDocuments', () => {
        test('should return empty array when no documents exist', async () => {
            taskManager.ensureFoldersExist();
            const documents = await taskManager.getTaskDocuments();
            assert.strictEqual(documents.length, 0);
        });

        test('should return documents with parsed baseName and docType', async () => {
            taskManager.ensureFoldersExist();
            const tasksFolder = taskManager.getTasksFolder();

            // Create test files
            fs.writeFileSync(path.join(tasksFolder, 'task1.md'), '# Task 1');
            fs.writeFileSync(path.join(tasksFolder, 'task1.plan.md'), '# Task 1 Plan');
            fs.writeFileSync(path.join(tasksFolder, 'task1.test.md'), '# Task 1 Test');

            const documents = await taskManager.getTaskDocuments();
            assert.strictEqual(documents.length, 3);

            const task1 = documents.find(d => d.fileName === 'task1.md');
            assert.ok(task1);
            assert.strictEqual(task1.baseName, 'task1');
            assert.strictEqual(task1.docType, undefined);

            const task1Plan = documents.find(d => d.fileName === 'task1.plan.md');
            assert.ok(task1Plan);
            assert.strictEqual(task1Plan.baseName, 'task1');
            assert.strictEqual(task1Plan.docType, 'plan');

            const task1Test = documents.find(d => d.fileName === 'task1.test.md');
            assert.ok(task1Test);
            assert.strictEqual(task1Test.baseName, 'task1');
            assert.strictEqual(task1Test.docType, 'test');
        });

        test('should set isArchived correctly', async () => {
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
                                sortBy: 'modifiedDate',
                                groupRelatedDocuments: true
                            };
                            return (defaults[key] !== undefined ? defaults[key] : defaultValue) as T;
                        }
                    };
                }
                return originalGetConfiguration(section);
            };

            taskManager.ensureFoldersExist();
            const tasksFolder = taskManager.getTasksFolder();
            const archiveFolder = taskManager.getArchiveFolder();

            fs.writeFileSync(path.join(tasksFolder, 'active.md'), '# Active');
            fs.writeFileSync(path.join(archiveFolder, 'archived.md'), '# Archived');

            const documents = await taskManager.getTaskDocuments();
            assert.strictEqual(documents.length, 2);

            const active = documents.find(d => d.fileName === 'active.md');
            assert.ok(active);
            assert.strictEqual(active.isArchived, false);

            const archived = documents.find(d => d.fileName === 'archived.md');
            assert.ok(archived);
            assert.strictEqual(archived.isArchived, true);
        });
    });

    suite('TaskManager getTaskDocumentGroups', () => {
        test('should group documents with same base name', async () => {
            taskManager.ensureFoldersExist();
            const tasksFolder = taskManager.getTasksFolder();

            // Create test files
            fs.writeFileSync(path.join(tasksFolder, 'task1.md'), '# Task 1');
            fs.writeFileSync(path.join(tasksFolder, 'task1.plan.md'), '# Task 1 Plan');
            fs.writeFileSync(path.join(tasksFolder, 'task1.test.md'), '# Task 1 Test');
            fs.writeFileSync(path.join(tasksFolder, 'task2.md'), '# Task 2');

            const { groups, singles } = await taskManager.getTaskDocumentGroups();

            // task1 should be grouped (3 docs)
            assert.strictEqual(groups.length, 1);
            assert.strictEqual(groups[0].baseName, 'task1');
            assert.strictEqual(groups[0].documents.length, 3);

            // task2 should be a single (1 doc)
            assert.strictEqual(singles.length, 1);
            assert.strictEqual(singles[0].baseName, 'task2');
        });

        test('should separate groups by archive status', async () => {
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
                                sortBy: 'modifiedDate',
                                groupRelatedDocuments: true
                            };
                            return (defaults[key] !== undefined ? defaults[key] : defaultValue) as T;
                        }
                    };
                }
                return originalGetConfiguration(section);
            };

            taskManager.ensureFoldersExist();
            const tasksFolder = taskManager.getTasksFolder();
            const archiveFolder = taskManager.getArchiveFolder();

            // Create active documents
            fs.writeFileSync(path.join(tasksFolder, 'task1.md'), '# Task 1');
            fs.writeFileSync(path.join(tasksFolder, 'task1.plan.md'), '# Task 1 Plan');

            // Create archived documents with same base name
            fs.writeFileSync(path.join(archiveFolder, 'task1.md'), '# Task 1 Archived');
            fs.writeFileSync(path.join(archiveFolder, 'task1.notes.md'), '# Task 1 Notes Archived');

            const { groups, singles } = await taskManager.getTaskDocumentGroups();

            // Should have 2 groups: one active, one archived
            assert.strictEqual(groups.length, 2);
            
            const activeGroup = groups.find(g => !g.isArchived);
            assert.ok(activeGroup);
            assert.strictEqual(activeGroup.baseName, 'task1');
            assert.strictEqual(activeGroup.documents.length, 2);
            assert.ok(activeGroup.documents.every(d => !d.isArchived));

            const archivedGroup = groups.find(g => g.isArchived);
            assert.ok(archivedGroup);
            assert.strictEqual(archivedGroup.baseName, 'task1');
            assert.strictEqual(archivedGroup.documents.length, 2);
            assert.ok(archivedGroup.documents.every(d => d.isArchived));

            // No singles
            assert.strictEqual(singles.length, 0);
        });

        test('should calculate latestModifiedTime correctly', async () => {
            taskManager.ensureFoldersExist();
            const tasksFolder = taskManager.getTasksFolder();

            // Create files with different timestamps
            fs.writeFileSync(path.join(tasksFolder, 'task1.md'), '# Task 1');
            
            // Wait a bit and create another file
            await new Promise(resolve => setTimeout(resolve, 50));
            fs.writeFileSync(path.join(tasksFolder, 'task1.plan.md'), '# Task 1 Plan');

            const { groups } = await taskManager.getTaskDocumentGroups();

            assert.strictEqual(groups.length, 1);
            
            // The latest modified time should be from task1.plan.md
            const planDoc = groups[0].documents.find(d => d.docType === 'plan');
            assert.ok(planDoc);
            assert.strictEqual(
                groups[0].latestModifiedTime.getTime(),
                planDoc.modifiedTime.getTime()
            );
        });
    });

    suite('TaskDocumentGroupItem', () => {
        test('should create active document group item', () => {
            const documents: TaskDocument[] = [
                { baseName: 'task1', docType: undefined, fileName: 'task1.md', filePath: '/path/task1.md', modifiedTime: new Date(), isArchived: false },
                { baseName: 'task1', docType: 'plan', fileName: 'task1.plan.md', filePath: '/path/task1.plan.md', modifiedTime: new Date(), isArchived: false },
            ];

            const item = new TaskDocumentGroupItem('task1', documents, false);

            assert.strictEqual(item.label, 'task1');
            assert.strictEqual(item.baseName, 'task1');
            assert.strictEqual(item.documents.length, 2);
            assert.strictEqual(item.isArchived, false);
            assert.strictEqual(item.contextValue, 'taskDocumentGroup');
            assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
        });

        test('should create archived document group item', () => {
            const documents: TaskDocument[] = [
                { baseName: 'task1', docType: 'spec', fileName: 'task1.spec.md', filePath: '/path/task1.spec.md', modifiedTime: new Date(), isArchived: true },
            ];

            const item = new TaskDocumentGroupItem('task1', documents, true);

            assert.strictEqual(item.isArchived, true);
            assert.strictEqual(item.contextValue, 'archivedTaskDocumentGroup');
        });

        test('should have description with doc count and types', () => {
            const documents: TaskDocument[] = [
                { baseName: 'task1', docType: undefined, fileName: 'task1.md', filePath: '/path/task1.md', modifiedTime: new Date(), isArchived: false },
                { baseName: 'task1', docType: 'plan', fileName: 'task1.plan.md', filePath: '/path/task1.plan.md', modifiedTime: new Date(), isArchived: false },
                { baseName: 'task1', docType: 'test', fileName: 'task1.test.md', filePath: '/path/task1.test.md', modifiedTime: new Date(), isArchived: false },
            ];

            const item = new TaskDocumentGroupItem('task1', documents, false);

            const description = item.description as string;
            assert.ok(description.includes('3 docs'));
            assert.ok(description.includes('md'));
            assert.ok(description.includes('plan'));
            assert.ok(description.includes('test'));
        });

        test('should set folder path from first document', () => {
            const documents: TaskDocument[] = [
                { baseName: 'task1', docType: 'plan', fileName: 'task1.plan.md', filePath: '/path/to/tasks/task1.plan.md', modifiedTime: new Date(), isArchived: false },
            ];

            const item = new TaskDocumentGroupItem('task1', documents, false);

            // Use path.dirname for cross-platform check
            assert.strictEqual(item.folderPath, path.dirname('/path/to/tasks/task1.plan.md'));
        });
    });

    suite('TaskDocumentItem', () => {
        test('should create document item with docType as label', () => {
            const doc: TaskDocument = {
                baseName: 'task1',
                docType: 'plan',
                fileName: 'task1.plan.md',
                filePath: '/path/task1.plan.md',
                modifiedTime: new Date(),
                isArchived: false
            };

            const item = new TaskDocumentItem(doc);

            assert.strictEqual(item.label, 'plan');
            assert.strictEqual(item.docType, 'plan');
            assert.strictEqual(item.baseName, 'task1');
            assert.strictEqual(item.filePath, '/path/task1.plan.md');
            assert.strictEqual(item.contextValue, 'taskDocument');
        });

        test('should use baseName as label when no docType', () => {
            const doc: TaskDocument = {
                baseName: 'task1',
                docType: undefined,
                fileName: 'task1.md',
                filePath: '/path/task1.md',
                modifiedTime: new Date(),
                isArchived: false
            };

            const item = new TaskDocumentItem(doc);

            assert.strictEqual(item.label, 'task1');
        });

        test('should set archived context value', () => {
            const doc: TaskDocument = {
                baseName: 'task1',
                docType: 'notes',
                fileName: 'task1.notes.md',
                filePath: '/path/task1.notes.md',
                modifiedTime: new Date(),
                isArchived: true
            };

            const item = new TaskDocumentItem(doc);

            assert.strictEqual(item.isArchived, true);
            assert.strictEqual(item.contextValue, 'archivedTaskDocument');
        });

        test('should have resourceUri for drag-and-drop', () => {
            const doc: TaskDocument = {
                baseName: 'task1',
                docType: 'spec',
                fileName: 'task1.spec.md',
                filePath: '/path/task1.spec.md',
                modifiedTime: new Date(),
                isArchived: false
            };

            const item = new TaskDocumentItem(doc);

            assert.ok(item.resourceUri);
            assert.strictEqual(item.resourceUri.path, '/path/task1.spec.md');
        });

        test('should have open command', () => {
            const doc: TaskDocument = {
                baseName: 'task1',
                docType: 'plan',
                fileName: 'task1.plan.md',
                filePath: '/path/task1.plan.md',
                modifiedTime: new Date(),
                isArchived: false
            };

            const item = new TaskDocumentItem(doc);

            assert.ok(item.command);
            assert.strictEqual(item.command.command, 'vscode.openWith');
            assert.ok(item.command.arguments);
            assert.strictEqual(item.command.arguments[1], 'reviewEditorView');
        });
    });

    suite('Drag and Drop with Document Groups', () => {
        let dragDropController: TasksDragDropController;
        let refreshCalled: boolean;

        setup(() => {
            refreshCalled = false;
            dragDropController = new TasksDragDropController(taskManager, () => { refreshCalled = true; });
        });

        test('should handle drag with TaskDocumentItem', async () => {
            const doc: TaskDocument = {
                baseName: 'task1',
                docType: 'plan',
                fileName: 'task1.plan.md',
                filePath: '/path/task1.plan.md',
                modifiedTime: new Date(),
                isArchived: false
            };
            const docItem = new TaskDocumentItem(doc);

            const dataTransfer = new vscode.DataTransfer();
            const token = new vscode.CancellationTokenSource().token;

            await dragDropController.handleDrag([docItem], dataTransfer, token);

            const uriList = dataTransfer.get('text/uri-list');
            assert.ok(uriList, 'Should have uri-list in data transfer');
            assert.ok(uriList.value.includes('file://'), 'Should contain file URI');
        });

        test('should handle drag with TaskDocumentGroupItem (all docs)', async () => {
            const documents: TaskDocument[] = [
                { baseName: 'task1', docType: undefined, fileName: 'task1.md', filePath: '/path/task1.md', modifiedTime: new Date(), isArchived: false },
                { baseName: 'task1', docType: 'plan', fileName: 'task1.plan.md', filePath: '/path/task1.plan.md', modifiedTime: new Date(), isArchived: false },
            ];
            const groupItem = new TaskDocumentGroupItem('task1', documents, false);

            const dataTransfer = new vscode.DataTransfer();
            const token = new vscode.CancellationTokenSource().token;

            await dragDropController.handleDrag([groupItem], dataTransfer, token);

            const uriList = dataTransfer.get('text/uri-list');
            assert.ok(uriList, 'Should have uri-list in data transfer');
            
            // Should have 2 URIs (one for each document)
            const uris = uriList.value.split('\r\n');
            assert.strictEqual(uris.length, 2, 'Should have 2 URIs');
        });
    });

    suite('TreeDataProvider with Document Grouping', () => {
        let treeDataProvider: TasksTreeDataProvider;

        setup(() => {
            // Override settings to enable document grouping
            const originalGetConfiguration = vscode.workspace.getConfiguration;
            (vscode.workspace as any).getConfiguration = (section?: string) => {
                if (section === 'workspaceShortcuts.tasksViewer') {
                    return {
                        get: <T>(key: string, defaultValue?: T): T => {
                            const defaults: Record<string, any> = {
                                enabled: true,
                                folderPath: '.vscode/tasks',
                                showArchived: false,
                                sortBy: 'modifiedDate',
                                groupRelatedDocuments: true
                            };
                            return (defaults[key] !== undefined ? defaults[key] : defaultValue) as T;
                        }
                    };
                }
                return originalGetConfiguration(section);
            };

            treeDataProvider = new TasksTreeDataProvider(taskManager);
        });

        teardown(() => {
            treeDataProvider.dispose();
        });

        test('should return document group items for related docs', async () => {
            taskManager.ensureFoldersExist();
            const tasksFolder = taskManager.getTasksFolder();

            // Create related documents
            fs.writeFileSync(path.join(tasksFolder, 'task1.md'), '# Task 1');
            fs.writeFileSync(path.join(tasksFolder, 'task1.plan.md'), '# Task 1 Plan');
            fs.writeFileSync(path.join(tasksFolder, 'task1.test.md'), '# Task 1 Test');

            const children = await treeDataProvider.getChildren();

            // Should have 1 group for task1
            assert.strictEqual(children.length, 1);
            assert.ok(children[0] instanceof TaskDocumentGroupItem);

            const groupItem = children[0] as TaskDocumentGroupItem;
            assert.strictEqual(groupItem.baseName, 'task1');
            assert.strictEqual(groupItem.documents.length, 3);
        });

        test('should return TaskItem for single docs', async () => {
            taskManager.ensureFoldersExist();
            const tasksFolder = taskManager.getTasksFolder();

            // Create a single document (no related docs)
            fs.writeFileSync(path.join(tasksFolder, 'standalone.md'), '# Standalone');

            const children = await treeDataProvider.getChildren();

            assert.strictEqual(children.length, 1);
            assert.ok(children[0] instanceof TaskItem);
            assert.strictEqual((children[0] as TaskItem).label, 'standalone');
        });

        test('should return document items as children of group', async () => {
            taskManager.ensureFoldersExist();
            const tasksFolder = taskManager.getTasksFolder();

            fs.writeFileSync(path.join(tasksFolder, 'task1.md'), '# Task 1');
            fs.writeFileSync(path.join(tasksFolder, 'task1.plan.md'), '# Task 1 Plan');

            const rootChildren = await treeDataProvider.getChildren();
            assert.strictEqual(rootChildren.length, 1);
            assert.ok(rootChildren[0] instanceof TaskDocumentGroupItem);

            // Get children of the group
            const groupChildren = await treeDataProvider.getChildren(rootChildren[0]);
            assert.strictEqual(groupChildren.length, 2);
            assert.ok(groupChildren.every(c => c instanceof TaskDocumentItem));
        });

        // Filter functionality removed - test disabled
        test.skip('should filter document groups by name', async () => {
            taskManager.ensureFoldersExist();
            const tasksFolder = taskManager.getTasksFolder();

            fs.writeFileSync(path.join(tasksFolder, 'apple.md'), '# Apple');
            fs.writeFileSync(path.join(tasksFolder, 'apple.plan.md'), '# Apple Plan');
            fs.writeFileSync(path.join(tasksFolder, 'banana.md'), '# Banana');
            fs.writeFileSync(path.join(tasksFolder, 'banana.plan.md'), '# Banana Plan');

            // treeDataProvider.setFilter('apple');

            const children = await treeDataProvider.getChildren();
            // assert.strictEqual(children.length, 1);
            // assert.ok(children[0] instanceof TaskDocumentGroupItem);
            // assert.strictEqual((children[0] as TaskDocumentGroupItem).baseName, 'apple');
        });

        test('should mix groups and singles', async () => {
            taskManager.ensureFoldersExist();
            const tasksFolder = taskManager.getTasksFolder();

            // Create a group
            fs.writeFileSync(path.join(tasksFolder, 'task1.md'), '# Task 1');
            fs.writeFileSync(path.join(tasksFolder, 'task1.plan.md'), '# Task 1 Plan');

            // Create a single
            fs.writeFileSync(path.join(tasksFolder, 'standalone.md'), '# Standalone');

            const children = await treeDataProvider.getChildren();
            assert.strictEqual(children.length, 2);

            const hasGroup = children.some(c => c instanceof TaskDocumentGroupItem);
            const hasSingle = children.some(c => c instanceof TaskItem);

            assert.ok(hasGroup, 'Should have document group');
            assert.ok(hasSingle, 'Should have single task item');
        });
    });
});
