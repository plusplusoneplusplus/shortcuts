/**
 * Tests for the shared ReadOnlyDocumentProvider and content strategies.
 *
 * Cross-platform compatible (Linux/macOS/Windows).
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    ContentStrategy,
    createSchemeUri,
    DynamicContentStrategy,
    FileContentStrategy,
    GitContentStrategy,
    MemoryContentStrategy,
    ReadOnlyDocumentProvider,
    registerSchemes,
} from '../../shortcuts/shared';

suite('ReadOnlyDocumentProvider', () => {
    let provider: ReadOnlyDocumentProvider;

    setup(() => {
        provider = new ReadOnlyDocumentProvider();
    });

    teardown(() => {
        provider.dispose();
    });

    suite('Basic Operations', () => {
        test('should register and retrieve a scheme', () => {
            const strategy = new MemoryContentStrategy();
            provider.registerScheme('test-scheme', strategy);

            assert.strictEqual(provider.hasScheme('test-scheme'), true);
            assert.strictEqual(provider.hasScheme('unknown-scheme'), false);
        });

        test('should return stored strategy', () => {
            const strategy = new MemoryContentStrategy();
            provider.registerScheme('test-scheme', strategy);

            const retrieved =
                provider.getStrategy<MemoryContentStrategy>('test-scheme');
            assert.strictEqual(retrieved, strategy);
        });

        test('should return undefined for unknown scheme', () => {
            const retrieved = provider.getStrategy('unknown-scheme');
            assert.strictEqual(retrieved, undefined);
        });

        test('should unregister a scheme', () => {
            const strategy = new MemoryContentStrategy();
            provider.registerScheme('test-scheme', strategy);

            assert.strictEqual(provider.hasScheme('test-scheme'), true);
            provider.unregisterScheme('test-scheme');
            assert.strictEqual(provider.hasScheme('test-scheme'), false);
        });

        test('should provide error message for unregistered scheme', async () => {
            const uri = vscode.Uri.parse('unknown-scheme:test.txt');
            const content = await provider.provideTextDocumentContent(uri);

            assert.ok(content.includes('No content provider registered'));
            assert.ok(content.includes('unknown-scheme'));
        });

        test('should handle refresh events', async () => {
            const strategy = new MemoryContentStrategy();
            provider.registerScheme('test-scheme', strategy);

            const uri = vscode.Uri.parse('test-scheme:document.md');
            let eventFired = false;

            const disposable = provider.onDidChange((changedUri) => {
                if (changedUri.toString() === uri.toString()) {
                    eventFired = true;
                }
            });

            provider.refresh(uri);

            // Allow event loop to process
            await new Promise((resolve) => setTimeout(resolve, 10));

            assert.strictEqual(eventFired, true);
            disposable.dispose();
        });
    });
});

suite('FileContentStrategy', () => {
    let tempDir: string;
    let testFilePath: string;

    setup(() => {
        // Create temp directory for test files
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-test-'));
        testFilePath = path.join(tempDir, 'test-file.txt');
        fs.writeFileSync(testFilePath, 'Test file content\nLine 2\nLine 3');
    });

    teardown(() => {
        // Clean up temp directory
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    test('should read file content', () => {
        const strategy = new FileContentStrategy();
        const uri = vscode.Uri.parse(`file-strategy:${testFilePath}`);

        const content = strategy.getContent(uri);

        assert.strictEqual(content, 'Test file content\nLine 2\nLine 3');
    });

    test('should read file with base path', () => {
        const filename = 'test-file.txt';
        const strategy = new FileContentStrategy({ basePath: tempDir });
        const uri = vscode.Uri.parse(`file-strategy:/${filename}`);

        const content = strategy.getContent(uri);

        assert.strictEqual(content, 'Test file content\nLine 2\nLine 3');
    });

    test('should handle non-existent file', () => {
        const strategy = new FileContentStrategy({
            errorMessagePrefix: 'Custom error',
        });
        const uri = vscode.Uri.parse('file-strategy:/non-existent-file.txt');

        const content = strategy.getContent(uri);

        assert.ok(content.includes('Custom error'));
    });

    test('should use custom encoding', () => {
        const utf16File = path.join(tempDir, 'utf16.txt');
        const content = 'UTF-16 content';
        // Write as UTF-8 for simplicity - just testing the option is passed
        fs.writeFileSync(utf16File, content, { encoding: 'utf-8' });

        const strategy = new FileContentStrategy({ encoding: 'utf-8' });
        const uri = vscode.Uri.parse(`file-strategy:${utf16File}`);

        const result = strategy.getContent(uri);
        assert.strictEqual(result, content);
    });
});

suite('MemoryContentStrategy', () => {
    let strategy: MemoryContentStrategy;

    setup(() => {
        strategy = new MemoryContentStrategy();
    });

    teardown(() => {
        strategy.dispose();
    });

    test('should store and retrieve content', () => {
        const uri = vscode.Uri.parse('memory:test-doc.md');
        strategy.store(uri, 'Stored content');

        const content = strategy.getContent(uri);
        assert.strictEqual(content, 'Stored content');
    });

    test('should return default content for unknown URI', () => {
        const strategy = new MemoryContentStrategy({
            defaultContent: 'Default text',
        });
        const uri = vscode.Uri.parse('memory:unknown.md');

        const content = strategy.getContent(uri);
        assert.strictEqual(content, 'Default text');
    });

    test('should check if content exists', () => {
        const uri = vscode.Uri.parse('memory:doc.md');

        assert.strictEqual(strategy.has(uri), false);

        strategy.store(uri, 'content');

        assert.strictEqual(strategy.has(uri), true);
    });

    test('should delete content', () => {
        const uri = vscode.Uri.parse('memory:doc.md');
        strategy.store(uri, 'content');

        assert.strictEqual(strategy.has(uri), true);
        assert.strictEqual(strategy.delete(uri), true);
        assert.strictEqual(strategy.has(uri), false);
    });

    test('should return false when deleting non-existent content', () => {
        const uri = vscode.Uri.parse('memory:non-existent.md');
        assert.strictEqual(strategy.delete(uri), false);
    });

    test('should clear all content', () => {
        const uri1 = vscode.Uri.parse('memory:doc1.md');
        const uri2 = vscode.Uri.parse('memory:doc2.md');

        strategy.store(uri1, 'content1');
        strategy.store(uri2, 'content2');

        assert.strictEqual(strategy.has(uri1), true);
        assert.strictEqual(strategy.has(uri2), true);

        strategy.clear();

        assert.strictEqual(strategy.has(uri1), false);
        assert.strictEqual(strategy.has(uri2), false);
    });

    test('should fire change event when storing content', async () => {
        const uri = vscode.Uri.parse('memory:doc.md');
        let eventFired = false;
        let eventUri: vscode.Uri | undefined;

        const disposable = strategy.onDidChange!((changedUri) => {
            eventFired = true;
            eventUri = changedUri;
        });

        strategy.store(uri, 'content');

        // Allow event loop to process
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.strictEqual(eventFired, true);
        assert.strictEqual(eventUri?.toString(), uri.toString());

        disposable.dispose();
    });
});

suite('DynamicContentStrategy', () => {
    test('should call getContent function', () => {
        let callCount = 0;
        const strategy = new DynamicContentStrategy({
            getContent: (uri) => {
                callCount++;
                return `Content for ${uri.path}`;
            },
        });

        const uri = vscode.Uri.parse('dynamic:test.md');
        const content = strategy.getContent(uri);

        assert.strictEqual(callCount, 1);
        assert.strictEqual(content, 'Content for test.md');
    });

    test('should pass context to getContent function', () => {
        interface TestContext {
            prefix: string;
        }

        const strategy = new DynamicContentStrategy<TestContext>({
            getContent: (uri, ctx) => {
                return `${ctx?.prefix}: ${uri.path}`;
            },
            context: { prefix: 'Prefixed' },
        });

        const uri = vscode.Uri.parse('dynamic:test.md');
        const content = strategy.getContent(uri);

        assert.strictEqual(content, 'Prefixed: test.md');
    });

    test('should support async getContent', async () => {
        const strategy = new DynamicContentStrategy({
            getContent: async (uri) => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                return `Async content for ${uri.path}`;
            },
        });

        const uri = vscode.Uri.parse('dynamic:test.md');
        const content = await strategy.getContent(uri);

        assert.strictEqual(content, 'Async content for test.md');
    });

    test('should expose onChange event', async () => {
        const emitter = new vscode.EventEmitter<vscode.Uri>();

        const strategy = new DynamicContentStrategy({
            getContent: () => 'content',
            onChange: emitter.event,
        });

        assert.strictEqual(strategy.onDidChange, emitter.event);

        emitter.dispose();
    });
});

suite('GitContentStrategy', () => {
    // These tests are more limited since they require a git repository.
    // We test the parameter parsing and empty tree hash handling.

    test('should handle missing commit parameter', async () => {
        const strategy = new GitContentStrategy();
        const uri = vscode.Uri.parse('git:test.txt?repo=/path/to/repo');

        const content = await strategy.getContent(uri);

        assert.strictEqual(content, '');
    });

    test('should handle missing repo parameter', async () => {
        const strategy = new GitContentStrategy();
        const uri = vscode.Uri.parse('git:test.txt?commit=abc123');

        const content = await strategy.getContent(uri);

        assert.strictEqual(content, '');
    });

    test('should handle empty tree hash', async () => {
        const strategy = new GitContentStrategy();
        // The empty tree hash represents no content
        const emptyTreeHash = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
        const uri = vscode.Uri.parse(
            `git:test.txt?commit=${emptyTreeHash}&repo=/path/to/repo`
        );

        const content = await strategy.getContent(uri);

        assert.strictEqual(content, '');
    });

    test('should use custom parameter names', async () => {
        const strategy = new GitContentStrategy({
            commitParam: 'sha',
            repoParam: 'repository',
        });

        // Without proper params, should return empty
        const uri = vscode.Uri.parse(
            'git:test.txt?commit=abc&repo=/path/to/repo'
        );
        const content = await strategy.getContent(uri);

        assert.strictEqual(content, '');
    });

    test('should use file from query param when configured', async () => {
        const strategy = new GitContentStrategy({
            fileParam: 'file',
        });

        // Without file param, should return empty
        const uri = vscode.Uri.parse(
            'git:/path?commit=abc&repo=/path/to/repo'
        );
        const content = await strategy.getContent(uri);

        assert.strictEqual(content, '');
    });
});

suite('createSchemeUri', () => {
    test('should create URI with scheme and path', () => {
        const uri = createSchemeUri('test-scheme', '/path/to/file.md');

        assert.strictEqual(uri.scheme, 'test-scheme');
        assert.strictEqual(uri.path, '/path/to/file.md');
        assert.strictEqual(uri.query, '');
    });

    test('should create URI with query parameters', () => {
        const uri = createSchemeUri('test-scheme', '/file.txt', {
            param1: 'value1',
            param2: 'value2',
        });

        assert.strictEqual(uri.scheme, 'test-scheme');
        assert.strictEqual(uri.path, '/file.txt');

        const params = new URLSearchParams(uri.query);
        assert.strictEqual(params.get('param1'), 'value1');
        assert.strictEqual(params.get('param2'), 'value2');
    });

    test('should handle empty query object', () => {
        const uri = createSchemeUri('test-scheme', '/file.txt', {});

        assert.strictEqual(uri.query, '');
    });

    test('should handle special characters in query values', () => {
        const uri = createSchemeUri('test-scheme', '/file.txt', {
            path: '/path/with spaces/file.txt',
            special: 'value&with=chars',
        });

        const params = new URLSearchParams(uri.query);
        assert.strictEqual(params.get('path'), '/path/with spaces/file.txt');
        assert.strictEqual(params.get('special'), 'value&with=chars');
    });
});

suite('Integration: ReadOnlyDocumentProvider with strategies', () => {
    let provider: ReadOnlyDocumentProvider;
    let tempDir: string;

    setup(() => {
        provider = new ReadOnlyDocumentProvider();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-test-'));
    });

    teardown(() => {
        provider.dispose();
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    test('should support multiple schemes with different strategies', async () => {
        // Register file strategy
        const testFile = path.join(tempDir, 'test.txt');
        fs.writeFileSync(testFile, 'File content');
        provider.registerScheme('file-scheme', new FileContentStrategy());

        // Register memory strategy
        const memoryStrategy = new MemoryContentStrategy();
        provider.registerScheme('memory-scheme', memoryStrategy);
        memoryStrategy.store(
            vscode.Uri.parse('memory-scheme:doc.md'),
            'Memory content'
        );

        // Register dynamic strategy
        provider.registerScheme(
            'dynamic-scheme',
            new DynamicContentStrategy({
                getContent: () => 'Dynamic content',
            })
        );

        // Test file strategy
        const fileUri = vscode.Uri.parse(`file-scheme:${testFile}`);
        const fileContent = await provider.provideTextDocumentContent(fileUri);
        assert.strictEqual(fileContent, 'File content');

        // Test memory strategy
        const memoryUri = vscode.Uri.parse('memory-scheme:doc.md');
        const memoryContent =
            await provider.provideTextDocumentContent(memoryUri);
        assert.strictEqual(memoryContent, 'Memory content');

        // Test dynamic strategy
        const dynamicUri = vscode.Uri.parse('dynamic-scheme:any.txt');
        const dynamicContent =
            await provider.provideTextDocumentContent(dynamicUri);
        assert.strictEqual(dynamicContent, 'Dynamic content');
    });

    test('should propagate change events from strategies', async () => {
        const memoryStrategy = new MemoryContentStrategy();
        provider.registerScheme('test-scheme', memoryStrategy);

        const uri = vscode.Uri.parse('test-scheme:doc.md');
        let eventFired = false;

        const disposable = provider.onDidChange((changedUri) => {
            if (changedUri.toString() === uri.toString()) {
                eventFired = true;
            }
        });

        // Store should trigger change event
        memoryStrategy.store(uri, 'new content');

        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.strictEqual(eventFired, true);
        disposable.dispose();
    });

    test('should dispose strategies when unregistering scheme', () => {
        let disposed = false;

        const customStrategy: ContentStrategy = {
            getContent: () => 'content',
            dispose: () => {
                disposed = true;
            },
        };

        provider.registerScheme('custom-scheme', customStrategy);
        provider.unregisterScheme('custom-scheme');

        assert.strictEqual(disposed, true);
    });

    test('should dispose all strategies when provider is disposed', () => {
        const disposedStrategies: string[] = [];

        const createStrategy = (name: string): ContentStrategy => ({
            getContent: () => 'content',
            dispose: () => {
                disposedStrategies.push(name);
            },
        });

        provider.registerScheme('scheme1', createStrategy('strategy1'));
        provider.registerScheme('scheme2', createStrategy('strategy2'));

        provider.dispose();

        assert.ok(disposedStrategies.includes('strategy1'));
        assert.ok(disposedStrategies.includes('strategy2'));
    });
});

suite('Cross-Platform Path Handling', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-test-'));
    });

    teardown(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    test('FileContentStrategy should handle paths with forward slashes', () => {
        const filePath = path.join(tempDir, 'subdir');
        fs.mkdirSync(filePath, { recursive: true });
        const testFile = path.join(filePath, 'test.txt');
        fs.writeFileSync(testFile, 'content');

        const strategy = new FileContentStrategy();
        // Use forward slashes regardless of platform
        const normalizedPath = testFile.replace(/\\/g, '/');
        const uri = vscode.Uri.parse(`file-strategy:${normalizedPath}`);

        const content = strategy.getContent(uri);
        assert.strictEqual(content, 'content');
    });

    test('createSchemeUri should handle paths with spaces', () => {
        const pathWithSpaces = '/path/with spaces/file name.txt';
        const uri = createSchemeUri('test', pathWithSpaces);

        assert.strictEqual(uri.path, pathWithSpaces);
    });

    test('createSchemeUri should handle Windows-style paths in query', () => {
        const windowsPath = 'C:\\Users\\Test\\file.txt';
        const uri = createSchemeUri('test', '/file.txt', {
            path: windowsPath,
        });

        const params = new URLSearchParams(uri.query);
        assert.strictEqual(params.get('path'), windowsPath);
    });
});
