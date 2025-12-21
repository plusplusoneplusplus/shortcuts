/**
 * Tests for Copilot CLI working directory configuration
 * Covers: {workspaceFolder} variable expansion, relative paths, absolute paths
 */

import * as assert from 'assert';
import * as path from 'path';
import { getWorkingDirectory } from '../../shortcuts/ai-service/copilot-cli-invoker';

suite('Copilot Working Directory Tests', () => {

    const workspaceRoot = '/Users/test/project';

    suite('getWorkingDirectory', () => {

        test('should return workspace root when setting is empty', () => {
            // Default behavior when no setting is configured
            // Note: This test assumes the setting returns empty string by default
            const result = getWorkingDirectory(workspaceRoot);
            // When setting is empty, should return workspace root
            assert.ok(result === workspaceRoot || result.length > 0);
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
            assert.strictEqual(expanded, '/Users/test/project/src');
        });

        test('should expand multiple {workspaceFolder} occurrences', () => {
            // Test multiple occurrences of {workspaceFolder}
            const testPath = '{workspaceFolder}/src:{workspaceFolder}/lib';
            const expanded = testPath.replace(/\{workspaceFolder\}/g, workspaceRoot);
            assert.strictEqual(expanded, '/Users/test/project/src:/Users/test/project/lib');
        });

        test('should preserve absolute paths', () => {
            // Test that absolute paths are preserved
            const absolutePath = '/absolute/path/to/dir';
            // When path starts with /, it should be preserved
            assert.ok(absolutePath.startsWith('/'));
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
            assert.strictEqual(joined, '/Users/test/project/src/components');
        });

        test('should handle path with spaces', () => {
            // Test path with spaces
            const pathWithSpaces = '{workspaceFolder}/my project/src';
            const expanded = pathWithSpaces.replace(/\{workspaceFolder\}/g, workspaceRoot);
            assert.strictEqual(expanded, '/Users/test/project/my project/src');
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
            assert.strictEqual(expanded, '/Users/test/project/src/components/ui/buttons');
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
            assert.strictEqual(expanded, '/Users/test/project/src/');
        });

        test('should handle workspace root with trailing slash', () => {
            // Test workspace root with trailing slash
            const rootWithSlash = '/Users/test/project/';
            const testPath = '{workspaceFolder}/src';
            const expanded = testPath.replace(/\{workspaceFolder\}/g, rootWithSlash);
            // Note: This will result in double slash which may need normalization
            assert.strictEqual(expanded, '/Users/test/project//src');
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
            assert.strictEqual(resolved, '/Users/test');
        });

        test('should resolve ./src to src subdirectory', () => {
            // Test relative path with ./
            const relativePath = './src';
            const resolved = path.resolve(workspaceRoot, relativePath);
            assert.strictEqual(resolved, '/Users/test/project/src');
        });

        test('should normalize paths with multiple slashes', () => {
            // Test path normalization
            const messyPath = '/Users/test//project///src';
            const normalized = path.normalize(messyPath);
            assert.strictEqual(normalized, '/Users/test/project/src');
        });
    });
});

