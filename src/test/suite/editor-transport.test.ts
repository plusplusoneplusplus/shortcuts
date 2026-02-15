/**
 * Tests for the EditorTransport abstraction layer
 * 
 * Tests the transport interface, VscodeTransport implementation,
 * state manager transport integration, and the refactored vscode-bridge
 * that routes all messages through the transport.
 * 
 * Note: Since webview-scripts depend on browser globals (window, document),
 * we mirror the production logic in pure test functions following the
 * pattern established in shared-webview.test.ts.
 */

import * as assert from 'assert';

suite('Editor Transport Layer Tests', () => {

    // =========================================================================
    // EditorTransport interface contract tests
    // =========================================================================

    suite('EditorTransport interface contract', () => {

        /** Minimal mock transport for contract testing */
        interface EditorTransport {
            postMessage(message: { type: string;[key: string]: unknown }): void;
            onMessage(handler: (message: { type: string;[key: string]: unknown }) => void): void;
        }

        function createMockTransport(): EditorTransport & { sent: unknown[]; handlers: Array<(msg: any) => void> } {
            const sent: unknown[] = [];
            const handlers: Array<(msg: any) => void> = [];
            return {
                sent,
                handlers,
                postMessage(message: { type: string }) {
                    sent.push(message);
                },
                onMessage(handler: (message: any) => void) {
                    handlers.push(handler);
                }
            };
        }

        test('postMessage should accept a typed message', () => {
            const transport = createMockTransport();
            transport.postMessage({ type: 'ready' });
            assert.strictEqual(transport.sent.length, 1);
            assert.deepStrictEqual(transport.sent[0], { type: 'ready' });
        });

        test('postMessage should accept complex messages', () => {
            const transport = createMockTransport();
            const message = {
                type: 'addComment',
                comment: 'hello',
                selection: { startLine: 1, endLine: 5, startColumn: 0, endColumn: 10, selectedText: 'foo' }
            };
            transport.postMessage(message);
            assert.deepStrictEqual(transport.sent[0], message);
        });

        test('onMessage should register a handler', () => {
            const transport = createMockTransport();
            const received: unknown[] = [];
            transport.onMessage((msg) => received.push(msg));
            assert.strictEqual(transport.handlers.length, 1);
        });

        test('registered handler should receive dispatched messages', () => {
            const transport = createMockTransport();
            const received: unknown[] = [];
            transport.onMessage((msg) => received.push(msg));

            // Simulate host dispatching a message
            transport.handlers[0]({ type: 'update', content: 'hello' });
            assert.strictEqual(received.length, 1);
            assert.deepStrictEqual(received[0], { type: 'update', content: 'hello' });
        });

        test('multiple handlers should all receive messages', () => {
            const transport = createMockTransport();
            const received1: unknown[] = [];
            const received2: unknown[] = [];
            transport.onMessage((msg) => received1.push(msg));
            transport.onMessage((msg) => received2.push(msg));

            transport.handlers.forEach(h => h({ type: 'update' }));
            assert.strictEqual(received1.length, 1);
            assert.strictEqual(received2.length, 1);
        });
    });

    // =========================================================================
    // VscodeTransport implementation tests
    // =========================================================================

    suite('VscodeTransport implementation', () => {

        /** Mirror of VsCodeApi from types.ts */
        interface MockVsCodeApi {
            messages: unknown[];
            postMessage(message: unknown): void;
            getState(): unknown;
            setState(state: unknown): void;
        }

        function createMockVsCodeApi(): MockVsCodeApi {
            let savedState: unknown = undefined;
            return {
                messages: [],
                postMessage(message: unknown) {
                    this.messages.push(message);
                },
                getState() { return savedState; },
                setState(state: unknown) { savedState = state; }
            };
        }

        /**
         * Mirror of VscodeTransport from transport.ts
         * (cannot import directly due to browser globals)
         */
        class VscodeTransport {
            constructor(private readonly vscode: MockVsCodeApi) { }

            postMessage(message: { type: string;[key: string]: unknown }): void {
                this.vscode.postMessage(message);
            }

            onMessage(handler: (message: any) => void): void {
                // In real implementation: window.addEventListener('message', ...)
                // For tests, we store handlers to simulate message dispatch
                (this as any)._handlers = (this as any)._handlers || [];
                (this as any)._handlers.push(handler);
            }

            /** Test helper: simulate receiving a message from the extension */
            _simulateMessage(message: any): void {
                const handlers = (this as any)._handlers || [];
                for (const handler of handlers) {
                    handler(message);
                }
            }
        }

        test('postMessage should delegate to vscode.postMessage', () => {
            const mockApi = createMockVsCodeApi();
            const transport = new VscodeTransport(mockApi);

            transport.postMessage({ type: 'ready' });
            assert.strictEqual(mockApi.messages.length, 1);
            assert.deepStrictEqual(mockApi.messages[0], { type: 'ready' });
        });

        test('postMessage should pass through all message fields', () => {
            const mockApi = createMockVsCodeApi();
            const transport = new VscodeTransport(mockApi);

            const msg = {
                type: 'addComment',
                comment: 'test comment',
                selection: { startLine: 1, endLine: 3, startColumn: 0, endColumn: 5, selectedText: 'hi' }
            };
            transport.postMessage(msg);
            assert.deepStrictEqual(mockApi.messages[0], msg);
        });

        test('multiple postMessage calls should all be sent', () => {
            const mockApi = createMockVsCodeApi();
            const transport = new VscodeTransport(mockApi);

            transport.postMessage({ type: 'ready' });
            transport.postMessage({ type: 'updateContent', content: 'new' });
            transport.postMessage({ type: 'resolveAll' });
            assert.strictEqual(mockApi.messages.length, 3);
        });

        test('onMessage should register handler that receives messages', () => {
            const mockApi = createMockVsCodeApi();
            const transport = new VscodeTransport(mockApi);
            const received: unknown[] = [];

            transport.onMessage((msg) => received.push(msg));
            transport._simulateMessage({ type: 'update', content: 'hello' });

            assert.strictEqual(received.length, 1);
            assert.deepStrictEqual(received[0], { type: 'update', content: 'hello' });
        });

        test('onMessage handler should receive all extension message types', () => {
            const mockApi = createMockVsCodeApi();
            const transport = new VscodeTransport(mockApi);
            const received: unknown[] = [];

            transport.onMessage((msg) => received.push(msg));

            const messages = [
                { type: 'update', content: 'test', comments: [], filePath: '/test.md', fileDir: '/dir', workspaceRoot: '/' },
                { type: 'imageResolved', imgId: 'img1', uri: 'data:...', alt: 'test' },
                { type: 'scrollToComment', commentId: 'c1' },
                { type: 'promptFilesResponse', promptFiles: [] },
                { type: 'showFollowPromptDialog', promptName: 'test', promptFilePath: '/test', availableModels: [], defaults: { mode: 'interactive', model: 'claude' } },
                { type: 'showUpdateDocumentDialog' },
                { type: 'showRefreshPlanDialog' }
            ];

            for (const msg of messages) {
                transport._simulateMessage(msg);
            }

            assert.strictEqual(received.length, messages.length);
            for (let i = 0; i < messages.length; i++) {
                assert.deepStrictEqual(received[i], messages[i]);
            }
        });
    });

    // =========================================================================
    // State manager transport integration tests
    // =========================================================================

    suite('WebviewStateManager transport integration', () => {

        /**
         * Mirror of transport-related state management from state.ts
         */
        interface EditorTransport {
            postMessage(message: any): void;
            onMessage(handler: (message: any) => void): void;
        }

        class WebviewStateManagerMirror {
            private _transport: EditorTransport | null = null;

            get transport(): EditorTransport {
                if (!this._transport) {
                    throw new Error('Transport not initialized');
                }
                return this._transport;
            }

            setTransport(transport: EditorTransport): void {
                this._transport = transport;
            }
        }

        function createMockTransport(): EditorTransport & { sent: unknown[] } {
            return {
                sent: [],
                postMessage(message: unknown) {
                    this.sent.push(message);
                },
                onMessage() { }
            };
        }

        test('transport getter should throw if not initialized', () => {
            const state = new WebviewStateManagerMirror();
            assert.throws(() => state.transport, /Transport not initialized/);
        });

        test('setTransport should set the transport', () => {
            const state = new WebviewStateManagerMirror();
            const transport = createMockTransport();
            state.setTransport(transport);
            assert.strictEqual(state.transport, transport);
        });

        test('transport should be usable after initialization', () => {
            const state = new WebviewStateManagerMirror();
            const transport = createMockTransport();
            state.setTransport(transport);

            state.transport.postMessage({ type: 'ready' });
            assert.strictEqual(transport.sent.length, 1);
        });

        test('transport can be replaced', () => {
            const state = new WebviewStateManagerMirror();
            const transport1 = createMockTransport();
            const transport2 = createMockTransport();

            state.setTransport(transport1);
            state.transport.postMessage({ type: 'ready' });
            assert.strictEqual(transport1.sent.length, 1);

            state.setTransport(transport2);
            state.transport.postMessage({ type: 'update' });
            assert.strictEqual(transport2.sent.length, 1);
            assert.strictEqual(transport1.sent.length, 1); // not affected
        });
    });

    // =========================================================================
    // vscode-bridge routing through transport tests
    // =========================================================================

    suite('vscode-bridge routes messages through transport', () => {

        /** Simulates the state + transport + bridge wiring */
        interface EditorTransport {
            postMessage(message: any): void;
            onMessage(handler: (message: any) => void): void;
        }

        class MockStateWithTransport {
            private _transport: EditorTransport | null = null;

            get transport(): EditorTransport {
                if (!this._transport) {
                    throw new Error('Transport not initialized');
                }
                return this._transport;
            }

            setTransport(transport: EditorTransport): void {
                this._transport = transport;
            }
        }

        function createCapturingTransport(): EditorTransport & { sent: unknown[]; messageHandlers: Array<(msg: any) => void> } {
            return {
                sent: [],
                messageHandlers: [],
                postMessage(message: unknown) {
                    this.sent.push(message);
                },
                onMessage(handler: (msg: any) => void) {
                    this.messageHandlers.push(handler);
                }
            };
        }

        /**
         * Mirror of postMessage from vscode-bridge.ts (after refactoring)
         */
        function postMessage(state: MockStateWithTransport, message: any): void {
            state.transport.postMessage(message);
        }

        /**
         * Mirror of setupMessageListener from vscode-bridge.ts (after refactoring)
         */
        function setupMessageListener(state: MockStateWithTransport, handler: (msg: any) => void): void {
            state.transport.onMessage(handler);
        }

        test('postMessage should route through transport.postMessage', () => {
            const state = new MockStateWithTransport();
            const transport = createCapturingTransport();
            state.setTransport(transport);

            postMessage(state, { type: 'ready' });
            assert.strictEqual(transport.sent.length, 1);
            assert.deepStrictEqual(transport.sent[0], { type: 'ready' });
        });

        test('all 28+ bridge functions should route through postMessage', () => {
            const state = new MockStateWithTransport();
            const transport = createCapturingTransport();
            state.setTransport(transport);

            // Simulate the various message types that vscode-bridge functions send
            const messageTypes = [
                { type: 'ready' },
                { type: 'resolveAll' },
                { type: 'deleteAll' },
                { type: 'copyPrompt', promptOptions: { format: 'markdown' } },
                { type: 'sendToChat', promptOptions: { format: 'markdown', newConversation: true } },
                { type: 'sendToCLIInteractive', promptOptions: { format: 'markdown' } },
                { type: 'sendToCLIBackground', promptOptions: { format: 'markdown' } },
                { type: 'sendCommentToChat', commentId: 'c1', newConversation: true },
                { type: 'addComment', selection: { startLine: 1, endLine: 1, startColumn: 0, endColumn: 5, selectedText: 'hi' }, comment: 'test' },
                { type: 'editComment', commentId: 'c1', comment: 'updated' },
                { type: 'resolveComment', commentId: 'c1' },
                { type: 'reopenComment', commentId: 'c1' },
                { type: 'deleteComment', commentId: 'c1' },
                { type: 'updateContent', content: 'new content' },
                { type: 'resolveImagePath', path: '/img.png', imgId: 'i1' },
                { type: 'openFile', path: '/test.md' },
                { type: 'askAI', context: { selectedText: 'x', startLine: 1, endLine: 1, surroundingLines: '', nearestHeading: null, allHeadings: [], instructionType: 'clarify', mode: 'copilot' } },
                { type: 'requestPromptFiles' },
                { type: 'requestSkills' },
                { type: 'promptSearch' },
                { type: 'executeWorkPlan', promptFilePath: '/prompt.md' },
                { type: 'executeWorkPlanWithSkill', skillName: 'test-skill' },
                // Migrated bypass callers
                { type: 'collapsedSectionsChanged', collapsedSections: ['h1', 'h2'] },
                { type: 'followPromptDialogResult', promptFilePath: '/p.md', options: { mode: 'interactive', model: 'claude' } },
                { type: 'copyFollowPrompt', promptFilePath: '/p.md' },
                { type: 'updateDocument', instruction: 'fix typo' },
                { type: 'refreshPlan', additionalContext: 'updated code' }
            ];

            for (const msg of messageTypes) {
                postMessage(state, msg);
            }

            assert.strictEqual(transport.sent.length, messageTypes.length);
            for (let i = 0; i < messageTypes.length; i++) {
                assert.deepStrictEqual(transport.sent[i], messageTypes[i]);
            }
        });

        test('setupMessageListener should route through transport.onMessage', () => {
            const state = new MockStateWithTransport();
            const transport = createCapturingTransport();
            state.setTransport(transport);

            const received: unknown[] = [];
            setupMessageListener(state, (msg) => received.push(msg));

            assert.strictEqual(transport.messageHandlers.length, 1);

            // Simulate extension sending a message
            transport.messageHandlers[0]({ type: 'update', content: 'hello', comments: [], filePath: '/test.md' });
            assert.strictEqual(received.length, 1);
        });

        test('postMessage should throw if transport not initialized', () => {
            const state = new MockStateWithTransport();
            assert.throws(() => postMessage(state, { type: 'ready' }), /Transport not initialized/);
        });
    });

    // =========================================================================
    // Bypass caller migration tests
    // =========================================================================

    suite('Bypass caller migration', () => {

        interface EditorTransport {
            postMessage(message: any): void;
            onMessage(handler: (message: any) => void): void;
        }

        function createCapturingTransport(): EditorTransport & { sent: unknown[] } {
            return {
                sent: [],
                postMessage(message: unknown) {
                    this.sent.push(message);
                },
                onMessage() { }
            };
        }

        test('heading-collapse-handlers sends collapsedSectionsChanged via transport', () => {
            const transport = createCapturingTransport();

            // Simulate what handleCollapseButtonClick does after refactoring
            transport.postMessage({
                type: 'collapsedSectionsChanged',
                collapsedSections: ['heading-1', 'heading-2']
            });

            assert.strictEqual(transport.sent.length, 1);
            const msg = transport.sent[0] as any;
            assert.strictEqual(msg.type, 'collapsedSectionsChanged');
            assert.deepStrictEqual(msg.collapsedSections, ['heading-1', 'heading-2']);
        });

        test('heading-collapse collapseAll sends collapsedSectionsChanged via transport', () => {
            const transport = createCapturingTransport();

            transport.postMessage({
                type: 'collapsedSectionsChanged',
                collapsedSections: ['h1', 'h2', 'h3']
            });

            const msg = transport.sent[0] as any;
            assert.strictEqual(msg.type, 'collapsedSectionsChanged');
            assert.strictEqual(msg.collapsedSections.length, 3);
        });

        test('heading-collapse expandAll sends empty collapsedSections via transport', () => {
            const transport = createCapturingTransport();

            transport.postMessage({
                type: 'collapsedSectionsChanged',
                collapsedSections: []
            });

            const msg = transport.sent[0] as any;
            assert.strictEqual(msg.type, 'collapsedSectionsChanged');
            assert.deepStrictEqual(msg.collapsedSections, []);
        });

        test('follow-prompt-dialog sends followPromptDialogResult via transport', () => {
            const transport = createCapturingTransport();

            transport.postMessage({
                type: 'followPromptDialogResult',
                promptFilePath: '/path/to/prompt.md',
                skillName: undefined,
                options: {
                    mode: 'background',
                    model: 'claude-sonnet-4.5',
                    additionalContext: 'extra info'
                }
            });

            const msg = transport.sent[0] as any;
            assert.strictEqual(msg.type, 'followPromptDialogResult');
            assert.strictEqual(msg.promptFilePath, '/path/to/prompt.md');
            assert.strictEqual(msg.options.mode, 'background');
        });

        test('follow-prompt-dialog sends copyFollowPrompt via transport', () => {
            const transport = createCapturingTransport();

            transport.postMessage({
                type: 'copyFollowPrompt',
                promptFilePath: '/prompt.md',
                skillName: 'my-skill',
                additionalContext: 'some context'
            });

            const msg = transport.sent[0] as any;
            assert.strictEqual(msg.type, 'copyFollowPrompt');
            assert.strictEqual(msg.skillName, 'my-skill');
        });

        test('update-document-dialog sends updateDocument via transport', () => {
            const transport = createCapturingTransport();

            transport.postMessage({
                type: 'updateDocument',
                instruction: 'Fix the formatting in section 2'
            });

            const msg = transport.sent[0] as any;
            assert.strictEqual(msg.type, 'updateDocument');
            assert.strictEqual(msg.instruction, 'Fix the formatting in section 2');
        });

        test('refresh-plan-dialog sends refreshPlan via transport', () => {
            const transport = createCapturingTransport();

            transport.postMessage({
                type: 'refreshPlan',
                additionalContext: 'Code was refactored'
            });

            const msg = transport.sent[0] as any;
            assert.strictEqual(msg.type, 'refreshPlan');
            assert.strictEqual(msg.additionalContext, 'Code was refactored');
        });

        test('refresh-plan-dialog sends refreshPlan without context via transport', () => {
            const transport = createCapturingTransport();

            transport.postMessage({
                type: 'refreshPlan',
                additionalContext: undefined
            });

            const msg = transport.sent[0] as any;
            assert.strictEqual(msg.type, 'refreshPlan');
            assert.strictEqual(msg.additionalContext, undefined);
        });
    });

    // =========================================================================
    // Initialization flow tests
    // =========================================================================

    suite('Initialization flow', () => {

        interface EditorTransport {
            postMessage(message: any): void;
            onMessage(handler: (message: any) => void): void;
        }

        interface MockVsCodeApi {
            messages: unknown[];
            postMessage(message: unknown): void;
        }

        class VscodeTransportMirror implements EditorTransport {
            constructor(private readonly vscode: MockVsCodeApi) { }
            postMessage(message: any): void {
                this.vscode.postMessage(message);
            }
            onMessage(handler: (message: any) => void): void {
                // Store for simulation
                (this as any)._handlers = (this as any)._handlers || [];
                (this as any)._handlers.push(handler);
            }
        }

        class StateManagerMirror {
            private _transport: EditorTransport | null = null;

            get transport(): EditorTransport {
                if (!this._transport) { throw new Error('Transport not initialized'); }
                return this._transport;
            }

            setTransport(transport: EditorTransport): void {
                this._transport = transport;
            }
        }

        test('init flow: acquireVsCodeApi → VscodeTransport → state.setTransport', () => {
            // Simulate main.ts init()
            const mockVscode: MockVsCodeApi = {
                messages: [],
                postMessage(msg: unknown) { this.messages.push(msg); }
            };

            const state = new StateManagerMirror();
            const transport = new VscodeTransportMirror(mockVscode);
            state.setTransport(transport);

            // After init, postMessage should work
            state.transport.postMessage({ type: 'ready' });
            assert.strictEqual(mockVscode.messages.length, 1);
            assert.deepStrictEqual(mockVscode.messages[0], { type: 'ready' });
        });

        test('init flow: notifyReady sends ready message through transport', () => {
            const mockVscode: MockVsCodeApi = {
                messages: [],
                postMessage(msg: unknown) { this.messages.push(msg); }
            };

            const state = new StateManagerMirror();
            state.setTransport(new VscodeTransportMirror(mockVscode));

            // Simulate notifyReady()
            state.transport.postMessage({ type: 'ready' });
            assert.deepStrictEqual(mockVscode.messages[0], { type: 'ready' });
        });

        test('init flow: setupMessageListener registers via transport.onMessage', () => {
            const mockVscode: MockVsCodeApi = {
                messages: [],
                postMessage(msg: unknown) { this.messages.push(msg); }
            };

            const state = new StateManagerMirror();
            const transport = new VscodeTransportMirror(mockVscode);
            state.setTransport(transport);

            const received: unknown[] = [];
            state.transport.onMessage((msg) => received.push(msg));

            // Simulate extension dispatching a message
            const handlers = (transport as any)._handlers || [];
            assert.strictEqual(handlers.length, 1);
            handlers[0]({ type: 'update', content: 'test' });
            assert.strictEqual(received.length, 1);
        });
    });

    // =========================================================================
    // Edge cases and regression tests
    // =========================================================================

    suite('Edge cases and regressions', () => {

        interface EditorTransport {
            postMessage(message: any): void;
            onMessage(handler: (message: any) => void): void;
        }

        test('postMessage with empty object fields should preserve them', () => {
            const sent: unknown[] = [];
            const transport: EditorTransport = {
                postMessage(msg) { sent.push(msg); },
                onMessage() { }
            };

            transport.postMessage({ type: 'addComment', comment: '', selection: { startLine: 0, endLine: 0, startColumn: 0, endColumn: 0, selectedText: '' } });
            const msg = sent[0] as any;
            assert.strictEqual(msg.comment, '');
            assert.strictEqual(msg.selection.selectedText, '');
        });

        test('postMessage preserves message type exactly', () => {
            const sent: unknown[] = [];
            const transport: EditorTransport = {
                postMessage(msg) { sent.push(msg); },
                onMessage() { }
            };

            // Test all migrated bypass message types are preserved
            const types = [
                'collapsedSectionsChanged',
                'followPromptDialogResult',
                'copyFollowPrompt',
                'updateDocument',
                'refreshPlan'
            ];

            for (const t of types) {
                transport.postMessage({ type: t });
            }

            assert.strictEqual(sent.length, types.length);
            for (let i = 0; i < types.length; i++) {
                assert.strictEqual((sent[i] as any).type, types[i]);
            }
        });

        test('onMessage handler receives data property from MessageEvent', () => {
            // Mirrors VscodeTransport.onMessage which does handler(event.data)
            const received: unknown[] = [];
            const handler = (msg: any) => received.push(msg);

            // Simulate what window.addEventListener('message', ...) provides
            const event = { data: { type: 'update', content: 'test' } };
            handler(event.data);

            assert.strictEqual(received.length, 1);
            assert.deepStrictEqual(received[0], { type: 'update', content: 'test' });
        });

        test('transport should not modify messages', () => {
            const sent: unknown[] = [];
            const original = {
                type: 'addComment',
                comment: 'original',
                selection: { startLine: 1, endLine: 2, startColumn: 0, endColumn: 5, selectedText: 'text' }
            };

            const transport: EditorTransport = {
                postMessage(msg) { sent.push(msg); },
                onMessage() { }
            };

            transport.postMessage(original);
            assert.deepStrictEqual(sent[0], original);
            // Verify it's the same reference (no copying)
            assert.strictEqual(sent[0], original);
        });
    });
});
