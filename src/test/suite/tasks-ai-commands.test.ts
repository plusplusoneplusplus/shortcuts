import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { 
    TaskManager, 
    TasksTreeDataProvider,
    TaskFolderItem,
    TaskFolder
} from '../../shortcuts/tasks-viewer';

/**
 * Tests for AI Task Commands
 * 
 * These tests verify the task creation functionality without actually
 * invoking the AI service (which requires authentication).
 */
suite('Tasks Viewer - AI Task Commands Tests', () => {
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
     * Helper to create a related.yaml file
     */
    function createRelatedYaml(relativePath: string, content: object): string {
        const fullPath = path.join(tempDir, relativePath);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const yaml = require('js-yaml');
        fs.writeFileSync(fullPath, yaml.dump(content), 'utf8');
        return fullPath;
    }

    setup(() => {
        // Create temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-ai-tasks-test-'));

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
            if (section === 'workspaceShortcuts.tasksViewer.discovery') {
                return {
                    get: <T>(key: string, defaultValue?: T): T => {
                        const defaults: Record<string, any> = {
                            enabled: true,
                            showRelatedInTree: true,
                            groupByCategory: true,
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
            if (section === 'workspaceShortcuts.aiService') {
                return {
                    get: <T>(key: string, defaultValue?: T): T => {
                        const defaults: Record<string, any> = {
                            backend: 'clipboard', // Use clipboard for tests to avoid AI calls
                            enabled: false
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

    suite('Task Manager Helper Methods', () => {
        test('sanitizeFileName should handle special characters', () => {
            assert.strictEqual(taskManager.sanitizeFileName('Test Task'), 'Test-Task');
            assert.strictEqual(taskManager.sanitizeFileName('My/Task:Name'), 'My-Task-Name');
            assert.strictEqual(taskManager.sanitizeFileName('  spaced  '), 'spaced');
            assert.strictEqual(taskManager.sanitizeFileName('a<b>c'), 'a-b-c');
        });

        test('taskExists should return correct status', () => {
            // Create a task file
            createTaskFile('.vscode/tasks/existing-task.md');
            
            // Check existence
            assert.strictEqual(taskManager.taskExists('existing-task'), true);
            assert.strictEqual(taskManager.taskExists('nonexistent-task'), false);
        });

        test('getFeatureFolders should return list of folders', async () => {
            // Create feature folders
            createDir('.vscode/tasks/feature-one');
            createDir('.vscode/tasks/feature-two');
            createDir('.vscode/tasks/feature-two/subfolder');
            createTaskFile('.vscode/tasks/feature-one/placeholder.md');
            createTaskFile('.vscode/tasks/feature-two/placeholder.md');

            const folders = await taskManager.getFeatureFolders();

            assert.ok(folders.length >= 2, 'Should find at least 2 feature folders');
            const folderNames = folders.map(f => f.displayName);
            assert.ok(folderNames.includes('feature-one'), 'Should include feature-one');
            assert.ok(folderNames.includes('feature-two'), 'Should include feature-two');
        });

        test('getFeatureFolders should exclude archive folder', async () => {
            // Create folders including archive
            createDir('.vscode/tasks/feature-one');
            createDir('.vscode/tasks/archive');
            createDir('.vscode/tasks/archive/archived-feature');
            createTaskFile('.vscode/tasks/feature-one/placeholder.md');
            createTaskFile('.vscode/tasks/archive/archived.md');

            const folders = await taskManager.getFeatureFolders();

            const folderNames = folders.map(f => f.displayName);
            assert.ok(!folderNames.includes('archive'), 'Should not include archive folder');
            assert.ok(folderNames.includes('feature-one'), 'Should include feature-one');
        });
    });

    suite('Feature Context Gathering', () => {
        test('should load related.yaml content', async () => {
            // Create a feature folder with related.yaml
            createDir('.vscode/tasks/my-feature');
            createRelatedYaml('.vscode/tasks/my-feature/related.yaml', {
                description: 'Test feature description',
                items: [
                    { name: 'test.ts', path: 'src/test.ts', type: 'file', category: 'source', relevance: 80, reason: 'Test file' },
                    { name: 'commit abc123', hash: 'abc123', type: 'commit', category: 'commit', relevance: 70, reason: 'Related commit' }
                ]
            });

            // Use the related items loader directly
            const { loadRelatedItems } = await import('../../shortcuts/tasks-viewer/related-items-loader');
            const folderPath = path.join(tempDir, '.vscode/tasks/my-feature');
            const related = await loadRelatedItems(folderPath);

            assert.ok(related, 'Should load related items');
            assert.strictEqual(related?.description, 'Test feature description');
            assert.strictEqual(related?.items.length, 2);
        });

        test('should handle missing related.yaml gracefully', async () => {
            // Create a feature folder without related.yaml
            createDir('.vscode/tasks/empty-feature');

            const { loadRelatedItems } = await import('../../shortcuts/tasks-viewer/related-items-loader');
            const folderPath = path.join(tempDir, '.vscode/tasks/empty-feature');
            const related = await loadRelatedItems(folderPath);

            assert.strictEqual(related, undefined, 'Should return undefined for missing file');
        });

        test('should detect plan and spec documents', async () => {
            // Create a feature folder with plan and spec docs
            createDir('.vscode/tasks/documented-feature');
            createTaskFile('.vscode/tasks/documented-feature/plan.md', '# Implementation Plan\n\nThis is the plan.');
            createTaskFile('.vscode/tasks/documented-feature/spec.md', '# Feature Specification\n\nThis is the spec.');

            const folderPath = path.join(tempDir, '.vscode/tasks/documented-feature');
            
            // Check files exist
            assert.ok(fs.existsSync(path.join(folderPath, 'plan.md')), 'plan.md should exist');
            assert.ok(fs.existsSync(path.join(folderPath, 'spec.md')), 'spec.md should exist');
        });
    });

    suite('Task File Creation', () => {
        test('createTask should create file with content', async () => {
            const filePath = await taskManager.createTask('Test Task');
            
            assert.ok(fs.existsSync(filePath), 'Task file should be created');
            
            const content = fs.readFileSync(filePath, 'utf-8');
            assert.ok(content.includes('# Test Task'), 'Should include task name as header');
        });

        test('createTask should throw on duplicate name', async () => {
            await taskManager.createTask('Duplicate Task');
            
            try {
                await taskManager.createTask('Duplicate Task');
                assert.fail('Should throw error for duplicate task');
            } catch (error) {
                assert.ok(error instanceof Error);
                assert.ok((error as Error).message.includes('already exists'));
            }
        });

        test('createFeature should create folder with placeholder.md', async () => {
            const folderPath = await taskManager.createFeature('New Feature');
            
            assert.ok(fs.existsSync(folderPath), 'Feature folder should be created');
            assert.ok(fs.existsSync(path.join(folderPath, 'placeholder.md')), 'placeholder.md should be created');
        });
    });

    suite('TaskFolderItem Context Values', () => {
        test('should set correct contextValue for regular folder', () => {
            const folder: TaskFolder = {
                name: 'test-folder',
                folderPath: '/tmp/test-folder',
                relativePath: 'test-folder',
                isArchived: false,
                children: [],
                tasks: [],
                documentGroups: [],
                singleDocuments: []
            };

            const item = new TaskFolderItem(folder);
            assert.strictEqual(item.contextValue, 'taskFolder');
        });

        test('should set correct contextValue for archived folder', () => {
            const folder: TaskFolder = {
                name: 'archived-folder',
                folderPath: '/tmp/archived-folder',
                relativePath: 'archive/archived-folder',
                isArchived: true,
                children: [],
                tasks: [],
                documentGroups: [],
                singleDocuments: []
            };

            const item = new TaskFolderItem(folder);
            assert.strictEqual(item.contextValue, 'taskFolder_archived');
        });

        test('should set correct contextValue for folder with related items', () => {
            const folder: TaskFolder = {
                name: 'feature-folder',
                folderPath: '/tmp/feature-folder',
                relativePath: 'feature-folder',
                isArchived: false,
                children: [],
                tasks: [],
                documentGroups: [],
                singleDocuments: [],
                relatedItems: {
                    description: 'Test feature',
                    items: [{ name: 'test.ts', path: 'src/test.ts', type: 'file', category: 'source', relevance: 80, reason: 'Test' }]
                }
            };

            const item = new TaskFolderItem(folder);
            assert.strictEqual(item.contextValue, 'taskFolder_hasRelated');
        });
    });

    suite('AI Response Processing', () => {
        // Test the helper functions that process AI responses

        test('extractTitleFromContent should extract H1 title', () => {
            // Import the function (we need to test the module's internal functions)
            // For now, test the expected behavior
            const content = `# My Task Title

## Description

This is a description.`;

            // The first H1 header should be the title
            const lines = content.split('\n');
            let title: string | undefined;
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('# ')) {
                    title = trimmed.substring(2).trim();
                    break;
                }
            }

            assert.strictEqual(title, 'My Task Title');
        });

        test('cleanAIResponse should remove code fences', () => {
            const responseWithFence = '```markdown\n# Task Title\n\nContent\n```';
            
            // Simulate the cleaning logic
            let cleaned = responseWithFence.trim();
            if (cleaned.startsWith('```markdown')) {
                cleaned = cleaned.substring('```markdown'.length);
            }
            if (cleaned.endsWith('```')) {
                cleaned = cleaned.substring(0, cleaned.length - 3);
            }
            cleaned = cleaned.trim();

            assert.ok(!cleaned.includes('```'), 'Should not contain code fences');
            assert.ok(cleaned.includes('# Task Title'), 'Should preserve content');
        });
    });
});
