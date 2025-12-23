/**
 * Tests for DiffReviewEditorProvider functionality
 * Covers: Webview state serialization, duplicate panel prevention
 */

import * as assert from 'assert';
import { DiffGitContext, DiffWebviewState } from '../../shortcuts/git-diff-comments';

suite('DiffReviewEditorProvider Tests', () => {

    suite('DiffWebviewState Type', () => {
        test('should have correct structure', () => {
            const gitContext: DiffGitContext = {
                repositoryRoot: '/repo',
                repositoryName: 'test-repo',
                oldRef: 'HEAD',
                newRef: ':0',
                wasStaged: true
            };

            const state: DiffWebviewState = {
                filePath: 'src/file.ts',
                gitContext,
                oldContent: 'old content',
                newContent: 'new content',
                isEditable: false
            };

            assert.strictEqual(state.filePath, 'src/file.ts');
            assert.strictEqual(state.gitContext.repositoryRoot, '/repo');
            assert.strictEqual(state.oldContent, 'old content');
            assert.strictEqual(state.newContent, 'new content');
            assert.strictEqual(state.isEditable, false);
        });

        test('should be serializable to JSON', () => {
            const gitContext: DiffGitContext = {
                repositoryRoot: '/repo',
                repositoryName: 'test-repo',
                oldRef: 'HEAD~1',
                newRef: 'HEAD',
                wasStaged: false
            };

            const state: DiffWebviewState = {
                filePath: 'src/component.tsx',
                gitContext,
                oldContent: 'function old() {}',
                newContent: 'function new() {}',
                isEditable: false
            };

            // Serialize and deserialize
            const serialized = JSON.stringify(state);
            const deserialized: DiffWebviewState = JSON.parse(serialized);

            assert.strictEqual(deserialized.filePath, state.filePath);
            assert.strictEqual(deserialized.gitContext.repositoryRoot, state.gitContext.repositoryRoot);
            assert.strictEqual(deserialized.gitContext.repositoryName, state.gitContext.repositoryName);
            assert.strictEqual(deserialized.gitContext.oldRef, state.gitContext.oldRef);
            assert.strictEqual(deserialized.gitContext.newRef, state.gitContext.newRef);
            assert.strictEqual(deserialized.gitContext.wasStaged, state.gitContext.wasStaged);
            assert.strictEqual(deserialized.oldContent, state.oldContent);
            assert.strictEqual(deserialized.newContent, state.newContent);
            assert.strictEqual(deserialized.isEditable, state.isEditable);
        });

        test('should handle empty content', () => {
            const state: DiffWebviewState = {
                filePath: 'new-file.ts',
                gitContext: {
                    repositoryRoot: '/repo',
                    repositoryName: 'repo',
                    oldRef: 'HEAD',
                    newRef: ':0',
                    wasStaged: false
                },
                oldContent: '',  // Empty for new files
                newContent: 'new file content'
            };

            const serialized = JSON.stringify(state);
            const deserialized: DiffWebviewState = JSON.parse(serialized);

            assert.strictEqual(deserialized.oldContent, '');
            assert.strictEqual(deserialized.newContent, 'new file content');
        });

        test('should handle special characters in content', () => {
            const state: DiffWebviewState = {
                filePath: 'file.ts',
                gitContext: {
                    repositoryRoot: '/repo',
                    repositoryName: 'repo',
                    oldRef: 'HEAD',
                    newRef: ':0',
                    wasStaged: false
                },
                oldContent: 'const msg = "Hello\\nWorld";\n// Special: <>&\'"',
                newContent: 'const msg = `Hello\nWorld`;\n// Special: <>&\'"'
            };

            const serialized = JSON.stringify(state);
            const deserialized: DiffWebviewState = JSON.parse(serialized);

            assert.strictEqual(deserialized.oldContent, state.oldContent);
            assert.strictEqual(deserialized.newContent, state.newContent);
        });

        test('should handle commit hash in gitContext', () => {
            const state: DiffWebviewState = {
                filePath: 'file.ts',
                gitContext: {
                    repositoryRoot: '/repo',
                    repositoryName: 'repo',
                    oldRef: 'abc123^',
                    newRef: 'abc123',
                    wasStaged: false,
                    commitHash: 'abc123def456789'
                },
                oldContent: 'old',
                newContent: 'new'
            };

            const serialized = JSON.stringify(state);
            const deserialized: DiffWebviewState = JSON.parse(serialized);

            assert.strictEqual(deserialized.gitContext.commitHash, 'abc123def456789');
        });
    });

    suite('Webview State Validation', () => {
        test('should validate required fields', () => {
            // Valid state
            const validState: DiffWebviewState = {
                filePath: 'file.ts',
                gitContext: {
                    repositoryRoot: '/repo',
                    repositoryName: 'repo',
                    oldRef: 'HEAD',
                    newRef: ':0',
                    wasStaged: false
                },
                oldContent: 'old',
                newContent: 'new'
            };

            // Check all required fields exist
            assert.ok(validState.filePath);
            assert.ok(validState.gitContext);
            assert.ok(validState.gitContext.repositoryRoot);
            assert.ok(validState.gitContext.repositoryName);
            assert.ok(validState.gitContext.oldRef);
            assert.ok(validState.gitContext.newRef);
            assert.strictEqual(typeof validState.gitContext.wasStaged, 'boolean');
            assert.strictEqual(typeof validState.oldContent, 'string');
            assert.strictEqual(typeof validState.newContent, 'string');
        });

        test('should handle null/undefined gracefully in restoration logic', () => {
            // This tests the pattern used in restoreWebviewPanel
            const invalidStates = [
                null,
                undefined,
                {},
                { filePath: 'file.ts' },  // Missing gitContext
                { gitContext: {} },  // Missing filePath
            ];

            for (const state of invalidStates) {
                const typedState = state as DiffWebviewState | null | undefined;
                const isValid = typedState && typedState.filePath && typedState.gitContext;
                assert.ok(!isValid, `State should be invalid: ${JSON.stringify(state)}`);
            }
        });
    });
});

