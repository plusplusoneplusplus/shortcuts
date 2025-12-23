/**
 * Tests for diff view dirty state indicator (dot in tab title)
 * Covers: contentModified message handling and tab title updates
 */

import * as assert from 'assert';
import { DiffWebviewMessage } from '../../shortcuts/git-diff-comments';

suite('Diff Dirty Indicator Tests', () => {

    suite('DiffWebviewMessage with contentModified', () => {
        test('should include contentModified type in message union', () => {
            const message: DiffWebviewMessage = {
                type: 'contentModified',
                isDirty: true
            };

            assert.strictEqual(message.type, 'contentModified');
            assert.strictEqual(message.isDirty, true);
        });

        test('should allow isDirty to be false', () => {
            const message: DiffWebviewMessage = {
                type: 'contentModified',
                isDirty: false
            };

            assert.strictEqual(message.isDirty, false);
        });

        test('should be serializable', () => {
            const message: DiffWebviewMessage = {
                type: 'contentModified',
                isDirty: true
            };

            const serialized = JSON.stringify(message);
            const deserialized: DiffWebviewMessage = JSON.parse(serialized);

            assert.strictEqual(deserialized.type, 'contentModified');
            assert.strictEqual(deserialized.isDirty, true);
        });
    });

    suite('Tab Title Update Logic', () => {
        /**
         * Simulates the updateTabTitle logic from diff-review-editor-provider.ts
         */
        function updateTabTitle(
            originalTitle: string,
            isDirty: boolean
        ): string {
            if (isDirty) {
                return `● ${originalTitle}`;
            }
            return originalTitle;
        }

        test('should add dot prefix when dirty', () => {
            const originalTitle = '[Diff Review] file.ts';
            const result = updateTabTitle(originalTitle, true);
            assert.strictEqual(result, '● [Diff Review] file.ts');
        });

        test('should not add dot when not dirty', () => {
            const originalTitle = '[Diff Review] file.ts';
            const result = updateTabTitle(originalTitle, false);
            assert.strictEqual(result, '[Diff Review] file.ts');
        });

        test('should restore original title when saving', () => {
            const originalTitle = '[Diff Review] file.ts';
            
            // First mark as dirty
            let currentTitle = updateTabTitle(originalTitle, true);
            assert.strictEqual(currentTitle, '● [Diff Review] file.ts');
            
            // Then save (mark as not dirty)
            currentTitle = updateTabTitle(originalTitle, false);
            assert.strictEqual(currentTitle, '[Diff Review] file.ts');
        });

        test('should handle file names with special characters', () => {
            const originalTitle = '[Diff Review] my-file_v2.0.ts';
            const result = updateTabTitle(originalTitle, true);
            assert.strictEqual(result, '● [Diff Review] my-file_v2.0.ts');
        });

        test('should handle file paths with directories', () => {
            const originalTitle = '[Diff Review] src/components/Button.tsx';
            const result = updateTabTitle(originalTitle, true);
            assert.strictEqual(result, '● [Diff Review] src/components/Button.tsx');
        });
    });

    suite('Dirty State Tracking', () => {
        /**
         * Simulates the dirty state tracking in diff-review-editor-provider.ts
         */
        class MockDirtyStateTracker {
            private dirtyStates: Map<string, boolean> = new Map();
            private originalTitles: Map<string, string> = new Map();

            setDirty(filePath: string, originalTitle: string, isDirty: boolean): string {
                // Store original title if not already stored
                if (!this.originalTitles.has(filePath)) {
                    this.originalTitles.set(filePath, originalTitle);
                }

                const storedOriginal = this.originalTitles.get(filePath)!;
                this.dirtyStates.set(filePath, isDirty);

                if (isDirty) {
                    return `● ${storedOriginal}`;
                }
                return storedOriginal;
            }

            isDirty(filePath: string): boolean {
                return this.dirtyStates.get(filePath) ?? false;
            }

            cleanup(filePath: string): void {
                this.dirtyStates.delete(filePath);
                this.originalTitles.delete(filePath);
            }
        }

        test('should track dirty state per file', () => {
            const tracker = new MockDirtyStateTracker();

            tracker.setDirty('/path/to/file1.ts', '[Diff Review] file1.ts', true);
            tracker.setDirty('/path/to/file2.ts', '[Diff Review] file2.ts', false);

            assert.strictEqual(tracker.isDirty('/path/to/file1.ts'), true);
            assert.strictEqual(tracker.isDirty('/path/to/file2.ts'), false);
        });

        test('should preserve original title across multiple dirty state changes', () => {
            const tracker = new MockDirtyStateTracker();
            const filePath = '/path/to/file.ts';
            const originalTitle = '[Diff Review] file.ts';

            // Mark dirty
            let title = tracker.setDirty(filePath, originalTitle, true);
            assert.strictEqual(title, '● [Diff Review] file.ts');

            // Mark clean
            title = tracker.setDirty(filePath, '● [Diff Review] file.ts', false);
            assert.strictEqual(title, '[Diff Review] file.ts', 'Should restore original title');

            // Mark dirty again
            title = tracker.setDirty(filePath, '[Diff Review] file.ts', true);
            assert.strictEqual(title, '● [Diff Review] file.ts');
        });

        test('should cleanup state when panel is disposed', () => {
            const tracker = new MockDirtyStateTracker();
            const filePath = '/path/to/file.ts';

            tracker.setDirty(filePath, '[Diff Review] file.ts', true);
            assert.strictEqual(tracker.isDirty(filePath), true);

            tracker.cleanup(filePath);
            assert.strictEqual(tracker.isDirty(filePath), false);
        });

        test('should handle multiple panels independently', () => {
            const tracker = new MockDirtyStateTracker();

            const file1 = '/path/to/file1.ts';
            const file2 = '/path/to/file2.ts';

            tracker.setDirty(file1, '[Diff Review] file1.ts', true);
            tracker.setDirty(file2, '[Diff Review] file2.ts', true);

            // Save file1
            tracker.setDirty(file1, '[Diff Review] file1.ts', false);

            assert.strictEqual(tracker.isDirty(file1), false);
            assert.strictEqual(tracker.isDirty(file2), true, 'file2 should still be dirty');
        });
    });

    suite('Message Flow Simulation', () => {
        /**
         * Simulates the complete message flow for dirty state
         */
        interface MockPanel {
            title: string;
        }

        class MockDiffReviewProvider {
            private activeWebviews: Map<string, MockPanel> = new Map();
            private dirtyStates: Map<string, boolean> = new Map();
            private originalTitles: Map<string, string> = new Map();

            createPanel(filePath: string, fileName: string): MockPanel {
                const panel: MockPanel = {
                    title: `[Diff Review] ${fileName}`
                };
                this.activeWebviews.set(filePath, panel);
                return panel;
            }

            handleContentModified(filePath: string, isDirty: boolean): void {
                const panel = this.activeWebviews.get(filePath);
                if (!panel) return;

                if (!this.originalTitles.has(filePath)) {
                    this.originalTitles.set(filePath, panel.title);
                }

                const originalTitle = this.originalTitles.get(filePath)!;
                this.dirtyStates.set(filePath, isDirty);

                if (isDirty) {
                    panel.title = `● ${originalTitle}`;
                } else {
                    panel.title = originalTitle;
                }
            }

            getPanel(filePath: string): MockPanel | undefined {
                return this.activeWebviews.get(filePath);
            }
        }

        test('should update tab title when receiving contentModified message', () => {
            const provider = new MockDiffReviewProvider();
            const filePath = '/repo/src/file.ts';
            const panel = provider.createPanel(filePath, 'file.ts');

            assert.strictEqual(panel.title, '[Diff Review] file.ts');

            // Simulate contentModified message with isDirty: true
            provider.handleContentModified(filePath, true);
            assert.strictEqual(panel.title, '● [Diff Review] file.ts');

            // Simulate contentModified message with isDirty: false (after save)
            provider.handleContentModified(filePath, false);
            assert.strictEqual(panel.title, '[Diff Review] file.ts');
        });

        test('should handle rapid dirty state changes', () => {
            const provider = new MockDiffReviewProvider();
            const filePath = '/repo/src/file.ts';
            const panel = provider.createPanel(filePath, 'file.ts');

            // Simulate rapid editing (multiple dirty notifications)
            provider.handleContentModified(filePath, true);
            provider.handleContentModified(filePath, true);
            provider.handleContentModified(filePath, true);

            assert.strictEqual(panel.title, '● [Diff Review] file.ts');

            // Save
            provider.handleContentModified(filePath, false);
            assert.strictEqual(panel.title, '[Diff Review] file.ts');
        });
    });
});

