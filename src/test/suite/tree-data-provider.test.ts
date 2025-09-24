import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ShortcutsTreeDataProvider } from '../../shortcuts/tree-data-provider';
import { FolderShortcutItem, FileShortcutItem } from '../../shortcuts/tree-items';
import { ShortcutsConfig } from '../../shortcuts/types';

suite('ShortcutsTreeDataProvider Test Suite', () => {
    let tempDir: string;
    let provider: ShortcutsTreeDataProvider;
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
        provider = new ShortcutsTreeDataProvider(tempDir);
    });

    teardown(() => {
        provider.dispose();
    });

    test('should implement TreeDataProvider interface', () => {
        assert.ok(provider.getTreeItem);
        assert.ok(provider.getChildren);
        assert.ok(provider.onDidChangeTreeData);
    });

    test('should return empty array when no shortcuts configured', async () => {
        const children = await provider.getChildren();
        assert.strictEqual(children.length, 0);
    });

    test('should return configured shortcuts as root elements', async () => {
        // Create test configuration
        const configPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });

        const config = `shortcuts:
  - path: test-folder
    name: Test Folder`;

        fs.writeFileSync(configPath, config);

        const children = await provider.getChildren();
        assert.strictEqual(children.length, 1);
        assert.ok(children[0] instanceof FolderShortcutItem);
        assert.strictEqual(children[0].label, 'Test Folder');
        assert.strictEqual(children[0].contextValue, 'folder');
    });

    test('should handle folder contents correctly', async () => {
        // Create test configuration
        const configPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });

        const config = `shortcuts:
  - path: test-folder`;

        fs.writeFileSync(configPath, config);

        const rootChildren = await provider.getChildren();
        const folderItem = rootChildren[0] as FolderShortcutItem;

        const folderContents = await provider.getChildren(folderItem);

        // Should have nested folder and test file, but not hidden file
        assert.strictEqual(folderContents.length, 2);

        // Check that directory comes first (sorted)
        const nestedFolder = folderContents.find(item => item.label === 'nested');
        const testFileItem = folderContents.find(item => item.label === 'test-file.txt');

        assert.ok(nestedFolder instanceof FolderShortcutItem);
        assert.ok(testFileItem instanceof FileShortcutItem);

        // Verify sorting: directories first
        assert.ok(folderContents.indexOf(nestedFolder!) < folderContents.indexOf(testFileItem!));
    });

    test('should skip hidden files and directories', async () => {
        const configPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });

        const config = `shortcuts:
  - path: test-folder`;

        fs.writeFileSync(configPath, config);

        const rootChildren = await provider.getChildren();
        const folderItem = rootChildren[0] as FolderShortcutItem;

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

        const config = `shortcuts:
  - path: non-existent-folder
    name: Missing Folder`;

        fs.writeFileSync(configPath, config);

        const children = await provider.getChildren();
        // Should skip non-existent paths
        assert.strictEqual(children.length, 0);
    });

    test('should handle file paths (non-directories) gracefully', async () => {
        // Create a file instead of directory
        const testFilePath = path.join(tempDir, 'just-a-file.txt');
        fs.writeFileSync(testFilePath, 'content');

        const configPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });

        const config = `shortcuts:
  - path: just-a-file.txt
    name: File Path`;

        fs.writeFileSync(configPath, config);

        const children = await provider.getChildren();
        // Should skip file paths (only directories allowed)
        assert.strictEqual(children.length, 0);
    });

    test('should use folder name as default when name not specified', async () => {
        const configPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });

        const config = `shortcuts:
  - path: test-folder`;

        fs.writeFileSync(configPath, config);

        const children = await provider.getChildren();
        assert.strictEqual(children.length, 1);
        assert.strictEqual(children[0].label, 'test-folder');
    });

    test('should resolve relative paths correctly', async () => {
        const configPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });

        const config = `shortcuts:
  - path: ./test-folder
    name: Relative Path Test`;

        fs.writeFileSync(configPath, config);

        const children = await provider.getChildren();
        assert.strictEqual(children.length, 1);
        assert.strictEqual(children[0].label, 'Relative Path Test');
    });

    test('should handle absolute paths correctly', async () => {
        const configPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });

        const config = `shortcuts:
  - path: ${testFolder}
    name: Absolute Path Test`;

        fs.writeFileSync(configPath, config);

        const children = await provider.getChildren();
        assert.strictEqual(children.length, 1);
        assert.strictEqual(children[0].label, 'Absolute Path Test');
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
        const folderItem = new FolderShortcutItem(
            'Test',
            vscode.Uri.file('/test'),
            vscode.TreeItemCollapsibleState.Collapsed
        );

        const treeItem = provider.getTreeItem(folderItem);
        assert.strictEqual(treeItem, folderItem);
        assert.ok(treeItem instanceof vscode.TreeItem);
    });

    test('should sort folder contents correctly', async () => {
        // Create additional test files with different names
        const folderA = path.join(testFolder, 'a-folder');
        const folderZ = path.join(testFolder, 'z-folder');
        fs.mkdirSync(folderA);
        fs.mkdirSync(folderZ);

        fs.writeFileSync(path.join(testFolder, 'a-file.txt'), 'content');
        fs.writeFileSync(path.join(testFolder, 'z-file.txt'), 'content');

        const configPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });

        const config = `shortcuts:
  - path: test-folder`;

        fs.writeFileSync(configPath, config);

        const rootChildren = await provider.getChildren();
        const folderItem = rootChildren[0] as FolderShortcutItem;

        const folderContents = await provider.getChildren(folderItem);

        // Should be sorted: folders first (alphabetically), then files (alphabetically)
        const labels = folderContents.map(item => item.label);

        // Find indices of different types
        const firstFileIndex = folderContents.findIndex(item => item instanceof FileShortcutItem);
        const lastFolderIndex = folderContents.map(item => item instanceof FolderShortcutItem).lastIndexOf(true);

        // All folders should come before all files
        assert.ok(lastFolderIndex < firstFileIndex, 'Folders should come before files');

        // Folders should be alphabetically sorted
        const folderLabels = folderContents
            .filter(item => item instanceof FolderShortcutItem)
            .map(item => item.label);
        const sortedFolderLabels = [...folderLabels].sort();
        assert.deepStrictEqual(folderLabels, sortedFolderLabels, 'Folders should be sorted alphabetically');

        // Files should be alphabetically sorted
        const fileLabels = folderContents
            .filter(item => item instanceof FileShortcutItem)
            .map(item => item.label);
        const sortedFileLabels = [...fileLabels].sort();
        assert.deepStrictEqual(fileLabels, sortedFileLabels, 'Files should be sorted alphabetically');
    });

    test('should provide configuration manager access', () => {
        const configManager = provider.getConfigurationManager();
        assert.ok(configManager);
        assert.ok(typeof configManager.loadConfiguration === 'function');
    });

    test('should handle errors in getChildren gracefully', async () => {
        // Create a provider with an invalid workspace root
        const invalidProvider = new ShortcutsTreeDataProvider('/invalid/path');

        try {
            const children = await invalidProvider.getChildren();
            assert.ok(Array.isArray(children), 'Should return array even on error');
        } finally {
            invalidProvider.dispose();
        }
    });

    test('should handle malformed configuration gracefully', async () => {
        const configPath = path.join(tempDir, '.vscode', 'shortcuts.yaml');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });

        // Invalid YAML
        const invalidConfig = `shortcuts:
  - path: test-folder
    name: Test
  - invalid yaml structure
      broken: [[[`;

        fs.writeFileSync(configPath, invalidConfig);

        const children = await provider.getChildren();
        // Should handle gracefully and return empty array
        assert.ok(Array.isArray(children));
    });
});