/**
 * Tests for prompt-files-utils.ts
 * Tests the utility functions for reading VS Code Copilot prompt file locations
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    getPromptFileLocations,
    getPromptFileNames,
    getPromptFilePaths,
    getPromptFiles,
    PromptFile
} from '../../shortcuts/shared/prompt-files-utils';

suite('Prompt Files Utils Tests', () => {
    let tempDir: string;
    let originalConfig: Record<string, boolean> | undefined;

    suiteSetup(async () => {
        // Create a temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-files-test-'));

        // Store original config value
        const config = vscode.workspace.getConfiguration('chat');
        originalConfig = config.get<Record<string, boolean>>('promptFilesLocations');
    });

    suiteTeardown(async () => {
        // Restore original config value
        const config = vscode.workspace.getConfiguration('chat');
        await config.update('promptFilesLocations', originalConfig, vscode.ConfigurationTarget.Global);

        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    teardown(async () => {
        // Reset config after each test
        const config = vscode.workspace.getConfiguration('chat');
        await config.update('promptFilesLocations', originalConfig, vscode.ConfigurationTarget.Global);
    });

    suite('getPromptFileLocations', () => {
        test('should return empty array when setting is not configured', async () => {
            const config = vscode.workspace.getConfiguration('chat');
            await config.update('promptFilesLocations', {}, vscode.ConfigurationTarget.Global);

            const locations = getPromptFileLocations();
            assert.ok(Array.isArray(locations));
            assert.strictEqual(locations.length, 0);
        });

        test('should return only enabled folders (value is true)', async () => {
            const config = vscode.workspace.getConfiguration('chat');
            await config.update('promptFilesLocations', {
                '.github/prompts': true,
                '.vscode/prompts': false,
                'prompts': true
            }, vscode.ConfigurationTarget.Global);

            const locations = getPromptFileLocations();
            assert.strictEqual(locations.length, 2);
            assert.ok(locations.includes('.github/prompts'));
            assert.ok(locations.includes('prompts'));
            assert.ok(!locations.includes('.vscode/prompts'));
        });

        test('should return empty array when all folders are disabled', async () => {
            const config = vscode.workspace.getConfiguration('chat');
            await config.update('promptFilesLocations', {
                '.github/prompts': false,
                '.vscode/prompts': false
            }, vscode.ConfigurationTarget.Global);

            const locations = getPromptFileLocations();
            assert.strictEqual(locations.length, 0);
        });

        test('should handle undefined setting gracefully', async () => {
            const config = vscode.workspace.getConfiguration('chat');
            await config.update('promptFilesLocations', undefined, vscode.ConfigurationTarget.Global);

            const locations = getPromptFileLocations();
            assert.ok(Array.isArray(locations));
            // May have default value from VS Code
        });
    });

    suite('getPromptFiles', () => {
        let promptsDir: string;

        setup(() => {
            // Create test directory structure
            promptsDir = path.join(tempDir, 'prompts');
            fs.mkdirSync(promptsDir, { recursive: true });
        });

        teardown(() => {
            // Clean up test files
            if (fs.existsSync(promptsDir)) {
                fs.rmSync(promptsDir, { recursive: true, force: true });
            }
        });

        test('should return empty array when no workspace root provided and no workspace open', async () => {
            // This test may behave differently depending on test environment
            // If there's a workspace, it will use it; otherwise empty array
            const files = await getPromptFiles('/non-existent-path-12345');
            assert.ok(Array.isArray(files));
        });

        test('should return empty array when folder does not exist', async () => {
            const config = vscode.workspace.getConfiguration('chat');
            await config.update('promptFilesLocations', {
                'non-existent-folder': true
            }, vscode.ConfigurationTarget.Global);

            const files = await getPromptFiles(tempDir);
            assert.ok(Array.isArray(files));
            assert.strictEqual(files.length, 0);
        });

        test('should return empty array when folder exists but has no .prompt.md files', async () => {
            // Create folder with non-prompt files
            fs.writeFileSync(path.join(promptsDir, 'readme.md'), '# Readme');
            fs.writeFileSync(path.join(promptsDir, 'notes.txt'), 'notes');

            const config = vscode.workspace.getConfiguration('chat');
            await config.update('promptFilesLocations', {
                'prompts': true
            }, vscode.ConfigurationTarget.Global);

            const files = await getPromptFiles(tempDir);
            assert.strictEqual(files.length, 0);
        });

        test('should find .prompt.md files in configured folder', async () => {
            // Create prompt files
            fs.writeFileSync(path.join(promptsDir, 'code-review.prompt.md'), '# Code Review Prompt');
            fs.writeFileSync(path.join(promptsDir, 'explain.prompt.md'), '# Explain Prompt');

            const config = vscode.workspace.getConfiguration('chat');
            await config.update('promptFilesLocations', {
                'prompts': true
            }, vscode.ConfigurationTarget.Global);

            const files = await getPromptFiles(tempDir);
            assert.strictEqual(files.length, 2);

            const names = files.map(f => f.name).sort();
            assert.deepStrictEqual(names, ['code-review', 'explain']);
        });

        test('should find .prompt.md files recursively in subdirectories', async () => {
            // Create nested structure
            const nestedDir = path.join(promptsDir, 'nested', 'deep');
            fs.mkdirSync(nestedDir, { recursive: true });

            fs.writeFileSync(path.join(promptsDir, 'root.prompt.md'), '# Root');
            fs.writeFileSync(path.join(promptsDir, 'nested', 'middle.prompt.md'), '# Middle');
            fs.writeFileSync(path.join(nestedDir, 'deep.prompt.md'), '# Deep');

            const config = vscode.workspace.getConfiguration('chat');
            await config.update('promptFilesLocations', {
                'prompts': true
            }, vscode.ConfigurationTarget.Global);

            const files = await getPromptFiles(tempDir);
            assert.strictEqual(files.length, 3);

            const names = files.map(f => f.name).sort();
            assert.deepStrictEqual(names, ['deep', 'middle', 'root']);
        });

        test('should return correct PromptFile structure', async () => {
            fs.writeFileSync(path.join(promptsDir, 'test.prompt.md'), '# Test');

            const config = vscode.workspace.getConfiguration('chat');
            await config.update('promptFilesLocations', {
                'prompts': true
            }, vscode.ConfigurationTarget.Global);

            const files = await getPromptFiles(tempDir);
            assert.strictEqual(files.length, 1);

            const file = files[0];
            assert.strictEqual(file.name, 'test');
            assert.strictEqual(file.sourceFolder, 'prompts');
            assert.ok(file.absolutePath.endsWith('test.prompt.md'));
            assert.ok(file.relativePath.includes('prompts'));
            assert.ok(file.relativePath.includes('test.prompt.md'));
        });

        test('should handle multiple configured folders', async () => {
            // Create second folder
            const secondDir = path.join(tempDir, '.github', 'prompts');
            fs.mkdirSync(secondDir, { recursive: true });

            fs.writeFileSync(path.join(promptsDir, 'prompt1.prompt.md'), '# Prompt 1');
            fs.writeFileSync(path.join(secondDir, 'prompt2.prompt.md'), '# Prompt 2');

            const config = vscode.workspace.getConfiguration('chat');
            await config.update('promptFilesLocations', {
                'prompts': true,
                '.github/prompts': true
            }, vscode.ConfigurationTarget.Global);

            const files = await getPromptFiles(tempDir);
            assert.strictEqual(files.length, 2);

            const sourceFolders = files.map(f => f.sourceFolder).sort();
            assert.deepStrictEqual(sourceFolders, ['.github/prompts', 'prompts']);
        });

        test('should ignore disabled folders', async () => {
            // Create two folders but only enable one
            const disabledDir = path.join(tempDir, 'disabled-prompts');
            fs.mkdirSync(disabledDir, { recursive: true });

            fs.writeFileSync(path.join(promptsDir, 'enabled.prompt.md'), '# Enabled');
            fs.writeFileSync(path.join(disabledDir, 'disabled.prompt.md'), '# Disabled');

            const config = vscode.workspace.getConfiguration('chat');
            await config.update('promptFilesLocations', {
                'prompts': true,
                'disabled-prompts': false
            }, vscode.ConfigurationTarget.Global);

            const files = await getPromptFiles(tempDir);
            assert.strictEqual(files.length, 1);
            assert.strictEqual(files[0].name, 'enabled');
        });

        test('should not match files that just end with .md', async () => {
            fs.writeFileSync(path.join(promptsDir, 'regular.md'), '# Regular MD');
            fs.writeFileSync(path.join(promptsDir, 'actual.prompt.md'), '# Actual Prompt');

            const config = vscode.workspace.getConfiguration('chat');
            await config.update('promptFilesLocations', {
                'prompts': true
            }, vscode.ConfigurationTarget.Global);

            const files = await getPromptFiles(tempDir);
            assert.strictEqual(files.length, 1);
            assert.strictEqual(files[0].name, 'actual');
        });

        test('should handle absolute paths in configuration', async () => {
            // Create a folder outside tempDir using absolute path
            const absoluteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'absolute-prompts-'));
            fs.writeFileSync(path.join(absoluteDir, 'absolute.prompt.md'), '# Absolute');

            try {
                const config = vscode.workspace.getConfiguration('chat');
                await config.update('promptFilesLocations', {
                    [absoluteDir]: true
                }, vscode.ConfigurationTarget.Global);

                const files = await getPromptFiles(tempDir);
                assert.strictEqual(files.length, 1);
                assert.strictEqual(files[0].name, 'absolute');
                assert.strictEqual(files[0].sourceFolder, absoluteDir);
            } finally {
                fs.rmSync(absoluteDir, { recursive: true, force: true });
            }
        });

        test('should handle empty folder gracefully', async () => {
            // prompts folder exists but is empty
            const config = vscode.workspace.getConfiguration('chat');
            await config.update('promptFilesLocations', {
                'prompts': true
            }, vscode.ConfigurationTarget.Global);

            const files = await getPromptFiles(tempDir);
            assert.ok(Array.isArray(files));
            assert.strictEqual(files.length, 0);
        });

        test('should handle special characters in file names', async () => {
            fs.writeFileSync(path.join(promptsDir, 'my-code_review.prompt.md'), '# Review');
            fs.writeFileSync(path.join(promptsDir, 'test 123.prompt.md'), '# Test');

            const config = vscode.workspace.getConfiguration('chat');
            await config.update('promptFilesLocations', {
                'prompts': true
            }, vscode.ConfigurationTarget.Global);

            const files = await getPromptFiles(tempDir);
            assert.strictEqual(files.length, 2);

            const names = files.map(f => f.name).sort();
            assert.deepStrictEqual(names, ['my-code_review', 'test 123']);
        });
    });

    suite('getPromptFilePaths', () => {
        let promptsDir: string;

        setup(() => {
            promptsDir = path.join(tempDir, 'prompts');
            fs.mkdirSync(promptsDir, { recursive: true });
        });

        teardown(() => {
            if (fs.existsSync(promptsDir)) {
                fs.rmSync(promptsDir, { recursive: true, force: true });
            }
        });

        test('should return array of absolute paths', async () => {
            fs.writeFileSync(path.join(promptsDir, 'test.prompt.md'), '# Test');

            const config = vscode.workspace.getConfiguration('chat');
            await config.update('promptFilesLocations', {
                'prompts': true
            }, vscode.ConfigurationTarget.Global);

            const paths = await getPromptFilePaths(tempDir);
            assert.strictEqual(paths.length, 1);
            assert.ok(path.isAbsolute(paths[0]));
            assert.ok(paths[0].endsWith('test.prompt.md'));
        });

        test('should return empty array when no files found', async () => {
            const config = vscode.workspace.getConfiguration('chat');
            await config.update('promptFilesLocations', {
                'prompts': true
            }, vscode.ConfigurationTarget.Global);

            const paths = await getPromptFilePaths(tempDir);
            assert.ok(Array.isArray(paths));
            assert.strictEqual(paths.length, 0);
        });
    });

    suite('getPromptFileNames', () => {
        let promptsDir: string;

        setup(() => {
            promptsDir = path.join(tempDir, 'prompts');
            fs.mkdirSync(promptsDir, { recursive: true });
        });

        teardown(() => {
            if (fs.existsSync(promptsDir)) {
                fs.rmSync(promptsDir, { recursive: true, force: true });
            }
        });

        test('should return array of names without .prompt.md extension', async () => {
            fs.writeFileSync(path.join(promptsDir, 'code-review.prompt.md'), '# Review');
            fs.writeFileSync(path.join(promptsDir, 'explain.prompt.md'), '# Explain');

            const config = vscode.workspace.getConfiguration('chat');
            await config.update('promptFilesLocations', {
                'prompts': true
            }, vscode.ConfigurationTarget.Global);

            const names = await getPromptFileNames(tempDir);
            assert.strictEqual(names.length, 2);
            assert.ok(names.includes('code-review'));
            assert.ok(names.includes('explain'));
            // Should NOT include the extension
            assert.ok(!names.some(n => n.includes('.prompt.md')));
        });

        test('should return empty array when no files found', async () => {
            const config = vscode.workspace.getConfiguration('chat');
            await config.update('promptFilesLocations', {
                'prompts': true
            }, vscode.ConfigurationTarget.Global);

            const names = await getPromptFileNames(tempDir);
            assert.ok(Array.isArray(names));
            assert.strictEqual(names.length, 0);
        });
    });

    suite('Edge Cases', () => {
        test('should handle symlinks gracefully', async function() {
            // Skip on Windows where symlinks require special permissions
            if (process.platform === 'win32') {
                this.skip();
                return;
            }

            const realDir = path.join(tempDir, 'real-prompts');
            const symlinkDir = path.join(tempDir, 'symlink-prompts');

            fs.mkdirSync(realDir, { recursive: true });
            fs.writeFileSync(path.join(realDir, 'symlinked.prompt.md'), '# Symlinked');
            fs.symlinkSync(realDir, symlinkDir, 'dir');

            try {
                const config = vscode.workspace.getConfiguration('chat');
                await config.update('promptFilesLocations', {
                    'symlink-prompts': true
                }, vscode.ConfigurationTarget.Global);

                const files = await getPromptFiles(tempDir);
                assert.strictEqual(files.length, 1);
                assert.strictEqual(files[0].name, 'symlinked');
            } finally {
                fs.unlinkSync(symlinkDir);
                fs.rmSync(realDir, { recursive: true, force: true });
            }
        });

        test('should handle permission errors gracefully', async function() {
            // Skip on Windows where permission handling is different
            if (process.platform === 'win32') {
                this.skip();
                return;
            }

            const restrictedDir = path.join(tempDir, 'restricted');
            fs.mkdirSync(restrictedDir, { recursive: true });
            fs.writeFileSync(path.join(restrictedDir, 'secret.prompt.md'), '# Secret');

            // Remove read permission
            fs.chmodSync(restrictedDir, 0o000);

            try {
                const config = vscode.workspace.getConfiguration('chat');
                await config.update('promptFilesLocations', {
                    'restricted': true
                }, vscode.ConfigurationTarget.Global);

                // Should not throw, just return empty or skip the folder
                const files = await getPromptFiles(tempDir);
                assert.ok(Array.isArray(files));
            } finally {
                // Restore permission for cleanup
                fs.chmodSync(restrictedDir, 0o755);
                fs.rmSync(restrictedDir, { recursive: true, force: true });
            }
        });

        test('should handle very deep nesting', async () => {
            const deepPath = path.join(tempDir, 'a', 'b', 'c', 'd', 'e', 'f', 'g');
            fs.mkdirSync(deepPath, { recursive: true });
            fs.writeFileSync(path.join(deepPath, 'deep.prompt.md'), '# Deep');

            const config = vscode.workspace.getConfiguration('chat');
            await config.update('promptFilesLocations', {
                'a': true
            }, vscode.ConfigurationTarget.Global);

            try {
                const files = await getPromptFiles(tempDir);
                assert.strictEqual(files.length, 1);
                assert.strictEqual(files[0].name, 'deep');
            } finally {
                fs.rmSync(path.join(tempDir, 'a'), { recursive: true, force: true });
            }
        });

        test('should handle mixed file types in same folder', async () => {
            const mixedDir = path.join(tempDir, 'mixed');
            fs.mkdirSync(mixedDir, { recursive: true });

            // Create various file types
            fs.writeFileSync(path.join(mixedDir, 'actual.prompt.md'), '# Actual');
            fs.writeFileSync(path.join(mixedDir, 'readme.md'), '# Readme');
            fs.writeFileSync(path.join(mixedDir, 'config.json'), '{}');
            fs.writeFileSync(path.join(mixedDir, 'script.js'), '// js');
            fs.writeFileSync(path.join(mixedDir, '.hidden.prompt.md'), '# Hidden');

            const config = vscode.workspace.getConfiguration('chat');
            await config.update('promptFilesLocations', {
                'mixed': true
            }, vscode.ConfigurationTarget.Global);

            try {
                const files = await getPromptFiles(tempDir);
                // Should only find .prompt.md files
                assert.strictEqual(files.length, 2);
                const names = files.map(f => f.name).sort();
                assert.deepStrictEqual(names, ['.hidden', 'actual']);
            } finally {
                fs.rmSync(mixedDir, { recursive: true, force: true });
            }
        });

        test('should handle folder with only directories (no files)', async () => {
            const parentDir = path.join(tempDir, 'only-dirs');
            fs.mkdirSync(path.join(parentDir, 'subdir1'), { recursive: true });
            fs.mkdirSync(path.join(parentDir, 'subdir2'), { recursive: true });

            const config = vscode.workspace.getConfiguration('chat');
            await config.update('promptFilesLocations', {
                'only-dirs': true
            }, vscode.ConfigurationTarget.Global);

            try {
                const files = await getPromptFiles(tempDir);
                assert.ok(Array.isArray(files));
                assert.strictEqual(files.length, 0);
            } finally {
                fs.rmSync(parentDir, { recursive: true, force: true });
            }
        });
    });
});
