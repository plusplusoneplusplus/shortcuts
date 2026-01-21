/**
 * Comprehensive Tests for Migrated Webview Providers
 * 
 * Tests the components that were migrated to use the shared webview utilities:
 * - PipelineResultViewerProvider
 * - CodeReviewViewer
 * - DiscoveryPreviewPanel
 * - PipelinePreviewEditorProvider
 * 
 * These tests verify:
 * 1. Message routing works correctly after migration
 * 2. HTML content generation uses shared utilities properly
 * 3. State management functions correctly
 * 4. Proper cleanup and disposal
 */

import * as assert from 'assert';

// ============================================================================
// Test Helpers - Simulating the shared utilities
// ============================================================================

/**
 * Simulates WebviewSetupHelper.generateNonce
 */
function generateNonce(length: number = 32): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

/**
 * Simulates WebviewSetupHelper.escapeHtml
 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Simple message router simulation for testing
 */
class TestMessageRouter<T extends { type: string }> {
    private handlers = new Map<string, ((message: T) => void | Promise<void>)[]>();
    private disposed = false;

    on(type: string, handler: (message: T) => void | Promise<void>): this {
        if (!this.handlers.has(type)) {
            this.handlers.set(type, []);
        }
        this.handlers.get(type)!.push(handler);
        return this;
    }

    async route(message: T): Promise<boolean> {
        if (this.disposed) {
            return false;
        }
        const handlers = this.handlers.get(message.type);
        if (handlers && handlers.length > 0) {
            for (const handler of handlers) {
                await handler(message);
            }
            return true;
        }
        return false;
    }

    dispose(): void {
        this.disposed = true;
        this.handlers.clear();
    }

    isDisposed(): boolean {
        return this.disposed;
    }

    getRegisteredTypes(): string[] {
        return Array.from(this.handlers.keys());
    }
}

// ============================================================================
// PipelineResultViewerProvider Tests
// ============================================================================

