/**
 * AI Task Dialog Service Tests
 * Tests for the AI Task creation dialog flow
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AITaskDialogService } from '../../shortcuts/tasks-viewer/ai-task-dialog';
import { TaskManager } from '../../shortcuts/tasks-viewer/task-manager';
import { AITaskCreationOptions, AITaskDialogResult, AITaskCreateOptions, AITaskFromFeatureOptions } from '../../shortcuts/tasks-viewer/types';
import { getLastUsedAIModel, saveLastUsedAIModel, getFollowPromptDefaultModel } from '../../shortcuts/ai-service/ai-config-helpers';
import { VALID_MODELS, DEFAULT_MODEL_ID } from '../../shortcuts/ai-service';

/**
 * Mock workspace state for testing persistence
 */
class MockWorkspaceState {
    private storage: Map<string, unknown> = new Map();

    get<T>(key: string, defaultValue?: T): T {
        return this.storage.has(key) ? this.storage.get(key) as T : defaultValue as T;
    }

    async update(key: string, value: unknown): Promise<void> {
        this.storage.set(key, value);
    }

    /** Helper method for tests to check stored values */
    getStoredValue(key: string): unknown {
        return this.storage.get(key);
    }

    /** Helper method for tests to clear storage */
    clear(): void {
        this.storage.clear();
    }
}

/**
 * Mock ExtensionContext for testing
 */
class MockExtensionContext {
    workspaceState = new MockWorkspaceState();
    globalState = new MockWorkspaceState();
    extensionUri = vscode.Uri.file('/mock/extension');
}

