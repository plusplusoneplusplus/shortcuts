/**
 * File Utilities Tests
 * 
 * Comprehensive tests for the file-utils module.
 * Tests are designed to work cross-platform (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    ensureDirectoryExists,
    getFileErrorMessage,
    readYAML,
    safeCopyFile,
    safeExists,
    safeIsDirectory,
    safeIsFile,
    safeReadDir,
    safeReadFile,
    safeRemove,
    safeRename,
    safeStats,
    safeWriteFile,
    writeYAML
} from '../../shortcuts/shared';

suite('File Utilities Tests', function() {
    // Increase timeout for file operations
    this.timeout(10000);

    let tempDir: string;

    suiteSetup(() => {
        // Create a unique temp directory for tests
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-utils-test-'));
    });

    suiteTeardown(() => {
        // Clean up temp directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    teardown(() => {
        // Clean up any files created during individual tests
        const testSubDir = path.join(tempDir, 'test-subdir');
        if (fs.existsSync(testSubDir)) {
            fs.rmSync(testSubDir, { recursive: true, force: true });
        }
    });

    suite('safeExists', () => {
        test('should return true for existing file', () => {
            const filePath = path.join(tempDir, 'exists-test.txt');
            fs.writeFileSync(filePath, 'test content');
            
            assert.strictEqual(safeExists(filePath), true);
            
            fs.unlinkSync(filePath);
        });

        test('should return true for existing directory', () => {
            const dirPath = path.join(tempDir, 'exists-dir-test');
            fs.mkdirSync(dirPath);
            
            assert.strictEqual(safeExists(dirPath), true);
            
            fs.rmdirSync(dirPath);
        });

        test('should return false for non-existing path', () => {
            const nonExistentPath = path.join(tempDir, 'non-existent-file.txt');
            
            assert.strictEqual(safeExists(nonExistentPath), false);
        });

        test('should return false for invalid path', () => {
            // Use a path that's definitely invalid on all platforms
            const invalidPath = '\0invalid';
            
            assert.strictEqual(safeExists(invalidPath), false);
        });
    });

    suite('safeIsDirectory', () => {
        test('should return true for directory', () => {
            const dirPath = path.join(tempDir, 'is-dir-test');
            fs.mkdirSync(dirPath);
            
            assert.strictEqual(safeIsDirectory(dirPath), true);
            
            fs.rmdirSync(dirPath);
        });

        test('should return false for file', () => {
            const filePath = path.join(tempDir, 'is-dir-file-test.txt');
            fs.writeFileSync(filePath, 'test');
            
            assert.strictEqual(safeIsDirectory(filePath), false);
            
            fs.unlinkSync(filePath);
        });

        test('should return false for non-existing path', () => {
            assert.strictEqual(safeIsDirectory(path.join(tempDir, 'non-existent')), false);
        });
    });

    suite('safeIsFile', () => {
        test('should return true for file', () => {
            const filePath = path.join(tempDir, 'is-file-test.txt');
            fs.writeFileSync(filePath, 'test');
            
            assert.strictEqual(safeIsFile(filePath), true);
            
            fs.unlinkSync(filePath);
        });

        test('should return false for directory', () => {
            const dirPath = path.join(tempDir, 'is-file-dir-test');
            fs.mkdirSync(dirPath);
            
            assert.strictEqual(safeIsFile(dirPath), false);
            
            fs.rmdirSync(dirPath);
        });

        test('should return false for non-existing path', () => {
            assert.strictEqual(safeIsFile(path.join(tempDir, 'non-existent')), false);
        });
    });

    suite('safeReadFile', () => {
        test('should read file contents successfully', () => {
            const filePath = path.join(tempDir, 'read-test.txt');
            const content = 'Hello, World!';
            fs.writeFileSync(filePath, content);
            
            const result = safeReadFile(filePath);
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.data, content);
            assert.strictEqual(result.error, undefined);
            
            fs.unlinkSync(filePath);
        });

        test('should read file with custom encoding', () => {
            const filePath = path.join(tempDir, 'read-encoding-test.txt');
            const content = 'Test content';
            fs.writeFileSync(filePath, content, 'utf8');
            
            const result = safeReadFile(filePath, { encoding: 'utf8' });
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.data, content);
            
            fs.unlinkSync(filePath);
        });

        test('should return error for non-existing file', () => {
            const result = safeReadFile(path.join(tempDir, 'non-existent.txt'));
            
            assert.strictEqual(result.success, false);
            assert.ok(result.error);
            assert.strictEqual(result.errorCode, 'ENOENT');
        });

        test('should handle empty file', () => {
            const filePath = path.join(tempDir, 'empty-test.txt');
            fs.writeFileSync(filePath, '');
            
            const result = safeReadFile(filePath);
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.data, '');
            
            fs.unlinkSync(filePath);
        });

        test('should handle unicode content', () => {
            const filePath = path.join(tempDir, 'unicode-test.txt');
            const content = '你好世界 🌍 مرحبا';
            fs.writeFileSync(filePath, content, 'utf8');
            
            const result = safeReadFile(filePath);
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.data, content);
            
            fs.unlinkSync(filePath);
        });
    });

    suite('safeWriteFile', () => {
        test('should write file contents successfully', () => {
            const filePath = path.join(tempDir, 'write-test.txt');
            const content = 'Test content';
            
            const result = safeWriteFile(filePath, content);
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(fs.readFileSync(filePath, 'utf8'), content);
            
            fs.unlinkSync(filePath);
        });

        test('should create parent directories by default', () => {
            const filePath = path.join(tempDir, 'nested', 'dir', 'write-test.txt');
            const content = 'Nested content';
            
            const result = safeWriteFile(filePath, content);
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(fs.readFileSync(filePath, 'utf8'), content);
            
            fs.rmSync(path.join(tempDir, 'nested'), { recursive: true });
        });

        test('should fail when createDirs is false and parent does not exist', () => {
            const filePath = path.join(tempDir, 'non-existent-parent', 'file.txt');
            
            const result = safeWriteFile(filePath, 'content', { createDirs: false });
            
            assert.strictEqual(result.success, false);
            assert.ok(result.error);
        });

        test('should overwrite existing file', () => {
            const filePath = path.join(tempDir, 'overwrite-test.txt');
            fs.writeFileSync(filePath, 'original');
            
            const result = safeWriteFile(filePath, 'new content');
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(fs.readFileSync(filePath, 'utf8'), 'new content');
            
            fs.unlinkSync(filePath);
        });

        test('should handle unicode content', () => {
            const filePath = path.join(tempDir, 'unicode-write-test.txt');
            const content = '日本語テスト 🎉';
            
            const result = safeWriteFile(filePath, content);
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(fs.readFileSync(filePath, 'utf8'), content);
            
            fs.unlinkSync(filePath);
        });
    });

    suite('ensureDirectoryExists', () => {
        test('should create directory if it does not exist', () => {
            const dirPath = path.join(tempDir, 'ensure-dir-test');
            
            const result = ensureDirectoryExists(dirPath);
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(fs.existsSync(dirPath), true);
            
            fs.rmdirSync(dirPath);
        });

        test('should create nested directories', () => {
            const dirPath = path.join(tempDir, 'ensure', 'nested', 'dir');
            
            const result = ensureDirectoryExists(dirPath);
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(fs.existsSync(dirPath), true);
            
            fs.rmSync(path.join(tempDir, 'ensure'), { recursive: true });
        });

        test('should succeed if directory already exists', () => {
            const dirPath = path.join(tempDir, 'existing-dir-test');
            fs.mkdirSync(dirPath);
            
            const result = ensureDirectoryExists(dirPath);
            
            assert.strictEqual(result.success, true);
            
            fs.rmdirSync(dirPath);
        });
    });

    suite('safeReadDir', () => {
        test('should read directory contents', () => {
            const dirPath = path.join(tempDir, 'readdir-test');
            fs.mkdirSync(dirPath);
            fs.writeFileSync(path.join(dirPath, 'file1.txt'), 'content1');
            fs.writeFileSync(path.join(dirPath, 'file2.txt'), 'content2');
            
            const result = safeReadDir(dirPath);
            
            assert.strictEqual(result.success, true);
            assert.ok(result.data);
            assert.strictEqual(result.data.length, 2);
            assert.ok(result.data.includes('file1.txt'));
            assert.ok(result.data.includes('file2.txt'));
            
            fs.rmSync(dirPath, { recursive: true });
        });

        test('should read directory with file types', () => {
            const dirPath = path.join(tempDir, 'readdir-types-test');
            fs.mkdirSync(dirPath);
            fs.writeFileSync(path.join(dirPath, 'file.txt'), 'content');
            fs.mkdirSync(path.join(dirPath, 'subdir'));
            
            const result = safeReadDir(dirPath, true);
            
            assert.strictEqual(result.success, true);
            assert.ok(result.data);
            assert.strictEqual(result.data.length, 2);
            
            const fileEntry = result.data.find(e => e.name === 'file.txt');
            const dirEntry = result.data.find(e => e.name === 'subdir');
            
            assert.ok(fileEntry?.isFile());
            assert.ok(dirEntry?.isDirectory());
            
            fs.rmSync(dirPath, { recursive: true });
        });

        test('should return error for non-existing directory', () => {
            const result = safeReadDir(path.join(tempDir, 'non-existent-dir'));
            
            assert.strictEqual(result.success, false);
            assert.ok(result.error);
            assert.strictEqual(result.errorCode, 'ENOENT');
        });

        test('should handle empty directory', () => {
            const dirPath = path.join(tempDir, 'empty-dir-test');
            fs.mkdirSync(dirPath);
            
            const result = safeReadDir(dirPath);
            
            assert.strictEqual(result.success, true);
            assert.ok(result.data);
            assert.strictEqual(result.data.length, 0);
            
            fs.rmdirSync(dirPath);
        });
    });

    suite('safeStats', () => {
        test('should return stats for file', () => {
            const filePath = path.join(tempDir, 'stats-test.txt');
            fs.writeFileSync(filePath, 'test content');
            
            const result = safeStats(filePath);
            
            assert.strictEqual(result.success, true);
            assert.ok(result.data);
            assert.ok(result.data.isFile());
            assert.ok(result.data.size > 0);
            
            fs.unlinkSync(filePath);
        });

        test('should return stats for directory', () => {
            const dirPath = path.join(tempDir, 'stats-dir-test');
            fs.mkdirSync(dirPath);
            
            const result = safeStats(dirPath);
            
            assert.strictEqual(result.success, true);
            assert.ok(result.data);
            assert.ok(result.data.isDirectory());
            
            fs.rmdirSync(dirPath);
        });

        test('should return error for non-existing path', () => {
            const result = safeStats(path.join(tempDir, 'non-existent'));
            
            assert.strictEqual(result.success, false);
            assert.ok(result.error);
            assert.strictEqual(result.errorCode, 'ENOENT');
        });
    });

    suite('readYAML', () => {
        test('should read and parse YAML file', () => {
            const filePath = path.join(tempDir, 'test.yaml');
            const yamlContent = `name: test\nversion: 1\nitems:\n  - one\n  - two`;
            fs.writeFileSync(filePath, yamlContent);
            
            interface TestConfig {
                name: string;
                version: number;
                items: string[];
            }
            
            const result = readYAML<TestConfig>(filePath);
            
            assert.strictEqual(result.success, true);
            assert.ok(result.data);
            assert.strictEqual(result.data.name, 'test');
            assert.strictEqual(result.data.version, 1);
            assert.deepStrictEqual(result.data.items, ['one', 'two']);
            
            fs.unlinkSync(filePath);
        });

        test('should return error for invalid YAML', () => {
            const filePath = path.join(tempDir, 'invalid.yaml');
            fs.writeFileSync(filePath, 'invalid: yaml: content: ::');
            
            const result = readYAML(filePath);
            
            assert.strictEqual(result.success, false);
            assert.ok(result.error);
            assert.strictEqual(result.errorCode, 'YAML_PARSE_ERROR');
            
            fs.unlinkSync(filePath);
        });

        test('should return error for non-existing file', () => {
            const result = readYAML(path.join(tempDir, 'non-existent.yaml'));
            
            assert.strictEqual(result.success, false);
            assert.ok(result.error);
            assert.strictEqual(result.errorCode, 'ENOENT');
        });

        test('should handle empty YAML file', () => {
            const filePath = path.join(tempDir, 'empty.yaml');
            fs.writeFileSync(filePath, '');
            
            const result = readYAML(filePath);
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.data, undefined);
            
            fs.unlinkSync(filePath);
        });

        test('should handle complex nested YAML', () => {
            const filePath = path.join(tempDir, 'complex.yaml');
            const yamlContent = `
database:
  host: localhost
  port: 5432
  credentials:
    username: admin
    password: secret
features:
  - name: feature1
    enabled: true
  - name: feature2
    enabled: false
`;
            fs.writeFileSync(filePath, yamlContent);
            
            interface ComplexConfig {
                database: {
                    host: string;
                    port: number;
                    credentials: {
                        username: string;
                        password: string;
                    };
                };
                features: Array<{ name: string; enabled: boolean }>;
            }
            
            const result = readYAML<ComplexConfig>(filePath);
            
            assert.strictEqual(result.success, true);
            assert.ok(result.data);
            assert.strictEqual(result.data.database.host, 'localhost');
            assert.strictEqual(result.data.database.port, 5432);
            assert.strictEqual(result.data.database.credentials.username, 'admin');
            assert.strictEqual(result.data.features.length, 2);
            
            fs.unlinkSync(filePath);
        });
    });

    suite('writeYAML', () => {
        test('should write data as YAML', () => {
            const filePath = path.join(tempDir, 'write-yaml-test.yaml');
            const data = { name: 'test', version: 1 };
            
            const result = writeYAML(filePath, data);
            
            assert.strictEqual(result.success, true);
            
            const content = fs.readFileSync(filePath, 'utf8');
            assert.ok(content.includes('name: test'));
            assert.ok(content.includes('version: 1'));
            
            fs.unlinkSync(filePath);
        });

        test('should create parent directories', () => {
            const filePath = path.join(tempDir, 'yaml-nested', 'dir', 'config.yaml');
            const data = { key: 'value' };
            
            const result = writeYAML(filePath, data);
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(fs.existsSync(filePath), true);
            
            fs.rmSync(path.join(tempDir, 'yaml-nested'), { recursive: true });
        });

        test('should handle arrays', () => {
            const filePath = path.join(tempDir, 'array-yaml-test.yaml');
            const data = { items: ['one', 'two', 'three'] };
            
            const result = writeYAML(filePath, data);
            
            assert.strictEqual(result.success, true);
            
            const content = fs.readFileSync(filePath, 'utf8');
            assert.ok(content.includes('- one'));
            assert.ok(content.includes('- two'));
            assert.ok(content.includes('- three'));
            
            fs.unlinkSync(filePath);
        });

        test('should use custom options', () => {
            const filePath = path.join(tempDir, 'options-yaml-test.yaml');
            const data = { name: 'test' };
            
            const result = writeYAML(filePath, data, { indent: 4 });
            
            assert.strictEqual(result.success, true);
            
            fs.unlinkSync(filePath);
        });
    });

    suite('safeCopyFile', () => {
        test('should copy file successfully', () => {
            const srcPath = path.join(tempDir, 'copy-src.txt');
            const destPath = path.join(tempDir, 'copy-dest.txt');
            fs.writeFileSync(srcPath, 'copy content');
            
            const result = safeCopyFile(srcPath, destPath);
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(fs.readFileSync(destPath, 'utf8'), 'copy content');
            
            fs.unlinkSync(srcPath);
            fs.unlinkSync(destPath);
        });

        test('should create parent directories by default', () => {
            const srcPath = path.join(tempDir, 'copy-src2.txt');
            const destPath = path.join(tempDir, 'copy-nested', 'dir', 'dest.txt');
            fs.writeFileSync(srcPath, 'nested copy');
            
            const result = safeCopyFile(srcPath, destPath);
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(fs.readFileSync(destPath, 'utf8'), 'nested copy');
            
            fs.unlinkSync(srcPath);
            fs.rmSync(path.join(tempDir, 'copy-nested'), { recursive: true });
        });

        test('should return error for non-existing source', () => {
            const result = safeCopyFile(
                path.join(tempDir, 'non-existent.txt'),
                path.join(tempDir, 'dest.txt')
            );
            
            assert.strictEqual(result.success, false);
            assert.ok(result.error);
            assert.strictEqual(result.errorCode, 'ENOENT');
        });
    });

    suite('safeRename', () => {
        test('should rename file successfully', () => {
            const oldPath = path.join(tempDir, 'rename-old.txt');
            const newPath = path.join(tempDir, 'rename-new.txt');
            fs.writeFileSync(oldPath, 'rename content');
            
            const result = safeRename(oldPath, newPath);
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(fs.existsSync(oldPath), false);
            assert.strictEqual(fs.existsSync(newPath), true);
            assert.strictEqual(fs.readFileSync(newPath, 'utf8'), 'rename content');
            
            fs.unlinkSync(newPath);
        });

        test('should rename directory successfully', () => {
            const oldPath = path.join(tempDir, 'rename-dir-old');
            const newPath = path.join(tempDir, 'rename-dir-new');
            fs.mkdirSync(oldPath);
            fs.writeFileSync(path.join(oldPath, 'file.txt'), 'content');
            
            const result = safeRename(oldPath, newPath);
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(fs.existsSync(oldPath), false);
            assert.strictEqual(fs.existsSync(newPath), true);
            assert.strictEqual(fs.existsSync(path.join(newPath, 'file.txt')), true);
            
            fs.rmSync(newPath, { recursive: true });
        });

        test('should return error for non-existing source', () => {
            const result = safeRename(
                path.join(tempDir, 'non-existent'),
                path.join(tempDir, 'new-name')
            );
            
            assert.strictEqual(result.success, false);
            assert.ok(result.error);
            assert.strictEqual(result.errorCode, 'ENOENT');
        });
    });

    suite('safeRemove', () => {
        test('should remove file successfully', () => {
            const filePath = path.join(tempDir, 'remove-test.txt');
            fs.writeFileSync(filePath, 'remove me');
            
            const result = safeRemove(filePath);
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(fs.existsSync(filePath), false);
        });

        test('should remove directory recursively', () => {
            const dirPath = path.join(tempDir, 'remove-dir-test');
            fs.mkdirSync(dirPath);
            fs.writeFileSync(path.join(dirPath, 'file.txt'), 'content');
            fs.mkdirSync(path.join(dirPath, 'subdir'));
            fs.writeFileSync(path.join(dirPath, 'subdir', 'nested.txt'), 'nested');
            
            const result = safeRemove(dirPath, { recursive: true });
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(fs.existsSync(dirPath), false);
        });

        test('should handle non-existing path with force option', () => {
            const result = safeRemove(
                path.join(tempDir, 'non-existent'),
                { force: true }
            );
            
            assert.strictEqual(result.success, true);
        });

        test('should fail for non-empty directory without recursive', () => {
            const dirPath = path.join(tempDir, 'non-empty-dir');
            fs.mkdirSync(dirPath);
            fs.writeFileSync(path.join(dirPath, 'file.txt'), 'content');
            
            const result = safeRemove(dirPath, { recursive: false });
            
            assert.strictEqual(result.success, false);
            assert.ok(result.error);
            
            // Clean up
            fs.rmSync(dirPath, { recursive: true });
        });
    });

    suite('getFileErrorMessage', () => {
        test('should return appropriate message for ENOENT', () => {
            const message = getFileErrorMessage('ENOENT');
            assert.ok(message.includes('not found'));
        });

        test('should return appropriate message for EACCES', () => {
            const message = getFileErrorMessage('EACCES');
            assert.ok(message.includes('Permission denied'));
        });

        test('should return appropriate message for EPERM', () => {
            const message = getFileErrorMessage('EPERM');
            assert.ok(message.includes('Permission denied'));
        });

        test('should return appropriate message for EEXIST', () => {
            const message = getFileErrorMessage('EEXIST');
            assert.ok(message.includes('already exists'));
        });

        test('should return appropriate message for ENOSPC', () => {
            const message = getFileErrorMessage('ENOSPC');
            assert.ok(message.includes('No space'));
        });

        test('should return appropriate message for YAML_PARSE_ERROR', () => {
            const message = getFileErrorMessage('YAML_PARSE_ERROR');
            assert.ok(message.includes('YAML'));
        });

        test('should include context when provided', () => {
            const message = getFileErrorMessage('ENOENT', 'Reading config');
            assert.ok(message.startsWith('Reading config:'));
        });

        test('should return generic message for unknown error code', () => {
            const message = getFileErrorMessage('UNKNOWN_CODE');
            assert.ok(message.includes('File operation failed'));
        });
    });

    suite('Cross-platform path handling', () => {
        test('should handle paths with spaces', () => {
            const dirPath = path.join(tempDir, 'path with spaces');
            const filePath = path.join(dirPath, 'file name.txt');
            
            ensureDirectoryExists(dirPath);
            const writeResult = safeWriteFile(filePath, 'content');
            
            assert.strictEqual(writeResult.success, true);
            
            const readResult = safeReadFile(filePath);
            assert.strictEqual(readResult.success, true);
            assert.strictEqual(readResult.data, 'content');
            
            fs.rmSync(dirPath, { recursive: true });
        });

        test('should handle deeply nested paths', () => {
            const deepPath = path.join(tempDir, 'a', 'b', 'c', 'd', 'e', 'f', 'g');
            const filePath = path.join(deepPath, 'deep.txt');
            
            const result = safeWriteFile(filePath, 'deep content');
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(fs.existsSync(filePath), true);
            
            fs.rmSync(path.join(tempDir, 'a'), { recursive: true });
        });

        test('should handle special characters in filenames', () => {
            // Use characters that are valid on all platforms
            const filePath = path.join(tempDir, 'special_chars-test.txt');
            
            const writeResult = safeWriteFile(filePath, 'special content');
            assert.strictEqual(writeResult.success, true);
            
            const readResult = safeReadFile(filePath);
            assert.strictEqual(readResult.success, true);
            
            fs.unlinkSync(filePath);
        });
    });
});
