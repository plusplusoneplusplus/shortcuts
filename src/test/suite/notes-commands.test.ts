import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationManager } from '../../shortcuts/configuration-manager';
import { NoteDocumentManager } from '../../shortcuts/note-document-provider';
import { LogicalTreeDataProvider } from '../../shortcuts/logical-tree-data-provider';
import { ThemeManager } from '../../shortcuts/theme-manager';
import { ShortcutsCommands } from '../../shortcuts/commands';
import { LogicalGroupItem, NoteShortcutItem } from '../../shortcuts/tree-items';

suite('Notes Commands Integration Tests', () => {
    let tempDir: string;
    let configManager: ConfigurationManager;
    let treeProvider: LogicalTreeDataProvider;
    let themeManager: ThemeManager;
    let noteDocumentManager: NoteDocumentManager;
    let commands: ShortcutsCommands;
    let extensionContext: vscode.ExtensionContext;

    // Use suiteSetup/suiteTeardown for NoteDocumentManager to avoid
    // re-registering the file system provider multiple times
    suiteSetup(async () => {
        // Create temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-notes-commands-test-'));

        // Create a mock extension context
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
                setKeysForSync: () => {}
            },
            subscriptions: []
        } as any;

        // Initialize storage
        (extensionContext.globalState as any)._storage = {};

        // Pre-create empty config so tests start with a clean slate
        const vscodePath = path.join(tempDir, '.vscode');
        fs.mkdirSync(vscodePath, { recursive: true });
        fs.writeFileSync(path.join(vscodePath, 'shortcuts.yaml'), 'logicalGroups: []\n');

        // Initialize managers
        configManager = new ConfigurationManager(tempDir, extensionContext);
        themeManager = new ThemeManager();
        treeProvider = new LogicalTreeDataProvider(tempDir, configManager, themeManager);
        noteDocumentManager = new NoteDocumentManager(configManager, extensionContext);

        // Register commands
        commands = new ShortcutsCommands(
            treeProvider,
            () => {}, // updateSearchDescriptions
            null as any, // searchProvider
            null as any, // treeView
            noteDocumentManager
        );

        commands.registerCommands(extensionContext);
    });

    suiteTeardown(() => {
        // Clean up
        treeProvider?.dispose();
        configManager?.dispose();
        themeManager?.dispose();
        noteDocumentManager?.dispose();

        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    setup(async () => {
        // Reset config for each test
        const vscodePath = path.join(tempDir, '.vscode');
        fs.mkdirSync(vscodePath, { recursive: true });
        fs.writeFileSync(path.join(vscodePath, 'shortcuts.yaml'), 'logicalGroups: []\n');
        configManager.invalidateCache();
        // Clear stored notes
        (extensionContext.globalState as any)._storage = {};
    });

    suite('Create Note Command', () => {
        test('should create note through command', async () => {
            await configManager.createLogicalGroup('Test Group');
            treeProvider.refresh();

            const rootItems = await treeProvider.getChildren();
            const groupItem = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Test Group'
            ) as LogicalGroupItem;

            assert.ok(groupItem);

            // Mock input box
            const originalShowInputBox = vscode.window.showInputBox;
            vscode.window.showInputBox = async (options?: any) => {
                return 'My New Note';
            };

            // Mock showTextDocument to prevent actual editor opening
            const originalShowTextDocument = vscode.window.showTextDocument;
            let documentOpened = false;
            vscode.window.showTextDocument = async (doc: any) => {
                documentOpened = true;
                return {} as any;
            };

            try {
                await vscode.commands.executeCommand('shortcuts.createNote', groupItem);

                // Wait for async operations
                await new Promise(resolve => setTimeout(resolve, 100));

                // Verify note was created
                const config = await configManager.loadConfiguration();
                const group = config.logicalGroups.find(g => g.name === 'Test Group');
                assert.ok(group);
                assert.strictEqual(group!.items.length, 1);
                assert.strictEqual(group!.items[0].name, 'My New Note');
                assert.strictEqual(group!.items[0].type, 'note');
                assert.ok(group!.items[0].noteId);

                // Verify note was opened
                assert.ok(documentOpened, 'Note should be opened after creation');

            } finally {
                vscode.window.showInputBox = originalShowInputBox;
                vscode.window.showTextDocument = originalShowTextDocument;
            }
        });

        test('should handle cancellation during note creation', async () => {
            await configManager.createLogicalGroup('Test Group');
            treeProvider.refresh();

            const rootItems = await treeProvider.getChildren();
            const groupItem = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Test Group'
            ) as LogicalGroupItem;

            const originalShowInputBox = vscode.window.showInputBox;
            vscode.window.showInputBox = async () => undefined;

            try {
                await vscode.commands.executeCommand('shortcuts.createNote', groupItem);

                // Verify no note was created
                const config = await configManager.loadConfiguration();
                const group = config.logicalGroups.find(g => g.name === 'Test Group');
                assert.strictEqual(group!.items.length, 0);

            } finally {
                vscode.window.showInputBox = originalShowInputBox;
            }
        });

        test('should validate empty note name', async () => {
            await configManager.createLogicalGroup('Test Group');
            treeProvider.refresh();

            const rootItems = await treeProvider.getChildren();
            const groupItem = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Test Group'
            ) as LogicalGroupItem;

            const originalShowInputBox = vscode.window.showInputBox;
            let validationCalled = false;

            vscode.window.showInputBox = async (options?: any) => {
                if (options.validateInput) {
                    // Test empty name
                    const result = options.validateInput('');
                    assert.strictEqual(result, 'Note name cannot be empty');

                    // Test whitespace name
                    const result2 = options.validateInput('   ');
                    assert.strictEqual(result2, 'Note name cannot be empty');

                    validationCalled = true;
                }
                return undefined; // Cancel
            };

            try {
                await vscode.commands.executeCommand('shortcuts.createNote', groupItem);
                assert.ok(validationCalled, 'Validation should be tested');

            } finally {
                vscode.window.showInputBox = originalShowInputBox;
            }
        });

        test('should create note in nested group', async () => {
            await configManager.createLogicalGroup('Parent');
            await configManager.createNestedLogicalGroup('Parent', 'Child');
            treeProvider.refresh();

            const rootItems = await treeProvider.getChildren();
            const parent = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Parent'
            );
            const parentChildren = await treeProvider.getChildren(parent);
            const child = parentChildren.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Child'
            ) as LogicalGroupItem;

            const originalShowInputBox = vscode.window.showInputBox;
            const originalShowTextDocument = vscode.window.showTextDocument;

            vscode.window.showInputBox = async () => 'Nested Note';
            vscode.window.showTextDocument = async () => ({} as any);

            try {
                await vscode.commands.executeCommand('shortcuts.createNote', child);
                await new Promise(resolve => setTimeout(resolve, 100));

                const config = await configManager.loadConfiguration();
                const parentGroup = config.logicalGroups[0];
                const childGroup = parentGroup.groups![0];

                assert.strictEqual(childGroup.items.length, 1);
                assert.strictEqual(childGroup.items[0].name, 'Nested Note');

            } finally {
                vscode.window.showInputBox = originalShowInputBox;
                vscode.window.showTextDocument = originalShowTextDocument;
            }
        });
    });

    suite('Edit Note Command', () => {
        test('should open note for editing', async () => {
            await configManager.createLogicalGroup('Test Group');
            const noteId = await configManager.createNote('Test Group', 'Edit Test');
            await configManager.saveNoteContent(noteId, 'Initial content');

            treeProvider.refresh();

            const rootItems = await treeProvider.getChildren();
            const group = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Test Group'
            );
            const items = await treeProvider.getChildren(group);
            const noteItem = items.find(item => item instanceof NoteShortcutItem) as NoteShortcutItem;

            assert.ok(noteItem);

            let documentOpened = false;
            let openedUri: vscode.Uri | undefined;

            const originalShowTextDocument = vscode.window.showTextDocument;
            vscode.window.showTextDocument = async (doc: any) => {
                documentOpened = true;
                openedUri = doc.uri;
                return {} as any;
            };

            try {
                await vscode.commands.executeCommand('shortcuts.editNote', noteItem);

                assert.ok(documentOpened, 'Document should be opened');
                assert.ok(openedUri);
                assert.strictEqual(openedUri!.scheme, 'shortcuts-note');
                assert.ok(openedUri!.path.includes(noteId));

            } finally {
                vscode.window.showTextDocument = originalShowTextDocument;
            }
        });

        test('should handle edit command on note item click', async () => {
            await configManager.createLogicalGroup('Test Group');
            const noteId = await configManager.createNote('Test Group', 'Click Test');

            treeProvider.refresh();

            const rootItems = await treeProvider.getChildren();
            const group = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Test Group'
            );
            const items = await treeProvider.getChildren(group);
            const noteItem = items.find(item => item instanceof NoteShortcutItem) as NoteShortcutItem;

            // Verify command is set on tree item
            assert.ok(noteItem.command);
            assert.strictEqual(noteItem.command.command, 'shortcuts.editNote');
            assert.deepStrictEqual(noteItem.command.arguments, [noteItem]);
        });
    });

    suite('Delete Note Command', () => {
        test('should delete note through command', async () => {
            await configManager.createLogicalGroup('Test Group');
            const noteId = await configManager.createNote('Test Group', 'Delete Test');
            await configManager.saveNoteContent(noteId, 'Content to delete');

            treeProvider.refresh();

            const rootItems = await treeProvider.getChildren();
            const group = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Test Group'
            );
            const items = await treeProvider.getChildren(group);
            const noteItem = items.find(item => item instanceof NoteShortcutItem) as NoteShortcutItem;

            assert.ok(noteItem);

            // Mock confirmation dialog
            const originalShowWarningMessage = vscode.window.showWarningMessage;
            vscode.window.showWarningMessage = async (message: string, options?: any, ...items: string[]) => {
                assert.ok(message.includes('Delete Test') || message.toLowerCase().includes('delete'));
                return 'Delete' as any;
            };

            try {
                await vscode.commands.executeCommand('shortcuts.deleteNote', noteItem);

                // Wait for async operations
                await new Promise(resolve => setTimeout(resolve, 100));

                // Verify note was deleted
                const config = await configManager.loadConfiguration();
                const updatedGroup = config.logicalGroups.find(g => g.name === 'Test Group');
                assert.strictEqual(updatedGroup!.items.length, 0);

                // Verify content was deleted
                const content = await configManager.getNoteContent(noteId);
                assert.strictEqual(content, '');

            } finally {
                vscode.window.showWarningMessage = originalShowWarningMessage;
            }
        });

        test('should handle cancellation during delete', async () => {
            await configManager.createLogicalGroup('Test Group');
            const noteId = await configManager.createNote('Test Group', 'Keep This');

            treeProvider.refresh();

            const rootItems = await treeProvider.getChildren();
            const group = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Test Group'
            );
            const items = await treeProvider.getChildren(group);
            const noteItem = items.find(item => item instanceof NoteShortcutItem) as NoteShortcutItem;

            const originalShowWarningMessage = vscode.window.showWarningMessage;
            vscode.window.showWarningMessage = async (message: string, options?: any, ...items: string[]) => undefined as any;

            try {
                await vscode.commands.executeCommand('shortcuts.deleteNote', noteItem);

                // Verify note still exists
                const config = await configManager.loadConfiguration();
                const updatedGroup = config.logicalGroups.find(g => g.name === 'Test Group');
                assert.strictEqual(updatedGroup!.items.length, 1);

            } finally {
                vscode.window.showWarningMessage = originalShowWarningMessage;
            }
        });

        test('should delete note from nested group', async () => {
            await configManager.createLogicalGroup('Parent');
            await configManager.createNestedLogicalGroup('Parent', 'Child');
            const noteId = await configManager.createNote('Parent/Child', 'Nested Delete');

            treeProvider.refresh();

            const rootItems = await treeProvider.getChildren();
            const parent = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Parent'
            );
            const parentChildren = await treeProvider.getChildren(parent);
            const child = parentChildren.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Child'
            );
            const childItems = await treeProvider.getChildren(child);
            const noteItem = childItems.find(item => item instanceof NoteShortcutItem) as NoteShortcutItem;

            const originalShowWarningMessage = vscode.window.showWarningMessage;
            vscode.window.showWarningMessage = async (message: string, options?: any, ...items: string[]) => 'Delete' as any;

            try {
                await vscode.commands.executeCommand('shortcuts.deleteNote', noteItem);
                await new Promise(resolve => setTimeout(resolve, 100));

                const config = await configManager.loadConfiguration();
                const parentGroup = config.logicalGroups[0];
                const childGroup = parentGroup.groups![0];
                assert.strictEqual(childGroup.items.length, 0);

            } finally {
                vscode.window.showWarningMessage = originalShowWarningMessage;
            }
        });
    });

    suite('Rename Note Command', () => {
        test('should rename note through command', async () => {
            await configManager.createLogicalGroup('Test Group');
            const noteId = await configManager.createNote('Test Group', 'Old Name');
            await configManager.saveNoteContent(noteId, 'Content to preserve');

            treeProvider.refresh();

            const rootItems = await treeProvider.getChildren();
            const group = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Test Group'
            );
            const items = await treeProvider.getChildren(group);
            const noteItem = items.find(item => item instanceof NoteShortcutItem) as NoteShortcutItem;

            const originalShowInputBox = vscode.window.showInputBox;
            vscode.window.showInputBox = async (options?: any) => {
                // Verify current name is shown
                assert.strictEqual(options.value, 'Old Name');
                return 'New Name';
            };

            try {
                await vscode.commands.executeCommand('shortcuts.renameNote', noteItem);

                // Wait for async operations
                await new Promise(resolve => setTimeout(resolve, 100));

                // Verify note was renamed
                const config = await configManager.loadConfiguration();
                const updatedGroup = config.logicalGroups.find(g => g.name === 'Test Group');
                assert.strictEqual(updatedGroup!.items.length, 1);
                assert.strictEqual(updatedGroup!.items[0].name, 'New Name');
                assert.strictEqual(updatedGroup!.items[0].noteId, noteId);

                // Verify content is preserved
                const content = await configManager.getNoteContent(noteId);
                assert.strictEqual(content, 'Content to preserve');

            } finally {
                vscode.window.showInputBox = originalShowInputBox;
            }
        });

        test('should handle cancellation during rename', async () => {
            await configManager.createLogicalGroup('Test Group');
            await configManager.createNote('Test Group', 'Original Name');

            treeProvider.refresh();

            const rootItems = await treeProvider.getChildren();
            const group = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Test Group'
            );
            const items = await treeProvider.getChildren(group);
            const noteItem = items.find(item => item instanceof NoteShortcutItem) as NoteShortcutItem;

            const originalShowInputBox = vscode.window.showInputBox;
            vscode.window.showInputBox = async () => undefined;

            try {
                await vscode.commands.executeCommand('shortcuts.renameNote', noteItem);

                // Verify name unchanged
                const config = await configManager.loadConfiguration();
                const updatedGroup = config.logicalGroups.find(g => g.name === 'Test Group');
                assert.strictEqual(updatedGroup!.items[0].name, 'Original Name');

            } finally {
                vscode.window.showInputBox = originalShowInputBox;
            }
        });

        test('should validate empty name during rename', async () => {
            await configManager.createLogicalGroup('Test Group');
            await configManager.createNote('Test Group', 'Test Note');

            treeProvider.refresh();

            const rootItems = await treeProvider.getChildren();
            const group = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Test Group'
            );
            const items = await treeProvider.getChildren(group);
            const noteItem = items.find(item => item instanceof NoteShortcutItem) as NoteShortcutItem;

            const originalShowInputBox = vscode.window.showInputBox;
            let validationCalled = false;

            vscode.window.showInputBox = async (options?: any) => {
                if (options.validateInput) {
                    const result = options.validateInput('');
                    assert.strictEqual(result, 'Note name cannot be empty');

                    const result2 = options.validateInput('   ');
                    assert.strictEqual(result2, 'Note name cannot be empty');

                    validationCalled = true;
                }
                return undefined;
            };

            try {
                await vscode.commands.executeCommand('shortcuts.renameNote', noteItem);
                assert.ok(validationCalled, 'Validation should be tested');

            } finally {
                vscode.window.showInputBox = originalShowInputBox;
            }
        });

        test('should rename note in nested group', async () => {
            await configManager.createLogicalGroup('Parent');
            await configManager.createNestedLogicalGroup('Parent', 'Child');
            const noteId = await configManager.createNote('Parent/Child', 'Nested Old');

            treeProvider.refresh();

            const rootItems = await treeProvider.getChildren();
            const parent = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Parent'
            );
            const parentChildren = await treeProvider.getChildren(parent);
            const child = parentChildren.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Child'
            );
            const childItems = await treeProvider.getChildren(child);
            const noteItem = childItems.find(item => item instanceof NoteShortcutItem) as NoteShortcutItem;

            const originalShowInputBox = vscode.window.showInputBox;
            vscode.window.showInputBox = async () => 'Nested New';

            try {
                await vscode.commands.executeCommand('shortcuts.renameNote', noteItem);
                await new Promise(resolve => setTimeout(resolve, 100));

                const config = await configManager.loadConfiguration();
                const parentGroup = config.logicalGroups[0];
                const childGroup = parentGroup.groups![0];
                assert.strictEqual(childGroup.items[0].name, 'Nested New');

            } finally {
                vscode.window.showInputBox = originalShowInputBox;
            }
        });

        test('should allow duplicate note names in same group', async () => {
            await configManager.createLogicalGroup('Test Group');
            await configManager.createNote('Test Group', 'Duplicate');
            await configManager.createNote('Test Group', 'Unique');

            treeProvider.refresh();

            const rootItems = await treeProvider.getChildren();
            const group = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Test Group'
            );
            const items = await treeProvider.getChildren(group);
            const noteItems = items.filter(item => item instanceof NoteShortcutItem);
            const secondNote = noteItems[1] as NoteShortcutItem;

            const originalShowInputBox = vscode.window.showInputBox;
            vscode.window.showInputBox = async () => 'Duplicate';

            try {
                await vscode.commands.executeCommand('shortcuts.renameNote', secondNote);
                await new Promise(resolve => setTimeout(resolve, 100));

                // Should allow duplicate names
                const config = await configManager.loadConfiguration();
                const updatedGroup = config.logicalGroups.find(g => g.name === 'Test Group');
                const names = updatedGroup!.items.map(i => i.name);
                assert.strictEqual(names.filter(n => n === 'Duplicate').length, 2);

            } finally {
                vscode.window.showInputBox = originalShowInputBox;
            }
        });
    });

    suite('Command Registration', () => {
        test('should register all note commands', async () => {
            const allCommands = await vscode.commands.getCommands(true);

            const noteCommands = [
                'shortcuts.createNote',
                'shortcuts.editNote',
                'shortcuts.deleteNote',
                'shortcuts.renameNote'
            ];

            for (const cmd of noteCommands) {
                assert.ok(allCommands.includes(cmd), `Command ${cmd} should be registered`);
            }
        });
    });

    suite('Error Handling', () => {
        test('should handle errors in create note command', async () => {
            await configManager.createLogicalGroup('Test Group');
            treeProvider.refresh();

            const rootItems = await treeProvider.getChildren();
            const groupItem = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Test Group'
            ) as LogicalGroupItem;

            const originalShowInputBox = vscode.window.showInputBox;
            const originalShowErrorMessage = vscode.window.showErrorMessage;

            let errorShown = false;
            vscode.window.showInputBox = async () => 'Test Note';
            vscode.window.showErrorMessage = async (message: string) => {
                errorShown = true;
                return undefined as any;
            };

            // Force an error by disposing config manager
            configManager.dispose();

            try {
                await vscode.commands.executeCommand('shortcuts.createNote', groupItem);
                // Error should be caught and shown
            } finally {
                vscode.window.showInputBox = originalShowInputBox;
                vscode.window.showErrorMessage = originalShowErrorMessage;
            }
        });

        test('should handle missing note document manager', async () => {
            // Create commands without note document manager
            const commandsWithoutManager = new ShortcutsCommands(
                treeProvider,
                () => {},
                null as any,
                null as any,
                undefined as any // No note document manager
            );

            const disposables: vscode.Disposable[] = [];
            commandsWithoutManager.registerCommands({ subscriptions: disposables } as any);

            await configManager.createLogicalGroup('Test Group');
            treeProvider.refresh();

            const rootItems = await treeProvider.getChildren();
            const groupItem = rootItems.find((item): item is LogicalGroupItem =>
                item instanceof LogicalGroupItem && item.originalName === 'Test Group'
            ) as LogicalGroupItem;

            const originalShowInputBox = vscode.window.showInputBox;
            const originalShowTextDocument = vscode.window.showTextDocument;

            vscode.window.showInputBox = async () => 'Test Note';
            vscode.window.showTextDocument = async () => ({} as any);

            try {
                // Should still create the note, but not open it
                await vscode.commands.executeCommand('shortcuts.createNote', groupItem);
                await new Promise(resolve => setTimeout(resolve, 100));

                const config = await configManager.loadConfiguration();
                const group = config.logicalGroups.find(g => g.name === 'Test Group');
                assert.strictEqual(group!.items.length, 1);

            } finally {
                vscode.window.showInputBox = originalShowInputBox;
                vscode.window.showTextDocument = originalShowTextDocument;
                disposables.forEach(d => d.dispose());
            }
        });
    });
});
