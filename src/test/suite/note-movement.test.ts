import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { ConfigurationManager } from '../../shortcuts/configuration-manager';
import { ShortcutsConfig } from '../../shortcuts/types';

suite('Note Movement Integration Tests', () => {
    let configManager: ConfigurationManager;
    let testWorkspaceRoot: string;
    let configPath: string;
    let mockContext: vscode.ExtensionContext;

    setup(async () => {
        // Create a temporary workspace directory
        const tmpDir = path.join(__dirname, '..', '..', '..', 'test-workspace-note-movement');
        testWorkspaceRoot = tmpDir;

        // Clean up if exists
        if (fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }

        // Create workspace directories
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.mkdirSync(path.join(tmpDir, '.vscode'), { recursive: true });

        configPath = path.join(tmpDir, '.vscode', 'shortcuts.yaml');

        // Create a mock extension context with minimal required properties
        const globalState = new Map<string, any>();
        const mockGlobalState: vscode.Memento & { setKeysForSync(keys: readonly string[]): void } = {
            get: <T>(key: string, defaultValue?: T): T => {
                return globalState.has(key) ? globalState.get(key) : (defaultValue as T);
            },
            update: async (key: string, value: any): Promise<void> => {
                globalState.set(key, value);
            },
            keys: () => Array.from(globalState.keys()),
            setKeysForSync: (keys: readonly string[]) => {}
        };

        const mockWorkspaceState: vscode.Memento & { setKeysForSync(keys: readonly string[]): void } = {
            get: <T>(key: string, defaultValue?: T): T => defaultValue as T,
            update: async (key: string, value: any): Promise<void> => {},
            keys: () => [],
            setKeysForSync: (keys: readonly string[]) => {}
        };

        mockContext = {
            globalState: mockGlobalState,
            subscriptions: [],
            extensionPath: tmpDir,
            storagePath: tmpDir,
            globalStoragePath: tmpDir,
            logPath: tmpDir,
            extensionUri: vscode.Uri.file(tmpDir),
            environmentVariableCollection: {} as any,
            extensionMode: vscode.ExtensionMode.Test,
            storageUri: vscode.Uri.file(tmpDir),
            globalStorageUri: vscode.Uri.file(tmpDir),
            logUri: vscode.Uri.file(tmpDir),
            asAbsolutePath: (relativePath: string) => path.join(tmpDir, relativePath),
            workspaceState: mockWorkspaceState,
            secrets: {} as any,
            extension: {} as any,
            languageModelAccessInformation: {} as any
        };

        // Initialize configuration manager
        configManager = new ConfigurationManager(testWorkspaceRoot, mockContext);
    });

    teardown(() => {
        // Clean up test workspace
        if (fs.existsSync(testWorkspaceRoot)) {
            fs.rmSync(testWorkspaceRoot, { recursive: true, force: true });
        }
    });

    test('Should move note between top-level groups', async () => {
        // Create initial configuration with two top-level groups and a note
        const initialConfig: ShortcutsConfig = {
            logicalGroups: [
                {
                    name: 'Group A',
                    items: []
                },
                {
                    name: 'Group B',
                    items: []
                }
            ]
        };

        await configManager.saveConfiguration(initialConfig);

        // Create a note in Group A
        const noteId = await configManager.createNote('Group A', 'Test Note');

        // Verify note was created in Group A
        let config = await configManager.loadConfiguration();
        const groupA = config.logicalGroups.find(g => g.name === 'Group A');
        assert.ok(groupA, 'Group A should exist');
        assert.strictEqual(groupA.items.length, 1, 'Group A should have 1 item');
        assert.strictEqual(groupA.items[0].type, 'note', 'Item should be a note');
        assert.strictEqual(groupA.items[0].noteId, noteId, 'Note ID should match');

        // Move note from Group A to Group B
        await configManager.moveNote('Group A', 'Group B', noteId);

        // Verify note was moved
        config = await configManager.loadConfiguration();
        const updatedGroupA = config.logicalGroups.find(g => g.name === 'Group A');
        const updatedGroupB = config.logicalGroups.find(g => g.name === 'Group B');

        assert.ok(updatedGroupA, 'Group A should still exist');
        assert.ok(updatedGroupB, 'Group B should exist');
        assert.strictEqual(updatedGroupA.items.length, 0, 'Group A should have 0 items after move');
        assert.strictEqual(updatedGroupB.items.length, 1, 'Group B should have 1 item after move');
        assert.strictEqual(updatedGroupB.items[0].type, 'note', 'Item in Group B should be a note');
        assert.strictEqual(updatedGroupB.items[0].noteId, noteId, 'Note ID should match in Group B');
    });

    test('Should move note between nested subgroups', async () => {
        console.log('\n=== TEST: Move note between nested subgroups ===');

        // Create initial configuration with nested groups
        const initialConfig: ShortcutsConfig = {
            logicalGroups: [
                {
                    name: 'Parent',
                    items: [],
                    groups: [
                        {
                            name: 'SubGroup A',
                            items: []
                        },
                        {
                            name: 'SubGroup B',
                            items: []
                        }
                    ]
                }
            ]
        };

        console.log('Saving initial config with nested groups...');
        await configManager.saveConfiguration(initialConfig);

        // Create a note in Parent/SubGroup A
        console.log('Creating note in Parent/SubGroup A...');
        const noteId = await configManager.createNote('Parent/SubGroup A', 'Test Note in SubGroup');

        // Verify note was created in SubGroup A
        console.log('Verifying note creation...');
        let config = await configManager.loadConfiguration();
        console.log('Config after note creation:', JSON.stringify(config, null, 2));

        const parent = config.logicalGroups.find(g => g.name === 'Parent');
        assert.ok(parent, 'Parent group should exist');
        assert.ok(parent.groups, 'Parent should have nested groups');

        const subGroupA = parent.groups.find(g => g.name === 'SubGroup A');
        assert.ok(subGroupA, 'SubGroup A should exist');
        assert.strictEqual(subGroupA.items.length, 1, 'SubGroup A should have 1 item');
        assert.strictEqual(subGroupA.items[0].type, 'note', 'Item should be a note');
        assert.strictEqual(subGroupA.items[0].noteId, noteId, 'Note ID should match');
        console.log('Note verified in SubGroup A:', subGroupA.items[0]);

        // Move note from Parent/SubGroup A to Parent/SubGroup B
        console.log('\nAttempting to move note from Parent/SubGroup A to Parent/SubGroup B...');
        console.log('Source path: "Parent/SubGroup A"');
        console.log('Target path: "Parent/SubGroup B"');
        console.log('Note ID:', noteId);

        await configManager.moveNote('Parent/SubGroup A', 'Parent/SubGroup B', noteId);

        // Verify note was moved
        console.log('\nVerifying note was moved...');
        config = await configManager.loadConfiguration();
        console.log('Config after move:', JSON.stringify(config, null, 2));

        const updatedParent = config.logicalGroups.find(g => g.name === 'Parent');
        assert.ok(updatedParent, 'Parent group should still exist');
        assert.ok(updatedParent.groups, 'Parent should still have nested groups');

        const updatedSubGroupA = updatedParent.groups.find(g => g.name === 'SubGroup A');
        const updatedSubGroupB = updatedParent.groups.find(g => g.name === 'SubGroup B');

        assert.ok(updatedSubGroupA, 'SubGroup A should still exist');
        assert.ok(updatedSubGroupB, 'SubGroup B should exist');

        console.log('SubGroup A items:', updatedSubGroupA.items);
        console.log('SubGroup B items:', updatedSubGroupB.items);

        assert.strictEqual(updatedSubGroupA.items.length, 0, 'SubGroup A should have 0 items after move');
        assert.strictEqual(updatedSubGroupB.items.length, 1, 'SubGroup B should have 1 item after move');
        assert.strictEqual(updatedSubGroupB.items[0].type, 'note', 'Item in SubGroup B should be a note');
        assert.strictEqual(updatedSubGroupB.items[0].noteId, noteId, 'Note ID should match in SubGroup B');

        console.log('=== TEST PASSED ===\n');
    });

    test('Should move note from top-level group to nested subgroup', async () => {
        console.log('\n=== TEST: Move note from top-level to nested subgroup ===');

        // Create initial configuration
        const initialConfig: ShortcutsConfig = {
            logicalGroups: [
                {
                    name: 'Top Level Group',
                    items: []
                },
                {
                    name: 'Parent',
                    items: [],
                    groups: [
                        {
                            name: 'SubGroup',
                            items: []
                        }
                    ]
                }
            ]
        };

        await configManager.saveConfiguration(initialConfig);

        // Create a note in top-level group
        const noteId = await configManager.createNote('Top Level Group', 'Test Note');

        // Move note from top-level to nested subgroup
        console.log('Moving note from "Top Level Group" to "Parent/SubGroup"...');
        await configManager.moveNote('Top Level Group', 'Parent/SubGroup', noteId);

        // Verify note was moved
        const config = await configManager.loadConfiguration();
        const topLevel = config.logicalGroups.find(g => g.name === 'Top Level Group');
        const parent = config.logicalGroups.find(g => g.name === 'Parent');

        assert.ok(topLevel, 'Top Level Group should exist');
        assert.strictEqual(topLevel.items.length, 0, 'Top Level Group should have 0 items');

        assert.ok(parent, 'Parent should exist');
        assert.ok(parent.groups, 'Parent should have nested groups');
        const subGroup = parent.groups.find(g => g.name === 'SubGroup');
        assert.ok(subGroup, 'SubGroup should exist');
        assert.strictEqual(subGroup.items.length, 1, 'SubGroup should have 1 item');
        assert.strictEqual(subGroup.items[0].noteId, noteId, 'Note ID should match');

        console.log('=== TEST PASSED ===\n');
    });

    test('Should move note from nested subgroup to top-level group', async () => {
        console.log('\n=== TEST: Move note from nested subgroup to top-level ===');

        // Create initial configuration
        const initialConfig: ShortcutsConfig = {
            logicalGroups: [
                {
                    name: 'Top Level Group',
                    items: []
                },
                {
                    name: 'Parent',
                    items: [],
                    groups: [
                        {
                            name: 'SubGroup',
                            items: []
                        }
                    ]
                }
            ]
        };

        await configManager.saveConfiguration(initialConfig);

        // Create a note in nested subgroup
        const noteId = await configManager.createNote('Parent/SubGroup', 'Test Note');

        // Move note from nested subgroup to top-level
        console.log('Moving note from "Parent/SubGroup" to "Top Level Group"...');
        await configManager.moveNote('Parent/SubGroup', 'Top Level Group', noteId);

        // Verify note was moved
        const config = await configManager.loadConfiguration();
        const topLevel = config.logicalGroups.find(g => g.name === 'Top Level Group');
        const parent = config.logicalGroups.find(g => g.name === 'Parent');

        assert.ok(topLevel, 'Top Level Group should exist');
        assert.strictEqual(topLevel.items.length, 1, 'Top Level Group should have 1 item');
        assert.strictEqual(topLevel.items[0].noteId, noteId, 'Note ID should match');

        assert.ok(parent, 'Parent should exist');
        assert.ok(parent.groups, 'Parent should have nested groups');
        const subGroup = parent.groups.find(g => g.name === 'SubGroup');
        assert.ok(subGroup, 'SubGroup should exist');
        assert.strictEqual(subGroup.items.length, 0, 'SubGroup should have 0 items');

        console.log('=== TEST PASSED ===\n');
    });

    test('Should handle deeply nested groups (3 levels)', async () => {
        console.log('\n=== TEST: Move note in deeply nested groups ===');

        // Create initial configuration with 3 levels of nesting
        const initialConfig: ShortcutsConfig = {
            logicalGroups: [
                {
                    name: 'Level1',
                    items: [],
                    groups: [
                        {
                            name: 'Level2',
                            items: [],
                            groups: [
                                {
                                    name: 'Level3A',
                                    items: []
                                },
                                {
                                    name: 'Level3B',
                                    items: []
                                }
                            ]
                        }
                    ]
                }
            ]
        };

        await configManager.saveConfiguration(initialConfig);

        // Create a note in Level1/Level2/Level3A
        const noteId = await configManager.createNote('Level1/Level2/Level3A', 'Deep Note');

        // Move note to Level1/Level2/Level3B
        console.log('Moving note from "Level1/Level2/Level3A" to "Level1/Level2/Level3B"...');
        await configManager.moveNote('Level1/Level2/Level3A', 'Level1/Level2/Level3B', noteId);

        // Verify note was moved
        const config = await configManager.loadConfiguration();
        const level1 = config.logicalGroups.find(g => g.name === 'Level1');
        assert.ok(level1?.groups, 'Level1 should have nested groups');

        const level2 = level1.groups.find(g => g.name === 'Level2');
        assert.ok(level2?.groups, 'Level2 should have nested groups');

        const level3A = level2.groups.find(g => g.name === 'Level3A');
        const level3B = level2.groups.find(g => g.name === 'Level3B');

        assert.ok(level3A, 'Level3A should exist');
        assert.ok(level3B, 'Level3B should exist');
        assert.strictEqual(level3A.items.length, 0, 'Level3A should have 0 items');
        assert.strictEqual(level3B.items.length, 1, 'Level3B should have 1 item');
        assert.strictEqual(level3B.items[0].noteId, noteId, 'Note ID should match');

        console.log('=== TEST PASSED ===\n');
    });
});
