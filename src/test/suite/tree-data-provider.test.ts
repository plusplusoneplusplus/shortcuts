import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationManager } from '../../shortcuts/configuration-manager';
import { LogicalTreeDataProvider } from '../../shortcuts/logical-tree-data-provider';
import { ThemeManager } from '../../shortcuts/theme-manager';
import { FileShortcutItem, FolderShortcutItem, LogicalGroupChildItem, LogicalGroupItem } from '../../shortcuts/tree-items';

suite('LogicalTreeDataProvider Test Suite', () => {
    let tempDir: string;
    let provider: LogicalTreeDataProvider;
    let configManager: ConfigurationManager;
    let themeManager: ThemeManager;
    let testFolder: string;
    let testFile: string;

    suiteSetup(async () => {
        // Create temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-test-'));

        // Create test folder structure
        testFolder = path.join(tempDir, 'test-folder');
        fs.mkdirSync(testFolder);

        testFile = path.join(testFolder, 'test-file.txt');
        fs.writeFileSync(testFile, 'test content');

        // Create nested folder structure
        const nestedFolder = path.join(testFolder, 'nested');
        fs.mkdirSync(nestedFolder);
        fs.writeFileSync(path.join(nestedFolder, 'nested-file.js'), 'console.log("test");');

        // Create hidden file (should be ignored)
        fs.writeFileSync(path.join(testFolder, '.hidden'), 'hidden content');
    });

    suiteTeardown(() => {
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    setup(() => {
        configManager = new ConfigurationManager(tempDir);
        themeManager = new ThemeManager();
        provider = new LogicalTreeDataProvider(tempDir, configManager, themeManager);
    });

    teardown(() => {
        provider.dispose();
        configManager.dispose();
        themeManager.dispose();

        // Clean up config file between tests
        const configPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
        if (fs.existsSync(configPath)) {
            fs.unlinkSync(configPath);
        }
    });

    test('should implement TreeDataProvider interface', () => {
        assert.ok(provider.getTreeItem);
        assert.ok(provider.getChildren);
        assert.ok(provider.onDidChangeTreeData);
    });

    test('should return empty array when no groups configured', async () => {
        const children = await provider.getChildren();
        assert.strictEqual(children.length, 0);
    });

    test('should return configured logical groups as root elements', async () => {
        const configPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });

        const config = `logicalGroups:
  - name: Test Group
    description: Test Description
    items:
      - path: test-folder
        name: Test Folder
        type: folder`;

        fs.writeFileSync(configPath, config);

        const children = await provider.getChildren();
        assert.strictEqual(children.length, 1);
        assert.ok(children[0] instanceof LogicalGroupItem);
        assert.strictEqual(children[0].originalName, 'Test Group');
        assert.strictEqual(children[0].contextValue, 'logicalGroup');
    });

    test('should return group contents correctly', async () => {
        const configPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });

        const config = `logicalGroups:
  - name: Test Group
    items:
      - path: test-folder
        name: Test Folder
        type: folder
      - path: test-folder/test-file.txt
        name: Test File
        type: file`;

        fs.writeFileSync(configPath, config);

        const rootChildren = await provider.getChildren();
        const groupItem = rootChildren[0] as LogicalGroupItem;

        const groupContents = await provider.getChildren(groupItem);
        assert.strictEqual(groupContents.length, 2);

        // Check that items are LogicalGroupChildItem
        assert.ok(groupContents[0] instanceof LogicalGroupChildItem);
        assert.ok(groupContents[1] instanceof LogicalGroupChildItem);
    });

    test('should expand folder items within logical groups', async () => {
        const configPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });

        const config = `logicalGroups:
  - name: Test Group
    items:
      - path: test-folder
        name: Test Folder
        type: folder`;

        fs.writeFileSync(configPath, config);

        const rootChildren = await provider.getChildren();
        const groupItem = rootChildren[0] as LogicalGroupItem;
        const groupContents = await provider.getChildren(groupItem);
        const folderItem = groupContents[0] as LogicalGroupChildItem;

        // Expand the folder
        const folderContents = await provider.getChildren(folderItem);

        // Should have nested folder and test file, but not hidden file
        assert.ok(folderContents.length >= 2);

        const nestedFolder = folderContents.find(item => item.label === 'nested');
        const testFileItem = folderContents.find(item => item.label === 'test-file.txt');

        assert.ok(nestedFolder instanceof FolderShortcutItem);
        assert.ok(testFileItem instanceof FileShortcutItem);
    });

    test('should skip hidden files in folder expansion', async () => {
        const configPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });

        const config = `logicalGroups:
  - name: Test Group
    items:
      - path: test-folder
        name: Test Folder
        type: folder`;

        fs.writeFileSync(configPath, config);

        const rootChildren = await provider.getChildren();
        const groupItem = rootChildren[0] as LogicalGroupItem;
        const groupContents = await provider.getChildren(groupItem);
        const folderItem = groupContents[0] as LogicalGroupChildItem;

        const folderContents = await provider.getChildren(folderItem);

        // Should not include .hidden file
        const hiddenFile = folderContents.find(item => item.label === '.hidden');
        assert.strictEqual(hiddenFile, undefined);
    });

    test('should return empty array for file items (no children)', async () => {
        const fileItem = new FileShortcutItem('test.txt', vscode.Uri.file('/test.txt'));
        const children = await provider.getChildren(fileItem);
        assert.strictEqual(children.length, 0);
    });

    test('should handle non-existent paths gracefully', async () => {
        const configPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });

        const config = `logicalGroups:
  - name: Test Group
    items:
      - path: non-existent-folder
        name: Missing Folder
        type: folder`;

        fs.writeFileSync(configPath, config);

        const children = await provider.getChildren();
        // Should have the group, but the group should have no items
        assert.strictEqual(children.length, 1);

        const groupContents = await provider.getChildren(children[0]);
        assert.strictEqual(groupContents.length, 0);
    });

    test('should sort group contents correctly', async () => {
        const configPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });

        const config = `logicalGroups:
  - name: Test Group
    items:
      - path: test-folder/test-file.txt
        name: Z File
        type: file
      - path: test-folder
        name: A Folder
        type: folder
      - path: test-folder/nested
        name: M Folder
        type: folder`;

        fs.writeFileSync(configPath, config);

        const rootChildren = await provider.getChildren();
        const groupItem = rootChildren[0] as LogicalGroupItem;
        const groupContents = await provider.getChildren(groupItem);

        // Should be sorted: folders first, then files, both alphabetically
        assert.ok(groupContents[0].label && typeof groupContents[0].label === 'string' && groupContents[0].label.includes('A Folder'));
        assert.ok(groupContents[1].label && typeof groupContents[1].label === 'string' && groupContents[1].label.includes('M Folder'));
        assert.ok(groupContents[2].label && typeof groupContents[2].label === 'string' && groupContents[2].label.includes('Z File'));
    });

    test('should handle absolute paths correctly', async () => {
        const configPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });

        const config = `logicalGroups:
  - name: Test Group
    items:
      - path: ${testFolder}
        name: Absolute Path Test
        type: folder`;

        fs.writeFileSync(configPath, config);

        const children = await provider.getChildren();
        assert.strictEqual(children.length, 1);

        const groupContents = await provider.getChildren(children[0]);
        assert.strictEqual(groupContents.length, 1);
    });

    test('should emit change events on refresh', (done) => {
        let eventFired = false;

        const disposable = provider.onDidChangeTreeData(() => {
            eventFired = true;
            disposable.dispose();
            assert.ok(true, 'Tree data change event was fired');
            done();
        });

        provider.refresh();

        // Fallback timeout in case event doesn't fire
        setTimeout(() => {
            if (!eventFired) {
                disposable.dispose();
                assert.fail('Tree data change event was not fired');
                done();
            }
        }, 100);
    });

    test('should return TreeItem for getTreeItem', () => {
        const groupItem = new LogicalGroupItem(
            'Test Group',
            'Description',
            undefined,
            vscode.TreeItemCollapsibleState.Collapsed
        );

        const treeItem = provider.getTreeItem(groupItem);
        assert.strictEqual(treeItem, groupItem);
        assert.ok(treeItem instanceof vscode.TreeItem);
    });

    test('should provide configuration manager access', () => {
        const configMgr = provider.getConfigurationManager();
        assert.ok(configMgr);
        assert.ok(typeof configMgr.loadConfiguration === 'function');
    });

    test('should handle errors in getChildren gracefully', async () => {
        // Create a provider with an invalid workspace root
        const invalidConfigManager = new ConfigurationManager('/invalid/path');
        const invalidThemeManager = new ThemeManager();
        const invalidProvider = new LogicalTreeDataProvider('/invalid/path', invalidConfigManager, invalidThemeManager);

        try {
            const children = await invalidProvider.getChildren();
            assert.ok(Array.isArray(children), 'Should return array even on error');
        } finally {
            invalidProvider.dispose();
            invalidConfigManager.dispose();
            invalidThemeManager.dispose();
        }
    });

    test('should migrate old physical shortcuts to logical groups', async () => {
        const configPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });

        // Old format with physical shortcuts
        const oldConfig = `shortcuts:
  - path: test-folder
    name: Old Shortcut`;

        fs.writeFileSync(configPath, oldConfig);

        const children = await provider.getChildren();

        // Should have migrated to a logical group
        assert.strictEqual(children.length, 1);
        assert.ok(children[0] instanceof LogicalGroupItem);
        assert.strictEqual(children[0].originalName, 'Old Shortcut');
    });

    test('should handle multiple groups', async () => {
        const configPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });

        const config = `logicalGroups:
  - name: Group 1
    items:
      - path: test-folder
        name: Folder 1
        type: folder
  - name: Group 2
    items:
      - path: test-folder/test-file.txt
        name: File 1
        type: file`;

        fs.writeFileSync(configPath, config);

        const children = await provider.getChildren();
        assert.strictEqual(children.length, 2);
        assert.ok(children[0] instanceof LogicalGroupItem);
        assert.ok(children[1] instanceof LogicalGroupItem);
        assert.strictEqual((children[0] as LogicalGroupItem).originalName, 'Group 1');
        assert.strictEqual((children[1] as LogicalGroupItem).originalName, 'Group 2');
    });

    test('should handle search filtering', async () => {
        const configPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });

        const config = `logicalGroups:
  - name: Match Group
    items:
      - path: test-folder
        name: Test
        type: folder
  - name: Other Group
    items:
      - path: test-folder
        name: Test
        type: folder`;

        fs.writeFileSync(configPath, config);

        provider.setSearchFilter('match');
        const children = await provider.getChildren();

        // Should only show groups matching the filter
        assert.strictEqual(children.length, 1);
        assert.ok(children[0] instanceof LogicalGroupItem);
        assert.strictEqual((children[0] as LogicalGroupItem).originalName, 'Match Group');

        // Clear filter
        provider.clearSearchFilter();
        const allChildren = await provider.getChildren();
        assert.strictEqual(allChildren.length, 2);
    });
});
