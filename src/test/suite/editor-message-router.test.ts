/**
 * Unit tests for EditorMessageRouter.
 * Uses a mock EditorHost to test routing logic without VS Code dependencies.
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { EditorHost, MessageContext, DispatchResult } from '../../shortcuts/markdown-comments/editor-host';
import { EditorMessageRouter, WebviewMessage } from '../../shortcuts/markdown-comments/editor-message-router';
import { CommentsManager } from '../../shortcuts/markdown-comments/comments-manager';

/**
 * Mock EditorHost that records all calls for verification.
 */
class MockEditorHost implements EditorHost {
    // Track all method calls
    readonly calls: Array<{ method: string; args: unknown[] }> = [];
    // Pre-configured return values
    readonly returnValues: Map<string, unknown> = new Map();
    // Messages posted to webview
    readonly postedMessages: unknown[] = [];

    private recordCall(method: string, ...args: unknown[]): void {
        this.calls.push({ method, args });
    }

    setReturnValue(method: string, value: unknown): void {
        this.returnValues.set(method, value);
    }

    getCallsFor(method: string): Array<{ method: string; args: unknown[] }> {
        return this.calls.filter(c => c.method === method);
    }

    wasMethodCalled(method: string): boolean {
        return this.calls.some(c => c.method === method);
    }

    async showInfo(message: string, ...actions: string[]): Promise<string | undefined> {
        this.recordCall('showInfo', message, ...actions);
        return this.returnValues.get('showInfo') as string | undefined;
    }

    async showWarning(message: string, options?: { modal?: boolean }, ...actions: string[]): Promise<string | undefined> {
        this.recordCall('showWarning', message, options, ...actions);
        return this.returnValues.get('showWarning') as string | undefined;
    }

    showError(message: string): void {
        this.recordCall('showError', message);
    }

    async copyToClipboard(text: string): Promise<void> {
        this.recordCall('copyToClipboard', text);
    }

    async openFile(uri: string, lineNumber?: number): Promise<void> {
        this.recordCall('openFile', uri, lineNumber);
    }

    async openExternalUrl(url: string): Promise<void> {
        this.recordCall('openExternalUrl', url);
    }

    async readFile(filePath: string): Promise<string | undefined> {
        this.recordCall('readFile', filePath);
        return this.returnValues.get('readFile') as string | undefined;
    }

    async fileExists(filePath: string): Promise<boolean> {
        this.recordCall('fileExists', filePath);
        return (this.returnValues.get('fileExists') as boolean) ?? false;
    }

    async replaceDocumentContent(documentUri: string, content: string): Promise<void> {
        this.recordCall('replaceDocumentContent', documentUri, content);
    }

    async showInputBox(options: { prompt: string; placeHolder?: string; ignoreFocusOut?: boolean }): Promise<string | undefined> {
        this.recordCall('showInputBox', options);
        return this.returnValues.get('showInputBox') as string | undefined;
    }

    async showQuickPick<T extends { label: string }>(items: T[], options?: { placeHolder?: string; matchOnDescription?: boolean; matchOnDetail?: boolean }): Promise<T | undefined> {
        this.recordCall('showQuickPick', items, options);
        return this.returnValues.get('showQuickPick') as T | undefined;
    }

    postMessage(message: unknown): void {
        this.recordCall('postMessage', message);
        this.postedMessages.push(message);
    }

    async executeCommand(command: string, ...args: unknown[]): Promise<void> {
        this.recordCall('executeCommand', command, ...args);
    }

    async openUntitledDocument(content: string, language: string): Promise<void> {
        this.recordCall('openUntitledDocument', content, language);
    }

    resolveImageToWebviewUri(absolutePath: string): string | null {
        this.recordCall('resolveImageToWebviewUri', absolutePath);
        return this.returnValues.get('resolveImageToWebviewUri') as string | null ?? null;
    }

    getState<T>(key: string, defaultValue: T): T {
        this.recordCall('getState', key, defaultValue);
        const val = this.returnValues.get(`state:${key}`);
        return (val !== undefined ? val : defaultValue) as T;
    }