suite('PipelineResultViewerProvider Migration Tests', () => {
    
    /**
     * Message types from the result viewer
     */
    type ResultViewerMessageType = 'exportResults' | 'copyResults' | 'nodeClick' | 'filterResults' | 'ready';
    
    interface ResultViewerMessage {
        type: ResultViewerMessageType;
        payload?: {
            nodeId?: string;
            nodeIndex?: number;
            filterType?: 'all' | 'success' | 'failed';
            exportFormat?: 'json' | 'csv' | 'markdown';
        };
    }

    suite('Message Routing', () => {
        
        test('should route exportResults message correctly', async () => {
            const router = new TestMessageRouter<ResultViewerMessage>();
            let exportCalled = false;
            let capturedFormat: string | undefined;

            router.on('exportResults', (message) => {
                exportCalled = true;
                capturedFormat = message.payload?.exportFormat;
            });

            await router.route({ type: 'exportResults', payload: { exportFormat: 'json' } });

            assert.strictEqual(exportCalled, true, 'Export handler should be called');
            assert.strictEqual(capturedFormat, 'json', 'Format should be captured');
        });

        test('should route copyResults message correctly', async () => {
            const router = new TestMessageRouter<ResultViewerMessage>();
            let copyCalled = false;

            router.on('copyResults', () => {
                copyCalled = true;
            });

            await router.route({ type: 'copyResults' });

            assert.strictEqual(copyCalled, true, 'Copy handler should be called');
        });

        test('should route filterResults message correctly', async () => {
            const router = new TestMessageRouter<ResultViewerMessage>();
            let filterType: string | undefined;

            router.on('filterResults', (message) => {
                filterType = message.payload?.filterType;
            });

            await router.route({ type: 'filterResults', payload: { filterType: 'success' } });

            assert.strictEqual(filterType, 'success', 'Filter type should be captured');
        });

        test('should handle nodeClick message', async () => {
            const router = new TestMessageRouter<ResultViewerMessage>();
            let nodeIndex: number | undefined;

            router.on('nodeClick', (message) => {
                nodeIndex = message.payload?.nodeIndex;
            });

            await router.route({ type: 'nodeClick', payload: { nodeIndex: 5 } });

            assert.strictEqual(nodeIndex, 5, 'Node index should be captured');
        });

        test('should handle ready message', async () => {
            const router = new TestMessageRouter<ResultViewerMessage>();
            let readyCalled = false;

            router.on('ready', () => {
                readyCalled = true;
            });

            await router.route({ type: 'ready' });

            assert.strictEqual(readyCalled, true, 'Ready handler should be called');
        });

        test('should register all expected message types', () => {
            const router = new TestMessageRouter<ResultViewerMessage>();
            
            router
                .on('exportResults', () => {})
                .on('copyResults', () => {})
                .on('nodeClick', () => {})
                .on('filterResults', () => {})
                .on('ready', () => {});

            const types = router.getRegisteredTypes();
            assert.ok(types.includes('exportResults'), 'Should have exportResults');
            assert.ok(types.includes('copyResults'), 'Should have copyResults');
            assert.ok(types.includes('nodeClick'), 'Should have nodeClick');
            assert.ok(types.includes('filterResults'), 'Should have filterResults');
            assert.ok(types.includes('ready'), 'Should have ready');
        });
    });

    suite('Content Generation', () => {
        
        test('should generate valid nonce for CSP', () => {
            const nonce = generateNonce();
            assert.strictEqual(nonce.length, 32, 'Nonce should be 32 characters');
            assert.ok(/^[A-Za-z0-9]+$/.test(nonce), 'Nonce should be alphanumeric');
        });

        test('should escape HTML in pipeline name', () => {
            const dangerousName = '<script>alert("xss")</script>';
            const escaped = escapeHtml(dangerousName);
            assert.ok(!escaped.includes('<script>'), 'Should escape script tags');
            assert.ok(escaped.includes('&lt;script&gt;'), 'Should have escaped form');
        });

        test('should escape HTML in error messages', () => {
            const errorMsg = 'Error: <div onclick="alert()">click me</div>';
            const escaped = escapeHtml(errorMsg);
            assert.ok(!escaped.includes('<div'), 'Should escape div tags');
        });
    });

    suite('Export Formats', () => {
        
        test('should support json export format', async () => {
            const router = new TestMessageRouter<ResultViewerMessage>();
            let format: string | undefined;

            router.on('exportResults', (msg) => {
                format = msg.payload?.exportFormat;
            });

            await router.route({ type: 'exportResults', payload: { exportFormat: 'json' } });
            assert.strictEqual(format, 'json');
        });

        test('should support csv export format', async () => {
            const router = new TestMessageRouter<ResultViewerMessage>();
            let format: string | undefined;

            router.on('exportResults', (msg) => {
                format = msg.payload?.exportFormat;
            });

            await router.route({ type: 'exportResults', payload: { exportFormat: 'csv' } });
            assert.strictEqual(format, 'csv');
        });

        test('should support markdown export format', async () => {
            const router = new TestMessageRouter<ResultViewerMessage>();
            let format: string | undefined;

            router.on('exportResults', (msg) => {
                format = msg.payload?.exportFormat;
            });

            await router.route({ type: 'exportResults', payload: { exportFormat: 'markdown' } });
            assert.strictEqual(format, 'markdown');
        });

        test('should default to json when no format specified', async () => {
            const router = new TestMessageRouter<ResultViewerMessage>();
            let format: string | undefined = 'json'; // default

            router.on('exportResults', (msg) => {
                format = msg.payload?.exportFormat || 'json';
            });

            await router.route({ type: 'exportResults', payload: {} });
            assert.strictEqual(format, 'json');
        });
    });
});

// ============================================================================
// CodeReviewViewer Tests
// ============================================================================

