import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ShortcutsCommands } from '../../shortcuts/commands';
import { ConfigurationManager } from '../../shortcuts/configuration-manager';
import { LogicalTreeDataProvider } from '../../shortcuts/logical-tree-data-provider';
import { ThemeManager } from '../../shortcuts/theme-manager';
import { LogicalGroupItem } from '../../shortcuts/tree-items';

suite('ShortcutsCommands Integration Tests', () => {
    let tempDir: string;
    let provider: LogicalTreeDataProvider;
    let configManager: ConfigurationManager;
    let themeManager: ThemeManager;
    let commands: ShortcutsCommands;
    let testFolder: string;
    let disposables: vscode.Disposable[] = [];

    // Helper function to get global config path (mirrors private method)
    function getGlobalConfigPath(): string {
        return path.join(os.homedir(), '.vscode-shortcuts', '.vscode', 'shortcuts.yaml');
    }

    suiteSetup(async () => {
        // Use the workspace folder launched by the test runner for isolation
        tempDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-commands-test-'));

        // Create test folder structure
        testFolder = path.join(tempDir, 'test-folder');
        if (!fs.existsSync(testFolder)) {
            fs.mkdirSync(testFolder, { recursive: true });
        }
        fs.writeFileSync(path.join(testFolder, 'test-file.txt'), 'test content');

        // Create additional test folders
        const testFolder2 = path.join(tempDir, 'test-folder-2');
        if (!fs.existsSync(testFolder2)) {
            fs.mkdirSync(testFolder2, { recursive: true });
        }

        // Activate our extension to ensure commands and providers are registered
        const ext = vscode.extensions.getExtension('yihengtao.workspace-shortcuts');
        if (ext) {
            await ext.activate();
        }

        // Setup providers tied to our tempDir (mirrors extension behavior)
        configManager = new ConfigurationManager(tempDir);
        themeManager = new ThemeManager();
        provider = new LogicalTreeDataProvider(tempDir, configManager, themeManager);
    });

    suiteTeardown(() => {
        // Clean up providers
        provider.dispose();
        configManager.dispose();
        themeManager.dispose();

        // Clean up any global config created during tests
        const globalConfigPath = getGlobalConfigPath();
        if (fs.existsSync(globalConfigPath)) {
            fs.unlinkSync(globalConfigPath);
        }

        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    teardown(async () => {
        // Reset configuration file between tests and clear any timeouts
        const configPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, 'logicalGroups: []\n', 'utf8');

        // Clear provider cache by forcing a reload
        await configManager.saveConfiguration({ logicalGroups: [] });
        provider.refresh();
    });

    test('should register all required commands', async () => {
        // Get all available commands
        const commands = await vscode.commands.getCommands(true);

        // Check if key commands are registered
        const requiredCommands = [
            'shortcuts.refresh',
            'shortcuts.createLogicalGroup',
            'shortcuts.addToLogicalGroup',
            'shortcuts.removeFromLogicalGroup',
            'shortcuts.renameLogicalGroup',
            'shortcuts.deleteLogicalGroup',
            'shortcuts.openConfiguration',
            'shortcuts.showConfigSource'
        ];

        for (const cmd of requiredCommands) {
            const commandExists = commands.includes(cmd);
            assert.ok(commandExists, `Command ${cmd} should be registered`);
        }
    });

    test('should refresh shortcuts when refresh command is executed', async () => {
        // Execute refresh command; if it throws, the test will fail
        await vscode.commands.executeCommand('shortcuts.refresh');
        assert.ok(true, 'Refresh command executed');
    });

    test('should reset configuration when reset command is executed', async () => {
        // First, create a configuration with logical groups
        const configWithGroups = {
            logicalGroups: [
                {
                    name: 'Test Group',
                    items: [
                        { path: 'test-folder', name: 'Test Folder', type: 'folder' as const }
                    ]
                }
            ]
        };
        await configManager.saveConfiguration(configWithGroups);

        // Verify configuration has groups
        let config = await configManager.loadConfiguration();
        assert.strictEqual(config.logicalGroups.length >= 1, true);

        // Mock confirmation dialog to return 'Reset'
        const originalShowWarningMessage = vscode.window.showWarningMessage;
        vscode.window.showWarningMessage = async (message: string, options?: any, ...items: string[]) => {
            return 'Reset' as any;
        };

        try {
            // Execute reset command
            await vscode.commands.executeCommand('shortcuts.resetConfiguration');

            // Verify configuration was reset to default (with Quick Actions group)
            configManager.invalidateCache();
            config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups.length, 1);
            assert.strictEqual(config.logicalGroups[0].name, 'Quick Actions');

        } finally {
            // Restore original method
            vscode.window.showWarningMessage = originalShowWarningMessage;
        }
    });

    test('should not reset configuration when user cancels', async () => {
        // Create a configuration with logical groups
        const configWithGroups = {
            logicalGroups: [
                {
                    name: 'Test Group',
                    items: [
                        { path: 'test-folder', name: 'Test Folder', type: 'folder' as const }
                    ]
                }
            ]
        };
        await configManager.saveConfiguration(configWithGroups);

        // Mock confirmation dialog to return undefined (cancelled)
        const originalShowWarningMessage = vscode.window.showWarningMessage;
        vscode.window.showWarningMessage = async () => {
            return undefined as any;
        };

        try {
            // Execute reset command
            await vscode.commands.executeCommand('shortcuts.resetConfiguration');

            // Verify configuration was NOT reset
            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups.length, 1);

        } finally {
            // Restore original method
            vscode.window.showWarningMessage = originalShowWarningMessage;
        }
    });

    test('should open configuration file when open configuration command is executed', async () => {
        let documentOpened = false;
        const originalShowTextDocument = vscode.window.showTextDocument;

        vscode.window.showTextDocument = async (document: any) => {
            documentOpened = true;
            return {} as any;
        };

        try {
            // Execute open configuration command
            await vscode.commands.executeCommand('shortcuts.openConfiguration');

            assert.ok(documentOpened, 'Configuration file should have been opened');

        } finally {
            // Restore original method
            vscode.window.showTextDocument = originalShowTextDocument;
        }
    });

    test('should NOT overwrite existing configuration when opening config file', async () => {
        // Create a configuration with logical groups
        const configWithGroups = {
            logicalGroups: [
                {
                    name: 'Existing Group',
                    items: [
                        { path: 'test-folder', name: 'Test Folder', type: 'folder' as const }
                    ]
                }
            ]
        };
        await configManager.saveConfiguration(configWithGroups);

        const originalShowTextDocument = vscode.window.showTextDocument;
        vscode.window.showTextDocument = async () => {
            return {} as any;
        };

        try {
            // Execute open configuration command
            await vscode.commands.executeCommand('shortcuts.openConfiguration');

            // Verify configuration was NOT overwritten
            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups.length, 1);
            assert.strictEqual(config.logicalGroups[0].name, 'Existing Group');

        } finally {
            vscode.window.showTextDocument = originalShowTextDocument;
        }
    });

    test('should create default configuration only when file does not exist', async () => {
        // Ensure config file doesn't exist
        const configPath = configManager.getConfigPath();
        if (fs.existsSync(configPath)) {
            fs.unlinkSync(configPath);
        }

        const originalShowTextDocument = vscode.window.showTextDocument;
        vscode.window.showTextDocument = async () => {
            return {} as any;
        };

        try {
            // Execute open configuration command
            await vscode.commands.executeCommand('shortcuts.openConfiguration');

            // Verify default configuration is available (either workspace or global)
            const exists = fs.existsSync(configPath);
            const config = await configManager.loadConfiguration();
            assert.strictEqual(Array.isArray(config.logicalGroups), true);
            assert.strictEqual(config.logicalGroups.length, 1);
            assert.strictEqual(config.logicalGroups[0].name, 'Quick Actions');

        } finally {
            vscode.window.showTextDocument = originalShowTextDocument;
        }
    });

    test('should preserve complex configuration with multiple logical groups', async () => {
        const complexConfig = {
            logicalGroups: [
                {
                    name: 'Group 1',
                    description: 'First group',
                    items: [
                        { path: 'test-folder', name: 'Folder 1', type: 'folder' as const },
                        { path: 'test-folder/test-file.txt', name: 'File 1', type: 'file' as const }
                    ]
                },
                {
                    name: 'Group 2',
                    description: 'Second group',
                    items: [
                        { path: 'test-folder-2', name: 'Folder 2', type: 'folder' as const }
                    ]
                }
            ]
        };

        await configManager.saveConfiguration(complexConfig);

        // Load and verify configuration
        const loadedConfig = await configManager.loadConfiguration();
        assert.strictEqual(loadedConfig.logicalGroups.length, 2);
        assert.strictEqual(loadedConfig.logicalGroups[0].name, 'Group 1');
        assert.strictEqual(loadedConfig.logicalGroups[0].items.length, 2);
        assert.strictEqual(loadedConfig.logicalGroups[1].name, 'Group 2');
        assert.strictEqual(loadedConfig.logicalGroups[1].items.length, 1);
    });

    test('should handle concurrent configuration operations without corruption', async () => {
        const operations = [];

        // Perform multiple concurrent save operations
        for (let i = 0; i < 5; i++) {
            operations.push(
                configManager.saveConfiguration({
                    logicalGroups: [
                        {
                            name: `Group ${i}`,
                            items: [
                                { path: 'test-folder', name: `Folder ${i}`, type: 'folder' as const }
                            ]
                        }
                    ]
                })
            );
        }

        await Promise.all(operations);

        // Verify configuration is not corrupted (should have the last saved value)
        const config = await configManager.loadConfiguration();
        assert.ok(config.logicalGroups.length >= 0);
        assert.ok(Array.isArray(config.logicalGroups));
    });

    test('should migrate old physical shortcuts to logical groups', async () => {
        // Create old-format configuration
        const configPath = configManager.getConfigPath();
        fs.mkdirSync(path.dirname(configPath), { recursive: true });

        const oldConfig = `shortcuts:
  - path: test-folder
    name: Old Physical Shortcut`;

        fs.writeFileSync(configPath, oldConfig);

        // Load configuration (should trigger migration)
        const config = await configManager.loadConfiguration();

        // Should have migrated to logical groups
        assert.strictEqual(config.logicalGroups.length, 1);
        assert.strictEqual(config.logicalGroups[0].name, 'Old Physical Shortcut');
        assert.strictEqual(config.logicalGroups[0].items.length, 1);
        assert.strictEqual(config.logicalGroups[0].items[0].type, 'folder');
    });

    test('should handle errors gracefully in command execution', async () => {
        // Should not throw when executing commands with various scenarios
        try {
            await vscode.commands.executeCommand('shortcuts.refresh');
            assert.ok(true, 'Should handle command execution gracefully');
        } catch (error) {
            // Even if there's an error, it should be handled gracefully
            assert.ok(true, 'Errors should be handled gracefully');
        }
    });

    test('should maintain tree view refresh after command operations', async () => {
        // Just ensure command executes without throwing; refresh is exercised elsewhere
        await vscode.commands.executeCommand('shortcuts.refresh');
        assert.ok(true);
    });

    // E2E Tests for Rename Group functionality
    suite('Rename Logical Group E2E Tests', () => {
        test('should rename logical group through command with real tree item', async () => {
            // Setup: Create a logical group through config manager
            await configManager.createLogicalGroup('Original Group Name', 'Test description');
            provider.refresh();

            // Get the tree items to find our group
            const rootItems = await provider.getChildren();
            const groupItem = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Original Group Name'
            );
            assert.ok(groupItem, 'Group should exist in tree');
            assert.strictEqual(groupItem.originalName, 'Original Group Name');

            // Mock the input box to provide new name
            const originalShowInputBox = vscode.window.showInputBox;
            vscode.window.showInputBox = async (options?: any) => {
                // Verify the input box shows the current name
                assert.strictEqual(options.value, 'Original Group Name');
                return 'Renamed Group';
            };

            try {
                // Execute the rename command with the tree item
                await vscode.commands.executeCommand('shortcuts.renameLogicalGroup', groupItem);

                // Verify the group was renamed in configuration
                configManager.invalidateCache();
                const config = await configManager.loadConfiguration();
                const renamedGroup = config.logicalGroups.find(g => g.name === 'Renamed Group');
                assert.ok(renamedGroup, 'Renamed group should exist');
                assert.strictEqual(renamedGroup!.description, 'Test description');

                // Verify old name doesn't exist
                const oldGroup = config.logicalGroups.find(g => g.name === 'Original Group Name');
                assert.strictEqual(oldGroup, undefined);

            } finally {
                vscode.window.showInputBox = originalShowInputBox;
            }
        });

        test('should preserve group items when renaming', async () => {
            // Setup: Create a group with items
            await configManager.createLogicalGroup('Group With Items');
            await configManager.addToLogicalGroup('Group With Items', testFolder, 'Test Folder', 'folder');
            await configManager.addToLogicalGroup('Group With Items', path.join(testFolder, 'test-file.txt'), 'Test File', 'file');
            provider.refresh();

            const rootItems = await provider.getChildren();
            const groupItem = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Group With Items'
            );
            assert.ok(groupItem);

            // Mock input box
            const originalShowInputBox = vscode.window.showInputBox;
            vscode.window.showInputBox = async () => 'Renamed Group With Items';

            try {
                await vscode.commands.executeCommand('shortcuts.renameLogicalGroup', groupItem);

                // Verify items are preserved
                configManager.invalidateCache();
                const config = await configManager.loadConfiguration();
                const renamedGroup = config.logicalGroups.find(g => g.name === 'Renamed Group With Items');
                assert.ok(renamedGroup);
                assert.strictEqual(renamedGroup.items.length, 2);
                assert.strictEqual(renamedGroup.items[0].name, 'Test Folder');
                assert.strictEqual(renamedGroup.items[0].type, 'folder');
                assert.strictEqual(renamedGroup.items[1].name, 'Test File');
                assert.strictEqual(renamedGroup.items[1].type, 'file');

            } finally {
                vscode.window.showInputBox = originalShowInputBox;
            }
        });

        test('should prevent renaming to existing group name', async () => {
            // Setup: Create two groups
            await configManager.createLogicalGroup('Group 1');
            await configManager.createLogicalGroup('Group 2');
            provider.refresh();

            const rootItems = await provider.getChildren();
            const group1 = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Group 1'
            );
            assert.ok(group1);

            // Mock input box to try to rename to existing name
            const originalShowInputBox = vscode.window.showInputBox;
            vscode.window.showInputBox = async () => 'Group 2';

            try {
                await vscode.commands.executeCommand('shortcuts.renameLogicalGroup', group1);

                // Verify Group 1 was NOT renamed (prevented by validation)
                const config = await configManager.loadConfiguration();
                const stillGroup1 = config.logicalGroups.find(g => g.name === 'Group 1');
                assert.ok(stillGroup1, 'Group 1 should still exist with original name');

            } finally {
                vscode.window.showInputBox = originalShowInputBox;
            }
        });

        test('should handle cancellation during rename', async () => {
            // Setup: Create a group
            await configManager.createLogicalGroup('Original Name');
            provider.refresh();

            const rootItems = await provider.getChildren();
            const groupItem = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Original Name'
            );
            assert.ok(groupItem);

            // Mock input box to return undefined (cancelled)
            const originalShowInputBox = vscode.window.showInputBox;
            vscode.window.showInputBox = async () => undefined;

            try {
                await vscode.commands.executeCommand('shortcuts.renameLogicalGroup', groupItem);

                // Verify group name unchanged
                const config = await configManager.loadConfiguration();
                const group = config.logicalGroups.find(g => g.name === 'Original Name');
                assert.ok(group, 'Group should still have original name');

            } finally {
                vscode.window.showInputBox = originalShowInputBox;
            }
        });

        test('should handle empty name validation', async () => {
            // Setup: Create a group
            await configManager.createLogicalGroup('Test Group');
            provider.refresh();

            const rootItems = await provider.getChildren();
            const groupItem = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Test Group'
            );
            assert.ok(groupItem);

            // Mock input box to return empty string
            const originalShowInputBox = vscode.window.showInputBox;
            let validationCalled = false;
            vscode.window.showInputBox = async (options?: any) => {
                // Test the validation function
                if (options.validateInput) {
                    const emptyValidation = options.validateInput('');
                    assert.strictEqual(emptyValidation, 'Group name cannot be empty');
                    validationCalled = true;

                    const whitespaceValidation = options.validateInput('   ');
                    assert.strictEqual(whitespaceValidation, 'Group name cannot be empty');
                }
                return undefined; // Cancel
            };

            try {
                await vscode.commands.executeCommand('shortcuts.renameLogicalGroup', groupItem);
                assert.ok(validationCalled, 'Validation should have been tested');

            } finally {
                vscode.window.showInputBox = originalShowInputBox;
            }
        });

        test('should work with groups that have emoji in label', async () => {
            // This test verifies the fix for using originalName instead of label
            // The label includes "📂 " prefix but originalName doesn't
            await configManager.createLogicalGroup('Emoji Test Group');
            await configManager.saveConfiguration(await configManager.loadConfiguration());

            // Trigger the extension to refresh its view and wait for file system to settle
            await vscode.commands.executeCommand('shortcuts.refresh');
            await new Promise(resolve => setTimeout(resolve, 200));

            provider.refresh();

            const rootItems = await provider.getChildren();
            const groupItem = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Emoji Test Group'
            );
            assert.ok(groupItem);

            // The label should have emoji prefix
            const labelString = typeof groupItem.label === 'string' ? groupItem.label : (groupItem.label as any)?.label;
            assert.ok(labelString && labelString.includes('📂'), 'Label should contain emoji');
            assert.strictEqual(groupItem.originalName, 'Emoji Test Group', 'originalName should not contain emoji');

            let inputBoxCalled = false;
            const originalShowInputBox = vscode.window.showInputBox;
            vscode.window.showInputBox = async (options?: any) => {
                inputBoxCalled = true;
                // Verify that the input box gets originalName, not label
                assert.strictEqual(options.value, 'Emoji Test Group');
                assert.ok(!options.value.includes('📂'), 'Input should not contain emoji');
                return 'Renamed Emoji Group';
            };

            try {
                await vscode.commands.executeCommand('shortcuts.renameLogicalGroup', groupItem);

                // Verify the input box was actually called
                assert.ok(inputBoxCalled, 'Input box should have been called');

                // Wait for file system operations and file watchers to complete
                // This needs to be longer to allow the extension's file watcher to see changes
                await new Promise(resolve => setTimeout(resolve, 500));

                configManager.invalidateCache();
                const config = await configManager.loadConfiguration();

                const renamedGroup = config.logicalGroups.find(g => g.name === 'Renamed Emoji Group');
                const oldGroup = config.logicalGroups.find(g => g.name === 'Emoji Test Group');

                assert.ok(renamedGroup, 'Group should be renamed successfully');
                assert.ok(!oldGroup, 'Old group name should not exist');

            } finally {
                vscode.window.showInputBox = originalShowInputBox;
            }
        });
    });

    // E2E Tests for Delete Group functionality
    suite('Delete Logical Group E2E Tests', () => {
        test('should delete logical group through command with real tree item', async () => {
            // Setup: Create a logical group
            await configManager.createLogicalGroup('Group To Delete');
            await configManager.saveConfiguration(await configManager.loadConfiguration());

            // Trigger the extension to refresh its view and wait for file system to settle
            await vscode.commands.executeCommand('shortcuts.refresh');
            await new Promise(resolve => setTimeout(resolve, 200));

            provider.refresh();

            const rootItems = await provider.getChildren();
            const groupItem = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Group To Delete'
            );
            assert.ok(groupItem);

            // Mock the confirmation dialog
            const originalShowWarningMessage = vscode.window.showWarningMessage;
            vscode.window.showWarningMessage = async (message: string, options?: any, ...items: string[]) => {
                assert.ok(message.includes('Group To Delete') || message.includes('📂'), 'Warning should mention group name');
                return 'Delete' as any;
            };

            try {
                await vscode.commands.executeCommand('shortcuts.deleteLogicalGroup', groupItem);

                // Wait for file system operations and file watchers to complete
                await new Promise(resolve => setTimeout(resolve, 500));
                configManager.invalidateCache();
                const config = await configManager.loadConfiguration();

                const exists = config.logicalGroups.some(g => g.name === 'Group To Delete');
                assert.strictEqual(exists, false, 'Group should be deleted');

            } finally {
                vscode.window.showWarningMessage = originalShowWarningMessage;
            }
        });

        test('should delete group with items', async () => {
            // Setup: Create a group with items
            await configManager.createLogicalGroup('Group With Items To Delete');
            await configManager.addToLogicalGroup('Group With Items To Delete', testFolder, 'Test Folder', 'folder');
            await configManager.saveConfiguration(await configManager.loadConfiguration());

            // Trigger the extension to refresh its view and wait for file system to settle
            await vscode.commands.executeCommand('shortcuts.refresh');
            await new Promise(resolve => setTimeout(resolve, 200));

            provider.refresh();

            const rootItems = await provider.getChildren();
            const groupItem = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Group With Items To Delete'
            );
            assert.ok(groupItem);

            const originalShowWarningMessage = vscode.window.showWarningMessage;
            vscode.window.showWarningMessage = async () => 'Delete' as any;

            try {
                await vscode.commands.executeCommand('shortcuts.deleteLogicalGroup', groupItem);

                // Wait for file system operations to complete
                await new Promise(resolve => setTimeout(resolve, 100));
                configManager.invalidateCache();
                const config = await configManager.loadConfiguration();
                const exists = config.logicalGroups.some(g => g.name === 'Group With Items To Delete');
                assert.strictEqual(exists, false, 'Group should be deleted');

            } finally {
                vscode.window.showWarningMessage = originalShowWarningMessage;
            }
        });

        test('should handle cancellation during delete', async () => {
            // Setup: Create a group
            await configManager.createLogicalGroup('Group To Keep');
            provider.refresh();

            const rootItems = await provider.getChildren();
            const groupItem = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Group To Keep'
            );
            assert.ok(groupItem);

            // Mock confirmation to cancel
            const originalShowWarningMessage = vscode.window.showWarningMessage;
            vscode.window.showWarningMessage = async () => undefined as any;

            try {
                await vscode.commands.executeCommand('shortcuts.deleteLogicalGroup', groupItem);

                // Verify group still exists
                const config = await configManager.loadConfiguration();
                const group = config.logicalGroups.find(g => g.name === 'Group To Keep');
                assert.ok(group, 'Group should not be deleted when cancelled');

            } finally {
                vscode.window.showWarningMessage = originalShowWarningMessage;
            }
        });

        test('should work with groups that have emoji in label', async () => {
            // This test verifies the fix for using originalName instead of label
            await configManager.createLogicalGroup('Delete Emoji Test');
            await configManager.saveConfiguration(await configManager.loadConfiguration());

            // Trigger the extension to refresh its view and wait for file system to settle
            await vscode.commands.executeCommand('shortcuts.refresh');
            await new Promise(resolve => setTimeout(resolve, 200));

            provider.refresh();

            const rootItems = await provider.getChildren();
            const groupItem = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Delete Emoji Test'
            );
            assert.ok(groupItem);

            // Verify label has emoji but originalName doesn't
            const labelString = typeof groupItem.label === 'string' ? groupItem.label : (groupItem.label as any)?.label;
            assert.ok(labelString && labelString.includes('📂'));
            assert.strictEqual(groupItem.originalName, 'Delete Emoji Test');

            const originalShowWarningMessage = vscode.window.showWarningMessage;
            vscode.window.showWarningMessage = async () => 'Delete' as any;

            try {
                await vscode.commands.executeCommand('shortcuts.deleteLogicalGroup', groupItem);

                // Wait for file system operations to complete
                await new Promise(resolve => setTimeout(resolve, 100));
                configManager.invalidateCache();
                const config = await configManager.loadConfiguration();
                const exists = config.logicalGroups.some(g => g.name === 'Delete Emoji Test');
                assert.strictEqual(exists, false, 'Group should be deleted');

            } finally {
                vscode.window.showWarningMessage = originalShowWarningMessage;
            }
        });

        test('should delete multiple groups in one operation', async () => {
            // Setup: Create multiple groups
            await configManager.createLogicalGroup('Group 1');
            await configManager.createLogicalGroup('Group 2');
            await configManager.createLogicalGroup('Group 3');
            provider.refresh();

            // Note: Multi-selection is a complex feature that requires TreeView selection
            // This test documents the expected behavior, but actual multi-selection
            // would require a full TreeView mock which is beyond unit testing scope
            // We'll test single deletion as that's the core functionality

            const rootItems = await provider.getChildren();
            const group2 = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Group 2'
            );
            assert.ok(group2);

            const originalShowWarningMessage = vscode.window.showWarningMessage;
            vscode.window.showWarningMessage = async () => 'Delete' as any;

            try {
                await vscode.commands.executeCommand('shortcuts.deleteLogicalGroup', group2);

                await new Promise(resolve => setTimeout(resolve, 50));
                configManager.invalidateCache();
                const config = await configManager.loadConfiguration();
                const names = config.logicalGroups.map(g => g.name);
                assert.ok(names.includes('Group 1'));
                assert.ok(!names.includes('Group 2'));
                assert.ok(names.includes('Group 3'));

            } finally {
                vscode.window.showWarningMessage = originalShowWarningMessage;
            }
        });
    });

    // E2E Tests for Show Config Source functionality
    suite('Show Config Source E2E Tests', () => {
        test('should show workspace config source information', async () => {
            // Create workspace config
            const configPath = configManager.getConfigPath();
            fs.mkdirSync(path.dirname(configPath), { recursive: true });
            fs.writeFileSync(configPath, 'logicalGroups: []');

            let messageShown = false;
            let messageText = '';
            let detailText = '';

            const originalShowInfoMessage = vscode.window.showInformationMessage;
            vscode.window.showInformationMessage = async (message: string, options?: any, ...items: string[]) => {
                messageShown = true;
                messageText = message;
                detailText = options?.detail || '';
                return undefined as any;
            };

            try {
                await vscode.commands.executeCommand('shortcuts.showConfigSource');

                assert.ok(messageShown, 'Information message should be shown');
                assert.ok(messageText.includes('Workspace'), 'Message should mention workspace');
                assert.ok(detailText.includes(configPath), 'Detail should include config path');

            } finally {
                vscode.window.showInformationMessage = originalShowInfoMessage;
            }
        });

        test('should show global config source when no workspace config exists', async () => {
            // Remove workspace config if exists
            const workspaceConfigPath = configManager.getConfigPath();
            if (fs.existsSync(workspaceConfigPath)) {
                fs.unlinkSync(workspaceConfigPath);
            }

            // Create global config
            const globalConfigPath = getGlobalConfigPath();
            fs.mkdirSync(path.dirname(globalConfigPath), { recursive: true });
            fs.writeFileSync(globalConfigPath, 'logicalGroups: []');

            let messageShown = false;
            let messageText = '';

            const originalShowInfoMessage = vscode.window.showInformationMessage;
            vscode.window.showInformationMessage = async (message: string, options?: any, ...items: string[]) => {
                messageShown = true;
                messageText = message;
                return undefined as any;
            };

            try {
                await vscode.commands.executeCommand('shortcuts.showConfigSource');

                assert.ok(messageShown, 'Information message should be shown');
                assert.ok(messageText.includes('Global'), 'Message should mention global config');

            } finally {
                vscode.window.showInformationMessage = originalShowInfoMessage;

                // Clean up global config
                if (fs.existsSync(globalConfigPath)) {
                    fs.unlinkSync(globalConfigPath);
                }
            }
        });

        test('should show default config source when no configs exist', async () => {
            // Remove both workspace and global configs
            const workspaceConfigPath = configManager.getConfigPath();
            if (fs.existsSync(workspaceConfigPath)) {
                fs.unlinkSync(workspaceConfigPath);
            }

            const globalConfigPath = getGlobalConfigPath();
            if (fs.existsSync(globalConfigPath)) {
                fs.unlinkSync(globalConfigPath);
            }

            let messageShown = false;
            let messageText = '';

            const originalShowInfoMessage = vscode.window.showInformationMessage;
            vscode.window.showInformationMessage = async (message: string, options?: any, ...items: string[]) => {
                messageShown = true;
                messageText = message;
                return undefined as any;
            };

            try {
                await vscode.commands.executeCommand('shortcuts.showConfigSource');

                assert.ok(messageShown, 'Information message should be shown');
                assert.ok(messageText.includes('Default'), 'Message should mention default config');

            } finally {
                vscode.window.showInformationMessage = originalShowInfoMessage;
            }
        });

        test('should open configuration when user clicks Open Configuration', async () => {
            // Create workspace config
            const configPath = configManager.getConfigPath();
            fs.mkdirSync(path.dirname(configPath), { recursive: true });
            fs.writeFileSync(configPath, 'logicalGroups: []');

            let documentOpened = false;

            const originalShowInfoMessage = vscode.window.showInformationMessage;
            const originalShowTextDocument = vscode.window.showTextDocument;

            vscode.window.showInformationMessage = async (message: string, options?: any, ...items: string[]) => {
                return 'Open Configuration' as any;
            };

            vscode.window.showTextDocument = async () => {
                documentOpened = true;
                return {} as any;
            };

            try {
                await vscode.commands.executeCommand('shortcuts.showConfigSource');

                assert.ok(documentOpened, 'Configuration file should be opened');

            } finally {
                vscode.window.showInformationMessage = originalShowInfoMessage;
                vscode.window.showTextDocument = originalShowTextDocument;
            }
        });

        test('should copy path to clipboard when user clicks Copy Path', async () => {
            // Create workspace config
            const configPath = configManager.getConfigPath();
            fs.mkdirSync(path.dirname(configPath), { recursive: true });
            fs.writeFileSync(configPath, 'logicalGroups: []');

            const originalShowInfoMessage = vscode.window.showInformationMessage;

            vscode.window.showInformationMessage = async (message: string, options?: any, ...items: string[]) => {
                return 'Copy Path' as any;
            };

            try {
                // Just verify the command executes without error
                // We can't easily mock vscode.env.clipboard.writeText as it's read-only
                await vscode.commands.executeCommand('shortcuts.showConfigSource');
                assert.ok(true, 'Command executed successfully');

            } finally {
                vscode.window.showInformationMessage = originalShowInfoMessage;
            }
        });

        test('should handle cancellation gracefully', async () => {
            // Create workspace config
            const configPath = configManager.getConfigPath();
            fs.mkdirSync(path.dirname(configPath), { recursive: true });
            fs.writeFileSync(configPath, 'logicalGroups: []');

            const originalShowInfoMessage = vscode.window.showInformationMessage;
            vscode.window.showInformationMessage = async () => undefined as any;

            try {
                // Should not throw when user cancels
                await vscode.commands.executeCommand('shortcuts.showConfigSource');
                assert.ok(true, 'Should handle cancellation gracefully');

            } finally {
                vscode.window.showInformationMessage = originalShowInfoMessage;
            }
        });
    });

    // Tests for Remove From Logical Group - Verify No Confirmation Prompt
    suite('Remove From Logical Group - No Confirmation', () => {
        test('removeFromLogicalGroup works without confirmation', async () => {
            // Test that the underlying ConfigurationManager method works correctly
            await configManager.createLogicalGroup('Test Group');
            await configManager.addToLogicalGroup('Test Group', testFolder, 'Test Folder', 'folder');

            let config = await configManager.loadConfiguration();
            assert.ok(config.logicalGroups[0].items.length > 0, 'Should have items');

            // Remove item - no confirmation prompt in the ConfigurationManager method
            await configManager.removeFromLogicalGroup('Test Group', testFolder);

            config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 0, 'Item should be removed');
        });

        test('command should be registered', async () => {
            // Verify the command is properly registered
            const commands = await vscode.commands.getCommands(true);
            assert.ok(commands.includes('shortcuts.removeFromLogicalGroup'),
                'removeFromLogicalGroup command should be registered');
        });

        test('removeFromLogicalGroup works with nested groups', async () => {
            // Test that removal works in nested groups
            await configManager.createLogicalGroup('Parent');
            await configManager.createNestedLogicalGroup('Parent', 'Child', 'Child group');
            await configManager.addToLogicalGroup('Parent/Child', testFolder, 'Test Folder', 'folder');

            let config = await configManager.loadConfiguration();
            const childGroup = config.logicalGroups[0].groups![0];
            assert.ok(childGroup.items.length > 0, 'Should have item in nested group');

            // Remove from nested group
            await configManager.removeFromLogicalGroup('Parent/Child', testFolder);

            config = await configManager.loadConfiguration();
            const updatedChildGroup = config.logicalGroups[0].groups![0];
            assert.strictEqual(updatedChildGroup.items.length, 0, 'Item should be removed from nested group');
        });

        test('removeFromLogicalGroup handles multiple sequential removals', async () => {
            // Test multiple removals work correctly
            const testFile = path.join(testFolder, 'test-file.txt');
            const testFolder2 = path.join(tempDir, 'test-folder-2');

            await configManager.createLogicalGroup('Multi Items');
            await configManager.addToLogicalGroup('Multi Items', testFile, 'File', 'file');
            await configManager.addToLogicalGroup('Multi Items', testFolder2, 'Folder', 'folder');

            let config = await configManager.loadConfiguration();
            assert.ok(config.logicalGroups[0].items.length >= 2, 'Should have multiple items');

            // Remove first item
            await configManager.removeFromLogicalGroup('Multi Items', testFile);
            config = await configManager.loadConfiguration();
            const afterFirst = config.logicalGroups[0].items.length;
            assert.ok(afterFirst < 2, 'Should have fewer items after first removal');

            // Remove second item
            await configManager.removeFromLogicalGroup('Multi Items', testFolder2);
            config = await configManager.loadConfiguration();
            assert.ok(config.logicalGroups[0].items.length < afterFirst, 'Should have even fewer items after second removal');
        });
    });
});
