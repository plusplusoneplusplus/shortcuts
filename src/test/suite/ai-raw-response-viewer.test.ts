/**
 * Tests for AI raw response viewer with markdown review editor
 * Verifies that AI process raw responses are opened with the markdown review editor
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AIProcess, serializeProcess, deserializeProcess } from '../../shortcuts/ai-service';

suite('AI Raw Response Viewer Tests', () => {
    let tempDir: string;

    setup(() => {
        // Create temp directory for test files
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-raw-response-test-'));
    });

    teardown(() => {
        // Clean up temp directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('AIProcess result file path handling', () => {
        test('should serialize and deserialize resultFilePath correctly', () => {
            const testPath = path.join(tempDir, 'test-result.md');
            
            const process: AIProcess = {
                id: 'test-1',
                type: 'code-review',
                promptPreview: 'Review code changes',
                fullPrompt: 'Full prompt for code review',
                status: 'completed',
                startTime: new Date('2024-01-15T10:30:00.000Z'),
                endTime: new Date('2024-01-15T10:35:00.000Z'),
                result: '# Code Review Results\n\nAll checks passed.',
                resultFilePath: testPath
            };

            const serialized = serializeProcess(process);
            const restored = deserializeProcess(serialized);

            assert.strictEqual(restored.resultFilePath, testPath, 'resultFilePath should be preserved');
        });

        test('should handle Windows-style paths in resultFilePath', () => {
            // Test with Windows-style path
            const windowsPath = 'C:\\Users\\test\\.vscode\\ai-results\\test.md';
            
            const process: AIProcess = {
                id: 'test-windows',
                type: 'clarification',
                promptPreview: 'Test prompt',
                fullPrompt: 'Full test prompt',
                status: 'completed',
                startTime: new Date(),
                resultFilePath: windowsPath
            };

            const serialized = serializeProcess(process);
            const restored = deserializeProcess(serialized);

            assert.strictEqual(restored.resultFilePath, windowsPath, 'Windows path should be preserved');
        });

        test('should handle Unix-style paths in resultFilePath', () => {
            // Test with Unix-style path
            const unixPath = '/home/user/.vscode/ai-results/test.md';
            
            const process: AIProcess = {
                id: 'test-unix',
                type: 'clarification',
                promptPreview: 'Test prompt',
                fullPrompt: 'Full test prompt',
                status: 'completed',
                startTime: new Date(),
                resultFilePath: unixPath
            };

            const serialized = serializeProcess(process);
            const restored = deserializeProcess(serialized);

            assert.strictEqual(restored.resultFilePath, unixPath, 'Unix path should be preserved');
        });

        test('should handle undefined resultFilePath', () => {
            const process: AIProcess = {
                id: 'test-undefined',
                type: 'clarification',
                promptPreview: 'Test prompt',
                fullPrompt: 'Full test prompt',
                status: 'completed',
                startTime: new Date()
            };

            const serialized = serializeProcess(process);
            const restored = deserializeProcess(serialized);

            assert.strictEqual(restored.resultFilePath, undefined, 'undefined resultFilePath should be preserved');
        });
    });

    suite('View Raw Response command registration', () => {
        test('should have viewRawResponse command registered', async () => {
            const commands = await vscode.commands.getCommands(true);
            
            assert.ok(
                commands.includes('clarificationProcesses.viewRawResponse'),
                'clarificationProcesses.viewRawResponse command should be registered'
            );
        });
    });

    suite('Markdown file path handling for cross-platform', () => {
        test('should create valid file URI from path', () => {
            const testPath = path.join(tempDir, 'test-file.md');
            
            // Write a test file
            fs.writeFileSync(testPath, '# Test File\n\nContent here.');
            
            const uri = vscode.Uri.file(testPath);
            
            // URI should be valid and point to a file
            assert.ok(uri.scheme === 'file', 'URI scheme should be "file"');
            assert.ok(uri.fsPath.includes('test-file.md'), 'URI fsPath should contain the filename');
        });

        test('should handle paths with spaces', () => {
            const dirWithSpaces = path.join(tempDir, 'path with spaces');
            fs.mkdirSync(dirWithSpaces, { recursive: true });
            
            const testPath = path.join(dirWithSpaces, 'test file.md');
            fs.writeFileSync(testPath, '# Test\n\nContent');
            
            const uri = vscode.Uri.file(testPath);
            
            assert.ok(fs.existsSync(uri.fsPath), 'File should exist at URI fsPath');
        });

        test('should handle Unicode characters in paths', () => {
            const dirWithUnicode = path.join(tempDir, 'path_测试_тест');
            fs.mkdirSync(dirWithUnicode, { recursive: true });
            
            const testPath = path.join(dirWithUnicode, 'file_文件.md');
            fs.writeFileSync(testPath, '# Unicode Test\n\nContent');
            
            const uri = vscode.Uri.file(testPath);
            
            assert.ok(fs.existsSync(uri.fsPath), 'File with Unicode path should exist');
        });
    });
});