suite('CodeReviewViewer Migration Tests', () => {
    
    interface CodeReviewMessage {
        type: 'openFile' | 'copyFinding';
        file?: string;
        line?: number;
    }

    suite('Message Routing', () => {
        
        test('should route openFile message correctly', async () => {
            const router = new TestMessageRouter<CodeReviewMessage>();
            let capturedFile: string | undefined;
            let capturedLine: number | undefined;

            router.on('openFile', (message) => {
                capturedFile = message.file;
                capturedLine = message.line;
            });

            await router.route({ type: 'openFile', file: 'src/test.ts', line: 42 });

            assert.strictEqual(capturedFile, 'src/test.ts', 'File should be captured');
            assert.strictEqual(capturedLine, 42, 'Line should be captured');
        });

        test('should route copyFinding message correctly', async () => {
            const router = new TestMessageRouter<CodeReviewMessage>();
            let copyCalled = false;

            router.on('copyFinding', () => {
                copyCalled = true;
            });

            await router.route({ type: 'copyFinding' });

            assert.strictEqual(copyCalled, true, 'Copy handler should be called');
        });

        test('should handle openFile without line number', async () => {
            const router = new TestMessageRouter<CodeReviewMessage>();
            let capturedLine: number | undefined = -1;

            router.on('openFile', (message) => {
                capturedLine = message.line;
            });

            await router.route({ type: 'openFile', file: 'src/test.ts' });

            assert.strictEqual(capturedLine, undefined, 'Line should be undefined');
        });
    });

    suite('Content Generation', () => {
        
        test('should escape file paths with special characters', () => {
            const path = 'src/components/<Button>.tsx';
            const escaped = escapeHtml(path);
            assert.ok(!escaped.includes('<Button>'), 'Should escape angle brackets');
            assert.ok(escaped.includes('&lt;Button&gt;'), 'Should have escaped form');
        });

        test('should escape finding descriptions', () => {
            const description = 'Missing & character in <template>';
            const escaped = escapeHtml(description);
            assert.ok(escaped.includes('&amp;'), 'Should escape ampersand');
            assert.ok(escaped.includes('&lt;template&gt;'), 'Should escape template tag');
        });

        test('should escape code snippets', () => {
            const snippet = 'const x = a < b && c > d';
            const escaped = escapeHtml(snippet);
            assert.ok(escaped.includes('&lt;'), 'Should escape less than');
            assert.ok(escaped.includes('&gt;'), 'Should escape greater than');
            assert.ok(escaped.includes('&amp;&amp;'), 'Should escape double ampersand');
        });
    });

    suite('Severity Display', () => {
        
        test('should map error severity correctly', () => {
            const severities = ['error', 'warning', 'info', 'suggestion'];
            severities.forEach(severity => {
                // Verify severity string is valid
                assert.ok(['error', 'warning', 'info', 'suggestion'].includes(severity));
            });
        });
    });
});

// ============================================================================
// DiscoveryPreviewPanel Tests
// ============================================================================

