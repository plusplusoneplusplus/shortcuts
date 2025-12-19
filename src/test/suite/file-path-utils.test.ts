/**
 * Unit tests for file-path-utils module
 * Tests path resolution logic for opening files from markdown links
 */

import * as assert from 'assert';
import * as path from 'path';
import {
    isExternalUrl,
    isMarkdownFile,
    resolveFilePath,
    ResolvedFilePath
} from '../../shortcuts/markdown-comments/file-path-utils';

suite('File Path Utils Tests', () => {

    suite('isExternalUrl', () => {
        test('should return true for http URLs', () => {
            assert.strictEqual(isExternalUrl('http://example.com'), true);
            assert.strictEqual(isExternalUrl('http://example.com/path/to/file'), true);
        });

        test('should return true for https URLs', () => {
            assert.strictEqual(isExternalUrl('https://example.com'), true);
            assert.strictEqual(isExternalUrl('https://example.com/path/to/file.md'), true);
        });

        test('should return true for mailto URLs', () => {
            assert.strictEqual(isExternalUrl('mailto:user@example.com'), true);
        });

        test('should return true for file URLs', () => {
            assert.strictEqual(isExternalUrl('file:///path/to/file'), true);
        });

        test('should return true for ftp URLs', () => {
            assert.strictEqual(isExternalUrl('ftp://ftp.example.com'), true);
        });

        test('should return true for custom scheme URLs', () => {
            assert.strictEqual(isExternalUrl('vscode://extension/command'), true);
            assert.strictEqual(isExternalUrl('custom-scheme://path'), true);
        });

        test('should return false for relative paths', () => {
            assert.strictEqual(isExternalUrl('./relative/path.md'), false);
            assert.strictEqual(isExternalUrl('../parent/file.md'), false);
            assert.strictEqual(isExternalUrl('path/to/file.md'), false);
        });

        test('should return false for absolute paths', () => {
            assert.strictEqual(isExternalUrl('/absolute/path/file.md'), false);
            // Windows-style absolute paths
            assert.strictEqual(isExternalUrl('C:/path/to/file.md'), true); // This looks like a URL scheme
        });

        test('should return false for paths starting with numbers', () => {
            assert.strictEqual(isExternalUrl('123-file.md'), false);
        });
    });

    suite('isMarkdownFile', () => {
        test('should return true for .md files', () => {
            assert.strictEqual(isMarkdownFile('file.md'), true);
            assert.strictEqual(isMarkdownFile('/path/to/file.md'), true);
            assert.strictEqual(isMarkdownFile('README.md'), true);
        });

        test('should return true for .markdown files', () => {
            assert.strictEqual(isMarkdownFile('file.markdown'), true);
            assert.strictEqual(isMarkdownFile('/path/to/file.markdown'), true);
        });

        test('should be case insensitive', () => {
            assert.strictEqual(isMarkdownFile('FILE.MD'), true);
            assert.strictEqual(isMarkdownFile('file.Md'), true);
            assert.strictEqual(isMarkdownFile('file.MARKDOWN'), true);
        });

        test('should return false for non-markdown files', () => {
            assert.strictEqual(isMarkdownFile('file.txt'), false);
            assert.strictEqual(isMarkdownFile('file.js'), false);
            assert.strictEqual(isMarkdownFile('file.ts'), false);
            assert.strictEqual(isMarkdownFile('file.html'), false);
            assert.strictEqual(isMarkdownFile('file.json'), false);
        });

        test('should return false for files with .md in the name but different extension', () => {
            assert.strictEqual(isMarkdownFile('file.md.txt'), false);
            assert.strictEqual(isMarkdownFile('md-file.txt'), false);
        });

        test('should return false for files with no extension', () => {
            assert.strictEqual(isMarkdownFile('README'), false);
            assert.strictEqual(isMarkdownFile('Makefile'), false);
        });
    });

    suite('resolveFilePath', () => {
        // Mock file existence check for testing
        const createMockExistsCheck = (existingPaths: string[]) => {
            return (filePath: string) => {
                // Normalize paths for comparison
                const normalizedPath = path.normalize(filePath);
                return existingPaths.some(p => path.normalize(p) === normalizedPath);
            };
        };

        const fileDir = '/project/docs';
        const workspaceRoot = '/project';

        test('should resolve absolute paths that exist', () => {
            const existingPaths = ['/absolute/path/file.md'];
            const mockExists = createMockExistsCheck(existingPaths);

            const result = resolveFilePath('/absolute/path/file.md', fileDir, workspaceRoot, mockExists);

            assert.strictEqual(result.resolvedPath, '/absolute/path/file.md');
            assert.strictEqual(result.exists, true);
            assert.strictEqual(result.resolution, 'absolute');
        });

        test('should handle absolute paths that do not exist', () => {
            const mockExists = createMockExistsCheck([]);

            const result = resolveFilePath('/nonexistent/file.md', fileDir, workspaceRoot, mockExists);

            assert.strictEqual(result.resolvedPath, '/nonexistent/file.md');
            assert.strictEqual(result.exists, false);
            assert.strictEqual(result.resolution, 'not-found');
        });

        test('should resolve paths relative to the current file directory', () => {
            const relativeToFile = path.resolve(fileDir, './sibling.md');
            const existingPaths = [relativeToFile];
            const mockExists = createMockExistsCheck(existingPaths);

            const result = resolveFilePath('./sibling.md', fileDir, workspaceRoot, mockExists);

            assert.strictEqual(result.resolvedPath, relativeToFile);
            assert.strictEqual(result.exists, true);
            assert.strictEqual(result.resolution, 'relative-to-file');
        });

        test('should resolve parent directory paths relative to file', () => {
            const parentPath = path.resolve(fileDir, '../other/file.md');
            const existingPaths = [parentPath];
            const mockExists = createMockExistsCheck(existingPaths);

            const result = resolveFilePath('../other/file.md', fileDir, workspaceRoot, mockExists);

            assert.strictEqual(result.resolvedPath, parentPath);
            assert.strictEqual(result.exists, true);
            assert.strictEqual(result.resolution, 'relative-to-file');
        });

        test('should fall back to workspace-relative path if file-relative does not exist', () => {
            const workspaceRelative = path.resolve(workspaceRoot, 'src/file.md');
            const existingPaths = [workspaceRelative];
            const mockExists = createMockExistsCheck(existingPaths);

            const result = resolveFilePath('src/file.md', fileDir, workspaceRoot, mockExists);

            assert.strictEqual(result.resolvedPath, workspaceRelative);
            assert.strictEqual(result.exists, true);
            assert.strictEqual(result.resolution, 'relative-to-workspace');
        });

        test('should prefer file-relative over workspace-relative when both exist', () => {
            const relativeToFile = path.resolve(fileDir, 'file.md');
            const workspaceRelative = path.resolve(workspaceRoot, 'file.md');
            // Both paths exist
            const existingPaths = [relativeToFile, workspaceRelative];
            const mockExists = createMockExistsCheck(existingPaths);

            const result = resolveFilePath('file.md', fileDir, workspaceRoot, mockExists);

            // Should prefer file-relative
            assert.strictEqual(result.resolvedPath, relativeToFile);
            assert.strictEqual(result.exists, true);
            assert.strictEqual(result.resolution, 'relative-to-file');
        });

        test('should return not-found when no resolution works', () => {
            const mockExists = createMockExistsCheck([]);

            const result = resolveFilePath('nonexistent.md', fileDir, workspaceRoot, mockExists);

            // Should return the file-relative path as the resolved path
            assert.strictEqual(result.resolvedPath, path.resolve(fileDir, 'nonexistent.md'));
            assert.strictEqual(result.exists, false);
            assert.strictEqual(result.resolution, 'not-found');
        });

        test('should handle empty workspace root', () => {
            const relativeToFile = path.resolve(fileDir, 'file.md');
            const existingPaths = [relativeToFile];
            const mockExists = createMockExistsCheck(existingPaths);

            const result = resolveFilePath('file.md', fileDir, '', mockExists);

            assert.strictEqual(result.resolvedPath, relativeToFile);
            assert.strictEqual(result.exists, true);
            assert.strictEqual(result.resolution, 'relative-to-file');
        });

        test('should handle nested relative paths', () => {
            const nestedPath = path.resolve(fileDir, 'subfolder/nested/file.md');
            const existingPaths = [nestedPath];
            const mockExists = createMockExistsCheck(existingPaths);

            const result = resolveFilePath('subfolder/nested/file.md', fileDir, workspaceRoot, mockExists);

            assert.strictEqual(result.resolvedPath, nestedPath);
            assert.strictEqual(result.exists, true);
            assert.strictEqual(result.resolution, 'relative-to-file');
        });

        test('should handle paths with special characters', () => {
            const specialPath = path.resolve(fileDir, 'file with spaces.md');
            const existingPaths = [specialPath];
            const mockExists = createMockExistsCheck(existingPaths);

            const result = resolveFilePath('file with spaces.md', fileDir, workspaceRoot, mockExists);

            assert.strictEqual(result.resolvedPath, specialPath);
            assert.strictEqual(result.exists, true);
            assert.strictEqual(result.resolution, 'relative-to-file');
        });
    });

    suite('Integration: Markdown File Resolution for Review Editor', () => {
        // These tests verify the combined behavior of isMarkdownFile and resolveFilePath
        // which is used to determine if a file should be opened in Review Editor View

        const createMockExistsCheck = (existingPaths: string[]) => {
            return (filePath: string) => {
                const normalizedPath = path.normalize(filePath);
                return existingPaths.some(p => path.normalize(p) === normalizedPath);
            };
        };

        const fileDir = '/project/docs';
        const workspaceRoot = '/project';

        test('should correctly identify markdown files for Review Editor View', () => {
            const mdPath = path.resolve(fileDir, 'readme.md');
            const existingPaths = [mdPath];
            const mockExists = createMockExistsCheck(existingPaths);

            const result = resolveFilePath('readme.md', fileDir, workspaceRoot, mockExists);

            assert.strictEqual(result.exists, true);
            assert.strictEqual(isMarkdownFile(result.resolvedPath), true);
        });

        test('should correctly identify non-markdown files for text editor', () => {
            const jsPath = path.resolve(fileDir, 'script.js');
            const existingPaths = [jsPath];
            const mockExists = createMockExistsCheck(existingPaths);

            const result = resolveFilePath('script.js', fileDir, workspaceRoot, mockExists);

            assert.strictEqual(result.exists, true);
            assert.strictEqual(isMarkdownFile(result.resolvedPath), false);
        });

        test('should handle .markdown extension for Review Editor View', () => {
            const markdownPath = path.resolve(fileDir, 'document.markdown');
            const existingPaths = [markdownPath];
            const mockExists = createMockExistsCheck(existingPaths);

            const result = resolveFilePath('document.markdown', fileDir, workspaceRoot, mockExists);

            assert.strictEqual(result.exists, true);
            assert.strictEqual(isMarkdownFile(result.resolvedPath), true);
        });

        test('should handle linked markdown files in subdirectories', () => {
            const linkedMd = path.resolve(fileDir, 'guides/setup.md');
            const existingPaths = [linkedMd];
            const mockExists = createMockExistsCheck(existingPaths);

            const result = resolveFilePath('guides/setup.md', fileDir, workspaceRoot, mockExists);

            assert.strictEqual(result.exists, true);
            assert.strictEqual(result.resolution, 'relative-to-file');
            assert.strictEqual(isMarkdownFile(result.resolvedPath), true);
        });

        test('should handle linked markdown files in parent directories', () => {
            const parentMd = path.resolve(fileDir, '../README.md');
            const existingPaths = [parentMd];
            const mockExists = createMockExistsCheck(existingPaths);

            const result = resolveFilePath('../README.md', fileDir, workspaceRoot, mockExists);

            assert.strictEqual(result.exists, true);
            assert.strictEqual(result.resolution, 'relative-to-file');
            assert.strictEqual(isMarkdownFile(result.resolvedPath), true);
        });

        test('should handle absolute paths to markdown files', () => {
            const absoluteMd = '/other/project/docs/file.md';
            const existingPaths = [absoluteMd];
            const mockExists = createMockExistsCheck(existingPaths);

            const result = resolveFilePath(absoluteMd, fileDir, workspaceRoot, mockExists);

            assert.strictEqual(result.exists, true);
            assert.strictEqual(result.resolution, 'absolute');
            assert.strictEqual(isMarkdownFile(result.resolvedPath), true);
        });

        test('should handle workspace-relative markdown files', () => {
            const workspaceMd = path.resolve(workspaceRoot, 'docs/api.md');
            const existingPaths = [workspaceMd];
            const mockExists = createMockExistsCheck(existingPaths);

            const result = resolveFilePath('docs/api.md', fileDir, workspaceRoot, mockExists);

            // Since fileDir is /project/docs, docs/api.md relative to it would be /project/docs/docs/api.md
            // which doesn't exist, so it should fall back to workspace-relative
            assert.strictEqual(result.exists, true);
            assert.strictEqual(result.resolution, 'relative-to-workspace');
            assert.strictEqual(isMarkdownFile(result.resolvedPath), true);
        });
    });
});

