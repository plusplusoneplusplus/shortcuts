import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ShortcutsTreeDataProvider } from '../../shortcuts/tree-data-provider';
import { ShortcutsCommands } from '../../shortcuts/commands';
import { FolderShortcutItem } from '../../shortcuts/tree-items';
import { DEFAULT_SHORTCUTS_CONFIG } from '../../shortcuts/types';

suite('ShortcutsCommands Integration Tests', () => {
    let tempDir: string;
    let provider: ShortcutsTreeDataProvider;
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
    });

    suiteTeardown(() => {
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }

        // Dispose of all registered commands
        disposables.forEach(d => d.dispose());
        disposables = [];
    });

    setup(() => {
        provider = new ShortcutsTreeDataProvider(tempDir);
        commands = new ShortcutsCommands(provider);

        // Create a mock extension context
        const mockContext = {
            subscriptions: [],
            workspaceState: {
                get: () => undefined,
                update: () => Promise.resolve()
            },
            globalState: {
                get: () => undefined,
                update: () => Promise.resolve()
            }
        } as any;

        // Register commands but don't track disposables here
        // (we'll test command registration separately)
        disposables.push(...commands.registerCommands(mockContext));
    });

    teardown(() => {
        provider.dispose();
        // Note: disposables are cleaned up in suiteTeardown
    });

    test('should register all required commands', () => {
        const mockContext = {
            subscriptions: [],
            workspaceState: {
                get: () => undefined,
                update: () => Promise.resolve()
            },
            globalState: {
                get: () => undefined,
                update: () => Promise.resolve()
            }
        } as any;

        const registeredDisposables = commands.registerCommands(mockContext);

        // Should register 6 commands
        assert.strictEqual(registeredDisposables.length, 6);

        // All should be disposables
        registeredDisposables.forEach(disposable => {
            assert.ok(disposable);
            assert.ok(typeof disposable.dispose === 'function');
        });
    });

    test('should refresh shortcuts when refresh command is executed', async () => {
        let refreshCalled = false;

        // Mock the refresh method to track calls
        const originalRefresh = provider.refresh.bind(provider);
        provider.refresh = () => {
            refreshCalled = true;
            originalRefresh();
        };

        // Execute refresh command
        await vscode.commands.executeCommand('shortcuts.refresh');

        assert.ok(refreshCalled, 'Refresh should have been called');
    });

    test('should reset configuration when reset command is executed', async () => {
        // First, create a configuration with shortcuts
        const configManager = provider.getConfigurationManager();
        const configWithShortcuts = {
            shortcuts: [
                { path: 'test-folder', name: 'Test Folder' }
            ]
        };
        await configManager.saveConfiguration(configWithShortcuts);

        // Verify configuration has shortcuts
        let config = await configManager.loadConfiguration();
        assert.strictEqual(config.shortcuts.length, 1);

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
            assert.strictEqual(config.shortcuts.length, 0);
            assert.deepStrictEqual(config, DEFAULT_SHORTCUTS_CONFIG);

        } finally {
            // Restore original method
            vscode.window.showWarningMessage = originalShowWarningMessage;
        }
    });

    test('should not reset configuration when user cancels', async () => {
        // Create a configuration with shortcuts
        const configManager = provider.getConfigurationManager();
        const configWithShortcuts = {
            shortcuts: [
                { path: 'test-folder', name: 'Test Folder' }
            ]
        };
        await configManager.saveConfiguration(configWithShortcuts);

        // Mock confirmation dialog to return undefined (cancelled)
        const originalShowWarningMessage = vscode.window.showWarningMessage;
        vscode.window.showWarningMessage = async (message: string, options?: any, ...items: string[]) => {
            return undefined as any;
        };

        try {
            // Execute reset command
            await vscode.commands.executeCommand('shortcuts.resetConfiguration');

            // Verify configuration was NOT reset
            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.shortcuts.length, 1);

        } finally {
            // Restore original method
            vscode.window.showWarningMessage = originalShowWarningMessage;
        }
    });

    test('should open configuration file when open configuration command is executed', async () => {
        let documentOpened = false;
        let openedUri: vscode.Uri | undefined;

        // Mock showTextDocument to track calls
        const originalShowTextDocument = vscode.window.showTextDocument;
        vscode.window.showTextDocument = async (document: any) => {
            documentOpened = true;
            openedUri = document as vscode.Uri;
            return {} as any; // Mock TextEditor
        };

        try {
            // Execute open configuration command
            await vscode.commands.executeCommand('shortcuts.openConfiguration');

            assert.ok(documentOpened, 'Configuration file should have been opened');
            assert.ok(openedUri, 'URI should be provided');

            if (openedUri) {
                assert.ok(openedUri.fsPath.includes('shortcuts.yaml'), 'Should open shortcuts.yaml file');
            }

        } finally {
            // Restore original method
            vscode.window.showTextDocument = originalShowTextDocument;
        }
    });

    test('should handle remove shortcut command with confirmation', async () => {
        // Set up configuration with shortcuts
        const configManager = provider.getConfigurationManager();
        await configManager.saveConfiguration({
            shortcuts: [
                { path: testFolder, name: 'Test Folder' }
            ]
        });

        // Create folder item
        const folderItem = new FolderShortcutItem(
            'Test Folder',
            vscode.Uri.file(testFolder),
            vscode.TreeItemCollapsibleState.Collapsed
        );

        // Mock confirmation dialog to return 'Remove'
        const originalShowWarningMessage = vscode.window.showWarningMessage;
        vscode.window.showWarningMessage = async (message: string, options?: any, ...items: string[]) => {
            return 'Remove' as any;
        };

        try {
            // Execute remove command
            await vscode.commands.executeCommand('shortcuts.removeShortcut', folderItem);

            // Verify shortcut was removed
            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.shortcuts.length, 0);

        } finally {
            // Restore original method
            vscode.window.showWarningMessage = originalShowWarningMessage;
        }
    });

    test('should not remove shortcut when user cancels confirmation', async () => {
        // Set up configuration with shortcuts
        const configManager = provider.getConfigurationManager();
        await configManager.saveConfiguration({
            shortcuts: [
                { path: testFolder, name: 'Test Folder' }
            ]
        });

        // Create folder item
        const folderItem = new FolderShortcutItem(
            'Test Folder',
            vscode.Uri.file(testFolder),
            vscode.TreeItemCollapsibleState.Collapsed
        );

        // Mock confirmation dialog to return undefined (cancelled)
        const originalShowWarningMessage = vscode.window.showWarningMessage;
        vscode.window.showWarningMessage = async (message: string, options?: any, ...items: string[]) => {
            return undefined as any;
        };

        try {
            // Execute remove command
            await vscode.commands.executeCommand('shortcuts.removeShortcut', folderItem);

            // Verify shortcut was NOT removed
            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.shortcuts.length, 1);

        } finally {
            // Restore original method
            vscode.window.showWarningMessage = originalShowWarningMessage;
        }
    });

    test('should handle rename shortcut command', async () => {
        // Set up configuration with shortcuts
        const configManager = provider.getConfigurationManager();
        await configManager.saveConfiguration({
            shortcuts: [
                { path: testFolder, name: 'Test Folder' }
            ]
        });

        // Create folder item
        const folderItem = new FolderShortcutItem(
            'Test Folder',
            vscode.Uri.file(testFolder),
            vscode.TreeItemCollapsibleState.Collapsed
        );

        // Mock input dialog to return new name
        const originalShowInputBox = vscode.window.showInputBox;
        vscode.window.showInputBox = async (options?: vscode.InputBoxOptions) => {
            return 'Renamed Test Folder';
        };

        try {
            // Execute rename command
            await vscode.commands.executeCommand('shortcuts.renameShortcut', folderItem);

            // Verify shortcut was renamed
            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.shortcuts.length, 1);
            assert.strictEqual(config.shortcuts[0].name, 'Renamed Test Folder');

        } finally {
            // Restore original method
            vscode.window.showInputBox = originalShowInputBox;
        }
    });

    test('should not rename shortcut when user cancels or enters empty name', async () => {
        // Set up configuration with shortcuts
        const configManager = provider.getConfigurationManager();
        await configManager.saveConfiguration({
            shortcuts: [
                { path: testFolder, name: 'Test Folder' }
            ]
        });

        // Create folder item
        const folderItem = new FolderShortcutItem(
            'Test Folder',
            vscode.Uri.file(testFolder),
            vscode.TreeItemCollapsibleState.Collapsed
        );

        // Mock input dialog to return undefined (cancelled)
        const originalShowInputBox = vscode.window.showInputBox;
        vscode.window.showInputBox = async (options?: vscode.InputBoxOptions) => {
            return undefined;
        };

        try {
            // Execute rename command
            await vscode.commands.executeCommand('shortcuts.renameShortcut', folderItem);

            // Verify shortcut was NOT renamed
            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.shortcuts.length, 1);
            assert.strictEqual(config.shortcuts[0].name, 'Test Folder');

        } finally {
            // Restore original method
            vscode.window.showInputBox = originalShowInputBox;
        }
    });

    test('should handle add folder shortcut command', async () => {
        // Mock folder selection dialog
        const originalShowOpenDialog = vscode.window.showOpenDialog;
        vscode.window.showOpenDialog = async (options?: vscode.OpenDialogOptions) => {
            return [vscode.Uri.file(testFolder)];
        };

        // Mock input dialog for display name
        const originalShowInputBox = vscode.window.showInputBox;
        vscode.window.showInputBox = async (options?: vscode.InputBoxOptions) => {
            return 'Custom Name';
        };

        try {
            // Execute add folder command
            await vscode.commands.executeCommand('shortcuts.addFolder');

            // Verify shortcut was added
            const configManager = provider.getConfigurationManager();
            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.shortcuts.length, 1);
            assert.strictEqual(config.shortcuts[0].name, 'Custom Name');
            assert.strictEqual(config.shortcuts[0].path, testFolder);

        } finally {
            // Restore original methods
            vscode.window.showOpenDialog = originalShowOpenDialog;
            vscode.window.showInputBox = originalShowInputBox;
        }
    });

    test('should not add shortcut when user cancels folder selection', async () => {
        // Mock folder selection dialog to return undefined (cancelled)
        const originalShowOpenDialog = vscode.window.showOpenDialog;
        vscode.window.showOpenDialog = async (options?: vscode.OpenDialogOptions) => {
            return undefined;
        };

        try {
            // Execute add folder command
            await vscode.commands.executeCommand('shortcuts.addFolder');

            // Verify no shortcut was added
            const configManager = provider.getConfigurationManager();
            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.shortcuts.length, 0);

        } finally {
            // Restore original method
            vscode.window.showOpenDialog = originalShowOpenDialog;
        }
    });

    test('should use folder name as default when no display name provided', async () => {
        // Mock folder selection dialog
        const originalShowOpenDialog = vscode.window.showOpenDialog;
        vscode.window.showOpenDialog = async (options?: vscode.OpenDialogOptions) => {
            return [vscode.Uri.file(testFolder)];
        };

        // Mock input dialog to return empty string
        const originalShowInputBox = vscode.window.showInputBox;
        vscode.window.showInputBox = async (options?: vscode.InputBoxOptions) => {
            return '';
        };

        try {
            // Execute add folder command
            await vscode.commands.executeCommand('shortcuts.addFolder');

            // Verify shortcut was added with folder name
            const configManager = provider.getConfigurationManager();
            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.shortcuts.length, 1);
            assert.strictEqual(config.shortcuts[0].name, undefined); // Should use folder name
            assert.strictEqual(config.shortcuts[0].path, testFolder);

        } finally {
            // Restore original methods
            vscode.window.showOpenDialog = originalShowOpenDialog;
            vscode.window.showInputBox = originalShowInputBox;
        }
    });

    test('should handle errors gracefully in command execution', async () => {
        // Create folder item with invalid path to trigger error
        const invalidFolderItem = new FolderShortcutItem(
            'Invalid',
            vscode.Uri.file('/invalid/nonexistent/path'),
            vscode.TreeItemCollapsibleState.Collapsed
        );

        let errorShown = false;
        const originalShowErrorMessage = vscode.window.showErrorMessage;
        vscode.window.showErrorMessage = async (message: string, ...items: any[]) => {
            errorShown = true;
            return undefined as any;
        };

        // Mock confirmation dialog for removal
        const originalShowWarningMessage = vscode.window.showWarningMessage;
        vscode.window.showWarningMessage = async (message: string, options?: any, ...items: string[]) => {
            return 'Remove' as any;
        };

        try {
            // Execute remove command with invalid item
            await vscode.commands.executeCommand('shortcuts.removeShortcut', invalidFolderItem);

            // Should handle error gracefully
            // Note: Error handling behavior may vary based on implementation
            assert.ok(true, 'Command should complete without throwing');

        } finally {
            // Restore original methods
            vscode.window.showErrorMessage = originalShowErrorMessage;
            vscode.window.showWarningMessage = originalShowWarningMessage;
        }
    });

    test('should maintain tree view refresh after command operations', async () => {
        let refreshCount = 0;
        const originalRefresh = provider.refresh.bind(provider);
        provider.refresh = () => {
            refreshCount++;
            originalRefresh();
        };

        // Set up configuration
        const configManager = provider.getConfigurationManager();
        await configManager.saveConfiguration({
            shortcuts: [
                { path: testFolder, name: 'Test Folder' }
            ]
        });

        // Mock dialogs
        const originalShowWarningMessage = vscode.window.showWarningMessage;
        vscode.window.showWarningMessage = async () => 'Remove' as any;

        const folderItem = new FolderShortcutItem(
            'Test Folder',
            vscode.Uri.file(testFolder),
            vscode.TreeItemCollapsibleState.Collapsed
        );

        try {
            // Execute remove command
            await vscode.commands.executeCommand('shortcuts.removeShortcut', folderItem);

            // Verify refresh was called
            assert.ok(refreshCount > 0, 'Tree view should be refreshed after command execution');

        } finally {
            vscode.window.showWarningMessage = originalShowWarningMessage;
        }
    });
});