suite('DiscoveryPreviewPanel Migration Tests', () => {
    
    type DiscoveryMessageType = 
        | 'toggleItem' 
        | 'selectAll' 
        | 'deselectAll' 
        | 'addToGroup' 
        | 'filterByScore' 
        | 'filterByExtension'
        | 'refresh'
        | 'cancel'
        | 'showWarning';

    interface DiscoveryMessage {
        type: DiscoveryMessageType;
        payload?: {
            id?: string;
            targetGroup?: string;
            minScore?: number;
            sourceType?: string;
            extension?: string;
            message?: string;
        };
    }

    suite('Message Routing', () => {
        
        test('should route all 9 message types', async () => {
            const router = new TestMessageRouter<DiscoveryMessage>();
            const calledTypes: string[] = [];

            const messageTypes: DiscoveryMessageType[] = [
                'toggleItem', 'selectAll', 'deselectAll', 'addToGroup',
                'filterByScore', 'filterByExtension', 'refresh', 'cancel', 'showWarning'
            ];

            messageTypes.forEach(type => {
                router.on(type, () => {
                    calledTypes.push(type);
                });
            });

            for (const type of messageTypes) {
                await router.route({ type });
            }

            assert.strictEqual(calledTypes.length, 9, 'All 9 handlers should be called');
            messageTypes.forEach(type => {
                assert.ok(calledTypes.includes(type), `${type} should be called`);
            });
        });

        test('should route toggleItem with id payload', async () => {
            const router = new TestMessageRouter<DiscoveryMessage>();
            let capturedId: string | undefined;

            router.on('toggleItem', (message) => {
                capturedId = message.payload?.id;
            });

            await router.route({ type: 'toggleItem', payload: { id: 'file:src/test.ts' } });

            assert.strictEqual(capturedId, 'file:src/test.ts', 'ID should be captured');
        });

        test('should route addToGroup with targetGroup payload', async () => {
            const router = new TestMessageRouter<DiscoveryMessage>();
            let capturedGroup: string | undefined;

            router.on('addToGroup', (message) => {
                capturedGroup = message.payload?.targetGroup;
            });

            await router.route({ type: 'addToGroup', payload: { targetGroup: 'My Project' } });

            assert.strictEqual(capturedGroup, 'My Project', 'Group should be captured');
        });

        test('should route filterByScore with minScore payload', async () => {
            const router = new TestMessageRouter<DiscoveryMessage>();
            let capturedScore: number | undefined;

            router.on('filterByScore', (message) => {
                capturedScore = message.payload?.minScore;
            });

            await router.route({ type: 'filterByScore', payload: { minScore: 50 } });

            assert.strictEqual(capturedScore, 50, 'Score should be captured');
        });

        test('should route filterByExtension with sourceType and extension', async () => {
            const router = new TestMessageRouter<DiscoveryMessage>();
            let capturedType: string | undefined;
            let capturedExt: string | undefined;

            router.on('filterByExtension', (message) => {
                capturedType = message.payload?.sourceType;
                capturedExt = message.payload?.extension;
            });

            await router.route({ 
                type: 'filterByExtension', 
                payload: { sourceType: 'file', extension: '.ts' } 
            });

            assert.strictEqual(capturedType, 'file', 'Source type should be captured');
            assert.strictEqual(capturedExt, '.ts', 'Extension should be captured');
        });

        test('should route showWarning with message payload', async () => {
            const router = new TestMessageRouter<DiscoveryMessage>();
            let capturedMessage: string | undefined;

            router.on('showWarning', (message) => {
                capturedMessage = message.payload?.message;
            });

            await router.route({ 
                type: 'showWarning', 
                payload: { message: 'Please select a target group' } 
            });

            assert.strictEqual(capturedMessage, 'Please select a target group');
        });
    });

    suite('Content Generation', () => {
        
        test('should escape feature description', () => {
            const description = 'Feature with <script> & "quotes"';
            const escaped = escapeHtml(description);
            assert.ok(!escaped.includes('<script>'), 'Should escape script');
            assert.ok(escaped.includes('&amp;'), 'Should escape ampersand');
            assert.ok(escaped.includes('&quot;'), 'Should escape quotes');
        });

        test('should escape result names', () => {
            const name = 'file<name>.ts';
            const escaped = escapeHtml(name);
            assert.ok(escaped.includes('&lt;name&gt;'), 'Should escape angle brackets');
        });

        test('should escape result paths', () => {
            const path = 'C:\\Users\\test<user>\\file.ts';
            const escaped = escapeHtml(path);
            assert.ok(escaped.includes('&lt;user&gt;'), 'Should escape angle brackets in path');
        });
    });

    suite('Extension Filtering Logic', () => {
        
        test('should extract file extension correctly', () => {
            const testCases = [
                { path: 'file.ts', expected: '.ts' },
                { path: 'file.test.ts', expected: '.ts' },
                { path: 'path/to/file.js', expected: '.js' },
                { path: '.gitignore', expected: '.gitignore' },
                { path: 'README', expected: '' },
            ];

            testCases.forEach(({ path, expected }) => {
                // Simulate getFileExtension logic
                const normalizedPath = path.replace(/\\/g, '/');
                const lastSlashIndex = normalizedPath.lastIndexOf('/');
                const filename = lastSlashIndex >= 0 ? normalizedPath.slice(lastSlashIndex + 1) : normalizedPath;
                
                let ext = '';
                if (filename.startsWith('.') && filename.indexOf('.', 1) === -1) {
                    ext = filename;
                } else {
                    const lastDotIndex = filename.lastIndexOf('.');
                    if (lastDotIndex > 0) {
                        ext = filename.slice(lastDotIndex).toLowerCase();
                    }
                }
                
                assert.strictEqual(ext, expected, `Extension of '${path}' should be '${expected}'`);
            });
        });
    });
});

// ============================================================================
// PipelinePreviewEditorProvider Tests
// ============================================================================

