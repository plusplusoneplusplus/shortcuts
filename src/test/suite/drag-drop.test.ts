import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationManager } from '../../shortcuts/configuration-manager';
import { ShortcutsDragDropController } from '../../shortcuts/drag-drop-controller';
import { LogicalTreeDataProvider } from '../../shortcuts/logical-tree-data-provider';
import { ThemeManager } from '../../shortcuts/theme-manager';
import { FileShortcutItem, FolderShortcutItem, LogicalGroupChildItem, LogicalGroupItem, NoteShortcutItem } from '../../shortcuts/tree-items';

suite('Drag and Drop Tests', () => {
    let tempDir: string;
    let provider: LogicalTreeDataProvider;
    let configManager: ConfigurationManager;
    let themeManager: ThemeManager;
    let dragDropController: ShortcutsDragDropController;
    let testFolder: string;
    let testFile: string;
    let extensionContext: vscode.ExtensionContext;

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

        // Create a mock extension context for note storage
        extensionContext = {
            globalState: {
                keys: () => [],
                get: <T>(key: string, defaultValue?: T): T => {
                    const mockStorage = (extensionContext.globalState as any)._storage || {};
                    return mockStorage[key] !== undefined ? mockStorage[key] : defaultValue!;
                },
                update: async (key: string, value: any): Promise<void> => {
                    const mockStorage = (extensionContext.globalState as any)._storage || {};
                    mockStorage[key] = value;
                    (extensionContext.globalState as any)._storage = mockStorage;
                },
                setKeysForSync: () => { }
            },
            subscriptions: []
        } as any;

        // Initialize storage
        (extensionContext.globalState as any)._storage = {};

        // Pre-create empty config so tests start with a clean slate
        const vscodePath = path.join(tempDir, '.vscode');
        fs.mkdirSync(vscodePath, { recursive: true });
        fs.writeFileSync(path.join(vscodePath, 'shortcuts.yaml'), 'logicalGroups: []\n');

        // Setup providers with mock context
        configManager = new ConfigurationManager(tempDir, extensionContext);
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

    setup(async () => {
        // Reset configuration before each test
        const configPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, 'logicalGroups: []\n', 'utf8');
        configManager.invalidateCache();
        (extensionContext.globalState as any)._storage = {};
        provider.refresh();
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
        const group = updatedConfig.logicalGroups.find(g => g.name === 'Test Group');
        assert.ok(group, 'Test Group should exist');
        assert.strictEqual(group!.items.length, 1);
        assert.strictEqual(group!.items[0].name, 'test-file.txt');
        assert.strictEqual(group!.items[0].type, 'file');
    });

    test('should drop external folders onto logical group', async () => {
        // Create a logical group
        await configManager.createLogicalGroup('Folder Test Group', 'Test description');

        // Create a logical group item
        const groupItem = new LogicalGroupItem('Folder Test Group', 'Test description');

        // Simulate dropping external folder
        const dataTransfer = new vscode.DataTransfer();
        const folderUri = vscode.Uri.file(testFolder);
        dataTransfer.set('text/uri-list', new vscode.DataTransferItem([folderUri]));

        const token = new vscode.CancellationTokenSource().token;
        await dragDropController.handleDrop(groupItem, dataTransfer, token);

        // Verify folder was added to group
        const updatedConfig = await configManager.loadConfiguration();
        const group = updatedConfig.logicalGroups.find(g => g.name === 'Folder Test Group');
        assert.ok(group, 'Folder Test Group should exist');
        assert.strictEqual(group!.items.length, 1);
        assert.strictEqual(group!.items[0].name, 'test-folder');
        assert.strictEqual(group!.items[0].type, 'folder');
    });

    test('should drop multiple files onto logical group', async () => {
        // Create a logical group
        await configManager.createLogicalGroup('Multi Files Group', 'Test description');

        // Create a logical group item
        const groupItem = new LogicalGroupItem('Multi Files Group', 'Test description');

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
        const group = updatedConfig.logicalGroups.find(g => g.name === 'Multi Files Group');
        assert.ok(group, 'Multi Files Group should exist');
        assert.strictEqual(group!.items.length, 2);
        assert.ok(group!.items.some(i => i.name === 'test-file.txt'));
        assert.ok(group!.items.some(i => i.name === 'test-file-3.txt'));
    });

    test('should drop files onto nested logical group', async () => {
        // Create parent and nested group
        await configManager.createLogicalGroup('Nested Drop Parent', 'Parent description');
        await configManager.createNestedLogicalGroup('Nested Drop Parent', 'Child Group', 'Child description');

        // Create a nested logical group item
        const groupItem = new LogicalGroupItem('Child Group', 'Child description', undefined, vscode.TreeItemCollapsibleState.Collapsed, 'Nested Drop Parent');

        // Simulate dropping external file
        const dataTransfer = new vscode.DataTransfer();
        const fileUri = vscode.Uri.file(testFile);
        dataTransfer.set('text/uri-list', new vscode.DataTransferItem([fileUri]));

        const token = new vscode.CancellationTokenSource().token;
        await dragDropController.handleDrop(groupItem, dataTransfer, token);

        // Verify file was added to nested group
        const updatedConfig = await configManager.loadConfiguration();
        const parentGroup = updatedConfig.logicalGroups.find(g => g.name === 'Nested Drop Parent');
        assert.ok(parentGroup, 'Parent group should exist');
        assert.ok(parentGroup!.groups);
        assert.strictEqual(parentGroup!.groups!.length, 1);
        const childGroup = parentGroup!.groups![0];
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
        let groupA = config.logicalGroups.find(g => g.name === 'Group A');
        let groupB = config.logicalGroups.find(g => g.name === 'Group B');
        assert.ok(groupA, 'Group A should exist');
        assert.ok(groupB, 'Group B should exist');
        assert.strictEqual(groupA!.items.length, 1);
        assert.strictEqual(groupB!.items.length, 0);

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
        groupA = config.logicalGroups.find(g => g.name === 'Group A');
        groupB = config.logicalGroups.find(g => g.name === 'Group B');
        assert.ok(groupA, 'Group A should still exist');
        assert.ok(groupB, 'Group B should still exist');
        assert.strictEqual(groupA!.items.length, 0, 'Group A should be empty');
        assert.strictEqual(groupB!.items.length, 1, 'Group B should have one item');
        assert.strictEqual(groupB!.items[0].name, 'test-file.txt');
    });

    test('should not duplicate items when moving within same group', async () => {
        // Create a group
        await configManager.createLogicalGroup('Same Group Test', 'Test description');

        // Add file to group
        await configManager.addToLogicalGroup('Same Group Test', testFile, 'test-file.txt', 'file');

        // Verify initial state
        let config = await configManager.loadConfiguration();
        let group = config.logicalGroups.find(g => g.name === 'Same Group Test');
        assert.ok(group, 'Same Group Test should exist');
        assert.strictEqual(group!.items.length, 1);

        // Create items for drag-drop
        const sourceItem = new LogicalGroupChildItem(
            'test-file.txt',
            vscode.Uri.file(testFile),
            'file',
            'Same Group Test'
        );
        const targetGroup = new LogicalGroupItem('Same Group Test', 'Test description');

        // Simulate dragging within same group
        const dataTransfer = new vscode.DataTransfer();
        dataTransfer.set('application/vnd.code.tree.shortcutslogical', new vscode.DataTransferItem([sourceItem]));

        const token = new vscode.CancellationTokenSource().token;
        await dragDropController.handleDrop(targetGroup, dataTransfer, token);

        // Verify no duplication occurred
        config = await configManager.loadConfiguration();
        group = config.logicalGroups.find(g => g.name === 'Same Group Test');
        assert.ok(group, 'Same Group Test should still exist');
        assert.strictEqual(group!.items.length, 1, 'Should still have only one item');
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
        await configManager.createLogicalGroup('Skip Duplicate Group', 'Test description');
        await configManager.addToLogicalGroup('Skip Duplicate Group', testFile, 'test-file.txt', 'file');

        // Verify initial state
        let config = await configManager.loadConfiguration();
        let group = config.logicalGroups.find(g => g.name === 'Skip Duplicate Group');
        assert.ok(group, 'Skip Duplicate Group should exist');
        assert.strictEqual(group!.items.length, 1);

        // Try to add the same file again via drag-drop
        const groupItem = new LogicalGroupItem('Skip Duplicate Group', 'Test description');
        const dataTransfer = new vscode.DataTransfer();
        const fileUri = vscode.Uri.file(testFile);
        dataTransfer.set('text/uri-list', new vscode.DataTransferItem([fileUri]));

        const token = new vscode.CancellationTokenSource().token;
        await dragDropController.handleDrop(groupItem, dataTransfer, token);

        // Verify no duplicate was added
        config = await configManager.loadConfiguration();
        group = config.logicalGroups.find(g => g.name === 'Skip Duplicate Group');
        assert.ok(group, 'Skip Duplicate Group should still exist');
        assert.strictEqual(group!.items.length, 1, 'Should still have only one item');
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

    // ========== Tests for DRAG_DROP_BEHAVIOR.md scenarios ==========

    test('Scenario 1: should physically move file between folders in same logical group', async () => {
        // Setup: Create one logical group with two folders
        const folderA = path.join(tempDir, 'scenario1-folderA');
        const folderB = path.join(tempDir, 'scenario1-folderB');
        fs.mkdirSync(folderA, { recursive: true });
        fs.mkdirSync(folderB, { recursive: true });

        await configManager.createLogicalGroup('Project Files', 'Main project');
        await configManager.addToLogicalGroup('Project Files', folderA, 'Folder A', 'folder');
        await configManager.addToLogicalGroup('Project Files', folderB, 'Folder B', 'folder');

        // Create file in folderA
        const sourceFile = path.join(folderA, 'moveable.txt');
        fs.writeFileSync(sourceFile, 'content to move');

        // Create tree items - file from inside folderA, target is folderB (as LogicalGroupChildItem)
        const fileItem = new FileShortcutItem('moveable.txt', vscode.Uri.file(sourceFile));
        const targetFolderItem = new LogicalGroupChildItem('Folder B', vscode.Uri.file(folderB), 'folder', 'Project Files');

        // Perform drop
        const dataTransfer = new vscode.DataTransfer();
        dataTransfer.set('application/vnd.code.tree.shortcutsphysical', new vscode.DataTransferItem([fileItem]));

        const token = new vscode.CancellationTokenSource().token;
        await dragDropController.handleDrop(targetFolderItem, dataTransfer, token);

        // Verify: Physical move occurred, config unchanged
        const targetFile = path.join(folderB, 'moveable.txt');
        assert.ok(fs.existsSync(targetFile), 'File should exist in target folder');
        assert.ok(!fs.existsSync(sourceFile), 'File should not exist in source folder');

        const config = await configManager.loadConfiguration();
        const projectGroup = config.logicalGroups.find(g => g.name === 'Project Files');
        assert.ok(projectGroup, 'Project Files group should exist');
        assert.strictEqual(projectGroup!.items.length, 2, 'Should still have both folders in group');
    });

    test('Scenario 2: should physically move file between folders in different logical groups', async () => {
        // Setup: Create two logical groups, each with one folder
        const folderA = path.join(tempDir, 'scenario2-folderA');
        const folderB = path.join(tempDir, 'scenario2-folderB');
        fs.mkdirSync(folderA, { recursive: true });
        fs.mkdirSync(folderB, { recursive: true });

        await configManager.createLogicalGroup('Scenario2 Group 1', 'First group');
        await configManager.createLogicalGroup('Scenario2 Group 2', 'Second group');
        await configManager.addToLogicalGroup('Scenario2 Group 1', folderA, 'Folder A', 'folder');
        await configManager.addToLogicalGroup('Scenario2 Group 2', folderB, 'Folder B', 'folder');

        // Create file in folderA
        const sourceFile = path.join(folderA, 'cross-group.txt');
        fs.writeFileSync(sourceFile, 'content across groups');

        // Create tree items
        const fileItem = new FileShortcutItem('cross-group.txt', vscode.Uri.file(sourceFile));
        const targetFolderItem = new LogicalGroupChildItem('Folder B', vscode.Uri.file(folderB), 'folder', 'Scenario2 Group 2');

        // Perform drop
        const dataTransfer = new vscode.DataTransfer();
        dataTransfer.set('application/vnd.code.tree.shortcutsphysical', new vscode.DataTransferItem([fileItem]));

        const token = new vscode.CancellationTokenSource().token;
        await dragDropController.handleDrop(targetFolderItem, dataTransfer, token);

        // Verify: Physical move occurred, groups unchanged
        const targetFile = path.join(folderB, 'cross-group.txt');
        assert.ok(fs.existsSync(targetFile), 'File should exist in target folder');
        assert.ok(!fs.existsSync(sourceFile), 'File should not exist in source folder');

        const config = await configManager.loadConfiguration();
        const group1 = config.logicalGroups.find(g => g.name === 'Scenario2 Group 1');
        const group2 = config.logicalGroups.find(g => g.name === 'Scenario2 Group 2');
        assert.ok(group1, 'Group 1 should exist');
        assert.ok(group2, 'Group 2 should exist');
        assert.strictEqual(group1!.items.length, 1, 'Group 1 should still have one folder');
        assert.strictEqual(group2!.items.length, 1, 'Group 2 should still have one folder');
    });

    test('Scenario 3a: should physically move LogicalGroupChildItem to physical folder creating stale config', async () => {
        // Setup: Subgroup with file, and a physical folder in same parent group
        const targetFolder = path.join(tempDir, 'scenario3a-target');
        fs.mkdirSync(targetFolder, { recursive: true });

        const sourceFile = path.join(tempDir, 'scenario3a-important.txt');
        fs.writeFileSync(sourceFile, 'important content');

        await configManager.createLogicalGroup('Scenario3a Project', 'Main project');
        await configManager.createNestedLogicalGroup('Scenario3a Project', 'Subgroup', 'Important files');
        await configManager.addToLogicalGroup('Scenario3a Project/Subgroup', sourceFile, 'Important File', 'file');
        await configManager.addToLogicalGroup('Scenario3a Project', targetFolder, 'Target Folder', 'folder');

        // Verify initial setup
        let config = await configManager.loadConfiguration();
        let projectGroup = config.logicalGroups.find(g => g.name === 'Scenario3a Project');
        assert.ok(projectGroup, 'Project group should exist');
        assert.ok(projectGroup!.groups);
        assert.strictEqual(projectGroup!.groups![0].items.length, 1);

        // Drag file from Subgroup (LogicalGroupChildItem), drop on Target Folder
        const fileItem = new LogicalGroupChildItem('Important File', vscode.Uri.file(sourceFile), 'file', 'Scenario3a Project/Subgroup');
        const targetFolderItem = new LogicalGroupChildItem('Target Folder', vscode.Uri.file(targetFolder), 'folder', 'Scenario3a Project');

        const dataTransfer = new vscode.DataTransfer();
        dataTransfer.set('application/vnd.code.tree.shortcutslogical', new vscode.DataTransferItem([fileItem]));

        const token = new vscode.CancellationTokenSource().token;
        await dragDropController.handleDrop(targetFolderItem, dataTransfer, token);

        // Verify: Physical move occurred
        const targetFile = path.join(targetFolder, 'Important File');
        assert.ok(fs.existsSync(targetFile), 'File should exist in target folder');
        assert.ok(!fs.existsSync(sourceFile), 'File should not exist in source location');

        // Verify: Config is STALE (still references old path)
        config = await configManager.loadConfiguration();
        projectGroup = config.logicalGroups.find(g => g.name === 'Scenario3a Project');
        assert.ok(projectGroup, 'Project group should still exist');
        const subgroup = projectGroup!.groups![0];
        assert.strictEqual(subgroup.items.length, 1, 'Subgroup should still have the item');
        assert.strictEqual(subgroup.items[0].path, sourceFile, 'Path in config is now invalid/stale');
    });

    test('Scenario 3b: should add file from physical folder to logical subgroup without moving', async () => {
        // Setup: Folder with file, and an empty subgroup
        const folderA = path.join(tempDir, 'scenario3b-folderA');
        fs.mkdirSync(folderA, { recursive: true });

        const fileInFolder = path.join(folderA, 'file-to-add.txt');
        fs.writeFileSync(fileInFolder, 'content to add');

        await configManager.createLogicalGroup('Scenario3b Project', 'Main project');
        await configManager.addToLogicalGroup('Scenario3b Project', folderA, 'Folder A', 'folder');
        await configManager.createNestedLogicalGroup('Scenario3b Project', 'Subgroup', 'Important files');

        // Verify subgroup is empty
        let config = await configManager.loadConfiguration();
        let projectGroup = config.logicalGroups.find(g => g.name === 'Scenario3b Project');
        assert.ok(projectGroup, 'Project group should exist');
        const subgroup = projectGroup!.groups![0];
        assert.strictEqual(subgroup.items.length, 0, 'Subgroup should be empty initially');

        // Drag file from inside Folder A (FileShortcutItem), drop on Subgroup (LogicalGroupItem)
        const fileItem = new FileShortcutItem('file-to-add.txt', vscode.Uri.file(fileInFolder));
        const subgroupItem = new LogicalGroupItem('Subgroup', 'Important files', undefined, vscode.TreeItemCollapsibleState.Collapsed, 'Scenario3b Project');

        const dataTransfer = new vscode.DataTransfer();
        dataTransfer.set('application/vnd.code.tree.shortcutsphysical', new vscode.DataTransferItem([fileItem]));

        const token = new vscode.CancellationTokenSource().token;
        await dragDropController.handleDrop(subgroupItem, dataTransfer, token);

        // Verify: NO physical move, file still in original location
        assert.ok(fs.existsSync(fileInFolder), 'File should still exist in original location');
        assert.strictEqual(fs.readdirSync(folderA).length, 1, 'Folder A should still have one file');

        // Verify: Config ADDED to subgroup
        config = await configManager.loadConfiguration();
        projectGroup = config.logicalGroups.find(g => g.name === 'Scenario3b Project');
        assert.ok(projectGroup, 'Project group should still exist');
        const updatedSubgroup = projectGroup!.groups![0];
        assert.strictEqual(updatedSubgroup.items.length, 1, 'Subgroup should have one item');
        assert.strictEqual(updatedSubgroup.items[0].name, 'file-to-add.txt');
        assert.strictEqual(updatedSubgroup.items[0].type, 'file');
    });

    test('Scenario 5: should move items between sibling subgroups', async () => {
        // Setup: Parent with two subgroups
        const testFilePath = path.join(tempDir, 'scenario5-file.txt');
        fs.writeFileSync(testFilePath, 'content in subgroup');

        await configManager.createLogicalGroup('Scenario5 Project', 'Main project');
        await configManager.createNestedLogicalGroup('Scenario5 Project', 'Subgroup A', 'First subgroup');
        await configManager.createNestedLogicalGroup('Scenario5 Project', 'Subgroup B', 'Second subgroup');
        await configManager.addToLogicalGroup('Scenario5 Project/Subgroup A', testFilePath, 'My File', 'file');

        // Verify initial state
        let config = await configManager.loadConfiguration();
        let projectGroup = config.logicalGroups.find(g => g.name === 'Scenario5 Project');
        assert.ok(projectGroup, 'Project group should exist');
        assert.strictEqual(projectGroup!.groups![0].items.length, 1, 'Subgroup A should have one item');
        assert.strictEqual(projectGroup!.groups![1].items.length, 0, 'Subgroup B should be empty');

        // Drag from Subgroup A to Subgroup B
        const sourceItem = new LogicalGroupChildItem('My File', vscode.Uri.file(testFilePath), 'file', 'Scenario5 Project/Subgroup A');
        const targetGroup = new LogicalGroupItem('Subgroup B', 'Second subgroup', undefined, vscode.TreeItemCollapsibleState.Collapsed, 'Scenario5 Project');

        const dataTransfer = new vscode.DataTransfer();
        dataTransfer.set('application/vnd.code.tree.shortcutslogical', new vscode.DataTransferItem([sourceItem]));

        const token = new vscode.CancellationTokenSource().token;
        await dragDropController.handleDrop(targetGroup, dataTransfer, token);

        // Verify: Config move (not copy)
        config = await configManager.loadConfiguration();
        projectGroup = config.logicalGroups.find(g => g.name === 'Scenario5 Project');
        assert.ok(projectGroup, 'Project group should still exist');
        assert.strictEqual(projectGroup!.groups![0].items.length, 0, 'Subgroup A should be empty (removed)');
        assert.strictEqual(projectGroup!.groups![1].items.length, 1, 'Subgroup B should have one item (added)');
        assert.strictEqual(projectGroup!.groups![1].items[0].name, 'My File');

        // Verify: No physical move
        assert.ok(fs.existsSync(testFilePath), 'File should still exist at original location');
    });

    test('Scenario 7: should move notes between logical groups', async () => {
        // Setup: Two groups, one with a note
        await configManager.createLogicalGroup('Scenario7 Group A', 'First group');
        await configManager.createLogicalGroup('Scenario7 Group B', 'Second group');
        const noteId = await configManager.createNote('Scenario7 Group A', 'My Note');

        // Get the note items from Group A
        let config = await configManager.loadConfiguration();
        let groupA = config.logicalGroups.find(g => g.name === 'Scenario7 Group A');
        let groupB = config.logicalGroups.find(g => g.name === 'Scenario7 Group B');
        assert.ok(groupA, 'Group A should exist');
        assert.ok(groupB, 'Group B should exist');
        const groupANotes = groupA!.items.filter(item => item.type === 'note');
        assert.strictEqual(groupANotes.length, 1, 'Group A should have one note');
        assert.strictEqual(groupANotes[0].noteId, noteId);
        const groupBNotes = groupB!.items.filter(item => item.type === 'note');
        assert.strictEqual(groupBNotes.length, 0, 'Group B should have no notes');

        // Create note item and target group
        const noteItem = new NoteShortcutItem('My Note', noteId, 'Scenario7 Group A');
        const targetGroup = new LogicalGroupItem('Scenario7 Group B', 'Second group');

        // Drag note from Group A to Group B
        const dataTransfer = new vscode.DataTransfer();
        dataTransfer.set('application/vnd.code.tree.shortcutslogical', new vscode.DataTransferItem([noteItem]));

        const token = new vscode.CancellationTokenSource().token;
        await dragDropController.handleDrop(targetGroup, dataTransfer, token);

        // Verify: Note moved in config
        config = await configManager.loadConfiguration();
        groupA = config.logicalGroups.find(g => g.name === 'Scenario7 Group A');
        groupB = config.logicalGroups.find(g => g.name === 'Scenario7 Group B');
        assert.ok(groupA, 'Group A should still exist');
        assert.ok(groupB, 'Group B should still exist');
        const groupANotesAfter = groupA!.items.filter(item => item.type === 'note');
        const groupBNotesAfter = groupB!.items.filter(item => item.type === 'note');
        assert.strictEqual(groupANotesAfter.length, 0, 'Group A should have no notes (removed)');
        assert.strictEqual(groupBNotesAfter.length, 1, 'Group B should have one note (added)');
        assert.strictEqual(groupBNotesAfter[0].noteId, noteId);
        assert.strictEqual(groupBNotesAfter[0].name, 'My Note');
    });
});

