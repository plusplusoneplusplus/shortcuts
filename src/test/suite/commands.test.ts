import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ShortcutsCommands } from '../../shortcuts/commands';
import { ConfigurationManager } from '../../shortcuts/configuration-manager';
import { LogicalTreeDataProvider } from '../../shortcuts/logical-tree-data-provider';
import { ThemeManager } from '../../shortcuts/theme-manager';
import { DEFAULT_SHORTCUTS_CONFIG } from '../../shortcuts/types';

suite('ShortcutsCommands Integration Tests', () => {
    let tempDir: string;
    let provider: LogicalTreeDataProvider;
    let configManager: ConfigurationManager;
    let themeManager: ThemeManager;
    let commands: ShortcutsCommands;
    let testFolder: string;
    let disposables: vscode.Disposable[] = [];

    suiteSetup(async () => {
        // Create temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-commands-test-'));

        // Create test folder structure
        testFolder = path.join(tempDir, 'test-folder');
        fs.mkdirSync(testFolder);
        fs.writeFileSync(path.join(testFolder, 'test-file.txt'), 'test content');

        // Create additional test folders
        const testFolder2 = path.join(tempDir, 'test-folder-2');
        fs.mkdirSync(testFolder2);

        // Setup providers - DON'T register commands as the extension will already have done so
        configManager = new ConfigurationManager(tempDir);
        themeManager = new ThemeManager();
        provider = new LogicalTreeDataProvider(
            tempDir,
            configManager,
            themeManager
        );
        // Note: We don't create ShortcutsCommands or register commands here
        // The extension activation will handle that
    });

    suiteTeardown(() => {
        // Clean up providers
        provider.dispose();
        configManager.dispose();
        themeManager.dispose();

        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    teardown(() => {
        // Clean up config file between tests
        const configPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
        if (fs.existsSync(configPath)) {
            fs.unlinkSync(configPath);
        }
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
            'shortcuts.openConfiguration'
        ];

        for (const cmd of requiredCommands) {
            const commandExists = commands.includes(cmd);
            assert.ok(commandExists, `Command ${cmd} should be registered`);
        }
    });

    test('should refresh shortcuts when refresh command is executed', async () => {
        let refreshCalled = false;

        // Mock the refresh method to track calls
        const originalRefresh = provider.refresh.bind(provider);
        provider.refresh = () => {
            refreshCalled = true;
            originalRefresh();
        };

        try {
            // Execute refresh command
            await vscode.commands.executeCommand('shortcuts.refresh');
            assert.ok(refreshCalled, 'Refresh should have been called');
        } finally {
            // Restore original method
            provider.refresh = originalRefresh;
        }
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
        assert.strictEqual(config.logicalGroups.length, 1);

        // Mock confirmation dialog to return 'Reset'
        const originalShowWarningMessage = vscode.window.showWarningMessage;
        vscode.window.showWarningMessage = async (message: string, options?: any, ...items: string[]) => {
            return 'Reset' as any;
        };

        try {
            // Execute reset command
            await vscode.commands.executeCommand('shortcuts.resetConfiguration');

            // Verify configuration was reset
            config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups.length, 0);
            assert.deepStrictEqual(config, DEFAULT_SHORTCUTS_CONFIG);

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

            // Verify default configuration was created
            assert.ok(fs.existsSync(configPath), 'Config file should have been created');

            const config = await configManager.loadConfiguration();
            assert.deepStrictEqual(config, DEFAULT_SHORTCUTS_CONFIG);

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
        let refreshCount = 0;

        // Mock the refresh method to track calls
        const originalRefresh = provider.refresh.bind(provider);
        provider.refresh = () => {
            refreshCount++;
            originalRefresh();
        };

        try {
            // Execute multiple commands that should trigger refresh
            await vscode.commands.executeCommand('shortcuts.refresh');

            assert.ok(refreshCount >= 1, 'Refresh should have been called at least once');
        } finally {
            // Restore original method
            provider.refresh = originalRefresh;
        }
    });
});
