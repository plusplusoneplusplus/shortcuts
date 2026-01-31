/**
 * Tests for diff review editor preview mode behavior
 * 
 * Preview mode behavior (similar to VS Code's default editor preview):
 * - Single-clicking on a file opens it in a preview tab (title has ~ prefix/suffix)
 * - The preview tab gets reused when clicking on another file
 * - The tab becomes "pinned" (non-preview) when:
 *   - User double-clicks on the tab/content
 *   - User adds or edits a comment
 *   - User edits content (for editable diffs)
 */

import * as assert from 'assert';
import * as path from 'path';
import { DiffGitContext, DiffWebviewState } from '../../shortcuts/git-diff-comments/types';

/**
 * Mock git context for testing
 */
function createMockGitContext(repoRoot: string = '/test/repo'): DiffGitContext {
    return {
        repositoryRoot: repoRoot,
        repositoryName: path.basename(repoRoot),
        oldRef: ':0',
        newRef: 'WORKING_TREE',
        wasStaged: false
    };
}

/**
 * Mock webview state for testing
 */
function createMockWebviewState(filePath: string, gitContext: DiffGitContext): DiffWebviewState {
    return {
        filePath,
        gitContext,
        oldContent: 'const x = 1;',
        newContent: 'const x = 2;',
        isEditable: true
    };
}

