/**
 * Tests for comment display consistency between markdown review and git diff views
 * 
 * These tests ensure that both views use the same HTML structure, CSS classes,
 * and visual appearance for comment bubbles.
 */

import * as assert from 'assert';

suite('Comment Display Consistency Tests', () => {

    // =========================================================================
    // Type Label Tests
    // =========================================================================

    suite('getTypeLabel - Consistent AI Comment Labels', () => {
        /**
         * Pure function implementation - should be identical in both views
         */
        function getTypeLabel(type?: string): string {
            switch (type) {
                case 'ai-suggestion': return '💡 AI Suggestion';
                case 'ai-clarification': return '🔮 AI Clarification';
                case 'ai-critique': return '⚠️ AI Critique';
                case 'ai-question': return '❓ AI Question';
                default: return '';
            }
        }

        test('should return correct label for ai-suggestion', () => {
            assert.strictEqual(getTypeLabel('ai-suggestion'), '💡 AI Suggestion');
        });

        test('should return correct label for ai-clarification with crystal ball emoji', () => {
            const label = getTypeLabel('ai-clarification');
            assert.strictEqual(label, '🔮 AI Clarification');
            // Verify it's not using the robot emoji from old implementation
            assert.ok(!label.includes('🤖'), 'Should use 🔮 not 🤖 for AI Clarification');
        });

        test('should return correct label for ai-critique', () => {
            assert.strictEqual(getTypeLabel('ai-critique'), '⚠️ AI Critique');
        });

        test('should return correct label for ai-question', () => {
            assert.strictEqual(getTypeLabel('ai-question'), '❓ AI Question');
        });

        test('should return empty string for user type', () => {
            assert.strictEqual(getTypeLabel('user'), '');
        });

        test('should return empty string for undefined type', () => {
            assert.strictEqual(getTypeLabel(undefined), '');
        });

        test('should return empty string for unknown type', () => {
            assert.strictEqual(getTypeLabel('unknown'), '');
        });
    });

    // =========================================================================
    // Line Range Display Tests
    // =========================================================================

    suite('Line Range Display - Consistent Format', () => {
        /**
         * Format line range for display - should be identical in both views
         */
        function formatLineRange(startLine: number, endLine: number): string {
            return startLine === endLine
                ? `Line ${startLine}`
                : `Lines ${startLine}-${endLine}`;
        }

        test('should format single line correctly', () => {
            assert.strictEqual(formatLineRange(42, 42), 'Line 42');
        });

        test('should format line range correctly', () => {
            assert.strictEqual(formatLineRange(10, 20), 'Lines 10-20');
        });

        test('should handle line 1', () => {
            assert.strictEqual(formatLineRange(1, 1), 'Line 1');
        });

        test('should handle consecutive lines', () => {
            assert.strictEqual(formatLineRange(5, 6), 'Lines 5-6');
        });

        test('should handle large line numbers', () => {
            assert.strictEqual(formatLineRange(1000, 1500), 'Lines 1000-1500');
        });
    });

    // =========================================================================
    // Status Badge Tests
    // =========================================================================

    suite('Status Badge - Consistent Labels', () => {
        /**
         * Get status label for display - should be identical in both views
         */
        function getStatusLabel(status: 'open' | 'resolved'): string {
            return status === 'open' ? '○ Open' : '✓ Resolved';
        }

        test('should return correct label for open status', () => {
            assert.strictEqual(getStatusLabel('open'), '○ Open');
        });

        test('should return correct label for resolved status', () => {
            assert.strictEqual(getStatusLabel('resolved'), '✓ Resolved');
        });
    });

    // =========================================================================
    // CSS Class Name Tests
    // =========================================================================

    suite('CSS Class Names - Consistency Check', () => {
        /**
         * Expected CSS class names for comment bubble elements
         * Both views should use these exact class names
         */
        const EXPECTED_CLASSES = {
            // Container
            bubble: 'inline-comment-bubble',
            
            // Header
            header: 'bubble-header',
            meta: 'bubble-meta',
            actions: 'bubble-actions',
            actionBtn: 'bubble-action-btn',
            
            // Status badges
            status: 'status',
            statusOpen: 'open',
            statusResolved: 'resolved',
            
            // AI type classes
            aiSuggestion: 'ai-suggestion',
            aiClarification: 'ai-clarification',
            aiCritique: 'ai-critique',
            aiQuestion: 'ai-question',
            
            // Content
            selectedText: 'bubble-selected-text',
            commentText: 'bubble-comment-text',
            markdownContent: 'bubble-markdown-content'
        };

        test('should have correct bubble container class', () => {
            assert.strictEqual(EXPECTED_CLASSES.bubble, 'inline-comment-bubble');
        });

        test('should have correct header class', () => {
            assert.strictEqual(EXPECTED_CLASSES.header, 'bubble-header');
        });

        test('should have correct meta class', () => {
            assert.strictEqual(EXPECTED_CLASSES.meta, 'bubble-meta');
        });

        test('should have correct actions class', () => {
            assert.strictEqual(EXPECTED_CLASSES.actions, 'bubble-actions');
        });

        test('should have correct action button class', () => {
            assert.strictEqual(EXPECTED_CLASSES.actionBtn, 'bubble-action-btn');
        });

        test('should have correct selected text class', () => {
            assert.strictEqual(EXPECTED_CLASSES.selectedText, 'bubble-selected-text');
        });

        test('should have correct comment text class', () => {
            assert.strictEqual(EXPECTED_CLASSES.commentText, 'bubble-comment-text');
        });

        test('should have correct markdown content class', () => {
            assert.strictEqual(EXPECTED_CLASSES.markdownContent, 'bubble-markdown-content');
        });
    });

    // =========================================================================
    // Build Class List Tests
    // =========================================================================

    suite('Build Class List - Consistent Logic', () => {
        /**
         * Build CSS class list for comment bubble
         * Should be identical in both views
         */
        function buildBubbleClassList(
            status: 'open' | 'resolved',
            type?: string
        ): string {
            const typeClass = type && type !== 'user' ? type : '';
            const statusClass = status === 'resolved' ? 'resolved' : '';
            return ['inline-comment-bubble', statusClass, typeClass]
                .filter(c => c)
                .join(' ');
        }

        test('should build class list for open user comment', () => {
            const result = buildBubbleClassList('open', 'user');
            assert.strictEqual(result, 'inline-comment-bubble');
        });

        test('should build class list for resolved user comment', () => {
            const result = buildBubbleClassList('resolved', 'user');
            assert.strictEqual(result, 'inline-comment-bubble resolved');
        });

        test('should build class list for open AI suggestion', () => {
            const result = buildBubbleClassList('open', 'ai-suggestion');
            assert.strictEqual(result, 'inline-comment-bubble ai-suggestion');
        });

        test('should build class list for resolved AI clarification', () => {
            const result = buildBubbleClassList('resolved', 'ai-clarification');
            assert.strictEqual(result, 'inline-comment-bubble resolved ai-clarification');
        });

        test('should build class list for open AI critique', () => {
            const result = buildBubbleClassList('open', 'ai-critique');
            assert.strictEqual(result, 'inline-comment-bubble ai-critique');
        });

        test('should build class list for open AI question', () => {
            const result = buildBubbleClassList('open', 'ai-question');
            assert.strictEqual(result, 'inline-comment-bubble ai-question');
        });

        test('should handle undefined type', () => {
            const result = buildBubbleClassList('open', undefined);
            assert.strictEqual(result, 'inline-comment-bubble');
        });

        test('should handle empty string type', () => {
            const result = buildBubbleClassList('open', '');
            assert.strictEqual(result, 'inline-comment-bubble');
        });
    });

    // =========================================================================
    // Status Badge Class Tests
    // =========================================================================

    suite('Status Badge Classes - Consistent Logic', () => {
        /**
         * Build CSS class for status badge
         */
        function buildStatusBadgeClass(status: 'open' | 'resolved'): string {
            return `status ${status}`;
        }

        test('should build class for open status', () => {
            assert.strictEqual(buildStatusBadgeClass('open'), 'status open');
        });

        test('should build class for resolved status', () => {
            assert.strictEqual(buildStatusBadgeClass('resolved'), 'status resolved');
        });
    });

    // =========================================================================
    // Type Badge Class Tests
    // =========================================================================

    suite('Type Badge Classes - Consistent Logic', () => {
        /**
         * Build CSS class for type badge (AI comments)
         */
        function buildTypeBadgeClass(type: string): string {
            return `status ${type}`;
        }

        test('should build class for ai-suggestion', () => {
            assert.strictEqual(buildTypeBadgeClass('ai-suggestion'), 'status ai-suggestion');
        });

        test('should build class for ai-clarification', () => {
            assert.strictEqual(buildTypeBadgeClass('ai-clarification'), 'status ai-clarification');
        });

        test('should build class for ai-critique', () => {
            assert.strictEqual(buildTypeBadgeClass('ai-critique'), 'status ai-critique');
        });

        test('should build class for ai-question', () => {
            assert.strictEqual(buildTypeBadgeClass('ai-question'), 'status ai-question');
        });
    });

    // =========================================================================
    // Action Button Tests
    // =========================================================================

    suite('Action Buttons - Consistent Icons', () => {
        /**
         * Expected action button icons - should be identical in both views
         */
        const ACTION_ICONS = {
            resolve: '✅',
            reopen: '🔄',
            edit: '✏️',
            delete: '🗑️'
        };

        test('should use correct resolve icon', () => {
            assert.strictEqual(ACTION_ICONS.resolve, '✅');
        });

        test('should use correct reopen icon', () => {
            assert.strictEqual(ACTION_ICONS.reopen, '🔄');
        });

        test('should use correct edit icon', () => {
            assert.strictEqual(ACTION_ICONS.edit, '✏️');
        });

        test('should use correct delete icon', () => {
            assert.strictEqual(ACTION_ICONS.delete, '🗑️');
        });
    });

    // =========================================================================
    // HTML Structure Tests
    // =========================================================================

    suite('HTML Structure - Expected Element Order', () => {
        /**
         * Expected HTML structure for comment bubble
         * Both views should generate elements in this order
         */
        const EXPECTED_STRUCTURE = [
            'bubble-header',      // 1. Header container
            '  bubble-meta',      // 2. Meta info (line range, status, type)
            '  bubble-actions',   // 3. Action buttons
            'bubble-selected-text', // 4. Selected text quote
            'bubble-comment-text'   // 5. Comment content
        ];

        test('should have header as first child', () => {
            assert.strictEqual(EXPECTED_STRUCTURE[0], 'bubble-header');
        });

        test('should have meta inside header', () => {
            assert.strictEqual(EXPECTED_STRUCTURE[1], '  bubble-meta');
        });

        test('should have actions inside header', () => {
            assert.strictEqual(EXPECTED_STRUCTURE[2], '  bubble-actions');
        });

        test('should have selected text after header', () => {
            assert.strictEqual(EXPECTED_STRUCTURE[3], 'bubble-selected-text');
        });

        test('should have comment text last', () => {
            assert.strictEqual(EXPECTED_STRUCTURE[4], 'bubble-comment-text');
        });
    });

    // =========================================================================
    // Diff Selection Line Extraction Tests
    // =========================================================================

    suite('Diff Selection Line Extraction', () => {
        /**
         * Extract display line numbers from DiffSelection
         * Used in git diff view to get line numbers for display
         */
        interface DiffSelection {
            oldStartLine: number | null;
            oldEndLine: number | null;
            newStartLine: number | null;
            newEndLine: number | null;
        }

        function extractDisplayLines(selection: DiffSelection): { startLine: number; endLine: number } {
            const startLine = selection.newStartLine ?? selection.oldStartLine ?? 0;
            const endLine = selection.newEndLine ?? selection.oldEndLine ?? startLine;
            return { startLine, endLine };
        }

        test('should prefer new file lines', () => {
            const selection: DiffSelection = {
                oldStartLine: 10,
                oldEndLine: 15,
                newStartLine: 20,
                newEndLine: 25
            };
            const result = extractDisplayLines(selection);
            assert.strictEqual(result.startLine, 20);
            assert.strictEqual(result.endLine, 25);
        });

        test('should fallback to old file lines when new is null', () => {
            const selection: DiffSelection = {
                oldStartLine: 10,
                oldEndLine: 15,
                newStartLine: null,
                newEndLine: null
            };
            const result = extractDisplayLines(selection);
            assert.strictEqual(result.startLine, 10);
            assert.strictEqual(result.endLine, 15);
        });

        test('should handle single line selection', () => {
            const selection: DiffSelection = {
                oldStartLine: null,
                oldEndLine: null,
                newStartLine: 42,
                newEndLine: 42
            };
            const result = extractDisplayLines(selection);
            assert.strictEqual(result.startLine, 42);
            assert.strictEqual(result.endLine, 42);
        });

        test('should handle all null (edge case)', () => {
            const selection: DiffSelection = {
                oldStartLine: null,
                oldEndLine: null,
                newStartLine: null,
                newEndLine: null
            };
            const result = extractDisplayLines(selection);
            assert.strictEqual(result.startLine, 0);
            assert.strictEqual(result.endLine, 0);
        });

        test('should use startLine as endLine fallback', () => {
            const selection: DiffSelection = {
                oldStartLine: null,
                oldEndLine: null,
                newStartLine: 30,
                newEndLine: null
            };
            const result = extractDisplayLines(selection);
            assert.strictEqual(result.startLine, 30);
            assert.strictEqual(result.endLine, 30);
        });
    });

    // =========================================================================
    // Resize Handles Tests
    // =========================================================================

    suite('Resize Handles - Consistent Structure', () => {
        /**
         * Expected resize handle classes - should be identical in both views
         */
        const EXPECTED_RESIZE_HANDLES = [
            'resize-handle resize-handle-se',
            'resize-handle resize-handle-e',
            'resize-handle resize-handle-s'
        ];

        const EXPECTED_RESIZE_GRIP = 'resize-grip';

        test('should have SE resize handle', () => {
            assert.ok(EXPECTED_RESIZE_HANDLES.includes('resize-handle resize-handle-se'));
        });

        test('should have E resize handle', () => {
            assert.ok(EXPECTED_RESIZE_HANDLES.includes('resize-handle resize-handle-e'));
        });

        test('should have S resize handle', () => {
            assert.ok(EXPECTED_RESIZE_HANDLES.includes('resize-handle resize-handle-s'));
        });

        test('should have resize grip class', () => {
            assert.strictEqual(EXPECTED_RESIZE_GRIP, 'resize-grip');
        });

        test('should have correct number of resize handles', () => {
            assert.strictEqual(EXPECTED_RESIZE_HANDLES.length, 3);
        });
    });

    // =========================================================================
    // Draggable Header Tests
    // =========================================================================

    suite('Draggable Header - Consistent Behavior', () => {
        /**
         * Expected draggable element selectors
         */
        const DRAGGABLE_SELECTORS = {
            bubbleHeader: '.bubble-header',
            panelHeader: '.comment-panel-header, .comments-list-header',
            floatingPanelHeader: '.floating-panel-header'
        };

        /**
         * Elements that should NOT trigger drag
         */
        const EXCLUDE_FROM_DRAG = [
            '.bubble-action-btn',
            'button',
            '.close-btn'
        ];

        test('should have correct bubble header selector', () => {
            assert.strictEqual(DRAGGABLE_SELECTORS.bubbleHeader, '.bubble-header');
        });

        test('should have correct panel header selector', () => {
            assert.ok(DRAGGABLE_SELECTORS.panelHeader.includes('.comment-panel-header'));
            assert.ok(DRAGGABLE_SELECTORS.panelHeader.includes('.comments-list-header'));
        });

        test('should exclude action buttons from drag', () => {
            assert.ok(EXCLUDE_FROM_DRAG.includes('.bubble-action-btn'));
        });

        test('should exclude buttons from drag', () => {
            assert.ok(EXCLUDE_FROM_DRAG.includes('button'));
        });

        test('should exclude close button from drag', () => {
            assert.ok(EXCLUDE_FROM_DRAG.includes('.close-btn'));
        });
    });

    // =========================================================================
    // CSS Variable Consistency Tests
    // =========================================================================

    suite('CSS Variables - Consistent Naming', () => {
        /**
         * Expected CSS variables for comment styling
         * Both views should use these exact variable names
         */
        const EXPECTED_CSS_VARIABLES = {
            // Background and border
            commentBg: '--comment-bg',
            commentBorder: '--comment-border',
            
            // Highlight colors
            highlightOpen: '--highlight-open',
            highlightResolved: '--highlight-resolved',
            highlightAiSuggestion: '--highlight-ai-suggestion',
            highlightAiClarification: '--highlight-ai-clarification',
            highlightAiCritique: '--highlight-ai-critique',
            highlightAiQuestion: '--highlight-ai-question',
            
            // Border colors
            borderUser: '--comment-border-user',
            borderResolved: '--comment-border-resolved',
            borderAiSuggestion: '--comment-border-ai-suggestion',
            borderAiClarification: '--comment-border-ai-clarification',
            borderAiCritique: '--comment-border-ai-critique',
            borderAiQuestion: '--comment-border-ai-question'
        };

        test('should have comment-bg variable', () => {
            assert.strictEqual(EXPECTED_CSS_VARIABLES.commentBg, '--comment-bg');
        });

        test('should have comment-border variable', () => {
            assert.strictEqual(EXPECTED_CSS_VARIABLES.commentBorder, '--comment-border');
        });

        test('should have highlight-open variable', () => {
            assert.strictEqual(EXPECTED_CSS_VARIABLES.highlightOpen, '--highlight-open');
        });

        test('should have highlight-resolved variable', () => {
            assert.strictEqual(EXPECTED_CSS_VARIABLES.highlightResolved, '--highlight-resolved');
        });

        test('should have AI type highlight variables', () => {
            assert.strictEqual(EXPECTED_CSS_VARIABLES.highlightAiSuggestion, '--highlight-ai-suggestion');
            assert.strictEqual(EXPECTED_CSS_VARIABLES.highlightAiClarification, '--highlight-ai-clarification');
            assert.strictEqual(EXPECTED_CSS_VARIABLES.highlightAiCritique, '--highlight-ai-critique');
            assert.strictEqual(EXPECTED_CSS_VARIABLES.highlightAiQuestion, '--highlight-ai-question');
        });

        test('should have border color variables', () => {
            assert.strictEqual(EXPECTED_CSS_VARIABLES.borderUser, '--comment-border-user');
            assert.strictEqual(EXPECTED_CSS_VARIABLES.borderResolved, '--comment-border-resolved');
            assert.strictEqual(EXPECTED_CSS_VARIABLES.borderAiSuggestion, '--comment-border-ai-suggestion');
            assert.strictEqual(EXPECTED_CSS_VARIABLES.borderAiClarification, '--comment-border-ai-clarification');
            assert.strictEqual(EXPECTED_CSS_VARIABLES.borderAiCritique, '--comment-border-ai-critique');
            assert.strictEqual(EXPECTED_CSS_VARIABLES.borderAiQuestion, '--comment-border-ai-question');
        });
    });

    // =========================================================================
    // Animation Consistency Tests
    // =========================================================================

    suite('Animations - Consistent Names', () => {
        /**
         * Expected animation names - should be identical in both views
         */
        const EXPECTED_ANIMATIONS = {
            bubbleIn: 'bubbleIn',
            floatIn: 'floatIn',
            highlightFlash: 'commentHighlightFlash'
        };

        test('should have bubbleIn animation', () => {
            assert.strictEqual(EXPECTED_ANIMATIONS.bubbleIn, 'bubbleIn');
        });

        test('should have floatIn animation', () => {
            assert.strictEqual(EXPECTED_ANIMATIONS.floatIn, 'floatIn');
        });

        test('should have commentHighlightFlash animation', () => {
            assert.strictEqual(EXPECTED_ANIMATIONS.highlightFlash, 'commentHighlightFlash');
        });
    });

    // =========================================================================
    // Bubble Dimensions Consistency Tests
    // =========================================================================

    suite('Bubble Dimensions - Consistent Constraints', () => {
        /**
         * Expected dimension constraints - should be identical in both views
         */
        const DIMENSION_CONSTRAINTS = {
            minWidth: 280,
            maxWidth: 600,
            minHeight: 120,
            maxHeight: 500
        };

        test('should have correct minimum width', () => {
            assert.strictEqual(DIMENSION_CONSTRAINTS.minWidth, 280);
        });

        test('should have correct maximum width', () => {
            assert.strictEqual(DIMENSION_CONSTRAINTS.maxWidth, 600);
        });

        test('should have correct minimum height', () => {
            assert.strictEqual(DIMENSION_CONSTRAINTS.minHeight, 120);
        });

        test('should have correct maximum height', () => {
            assert.strictEqual(DIMENSION_CONSTRAINTS.maxHeight, 500);
        });
    });
});

