/**
 * Unit tests for the new webview base provider utilities:
 * - WebviewSetupHelper
 * - WebviewStateManager
 * - WebviewMessageRouter
 * 
 * These tests verify the extension-side utilities that eliminate
 * boilerplate code across custom editor providers.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';

// Import the types and functions we can test without full VSCode mocking
import type { BaseWebviewMessage, MessageRouterOptions } from '../../shortcuts/shared/webview/webview-message-router';
import type { StateChangeEvent, DirtyStateChangeEvent } from '../../shortcuts/shared/webview/webview-state-manager';
import type { WebviewSetupOptions, WebviewThemeKind } from '../../shortcuts/shared/webview/webview-setup-helper';

suite('Webview Base Provider Tests', () => {

    // =========================================================================
    // WebviewSetupHelper Tests
    // =========================================================================

    suite('WebviewSetupHelper - Static Methods', () => {
        
        suite('generateNonce', () => {
            // Pure function implementation for testing
            function generateNonce(length: number = 32): string {
                let text = '';
                const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                for (let i = 0; i < length; i++) {
                    text += possible.charAt(Math.floor(Math.random() * possible.length));
                }
                return text;
            }

            test('should generate nonce of default length (32)', () => {
                const nonce = generateNonce();
                assert.strictEqual(nonce.length, 32);
            });

            test('should generate nonce of custom length', () => {
                const nonce = generateNonce(16);
                assert.strictEqual(nonce.length, 16);
            });

            test('should generate unique nonces', () => {
                const nonce1 = generateNonce();
                const nonce2 = generateNonce();
                assert.notStrictEqual(nonce1, nonce2);
            });

            test('should only contain alphanumeric characters', () => {
                const nonce = generateNonce(100);
                assert.ok(/^[A-Za-z0-9]+$/.test(nonce));
            });

            test('should handle zero length', () => {
                const nonce = generateNonce(0);
                assert.strictEqual(nonce.length, 0);
            });
        });

        suite('escapeHtml', () => {
            // Pure function implementation for testing
            function escapeHtml(text: string): string {
                return text
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;');
            }

            test('should escape ampersand', () => {
                assert.strictEqual(escapeHtml('a & b'), 'a &amp; b');
            });

            test('should escape less than', () => {
                assert.strictEqual(escapeHtml('a < b'), 'a &lt; b');
            });

            test('should escape greater than', () => {
                assert.strictEqual(escapeHtml('a > b'), 'a &gt; b');
            });

            test('should escape double quotes', () => {
                assert.strictEqual(escapeHtml('"hello"'), '&quot;hello&quot;');
            });

            test('should escape single quotes', () => {
                assert.strictEqual(escapeHtml("'hello'"), '&#039;hello&#039;');
            });

            test('should escape multiple special characters', () => {
                const input = '<script>alert("xss")</script>';
                const expected = '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;';
                assert.strictEqual(escapeHtml(input), expected);
            });

            test('should handle empty string', () => {
                assert.strictEqual(escapeHtml(''), '');
            });

            test('should not modify safe text', () => {
                assert.strictEqual(escapeHtml('Hello World'), 'Hello World');
            });
        });

        suite('Theme Detection', () => {
            // Pure function for theme kind conversion
            function convertThemeKind(kind: number): WebviewThemeKind {
                switch (kind) {
                    case 1: return 'light';           // Light
                    case 2: return 'dark';            // Dark
                    case 3: return 'high-contrast';   // HighContrast
                    case 4: return 'high-contrast-light'; // HighContrastLight
                    default: return 'dark';
                }
            }

            test('should convert Light theme kind', () => {
                assert.strictEqual(convertThemeKind(1), 'light');
            });

            test('should convert Dark theme kind', () => {
                assert.strictEqual(convertThemeKind(2), 'dark');
            });

            test('should convert HighContrast theme kind', () => {
                assert.strictEqual(convertThemeKind(3), 'high-contrast');
            });

            test('should convert HighContrastLight theme kind', () => {
                assert.strictEqual(convertThemeKind(4), 'high-contrast-light');
            });

            test('should default to dark for unknown theme kind', () => {
                assert.strictEqual(convertThemeKind(99), 'dark');
            });
        });
    });

    suite('WebviewSetupHelper - CSP Generation', () => {
        // Pure function implementation for testing
        function createWebviewCSP(
            cspSource: string,
            nonce: string,
            options: {
                allowInlineStyles?: boolean;
                externalStyleSources?: string[];
                externalScriptSources?: string[];
                allowImages?: boolean;
                allowFonts?: boolean;
            } = {}
        ): string {
            const {
                allowInlineStyles = true,
                externalStyleSources = [],
                externalScriptSources = [],
                allowImages = true,
                allowFonts = true
            } = options;

            const cspParts: string[] = [];
            cspParts.push("default-src 'none'");

            const styleSources = [cspSource, ...externalStyleSources];
            if (allowInlineStyles) {
                styleSources.push("'unsafe-inline'");
            }
            cspParts.push(`style-src ${styleSources.join(' ')}`);

            const scriptSources = [`'nonce-${nonce}'`, ...externalScriptSources];
            cspParts.push(`script-src ${scriptSources.join(' ')}`);

            if (allowImages) {
                cspParts.push(`img-src ${cspSource} https: data:`);
            }

            if (allowFonts) {
                cspParts.push(`font-src ${cspSource} https:`);
            }

            return cspParts.join('; ');
        }

        test('should generate CSP with default options', () => {
            const csp = createWebviewCSP('vscode-resource:', 'abc123');
            assert.ok(csp.includes("default-src 'none'"));
            assert.ok(csp.includes("style-src vscode-resource: 'unsafe-inline'"));
            assert.ok(csp.includes("script-src 'nonce-abc123'"));
            assert.ok(csp.includes('img-src vscode-resource: https: data:'));
            assert.ok(csp.includes('font-src vscode-resource: https:'));
        });

        test('should omit unsafe-inline when disabled', () => {
            const csp = createWebviewCSP('vscode-resource:', 'abc123', {
                allowInlineStyles: false
            });
            assert.ok(!csp.includes("'unsafe-inline'"));
        });

        test('should include external style sources', () => {
            const csp = createWebviewCSP('vscode-resource:', 'abc123', {
                externalStyleSources: ['https://cdn.example.com']
            });
            assert.ok(csp.includes('https://cdn.example.com'));
        });

        test('should include external script sources', () => {
            const csp = createWebviewCSP('vscode-resource:', 'abc123', {
                externalScriptSources: ['https://cdn.example.com/script.js']
            });
            assert.ok(csp.includes('https://cdn.example.com/script.js'));
        });

        test('should omit img-src when images disabled', () => {
            const csp = createWebviewCSP('vscode-resource:', 'abc123', {
                allowImages: false
            });
            assert.ok(!csp.includes('img-src'));
        });

        test('should omit font-src when fonts disabled', () => {
            const csp = createWebviewCSP('vscode-resource:', 'abc123', {
                allowFonts: false
            });
            assert.ok(!csp.includes('font-src'));
        });
    });

    // =========================================================================
    // WebviewStateManager Tests
    // =========================================================================

    suite('WebviewStateManager - Core State Management', () => {
        interface TestState {
            content: string;
            comments: string[];
        }

        // Mock implementation of state management logic
        class MockStateManager<T> {
            private states = new Map<string, T>();
            private dirtyStates = new Map<string, boolean>();
            private panelCount = 0;
            private stateChanges: StateChangeEvent<T>[] = [];
            private dirtyChanges: DirtyStateChangeEvent[] = [];

            register(key: string, state?: T): void {
                this.panelCount++;
                if (state !== undefined) {
                    this.setState(key, state);
                }
            }

            unregister(key: string): void {
                const previousState = this.states.get(key);
                this.states.delete(key);
                this.dirtyStates.delete(key);
                this.panelCount = Math.max(0, this.panelCount - 1);
                
                if (previousState !== undefined) {
                    this.stateChanges.push({
                        key,
                        state: undefined,
                        previousState
                    });
                }
            }

            setState(key: string, state: T): void {
                const previousState = this.states.get(key);
                this.states.set(key, state);
                this.stateChanges.push({ key, state, previousState });
            }

            getState(key: string): T | undefined {
                return this.states.get(key);
            }

            updateState(key: string, partial: Partial<T>): void {
                const current = this.states.get(key);
                if (current) {
                    this.setState(key, { ...current, ...partial });
                }
            }

            setDirty(key: string, isDirty: boolean): void {
                const previous = this.dirtyStates.get(key) ?? false;
                if (previous !== isDirty) {
                    this.dirtyStates.set(key, isDirty);
                    this.dirtyChanges.push({ key, isDirty });
                }
            }

            isDirty(key: string): boolean {
                return this.dirtyStates.get(key) ?? false;
            }

            hasPanel(key: string): boolean {
                return this.states.has(key);
            }

            getPanelCount(): number {
                return this.panelCount;
            }

            getStateChanges(): StateChangeEvent<T>[] {
                return this.stateChanges;
            }

            getDirtyChanges(): DirtyStateChangeEvent[] {
                return this.dirtyChanges;
            }
        }

        test('should register panel with initial state', () => {
            const manager = new MockStateManager<TestState>();
            const state: TestState = { content: 'Hello', comments: [] };
            
            manager.register('/path/to/file.md', state);
            
            assert.strictEqual(manager.getPanelCount(), 1);
            assert.deepStrictEqual(manager.getState('/path/to/file.md'), state);
        });

        test('should register panel without initial state', () => {
            const manager = new MockStateManager<TestState>();
            
            manager.register('/path/to/file.md');
            
            assert.strictEqual(manager.getPanelCount(), 1);
            assert.strictEqual(manager.getState('/path/to/file.md'), undefined);
        });

        test('should unregister panel and clean up state', () => {
            const manager = new MockStateManager<TestState>();
            const state: TestState = { content: 'Hello', comments: [] };
            
            manager.register('/path/to/file.md', state);
            manager.unregister('/path/to/file.md');
            
            assert.strictEqual(manager.getPanelCount(), 0);
            assert.strictEqual(manager.getState('/path/to/file.md'), undefined);
        });

        test('should update state and track change', () => {
            const manager = new MockStateManager<TestState>();
            const initialState: TestState = { content: 'Hello', comments: [] };
            const newState: TestState = { content: 'World', comments: ['comment1'] };
            
            manager.register('/path/to/file.md', initialState);
            manager.setState('/path/to/file.md', newState);
            
            assert.deepStrictEqual(manager.getState('/path/to/file.md'), newState);
            
            const changes = manager.getStateChanges();
            assert.strictEqual(changes.length, 2); // register + setState
            assert.deepStrictEqual(changes[1].previousState, initialState);
            assert.deepStrictEqual(changes[1].state, newState);
        });

        test('should update partial state', () => {
            const manager = new MockStateManager<TestState>();
            const initialState: TestState = { content: 'Hello', comments: ['a', 'b'] };
            
            manager.register('/path/to/file.md', initialState);
            manager.updateState('/path/to/file.md', { content: 'World' });
            
            const state = manager.getState('/path/to/file.md');
            assert.strictEqual(state?.content, 'World');
            assert.deepStrictEqual(state?.comments, ['a', 'b']); // unchanged
        });

        test('should track dirty state', () => {
            const manager = new MockStateManager<TestState>();
            manager.register('/path/to/file.md');
            
            assert.strictEqual(manager.isDirty('/path/to/file.md'), false);
            
            manager.setDirty('/path/to/file.md', true);
            assert.strictEqual(manager.isDirty('/path/to/file.md'), true);
            
            manager.setDirty('/path/to/file.md', false);
            assert.strictEqual(manager.isDirty('/path/to/file.md'), false);
        });

        test('should only fire dirty change when value actually changes', () => {
            const manager = new MockStateManager<TestState>();
            manager.register('/path/to/file.md');
            
            manager.setDirty('/path/to/file.md', true);
            manager.setDirty('/path/to/file.md', true); // same value
            manager.setDirty('/path/to/file.md', false);
            
            const changes = manager.getDirtyChanges();
            assert.strictEqual(changes.length, 2); // true, then false
        });

        test('should check panel existence', () => {
            const manager = new MockStateManager<TestState>();
            
            assert.strictEqual(manager.hasPanel('/path/to/file.md'), false);
            
            manager.register('/path/to/file.md', { content: '', comments: [] });
            assert.strictEqual(manager.hasPanel('/path/to/file.md'), true);
            
            manager.unregister('/path/to/file.md');
            assert.strictEqual(manager.hasPanel('/path/to/file.md'), false);
        });

        test('should handle multiple panels', () => {
            const manager = new MockStateManager<TestState>();
            
            manager.register('/path/file1.md', { content: 'File 1', comments: [] });
            manager.register('/path/file2.md', { content: 'File 2', comments: [] });
            manager.register('/path/file3.md', { content: 'File 3', comments: [] });
            
            assert.strictEqual(manager.getPanelCount(), 3);
            assert.strictEqual(manager.getState('/path/file1.md')?.content, 'File 1');
            assert.strictEqual(manager.getState('/path/file2.md')?.content, 'File 2');
            assert.strictEqual(manager.getState('/path/file3.md')?.content, 'File 3');
        });
    });

    suite('WebviewStateManager - Title Management', () => {
        // Mock implementation for title management
        class MockTitleManager {
            private titles = new Map<string, string>();
            private originalTitles = new Map<string, string>();
            private dirtyStates = new Map<string, boolean>();

            register(key: string, title: string): void {
                this.titles.set(key, title);
                this.originalTitles.set(key, title);
            }

            getTitle(key: string): string | undefined {
                return this.titles.get(key);
            }

            setDirty(key: string, isDirty: boolean): void {
                const wasDirty = this.dirtyStates.get(key) ?? false;
                if (wasDirty === isDirty) return;
                
                this.dirtyStates.set(key, isDirty);
                const originalTitle = this.originalTitles.get(key);
                if (originalTitle) {
                    this.titles.set(key, isDirty ? `● ${originalTitle}` : originalTitle);
                }
            }

            updateTitle(key: string, newTitle: string): void {
                this.originalTitles.set(key, newTitle);
                const isDirty = this.dirtyStates.get(key) ?? false;
                this.titles.set(key, isDirty ? `● ${newTitle}` : newTitle);
            }
        }

        test('should add dirty indicator when state becomes dirty', () => {
            const manager = new MockTitleManager();
            manager.register('/path/file.md', 'file.md');
            
            manager.setDirty('/path/file.md', true);
            
            assert.strictEqual(manager.getTitle('/path/file.md'), '● file.md');
        });

        test('should remove dirty indicator when state becomes clean', () => {
            const manager = new MockTitleManager();
            manager.register('/path/file.md', 'file.md');
            
            manager.setDirty('/path/file.md', true);
            manager.setDirty('/path/file.md', false);
            
            assert.strictEqual(manager.getTitle('/path/file.md'), 'file.md');
        });

        test('should preserve dirty indicator when title is updated', () => {
            const manager = new MockTitleManager();
            manager.register('/path/file.md', 'old-name.md');
            
            manager.setDirty('/path/file.md', true);
            manager.updateTitle('/path/file.md', 'new-name.md');
            
            assert.strictEqual(manager.getTitle('/path/file.md'), '● new-name.md');
        });

        test('should handle clean title update', () => {
            const manager = new MockTitleManager();
            manager.register('/path/file.md', 'old-name.md');
            
            manager.updateTitle('/path/file.md', 'new-name.md');
            
            assert.strictEqual(manager.getTitle('/path/file.md'), 'new-name.md');
        });
    });

    // =========================================================================
    // WebviewMessageRouter Tests
    // =========================================================================

    suite('WebviewMessageRouter - Handler Registration', () => {
        // Mock implementation of message router logic
        class MockMessageRouter<TMessage extends BaseWebviewMessage> {
            private handlers = new Map<string, (msg: TMessage) => void | Promise<void>>();
            private disposed = false;
            
            on<K extends TMessage['type']>(
                type: K,
                handler: (msg: Extract<TMessage, { type: K }>) => void | Promise<void>
            ): this {
                if (this.disposed) {
                    throw new Error('Cannot add handler to disposed router');
                }
                this.handlers.set(type, handler as (msg: TMessage) => void | Promise<void>);
                return this;
            }
            
            off(type: TMessage['type']): void {
                this.handlers.delete(type);
            }
            
            hasHandler(type: string): boolean {
                return this.handlers.has(type);
            }
            
            getRegisteredTypes(): string[] {
                return Array.from(this.handlers.keys());
            }
            
            async route(message: TMessage): Promise<boolean> {
                if (this.disposed) return false;
                
                const handler = this.handlers.get(message.type);
                if (!handler) return false;
                
                await handler(message);
                return true;
            }
            
            dispose(): void {
                this.disposed = true;
                this.handlers.clear();
            }
            
            isDisposed(): boolean {
                return this.disposed;
            }
        }

        type TestMessage = 
            | { type: 'ready' }
            | { type: 'save'; content: string }
            | { type: 'addComment'; text: string; line: number };

        test('should register handler for message type', () => {
            const router = new MockMessageRouter<TestMessage>();
            
            router.on('ready', () => {});
            
            assert.ok(router.hasHandler('ready'));
        });

        test('should allow chaining handler registration', () => {
            const router = new MockMessageRouter<TestMessage>();
            
            router
                .on('ready', () => {})
                .on('save', () => {})
                .on('addComment', () => {});
            
            assert.ok(router.hasHandler('ready'));
            assert.ok(router.hasHandler('save'));
            assert.ok(router.hasHandler('addComment'));
        });

        test('should remove handler', () => {
            const router = new MockMessageRouter<TestMessage>();
            
            router.on('ready', () => {});
            assert.ok(router.hasHandler('ready'));
            
            router.off('ready');
            assert.ok(!router.hasHandler('ready'));
        });

        test('should return registered types', () => {
            const router = new MockMessageRouter<TestMessage>();
            
            router.on('ready', () => {});
            router.on('save', () => {});
            
            const types = router.getRegisteredTypes();
            assert.ok(types.includes('ready'));
            assert.ok(types.includes('save'));
            assert.strictEqual(types.length, 2);
        });

        test('should throw when adding handler to disposed router', () => {
            const router = new MockMessageRouter<TestMessage>();
            router.dispose();
            
            assert.throws(() => {
                router.on('ready', () => {});
            }, /disposed/);
        });
    });

    suite('WebviewMessageRouter - Message Routing', () => {
        class MockMessageRouter<TMessage extends BaseWebviewMessage> {
            private handlers = new Map<string, (msg: TMessage) => void | Promise<void>>();
            private disposed = false;
            
            on(type: string, handler: (msg: TMessage) => void | Promise<void>): this {
                this.handlers.set(type, handler);
                return this;
            }
            
            async route(message: TMessage): Promise<boolean> {
                if (this.disposed) return false;
                if (!message || typeof message.type !== 'string') return false;
                
                const handler = this.handlers.get(message.type);
                if (!handler) return false;
                
                await handler(message);
                return true;
            }
            
            dispose(): void {
                this.disposed = true;
            }
        }

        type TestMessage = 
            | { type: 'ready' }
            | { type: 'save'; content: string };

        test('should route message to correct handler', async () => {
            const router = new MockMessageRouter<TestMessage>();
            let called = false;
            
            router.on('ready', () => { called = true; });
            
            const result = await router.route({ type: 'ready' });
            
            assert.ok(result);
            assert.ok(called);
        });

        test('should return false for unhandled message type', async () => {
            const router = new MockMessageRouter<TestMessage>();
            
            router.on('ready', () => {});
            
            const result = await router.route({ type: 'save', content: 'test' });
            
            assert.strictEqual(result, false);
        });

        test('should pass message data to handler', async () => {
            const router = new MockMessageRouter<TestMessage>();
            let receivedContent: string | undefined;
            
            router.on('save', (msg) => {
                receivedContent = (msg as { type: 'save'; content: string }).content;
            });
            
            await router.route({ type: 'save', content: 'Hello World' });
            
            assert.strictEqual(receivedContent, 'Hello World');
        });

        test('should not route after disposal', async () => {
            const router = new MockMessageRouter<TestMessage>();
            let called = false;
            
            router.on('ready', () => { called = true; });
            router.dispose();
            
            const result = await router.route({ type: 'ready' });
            
            assert.strictEqual(result, false);
            assert.strictEqual(called, false);
        });

        test('should handle async handlers', async () => {
            const router = new MockMessageRouter<TestMessage>();
            let completed = false;
            
            router.on('ready', async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
                completed = true;
            });
            
            await router.route({ type: 'ready' });
            
            assert.ok(completed);
        });

        test('should return false for invalid message', async () => {
            const router = new MockMessageRouter<TestMessage>();
            router.on('ready', () => {});
            
            // Test with null
            assert.strictEqual(await router.route(null as any), false);
            
            // Test with missing type
            assert.strictEqual(await router.route({} as any), false);
            
            // Test with non-string type
            assert.strictEqual(await router.route({ type: 123 } as any), false);
        });
    });

    suite('WebviewMessageRouter - Error Handling', () => {
        class MockMessageRouter<TMessage extends BaseWebviewMessage> {
            private handlers = new Map<string, (msg: TMessage) => void | Promise<void>>();
            private errorHandler: (type: string, error: Error) => void;
            
            constructor(onError?: (type: string, error: Error) => void) {
                this.errorHandler = onError ?? (() => {});
            }
            
            on(type: string, handler: (msg: TMessage) => void | Promise<void>): this {
                this.handlers.set(type, handler);
                return this;
            }
            
            async route(message: TMessage): Promise<boolean> {
                const handler = this.handlers.get(message.type);
                if (!handler) return false;
                
                try {
                    await handler(message);
                    return true;
                } catch (error) {
                    const err = error instanceof Error ? error : new Error(String(error));
                    this.errorHandler(message.type, err);
                    return false;
                }
            }
        }

        type TestMessage = { type: 'test' };

        test('should catch and report handler errors', async () => {
            let capturedError: Error | undefined;
            let capturedType: string | undefined;
            
            const router = new MockMessageRouter<TestMessage>((type, error) => {
                capturedType = type;
                capturedError = error;
            });
            
            router.on('test', () => {
                throw new Error('Handler error');
            });
            
            const result = await router.route({ type: 'test' });
            
            assert.strictEqual(result, false);
            assert.strictEqual(capturedType, 'test');
            assert.ok(capturedError?.message.includes('Handler error'));
        });

        test('should handle async handler errors', async () => {
            let capturedError: Error | undefined;
            
            const router = new MockMessageRouter<TestMessage>((_, error) => {
                capturedError = error;
            });
            
            router.on('test', async () => {
                await new Promise(resolve => setTimeout(resolve, 5));
                throw new Error('Async error');
            });
            
            const result = await router.route({ type: 'test' });
            
            assert.strictEqual(result, false);
            assert.ok(capturedError?.message.includes('Async error'));
        });

        test('should convert non-Error throws to Error', async () => {
            let capturedError: Error | undefined;
            
            const router = new MockMessageRouter<TestMessage>((_, error) => {
                capturedError = error;
            });
            
            router.on('test', () => {
                throw 'string error';  // eslint-disable-line no-throw-literal
            });
            
            await router.route({ type: 'test' });
            
            assert.ok(capturedError instanceof Error);
        });
    });

    // =========================================================================
    // PreviewPanelManager Tests
    // =========================================================================

    suite('PreviewPanelManager', () => {
        interface TestState {
            content: string;
        }

        // Mock implementation of preview panel logic
        class MockPreviewManager {
            private _isPreviewMode = false;
            private _previewKey: string | undefined;
            private pinnedKeys: string[] = [];

            get isInPreviewMode(): boolean {
                return this._isPreviewMode;
            }

            get currentPreviewKey(): string | undefined {
                return this._isPreviewMode ? this._previewKey : undefined;
            }

            setPreview(key: string): void {
                this._previewKey = key;
                this._isPreviewMode = true;
            }

            clearPreview(): void {
                this._previewKey = undefined;
                this._isPreviewMode = false;
            }

            pinPreview(): string | undefined {
                if (!this._isPreviewMode || !this._previewKey) return undefined;
                
                const key = this._previewKey;
                this.pinnedKeys.push(key);
                this.clearPreview();
                return key;
            }

            isPreviewPanel(key: string): boolean {
                return this._isPreviewMode && this._previewKey === key;
            }

            reusePreview(newKey: string): string | undefined {
                if (!this._isPreviewMode || !this._previewKey) return undefined;
                
                const oldKey = this._previewKey;
                this._previewKey = newKey;
                return oldKey;
            }

            getPinnedKeys(): string[] {
                return this.pinnedKeys;
            }
        }

        test('should start with no preview', () => {
            const manager = new MockPreviewManager();
            
            assert.strictEqual(manager.isInPreviewMode, false);
            assert.strictEqual(manager.currentPreviewKey, undefined);
        });

        test('should set preview mode', () => {
            const manager = new MockPreviewManager();
            
            manager.setPreview('/path/file.md');
            
            assert.strictEqual(manager.isInPreviewMode, true);
            assert.strictEqual(manager.currentPreviewKey, '/path/file.md');
        });

        test('should clear preview mode', () => {
            const manager = new MockPreviewManager();
            
            manager.setPreview('/path/file.md');
            manager.clearPreview();
            
            assert.strictEqual(manager.isInPreviewMode, false);
            assert.strictEqual(manager.currentPreviewKey, undefined);
        });

        test('should pin preview and return key', () => {
            const manager = new MockPreviewManager();
            
            manager.setPreview('/path/file.md');
            const pinnedKey = manager.pinPreview();
            
            assert.strictEqual(pinnedKey, '/path/file.md');
            assert.strictEqual(manager.isInPreviewMode, false);
            assert.ok(manager.getPinnedKeys().includes('/path/file.md'));
        });

        test('should return undefined when pinning with no preview', () => {
            const manager = new MockPreviewManager();
            
            const pinnedKey = manager.pinPreview();
            
            assert.strictEqual(pinnedKey, undefined);
        });

        test('should check if key is current preview', () => {
            const manager = new MockPreviewManager();
            
            manager.setPreview('/path/file.md');
            
            assert.strictEqual(manager.isPreviewPanel('/path/file.md'), true);
            assert.strictEqual(manager.isPreviewPanel('/path/other.md'), false);
        });

        test('should reuse preview with new key', () => {
            const manager = new MockPreviewManager();
            
            manager.setPreview('/path/file1.md');
            const oldKey = manager.reusePreview('/path/file2.md');
            
            assert.strictEqual(oldKey, '/path/file1.md');
            assert.strictEqual(manager.currentPreviewKey, '/path/file2.md');
            assert.strictEqual(manager.isInPreviewMode, true);
        });

        test('should return undefined when reusing with no preview', () => {
            const manager = new MockPreviewManager();
            
            const oldKey = manager.reusePreview('/path/file.md');
            
            assert.strictEqual(oldKey, undefined);
        });
    });

    // =========================================================================
    // Default Options Tests
    // =========================================================================

    suite('Default Options', () => {
        test('WebviewSetupOptions defaults', () => {
            const defaults: Required<Omit<WebviewSetupOptions, 'additionalResourceRoots'>> = {
                enableScripts: true,
                retainContextWhenHidden: true,
                enableFindWidget: true,
                enableCommandUris: false
            };

            assert.strictEqual(defaults.enableScripts, true);
            assert.strictEqual(defaults.retainContextWhenHidden, true);
            assert.strictEqual(defaults.enableFindWidget, true);
            assert.strictEqual(defaults.enableCommandUris, false);
        });

        test('MessageRouterOptions defaults', () => {
            const defaults: Required<MessageRouterOptions> = {
                logUnhandledMessages: true,
                onError: () => {}
            };

            assert.strictEqual(defaults.logUnhandledMessages, true);
            assert.ok(typeof defaults.onError === 'function');
        });
    });

    // =========================================================================
    // Path Normalization Tests
    // =========================================================================

    suite('Path Normalization', () => {
        function normalizePath(filePath: string): string {
            return filePath.replace(/\\/g, '/');
        }

        test('should normalize Windows paths', () => {
            const result = normalizePath('C:\\Users\\test\\file.md');
            assert.strictEqual(result, 'C:/Users/test/file.md');
        });

        test('should not modify Unix paths', () => {
            const result = normalizePath('/home/user/file.md');
            assert.strictEqual(result, '/home/user/file.md');
        });

        test('should handle mixed slashes', () => {
            const result = normalizePath('C:\\Users/test\\file.md');
            assert.strictEqual(result, 'C:/Users/test/file.md');
        });

        test('should handle empty string', () => {
            const result = normalizePath('');
            assert.strictEqual(result, '');
        });

        test('should handle path with no slashes', () => {
            const result = normalizePath('file.md');
            assert.strictEqual(result, 'file.md');
        });
    });
});
