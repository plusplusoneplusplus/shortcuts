import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationManager } from '../../shortcuts/configuration-manager';
import { DEFAULT_SHORTCUTS_CONFIG, ShortcutsConfig } from '../../shortcuts/types';

suite('ConfigurationManager Tests', () => {
    let tempDir: string;
    let configManager: ConfigurationManager;
    let originalShowWarningMessage: any;
    let originalShowErrorMessage: any;
    let warningMessages: string[];
    let errorMessages: string[];

    setup(() => {
        // Create temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-test-'));
        configManager = new ConfigurationManager(tempDir);

        // Mock vscode.window methods to capture messages
        warningMessages = [];
        errorMessages = [];

        originalShowWarningMessage = vscode.window.showWarningMessage;
        originalShowErrorMessage = vscode.window.showErrorMessage;

        vscode.window.showWarningMessage = (message: string, ...items: any[]) => {
            warningMessages.push(message);
            return Promise.resolve(undefined);
        };

        vscode.window.showErrorMessage = (message: string, ...items: any[]) => {
            errorMessages.push(message);
            return Promise.resolve(undefined);
        };
    });

    teardown(() => {
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }

        // Restore original vscode methods
        vscode.window.showWarningMessage = originalShowWarningMessage;
        vscode.window.showErrorMessage = originalShowErrorMessage;

        // Dispose configuration manager
        configManager.dispose();
    });

    suite('loadConfiguration', () => {
        test('should create default configuration when file does not exist', async () => {
            const config = await configManager.loadConfiguration();

            assert.deepStrictEqual(config, DEFAULT_SHORTCUTS_CONFIG);

            // Verify file was created
            const configPath = configManager.getConfigPath();
            assert.strictEqual(fs.existsSync(configPath), true);
        });

        test('should load valid YAML configuration', async () => {
            // Create .vscode directory
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });

            // Create test folders
            const testFolder1 = path.join(tempDir, 'test-folder-1');
            const testFolder2 = path.join(tempDir, 'test-folder-2');
            fs.mkdirSync(testFolder1);
            fs.mkdirSync(testFolder2);

            // Write valid configuration
            const configPath = path.join(vscodePath, 'shortcuts.yaml');
            const testConfig = {
                shortcuts: [
                    { path: 'test-folder-1', name: 'Test Folder 1' },
                    { path: 'test-folder-2' }
                ]
            };

            fs.writeFileSync(configPath, `shortcuts:
  - path: test-folder-1
    name: Test Folder 1
  - path: test-folder-2`);

            const config = await configManager.loadConfiguration();

            assert.strictEqual(config.shortcuts.length, 2);
            assert.strictEqual(config.shortcuts[0].path, 'test-folder-1');
            assert.strictEqual(config.shortcuts[0].name, 'Test Folder 1');
            assert.strictEqual(config.shortcuts[1].path, 'test-folder-2');
        });

        test('should handle invalid YAML syntax gracefully', async () => {
            // Create .vscode directory
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });

            // Write invalid YAML
            const configPath = path.join(vscodePath, 'shortcuts.yaml');
            fs.writeFileSync(configPath, 'invalid: yaml: content: [unclosed');

            const config = await configManager.loadConfiguration();

            assert.deepStrictEqual(config, DEFAULT_SHORTCUTS_CONFIG);
            assert.strictEqual(warningMessages.length, 1);
            assert.ok(warningMessages[0].includes('invalid YAML syntax'));
        });

        test('should skip shortcuts with non-existent paths', async () => {
            // Create .vscode directory
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });

            // Create one valid folder
            const validFolder = path.join(tempDir, 'valid-folder');
            fs.mkdirSync(validFolder);

            // Write configuration with valid and invalid paths
            const configPath = path.join(vscodePath, 'shortcuts.yaml');
            fs.writeFileSync(configPath, `shortcuts:
  - path: valid-folder
    name: Valid Folder
  - path: non-existent-folder
    name: Invalid Folder`);

            const config = await configManager.loadConfiguration();

            assert.strictEqual(config.shortcuts.length, 1);
            assert.strictEqual(config.shortcuts[0].path, 'valid-folder');
        });

        test('should skip shortcuts pointing to files instead of directories', async () => {
            // Create .vscode directory
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });

            // Create a file and a folder
            const testFile = path.join(tempDir, 'test-file.txt');
            const testFolder = path.join(tempDir, 'test-folder');
            fs.writeFileSync(testFile, 'test content');
            fs.mkdirSync(testFolder);

            // Write configuration pointing to both file and folder
            const configPath = path.join(vscodePath, 'shortcuts.yaml');
            fs.writeFileSync(configPath, `shortcuts:
  - path: test-file.txt
    name: Test File
  - path: test-folder
    name: Test Folder`);

            const config = await configManager.loadConfiguration();

            assert.strictEqual(config.shortcuts.length, 1);
            assert.strictEqual(config.shortcuts[0].path, 'test-folder');
        });
    });
    suite('saveConfiguration', () => {
        test('should save configuration to YAML file', async () => {
            const testConfig: ShortcutsConfig = {
                shortcuts: [
                    { path: 'src', name: 'Source' },
                    { path: 'tests', name: 'Tests' }
                ]
            };

            await configManager.saveConfiguration(testConfig);

            const configPath = configManager.getConfigPath();
            assert.strictEqual(fs.existsSync(configPath), true);

            const fileContent = fs.readFileSync(configPath, 'utf8');
            assert.ok(fileContent.includes('shortcuts:'));
            assert.ok(fileContent.includes('path: src'));
            assert.ok(fileContent.includes('name: Source'));
        });

        test('should create .vscode directory if it does not exist', async () => {
            const testConfig: ShortcutsConfig = {
                shortcuts: [{ path: 'test', name: 'Test' }]
            };

            // Ensure .vscode directory doesn't exist
            const vscodePath = path.join(tempDir, '.vscode');
            assert.strictEqual(fs.existsSync(vscodePath), false);

            await configManager.saveConfiguration(testConfig);

            assert.strictEqual(fs.existsSync(vscodePath), true);
            assert.strictEqual(fs.existsSync(configManager.getConfigPath()), true);
        });

        test('should handle permission errors gracefully', async () => {
            // Skip this test on Windows as permission handling is different
            if (process.platform === 'win32') {
                return;
            }

            // Create .vscode directory with no write permissions
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath);
            fs.chmodSync(vscodePath, 0o444); // Read-only

            const testConfig: ShortcutsConfig = {
                shortcuts: [{ path: 'test', name: 'Test' }]
            };

            try {
                await configManager.saveConfiguration(testConfig);
                assert.fail('Should have thrown an error');
            } catch (error) {
                assert.ok(error instanceof Error);
                assert.strictEqual(errorMessages.length, 1);
                assert.ok(errorMessages[0].includes('Permission denied'));
            }

            // Restore permissions for cleanup
            fs.chmodSync(vscodePath, 0o755);
        });
    });

    suite('addShortcut', () => {
        test('should add new shortcut to configuration', async () => {
            // Create test folder
            const testFolder = path.join(tempDir, 'new-folder');
            fs.mkdirSync(testFolder);

            await configManager.addShortcut('new-folder', 'New Folder');

            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.shortcuts.length, 1);
            assert.strictEqual(config.shortcuts[0].path, 'new-folder');
            assert.strictEqual(config.shortcuts[0].name, 'New Folder');
        });

        test('should use folder name as default display name', async () => {
            // Create test folder
            const testFolder = path.join(tempDir, 'auto-named-folder');
            fs.mkdirSync(testFolder);

            await configManager.addShortcut('auto-named-folder');

            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.shortcuts.length, 1);
            assert.strictEqual(config.shortcuts[0].name, 'auto-named-folder');
        });

        test('should handle absolute paths correctly', async () => {
            // Create test folder
            const testFolder = path.join(tempDir, 'absolute-path-folder');
            fs.mkdirSync(testFolder);

            await configManager.addShortcut(testFolder, 'Absolute Path');

            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.shortcuts.length, 1);
            // Should store as relative path when inside workspace
            assert.strictEqual(config.shortcuts[0].path, 'absolute-path-folder');
        });

        test('should prevent duplicate shortcuts', async () => {
            // Create test folder
            const testFolder = path.join(tempDir, 'duplicate-folder');
            fs.mkdirSync(testFolder);

            // Add shortcut twice
            await configManager.addShortcut('duplicate-folder', 'First');
            await configManager.addShortcut('duplicate-folder', 'Second');

            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.shortcuts.length, 1);
            assert.strictEqual(warningMessages.length, 1);
            assert.ok(warningMessages[0].includes('already added'));
        });

        test('should handle paths outside workspace', async () => {
            // Create folder outside workspace
            const outsideFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));

            try {
                await configManager.addShortcut(outsideFolder, 'Outside');

                const config = await configManager.loadConfiguration();
                assert.strictEqual(config.shortcuts.length, 1);
                // Should store as absolute path when outside workspace
                assert.strictEqual(config.shortcuts[0].path, outsideFolder);
            } finally {
                fs.rmSync(outsideFolder, { recursive: true, force: true });
            }
        });
    });

    suite('removeShortcut', () => {
        test('should remove existing shortcut', async () => {
            // Create test folder and add shortcut
            const testFolder = path.join(tempDir, 'remove-me');
            fs.mkdirSync(testFolder);
            await configManager.addShortcut('remove-me', 'Remove Me');

            // Verify it was added
            let config = await configManager.loadConfiguration();
            assert.strictEqual(config.shortcuts.length, 1);

            // Remove the shortcut
            await configManager.removeShortcut('remove-me');

            // Verify it was removed
            config = await configManager.loadConfiguration();
            assert.strictEqual(config.shortcuts.length, 0);
        });

        test('should handle non-existent shortcut gracefully', async () => {
            await configManager.removeShortcut('non-existent');

            assert.strictEqual(warningMessages.length, 1);
            assert.ok(warningMessages[0].includes('not found'));
        });

        test('should handle absolute paths when removing', async () => {
            // Create test folder and add shortcut
            const testFolder = path.join(tempDir, 'absolute-remove');
            fs.mkdirSync(testFolder);
            await configManager.addShortcut('absolute-remove');

            // Remove using absolute path
            await configManager.removeShortcut(testFolder);

            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.shortcuts.length, 0);
        });
    });

    suite('renameShortcut', () => {
        test('should rename existing shortcut', async () => {
            // Create test folder and add shortcut
            const testFolder = path.join(tempDir, 'rename-me');
            fs.mkdirSync(testFolder);
            await configManager.addShortcut('rename-me', 'Original Name');

            // Rename the shortcut
            await configManager.renameShortcut('rename-me', 'New Name');

            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.shortcuts.length, 1);
            assert.strictEqual(config.shortcuts[0].name, 'New Name');
        });

        test('should handle non-existent shortcut gracefully', async () => {
            await configManager.renameShortcut('non-existent', 'New Name');

            assert.strictEqual(warningMessages.length, 1);
            assert.ok(warningMessages[0].includes('not found'));
        });
    });

    suite('path resolution and validation', () => {
        test('should resolve relative paths correctly', async () => {
            // Create nested folder structure
            const nestedPath = path.join(tempDir, 'level1', 'level2');
            fs.mkdirSync(nestedPath, { recursive: true });

            await configManager.addShortcut('./level1/level2', 'Nested');

            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.shortcuts.length, 1);
            assert.strictEqual(config.shortcuts[0].path, 'level1/level2');
        });

        test('should handle paths with .. correctly', async () => {
            // Create folder outside workspace
            const parentDir = path.dirname(tempDir);
            const siblingDir = path.join(parentDir, 'sibling-folder');
            fs.mkdirSync(siblingDir);

            try {
                const relativePath = path.relative(tempDir, siblingDir);
                await configManager.addShortcut(relativePath, 'Sibling');

                const config = await configManager.loadConfiguration();
                assert.strictEqual(config.shortcuts.length, 1);
                // Should store as absolute path when going outside workspace
                assert.strictEqual(config.shortcuts[0].path, siblingDir);
            } finally {
                fs.rmSync(siblingDir, { recursive: true, force: true });
            }
        });
    });

    suite('error handling', () => {
        test('should handle corrupted configuration gracefully', async () => {
            // Create .vscode directory
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });

            // Write configuration with invalid structure
            const configPath = path.join(vscodePath, 'shortcuts.yaml');
            fs.writeFileSync(configPath, 'shortcuts: "not an array"');

            const config = await configManager.loadConfiguration();

            assert.deepStrictEqual(config, DEFAULT_SHORTCUTS_CONFIG);
        });

        test('should handle missing shortcuts array', async () => {
            // Create .vscode directory
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });

            // Write configuration without shortcuts array
            const configPath = path.join(vscodePath, 'shortcuts.yaml');
            fs.writeFileSync(configPath, 'other_property: value');

            const config = await configManager.loadConfiguration();

            assert.deepStrictEqual(config, DEFAULT_SHORTCUTS_CONFIG);
        });

        test('should skip invalid shortcut entries', async () => {
            // Create .vscode directory and valid folder
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });
            const validFolder = path.join(tempDir, 'valid');
            fs.mkdirSync(validFolder);

            // Write configuration with mixed valid and invalid entries
            const configPath = path.join(vscodePath, 'shortcuts.yaml');
            fs.writeFileSync(configPath, `shortcuts:
  - path: valid
    name: Valid Entry
  - invalid_entry: true
  - path: ""
    name: Empty Path
  - path: 123
    name: Numeric Path`);

            const config = await configManager.loadConfiguration();

            assert.strictEqual(config.shortcuts.length, 1);
            assert.strictEqual(config.shortcuts[0].path, 'valid');
        });
    });

    suite('file watching', () => {
        test('should create file watcher', () => {
            let callbackCalled = false;
            const callback = () => { callbackCalled = true; };

            const watcher = configManager.watchConfigFile(callback);

            assert.ok(watcher);
            assert.strictEqual(typeof watcher.dispose, 'function');

            watcher.dispose();
        });

        test('should dispose existing watcher when creating new one', () => {
            const callback1 = () => { };
            const callback2 = () => { };

            const watcher1 = configManager.watchConfigFile(callback1);
            const watcher2 = configManager.watchConfigFile(callback2);

            // Should be different instances
            assert.notStrictEqual(watcher1, watcher2);

            watcher2.dispose();
        });

        test('should dispose watcher on cleanup', () => {
            const callback = () => { };
            configManager.watchConfigFile(callback);

            // Should not throw
            configManager.dispose();
        });
    });

    suite('getConfigPath', () => {
        test('should return correct configuration file path', () => {
            const expectedPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
            const actualPath = configManager.getConfigPath();

            assert.strictEqual(actualPath, expectedPath);
        });
    });
});