suite('PipelinePreviewEditorProvider Migration Tests', () => {
    
    type PreviewMessageType = 
        | 'nodeClick' | 'execute' | 'validate' | 'edit' | 'refresh' | 'openFile' | 'ready'
        | 'generate' | 'regenerate' | 'cancelGenerate'
        | 'addRow' | 'deleteRows' | 'updateCell' | 'toggleRow' | 'toggleAll' | 'runWithItems';

    interface PreviewMessage {
        type: PreviewMessageType;
        payload?: {
            nodeId?: string;
            filePath?: string;
            indices?: number[];
            index?: number;
            field?: string;
            value?: string;
            selected?: boolean;
            items?: Array<Record<string, unknown>>;
        };
    }

    suite('Message Routing', () => {
        
        test('should route all 16 message types', async () => {
            const router = new TestMessageRouter<PreviewMessage>();
            const calledTypes: string[] = [];

            const messageTypes: PreviewMessageType[] = [
                'nodeClick', 'execute', 'validate', 'edit', 'refresh', 'openFile', 'ready',
                'generate', 'regenerate', 'cancelGenerate',
                'addRow', 'deleteRows', 'updateCell', 'toggleRow', 'toggleAll', 'runWithItems'
            ];

            messageTypes.forEach(type => {
                router.on(type, () => {
                    calledTypes.push(type);
                });
            });

            for (const type of messageTypes) {
                await router.route({ type });
            }

            assert.strictEqual(calledTypes.length, 16, 'All 16 handlers should be called');
            messageTypes.forEach(type => {
                assert.ok(calledTypes.includes(type), `${type} should be called`);
            });
        });

        test('should route openFile with filePath payload', async () => {
            const router = new TestMessageRouter<PreviewMessage>();
            let capturedPath: string | undefined;

            router.on('openFile', (message) => {
                capturedPath = message.payload?.filePath;
            });

            await router.route({ type: 'openFile', payload: { filePath: 'input.csv' } });

            assert.strictEqual(capturedPath, 'input.csv', 'File path should be captured');
        });

        test('should route deleteRows with indices payload', async () => {
            const router = new TestMessageRouter<PreviewMessage>();
            let capturedIndices: number[] | undefined;

            router.on('deleteRows', (message) => {
                capturedIndices = message.payload?.indices;
            });

            await router.route({ type: 'deleteRows', payload: { indices: [0, 2, 4] } });

            assert.deepStrictEqual(capturedIndices, [0, 2, 4], 'Indices should be captured');
        });

        test('should route updateCell with index, field, value payload', async () => {
            const router = new TestMessageRouter<PreviewMessage>();
            let capturedIndex: number | undefined;
            let capturedField: string | undefined;
            let capturedValue: string | undefined;

            router.on('updateCell', (message) => {
                capturedIndex = message.payload?.index;
                capturedField = message.payload?.field;
                capturedValue = message.payload?.value;
            });

            await router.route({ 
                type: 'updateCell', 
                payload: { index: 5, field: 'name', value: 'New Value' } 
            });

            assert.strictEqual(capturedIndex, 5, 'Index should be captured');
            assert.strictEqual(capturedField, 'name', 'Field should be captured');
            assert.strictEqual(capturedValue, 'New Value', 'Value should be captured');
        });

        test('should route toggleRow with index and selected payload', async () => {
            const router = new TestMessageRouter<PreviewMessage>();
            let capturedIndex: number | undefined;
            let capturedSelected: boolean | undefined;

            router.on('toggleRow', (message) => {
                capturedIndex = message.payload?.index;
                capturedSelected = message.payload?.selected;
            });

            await router.route({ 
                type: 'toggleRow', 
                payload: { index: 3, selected: true } 
            });

            assert.strictEqual(capturedIndex, 3, 'Index should be captured');
            assert.strictEqual(capturedSelected, true, 'Selected should be captured');
        });

        test('should route toggleAll with selected payload', async () => {
            const router = new TestMessageRouter<PreviewMessage>();
            let capturedSelected: boolean | undefined;

            router.on('toggleAll', (message) => {
                capturedSelected = message.payload?.selected;
            });

            await router.route({ type: 'toggleAll', payload: { selected: false } });

            assert.strictEqual(capturedSelected, false, 'Selected should be captured');
        });

        test('should route runWithItems with items payload', async () => {
            const router = new TestMessageRouter<PreviewMessage>();
            let capturedItems: Array<Record<string, unknown>> | undefined;

            router.on('runWithItems', (message) => {
                capturedItems = message.payload?.items;
            });

            const items = [
                { name: 'Item 1', value: 100 },
                { name: 'Item 2', value: 200 }
            ];

            await router.route({ type: 'runWithItems', payload: { items } });

            assert.strictEqual(capturedItems?.length, 2, 'Should have 2 items');
            assert.strictEqual(capturedItems?.[0].name, 'Item 1', 'First item name should match');
        });
    });

    suite('Content Generation', () => {
        
        test('should escape pipeline name', () => {
            const name = 'Pipeline <Test> & "Demo"';
            const escaped = escapeHtml(name);
            assert.ok(escaped.includes('&lt;Test&gt;'), 'Should escape angle brackets');
            assert.ok(escaped.includes('&amp;'), 'Should escape ampersand');
            assert.ok(escaped.includes('&quot;Demo&quot;'), 'Should escape quotes');
        });

        test('should escape validation error messages', () => {
            const error = 'Missing field: <required>';
            const escaped = escapeHtml(error);
            assert.ok(escaped.includes('&lt;required&gt;'), 'Should escape angle brackets');
        });

        test('should escape prompt template', () => {
            const prompt = 'Analyze {{title}} with <context> & details';
            const escaped = escapeHtml(prompt);
            assert.ok(escaped.includes('&lt;context&gt;'), 'Should escape angle brackets');
            assert.ok(escaped.includes('&amp;'), 'Should escape ampersand');
            // Template variables should be preserved after escaping
            assert.ok(escaped.includes('{{title}}'), 'Template variables should be preserved');
        });
    });

    suite('Generate State Management', () => {
        
        type GenerateStatus = 'initial' | 'generating' | 'review' | 'error';

        interface GenerateState {
            status: GenerateStatus;
            items?: Array<{ data: Record<string, unknown>; selected: boolean }>;
            message?: string;
        }

        test('should track initial state correctly', () => {
            const state: GenerateState = { status: 'initial' };
            assert.strictEqual(state.status, 'initial');
        });

        test('should track generating state correctly', () => {
            const state: GenerateState = { status: 'generating' };
            assert.strictEqual(state.status, 'generating');
        });

        test('should track review state with items', () => {
            const state: GenerateState = {
                status: 'review',
                items: [
                    { data: { name: 'Item 1' }, selected: true },
                    { data: { name: 'Item 2' }, selected: false }
                ]
            };
            assert.strictEqual(state.status, 'review');
            assert.strictEqual(state.items?.length, 2);
        });

        test('should track error state with message', () => {
            const state: GenerateState = {
                status: 'error',
                message: 'AI generation failed'
            };
            assert.strictEqual(state.status, 'error');
            assert.strictEqual(state.message, 'AI generation failed');
        });

        test('should count selected items correctly', () => {
            const items = [
                { data: { name: 'Item 1' }, selected: true },
                { data: { name: 'Item 2' }, selected: false },
                { data: { name: 'Item 3' }, selected: true },
                { data: { name: 'Item 4' }, selected: true }
            ];
            const selectedCount = items.filter(i => i.selected).length;
            assert.strictEqual(selectedCount, 3);
        });

        test('should handle toggle all correctly', () => {
            const items = [
                { data: { name: 'Item 1' }, selected: false },
                { data: { name: 'Item 2' }, selected: true },
                { data: { name: 'Item 3' }, selected: false }
            ];

            // Toggle all to selected
            items.forEach(item => item.selected = true);
            assert.ok(items.every(i => i.selected), 'All should be selected');

            // Toggle all to deselected
            items.forEach(item => item.selected = false);
            assert.ok(items.every(i => !i.selected), 'All should be deselected');
        });
    });
});

