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

        test('should load valid YAML configuration with logical groups', async () => {
            // Create .vscode directory
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });

            // Create test folders
            const testFolder1 = path.join(tempDir, 'test-folder-1');
            const testFolder2 = path.join(tempDir, 'test-folder-2');
            fs.mkdirSync(testFolder1);
            fs.mkdirSync(testFolder2);
            fs.writeFileSync(path.join(testFolder1, 'test.txt'), 'content');

            // Write valid configuration
            const configPath = path.join(vscodePath, 'shortcuts.yaml');

            fs.writeFileSync(configPath, `logicalGroups:
  - name: Test Group 1
    description: First group
    items:
      - path: test-folder-1
        name: Folder 1
        type: folder
      - path: test-folder-1/test.txt
        name: Test File
        type: file
  - name: Test Group 2
    items:
      - path: test-folder-2
        name: Folder 2
        type: folder`);

            const config = await configManager.loadConfiguration();

            assert.strictEqual(config.logicalGroups.length, 2);
            assert.strictEqual(config.logicalGroups[0].name, 'Test Group 1');
            assert.strictEqual(config.logicalGroups[0].description, 'First group');
            assert.strictEqual(config.logicalGroups[0].items.length, 2);
            assert.strictEqual(config.logicalGroups[1].name, 'Test Group 2');
            assert.strictEqual(config.logicalGroups[1].items.length, 1);
        });

        test('should migrate old physical shortcuts format', async () => {
            // Create .vscode directory
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });

            // Create test folder
            const testFolder = path.join(tempDir, 'test-folder');
            fs.mkdirSync(testFolder);

            // Write old-format configuration
            const configPath = path.join(vscodePath, 'shortcuts.yaml');
            fs.writeFileSync(configPath, `shortcuts:
  - path: test-folder
    name: Old Shortcut`);

            const config = await configManager.loadConfiguration();

            // Should have migrated to logical groups
            assert.strictEqual(config.logicalGroups.length, 1);
            assert.strictEqual(config.logicalGroups[0].name, 'Old Shortcut');
            assert.strictEqual(config.logicalGroups[0].items.length, 1);
            assert.strictEqual(config.logicalGroups[0].items[0].path, 'test-folder');
            assert.strictEqual(config.logicalGroups[0].items[0].type, 'folder');
        });

        test('should handle invalid YAML syntax gracefully', async () => {
            // Create .vscode directory
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });

            // Write invalid YAML
            const configPath = path.join(vscodePath, 'shortcuts.yaml');
            fs.writeFileSync(configPath, `logicalGroups: [[[invalid`);

            const config = await configManager.loadConfiguration();

            // Should return default configuration
            assert.deepStrictEqual(config, DEFAULT_SHORTCUTS_CONFIG);
        });

        test('should skip groups with non-existent paths', async () => {
            // Create .vscode directory
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });

            // Write configuration with non-existent path
            const configPath = path.join(vscodePath, 'shortcuts.yaml');
            fs.writeFileSync(configPath, `logicalGroups:
  - name: Test Group
    items:
      - path: non-existent-folder
        name: Missing
        type: folder`);

            const config = await configManager.loadConfiguration();

            // Group should exist but have no items
            assert.strictEqual(config.logicalGroups.length, 1);
            assert.strictEqual(config.logicalGroups[0].items.length, 0);
        });

        test('should handle type mismatch gracefully', async () => {
            // Create .vscode directory
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });

            // Create a file
            const testFile = path.join(tempDir, 'test-file.txt');
            fs.writeFileSync(testFile, 'content');

            // Write configuration claiming file is a folder
            const configPath = path.join(vscodePath, 'shortcuts.yaml');
            fs.writeFileSync(configPath, `logicalGroups:
  - name: Test Group
    items:
      - path: test-file.txt
        name: File as Folder
        type: folder`);

            const config = await configManager.loadConfiguration();

            // Should use actual type (file) instead of configured type (folder)
            assert.strictEqual(config.logicalGroups.length, 1);
            assert.strictEqual(config.logicalGroups[0].items.length, 1);
            assert.strictEqual(config.logicalGroups[0].items[0].type, 'file');
        });
    });

    suite('saveConfiguration', () => {
        test('should save configuration to YAML file', async () => {
            const testConfig: ShortcutsConfig = {
                logicalGroups: [
                    {
                        name: 'Test Group',
                        description: 'Test Description',
                        items: [
                            { path: 'test-folder', name: 'Test Folder', type: 'folder' }
                        ]
                    }
                ]
            };

            await configManager.saveConfiguration(testConfig);

            // Verify file was created
            const configPath = configManager.getConfigPath();
            assert.strictEqual(fs.existsSync(configPath), true);

            // Load and verify content
            const loadedConfig = await configManager.loadConfiguration();
            assert.strictEqual(loadedConfig.logicalGroups.length, 1);
            assert.strictEqual(loadedConfig.logicalGroups[0].name, 'Test Group');
        });

        test('should create .vscode directory if it does not exist', async () => {
            const testConfig: ShortcutsConfig = {
                logicalGroups: []
            };

            await configManager.saveConfiguration(testConfig);

            const configPath = configManager.getConfigPath();
            const configDir = path.dirname(configPath);

            assert.strictEqual(fs.existsSync(configDir), true);
        });
    });

    suite('Logical Group Operations', () => {
        test('should create new logical group', async () => {
            await configManager.createLogicalGroup('New Group', 'Description');

            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups.length, 1);
            assert.strictEqual(config.logicalGroups[0].name, 'New Group');
            assert.strictEqual(config.logicalGroups[0].description, 'Description');
            assert.strictEqual(config.logicalGroups[0].items.length, 0);
        });

        test('should prevent duplicate group names', async () => {
            await configManager.createLogicalGroup('Test Group');
            await configManager.createLogicalGroup('Test Group');

            const config = await configManager.loadConfiguration();
            // Should only have one group
            assert.strictEqual(config.logicalGroups.length, 1);
        });

        test('should add item to logical group', async () => {
            // Create a test folder
            const testFolder = path.join(tempDir, 'test-folder');
            fs.mkdirSync(testFolder);

            // Create group first
            await configManager.createLogicalGroup('Test Group');

            // Add item to group
            await configManager.addToLogicalGroup('Test Group', testFolder, 'Test Folder', 'folder');

            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 1);
            assert.strictEqual(config.logicalGroups[0].items[0].name, 'Test Folder');
            assert.strictEqual(config.logicalGroups[0].items[0].type, 'folder');
        });

        test('should prevent duplicate items in group', async () => {
            const testFolder = path.join(tempDir, 'test-folder');
            fs.mkdirSync(testFolder);

            await configManager.createLogicalGroup('Test Group');
            await configManager.addToLogicalGroup('Test Group', testFolder, 'Test Folder', 'folder');
            await configManager.addToLogicalGroup('Test Group', testFolder, 'Test Folder', 'folder');

            const config = await configManager.loadConfiguration();
            // Should only have one item
            assert.strictEqual(config.logicalGroups[0].items.length, 1);
        });

        test('should remove item from logical group', async () => {
            const testFolder = path.join(tempDir, 'test-folder');
            fs.mkdirSync(testFolder);

            await configManager.createLogicalGroup('Test Group');
            await configManager.addToLogicalGroup('Test Group', testFolder, 'Test Folder', 'folder');

            let config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 1);

            await configManager.removeFromLogicalGroup('Test Group', testFolder);

            config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 0);
        });

        test('should handle case-insensitive path comparison on Windows', async () => {
            // Create a test file with a specific case
            const testFile = path.join(tempDir, 'TestFile.txt');
            fs.writeFileSync(testFile, 'test content');

            await configManager.createLogicalGroup('Case Test Group');

            // Add the file with original case
            await configManager.addToLogicalGroup('Case Test Group', testFile, 'Test File', 'file');

            let config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 1);

            // Try to add the same file with different case (should be prevented on all platforms)
            const differentCasePath = path.join(tempDir, 'testfile.txt');
            await configManager.addToLogicalGroup('Case Test Group', differentCasePath, 'Test File 2', 'file');

            config = await configManager.loadConfiguration();
            // On Windows, this should still be 1 (duplicate prevented)
            // On macOS/Linux with case-sensitive filesystems, this might be 2
            // But since we're testing the same actual file, it should be 1 on Windows
            if (process.platform === 'win32') {
                assert.strictEqual(config.logicalGroups[0].items.length, 1, 'Should prevent duplicate with different case on Windows');
            }

            // Try to remove using different case
            await configManager.removeFromLogicalGroup('Case Test Group', differentCasePath);

            config = await configManager.loadConfiguration();
            // On Windows, removal should work with different case
            if (process.platform === 'win32') {
                assert.strictEqual(config.logicalGroups[0].items.length, 0, 'Should remove item with different case on Windows');
            }
        });

        test('should add single file to logical group', async () => {
            // Create a single test file
            const testFile = path.join(tempDir, 'single-file.txt');
            fs.writeFileSync(testFile, 'test content');

            // Create group first
            await configManager.createLogicalGroup('Single File Group');

            // Add the single file to group
            await configManager.addToLogicalGroup('Single File Group', testFile, 'Single File', 'file');

            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 1);
            assert.strictEqual(config.logicalGroups[0].items[0].name, 'Single File');
            assert.strictEqual(config.logicalGroups[0].items[0].type, 'file');
        });

        test('should rename logical group', async () => {
            await configManager.createLogicalGroup('Old Name');

            await configManager.renameLogicalGroup('Old Name', 'New Name');

            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups.length, 1);
            assert.strictEqual(config.logicalGroups[0].name, 'New Name');
        });

        test('should prevent renaming to existing group name', async () => {
            await configManager.createLogicalGroup('Group 1');
            await configManager.createLogicalGroup('Group 2');

            await configManager.renameLogicalGroup('Group 1', 'Group 2');

            const config = await configManager.loadConfiguration();
            // Group 1 should still exist with original name
            const group1 = config.logicalGroups.find(g => g.name === 'Group 1');
            assert.ok(group1);
        });

        test('should delete logical group', async () => {
            await configManager.createLogicalGroup('Group to Delete');

            let config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups.length, 1);

            await configManager.deleteLogicalGroup('Group to Delete');

            config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups.length, 0);
        });

        test('should handle absolute paths correctly', async () => {
            const testFolder = path.join(tempDir, 'test-folder');
            fs.mkdirSync(testFolder);

            await configManager.createLogicalGroup('Test Group');
            await configManager.addToLogicalGroup('Test Group', testFolder, 'Absolute Path', 'folder');

            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 1);
        });

        test('should handle relative paths correctly', async () => {
            const testFolder = path.join(tempDir, 'test-folder');
            fs.mkdirSync(testFolder);

            await configManager.createLogicalGroup('Test Group');
            await configManager.addToLogicalGroup('Test Group', 'test-folder', 'Relative Path', 'folder');

            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 1);
        });
    });

    suite('File Watching', () => {
        test('should create file watcher', () => {
            let callbackInvoked = false;
            const watcher = configManager.watchConfigFile(() => {
                callbackInvoked = true;
            });

            assert.ok(watcher);
            assert.ok(typeof watcher.dispose === 'function');
            watcher.dispose();
        });

        test('should dispose existing watcher when creating new one', () => {
            const watcher1 = configManager.watchConfigFile(() => { });
            const watcher2 = configManager.watchConfigFile(() => { });

            assert.ok(watcher1);
            assert.ok(watcher2);
            watcher2.dispose();
        });

        test('should dispose watcher on cleanup', () => {
            const watcher = configManager.watchConfigFile(() => { });
            assert.ok(watcher);

            configManager.dispose();
            // Should not throw
            assert.ok(true);
        });
    });

    suite('Path Utilities', () => {
        test('should return correct configuration file path', () => {
            const configPath = configManager.getConfigPath();
            assert.strictEqual(path.basename(configPath), 'shortcuts.yaml');
            assert.ok(configPath.includes('.vscode'));
        });
    });

    suite('Error Handling', () => {
        test('should handle corrupted configuration gracefully', async () => {
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });

            const configPath = path.join(vscodePath, 'shortcuts.yaml');
            fs.writeFileSync(configPath, 'completely invalid: yaml: content: [[[[');

            const config = await configManager.loadConfiguration();
            assert.deepStrictEqual(config, DEFAULT_SHORTCUTS_CONFIG);
        });

        test('should skip invalid group entries', async () => {
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });

            const testFolder = path.join(tempDir, 'test-folder');
            fs.mkdirSync(testFolder);

            const configPath = path.join(vscodePath, 'shortcuts.yaml');
            fs.writeFileSync(configPath, `logicalGroups:
  - name: Valid Group
    items:
      - path: test-folder
        name: Valid Item
        type: folder
  - invalid: group
  - name: 123`);

            const config = await configManager.loadConfiguration();
            // Should only have valid groups
            assert.strictEqual(config.logicalGroups.length, 1);
            assert.strictEqual(config.logicalGroups[0].name, 'Valid Group');
        });
    });
});