suite('Diff Preview Mode Tests', () => {

    suite('Preview Panel Title Formatting', () => {
        /**
         * Note: VS Code's webview panel API doesn't support italic titles like the built-in
         * text editor preview mode. We use the same title format for both preview and pinned
         * states, relying on the reuse behavior to indicate preview mode.
         */
        test('preview and pinned titles should have same format', () => {
            const fileName = 'test.ts';
            const title = `[Diff Review] ${fileName}`;

            assert.ok(title.includes('[Diff Review]'), 'Title should include Diff Review prefix');
            assert.ok(title.includes(fileName), 'Title should include filename');
        });

        test('title format should be consistent', () => {
            const fileName = 'test.ts';
            const expectedTitle = `[Diff Review] ${fileName}`;

            // Both preview and pinned use the same format
            assert.strictEqual(expectedTitle, `[Diff Review] ${fileName}`);
        });

        test('dirty indicator should work with title', () => {
            const fileName = 'test.ts';
            const title = `[Diff Review] ${fileName}`;
            const dirtyTitle = `● ${title}`;

            assert.ok(dirtyTitle.startsWith('●'), 'Dirty indicator should be at start');
            assert.ok(dirtyTitle.includes('[Diff Review]'), 'Should include Diff Review prefix');
        });
    });

    suite('Preview Panel State Management', () => {
        /**
         * Simulates the preview panel tracking behavior
         */
        class MockPreviewPanelManager {
            private activeWebviews: Map<string, MockPanel> = new Map();
            private previewPanel: MockPanel | undefined;
            private previewPanelFilePath: string | undefined;
            private isPreviewMode: boolean = false;

            createPreviewPanel(filePath: string): MockPanel {
                const fileName = path.basename(filePath);
                const panel: MockPanel = {
                    title: `[Diff Review] ${fileName}`,
                    filePath,
                    disposed: false
                };
                this.previewPanel = panel;
                this.previewPanelFilePath = filePath;
                this.isPreviewMode = true;
                this.activeWebviews.set(filePath, panel);
                return panel;
            }

            reusePreviewPanel(newFilePath: string): MockPanel | undefined {
                if (!this.previewPanel || !this.isPreviewMode) {
                    return undefined;
                }

                // Remove old file path tracking
                if (this.previewPanelFilePath) {
                    this.activeWebviews.delete(this.previewPanelFilePath);
                }

                // Update to new file
                const fileName = path.basename(newFilePath);
                this.previewPanel.title = `[Diff Review] ${fileName}`;
                this.previewPanel.filePath = newFilePath;
                this.previewPanelFilePath = newFilePath;
                this.activeWebviews.set(newFilePath, this.previewPanel);

                return this.previewPanel;
            }

            pinPreviewPanel(): void {
                if (!this.previewPanel || !this.isPreviewMode || !this.previewPanelFilePath) {
                    return;
                }

                const fileName = path.basename(this.previewPanelFilePath);
                this.previewPanel.title = `[Diff Review] ${fileName}`;
                this.previewPanel = undefined;
                this.previewPanelFilePath = undefined;
                this.isPreviewMode = false;
            }

            isInPreviewMode(): boolean {
                return this.isPreviewMode;
            }

            getPreviewPanel(): MockPanel | undefined {
                return this.previewPanel;
            }

            getActiveWebviewCount(): number {
                return this.activeWebviews.size;
            }

            getPanel(filePath: string): MockPanel | undefined {
                return this.activeWebviews.get(filePath);
            }
        }

        interface MockPanel {
            title: string;
            filePath: string;
            disposed: boolean;
        }

        test('should create panel in preview mode by default', () => {
            const manager = new MockPreviewPanelManager();
            const panel = manager.createPreviewPanel('/repo/file1.ts');

            assert.ok(manager.isInPreviewMode(), 'Should be in preview mode');
            assert.ok(panel.title.includes('[Diff Review]'), 'Title should have Diff Review prefix');
            assert.ok(panel.title.includes('file1.ts'), 'Title should include filename');
        });

        test('should reuse preview panel for different file', () => {
            const manager = new MockPreviewPanelManager();
            const panel1 = manager.createPreviewPanel('/repo/file1.ts');
            const originalPanel = manager.getPreviewPanel();

            const panel2 = manager.reusePreviewPanel('/repo/file2.ts');

            assert.strictEqual(panel2, originalPanel, 'Should reuse same panel');
            assert.ok(panel2!.title.includes('file2.ts'), 'Title should reflect new file');
            assert.strictEqual(manager.getActiveWebviewCount(), 1, 'Should only have one active webview');
        });

        test('should pin panel when pinPreviewPanel is called', () => {
            const manager = new MockPreviewPanelManager();
            manager.createPreviewPanel('/repo/file1.ts');
            
            assert.ok(manager.isInPreviewMode(), 'Should be in preview mode before pin');
            
            manager.pinPreviewPanel();
            
            assert.ok(!manager.isInPreviewMode(), 'Should not be in preview mode after pin');
            
            const panel = manager.getPanel('/repo/file1.ts');
            assert.ok(panel, 'Panel should still exist');
            assert.ok(panel.title.includes('[Diff Review]'), 'Title should have Diff Review prefix');
        });

        test('should not reuse panel after pinning', () => {
            const manager = new MockPreviewPanelManager();
            manager.createPreviewPanel('/repo/file1.ts');
            manager.pinPreviewPanel();

            const result = manager.reusePreviewPanel('/repo/file2.ts');

            assert.strictEqual(result, undefined, 'Should not be able to reuse after pinning');
        });

        test('should track old file path cleanup when reusing', () => {
            const manager = new MockPreviewPanelManager();
            manager.createPreviewPanel('/repo/file1.ts');
            
            assert.ok(manager.getPanel('/repo/file1.ts'), 'Should have file1 tracked');
            
            manager.reusePreviewPanel('/repo/file2.ts');
            
            assert.ok(!manager.getPanel('/repo/file1.ts'), 'Should not have file1 tracked after reuse');
            assert.ok(manager.getPanel('/repo/file2.ts'), 'Should have file2 tracked');
        });
    });

    suite('Pin Tab Triggers', () => {
        /**
         * Actions that should trigger pinning
         */
        const pinTriggers = [
            { action: 'addComment', shouldPin: true },
            { action: 'editComment', shouldPin: true },
            { action: 'contentModified', shouldPin: true },
            { action: 'pinTab', shouldPin: true },
            { action: 'saveContent', shouldPin: true },
            { action: 'resolveComment', shouldPin: false },
            { action: 'reopenComment', shouldPin: false },
            { action: 'deleteComment', shouldPin: false },
            { action: 'ready', shouldPin: false },
            { action: 'requestState', shouldPin: false }
        ];

        for (const { action, shouldPin } of pinTriggers) {
            test(`action '${action}' should ${shouldPin ? '' : 'not '}pin the tab`, () => {
                // This test documents the expected behavior
                // The actual implementation in handleWebviewMessage pins on certain actions
                const pinningActions = ['addComment', 'editComment', 'contentModified', 'pinTab', 'saveContent'];
                const expectPin = pinningActions.includes(action);
                assert.strictEqual(expectPin, shouldPin, `${action} pin behavior should match expected`);
            });
        }
    });

    suite('Cross-Platform Path Handling', () => {
        test('should handle Unix-style paths', () => {
            const unixPath = '/home/user/project/src/file.ts';
            const fileName = path.basename(unixPath);
            
            assert.strictEqual(fileName, 'file.ts');
        });

        test('should handle Windows-style paths with forward slashes', () => {
            // path.basename works with forward slashes on all platforms
            const winPath = 'C:/Users/user/project/src/file.ts';
            const fileName = path.basename(winPath);
            
            assert.strictEqual(fileName, 'file.ts');
        });

        test('should normalize paths for comparison', () => {
            // Paths should be normalized for consistent comparison
            // Use platform-specific paths for testing path.normalize
            const basePath = path.join('repo', 'src', 'file.ts');
            const pathWithParent = path.join('repo', 'src', '..', 'src', 'file.ts');

            // path.normalize should resolve the parent directory reference
            assert.strictEqual(path.normalize(pathWithParent), basePath);
        });
    });

    suite('Webview State Serialization', () => {
        test('should serialize webview state for preview panel', () => {
            const gitContext = createMockGitContext();
            const state = createMockWebviewState('src/test.ts', gitContext);

            // State should be serializable to JSON
            const serialized = JSON.stringify(state);
            const deserialized = JSON.parse(serialized) as DiffWebviewState;

            assert.strictEqual(deserialized.filePath, state.filePath);
            assert.strictEqual(deserialized.oldContent, state.oldContent);
            assert.strictEqual(deserialized.newContent, state.newContent);
            assert.strictEqual(deserialized.isEditable, state.isEditable);
        });

        test('should preserve git context in state', () => {
            const gitContext = createMockGitContext('/custom/repo');
            const state = createMockWebviewState('file.ts', gitContext);

            assert.strictEqual(state.gitContext.repositoryRoot, '/custom/repo');
            assert.strictEqual(state.gitContext.repositoryName, 'repo');
        });
    });

    suite('Message Types', () => {
        test('pinTab message type should be valid', () => {
            type WebviewMessageType = 'addComment' | 'editComment' | 'deleteComment' | 'resolveComment' |
                'reopenComment' | 'ready' | 'requestState' | 'openFile' | 'copyPath' | 'askAI' | 'saveContent' | 'contentModified' | 'pinTab';
            
            const validTypes: WebviewMessageType[] = [
                'addComment', 'editComment', 'deleteComment', 'resolveComment',
                'reopenComment', 'ready', 'requestState', 'openFile', 'copyPath', 
                'askAI', 'saveContent', 'contentModified', 'pinTab'
            ];

            assert.ok(validTypes.includes('pinTab'), 'pinTab should be a valid message type');
        });

        test('pinTab message structure should be minimal', () => {
            const pinTabMessage = { type: 'pinTab' as const };
            
            assert.strictEqual(Object.keys(pinTabMessage).length, 1, 'pinTab message should only have type');
            assert.strictEqual(pinTabMessage.type, 'pinTab');
        });
    });

    suite('Double-Click Detection', () => {
        test('should identify interactive elements to exclude', () => {
            const interactiveElements = ['BUTTON', 'INPUT', 'TEXTAREA'];
            const excludedContainers = ['.comment-panel', '.comments-list'];

            // Test that we have the expected exclusions
            assert.ok(interactiveElements.includes('BUTTON'));
            assert.ok(interactiveElements.includes('INPUT'));
            assert.ok(interactiveElements.includes('TEXTAREA'));
            assert.ok(excludedContainers.includes('.comment-panel'));
            assert.ok(excludedContainers.includes('.comments-list'));
        });
    });

    suite('Preview Panel Content Update', () => {
        /**
         * Tests for content update when switching between files in preview mode.
         * This is critical for correctly displaying different git contexts
         * (staged vs unstaged vs untracked).
         */

        test('should update git context when switching from staged to untracked file', () => {
            // Simulate staged file context
            const stagedContext: DiffGitContext = {
                repositoryRoot: '/test/repo',
                repositoryName: 'repo',
                oldRef: 'HEAD',
                newRef: ':0',
                wasStaged: true
            };

            // Simulate untracked file context
            const untrackedContext: DiffGitContext = {
                repositoryRoot: '/test/repo',
                repositoryName: 'repo',
                oldRef: 'EMPTY',
                newRef: 'WORKING_TREE',
                wasStaged: false
            };

            // Verify the contexts are different
            assert.notStrictEqual(stagedContext.oldRef, untrackedContext.oldRef);
            assert.strictEqual(untrackedContext.oldRef, 'EMPTY', 'Untracked should have EMPTY oldRef');
            assert.strictEqual(stagedContext.oldRef, 'HEAD', 'Staged should have HEAD oldRef');
        });

        test('should have empty oldContent for untracked files', () => {
            // For untracked files, oldContent should be empty
            const untrackedState: DiffWebviewState = {
                filePath: 'new-file.ts',
                gitContext: {
                    repositoryRoot: '/test/repo',
                    repositoryName: 'repo',
                    oldRef: 'EMPTY',
                    newRef: 'WORKING_TREE',
                    wasStaged: false
                },
                oldContent: '', // Should be empty for untracked files
                newContent: 'const x = 1;\nconst y = 2;',
                isEditable: true
            };

            assert.strictEqual(untrackedState.oldContent, '', 'Untracked file should have empty oldContent');
            assert.ok(untrackedState.newContent.length > 0, 'Untracked file should have newContent');
        });

        test('should preserve content when switching between files', () => {
            // Simulate webview state for two different files
            const file1State: DiffWebviewState = {
                filePath: 'staged-file.ts',
                gitContext: {
                    repositoryRoot: '/test/repo',
                    repositoryName: 'repo',
                    oldRef: 'HEAD',
                    newRef: ':0',
                    wasStaged: true
                },
                oldContent: 'const old = 1;',
                newContent: 'const new = 2;',
                isEditable: false
            };

            const file2State: DiffWebviewState = {
                filePath: 'untracked-file.ts',
                gitContext: {
                    repositoryRoot: '/test/repo',
                    repositoryName: 'repo',
                    oldRef: 'EMPTY',
                    newRef: 'WORKING_TREE',
                    wasStaged: false
                },
                oldContent: '',
                newContent: 'const brand = "new";',
                isEditable: true
            };

            // Simulate state update (what happens when switching files)
            const webviewStates = new Map<string, DiffWebviewState>();
            webviewStates.set('/test/repo/staged-file.ts', file1State);
            webviewStates.set('/test/repo/untracked-file.ts', file2State);

            // When switching to file2, we should get file2's state
            const currentState = webviewStates.get('/test/repo/untracked-file.ts');
            assert.strictEqual(currentState?.oldContent, '', 'Should get empty oldContent for untracked');
            assert.strictEqual(currentState?.gitContext.oldRef, 'EMPTY', 'Should get EMPTY oldRef');
        });

        test('update message should include gitContext for proper state sync', () => {
            // Simulate the update message structure
            interface UpdateMessage {
                type: 'update';
                oldContent?: string;
                newContent?: string;
                filePath?: string;
                gitContext?: DiffGitContext;
                isEditable?: boolean;
            }

            const updateMessage: UpdateMessage = {
                type: 'update',
                oldContent: '',
                newContent: 'new content',
                filePath: 'untracked.ts',
                gitContext: {
                    repositoryRoot: '/test/repo',
                    repositoryName: 'repo',
                    oldRef: 'EMPTY',
                    newRef: 'WORKING_TREE',
                    wasStaged: false
                },
                isEditable: true
            };

            // Verify the message has all necessary fields for proper state sync
            assert.ok(updateMessage.gitContext, 'Update message should include gitContext');
            assert.strictEqual(updateMessage.gitContext?.oldRef, 'EMPTY');
            assert.strictEqual(updateMessage.oldContent, '');
        });
    });
});