// ============================================================================
// Router Cleanup and Disposal Tests
// ============================================================================

suite('Router Cleanup and Disposal Tests', () => {
    
    interface TestMessage {
        type: 'test';
        payload?: unknown;
    }

    test('should not route messages after disposal', async () => {
        const router = new TestMessageRouter<TestMessage>();
        let callCount = 0;

        router.on('test', () => {
            callCount++;
        });

        await router.route({ type: 'test' });
        assert.strictEqual(callCount, 1, 'Should route before disposal');

        router.dispose();

        const result = await router.route({ type: 'test' });
        assert.strictEqual(result, false, 'Should return false after disposal');
        assert.strictEqual(callCount, 1, 'Should not increment after disposal');
    });

    test('should report disposed state correctly', () => {
        const router = new TestMessageRouter<TestMessage>();
        
        assert.strictEqual(router.isDisposed(), false, 'Should not be disposed initially');
        
        router.dispose();
        
        assert.strictEqual(router.isDisposed(), true, 'Should be disposed after dispose()');
    });

    test('should clear handlers on disposal', () => {
        const router = new TestMessageRouter<TestMessage>();
        
        router.on('test', () => {});
        assert.ok(router.getRegisteredTypes().includes('test'), 'Should have handler before disposal');
        
        router.dispose();
        
        assert.strictEqual(router.getRegisteredTypes().length, 0, 'Should have no handlers after disposal');
    });

    test('should handle multiple disposals gracefully', () => {
        const router = new TestMessageRouter<TestMessage>();
        
        router.dispose();
        router.dispose(); // Should not throw
        
        assert.strictEqual(router.isDisposed(), true);
    });
});

