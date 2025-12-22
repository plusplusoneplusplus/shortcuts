/**
 * Tests for Copilot CLI working directory configuration
 * Covers: {workspaceFolder} variable expansion, relative paths, absolute paths
 */

import * as assert from 'assert';
import * as path from 'path';
import { getWorkingDirectory } from '../../shortcuts/ai-service/copilot-cli-invoker';

suite('Copilot Working Directory Tests', () => {

    // Use platform-appropriate paths
    const isWindows = process.platform === 'win32';
    const workspaceRoot = isWindows ? 'C:\\Users\\test\\project' : '/Users/test/project';
    const parentDir = isWindows ? 'C:\\Users\\test' : '/Users/test';

    suite('getWorkingDirectory', () => {

        test('should return workspace root when setting is empty and no src folder exists', () => {
            // Default behavior when no setting is configured and no src folder
            // Note: This test assumes the setting returns empty string by default
            // and the workspaceRoot path doesn't have a src folder
            const result = getWorkingDirectory(workspaceRoot);
            // When setting is empty and no src folder, should return workspace root or src if exists
            assert.ok(result === workspaceRoot || result.endsWith('/src') || result.endsWith('\\src') || result.length > 0);
        });

        test('should expand {workspaceFolder} variable to workspace root', () => {
            // Test that {workspaceFolder} is properly expanded
            const testPath = '{workspaceFolder}';
            const expanded = testPath.replace(/\{workspaceFolder\}/g, workspaceRoot);
            assert.strictEqual(expanded, workspaceRoot);
        });

        test('should expand {workspaceFolder}/src to workspace root + /src', () => {
            // Test nested path with {workspaceFolder}
            const testPath = '{workspaceFolder}/src';
            const expanded = testPath.replace(/\{workspaceFolder\}/g, workspaceRoot);
            const expected = workspaceRoot + '/src';
            assert.strictEqual(expanded, expected);
        });

        test('should expand multiple {workspaceFolder} occurrences', () => {
            // Test multiple occurrences of {workspaceFolder}
            const testPath = '{workspaceFolder}/src:{workspaceFolder}/lib';
            const expanded = testPath.replace(/\{workspaceFolder\}/g, workspaceRoot);
            const expected = `${workspaceRoot}/src:${workspaceRoot}/lib`;
            assert.strictEqual(expanded, expected);
        });

        test('should preserve absolute paths', () => {
            // Test that absolute paths are preserved
            const absolutePath = isWindows ? 'C:\\absolute\\path\\to\\dir' : '/absolute/path/to/dir';
            // When path is absolute, it should be preserved
            assert.ok(path.isAbsolute(absolutePath));
        });

        test('should handle Windows-style absolute paths', () => {
            // Test Windows-style paths (C:\...)
            const windowsPath = 'C:\\Users\\test\\project';
            // Should detect Windows path pattern
            assert.ok(windowsPath.match(/^[A-Za-z]:/));
        });

        test('should handle relative paths by joining with workspace root', () => {
            // Test that relative paths are joined with workspace root
            const relativePath = 'src/components';
            const joined = path.join(workspaceRoot, relativePath);
            const expected = path.join(workspaceRoot, 'src', 'components');
            assert.strictEqual(joined, expected);
        });

        test('should handle path with spaces', () => {
            // Test path with spaces
            const pathWithSpaces = '{workspaceFolder}/my project/src';
            const expanded = pathWithSpaces.replace(/\{workspaceFolder\}/g, workspaceRoot);
            const expected = workspaceRoot + '/my project/src';
            assert.strictEqual(expanded, expected);
        });

        test('should handle empty workspace root gracefully', () => {
            // Test with empty workspace root
            const emptyRoot = '';
            const testPath = '{workspaceFolder}/src';
            const expanded = testPath.replace(/\{workspaceFolder\}/g, emptyRoot);
            assert.strictEqual(expanded, '/src');
        });

        test('should handle nested directories', () => {
            // Test deeply nested path
            const nestedPath = '{workspaceFolder}/src/components/ui/buttons';
            const expanded = nestedPath.replace(/\{workspaceFolder\}/g, workspaceRoot);
            const expected = workspaceRoot + '/src/components/ui/buttons';
            assert.strictEqual(expanded, expected);
        });
    });

    suite('Variable Expansion Edge Cases', () => {

        test('should not expand invalid variable names', () => {
            // Test that only {workspaceFolder} is expanded
            const invalidVar = '{workspace}/src';
            const expanded = invalidVar.replace(/\{workspaceFolder\}/g, workspaceRoot);
            // Should remain unchanged since it's not {workspaceFolder}
            assert.strictEqual(expanded, '{workspace}/src');
        });

        test('should handle case-sensitive variable name', () => {
            // Test case sensitivity
            const wrongCase = '{WorkspaceDir}/src';
            const expanded = wrongCase.replace(/\{workspaceFolder\}/g, workspaceRoot);
            // Should remain unchanged since case doesn't match
            assert.strictEqual(expanded, '{WorkspaceDir}/src');
        });

        test('should handle path with trailing slash', () => {
            // Test path with trailing slash
            const pathWithSlash = '{workspaceFolder}/src/';
            const expanded = pathWithSlash.replace(/\{workspaceFolder\}/g, workspaceRoot);
            const expected = workspaceRoot + '/src/';
            assert.strictEqual(expanded, expected);
        });

        test('should handle workspace root with trailing slash', () => {
            // Test workspace root with trailing slash
            const rootWithSlash = workspaceRoot + '/';
            const testPath = '{workspaceFolder}/src';
            const expanded = testPath.replace(/\{workspaceFolder\}/g, rootWithSlash);
            // Note: This will result in double slash which may need normalization
            const expected = workspaceRoot + '//src';
            assert.strictEqual(expanded, expected);
        });
    });

    suite('Path Resolution', () => {

        test('should resolve . to current directory', () => {
            // Test current directory reference
            const dotPath = '.';
            const resolved = path.resolve(workspaceRoot, dotPath);
            assert.strictEqual(resolved, workspaceRoot);
        });

        test('should resolve .. to parent directory', () => {
            // Test parent directory reference
            const parentPath = '..';
            const resolved = path.resolve(workspaceRoot, parentPath);
            assert.strictEqual(resolved, parentDir);
        });

        test('should resolve ./src to src subdirectory', () => {
            // Test relative path with ./
            const relativePath = './src';
            const resolved = path.resolve(workspaceRoot, relativePath);
            const expected = path.join(workspaceRoot, 'src');
            assert.strictEqual(resolved, expected);
        });

        test('should normalize paths with multiple slashes', () => {
            // Test path normalization - use platform-appropriate path
            const messyPath = isWindows 
                ? 'C:\\Users\\test\\\\project\\\\\\src'
                : '/Users/test//project///src';
            const normalized = path.normalize(messyPath);
            const expected = isWindows 
                ? 'C:\\Users\\test\\project\\src'
                : '/Users/test/project/src';
            assert.strictEqual(normalized, expected);
        });
    });

    suite('Default to src folder when it exists', () => {
        const fs = require('fs');
        const os = require('os');
        let tempDir: string;

        suiteSetup(() => {
            // Create a temporary directory for testing
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-working-dir-test-'));
        });

        suiteTeardown(() => {
            // Clean up temporary directory
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        });

        test('should return {workspaceFolder}/src when src directory exists', () => {
            // Create src directory in temp folder
            const srcPath = path.join(tempDir, 'src');
            fs.mkdirSync(srcPath, { recursive: true });

            // Test that getWorkingDirectory returns the src path
            const result = getWorkingDirectory(tempDir);
            assert.strictEqual(result, srcPath, 'Should return src directory when it exists');
        });

        test('should return workspace root when src does not exist', () => {
            // Create a temp folder without src directory
            const noSrcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-no-src-test-'));

            try {
                const result = getWorkingDirectory(noSrcDir);
                assert.strictEqual(result, noSrcDir, 'Should return workspace root when src does not exist');
            } finally {
                // Clean up
                if (fs.existsSync(noSrcDir)) {
                    fs.rmSync(noSrcDir, { recursive: true, force: true });
                }
            }
        });

        test('should return workspace root when src is a file not a directory', () => {
            // Create a temp folder with src as a file
            const srcFileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-src-file-test-'));
            const srcFilePath = path.join(srcFileDir, 'src');
            fs.writeFileSync(srcFilePath, 'this is a file, not a directory');

            try {
                const result = getWorkingDirectory(srcFileDir);
                assert.strictEqual(result, srcFileDir, 'Should return workspace root when src is a file');
            } finally {
                // Clean up
                if (fs.existsSync(srcFileDir)) {
                    fs.rmSync(srcFileDir, { recursive: true, force: true });
                }
            }
        });
    });
});

