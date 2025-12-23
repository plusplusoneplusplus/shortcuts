import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationManager } from '../../shortcuts/configuration-manager';
import { LogicalTreeDataProvider } from '../../shortcuts/logical-tree-data-provider';
import { ThemeManager } from '../../shortcuts/theme-manager';

suite('Nested Groups Tests', () => {
    let tempDir: string;
    let provider: LogicalTreeDataProvider;
    let configManager: ConfigurationManager;
    let themeManager: ThemeManager;
    let testFolder: string;
    let testFile: string;

    suiteSetup(async () => {
        // Use the workspace folder launched by the test runner for isolation
        tempDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-nested-test-'));

        // Create test folder structure
        testFolder = path.join(tempDir, 'test-folder');
        if (!fs.existsSync(testFolder)) {
            fs.mkdirSync(testFolder, { recursive: true });
        }
        testFile = path.join(testFolder, 'test-file.txt');
        fs.writeFileSync(testFile, 'test content');

        // Create additional test files
        const testFile2 = path.join(tempDir, 'test-file-2.txt');
        fs.writeFileSync(testFile2, 'test content 2');

        // Activate our extension
        const ext = vscode.extensions.getExtension('yihengtao.workspace-shortcuts');
        if (ext) {
            await ext.activate();
        }

        // Pre-create empty config so tests start with a clean slate
        const vscodePath = path.join(tempDir, '.vscode');
        fs.mkdirSync(vscodePath, { recursive: true });
        fs.writeFileSync(path.join(vscodePath, 'shortcuts.yaml'), 'logicalGroups: []\n');

        // Setup providers
        configManager = new ConfigurationManager(tempDir);
        themeManager = new ThemeManager();
        provider = new LogicalTreeDataProvider(tempDir, configManager, themeManager);
    });

    suiteTeardown(() => {
        // Clean up
        provider.dispose();
        configManager.dispose();
        themeManager.dispose();

        // Clean up temporary directory - ignore errors on Windows where files may be locked
        try {
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        } catch {
            // Ignore cleanup errors - on Windows, files may be locked by VSCode
            // The OS will clean up temp files eventually
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

    test('should create nested logical group', async () => {
        // Create parent group
        await configManager.createLogicalGroup('Parent', 'Parent description');

        // Create nested group
        await configManager.createNestedLogicalGroup('Parent', 'Child', 'Child description');

        // Verify structure
        const config = await configManager.loadConfiguration();
        assert.strictEqual(config.logicalGroups.length, 1);
        assert.strictEqual(config.logicalGroups[0].name, 'Parent');
        assert.ok(config.logicalGroups[0].groups);
        assert.strictEqual(config.logicalGroups[0].groups!.length, 1);
        assert.strictEqual(config.logicalGroups[0].groups![0].name, 'Child');
    });

    test('should add file to nested group', async () => {
        // Create parent and nested group
        await configManager.createLogicalGroup('Parent', 'Parent description');
        await configManager.createNestedLogicalGroup('Parent', 'Child', 'Child description');

        // Add file to nested group using path syntax
        await configManager.addToLogicalGroup('Parent/Child', testFile, 'test-file.txt', 'file');

        // Verify file was added to nested group
        const config = await configManager.loadConfiguration();
        const parentGroup = config.logicalGroups[0];
        assert.ok(parentGroup.groups);
        const childGroup = parentGroup.groups![0];
        assert.strictEqual(childGroup.items.length, 1);
        assert.strictEqual(childGroup.items[0].name, 'test-file.txt');
        assert.strictEqual(childGroup.items[0].type, 'file');
    });

    test('should add folder to nested group', async () => {
        // Create parent and nested group
        await configManager.createLogicalGroup('Parent', 'Parent description');
        await configManager.createNestedLogicalGroup('Parent', 'Child', 'Child description');

        // Add folder to nested group
        await configManager.addToLogicalGroup('Parent/Child', testFolder, 'test-folder', 'folder');

        // Verify folder was added to nested group
        const config = await configManager.loadConfiguration();
        const parentGroup = config.logicalGroups[0];
        assert.ok(parentGroup.groups);
        const childGroup = parentGroup.groups![0];
        assert.strictEqual(childGroup.items.length, 1);
        assert.strictEqual(childGroup.items[0].name, 'test-folder');
        assert.strictEqual(childGroup.items[0].type, 'folder');
    });

    test('should add multiple items to nested group', async () => {
        // Create parent and nested group
        await configManager.createLogicalGroup('Parent', 'Parent description');
        await configManager.createNestedLogicalGroup('Parent', 'Child', 'Child description');

        // Add multiple items
        await configManager.addToLogicalGroup('Parent/Child', testFile, 'test-file.txt', 'file');
        await configManager.addToLogicalGroup('Parent/Child', testFolder, 'test-folder', 'folder');

        // Verify both items were added
        const config = await configManager.loadConfiguration();
        const parentGroup = config.logicalGroups[0];
        assert.ok(parentGroup.groups);
        const childGroup = parentGroup.groups![0];
        assert.strictEqual(childGroup.items.length, 2);
        assert.ok(childGroup.items.some(i => i.name === 'test-file.txt'));
        assert.ok(childGroup.items.some(i => i.name === 'test-folder'));
    });

    test('should remove file from nested group', async () => {
        // Create parent and nested group
        await configManager.createLogicalGroup('Parent', 'Parent description');
        await configManager.createNestedLogicalGroup('Parent', 'Child', 'Child description');

        // Add file to nested group
        await configManager.addToLogicalGroup('Parent/Child', testFile, 'test-file.txt', 'file');

        // Verify file was added
        let config = await configManager.loadConfiguration();
        let childGroup = config.logicalGroups[0].groups![0];
        assert.strictEqual(childGroup.items.length, 1);

        // Remove file from nested group
        await configManager.removeFromLogicalGroup('Parent/Child', testFile);

        // Verify file was removed
        config = await configManager.loadConfiguration();
        childGroup = config.logicalGroups[0].groups![0];
        assert.strictEqual(childGroup.items.length, 0);
    });

    test('should handle deeply nested groups', async () => {
        // Create deeply nested structure: Parent > Child > Grandchild
        await configManager.createLogicalGroup('Parent', 'Parent description');
        await configManager.createNestedLogicalGroup('Parent', 'Child', 'Child description');
        await configManager.createNestedLogicalGroup('Parent/Child', 'Grandchild', 'Grandchild description');

        // Verify structure
        const config = await configManager.loadConfiguration();
        const parentGroup = config.logicalGroups[0];
        assert.ok(parentGroup.groups);
        const childGroup = parentGroup.groups![0];
        assert.ok(childGroup.groups);
        const grandchildGroup = childGroup.groups![0];
        assert.strictEqual(grandchildGroup.name, 'Grandchild');

        // Add file to grandchild
        await configManager.addToLogicalGroup('Parent/Child/Grandchild', testFile, 'test-file.txt', 'file');

        // Verify file was added to grandchild
        const updatedConfig = await configManager.loadConfiguration();
        const updatedGrandchild = updatedConfig.logicalGroups[0].groups![0].groups![0];
        assert.strictEqual(updatedGrandchild.items.length, 1);
        assert.strictEqual(updatedGrandchild.items[0].name, 'test-file.txt');
    });

    test('should prevent duplicate items in nested group', async () => {
        // Create parent and nested group
        await configManager.createLogicalGroup('Parent', 'Parent description');
        await configManager.createNestedLogicalGroup('Parent', 'Child', 'Child description');

        // Add file to nested group
        await configManager.addToLogicalGroup('Parent/Child', testFile, 'test-file.txt', 'file');

        // Try to add the same file again
        await configManager.addToLogicalGroup('Parent/Child', testFile, 'test-file.txt', 'file');

        // Verify no duplicate was added
        const config = await configManager.loadConfiguration();
        const childGroup = config.logicalGroups[0].groups![0];
        assert.strictEqual(childGroup.items.length, 1);
    });

    test('should handle items in both parent and child groups', async () => {
        // Create parent and nested group
        await configManager.createLogicalGroup('Parent', 'Parent description');
        await configManager.createNestedLogicalGroup('Parent', 'Child', 'Child description');

        // Add file to parent group
        await configManager.addToLogicalGroup('Parent', testFile, 'test-file.txt', 'file');

        // Add folder to child group
        await configManager.addToLogicalGroup('Parent/Child', testFolder, 'test-folder', 'folder');

        // Verify both items exist in their respective groups
        const config = await configManager.loadConfiguration();
        const parentGroup = config.logicalGroups[0];
        assert.strictEqual(parentGroup.items.length, 1);
        assert.strictEqual(parentGroup.items[0].name, 'test-file.txt');

        const childGroup = parentGroup.groups![0];
        assert.strictEqual(childGroup.items.length, 1);
        assert.strictEqual(childGroup.items[0].name, 'test-folder');
    });

    test('should handle multiple nested groups at same level', async () => {
        // Create parent with multiple children
        await configManager.createLogicalGroup('Parent', 'Parent description');
        await configManager.createNestedLogicalGroup('Parent', 'Child1', 'Child1 description');
        await configManager.createNestedLogicalGroup('Parent', 'Child2', 'Child2 description');

        // Add files to different children
        await configManager.addToLogicalGroup('Parent/Child1', testFile, 'test-file.txt', 'file');

        const testFile2 = path.join(tempDir, 'test-file-2.txt');
        fs.writeFileSync(testFile2, 'test content 2');
        await configManager.addToLogicalGroup('Parent/Child2', testFile2, 'test-file-2.txt', 'file');

        // Verify structure
        const config = await configManager.loadConfiguration();
        const parentGroup = config.logicalGroups[0];
        assert.strictEqual(parentGroup.groups!.length, 2);

        const child1 = parentGroup.groups![0];
        assert.strictEqual(child1.items.length, 1);
        assert.strictEqual(child1.items[0].name, 'test-file.txt');

        const child2 = parentGroup.groups![1];
        assert.strictEqual(child2.items.length, 1);
        assert.strictEqual(child2.items[0].name, 'test-file-2.txt');
    });

    test('should handle error when adding to non-existent nested group', async () => {
        // Create parent group only
        await configManager.createLogicalGroup('Parent', 'Parent description');

        // Try to add file to non-existent child group
        try {
            await configManager.addToLogicalGroup('Parent/NonExistent', testFile, 'test-file.txt', 'file');
            assert.fail('Should have thrown an error');
        } catch (error) {
            // Expected error
            assert.ok(error);
        }

        // Verify no items were added
        const config = await configManager.loadConfiguration();
        assert.strictEqual(config.logicalGroups[0].items.length, 0);
    });

    test('should render nested groups in tree view', async () => {
        // Create parent and nested group with items
        await configManager.createLogicalGroup('Parent', 'Parent description');
        await configManager.createNestedLogicalGroup('Parent', 'Child', 'Child description');
        await configManager.addToLogicalGroup('Parent/Child', testFile, 'test-file.txt', 'file');

        // Get root items (should show parent group)
        const rootItems = await provider.getChildren();
        assert.strictEqual(rootItems.length, 1);

        // Get children of parent group (should show nested group)
        const parentChildren = await provider.getChildren(rootItems[0]);
        assert.strictEqual(parentChildren.length, 1);

        // Get children of nested group (should show the file)
        const childChildren = await provider.getChildren(parentChildren[0]);
        assert.strictEqual(childChildren.length, 1);
    });
});