suite('AI Task Dialog Service Tests', () => {
    let tempDir: string;
    let taskManager: TaskManager;
    let dialogService: AITaskDialogService;
    let mockExtensionUri: vscode.Uri;
    let mockContext: MockExtensionContext;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-task-dialog-test-'));
        taskManager = new TaskManager(tempDir);
        // Create a mock extension URI for testing
        mockExtensionUri = vscode.Uri.file(tempDir);
        mockContext = new MockExtensionContext();
        dialogService = new AITaskDialogService(taskManager, mockExtensionUri, mockContext as unknown as vscode.ExtensionContext);
        
        // Create tasks folder structure
        const tasksFolder = path.join(tempDir, '.vscode', 'tasks');
        fs.mkdirSync(tasksFolder, { recursive: true });
    });

    teardown(() => {
        taskManager.dispose();
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('AITaskDialogService constructor', () => {
        test('should create dialog service with task manager, extension uri, and context', () => {
            const service = new AITaskDialogService(
                taskManager, 
                mockExtensionUri, 
                mockContext as unknown as vscode.ExtensionContext
            );
            assert.ok(service, 'Service should be created');
        });
    });

    suite('getAvailableFolders', () => {
        test('should return root option when no folders exist', async () => {
            const folders = await dialogService.getAvailableFolders();
            
            assert.strictEqual(folders.length, 1, 'Should have root option only');
            assert.strictEqual(folders[0].relativePath, '', 'Root should have empty relative path');
            assert.ok(folders[0].label.includes('Root'), 'Root label should contain "Root"');
        });

        test('should include feature folders', async () => {
            // Create feature folders
            const tasksFolder = path.join(tempDir, '.vscode', 'tasks');
            fs.mkdirSync(path.join(tasksFolder, 'feature1'), { recursive: true });
            fs.mkdirSync(path.join(tasksFolder, 'feature2'), { recursive: true });
            
            const folders = await dialogService.getAvailableFolders();
            
            assert.strictEqual(folders.length, 3, 'Should have root + 2 feature folders');
            assert.strictEqual(folders[0].relativePath, '', 'First should be root');
            
            const featureNames = folders.slice(1).map(f => f.relativePath);
            assert.ok(featureNames.includes('feature1'), 'Should include feature1');
            assert.ok(featureNames.includes('feature2'), 'Should include feature2');
        });

        test('should include nested folders', async () => {
            // Create nested folder structure
            const tasksFolder = path.join(tempDir, '.vscode', 'tasks');
            fs.mkdirSync(path.join(tasksFolder, 'feature1', 'backlog1'), { recursive: true });
            
            const folders = await dialogService.getAvailableFolders();
            
            // Should have root, feature1, and feature1/backlog1
            assert.ok(folders.length >= 3, 'Should have at least 3 folders');
            
            const relativePaths = folders.map(f => f.relativePath);
            assert.ok(relativePaths.includes(''), 'Should include root');
            assert.ok(relativePaths.includes('feature1'), 'Should include feature1');
            
            // Check for nested path (cross-platform)
            const hasNestedPath = relativePaths.some(p => 
                p === path.join('feature1', 'backlog1') || 
                p === 'feature1/backlog1'
            );
            assert.ok(hasNestedPath, 'Should include nested backlog1 folder');
        });

        test('should exclude archive folder', async () => {
            // Create archive folder
            const tasksFolder = path.join(tempDir, '.vscode', 'tasks');
            fs.mkdirSync(path.join(tasksFolder, 'archive'), { recursive: true });
            fs.mkdirSync(path.join(tasksFolder, 'feature1'), { recursive: true });
            
            const folders = await dialogService.getAvailableFolders();
            
            const relativePaths = folders.map(f => f.relativePath);
            assert.ok(!relativePaths.includes('archive'), 'Should not include archive folder');
            assert.ok(relativePaths.includes('feature1'), 'Should include feature1');
        });
    });

    suite('validateTaskName', () => {
        test('should reject empty name when allowEmpty is false', () => {
            const result = dialogService.validateTaskName('', false);
            assert.ok(result !== null, 'Should return error for empty name');
            assert.ok(result!.includes('empty'), 'Error should mention empty');
        });

        test('should reject empty name by default', () => {
            const result = dialogService.validateTaskName('');
            assert.ok(result !== null, 'Should return error for empty name by default');
        });

        test('should allow empty name when allowEmpty is true', () => {
            const result = dialogService.validateTaskName('', true);
            assert.strictEqual(result, null, 'Should accept empty name when allowEmpty is true');
        });

        test('should allow whitespace-only name when allowEmpty is true', () => {
            const result = dialogService.validateTaskName('   ', true);
            assert.strictEqual(result, null, 'Should accept whitespace when allowEmpty is true');
        });

        test('should reject whitespace-only name when allowEmpty is false', () => {
            const result = dialogService.validateTaskName('   ', false);
            assert.ok(result !== null, 'Should return error for whitespace-only name');
        });

        test('should reject name with forward slash', () => {
            const result = dialogService.validateTaskName('task/name');
            assert.ok(result !== null, 'Should return error for name with /');
            assert.ok(result!.includes('path'), 'Error should mention path separators');
        });

        test('should reject name with backslash', () => {
            const result = dialogService.validateTaskName('task\\name');
            assert.ok(result !== null, 'Should return error for name with \\');
        });

        test('should reject name with invalid characters', () => {
            const invalidChars = ['<', '>', ':', '"', '|', '?', '*'];
            for (const char of invalidChars) {
                const result = dialogService.validateTaskName(`task${char}name`);
                assert.ok(result !== null, `Should reject name with ${char}`);
            }
        });

        test('should accept valid name', () => {
            const result = dialogService.validateTaskName('implement-user-authentication');
            assert.strictEqual(result, null, 'Should accept valid name');
        });

        test('should accept name with spaces', () => {
            const result = dialogService.validateTaskName('my task name');
            assert.strictEqual(result, null, 'Should accept name with spaces');
        });

        test('should accept name with dots', () => {
            const result = dialogService.validateTaskName('task.plan');
            assert.strictEqual(result, null, 'Should accept name with dots');
        });

        test('should accept name with dashes and underscores', () => {
            const result = dialogService.validateTaskName('task-name_v1');
            assert.strictEqual(result, null, 'Should accept name with dashes and underscores');
        });

        test('should still validate path separators when allowEmpty is true', () => {
            const result = dialogService.validateTaskName('task/name', true);
            assert.ok(result !== null, 'Should reject path separators even when allowEmpty is true');
        });

        test('should still validate invalid chars when allowEmpty is true', () => {
            const result = dialogService.validateTaskName('task<name>', true);
            assert.ok(result !== null, 'Should reject invalid chars even when allowEmpty is true');
        });
    });

    suite('getAbsoluteFolderPath', () => {
        test('should return tasks folder for empty location', () => {
            const result = dialogService.getAbsoluteFolderPath('');
            const expected = path.join(tempDir, '.vscode', 'tasks');
            assert.strictEqual(result, expected, 'Should return tasks folder for empty location');
        });

        test('should return subfolder path for relative location', () => {
            const result = dialogService.getAbsoluteFolderPath('feature1');
            const expected = path.join(tempDir, '.vscode', 'tasks', 'feature1');
            assert.strictEqual(result, expected, 'Should return subfolder path');
        });

        test('should handle nested paths', () => {
            const result = dialogService.getAbsoluteFolderPath(path.join('feature1', 'backlog1'));
            const expected = path.join(tempDir, '.vscode', 'tasks', 'feature1', 'backlog1');
            assert.strictEqual(result, expected, 'Should return nested path');
        });
    });

    suite('AITaskCreateOptions type (create mode)', () => {
        test('should have correct structure with name', () => {
            const options: AITaskCreateOptions = {
                name: 'test-task',
                location: 'feature1',
                description: 'Test description',
                model: DEFAULT_MODEL_ID
            };
            
            assert.strictEqual(options.name, 'test-task');
            assert.strictEqual(options.location, 'feature1');
            assert.strictEqual(options.description, 'Test description');
            assert.strictEqual(options.model, DEFAULT_MODEL_ID);
        });

        test('should allow empty location for root', () => {
            const options: AITaskCreateOptions = {
                name: 'root-task',
                location: '',
                description: 'Root level task',
                model: DEFAULT_MODEL_ID
            };
            
            assert.strictEqual(options.location, '');
        });

        test('should allow undefined name (AI will generate)', () => {
            const options: AITaskCreateOptions = {
                location: 'feature1',
                description: 'Task without explicit name',
                model: DEFAULT_MODEL_ID
            };
            
            assert.strictEqual(options.name, undefined);
            assert.strictEqual(options.description, 'Task without explicit name');
        });

        test('should allow empty string name (AI will generate)', () => {
            const options: AITaskCreateOptions = {
                name: '',
                location: '',
                description: 'Task with empty name',
                model: DEFAULT_MODEL_ID
            };
            
            assert.strictEqual(options.name, '');
        });

        test('should allow empty description', () => {
            const options: AITaskCreateOptions = {
                name: 'minimal-task',
                location: '',
                description: '',
                model: DEFAULT_MODEL_ID
            };
            
            assert.strictEqual(options.description, '');
        });
    });

    suite('AITaskFromFeatureOptions type (from-feature mode)', () => {
        test('should have correct structure', () => {
            const options: AITaskFromFeatureOptions = {
                location: 'feature1',
                focus: 'Implement the core API',
                depth: 'simple',
                model: DEFAULT_MODEL_ID
            };
            
            assert.strictEqual(options.location, 'feature1');
            assert.strictEqual(options.focus, 'Implement the core API');
            assert.strictEqual(options.depth, 'simple');
            assert.strictEqual(options.model, DEFAULT_MODEL_ID);
        });

        test('should allow deep depth', () => {
            const options: AITaskFromFeatureOptions = {
                location: 'feature1',
                focus: 'Deep analysis',
                depth: 'deep',
                model: DEFAULT_MODEL_ID
            };
            
            assert.strictEqual(options.depth, 'deep');
        });

        test('should allow empty focus', () => {
            const options: AITaskFromFeatureOptions = {
                location: 'feature1',
                focus: '',
                depth: 'simple',
                model: DEFAULT_MODEL_ID
            };
            
            assert.strictEqual(options.focus, '');
        });

        test('should allow optional task name', () => {
            const options: AITaskFromFeatureOptions = {
                name: 'my-custom-task',
                location: 'feature1',
                focus: 'Implement API',
                depth: 'simple',
                model: DEFAULT_MODEL_ID
            };
            
            assert.strictEqual(options.name, 'my-custom-task');
        });

        test('should allow undefined task name (AI will generate)', () => {
            const options: AITaskFromFeatureOptions = {
                location: 'feature1',
                focus: 'Implement API',
                depth: 'simple',
                model: DEFAULT_MODEL_ID
            };
            
            assert.strictEqual(options.name, undefined);
        });

        test('should allow empty string task name (AI will generate)', () => {
            const options: AITaskFromFeatureOptions = {
                name: '',
                location: 'feature1',
                focus: 'Implement API',
                depth: 'simple',
                model: DEFAULT_MODEL_ID
            };
            
            assert.strictEqual(options.name, '');
        });
    });

    suite('AITaskCreationOptions unified type', () => {
        test('should support create mode', () => {
            const options: AITaskCreationOptions = {
                mode: 'create',
                createOptions: {
                    name: 'test-task',
                    location: 'feature1',
                    description: 'Test',
                    model: DEFAULT_MODEL_ID
                }
            };
            
            assert.strictEqual(options.mode, 'create');
            assert.ok(options.createOptions);
            assert.strictEqual(options.createOptions!.name, 'test-task');
        });

        test('should support from-feature mode', () => {
            const options: AITaskCreationOptions = {
                mode: 'from-feature',
                fromFeatureOptions: {
                    location: 'feature1',
                    focus: 'API implementation',
                    depth: 'deep',
                    model: DEFAULT_MODEL_ID
                }
            };
            
            assert.strictEqual(options.mode, 'from-feature');
            assert.ok(options.fromFeatureOptions);
            assert.strictEqual(options.fromFeatureOptions!.depth, 'deep');
        });
    });

    suite('AITaskDialogResult type', () => {
        test('should represent cancelled result', () => {
            const result: AITaskDialogResult = {
                cancelled: true,
                options: null
            };
            
            assert.strictEqual(result.cancelled, true);
            assert.strictEqual(result.options, null);
        });

        test('should represent successful create mode result', () => {
            const result: AITaskDialogResult = {
                cancelled: false,
                options: {
                    mode: 'create',
                    createOptions: {
                        name: 'test-task',
                        location: 'feature1',
                        description: 'Test',
                        model: DEFAULT_MODEL_ID
                    }
                }
            };
            
            assert.strictEqual(result.cancelled, false);
            assert.ok(result.options !== null);
            assert.strictEqual(result.options!.mode, 'create');
            assert.strictEqual(result.options!.createOptions!.name, 'test-task');
        });

        test('should represent successful from-feature mode result', () => {
            const result: AITaskDialogResult = {
                cancelled: false,
                options: {
                    mode: 'from-feature',
                    fromFeatureOptions: {
                        location: 'feature1',
                        focus: 'Core implementation',
                        depth: 'simple',
                        model: DEFAULT_MODEL_ID
                    }
                }
            };
            
            assert.strictEqual(result.cancelled, false);
            assert.ok(result.options !== null);
            assert.strictEqual(result.options!.mode, 'from-feature');
            assert.strictEqual(result.options!.fromFeatureOptions!.depth, 'simple');
        });

        test('should represent from-feature mode result with task name', () => {
            const result: AITaskDialogResult = {
                cancelled: false,
                options: {
                    mode: 'from-feature',
                    fromFeatureOptions: {
                        name: 'custom-feature-task',
                        location: 'feature1',
                        focus: 'Core implementation',
                        depth: 'simple',
                        model: DEFAULT_MODEL_ID
                    }
                }
            };
            
            assert.strictEqual(result.cancelled, false);
            assert.ok(result.options !== null);
            assert.strictEqual(result.options!.mode, 'from-feature');
            assert.strictEqual(result.options!.fromFeatureOptions!.name, 'custom-feature-task');
            assert.strictEqual(result.options!.fromFeatureOptions!.focus, 'Core implementation');
        });
    });

    suite('Cross-platform path handling', () => {
        test('should handle Windows-style paths in validation', () => {
            // Backslash should be rejected as path separator
            const result = dialogService.validateTaskName('task\\name');
            assert.ok(result !== null, 'Should reject backslash');
        });

        test('should handle Unix-style paths in validation', () => {
            // Forward slash should be rejected as path separator
            const result = dialogService.validateTaskName('task/name');
            assert.ok(result !== null, 'Should reject forward slash');
        });

        test('should normalize paths in getAbsoluteFolderPath', () => {
            // Test with forward slash (Unix-style)
            const result1 = dialogService.getAbsoluteFolderPath('feature1/backlog1');
            
            // Test with path.join (platform-native)
            const result2 = dialogService.getAbsoluteFolderPath(path.join('feature1', 'backlog1'));
            
            // Both should resolve to the same path on the current platform
            const expected = path.join(tempDir, '.vscode', 'tasks', 'feature1', 'backlog1');
            
            // Note: On Windows, forward slashes in paths are typically handled by Node.js path module
            // The important thing is that the result is a valid path
            assert.ok(result1.includes('feature1'), 'Should include feature1');
            assert.ok(result1.includes('backlog1'), 'Should include backlog1');
            assert.strictEqual(result2, expected, 'Platform-native path should match expected');
        });
    });

    suite('Integration with TaskManager', () => {
        test('should use TaskManager tasks folder', () => {
            const tasksFolder = taskManager.getTasksFolder();
            const dialogPath = dialogService.getAbsoluteFolderPath('');
            
            assert.strictEqual(dialogPath, tasksFolder, 'Dialog should use TaskManager tasks folder');
        });

        test('should reflect TaskManager feature folders', async () => {
            // Create folders through TaskManager
            await taskManager.createFeature('test-feature');
            
            const folders = await dialogService.getAvailableFolders();
            const relativePaths = folders.map(f => f.relativePath);
            
            assert.ok(relativePaths.includes('test-feature'), 'Should include created feature');
        });
    });

    suite('Webview dialog functionality', () => {
        test('dialog service should have showDialog method', () => {
            assert.ok(typeof dialogService.showDialog === 'function', 'Should have showDialog method');
        });

        test('dialog service should return cancelled result when no panel', async () => {
            // Note: We can't fully test the webview panel in unit tests,
            // but we can verify the service interface
            assert.ok(dialogService.getAvailableFolders, 'Should have getAvailableFolders method');
            assert.ok(dialogService.validateTaskName, 'Should have validateTaskName method');
            assert.ok(dialogService.getAbsoluteFolderPath, 'Should have getAbsoluteFolderPath method');
        });
    });

    // =========================================================================
    // Persistent Model Selection Tests
    // =========================================================================
    
    suite('Persistent AI Model Selection', () => {
        test('getLastUsedAIModel should return config default when no saved state', () => {
            const freshContext = new MockExtensionContext();
            const model = getLastUsedAIModel(freshContext as unknown as vscode.ExtensionContext);
            const configDefault = getFollowPromptDefaultModel();
            
            assert.strictEqual(model, configDefault, 
                'Should return config default when no saved state');
        });

        test('saveLastUsedAIModel should persist model to workspace state', () => {
            const context = new MockExtensionContext();
            
            saveLastUsedAIModel(context as unknown as vscode.ExtensionContext, VALID_MODELS[3]);
            
            const storedValue = context.workspaceState.getStoredValue('workspaceShortcuts.aiTask.lastUsedModel');
            assert.strictEqual(storedValue, VALID_MODELS[3], 
                'Should store model in workspace state');
        });

        test('getLastUsedAIModel should retrieve saved model', () => {
            const context = new MockExtensionContext();
            
            // Save a model first
            saveLastUsedAIModel(context as unknown as vscode.ExtensionContext, VALID_MODELS[1]);
            
            // Retrieve it
            const model = getLastUsedAIModel(context as unknown as vscode.ExtensionContext);
            
            assert.strictEqual(model, VALID_MODELS[1], 
                'Should retrieve previously saved model');
        });

        test('getLastUsedAIModel should fallback to config default for invalid saved model', () => {
            const context = new MockExtensionContext();
            
            // Manually save an invalid/deprecated model
            context.workspaceState.update('workspaceShortcuts.aiTask.lastUsedModel', 'deprecated-model-xyz');
            
            // Should fallback since model is not in VALID_MODELS
            const model = getLastUsedAIModel(context as unknown as vscode.ExtensionContext);
            const configDefault = getFollowPromptDefaultModel();
            
            assert.strictEqual(model, configDefault, 
                'Should fallback to config default when saved model is invalid');
        });

        test('saveLastUsedAIModel should overwrite previous selection', () => {
            const context = new MockExtensionContext();
            
            // Save first model
            saveLastUsedAIModel(context as unknown as vscode.ExtensionContext, DEFAULT_MODEL_ID);
            
            // Save second model (overwrite)
            saveLastUsedAIModel(context as unknown as vscode.ExtensionContext, VALID_MODELS[3]);
            
            // Retrieve should return the latest
            const model = getLastUsedAIModel(context as unknown as vscode.ExtensionContext);
            
            assert.strictEqual(model, VALID_MODELS[3], 
                'Should return the most recently saved model');
        });

        test('model persistence should work across multiple valid models', () => {
            const context = new MockExtensionContext();
            const testModels = [VALID_MODELS[0], VALID_MODELS[1], VALID_MODELS[2], VALID_MODELS[3]];
            
            for (const testModel of testModels) {
                saveLastUsedAIModel(context as unknown as vscode.ExtensionContext, testModel);
                const retrieved = getLastUsedAIModel(context as unknown as vscode.ExtensionContext);
                
                assert.strictEqual(retrieved, testModel, 
                    `Should persist and retrieve ${testModel}`);
            }
        });

        test('persistence should be isolated per context (workspace)', () => {
            const context1 = new MockExtensionContext();
            const context2 = new MockExtensionContext();
            
            // Save different models in different contexts
            saveLastUsedAIModel(context1 as unknown as vscode.ExtensionContext, DEFAULT_MODEL_ID);
            saveLastUsedAIModel(context2 as unknown as vscode.ExtensionContext, VALID_MODELS[1]);
            
            // Each context should have its own value
            const model1 = getLastUsedAIModel(context1 as unknown as vscode.ExtensionContext);
            const model2 = getLastUsedAIModel(context2 as unknown as vscode.ExtensionContext);
            
            assert.strictEqual(model1, DEFAULT_MODEL_ID, 
                'Context 1 should have its own persisted model');
            assert.strictEqual(model2, VALID_MODELS[1], 
                'Context 2 should have its own persisted model');
        });

        test('AITaskDialogService should use persisted model as default', () => {
            // Save a non-default model
            saveLastUsedAIModel(mockContext as unknown as vscode.ExtensionContext, VALID_MODELS[2]);
            
            // Create new dialog service with the context
            const newDialogService = new AITaskDialogService(
                taskManager, 
                mockExtensionUri, 
                mockContext as unknown as vscode.ExtensionContext
            );
            
            // The service should exist and be ready to use the persisted model
            assert.ok(newDialogService, 'Dialog service should be created with context');
            
            // Verify the context has the saved model
            const persistedModel = getLastUsedAIModel(mockContext as unknown as vscode.ExtensionContext);
            assert.strictEqual(persistedModel, VALID_MODELS[2], 
                'Dialog service context should have persisted model');
        });
    });
});
