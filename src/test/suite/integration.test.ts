import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigurationManager } from '../../shortcuts/configuration-manager';
import { LogicalTreeDataProvider } from '../../shortcuts/logical-tree-data-provider';
import { ThemeManager } from '../../shortcuts/theme-manager';
import { LogicalGroupItem } from '../../shortcuts/tree-items';
import {
    assertBasePathExists,
    assertGroupContainsItem,
    assertGroupCount,
    assertGroupDescription,
    assertGroupDoesNotContainItem,
    assertGroupDoesNotExist,
    assertGroupExists,
    assertGroupItemCount,
    assertItemUsesAlias,
    assertNestedGroupExists
} from '../helpers/assertion-helpers';
import {
    Fixture,
    copyFixture,
    createTestFile,
    createTestFolder
} from '../helpers/fixture-loader';

suite('Integration Tests - Group Operations', () => {
    let tempDir: string;
    let configManager: ConfigurationManager;
    let themeManager: ThemeManager;
    let provider: LogicalTreeDataProvider;

    setup(() => {
        // Create temporary directory for each test
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-integration-'));
        
        // Pre-create empty config so tests start with a clean slate
        const vscodePath = path.join(tempDir, '.vscode');
        fs.mkdirSync(vscodePath, { recursive: true });
        fs.writeFileSync(path.join(vscodePath, 'shortcuts.yaml'), 'logicalGroups: []\n');
        
        configManager = new ConfigurationManager(tempDir);
        themeManager = new ThemeManager();
        provider = new LogicalTreeDataProvider(tempDir, configManager, themeManager);
    });

    teardown(() => {
        // Cleanup
        provider.dispose();
        configManager.dispose();
        themeManager.dispose();

        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('Group Creation', () => {
        test('should create a new group in empty workspace', async () => {
            copyFixture(Fixture.EMPTY_WORKSPACE, tempDir);

            // Create a new group
            await configManager.createLogicalGroup('New Group', 'Test description');

            // Verify group was created
            const config = await configManager.loadConfiguration();
            assertGroupCount(config, 1);

            const group = assertGroupExists(config, 'New Group');
            assertGroupDescription(group, 'Test description');
            assertGroupItemCount(group, 0);
        });

        test('should create multiple groups', async () => {
            copyFixture(Fixture.EMPTY_WORKSPACE, tempDir);

            // Create multiple groups
            await configManager.createLogicalGroup('Group 1', 'First group');
            await configManager.createLogicalGroup('Group 2', 'Second group');
            await configManager.createLogicalGroup('Group 3', 'Third group');

            // Verify all groups were created
            const config = await configManager.loadConfiguration();
            assertGroupCount(config, 3);

            assertGroupExists(config, 'Group 1');
            assertGroupExists(config, 'Group 2');
            assertGroupExists(config, 'Group 3');
        });

        test('should prevent duplicate group names', async () => {
            copyFixture(Fixture.EMPTY_WORKSPACE, tempDir);

            await configManager.createLogicalGroup('Duplicate Group');
            await configManager.createLogicalGroup('Duplicate Group');

            const config = await configManager.loadConfiguration();
            assertGroupCount(config, 1);
        });

        test('should create nested groups', async () => {
            copyFixture(Fixture.EMPTY_WORKSPACE, tempDir);

            // Create parent and nested group
            await configManager.createLogicalGroup('Parent Group');
            await configManager.createNestedLogicalGroup('Parent Group', 'Child Group', 'Nested group');

            const config = await configManager.loadConfiguration();
            const parentGroup = assertGroupExists(config, 'Parent Group');
            const childGroup = assertNestedGroupExists(parentGroup, 'Child Group');
            assertGroupDescription(childGroup, 'Nested group');
        });

        test('should create deeply nested groups', async () => {
            copyFixture(Fixture.EMPTY_WORKSPACE, tempDir);

            // Create three levels of nesting
            await configManager.createLogicalGroup('Level 1');
            await configManager.createNestedLogicalGroup('Level 1', 'Level 2');
            await configManager.createNestedLogicalGroup('Level 1/Level 2', 'Level 3');

            const config = await configManager.loadConfiguration();
            const level1 = assertGroupExists(config, 'Level 1');
            const level2 = assertNestedGroupExists(level1, 'Level 2');
            assertNestedGroupExists(level2, 'Level 3');
        });
    });

    suite('Group Updates', () => {
        test('should rename a group', async () => {
            copyFixture(Fixture.SIMPLE_WORKSPACE, tempDir);

            // Load initial config to verify starting state
            let config = await configManager.loadConfiguration();
            assertGroupExists(config, 'Core Files');

            // Rename the group
            await configManager.renameLogicalGroup('Core Files', 'Essential Files');

            // Verify rename
            config = await configManager.loadConfiguration();
            assertGroupDoesNotExist(config, 'Core Files');
            assertGroupExists(config, 'Essential Files');
        });

        test('should prevent renaming to existing group name', async () => {
            copyFixture(Fixture.SIMPLE_WORKSPACE, tempDir);

            const config = await configManager.loadConfiguration();
            assertGroupExists(config, 'Core Files');
            assertGroupExists(config, 'Source Code');

            // Try to rename to existing name
            await configManager.renameLogicalGroup('Core Files', 'Source Code');

            // Verify original name still exists
            const updatedConfig = await configManager.loadConfiguration();
            assertGroupExists(updatedConfig, 'Core Files');
        });

        test('should update group description', async () => {
            copyFixture(Fixture.SIMPLE_WORKSPACE, tempDir);

            // Load config and modify description directly
            let config = await configManager.loadConfiguration();
            const group = assertGroupExists(config, 'Core Files');
            group.description = 'Updated description';

            await configManager.saveConfiguration(config);

            // Verify description was updated
            config = await configManager.loadConfiguration();
            const updatedGroup = assertGroupExists(config, 'Core Files');
            assertGroupDescription(updatedGroup, 'Updated description');
        });
    });

    suite('Group Deletion', () => {
        test('should delete a group', async () => {
            copyFixture(Fixture.SIMPLE_WORKSPACE, tempDir);

            let config = await configManager.loadConfiguration();
            assertGroupExists(config, 'Core Files');

            // Delete the group
            await configManager.deleteLogicalGroup('Core Files');

            // Verify deletion
            config = await configManager.loadConfiguration();
            assertGroupDoesNotExist(config, 'Core Files');
        });

        test('should delete all groups', async () => {
            copyFixture(Fixture.SIMPLE_WORKSPACE, tempDir);

            // Delete all groups
            await configManager.deleteLogicalGroup('Core Files');
            await configManager.deleteLogicalGroup('Source Code');

            const config = await configManager.loadConfiguration();
            assertGroupCount(config, 0);
        });

        test('should handle deleting non-existent group gracefully', async () => {
            copyFixture(Fixture.SIMPLE_WORKSPACE, tempDir);

            // Should not throw
            await configManager.deleteLogicalGroup('Non-Existent Group');

            const config = await configManager.loadConfiguration();
            // Original groups should still exist
            assertGroupExists(config, 'Core Files');
            assertGroupExists(config, 'Source Code');
        });
    });

    suite('File Addition to Groups', () => {
        test('should add file to group', async () => {
            copyFixture(Fixture.SIMPLE_WORKSPACE, tempDir);

            // Create a new file
            const newFile = createTestFile(tempDir, 'newfile.txt', 'test content');

            // Add to existing group
            await configManager.addToLogicalGroup('Core Files', newFile, 'New File', 'file');

            // Verify file was added
            const config = await configManager.loadConfiguration();
            const group = assertGroupExists(config, 'Core Files');
            assertGroupContainsItem(group, 'New File', 'file');
        });

        test('should add multiple files to group', async () => {
            copyFixture(Fixture.SIMPLE_WORKSPACE, tempDir);

            const file1 = createTestFile(tempDir, 'file1.txt', 'content 1');
            const file2 = createTestFile(tempDir, 'file2.txt', 'content 2');
            const file3 = createTestFile(tempDir, 'file3.txt', 'content 3');

            await configManager.addToLogicalGroup('Core Files', file1, 'File 1', 'file');
            await configManager.addToLogicalGroup('Core Files', file2, 'File 2', 'file');
            await configManager.addToLogicalGroup('Core Files', file3, 'File 3', 'file');

            const config = await configManager.loadConfiguration();
            const group = assertGroupExists(config, 'Core Files');
            assertGroupContainsItem(group, 'File 1', 'file');
            assertGroupContainsItem(group, 'File 2', 'file');
            assertGroupContainsItem(group, 'File 3', 'file');
        });

        test('should prevent adding duplicate file to group', async () => {
            copyFixture(Fixture.SIMPLE_WORKSPACE, tempDir);

            const file = createTestFile(tempDir, 'duplicate.txt', 'content');

            const config = await configManager.loadConfiguration();
            const group = assertGroupExists(config, 'Core Files');
            const initialCount = group.items.length;

            // Add file twice
            await configManager.addToLogicalGroup('Core Files', file, 'Duplicate', 'file');
            await configManager.addToLogicalGroup('Core Files', file, 'Duplicate', 'file');

            const updatedConfig = await configManager.loadConfiguration();
            const updatedGroup = assertGroupExists(updatedConfig, 'Core Files');

            // Should only have one more item
            assert.strictEqual(updatedGroup.items.length, initialCount + 1);
        });

        test('should add file with absolute path', async () => {
            copyFixture(Fixture.SIMPLE_WORKSPACE, tempDir);

            const file = createTestFile(tempDir, 'absolute.txt', 'content');
            const absolutePath = path.resolve(tempDir, file);

            await configManager.addToLogicalGroup('Core Files', absolutePath, 'Absolute File', 'file');

            const config = await configManager.loadConfiguration();
            const group = assertGroupExists(config, 'Core Files');
            assertGroupContainsItem(group, 'Absolute File', 'file');
        });

        test('should add file with relative path', async () => {
            copyFixture(Fixture.SIMPLE_WORKSPACE, tempDir);

            createTestFile(tempDir, 'relative.txt', 'content');

            await configManager.addToLogicalGroup('Core Files', 'relative.txt', 'Relative File', 'file');

            const config = await configManager.loadConfiguration();
            const group = assertGroupExists(config, 'Core Files');
            assertGroupContainsItem(group, 'Relative File', 'file');
        });

        test('should remove file from group', async () => {
            copyFixture(Fixture.SIMPLE_WORKSPACE, tempDir);

            const config = await configManager.loadConfiguration();
            const group = assertGroupExists(config, 'Core Files');
            assertGroupContainsItem(group, 'Package Config', 'file');

            // Remove the file
            const packageJsonPath = path.join(tempDir, 'package.json');
            await configManager.removeFromLogicalGroup('Core Files', packageJsonPath);

            const updatedConfig = await configManager.loadConfiguration();
            const updatedGroup = assertGroupExists(updatedConfig, 'Core Files');
            assertGroupDoesNotContainItem(updatedGroup, 'Package Config');
        });
    });

    suite('Folder Addition to Groups', () => {
        test('should add folder to group', async () => {
            copyFixture(Fixture.SIMPLE_WORKSPACE, tempDir);

            const newFolder = createTestFolder(tempDir, 'newfolder');

            await configManager.addToLogicalGroup('Core Files', newFolder, 'New Folder', 'folder');

            const config = await configManager.loadConfiguration();
            const group = assertGroupExists(config, 'Core Files');
            assertGroupContainsItem(group, 'New Folder', 'folder');
        });

        test('should add nested folder to group', async () => {
            copyFixture(Fixture.SIMPLE_WORKSPACE, tempDir);

            const nestedFolder = createTestFolder(tempDir, 'level1/level2/level3');

            await configManager.addToLogicalGroup(
                'Core Files',
                nestedFolder,
                'Nested Folder',
                'folder'
            );

            const config = await configManager.loadConfiguration();
            const group = assertGroupExists(config, 'Core Files');
            assertGroupContainsItem(group, 'Nested Folder', 'folder');
        });

        test('should remove folder from group', async () => {
            copyFixture(Fixture.SIMPLE_WORKSPACE, tempDir);

            const config = await configManager.loadConfiguration();
            const group = assertGroupExists(config, 'Source Code');
            assertGroupContainsItem(group, 'Source Directory', 'folder');

            // Remove the folder
            const srcPath = path.join(tempDir, 'src');
            await configManager.removeFromLogicalGroup('Source Code', srcPath);

            const updatedConfig = await configManager.loadConfiguration();
            const updatedGroup = assertGroupExists(updatedConfig, 'Source Code');
            assertGroupDoesNotContainItem(updatedGroup, 'Source Directory');
        });

        test('should add folder with files inside', async () => {
            copyFixture(Fixture.SIMPLE_WORKSPACE, tempDir);

            const folder = createTestFolder(tempDir, 'testfolder');
            createTestFile(tempDir, 'testfolder/file1.txt', 'content 1');
            createTestFile(tempDir, 'testfolder/file2.txt', 'content 2');

            await configManager.addToLogicalGroup('Core Files', folder, 'Test Folder', 'folder');

            const config = await configManager.loadConfiguration();
            const group = assertGroupExists(config, 'Core Files');
            const item = assertGroupContainsItem(group, 'Test Folder', 'folder');

            // Verify the folder exists and has files
            const folderPath = path.join(tempDir, 'testfolder');
            assert.ok(fs.existsSync(path.join(folderPath, 'file1.txt')));
            assert.ok(fs.existsSync(path.join(folderPath, 'file2.txt')));
        });
    });

    suite('Tree Data Provider Integration', () => {
        test('should load fixture groups correctly', async () => {
            copyFixture(Fixture.SIMPLE_WORKSPACE, tempDir);

            const children = await provider.getChildren();

            // Should have 2 groups
            assert.strictEqual(children.length, 2);

            const groupNames = children.map(c => (c as LogicalGroupItem).originalName);
            assert.ok(groupNames.includes('Core Files'));
            assert.ok(groupNames.includes('Source Code'));
        });

        test('should expand group items', async () => {
            copyFixture(Fixture.SIMPLE_WORKSPACE, tempDir);

            const groups = await provider.getChildren();
            const coreFilesGroup = groups.find(
                g => (g as LogicalGroupItem).originalName === 'Core Files'
            ) as LogicalGroupItem;

            assert.ok(coreFilesGroup);

            const items = await provider.getChildren(coreFilesGroup);

            // Core Files group should have 2 items
            assert.strictEqual(items.length, 2);
        });

        test('should refresh after group creation', async () => {
            copyFixture(Fixture.EMPTY_WORKSPACE, tempDir);

            let children = await provider.getChildren();
            assert.strictEqual(children.length, 0);

            // Create a group
            await configManager.createLogicalGroup('New Group');
            provider.refresh();

            children = await provider.getChildren();
            assert.strictEqual(children.length, 1);
        });

        test('should refresh after adding item to group', async () => {
            copyFixture(Fixture.SIMPLE_WORKSPACE, tempDir);

            const groups = await provider.getChildren();
            const coreFilesGroup = groups.find(
                g => (g as LogicalGroupItem).originalName === 'Core Files'
            ) as LogicalGroupItem;

            let items = await provider.getChildren(coreFilesGroup);
            const initialCount = items.length;

            // Add a file
            const newFile = createTestFile(tempDir, 'newfile.txt', 'content');
            await configManager.addToLogicalGroup('Core Files', newFile, 'New File', 'file');
            provider.refresh();

            items = await provider.getChildren(coreFilesGroup);
            assert.strictEqual(items.length, initialCount + 1);
        });
    });

    suite('Nested Groups Integration', () => {
        test('should load nested groups from fixture', async () => {
            copyFixture(Fixture.NESTED_GROUPS, tempDir);

            const config = await configManager.loadConfiguration();

            const frontendGroup = assertGroupExists(config, 'Frontend');
            assertNestedGroupExists(frontendGroup, 'Components');
            assertNestedGroupExists(frontendGroup, 'Styles');
        });

        test('should add items to nested groups', async () => {
            copyFixture(Fixture.NESTED_GROUPS, tempDir);

            const newFile = createTestFile(
                tempDir,
                'frontend/src/components/NewComponent.tsx',
                'export function NewComponent() {}'
            );

            // Add to nested group using path
            let config = await configManager.loadConfiguration();
            const frontendGroup = assertGroupExists(config, 'Frontend');
            const componentsGroup = assertNestedGroupExists(frontendGroup, 'Components');

            // Manually add to nested group
            componentsGroup.items.push({
                path: 'frontend/src/components/NewComponent.tsx',
                name: 'New Component',
                type: 'file'
            });

            await configManager.saveConfiguration(config);

            // Verify
            config = await configManager.loadConfiguration();
            const updatedFrontendGroup = assertGroupExists(config, 'Frontend');
            const updatedComponentsGroup = assertNestedGroupExists(updatedFrontendGroup, 'Components');
            assertGroupContainsItem(updatedComponentsGroup, 'New Component', 'file');
        });
    });

    suite('Base Paths Integration', () => {
        test('should load base paths from fixture', async () => {
            copyFixture(Fixture.MULTI_REPO, tempDir);

            const config = await configManager.loadConfiguration();

            assertBasePathExists(config, '@frontend');
            assertBasePathExists(config, '@backend');
        });

        test('should use aliases in item paths', async () => {
            copyFixture(Fixture.MULTI_REPO, tempDir);

            const config = await configManager.loadConfiguration();
            const frontendGroup = assertGroupExists(config, 'Frontend Components');
            const componentsItem = assertGroupContainsItem(frontendGroup, 'Components', 'folder');

            assertItemUsesAlias(componentsItem, '@frontend');
        });

        test('should add file using alias detection', async () => {
            copyFixture(Fixture.MULTI_REPO, tempDir);

            const newFile = createTestFile(
                tempDir,
                'frontend-repo/src/NewFile.ts',
                'export const test = true;'
            );

            await configManager.addToLogicalGroup(
                'Frontend Components',
                newFile,
                'New File',
                'file'
            );

            const config = await configManager.loadConfiguration();
            const group = assertGroupExists(config, 'Frontend Components');
            const item = assertGroupContainsItem(group, 'New File', 'file');

            // Should use alias
            assertItemUsesAlias(item, '@frontend');
        });
    });

    suite('End-to-End Workflows', () => {
        test('complete workflow: create group, add items, rename, delete item', async () => {
            copyFixture(Fixture.EMPTY_WORKSPACE, tempDir);

            // 1. Create a new group
            await configManager.createLogicalGroup('My Project', 'Project files');

            let config = await configManager.loadConfiguration();
            let group = assertGroupExists(config, 'My Project');
            assertGroupItemCount(group, 0);

            // 2. Add files and folders
            const file1 = createTestFile(tempDir, 'config.json', '{}');
            const folder1 = createTestFolder(tempDir, 'src');
            createTestFile(tempDir, 'src/index.ts', 'console.log("test");');

            await configManager.addToLogicalGroup('My Project', file1, 'Config', 'file');
            await configManager.addToLogicalGroup('My Project', folder1, 'Source', 'folder');

            config = await configManager.loadConfiguration();
            group = assertGroupExists(config, 'My Project');
            assertGroupItemCount(group, 2);

            // 3. Rename the group
            await configManager.renameLogicalGroup('My Project', 'My Awesome Project');

            config = await configManager.loadConfiguration();
            assertGroupDoesNotExist(config, 'My Project');
            group = assertGroupExists(config, 'My Awesome Project');
            assertGroupItemCount(group, 2);

            // 4. Remove an item
            await configManager.removeFromLogicalGroup('My Awesome Project', file1);

            config = await configManager.loadConfiguration();
            group = assertGroupExists(config, 'My Awesome Project');
            assertGroupItemCount(group, 1);
            assertGroupContainsItem(group, 'Source', 'folder');
            assertGroupDoesNotContainItem(group, 'Config');
        });

        test('complex workflow with nested groups', async () => {
            copyFixture(Fixture.EMPTY_WORKSPACE, tempDir);

            // Create parent group
            await configManager.createLogicalGroup('Application');

            // Create nested groups
            await configManager.createNestedLogicalGroup('Application', 'Frontend');
            await configManager.createNestedLogicalGroup('Application', 'Backend');
            await configManager.createNestedLogicalGroup('Application/Frontend', 'Components');

            let config = await configManager.loadConfiguration();
            const appGroup = assertGroupExists(config, 'Application');
            const frontendGroup = assertNestedGroupExists(appGroup, 'Frontend');
            const backendGroup = assertNestedGroupExists(appGroup, 'Backend');
            const componentsGroup = assertNestedGroupExists(frontendGroup, 'Components');

            // Add items to different levels
            const frontendFile = createTestFile(tempDir, 'frontend.ts', '');
            const componentFile = createTestFile(tempDir, 'Button.tsx', '');

            // Add to Frontend group
            config.logicalGroups[0].groups![0].items.push({
                path: 'frontend.ts',
                name: 'Frontend Entry',
                type: 'file'
            });

            // Add to Components nested group
            config.logicalGroups[0].groups![0].groups![0].items.push({
                path: 'Button.tsx',
                name: 'Button Component',
                type: 'file'
            });

            await configManager.saveConfiguration(config);

            // Verify final structure
            config = await configManager.loadConfiguration();
            const finalAppGroup = assertGroupExists(config, 'Application');
            const finalFrontendGroup = assertNestedGroupExists(finalAppGroup, 'Frontend');
            const finalComponentsGroup = assertNestedGroupExists(finalFrontendGroup, 'Components');

            assertGroupItemCount(finalFrontendGroup, 1);
            assertGroupItemCount(finalComponentsGroup, 1);
        });
    });
});

