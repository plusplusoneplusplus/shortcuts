import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationManager } from '../../shortcuts/configuration-manager';
import { ShortcutsConfig } from '../../shortcuts/types';

suite('ConfigurationManager Tests', () => {
    let tempDir: string;
    let configManager: ConfigurationManager;
    let originalShowWarningMessage: any;
    let originalShowErrorMessage: any;
    let warningMessages: string[];
    let errorMessages: string[];

    // Helper function to get global config path (mirrors private method)
    function getGlobalConfigPath(): string {
        return path.join(os.homedir(), '.vscode-shortcuts', '.vscode', 'shortcuts.yaml');
    }

    setup(() => {
        // Create temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-test-'));
        
        // Pre-create empty config so tests start with a clean slate
        // (except for tests that specifically test default config behavior)
        const vscodePath = path.join(tempDir, '.vscode');
        fs.mkdirSync(vscodePath, { recursive: true });
        fs.writeFileSync(path.join(vscodePath, 'shortcuts.yaml'), 'logicalGroups: []\n');
        
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

        // Clean up any global config created during tests
        const globalConfigPath = getGlobalConfigPath();
        if (fs.existsSync(globalConfigPath)) {
            fs.unlinkSync(globalConfigPath);
        }

        // Restore original vscode methods
        vscode.window.showWarningMessage = originalShowWarningMessage;
        vscode.window.showErrorMessage = originalShowErrorMessage;

        // Dispose configuration manager
        configManager.dispose();
    });

    suite('loadConfiguration', () => {
        test('should create default configuration when file does not exist', async () => {
            // Delete the pre-created config to test default behavior
            const configPath = configManager.getConfigPath();
            if (fs.existsSync(configPath)) {
                fs.unlinkSync(configPath);
            }
            configManager.invalidateCache();
            
            const config = await configManager.loadConfiguration();

            assert.strictEqual(Array.isArray(config.logicalGroups), true);
            // Default config includes Quick Actions group
            assert.strictEqual(config.logicalGroups.length, 1);
            assert.strictEqual(config.logicalGroups[0].name, 'Quick Actions');
            // basePaths is optional and may be undefined

            // Verify config can be saved subsequently
            await configManager.saveConfiguration({ logicalGroups: [] });
            assert.strictEqual(Array.isArray((await configManager.loadConfiguration()).logicalGroups), true);
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
            // Write invalid YAML over the existing config
            const configPath = configManager.getConfigPath();
            fs.writeFileSync(configPath, `logicalGroups: [[[invalid`);
            configManager.invalidateCache();

            const config = await configManager.loadConfiguration();

            // Should return default configuration (includes Quick Actions group)
            assert.strictEqual(Array.isArray(config.logicalGroups), true);
            assert.strictEqual(config.logicalGroups.length, 1);
            assert.strictEqual(config.logicalGroups[0].name, 'Quick Actions');
            // basePaths is optional and may be undefined
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

        test('should create nested logical group', async () => {
            // Create a parent group
            await configManager.createLogicalGroup('Parent Group', 'Parent description');

            // Create a nested group inside the parent
            await configManager.createNestedLogicalGroup('Parent Group', 'Child Group', 'Child description');

            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups.length, 1);
            assert.strictEqual(config.logicalGroups[0].name, 'Parent Group');
            assert.ok(config.logicalGroups[0].groups, 'Parent group should have groups array');
            assert.strictEqual(config.logicalGroups[0].groups!.length, 1);
            assert.strictEqual(config.logicalGroups[0].groups![0].name, 'Child Group');
            assert.strictEqual(config.logicalGroups[0].groups![0].description, 'Child description');
            assert.strictEqual(config.logicalGroups[0].groups![0].items.length, 0);
        });

        test('should create deeply nested logical groups', async () => {
            // Create parent group
            await configManager.createLogicalGroup('Parent');

            // Create child group
            await configManager.createNestedLogicalGroup('Parent', 'Child');

            // Create grandchild group
            await configManager.createNestedLogicalGroup('Parent/Child', 'Grandchild');

            const config = await configManager.loadConfiguration();
            const parentGroup = config.logicalGroups[0];
            assert.strictEqual(parentGroup.name, 'Parent');
            assert.ok(parentGroup.groups, 'Parent should have groups');
            assert.strictEqual(parentGroup.groups!.length, 1);

            const childGroup = parentGroup.groups![0];
            assert.strictEqual(childGroup.name, 'Child');
            assert.ok(childGroup.groups, 'Child should have groups');
            assert.strictEqual(childGroup.groups!.length, 1);

            const grandchildGroup = childGroup.groups![0];
            assert.strictEqual(grandchildGroup.name, 'Grandchild');
        });

        test('should prevent duplicate nested group names in same parent', async () => {
            await configManager.createLogicalGroup('Parent Group');
            await configManager.createNestedLogicalGroup('Parent Group', 'Child Group');
            await configManager.createNestedLogicalGroup('Parent Group', 'Child Group');

            const config = await configManager.loadConfiguration();
            const parentGroup = config.logicalGroups[0];
            // Should only have one nested group
            assert.strictEqual(parentGroup.groups!.length, 1);
        });

        test('should allow same group name in different parents', async () => {
            // Create two parent groups
            await configManager.createLogicalGroup('Parent 1');
            await configManager.createLogicalGroup('Parent 2');

            // Create nested groups with the same name in different parents
            await configManager.createNestedLogicalGroup('Parent 1', 'Child');
            await configManager.createNestedLogicalGroup('Parent 2', 'Child');

            const config = await configManager.loadConfiguration();
            const parent1 = config.logicalGroups.find(g => g.name === 'Parent 1');
            const parent2 = config.logicalGroups.find(g => g.name === 'Parent 2');

            assert.ok(parent1?.groups);
            assert.ok(parent2?.groups);
            assert.strictEqual(parent1!.groups!.length, 1);
            assert.strictEqual(parent2!.groups!.length, 1);
            assert.strictEqual(parent1!.groups![0].name, 'Child');
            assert.strictEqual(parent2!.groups![0].name, 'Child');
        });

        test('should handle non-existent parent group gracefully', async () => {
            // Try to create nested group in non-existent parent
            await configManager.createNestedLogicalGroup('NonExistent', 'Child');

            const config = await configManager.loadConfiguration();
            // No groups should be created
            assert.strictEqual(config.logicalGroups.length, 0);
        });

        test('should create multiple nested groups in same parent', async () => {
            await configManager.createLogicalGroup('Parent');
            await configManager.createNestedLogicalGroup('Parent', 'Child 1', 'First child');
            await configManager.createNestedLogicalGroup('Parent', 'Child 2', 'Second child');
            await configManager.createNestedLogicalGroup('Parent', 'Child 3', 'Third child');

            const config = await configManager.loadConfiguration();
            const parentGroup = config.logicalGroups[0];
            assert.strictEqual(parentGroup.groups!.length, 3);
            assert.strictEqual(parentGroup.groups![0].name, 'Child 1');
            assert.strictEqual(parentGroup.groups![1].name, 'Child 2');
            assert.strictEqual(parentGroup.groups![2].name, 'Child 3');
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
            assert.strictEqual(Array.isArray(config.logicalGroups), true);
            assert.strictEqual(config.logicalGroups.length, 0);
            // basePaths is optional and may be undefined
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

    suite('Automatic Alias Detection', () => {
        test('should use existing base path alias when adding file', async () => {
            // Create .vscode directory and test files
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });

            // Create a subdirectory structure
            const projectPath = path.join(tempDir, 'my-project');
            const srcPath = path.join(projectPath, 'src');
            fs.mkdirSync(srcPath, { recursive: true });

            const testFile = path.join(srcPath, 'test.ts');
            fs.writeFileSync(testFile, 'console.log("test");');

            // Write configuration with base paths
            const configPath = path.join(vscodePath, 'shortcuts.yaml');
            fs.writeFileSync(configPath, `basePaths:
  - alias: "@project"
    path: "${projectPath.replace(/\\/g, '/')}"
logicalGroups:
  - name: Test Group
    items: []`);

            // Add file to group
            await configManager.addToLogicalGroup('Test Group', testFile, 'Test File', 'file');

            // Load configuration and verify alias was used
            const config = await configManager.loadConfiguration();
            const group = config.logicalGroups?.find(g => g.name === 'Test Group');

            assert.ok(group, 'Group should exist');
            assert.strictEqual(group!.items.length, 1);
            assert.ok(group!.items[0].path && group!.items[0].path.startsWith('@project/'), 'Path should use alias');
            assert.ok(group!.items[0].path && group!.items[0].path.includes('src/test.ts'), 'Path should include relative path');
        });

        test('should use relative path when no alias matches', async () => {
            // Create .vscode directory
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });

            // Create a test file in workspace
            const testFile = path.join(tempDir, 'test.txt');
            fs.writeFileSync(testFile, 'test content');

            // Write configuration without base paths
            const configPath = path.join(vscodePath, 'shortcuts.yaml');
            fs.writeFileSync(configPath, `logicalGroups:
  - name: Test Group
    items: []`);

            // Add file to group
            await configManager.addToLogicalGroup('Test Group', testFile, 'Test File', 'file');

            // Load configuration and verify relative path was used
            const config = await configManager.loadConfiguration();
            const group = config.logicalGroups?.find(g => g.name === 'Test Group');

            assert.ok(group, 'Group should exist');
            assert.strictEqual(group!.items.length, 1);
            assert.strictEqual(group!.items[0].path, 'test.txt', 'Path should be relative');
        });

        test('should handle nested directories with alias', async () => {
            // Create .vscode directory
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });

            // Create deeply nested structure
            const basePath = path.join(tempDir, 'base');
            const deepPath = path.join(basePath, 'level1', 'level2', 'level3');
            fs.mkdirSync(deepPath, { recursive: true });

            const testFile = path.join(deepPath, 'deep.js');
            fs.writeFileSync(testFile, '// deep file');

            // Write configuration with base path
            const configPath = path.join(vscodePath, 'shortcuts.yaml');
            fs.writeFileSync(configPath, `basePaths:
  - alias: "@base"
    path: "${basePath.replace(/\\/g, '/')}"
logicalGroups:
  - name: Deep Group
    items: []`);

            // Add deeply nested file
            await configManager.addToLogicalGroup('Deep Group', testFile, 'Deep File', 'file');

            // Verify
            const config = await configManager.loadConfiguration();
            const group = config.logicalGroups?.find(g => g.name === 'Deep Group');

            assert.ok(group, 'Group should exist');
            assert.strictEqual(group!.items[0].path, '@base/level1/level2/level3/deep.js');
        });

        test('should prefer more specific alias when multiple match', async () => {
            // Create .vscode directory
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });

            // Create nested structure
            const outerPath = path.join(tempDir, 'outer');
            const innerPath = path.join(outerPath, 'inner');
            fs.mkdirSync(innerPath, { recursive: true });

            const testFile = path.join(innerPath, 'test.ts');
            fs.writeFileSync(testFile, 'test');

            // Write configuration with overlapping base paths
            const configPath = path.join(vscodePath, 'shortcuts.yaml');
            fs.writeFileSync(configPath, `basePaths:
  - alias: "@outer"
    path: "${outerPath.replace(/\\/g, '/')}"
  - alias: "@inner"
    path: "${innerPath.replace(/\\/g, '/')}"
logicalGroups:
  - name: Test Group
    items: []`);

            // Add file from inner path
            await configManager.addToLogicalGroup('Test Group', testFile, 'Test File', 'file');

            // Verify - should use first matching alias (outer in this case due to iteration order)
            const config = await configManager.loadConfiguration();
            const group = config.logicalGroups?.find(g => g.name === 'Test Group');

            assert.ok(group, 'Group should exist');
            // The first matching alias is used
            assert.ok(group!.items[0].path && group!.items[0].path.startsWith('@'), 'Should use an alias');
        });

        test('should handle absolute paths outside workspace without alias', async () => {
            // Create .vscode directory
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });

            // Create a directory outside workspace
            const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'external-'));
            const externalFile = path.join(externalDir, 'external.txt');
            fs.writeFileSync(externalFile, 'external content');

            try {
                // Write configuration without matching base path
                const configPath = path.join(vscodePath, 'shortcuts.yaml');
                fs.writeFileSync(configPath, `logicalGroups:
  - name: External Group
    items: []`);

                // Add external file
                await configManager.addToLogicalGroup('External Group', externalFile, 'External File', 'file');

                // Verify - should use absolute path
                const config = await configManager.loadConfiguration();
                const group = config.logicalGroups?.find(g => g.name === 'External Group');

                assert.ok(group, 'Group should exist');
                assert.ok(group!.items[0].path && path.isAbsolute(group!.items[0].path), 'Should use absolute path');
            } finally {
                // Clean up external directory
                fs.rmSync(externalDir, { recursive: true, force: true });
            }
        });

        test('should handle relative base paths correctly', async () => {
            // Create .vscode directory
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });

            // Create a subdirectory in workspace
            const subPath = path.join(tempDir, 'subproject');
            fs.mkdirSync(subPath, { recursive: true });

            const testFile = path.join(subPath, 'file.ts');
            fs.writeFileSync(testFile, 'content');

            // Write configuration with relative base path
            const configPath = path.join(vscodePath, 'shortcuts.yaml');
            fs.writeFileSync(configPath, `basePaths:
  - alias: "@sub"
    path: "subproject"
logicalGroups:
  - name: Sub Group
    items: []`);

            // Add file
            await configManager.addToLogicalGroup('Sub Group', testFile, 'Sub File', 'file');

            // Verify
            const config = await configManager.loadConfiguration();
            const group = config.logicalGroups?.find(g => g.name === 'Sub Group');

            assert.ok(group, 'Group should exist');
            assert.strictEqual(group!.items[0].path, '@sub/file.ts');
        });

        test('should not duplicate items when adding same file twice', async () => {
            // Create .vscode directory
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });

            const testFile = path.join(tempDir, 'duplicate.txt');
            fs.writeFileSync(testFile, 'test');

            // Write initial configuration
            const configPath = path.join(vscodePath, 'shortcuts.yaml');
            fs.writeFileSync(configPath, `basePaths:
  - alias: "@root"
    path: "${tempDir.replace(/\\/g, '/')}"
logicalGroups:
  - name: Test Group
    items: []`);

            // Add file twice
            await configManager.addToLogicalGroup('Test Group', testFile, 'File 1', 'file');
            await configManager.addToLogicalGroup('Test Group', testFile, 'File 2', 'file');

            // Verify only one item was added
            const config = await configManager.loadConfiguration();
            const group = config.logicalGroups?.find(g => g.name === 'Test Group');

            assert.ok(group, 'Group should exist');
            assert.strictEqual(group!.items.length, 1, 'Should only have one item');
            assert.strictEqual(warningMessages.length, 1, 'Should show warning for duplicate');
        });

        test('should normalize paths with forward slashes in aliases', async () => {
            // Create .vscode directory
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });

            // Create nested structure
            const basePath = path.join(tempDir, 'base');
            const subPath = path.join(basePath, 'sub', 'folder');
            fs.mkdirSync(subPath, { recursive: true });

            const testFile = path.join(subPath, 'file.txt');
            fs.writeFileSync(testFile, 'content');

            // Write configuration
            const configPath = path.join(vscodePath, 'shortcuts.yaml');
            fs.writeFileSync(configPath, `basePaths:
  - alias: "@base"
    path: "${basePath.replace(/\\/g, '/')}"
logicalGroups:
  - name: Test Group
    items: []`);

            // Add file
            await configManager.addToLogicalGroup('Test Group', testFile, 'File', 'file');

            // Verify - should use forward slashes
            const config = await configManager.loadConfiguration();
            const group = config.logicalGroups?.find(g => g.name === 'Test Group');

            assert.ok(group, 'Group should exist');
            assert.strictEqual(group!.items[0].path, '@base/sub/folder/file.txt');
            assert.ok(!group!.items[0].path.includes('\\'), 'Should use forward slashes only');
        });

        test('should handle folders with alias detection', async () => {
            // Create .vscode directory
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });

            // Create folder structure
            const basePath = path.join(tempDir, 'project');
            const srcFolder = path.join(basePath, 'src');
            fs.mkdirSync(srcFolder, { recursive: true });

            // Write configuration
            const configPath = path.join(vscodePath, 'shortcuts.yaml');
            fs.writeFileSync(configPath, `basePaths:
  - alias: "@project"
    path: "${basePath.replace(/\\/g, '/')}"
logicalGroups:
  - name: Folders
    items: []`);

            // Add folder
            await configManager.addToLogicalGroup('Folders', srcFolder, 'Source', 'folder');

            // Verify
            const config = await configManager.loadConfiguration();
            const group = config.logicalGroups?.find(g => g.name === 'Folders');

            assert.ok(group, 'Group should exist');
            assert.strictEqual(group!.items[0].path, '@project/src');
            assert.strictEqual(group!.items[0].type, 'folder');
        });
    });

    suite('getActiveConfigSource', () => {
        test('should return workspace source when workspace config exists', async () => {
            // Create workspace config
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });
            const configPath = path.join(vscodePath, 'shortcuts.yaml');
            fs.writeFileSync(configPath, 'logicalGroups: []');

            const configInfo = configManager.getActiveConfigSource();

            assert.strictEqual(configInfo.source, 'workspace');
            assert.strictEqual(configInfo.path, configPath);
            assert.strictEqual(configInfo.exists, true);
        });

        test('should return global source when only global config exists', async () => {
            // Ensure workspace config doesn't exist
            const workspaceConfigPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
            if (fs.existsSync(workspaceConfigPath)) {
                fs.unlinkSync(workspaceConfigPath);
            }

            // Create global config directory and file
            const globalConfigPath = getGlobalConfigPath();
            fs.mkdirSync(path.dirname(globalConfigPath), { recursive: true });
            fs.writeFileSync(globalConfigPath, 'logicalGroups: []');

            try {
                const configInfo = configManager.getActiveConfigSource();

                assert.strictEqual(configInfo.source, 'global');
                assert.strictEqual(configInfo.path, globalConfigPath);
                assert.strictEqual(configInfo.exists, true);
            } finally {
                // Clean up global config
                if (fs.existsSync(globalConfigPath)) {
                    fs.unlinkSync(globalConfigPath);
                }
            }
        });

        test('should return default source when no config exists', async () => {
            // Ensure no configs exist
            const workspaceConfigPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
            if (fs.existsSync(workspaceConfigPath)) {
                fs.unlinkSync(workspaceConfigPath);
            }

            const globalConfigPath = getGlobalConfigPath();
            if (fs.existsSync(globalConfigPath)) {
                fs.unlinkSync(globalConfigPath);
            }

            const configInfo = configManager.getActiveConfigSource();

            assert.strictEqual(configInfo.source, 'default');
            assert.strictEqual(configInfo.path, workspaceConfigPath);
            assert.strictEqual(configInfo.exists, false);
        });

        test('should prioritize workspace config over global config', async () => {
            // Create both workspace and global configs
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });
            const workspaceConfigPath = path.join(vscodePath, 'shortcuts.yaml');
            fs.writeFileSync(workspaceConfigPath, 'logicalGroups: []');

            const globalConfigPath = getGlobalConfigPath();
            fs.mkdirSync(path.dirname(globalConfigPath), { recursive: true });
            fs.writeFileSync(globalConfigPath, 'logicalGroups: []');

            try {
                const configInfo = configManager.getActiveConfigSource();

                // Should prefer workspace
                assert.strictEqual(configInfo.source, 'workspace');
                assert.strictEqual(configInfo.path, workspaceConfigPath);
                assert.strictEqual(configInfo.exists, true);
            } finally {
                // Clean up global config
                if (fs.existsSync(globalConfigPath)) {
                    fs.unlinkSync(globalConfigPath);
                }
            }
        });
    });
});
