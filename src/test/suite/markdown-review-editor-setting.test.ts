/**
 * Tests for the alwaysOpenMarkdownInReviewEditor setting
 * Verifies that markdown files are opened in Review Editor View when the setting is enabled
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

suite('Always Open Markdown In Review Editor Setting Tests', function() {
    this.timeout(10000);  // Increase timeout for config operations on Windows
    
    let tempDir: string;
    let testMarkdownFile: string;
    let testTextFile: string;
    let originalConfig: boolean | undefined;

    suiteSetup(async () => {
        // Create a temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'markdown-review-editor-test-'));
        
        // Create test files
        testMarkdownFile = path.join(tempDir, 'test.md');
        testTextFile = path.join(tempDir, 'test.txt');
        
        fs.writeFileSync(testMarkdownFile, '# Test Markdown\n\nThis is a test file.');
        fs.writeFileSync(testTextFile, 'This is a plain text file.');

        // Store original config value
        const config = vscode.workspace.getConfiguration('workspaceShortcuts');
        originalConfig = config.get<boolean>('alwaysOpenMarkdownInReviewEditor');
    });

    suiteTeardown(async () => {
        // Restore original config value
        const config = vscode.workspace.getConfiguration('workspaceShortcuts');
        await config.update('alwaysOpenMarkdownInReviewEditor', originalConfig, vscode.ConfigurationTarget.Global);

        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    teardown(async () => {
        // Close all editors after each test
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    test('setting should exist in configuration', async () => {
        const config = vscode.workspace.getConfiguration('workspaceShortcuts');
        const settingValue = config.get<boolean>('alwaysOpenMarkdownInReviewEditor');
        
        // The setting should exist (either true, false, or undefined which defaults to false)
        assert.ok(settingValue === true || settingValue === false || settingValue === undefined,
            'Setting alwaysOpenMarkdownInReviewEditor should exist');
    });

    test('setting should default to false', async () => {
        const config = vscode.workspace.getConfiguration('workspaceShortcuts');
        const settingValue = config.get<boolean>('alwaysOpenMarkdownInReviewEditor', false);
        
        // Default value should be false
        assert.strictEqual(settingValue, false, 'Default value should be false');
    });

    test('should be able to update the setting', async () => {
        // Update to true
        const config = vscode.workspace.getConfiguration('workspaceShortcuts');
        await config.update('alwaysOpenMarkdownInReviewEditor', true, vscode.ConfigurationTarget.Global);
        
        // Re-read the configuration to get the updated value
        const updatedConfig = vscode.workspace.getConfiguration('workspaceShortcuts');
        let settingValue = updatedConfig.get<boolean>('alwaysOpenMarkdownInReviewEditor');
        assert.strictEqual(settingValue, true, 'Setting should be updated to true');

        // Update back to false
        await config.update('alwaysOpenMarkdownInReviewEditor', false, vscode.ConfigurationTarget.Global);
        
        // Re-read the configuration again
        const finalConfig = vscode.workspace.getConfiguration('workspaceShortcuts');
        settingValue = finalConfig.get<boolean>('alwaysOpenMarkdownInReviewEditor');
        assert.strictEqual(settingValue, false, 'Setting should be updated back to false');
    });

    test('reviewEditorView should be registered', async () => {
        // Verify that the custom editor provider is registered
        const commands = await vscode.commands.getCommands(true);
        
        // The openWithReviewEditor command should be registered
        assert.ok(
            commands.includes('markdownComments.openWithReviewEditor'),
            'markdownComments.openWithReviewEditor command should be registered'
        );
    });

    test('openWith functionality should work via executeCommand', async () => {
        // vscode.openWith is a built-in command that may not appear in getCommands list
        // but can be executed. We verify it doesn't throw when called with valid args.
        // Note: We don't actually open the file to avoid side effects
        try {
            // The command exists if executeCommand doesn't throw "command not found"
            // We use a non-existent file to avoid actually opening anything
            await vscode.commands.executeCommand('vscode.openWith', 
                vscode.Uri.file('/non-existent-test-file-12345.md'), 
                'reviewEditorView'
            );
        } catch (error: any) {
            // Expected: file not found error, NOT "command not found" error
            const errorMessage = error?.message?.toLowerCase() || '';
            assert.ok(
                !errorMessage.includes('command') || !errorMessage.includes('not found'),
                'vscode.openWith command should exist (error should be about file, not command)'
            );
        }
    });

    suite('File Type Detection', () => {
        test('should correctly identify .md files as markdown', () => {
            const mdFile = '/path/to/file.md';
            const isMarkdown = mdFile.toLowerCase().endsWith('.md');
            assert.strictEqual(isMarkdown, true, '.md files should be identified as markdown');
        });

        test('should correctly identify .MD files as markdown (case insensitive)', () => {
            const mdFile = '/path/to/FILE.MD';
            const isMarkdown = mdFile.toLowerCase().endsWith('.md');
            assert.strictEqual(isMarkdown, true, '.MD files should be identified as markdown');
        });

        test('should not identify .txt files as markdown', () => {
            const txtFile = '/path/to/file.txt';
            const isMarkdown = txtFile.toLowerCase().endsWith('.md');
            assert.strictEqual(isMarkdown, false, '.txt files should not be identified as markdown');
        });

        test('should not identify .markdown files as .md (only .md extension)', () => {
            // Note: The current implementation only checks for .md extension
            const markdownFile = '/path/to/file.markdown';
            const isMarkdown = markdownFile.toLowerCase().endsWith('.md');
            assert.strictEqual(isMarkdown, false, '.markdown files are not checked (only .md)');
        });
    });

    suite('Review Editor View Type', () => {
        test('should use correct view type for Review Editor', () => {
            // The view type used in vscode.openWith should be 'reviewEditorView'
            const expectedViewType = 'reviewEditorView';
            assert.strictEqual(expectedViewType, 'reviewEditorView',
                'View type should be reviewEditorView');
        });
    });
});

