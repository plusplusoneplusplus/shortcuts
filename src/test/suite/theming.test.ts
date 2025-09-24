import * as assert from 'assert';
import * as vscode from 'vscode';
import { FileShortcutItem, FolderShortcutItem } from '../../shortcuts/tree-items';

suite('Theming Integration Tests', () => {
    test('FolderShortcutItem uses theme icons', () => {
        const testUri = vscode.Uri.file('/test/folder');
        const folderItem = new FolderShortcutItem('Test Folder', testUri);

        const icon = folderItem.getIconPath();
        assert.ok(icon instanceof vscode.ThemeIcon, 'Folder should use ThemeIcon');
        assert.strictEqual(icon.id, 'folder', 'Collapsed folder should use folder icon');
    });

    test('FolderShortcutItem shows correct expanded icon', () => {
        const testUri = vscode.Uri.file('/test/folder');
        const folderItem = new FolderShortcutItem(
            'Test Folder',
            testUri,
            vscode.TreeItemCollapsibleState.Expanded
        );

        const icon = folderItem.getIconPath();
        assert.ok(icon instanceof vscode.ThemeIcon, 'Expanded folder should use ThemeIcon');
        assert.strictEqual(icon.id, 'folder-opened', 'Expanded folder should use folder-opened icon');
    });

    test('FileShortcutItem uses appropriate theme icons for different file types', () => {
        const testCases = [
            { fileName: 'test.js', expectedIcon: 'symbol-method' },
            { fileName: 'test.ts', expectedIcon: 'symbol-method' },
            { fileName: 'test.json', expectedIcon: 'symbol-object' },
            { fileName: 'test.md', expectedIcon: 'book' },
            { fileName: 'test.css', expectedIcon: 'symbol-color' },
            { fileName: 'test.html', expectedIcon: 'symbol-color' },
            { fileName: 'test.py', expectedIcon: 'symbol-method' },
            { fileName: 'test.txt', expectedIcon: 'note' },
            { fileName: 'unknown.xyz', expectedIcon: 'file' }
        ];

        testCases.forEach(({ fileName, expectedIcon }) => {
            const testUri = vscode.Uri.file(`/test/${fileName}`);
            const fileItem = new FileShortcutItem(fileName, testUri);

            const icon = fileItem.getIconPath();
            assert.ok(icon instanceof vscode.ThemeIcon, `${fileName} should use ThemeIcon`);
            assert.strictEqual(icon.id, expectedIcon, `${fileName} should use ${expectedIcon} icon`);
        });
    });

    test('Special folder names get appropriate icons', () => {
        const specialFolders = [
            { name: 'src', expectedIcon: 'folder-library' },
            { name: 'components', expectedIcon: 'symbol-class' },
            { name: 'tests', expectedIcon: 'beaker' },
            { name: 'docs', expectedIcon: 'book' },
            { name: 'config', expectedIcon: 'settings-gear' },
            { name: 'utils', expectedIcon: 'tools' },
            { name: 'scripts', expectedIcon: 'terminal' },
            { name: 'build', expectedIcon: 'package' },
            { name: 'public', expectedIcon: 'globe' },
            { name: 'node_modules', expectedIcon: 'library' }
        ];

        specialFolders.forEach(({ name, expectedIcon }) => {
            const testUri = vscode.Uri.file(`/test/${name}`);
            const folderItem = new FolderShortcutItem(name, testUri);

            const icon = folderItem.getIconPath();
            assert.ok(icon instanceof vscode.ThemeIcon, `${name} folder should use ThemeIcon`);
            assert.strictEqual(icon.id, expectedIcon, `${name} folder should use ${expectedIcon} icon`);
        });
    });

    test('Special file names get appropriate icons', () => {
        const specialFiles = [
            { name: 'package.json', expectedIcon: 'package' },
            { name: 'tsconfig.json', expectedIcon: 'settings-gear' },
            { name: 'README.md', expectedIcon: 'book' },
            { name: '.gitignore', expectedIcon: 'git-branch' },
            { name: '.env', expectedIcon: 'key' },
            { name: 'Dockerfile', expectedIcon: 'vm' }
        ];

        specialFiles.forEach(({ name, expectedIcon }) => {
            const testUri = vscode.Uri.file(`/test/${name}`);
            const fileItem = new FileShortcutItem(name, testUri);

            const icon = fileItem.getIconPath();
            assert.ok(icon instanceof vscode.ThemeIcon, `${name} should use ThemeIcon`);
            assert.strictEqual(icon.id, expectedIcon, `${name} should use ${expectedIcon} icon`);
        });
    });

    test('Tree items have proper tooltip with file path', () => {
        const testUri = vscode.Uri.file('/test/folder/file.js');
        const fileItem = new FileShortcutItem('file.js', testUri);

        assert.strictEqual(fileItem.tooltip, testUri.fsPath, 'Tooltip should show full file path');
    });

    test('File items have open command configured', () => {
        const testUri = vscode.Uri.file('/test/file.js');
        const fileItem = new FileShortcutItem('file.js', testUri);

        assert.ok(fileItem.command, 'File item should have command configured');
        assert.strictEqual(fileItem.command.command, 'vscode.open', 'Should use vscode.open command');
        assert.deepStrictEqual(fileItem.command.arguments, [testUri], 'Should pass file URI as argument');
    });
});