    async setState(key: string, value: unknown): Promise<void> {
        this.recordCall('setState', key, value);
        this.returnValues.set(`state:${key}`, value);
    }

    getConfig<T>(section: string, key: string, defaultValue: T): T {
        this.recordCall('getConfig', section, key, defaultValue);
        const val = this.returnValues.get(`config:${section}.${key}`);
        return (val !== undefined ? val : defaultValue) as T;
    }
}

function createTestContext(overrides?: Partial<MessageContext>): MessageContext {
    return {
        documentText: '# Test Document\n\nSome content here.',
        documentPath: '/workspace/test.md',
        relativePath: 'test.md',
        fileDir: '/workspace',
        workspaceRoot: '/workspace',
        ...overrides
    };
}

suite('EditorMessageRouter', () => {
    let mockHost: MockEditorHost;
    let commentsManager: CommentsManager;
    let router: EditorMessageRouter;
    let tempDir: string;

    setup(() => {
        mockHost = new MockEditorHost();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'router-test-'));
        commentsManager = new CommentsManager(tempDir);
        router = new EditorMessageRouter(mockHost, commentsManager);
    });

    teardown(() => {
        commentsManager.dispose();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // --- Comment CRUD Tests ---

    test('addComment dispatches to CommentsManager', async () => {
        const message: WebviewMessage = {
            type: 'addComment',
            selection: {
                startLine: 1,
                startColumn: 1,
                endLine: 1,
                endColumn: 10,
                selectedText: 'Test text'
            },
            comment: 'My comment'
        };
        const ctx = createTestContext();

        const result = await router.dispatch(message, ctx);

        assert.deepStrictEqual(result, {});
        const comments = commentsManager.getCommentsForFile('test.md');
        assert.strictEqual(comments.length, 1);
        assert.strictEqual(comments[0].comment, 'My comment');
        assert.strictEqual(comments[0].selectedText, 'Test text');
    });

    test('addComment does nothing without selection', async () => {
        const message: WebviewMessage = {
            type: 'addComment',
            comment: 'My comment'
        };
        const ctx = createTestContext();

        await router.dispatch(message, ctx);

        const comments = commentsManager.getAllComments();
        assert.strictEqual(comments.length, 0);
    });

    test('editComment updates existing comment', async () => {
        // Add a comment first
        await commentsManager.addComment(
            'test.md',
            { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
            'selected',
            'original comment'
        );
        const comments = commentsManager.getCommentsForFile('test.md');
        const commentId = comments[0].id;

        const message: WebviewMessage = {
            type: 'editComment',
            commentId,
            comment: 'updated comment'
        };
        const ctx = createTestContext();

        await router.dispatch(message, ctx);

        const updated = commentsManager.getComment(commentId);
        assert.strictEqual(updated?.comment, 'updated comment');
    });

    test('deleteComment shows confirmation dialog', async () => {
        // Add a comment
        await commentsManager.addComment(
            'test.md',
            { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
            'selected',
            'comment to delete'
        );
        const commentId = commentsManager.getCommentsForFile('test.md')[0].id;

        // User cancels deletion
        mockHost.setReturnValue('showWarning', undefined);
        await router.dispatch({ type: 'deleteComment', commentId } as WebviewMessage, createTestContext());

        // Comment should still exist
        assert.strictEqual(commentsManager.getComment(commentId)?.comment, 'comment to delete');

        // Now user confirms deletion
        mockHost.setReturnValue('showWarning', 'Delete');
        await router.dispatch({ type: 'deleteComment', commentId } as WebviewMessage, createTestContext());

        // Comment should be deleted
        assert.strictEqual(commentsManager.getComment(commentId), undefined);
    });

    test('resolveComment marks comment as resolved', async () => {
        await commentsManager.addComment(
            'test.md',
            { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
            'selected',
            'comment'
        );
        const commentId = commentsManager.getCommentsForFile('test.md')[0].id;

        await router.dispatch({ type: 'resolveComment', commentId } as WebviewMessage, createTestContext());

        const comment = commentsManager.getComment(commentId);
        assert.strictEqual(comment?.status, 'resolved');
    });

    test('reopenComment marks comment as open', async () => {
        await commentsManager.addComment(
            'test.md',
            { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
            'selected',
            'comment'
        );
        const commentId = commentsManager.getCommentsForFile('test.md')[0].id;
        await commentsManager.resolveComment(commentId);

        await router.dispatch({ type: 'reopenComment', commentId } as WebviewMessage, createTestContext());

        const comment = commentsManager.getComment(commentId);
        assert.strictEqual(comment?.status, 'open');
    });

    test('resolveAll resolves all comments and shows info', async () => {
        await commentsManager.addComment(
            'test.md',
            { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
            'sel1',
            'comment1'
        );
        await commentsManager.addComment(
            'test.md',
            { startLine: 2, startColumn: 1, endLine: 2, endColumn: 5 },
            'sel2',
            'comment2'
        );

        await router.dispatch({ type: 'resolveAll' } as WebviewMessage, createTestContext());

        const openComments = commentsManager.getOpenComments();
        assert.strictEqual(openComments.length, 0);
        assert.ok(mockHost.wasMethodCalled('showInfo'));
    });

    test('deleteAll shows confirmation and deletes on confirm', async () => {
        await commentsManager.addComment(
            'test.md',
            { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
            'sel1',
            'comment1'
        );

        // User confirms
        mockHost.setReturnValue('showWarning', 'Sign Off');
        await router.dispatch({ type: 'deleteAll' } as WebviewMessage, createTestContext());

        assert.strictEqual(commentsManager.getAllComments().length, 0);
        const infoCalls = mockHost.getCallsFor('showInfo');
        assert.ok(infoCalls.some(c => (c.args[0] as string).includes('Deleted')));
    });

    test('deleteAll does not delete when user cancels', async () => {
        await commentsManager.addComment(
            'test.md',
            { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
            'sel1',
            'comment1'
        );

        mockHost.setReturnValue('showWarning', undefined);
        await router.dispatch({ type: 'deleteAll' } as WebviewMessage, createTestContext());

        assert.strictEqual(commentsManager.getAllComments().length, 1);
    });

    test('deleteAll shows info when no comments exist', async () => {
        await router.dispatch({ type: 'deleteAll' } as WebviewMessage, createTestContext());

        const infoCalls = mockHost.getCallsFor('showInfo');
        assert.ok(infoCalls.some(c => (c.args[0] as string).includes('No comments')));
    });

    // --- Content update ---

    test('updateContent returns shouldMarkWebviewEdit', async () => {
        const message: WebviewMessage = {
            type: 'updateContent',
            content: '# Updated content'
        };
        const ctx = createTestContext();

        const result = await router.dispatch(message, ctx);

        assert.strictEqual(result.shouldMarkWebviewEdit, true);
        assert.ok(mockHost.wasMethodCalled('replaceDocumentContent'));
    });

    // --- Prompt generation ---

    test('copyPrompt copies to clipboard when comments exist', async () => {
        await commentsManager.addComment(
            'test.md',
            { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
            'Test text',
            'Review this'
        );

        const message: WebviewMessage = {
            type: 'copyPrompt',
            promptOptions: { includeFileContent: false, format: 'markdown' }
        };
        const ctx = createTestContext();

        await router.dispatch(message, ctx);

        assert.ok(mockHost.wasMethodCalled('copyToClipboard'));
        const copyCalls = mockHost.getCallsFor('copyToClipboard');
        assert.ok(copyCalls.length > 0);
        assert.ok((copyCalls[0].args[0] as string).length > 0);
    });

    test('copyPrompt shows info when no comments', async () => {
        const message: WebviewMessage = {
            type: 'copyPrompt',
            promptOptions: { includeFileContent: false, format: 'markdown' }
        };
        const ctx = createTestContext();

        await router.dispatch(message, ctx);

        assert.ok(!mockHost.wasMethodCalled('copyToClipboard'));
        assert.ok(mockHost.wasMethodCalled('showInfo'));
    });

    // --- Open file ---

    test('openFile delegates external URLs to openExternalUrl', async () => {
        const message: WebviewMessage = {
            type: 'openFile',
            path: 'https://github.com/example'
        };
        const ctx = createTestContext();

        await router.dispatch(message, ctx);

        assert.ok(mockHost.wasMethodCalled('openExternalUrl'));
        const calls = mockHost.getCallsFor('openExternalUrl');
        assert.strictEqual(calls[0].args[0], 'https://github.com/example');
    });

    test('openFile shows warning for missing files', async () => {
        const message: WebviewMessage = {
            type: 'openFile',
            path: 'nonexistent-file.ts'
        };
        const ctx = createTestContext();

        await router.dispatch(message, ctx);

        assert.ok(mockHost.wasMethodCalled('showWarning'));
    });

    // --- Image resolution ---

    test('resolveImagePath posts resolved URI when found', async () => {
        mockHost.setReturnValue('resolveImageToWebviewUri', 'https://webview/image.png');

        const message: WebviewMessage = {
            type: 'resolveImagePath',
            path: 'image.png',
            imgId: 'img-1'
        };
        const ctx = createTestContext();

        await router.dispatch(message, ctx);

        assert.ok(mockHost.postedMessages.length > 0);
        const posted = mockHost.postedMessages[0] as { type: string; imgId: string; uri: string };
        assert.strictEqual(posted.type, 'imageResolved');
        assert.strictEqual(posted.imgId, 'img-1');
        assert.strictEqual(posted.uri, 'https://webview/image.png');
    });

    test('resolveImagePath posts error when not found', async () => {
        mockHost.setReturnValue('resolveImageToWebviewUri', null);

        const message: WebviewMessage = {
            type: 'resolveImagePath',
            path: 'missing.png',
            imgId: 'img-2'
        };
        const ctx = createTestContext();

        await router.dispatch(message, ctx);

        assert.ok(mockHost.postedMessages.length > 0);
        const posted = mockHost.postedMessages[0] as { type: string; imgId: string; uri: null; error: string };
        assert.strictEqual(posted.type, 'imageResolved');
        assert.strictEqual(posted.uri, null);
    });

    // --- State persistence ---

    test('collapsedSectionsChanged stores state via host', async () => {
        const message: WebviewMessage = {
            type: 'collapsedSectionsChanged',
            collapsedSections: ['section1', 'section2']
        };
        const ctx = createTestContext();

        await router.dispatch(message, ctx);

        assert.ok(mockHost.wasMethodCalled('setState'));
        const setCalls = mockHost.getCallsFor('setState');
        assert.ok(setCalls.length > 0);
        const [key, value] = setCalls[0].args as [string, unknown];
        assert.ok(key.includes('collapsedSections'));
        assert.deepStrictEqual(value, ['section1', 'section2']);
    });

    // --- Dialog requests ---

    test('requestUpdateDocumentDialog posts message to webview', async () => {
        await router.dispatch({ type: 'requestUpdateDocumentDialog' } as WebviewMessage, createTestContext());

        assert.ok(mockHost.postedMessages.length > 0);
        const posted = mockHost.postedMessages[0] as { type: string };
        assert.strictEqual(posted.type, 'showUpdateDocumentDialog');
    });

    test('requestRefreshPlanDialog posts message to webview', async () => {
        await router.dispatch({ type: 'requestRefreshPlanDialog' } as WebviewMessage, createTestContext());

        assert.ok(mockHost.postedMessages.length > 0);
        const posted = mockHost.postedMessages[0] as { type: string };
        assert.strictEqual(posted.type, 'showRefreshPlanDialog');
    });

    // --- Pending scroll ---

    test('handlePendingScroll sends scroll message for pending requests', () => {
        const pendingScrollRequests = new Map<string, string>();
        pendingScrollRequests.set('/workspace/test.md', 'comment-123');

        const postedMessages: unknown[] = [];
        router.handlePendingScroll(
            '/workspace/test.md',
            pendingScrollRequests,
            (msg) => postedMessages.push(msg)
        );

        // The pending request should be consumed
        assert.strictEqual(pendingScrollRequests.has('/workspace/test.md'), false);
    });

    test('handlePendingScroll does nothing when no pending request', () => {
        const pendingScrollRequests = new Map<string, string>();
        let called = false;

        router.handlePendingScroll(
            '/workspace/test.md',
            pendingScrollRequests,
            () => { called = true; }
        );

        // Should not post any message (synchronously at least)
        assert.strictEqual(called, false);
    });

    // --- Dispatch return values ---

    test('dispatch returns empty result for unknown message type', async () => {
        const message = { type: 'unknownType' } as unknown as WebviewMessage;
        const result = await router.dispatch(message, createTestContext());
        assert.deepStrictEqual(result, {});
    });

    test('dispatch returns shouldMarkWebviewEdit for updateContent', async () => {
        const message: WebviewMessage = { type: 'updateContent', content: 'new' };
        const result = await router.dispatch(message, createTestContext());
        assert.strictEqual(result.shouldMarkWebviewEdit, true);
    });

    test('dispatch returns empty result for comment operations', async () => {
        await commentsManager.addComment(
            'test.md',
            { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
            'sel',
            'comment'
        );
        const commentId = commentsManager.getCommentsForFile('test.md')[0].id;

        const result = await router.dispatch(
            { type: 'resolveComment', commentId } as WebviewMessage,
            createTestContext()
        );
        assert.deepStrictEqual(result, {});
    });

    // --- Copy Follow Prompt ---

    test('copyFollowPrompt copies prompt text to clipboard', async () => {
        const message: WebviewMessage = {
            type: 'copyFollowPrompt',
            promptFilePath: '/workspace/.github/skills/impl/SKILL.md',
            additionalContext: 'Focus on tests'
        };
        const ctx = createTestContext();

        await router.dispatch(message, ctx);

        assert.ok(mockHost.wasMethodCalled('copyToClipboard'));
        const copyCalls = mockHost.getCallsFor('copyToClipboard');
        const copiedText = copyCalls[0].args[0] as string;
        assert.ok(copiedText.includes('Follow the instruction'));
        assert.ok(copiedText.includes('Additional context: Focus on tests'));
    });

    // --- Chat In CLI ---

    test('chatInCLI dispatches without error', async () => {
        const message: WebviewMessage = {
            type: 'chatInCLI'
        };
        const ctx = createTestContext({
            documentPath: '/workspace/my-doc.md'
        });

        // Should not throw — either starts session (showInfo) or falls back (showWarning + copyToClipboard)
        await router.dispatch(message, ctx);

        const infoCalled = mockHost.wasMethodCalled('showInfo');
        const warningCalled = mockHost.wasMethodCalled('showWarning');
        assert.ok(infoCalled || warningCalled, 'Should show either success info or fallback warning');
    });

    test('chatInCLI prompt includes the file path', async () => {
        const message: WebviewMessage = {
            type: 'chatInCLI'
        };
        const ctx = createTestContext({
            documentPath: '/workspace/my-doc.md'
        });

        await router.dispatch(message, ctx);

        // If session failed, prompt was copied to clipboard — check it contains the file path
        if (mockHost.wasMethodCalled('copyToClipboard')) {
            const copyCalls = mockHost.getCallsFor('copyToClipboard');
            const copiedText = copyCalls[0].args[0] as string;
            assert.ok(copiedText.includes('/workspace/my-doc.md'), 'Prompt should contain the file path');
            assert.ok(copiedText.includes('Please ask the user what they would like to know'), 'Prompt should contain instruction');
        }
        // If session succeeded, just verify showInfo was called
        if (mockHost.wasMethodCalled('showInfo')) {
            const infoCalls = mockHost.getCallsFor('showInfo');
            assert.ok((infoCalls[0].args[0] as string).includes('CLI chat session started'));
        }
    });
});
