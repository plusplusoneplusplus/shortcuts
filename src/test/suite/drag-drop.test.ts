import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationManager } from '../../shortcuts/configuration-manager';
import { ShortcutsDragDropController } from '../../shortcuts/drag-drop-controller';
import { LogicalTreeDataProvider } from '../../shortcuts/logical-tree-data-provider';
import { ThemeManager } from '../../shortcuts/theme-manager';
import { FileShortcutItem, FolderShortcutItem, LogicalGroupChildItem, LogicalGroupItem } from '../../shortcuts/tree-items';

suite('Drag and Drop Tests', () => {
    let tempDir: string;
    let provider: LogicalTreeDataProvider;
    let configManager: ConfigurationManager;
    let themeManager: ThemeManager;
    let dragDropController: ShortcutsDragDropController;
    let testFolder: string;
    let testFile: string;

    suiteSetup(async () => {
        // Use the workspace folder launched by the test runner for isolation
        tempDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-dragdrop-test-'));

        // Create test folder structure
        testFolder = path.join(tempDir, 'test-folder');
        if (!fs.existsSync(testFolder)) {
            fs.mkdirSync(testFolder, { recursive: true });
        }
        testFile = path.join(testFolder, 'test-file.txt');
        fs.writeFileSync(testFile, 'test content');

        // Create additional test files and folders
        const testFolder2 = path.join(tempDir, 'test-folder-2');
        if (!fs.existsSync(testFolder2)) {
            fs.mkdirSync(testFolder2, { recursive: true });
        }
        const testFile2 = path.join(tempDir, 'test-file-2.txt');
        fs.writeFileSync(testFile2, 'test content 2');

        // Activate our extension
        const ext = vscode.extensions.getExtension('yihengtao.workspace-shortcuts');
        if (ext) {
            await ext.activate();
        }

        // Setup providers
        configManager = new ConfigurationManager(tempDir);
        themeManager = new ThemeManager();
        provider = new LogicalTreeDataProvider(tempDir, configManager, themeManager);

        // Setup drag-drop controller
        dragDropController = new ShortcutsDragDropController();
        dragDropController.setRefreshCallback(() => {
            provider.refresh();
        });
        dragDropController.setConfigurationManager(configManager);
    });

    suiteTeardown(() => {
        // Clean up
        provider.dispose();
        configManager.dispose();
        themeManager.dispose();

        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    teardown(async () => {
        // Reset configuration between tests
        const configPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, 'logicalGroups: []\n', 'utf8');
        await configManager.saveConfiguration({ logicalGroups: [] });
        provider.refresh();
    });

    test('should handle drag from internal tree items', async () => {
        const fileItem = new FileShortcutItem('test.txt', vscode.Uri.file(testFile));
        const dataTransfer = new vscode.DataTransfer();
        const token = new vscode.CancellationTokenSource().token;

        await dragDropController.handleDrag([fileItem], dataTransfer, token);

        // Check that data was set
        const uriListData = dataTransfer.get('text/uri-list');
        assert.ok(uriListData, 'URI list data should be set');

        const physicalData = dataTransfer.get('application/vnd.code.tree.shortcutsphysical');
        assert.ok(physicalData, 'Physical tree data should be set');
    });

    test('should drop external files onto logical group', async () => {
        // Create a logical group
        await configManager.createLogicalGroup('Test Group', 'Test description');
        const config = await configManager.loadConfiguration();
        assert.strictEqual(config.logicalGroups.length, 1);

        // Create a logical group item
        const groupItem = new LogicalGroupItem('Test Group', 'Test description');

        // Simulate dropping external file
        const dataTransfer = new vscode.DataTransfer();
        const fileUri = vscode.Uri.file(testFile);
        dataTransfer.set('text/uri-list', new vscode.DataTransferItem([fileUri]));

        const token = new vscode.CancellationTokenSource().token;
        await dragDropController.handleDrop(groupItem, dataTransfer, token);

        // Verify file was added to group
        const updatedConfig = await configManager.loadConfiguration();
        assert.strictEqual(updatedConfig.logicalGroups[0].items.length, 1);
        assert.strictEqual(updatedConfig.logicalGroups[0].items[0].name, 'test-file.txt');
        assert.strictEqual(updatedConfig.logicalGroups[0].items[0].type, 'file');
    });

    test('should drop external folders onto logical group', async () => {
        // Create a logical group
        await configManager.createLogicalGroup('Test Group', 'Test description');

        // Create a logical group item
        const groupItem = new LogicalGroupItem('Test Group', 'Test description');

        // Simulate dropping external folder
        const dataTransfer = new vscode.DataTransfer();
        const folderUri = vscode.Uri.file(testFolder);
        dataTransfer.set('text/uri-list', new vscode.DataTransferItem([folderUri]));

        const token = new vscode.CancellationTokenSource().token;
        await dragDropController.handleDrop(groupItem, dataTransfer, token);

        // Verify folder was added to group
        const updatedConfig = await configManager.loadConfiguration();
        assert.strictEqual(updatedConfig.logicalGroups[0].items.length, 1);
        assert.strictEqual(updatedConfig.logicalGroups[0].items[0].name, 'test-folder');
        assert.strictEqual(updatedConfig.logicalGroups[0].items[0].type, 'folder');
    });

    test('should drop multiple files onto logical group', async () => {
        // Create a logical group
        await configManager.createLogicalGroup('Test Group', 'Test description');

        // Create a logical group item
        const groupItem = new LogicalGroupItem('Test Group', 'Test description');

        // Create another test file
        const testFile3 = path.join(tempDir, 'test-file-3.txt');
        fs.writeFileSync(testFile3, 'test content 3');

        // Simulate dropping multiple files
        const dataTransfer = new vscode.DataTransfer();
        const fileUris = [
            vscode.Uri.file(testFile),
            vscode.Uri.file(testFile3)
        ];
        dataTransfer.set('text/uri-list', new vscode.DataTransferItem(fileUris));

        const token = new vscode.CancellationTokenSource().token;
        await dragDropController.handleDrop(groupItem, dataTransfer, token);

        // Verify both files were added to group
        const updatedConfig = await configManager.loadConfiguration();
        assert.strictEqual(updatedConfig.logicalGroups[0].items.length, 2);
        assert.ok(updatedConfig.logicalGroups[0].items.some(i => i.name === 'test-file.txt'));
        assert.ok(updatedConfig.logicalGroups[0].items.some(i => i.name === 'test-file-3.txt'));
    });

    test('should drop files onto nested logical group', async () => {
        // Create parent and nested group
        await configManager.createLogicalGroup('Parent Group', 'Parent description');
        await configManager.createNestedLogicalGroup('Parent Group', 'Child Group', 'Child description');

        // Create a nested logical group item
        const groupItem = new LogicalGroupItem('Child Group', 'Child description', undefined, vscode.TreeItemCollapsibleState.Collapsed, 'Parent Group');

        // Simulate dropping external file
        const dataTransfer = new vscode.DataTransfer();
        const fileUri = vscode.Uri.file(testFile);
        dataTransfer.set('text/uri-list', new vscode.DataTransferItem([fileUri]));

        const token = new vscode.CancellationTokenSource().token;
        await dragDropController.handleDrop(groupItem, dataTransfer, token);

        // Verify file was added to nested group
        const updatedConfig = await configManager.loadConfiguration();
        const parentGroup = updatedConfig.logicalGroups[0];
        assert.ok(parentGroup.groups);
        assert.strictEqual(parentGroup.groups!.length, 1);
        const childGroup = parentGroup.groups![0];
        assert.strictEqual(childGroup.items.length, 1);
        assert.strictEqual(childGroup.items[0].name, 'test-file.txt');
    });

    test('should move items between groups', async () => {
        // Create two groups
        await configManager.createLogicalGroup('Group A', 'Group A description');
        await configManager.createLogicalGroup('Group B', 'Group B description');

        // Add file to Group A
        await configManager.addToLogicalGroup('Group A', testFile, 'test-file.txt', 'file');

        // Verify file is in Group A
        let config = await configManager.loadConfiguration();
        assert.strictEqual(config.logicalGroups[0].items.length, 1);
        assert.strictEqual(config.logicalGroups[1].items.length, 0);

        // Create items for drag-drop
        const sourceItem = new LogicalGroupChildItem(
            'test-file.txt',
            vscode.Uri.file(testFile),
            'file',
            'Group A'
        );
        const targetGroup = new LogicalGroupItem('Group B', 'Group B description');

        // Simulate dragging from Group A to Group B
        const dataTransfer = new vscode.DataTransfer();
        dataTransfer.set('application/vnd.code.tree.shortcutslogical', new vscode.DataTransferItem([sourceItem]));

        const token = new vscode.CancellationTokenSource().token;
        await dragDropController.handleDrop(targetGroup, dataTransfer, token);

        // Verify file was moved from Group A to Group B
        config = await configManager.loadConfiguration();
        assert.strictEqual(config.logicalGroups[0].items.length, 0, 'Group A should be empty');
        assert.strictEqual(config.logicalGroups[1].items.length, 1, 'Group B should have one item');
        assert.strictEqual(config.logicalGroups[1].items[0].name, 'test-file.txt');
    });

    test('should not duplicate items when moving within same group', async () => {
        // Create a group
        await configManager.createLogicalGroup('Test Group', 'Test description');

        // Add file to group
        await configManager.addToLogicalGroup('Test Group', testFile, 'test-file.txt', 'file');

        // Verify initial state
        let config = await configManager.loadConfiguration();
        assert.strictEqual(config.logicalGroups[0].items.length, 1);

        // Create items for drag-drop
        const sourceItem = new LogicalGroupChildItem(
            'test-file.txt',
            vscode.Uri.file(testFile),
            'file',
            'Test Group'
        );
        const targetGroup = new LogicalGroupItem('Test Group', 'Test description');

        // Simulate dragging within same group
        const dataTransfer = new vscode.DataTransfer();
        dataTransfer.set('application/vnd.code.tree.shortcutslogical', new vscode.DataTransferItem([sourceItem]));

        const token = new vscode.CancellationTokenSource().token;
        await dragDropController.handleDrop(targetGroup, dataTransfer, token);

        // Verify no duplication occurred
        config = await configManager.loadConfiguration();
        assert.strictEqual(config.logicalGroups[0].items.length, 1, 'Should still have only one item');
    });

    test('should handle physical file moves', async () => {
        // Create source and target folders
        const sourceFolder = path.join(tempDir, 'source');
        const targetFolder = path.join(tempDir, 'target');
        fs.mkdirSync(sourceFolder, { recursive: true });
        fs.mkdirSync(targetFolder, { recursive: true });

        // Create a file in source folder
        const sourceFile = path.join(sourceFolder, 'movable.txt');
        fs.writeFileSync(sourceFile, 'movable content');

        // Create tree items
        const fileItem = new FileShortcutItem('movable.txt', vscode.Uri.file(sourceFile));
        const targetFolderItem = new FolderShortcutItem('target', vscode.Uri.file(targetFolder));

        // Simulate drag-drop
        const dataTransfer = new vscode.DataTransfer();
        dataTransfer.set('application/vnd.code.tree.shortcutsphysical', new vscode.DataTransferItem([fileItem]));

        const token = new vscode.CancellationTokenSource().token;
        await dragDropController.handleDrop(targetFolderItem, dataTransfer, token);

        // Verify file was moved
        const targetFile = path.join(targetFolder, 'movable.txt');
        assert.ok(fs.existsSync(targetFile), 'File should exist in target folder');
        assert.ok(!fs.existsSync(sourceFile), 'File should not exist in source folder');
    });

    test('should handle undo for file moves', async () => {
        // Create source and target folders
        const sourceFolder = path.join(tempDir, 'source-undo');
        const targetFolder = path.join(tempDir, 'target-undo');
        fs.mkdirSync(sourceFolder, { recursive: true });
        fs.mkdirSync(targetFolder, { recursive: true });

        // Create a file in source folder
        const sourceFile = path.join(sourceFolder, 'undoable.txt');
        fs.writeFileSync(sourceFile, 'undoable content');

        // Create tree items
        const fileItem = new FileShortcutItem('undoable.txt', vscode.Uri.file(sourceFile));
        const targetFolderItem = new FolderShortcutItem('target-undo', vscode.Uri.file(targetFolder));

        // Perform move
        const dataTransfer = new vscode.DataTransfer();
        dataTransfer.set('application/vnd.code.tree.shortcutsphysical', new vscode.DataTransferItem([fileItem]));

        const token = new vscode.CancellationTokenSource().token;
        await dragDropController.handleDrop(targetFolderItem, dataTransfer, token);

        // Verify file was moved
        const targetFile = path.join(targetFolder, 'undoable.txt');
        assert.ok(fs.existsSync(targetFile), 'File should exist in target folder after move');

        // Verify undo is available
        assert.ok(dragDropController.canUndo(), 'Undo should be available');

        // Perform undo
        await dragDropController.undoLastMove();

        // Verify file was moved back
        assert.ok(fs.existsSync(sourceFile), 'File should exist in source folder after undo');
        assert.ok(!fs.existsSync(targetFile), 'File should not exist in target folder after undo');
    });

    test('should prevent dropping files into themselves', async () => {
        // Create a folder
        const folder = path.join(tempDir, 'self-folder');
        fs.mkdirSync(folder, { recursive: true });

        // Create tree items
        const folderItem = new FolderShortcutItem('self-folder', vscode.Uri.file(folder));

        // Try to drop folder into itself
        const dataTransfer = new vscode.DataTransfer();
        dataTransfer.set('application/vnd.code.tree.shortcutsphysical', new vscode.DataTransferItem([folderItem]));

        const token = new vscode.CancellationTokenSource().token;
        await dragDropController.handleDrop(folderItem, dataTransfer, token);

        // Verify folder structure is unchanged (no error thrown)
        assert.ok(fs.existsSync(folder), 'Folder should still exist');
    });

    test('should skip duplicate items when dropping onto group', async () => {
        // Create a group and add a file
        await configManager.createLogicalGroup('Test Group', 'Test description');
        await configManager.addToLogicalGroup('Test Group', testFile, 'test-file.txt', 'file');

        // Verify initial state
        let config = await configManager.loadConfiguration();
        assert.strictEqual(config.logicalGroups[0].items.length, 1);

        // Try to add the same file again via drag-drop
        const groupItem = new LogicalGroupItem('Test Group', 'Test description');
        const dataTransfer = new vscode.DataTransfer();
        const fileUri = vscode.Uri.file(testFile);
        dataTransfer.set('text/uri-list', new vscode.DataTransferItem([fileUri]));

        const token = new vscode.CancellationTokenSource().token;
        await dragDropController.handleDrop(groupItem, dataTransfer, token);

        // Verify no duplicate was added
        config = await configManager.loadConfiguration();
        assert.strictEqual(config.logicalGroups[0].items.length, 1, 'Should still have only one item');
    });

    test('should handle external file drop onto folder', async () => {
        // Create target folder
        const targetFolder = path.join(tempDir, 'drop-target');
        fs.mkdirSync(targetFolder, { recursive: true });

        // Create external file
        const externalFile = path.join(tempDir, 'external.txt');
        fs.writeFileSync(externalFile, 'external content');

        // Create tree items
        const targetFolderItem = new FolderShortcutItem('drop-target', vscode.Uri.file(targetFolder));

        // Simulate external file drop
        const dataTransfer = new vscode.DataTransfer();
        const fileUri = vscode.Uri.file(externalFile);
        dataTransfer.set('text/uri-list', new vscode.DataTransferItem([fileUri]));

        const token = new vscode.CancellationTokenSource().token;
        await dragDropController.handleDrop(targetFolderItem, dataTransfer, token);

        // Verify file was copied
        const copiedFile = path.join(targetFolder, 'external.txt');
        assert.ok(fs.existsSync(copiedFile), 'File should be copied to target folder');
        assert.ok(fs.existsSync(externalFile), 'Original file should still exist');
    });
});

