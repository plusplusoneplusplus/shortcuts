import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationManager } from '../../shortcuts/configuration-manager';
import { NoteDocumentManager, NoteFileSystemProvider } from '../../shortcuts/note-document-provider';
import { LogicalTreeDataProvider } from '../../shortcuts/logical-tree-data-provider';
import { ThemeManager } from '../../shortcuts/theme-manager';
import { NoteShortcutItem } from '../../shortcuts/tree-items';

suite('Notes Feature Tests', () => {
    let tempDir: string;
    let configManager: ConfigurationManager;
    let extensionContext: vscode.ExtensionContext;

    setup(() => {
        // Create temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-notes-test-'));

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

        configManager = new ConfigurationManager(tempDir, extensionContext);
    });

    teardown(() => {
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }

        // Dispose configuration manager
        configManager.dispose();
    });

    suite('ConfigurationManager Note Operations', () => {
        test('should create a note in a logical group', async () => {
            // Create a logical group
            await configManager.createLogicalGroup('Notes Group', 'Group for notes');

            // Create a note
            const noteId = await configManager.createNote('Notes Group', 'My First Note');

            // Verify note ID is generated
            assert.ok(noteId);
            assert.ok(noteId.startsWith('note_'));

            // Verify note is in configuration
            const config = await configManager.loadConfiguration();
            const group = config.logicalGroups.find(g => g.name === 'Notes Group');
            assert.ok(group);
            assert.strictEqual(group!.items.length, 1);
            assert.strictEqual(group!.items[0].name, 'My First Note');
            assert.strictEqual(group!.items[0].type, 'note');
            assert.strictEqual(group!.items[0].noteId, noteId);
        });

        test('should create note with empty content by default', async () => {
            await configManager.createLogicalGroup('Test Group');
            const noteId = await configManager.createNote('Test Group', 'Empty Note');

            // Check initial content is empty
            const content = await configManager.getNoteContent(noteId);
            assert.strictEqual(content, '');
        });

        test('should save and retrieve note content', async () => {
            await configManager.createLogicalGroup('Test Group');
            const noteId = await configManager.createNote('Test Group', 'Test Note');

            // Save content
            const testContent = 'This is my note content\nWith multiple lines';
            await configManager.saveNoteContent(noteId, testContent);

            // Retrieve content
            const retrievedContent = await configManager.getNoteContent(noteId);
            assert.strictEqual(retrievedContent, testContent);
        });

        test('should handle special characters in note content', async () => {
            await configManager.createLogicalGroup('Test Group');
            const noteId = await configManager.createNote('Test Group', 'Special Note');

            const specialContent = 'Special chars: 🎉 émojis, ñ, 中文, \n\t\r tabs and newlines';
            await configManager.saveNoteContent(noteId, specialContent);

            const retrievedContent = await configManager.getNoteContent(noteId);
            assert.strictEqual(retrievedContent, specialContent);
        });

        test('should handle very long note content', async () => {
            await configManager.createLogicalGroup('Test Group');
            const noteId = await configManager.createNote('Test Group', 'Long Note');

            // Create a long string (10KB)
            const longContent = 'A'.repeat(10000);
            await configManager.saveNoteContent(noteId, longContent);

            const retrievedContent = await configManager.getNoteContent(noteId);
            assert.strictEqual(retrievedContent.length, 10000);
            assert.strictEqual(retrievedContent, longContent);
        });

        test('should update existing note content', async () => {
            await configManager.createLogicalGroup('Test Group');
            const noteId = await configManager.createNote('Test Group', 'Update Test');

            // Save initial content
            await configManager.saveNoteContent(noteId, 'Initial content');
            let content = await configManager.getNoteContent(noteId);
            assert.strictEqual(content, 'Initial content');

            // Update content
            await configManager.saveNoteContent(noteId, 'Updated content');
            content = await configManager.getNoteContent(noteId);
            assert.strictEqual(content, 'Updated content');
        });

        test('should delete note from group', async () => {
            await configManager.createLogicalGroup('Test Group');
            const noteId = await configManager.createNote('Test Group', 'Note to Delete');

            // Verify note exists
            let config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 1);

            // Delete note
            await configManager.deleteNote('Test Group', noteId);

            // Verify note is removed from group
            config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 0);

            // Verify note content is removed from storage
            const content = await configManager.getNoteContent(noteId);
            assert.strictEqual(content, '');
        });

        test('should delete note content from storage', async () => {
            await configManager.createLogicalGroup('Test Group');
            const noteId = await configManager.createNote('Test Group', 'Delete Content Test');

            await configManager.saveNoteContent(noteId, 'This will be deleted');

            // Verify content exists
            let content = await configManager.getNoteContent(noteId);
            assert.strictEqual(content, 'This will be deleted');

            // Delete note
            await configManager.deleteNote('Test Group', noteId);

            // Verify content is gone
            content = await configManager.getNoteContent(noteId);
            assert.strictEqual(content, '');
        });

        test('should move note between groups', async () => {
            // Create two groups
            await configManager.createLogicalGroup('Source Group');
            await configManager.createLogicalGroup('Target Group');

            // Create note in source group
            const noteId = await configManager.createNote('Source Group', 'Moving Note');
            await configManager.saveNoteContent(noteId, 'Note content stays');

            // Move note
            await configManager.moveNote('Source Group', 'Target Group', noteId);

            // Verify note moved
            const config = await configManager.loadConfiguration();
            const sourceGroup = config.logicalGroups.find(g => g.name === 'Source Group');
            const targetGroup = config.logicalGroups.find(g => g.name === 'Target Group');

            assert.strictEqual(sourceGroup!.items.length, 0);
            assert.strictEqual(targetGroup!.items.length, 1);
            assert.strictEqual(targetGroup!.items[0].noteId, noteId);
            assert.strictEqual(targetGroup!.items[0].name, 'Moving Note');

            // Verify content is preserved
            const content = await configManager.getNoteContent(noteId);
            assert.strictEqual(content, 'Note content stays');
        });

        test('should handle moving note to non-existent group', async () => {
            await configManager.createLogicalGroup('Source Group');
            const noteId = await configManager.createNote('Source Group', 'Test Note');

            // Try to move to non-existent group
            await assert.rejects(
                async () => await configManager.moveNote('Source Group', 'Non Existent', noteId),
                /group not found/i
            );
        });

        test('should handle deleting note from non-existent group', async () => {
            await configManager.createLogicalGroup('Test Group');
            const noteId = await configManager.createNote('Test Group', 'Test Note');

            // Try to delete from non-existent group
            await assert.rejects(
                async () => await configManager.deleteNote('Non Existent', noteId),
                /group not found/i
            );
        });

        test('should create multiple notes in same group', async () => {
            await configManager.createLogicalGroup('Multi Note Group');

            const noteId1 = await configManager.createNote('Multi Note Group', 'Note 1');
            const noteId2 = await configManager.createNote('Multi Note Group', 'Note 2');
            const noteId3 = await configManager.createNote('Multi Note Group', 'Note 3');

            const config = await configManager.loadConfiguration();
            const group = config.logicalGroups[0];

            assert.strictEqual(group.items.length, 3);
            assert.strictEqual(group.items[0].noteId, noteId1);
            assert.strictEqual(group.items[1].noteId, noteId2);
            assert.strictEqual(group.items[2].noteId, noteId3);
        });

        test('should generate unique note IDs', async () => {
            await configManager.createLogicalGroup('Test Group');

            const noteIds = new Set<string>();
            for (let i = 0; i < 100; i++) {
                const noteId = await configManager.createNote('Test Group', `Note ${i}`);
                assert.ok(!noteIds.has(noteId), `Note ID ${noteId} should be unique`);
                noteIds.add(noteId);
            }

            assert.strictEqual(noteIds.size, 100);
        });

        test('should create notes in nested groups', async () => {
            await configManager.createLogicalGroup('Parent');
            await configManager.createNestedLogicalGroup('Parent', 'Child', 'Child group');

            const noteId = await configManager.createNote('Parent/Child', 'Nested Note');

            const config = await configManager.loadConfiguration();
            const parentGroup = config.logicalGroups[0];
            const childGroup = parentGroup.groups![0];

            assert.strictEqual(childGroup.items.length, 1);
            assert.strictEqual(childGroup.items[0].noteId, noteId);
            assert.strictEqual(childGroup.items[0].name, 'Nested Note');
        });

        test('should move note between nested groups', async () => {
            await configManager.createLogicalGroup('Parent1');
            await configManager.createNestedLogicalGroup('Parent1', 'Child1');
            await configManager.createLogicalGroup('Parent2');
            await configManager.createNestedLogicalGroup('Parent2', 'Child2');

            const noteId = await configManager.createNote('Parent1/Child1', 'Moving Note');
            await configManager.saveNoteContent(noteId, 'Nested content');

            // Move note to different nested group
            await configManager.moveNote('Parent1/Child1', 'Parent2/Child2', noteId);

            const config = await configManager.loadConfiguration();
            const parent1 = config.logicalGroups.find(g => g.name === 'Parent1');
            const parent2 = config.logicalGroups.find(g => g.name === 'Parent2');

            assert.strictEqual(parent1!.groups![0].items.length, 0);
            assert.strictEqual(parent2!.groups![0].items.length, 1);
            assert.strictEqual(parent2!.groups![0].items[0].noteId, noteId);

            // Verify content preserved
            const content = await configManager.getNoteContent(noteId);
            assert.strictEqual(content, 'Nested content');
        });

        test('should handle creating note in non-existent group', async () => {
            await assert.rejects(
                async () => await configManager.createNote('Non Existent Group', 'Test Note'),
                /group not found/i
            );
        });

        test('should return empty string for non-existent note ID', async () => {
            const content = await configManager.getNoteContent('non_existent_note_id');
            assert.strictEqual(content, '');
        });

        test('should handle note without extension context gracefully', async () => {
            const managerWithoutContext = new ConfigurationManager(tempDir);
            await managerWithoutContext.createLogicalGroup('Test Group');

            await assert.rejects(
                async () => await managerWithoutContext.createNote('Test Group', 'Test Note'),
                /extension context not available/i
            );

            managerWithoutContext.dispose();
        });
    });

    suite('NoteFileSystemProvider', () => {
        let provider: NoteFileSystemProvider;

        setup(() => {
            provider = new NoteFileSystemProvider(configManager);
        });

        teardown(() => {
            provider.dispose();
        });

        test('should implement FileSystemProvider interface', () => {
            assert.ok(provider.onDidChangeFile);
            assert.ok(typeof provider.watch === 'function');
            assert.ok(typeof provider.stat === 'function');
            assert.ok(typeof provider.readFile === 'function');
            assert.ok(typeof provider.writeFile === 'function');
        });

        test('should read note content', async () => {
            await configManager.createLogicalGroup('Test Group');
            const noteId = await configManager.createNote('Test Group', 'Test Note');
            await configManager.saveNoteContent(noteId, 'File system test content');

            const uri = vscode.Uri.parse(`shortcuts-note:/${noteId}`);
            const content = await provider.readFile(uri);

            const textContent = Buffer.from(content).toString('utf8');
            assert.strictEqual(textContent, 'File system test content');
        });

        test('should write note content', async () => {
            await configManager.createLogicalGroup('Test Group');
            const noteId = await configManager.createNote('Test Group', 'Test Note');

            const uri = vscode.Uri.parse(`shortcuts-note:/${noteId}`);
            const content = Buffer.from('Written by file system', 'utf8');

            await provider.writeFile(uri, content, { create: true, overwrite: true });

            const savedContent = await configManager.getNoteContent(noteId);
            assert.strictEqual(savedContent, 'Written by file system');
        });

        test('should emit change event on write', async () => {
            await configManager.createLogicalGroup('Test Group');
            const noteId = await configManager.createNote('Test Group', 'Test Note');

            let eventFired = false;
            const disposable = provider.onDidChangeFile((events) => {
                eventFired = events.length > 0;
            });

            const uri = vscode.Uri.parse(`shortcuts-note:/${noteId}`);
            const content = Buffer.from('Change event test', 'utf8');

            await provider.writeFile(uri, content, { create: true, overwrite: true });

            // Give event time to fire
            await new Promise(resolve => setTimeout(resolve, 10));

            assert.ok(eventFired, 'Change event should be fired');
            disposable.dispose();
        });

        test('should return valid file stats', async () => {
            await configManager.createLogicalGroup('Test Group');
            const noteId = await configManager.createNote('Test Group', 'Test Note');

            const uri = vscode.Uri.parse(`shortcuts-note:/${noteId}`);
            const stats = provider.stat(uri);

            assert.strictEqual(stats.type, vscode.FileType.File);
            assert.ok(typeof stats.ctime === 'number');
            assert.ok(typeof stats.mtime === 'number');
            assert.ok(typeof stats.size === 'number');
        });

        test('should handle URI with leading slash', async () => {
            await configManager.createLogicalGroup('Test Group');
            const noteId = await configManager.createNote('Test Group', 'Test Note');
            await configManager.saveNoteContent(noteId, 'Leading slash test');

            // URI with leading slash in path
            const uri = vscode.Uri.parse(`shortcuts-note:/${noteId}`);
            const content = await provider.readFile(uri);

            const textContent = Buffer.from(content).toString('utf8');
            assert.strictEqual(textContent, 'Leading slash test');
        });

        test('should throw error for directory operations', () => {
            const uri = vscode.Uri.parse('shortcuts-note:/test');

            assert.throws(
                () => provider.readDirectory(uri),
                /no permissions/i
            );

            assert.throws(
                () => provider.createDirectory(uri),
                /no permissions/i
            );
        });

        test('should throw error for delete operation', () => {
            const uri = vscode.Uri.parse('shortcuts-note:/test');

            assert.throws(
                () => provider.delete(uri),
                /use the delete command/i
            );
        });

        test('should throw error for rename operation', () => {
            const uri1 = vscode.Uri.parse('shortcuts-note:/test1');
            const uri2 = vscode.Uri.parse('shortcuts-note:/test2');

            assert.throws(
                () => provider.rename(uri1, uri2),
                /use the rename command/i
            );
        });

        test('should return empty disposable for watch', () => {
            const uri = vscode.Uri.parse('shortcuts-note:/test');
            const disposable = provider.watch(uri);

            assert.ok(disposable);
            assert.ok(typeof disposable.dispose === 'function');

            // Should not throw
            disposable.dispose();
        });

        test('should handle read of empty note', async () => {
            await configManager.createLogicalGroup('Test Group');
            const noteId = await configManager.createNote('Test Group', 'Empty Note');

            const uri = vscode.Uri.parse(`shortcuts-note:/${noteId}`);
            const content = await provider.readFile(uri);

            const textContent = Buffer.from(content).toString('utf8');
            assert.strictEqual(textContent, '');
        });

        test('should handle write errors gracefully', async () => {
            const uri = vscode.Uri.parse('shortcuts-note:/invalid_note_id');
            const content = Buffer.from('Test content', 'utf8');

            // This should not throw, but handle the error internally
            await provider.writeFile(uri, content, { create: true, overwrite: true });

            // The content should be saved even if note doesn't exist in config
            const savedContent = await configManager.getNoteContent('invalid_note_id');
            assert.strictEqual(savedContent, 'Test content');
        });
    });

    suite('NoteDocumentManager', () => {
        let documentManager: NoteDocumentManager;

        setup(() => {
            documentManager = new NoteDocumentManager(configManager, extensionContext);
        });

        teardown(() => {
            documentManager.dispose();
        });

        test('should register file system provider', () => {
            // Verify provider is registered by checking subscriptions
            assert.ok(extensionContext.subscriptions.length > 0);
        });

        test('should open note in editor', async () => {
            await configManager.createLogicalGroup('Test Group');
            const noteId = await configManager.createNote('Test Group', 'Test Note');
            await configManager.saveNoteContent(noteId, 'Test content');

            // Mock showTextDocument
            let documentOpened = false;
            let openedUri: vscode.Uri | undefined;

            const originalShowTextDocument = vscode.window.showTextDocument;
            vscode.window.showTextDocument = async (document: any) => {
                documentOpened = true;
                openedUri = document.uri;
                return {} as any;
            };

            try {
                await documentManager.openNote(noteId, 'Test Note');

                assert.ok(documentOpened, 'Document should be opened');
                assert.ok(openedUri);
                assert.strictEqual(openedUri!.scheme, 'shortcuts-note');
                assert.ok(openedUri!.path.includes(noteId));
            } finally {
                vscode.window.showTextDocument = originalShowTextDocument;
            }
        });

        test('should include note name in URI query', async () => {
            await configManager.createLogicalGroup('Test Group');
            const noteId = await configManager.createNote('Test Group', 'My Special Note');

            let openedUri: vscode.Uri | undefined;

            const originalShowTextDocument = vscode.window.showTextDocument;
            vscode.window.showTextDocument = async (document: any) => {
                openedUri = document.uri;
                return {} as any;
            };

            try {
                await documentManager.openNote(noteId, 'My Special Note');

                assert.ok(openedUri);
                assert.ok(openedUri!.query.includes('My%20Special%20Note') ||
                         openedUri!.query.includes('My+Special+Note'));
            } finally {
                vscode.window.showTextDocument = originalShowTextDocument;
            }
        });

        test('should handle errors when opening note', async () => {
            const originalShowTextDocument = vscode.window.showTextDocument;
            const originalShowErrorMessage = vscode.window.showErrorMessage;

            let errorShown = false;

            vscode.window.showTextDocument = async () => {
                throw new Error('Failed to open document');
            };

            vscode.window.showErrorMessage = async (message: string) => {
                errorShown = true;
                assert.ok(message.includes('Failed to open note'));
                return undefined as any;
            };

            try {
                await documentManager.openNote('test_note', 'Test Note');
                assert.ok(errorShown, 'Error message should be shown');
            } finally {
                vscode.window.showTextDocument = originalShowTextDocument;
                vscode.window.showErrorMessage = originalShowErrorMessage;
            }
        });
    });

    suite('Tree View Integration', () => {
        let treeProvider: LogicalTreeDataProvider;
        let themeManager: ThemeManager;

        setup(() => {
            themeManager = new ThemeManager();
            treeProvider = new LogicalTreeDataProvider(tempDir, configManager, themeManager);
        });

        teardown(() => {
            treeProvider.dispose();
            themeManager.dispose();
        });

        test('should display notes in tree view', async () => {
            await configManager.createLogicalGroup('Notes Group');
            await configManager.createNote('Notes Group', 'First Note');
            await configManager.createNote('Notes Group', 'Second Note');

            treeProvider.refresh();

            const rootItems = await treeProvider.getChildren();
            assert.ok(rootItems.length > 0);

            const notesGroup = rootItems.find((item: any) =>
                item.originalName === 'Notes Group'
            );
            assert.ok(notesGroup);

            const groupItems = await treeProvider.getChildren(notesGroup);
            const noteItems = groupItems.filter(item => item instanceof NoteShortcutItem);

            assert.strictEqual(noteItems.length, 2);
            assert.ok(noteItems.some((item: any) => item.label === 'First Note'));
            assert.ok(noteItems.some((item: any) => item.label === 'Second Note'));
        });

        test('should create NoteShortcutItem with correct properties', async () => {
            await configManager.createLogicalGroup('Test Group');
            const noteId = await configManager.createNote('Test Group', 'My Note');

            treeProvider.refresh();

            const rootItems = await treeProvider.getChildren();
            const group = rootItems.find((item: any) => item.originalName === 'Test Group');
            const groupItems = await treeProvider.getChildren(group);
            const noteItem = groupItems.find(item => item instanceof NoteShortcutItem) as NoteShortcutItem;

            assert.ok(noteItem);
            assert.strictEqual(noteItem.label, 'My Note');
            assert.strictEqual(noteItem.noteId, noteId);
            assert.strictEqual(noteItem.contextValue, 'note');
            assert.strictEqual(noteItem.collapsibleState, vscode.TreeItemCollapsibleState.None);
            assert.ok(noteItem.command);
            assert.strictEqual(noteItem.command.command, 'shortcuts.editNote');
        });

        test('should sort notes correctly in tree view', async () => {
            await configManager.createLogicalGroup('Mixed Group');

            // Create folder
            const testFolder = path.join(tempDir, 'test-folder');
            fs.mkdirSync(testFolder);
            await configManager.addToLogicalGroup('Mixed Group', testFolder, 'A Folder', 'folder');

            // Create file
            const testFile = path.join(tempDir, 'test.txt');
            fs.writeFileSync(testFile, 'test');
            await configManager.addToLogicalGroup('Mixed Group', testFile, 'B File', 'file');

            // Create note
            await configManager.createNote('Mixed Group', 'C Note');

            treeProvider.refresh();

            const rootItems = await treeProvider.getChildren();
            const group = rootItems.find((item: any) => item.originalName === 'Mixed Group');
            const items = await treeProvider.getChildren(group);

            // Should be sorted: folder(0), file(1), note(2)
            assert.ok(items[0].constructor.name.includes('Folder'));
            assert.ok(items[1].constructor.name.includes('File'));
            assert.ok(items[2] instanceof NoteShortcutItem);
        });

        test('should display notes in nested groups', async () => {
            await configManager.createLogicalGroup('Parent');
            await configManager.createNestedLogicalGroup('Parent', 'Child');
            const noteId = await configManager.createNote('Parent/Child', 'Nested Note');

            treeProvider.refresh();

            const rootItems = await treeProvider.getChildren();
            const parent = rootItems.find((item: any) => item.originalName === 'Parent');
            const parentChildren = await treeProvider.getChildren(parent);
            const child = parentChildren.find((item: any) => item.originalName === 'Child');
            const childItems = await treeProvider.getChildren(child);

            const noteItem = childItems.find(item => item instanceof NoteShortcutItem) as NoteShortcutItem;
            assert.ok(noteItem);
            assert.strictEqual(noteItem.noteId, noteId);
        });

        test('should handle group with no notes', async () => {
            await configManager.createLogicalGroup('Empty Group');

            treeProvider.refresh();

            const rootItems = await treeProvider.getChildren();
            const group = rootItems.find((item: any) => item.originalName === 'Empty Group');
            const groupItems = await treeProvider.getChildren(group);

            const noteItems = groupItems.filter(item => item instanceof NoteShortcutItem);
            assert.strictEqual(noteItems.length, 0);
        });

        test('should update tree view when note is added', async () => {
            await configManager.createLogicalGroup('Dynamic Group');
            treeProvider.refresh();

            let rootItems = await treeProvider.getChildren();
            let group = rootItems.find((item: any) => item.originalName === 'Dynamic Group');
            let items = await treeProvider.getChildren(group);
            assert.strictEqual(items.filter(i => i instanceof NoteShortcutItem).length, 0);

            // Add note
            await configManager.createNote('Dynamic Group', 'New Note');
            treeProvider.refresh();

            rootItems = await treeProvider.getChildren();
            group = rootItems.find((item: any) => item.originalName === 'Dynamic Group');
            items = await treeProvider.getChildren(group);
            assert.strictEqual(items.filter(i => i instanceof NoteShortcutItem).length, 1);
        });
    });

    suite('Note Configuration Persistence', () => {
        test('should persist notes across configuration reloads', async () => {
            await configManager.createLogicalGroup('Persistent Group');
            const noteId = await configManager.createNote('Persistent Group', 'Persistent Note');
            await configManager.saveNoteContent(noteId, 'Persistent content');

            // Create new config manager instance
            const newConfigManager = new ConfigurationManager(tempDir, extensionContext);
            const config = await newConfigManager.loadConfiguration();

            const group = config.logicalGroups.find(g => g.name === 'Persistent Group');
            assert.ok(group);
            assert.strictEqual(group!.items.length, 1);
            assert.strictEqual(group!.items[0].noteId, noteId);

            // Check content persists
            const content = await newConfigManager.getNoteContent(noteId);
            assert.strictEqual(content, 'Persistent content');

            newConfigManager.dispose();
        });

        test('should handle configuration with notes from file', async () => {
            // Write configuration with notes directly to file
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });
            const configPath = path.join(vscodePath, 'shortcuts.yaml');

            const configYaml = `logicalGroups:
  - name: File Group
    description: Created from file
    items:
      - name: File Note
        type: note
        noteId: note_123456789_test`;

            fs.writeFileSync(configPath, configYaml);

            // Load configuration
            const config = await configManager.loadConfiguration();
            const group = config.logicalGroups.find(g => g.name === 'File Group');

            assert.ok(group);
            assert.strictEqual(group!.items.length, 1);
            assert.strictEqual(group!.items[0].type, 'note');
            assert.strictEqual(group!.items[0].noteId, 'note_123456789_test');
        });

        test('should validate note items have noteId', async () => {
            // Write invalid configuration (note without noteId)
            const vscodePath = path.join(tempDir, '.vscode');
            fs.mkdirSync(vscodePath, { recursive: true });
            const configPath = path.join(vscodePath, 'shortcuts.yaml');

            const configYaml = `logicalGroups:
  - name: Invalid Group
    items:
      - name: Invalid Note
        type: note`;

            fs.writeFileSync(configPath, configYaml);

            // Load configuration - should skip invalid note
            const config = await configManager.loadConfiguration();
            const group = config.logicalGroups.find(g => g.name === 'Invalid Group');

            assert.ok(group);
            assert.strictEqual(group!.items.length, 0, 'Note without noteId should be skipped');
        });

        test('should preserve note icon in configuration', async () => {
            await configManager.createLogicalGroup('Icon Group');
            const noteId = await configManager.createNote('Icon Group', 'Icon Note');

            // Manually update config to add icon
            const config = await configManager.loadConfiguration();
            const group = config.logicalGroups.find(g => g.name === 'Icon Group');
            group!.items[0].icon = 'book';
            await configManager.saveConfiguration(config);

            // Reload and verify icon is preserved
            const reloadedConfig = await configManager.loadConfiguration();
            const reloadedGroup = reloadedConfig.logicalGroups.find(g => g.name === 'Icon Group');
            assert.strictEqual(reloadedGroup!.items[0].icon, 'book');
        });
    });

    suite('Edge Cases and Error Handling', () => {
        test('should handle note with very long name', async () => {
            await configManager.createLogicalGroup('Test Group');
            const longName = 'A'.repeat(500);
            const noteId = await configManager.createNote('Test Group', longName);

            const config = await configManager.loadConfiguration();
            const group = config.logicalGroups[0];
            assert.strictEqual(group.items[0].name, longName);
        });

        test('should handle note with special characters in name', async () => {
            await configManager.createLogicalGroup('Test Group');
            const specialName = 'Note: 🎉 Test & <Special> "Chars" \'Works\'';
            const noteId = await configManager.createNote('Test Group', specialName);

            const config = await configManager.loadConfiguration();
            const group = config.logicalGroups[0];
            assert.strictEqual(group.items[0].name, specialName);
        });

        test('should handle concurrent note operations', async () => {
            await configManager.createLogicalGroup('Concurrent Group');

            // Create multiple notes concurrently
            const promises = [];
            for (let i = 0; i < 10; i++) {
                promises.push(configManager.createNote('Concurrent Group', `Note ${i}`));
            }

            const noteIds = await Promise.all(promises);

            // Verify all notes created
            const config = await configManager.loadConfiguration();
            const group = config.logicalGroups[0];
            assert.strictEqual(group.items.length, 10);

            // Verify all IDs are unique
            const uniqueIds = new Set(noteIds);
            assert.strictEqual(uniqueIds.size, 10);
        });

        test('should handle empty note name', async () => {
            await configManager.createLogicalGroup('Test Group');
            const noteId = await configManager.createNote('Test Group', '');

            const config = await configManager.loadConfiguration();
            const group = config.logicalGroups[0];
            assert.strictEqual(group.items[0].name, '');
        });

        test('should handle deleting already deleted note gracefully', async () => {
            await configManager.createLogicalGroup('Test Group');
            const noteId = await configManager.createNote('Test Group', 'Test Note');

            // Delete once
            await configManager.deleteNote('Test Group', noteId);

            // Try to delete again - should not throw
            await configManager.deleteNote('Test Group', noteId);

            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 0);
        });

        test('should handle moving note that does not exist in source group', async () => {
            await configManager.createLogicalGroup('Source');
            await configManager.createLogicalGroup('Target');

            // Try to move non-existent note
            await assert.rejects(
                async () => await configManager.moveNote('Source', 'Target', 'fake_note_id'),
                /note not found/i
            );
        });

        test('should not create duplicate notes with same name in group', async () => {
            await configManager.createLogicalGroup('Test Group');

            const noteId1 = await configManager.createNote('Test Group', 'Duplicate Name');
            const noteId2 = await configManager.createNote('Test Group', 'Duplicate Name');

            // Both notes should exist (names can be duplicate, but IDs are different)
            const config = await configManager.loadConfiguration();
            const group = config.logicalGroups[0];
            assert.strictEqual(group.items.length, 2);
            assert.notStrictEqual(noteId1, noteId2);
        });
    });
});