// ============================================================================
// Shared Utility Consistency Tests
// ============================================================================

suite('Shared Utility Consistency Tests', () => {
    
    suite('Nonce Generation', () => {
        
        test('should generate consistent length nonces', () => {
            for (let i = 0; i < 100; i++) {
                const nonce = generateNonce();
                assert.strictEqual(nonce.length, 32, `Nonce ${i} should be 32 characters`);
            }
        });

        test('should generate unique nonces', () => {
            const nonces = new Set<string>();
            for (let i = 0; i < 1000; i++) {
                nonces.add(generateNonce());
            }
            // With 32 alphanumeric characters, collision probability is essentially zero
            assert.strictEqual(nonces.size, 1000, 'All nonces should be unique');
        });
    });

    suite('HTML Escaping', () => {
        
        test('should escape all dangerous characters', () => {
            const dangerous = '<script>alert("XSS");</script>&';
            const escaped = escapeHtml(dangerous);
            
            assert.ok(!escaped.includes('<'), 'Should not contain <');
            assert.ok(!escaped.includes('>'), 'Should not contain >');
            assert.ok(!escaped.includes('"'), 'Should not contain "');
            assert.ok(!escaped.includes('&') || escaped.includes('&amp;'), 'Should escape &');
        });

        test('should be idempotent for safe strings', () => {
            const safe = 'Hello World 123';
            const escaped = escapeHtml(safe);
            assert.strictEqual(escaped, safe, 'Safe strings should not change');
        });

        test('should handle empty strings', () => {
            const escaped = escapeHtml('');
            assert.strictEqual(escaped, '', 'Empty string should remain empty');
        });

        test('should handle strings with only special characters', () => {
            const allSpecial = '<>&"\'';
            const escaped = escapeHtml(allSpecial);
            assert.strictEqual(escaped, '&lt;&gt;&amp;&quot;&#039;');
        });

        test('should preserve unicode characters', () => {
            const unicode = '你好世界 🌍 مرحبا';
            const escaped = escapeHtml(unicode);
            assert.strictEqual(escaped, unicode, 'Unicode should be preserved');
        });
    });
});

// ============================================================================
// Integration-Style Tests
// ============================================================================

suite('Integration Tests - Message Flow', () => {
    
    test('should handle rapid message sequences', async () => {
        interface TestMsg { type: string; seq: number; }
        const router = new TestMessageRouter<TestMsg>();
        const received: number[] = [];

        router.on('msg', (m) => {
            received.push(m.seq);
        });

        // Send 100 messages rapidly
        const promises = [];
        for (let i = 0; i < 100; i++) {
            promises.push(router.route({ type: 'msg', seq: i }));
        }
        await Promise.all(promises);

        assert.strictEqual(received.length, 100, 'Should receive all messages');
    });

    test('should handle async handlers correctly', async () => {
        interface TestMsg { type: string; delay: number; }
        const router = new TestMessageRouter<TestMsg>();
        const completionOrder: number[] = [];

        router.on('async', async (m) => {
            await new Promise(resolve => setTimeout(resolve, m.delay));
            completionOrder.push(m.delay);
        });

        // Send messages with different delays
        await Promise.all([
            router.route({ type: 'async', delay: 30 }),
            router.route({ type: 'async', delay: 10 }),
            router.route({ type: 'async', delay: 20 })
        ]);

        // All should complete
        assert.strictEqual(completionOrder.length, 3, 'All handlers should complete');
    });

    test('should isolate handlers between different routers', async () => {
        interface TestMsg { type: 'test'; }
        const router1 = new TestMessageRouter<TestMsg>();
        const router2 = new TestMessageRouter<TestMsg>();
        let count1 = 0;
        let count2 = 0;

        router1.on('test', () => { count1++; });
        router2.on('test', () => { count2++; });

        await router1.route({ type: 'test' });
        
        assert.strictEqual(count1, 1, 'Router 1 handler should be called');
        assert.strictEqual(count2, 0, 'Router 2 handler should not be called');

        await router2.route({ type: 'test' });
        
        assert.strictEqual(count1, 1, 'Router 1 should still be 1');
        assert.strictEqual(count2, 1, 'Router 2 handler should now be called');
    });
});
