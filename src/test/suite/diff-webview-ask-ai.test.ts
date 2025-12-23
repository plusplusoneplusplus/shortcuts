/**
 * Tests for diff webview Ask AI functionality
 * Tests context menu behavior, Ask AI request building, and custom instruction dialog
 */

import * as assert from 'assert';

// Types matching the webview implementation
interface SelectionState {
    side: 'old' | 'new' | 'both';
    startLine: number;
    endLine: number;
    startColumn: number;
    endColumn: number;
    selectedText: string;
}

type DiffAIInstructionType = 'clarify' | 'go-deeper' | 'custom';

interface AskAIContext {
    selectedText: string;
    startLine: number;
    endLine: number;
    side: 'old' | 'new' | 'both';
    surroundingLines: string;
    instructionType: DiffAIInstructionType;
    customInstruction?: string;
}

interface DiffCommentsSettings {
    showResolved: boolean;
    highlightColor: string;
    resolvedHighlightColor: string;
    askAIEnabled?: boolean;
}

suite('Diff Webview Ask AI Tests', () => {

    suite('Ask AI Context Building', () => {

        /**
         * Simulate extractSurroundingLines from panel-manager.ts
         */
        function extractSurroundingLines(
            content: string,
            startLine: number,
            endLine: number
        ): string {
            const lines = content.split('\n');
            const contextRadius = 5;
            const contextStartLine = Math.max(0, startLine - 1 - contextRadius);
            const contextEndLine = Math.min(lines.length, endLine + contextRadius);
            
            const surroundingLines: string[] = [];
            for (let i = contextStartLine; i < contextEndLine; i++) {
                // Skip the selected lines themselves
                if (i >= startLine - 1 && i < endLine) {
                    continue;
                }
                surroundingLines.push(lines[i]);
            }
            
            return surroundingLines.join('\n');
        }

        /**
         * Build Ask AI context from selection
         */
        function buildAskAIContext(
            selection: SelectionState,
            content: string,
            instructionType: DiffAIInstructionType,
            customInstruction?: string
        ): AskAIContext {
            const surroundingLines = extractSurroundingLines(
                content,
                selection.startLine,
                selection.endLine
            );
            
            return {
                selectedText: selection.selectedText,
                startLine: selection.startLine,
                endLine: selection.endLine,
                side: selection.side,
                surroundingLines,
                instructionType,
                customInstruction
            };
        }

        test('should build context for clarify instruction', () => {
            const selection: SelectionState = {
                side: 'new',
                startLine: 5,
                endLine: 5,
                startColumn: 1,
                endColumn: 20,
                selectedText: 'const x = 1;'
            };
            const content = 'line1\nline2\nline3\nline4\nconst x = 1;\nline6\nline7';

            const context = buildAskAIContext(selection, content, 'clarify');

            assert.strictEqual(context.selectedText, 'const x = 1;');
            assert.strictEqual(context.startLine, 5);
            assert.strictEqual(context.endLine, 5);
            assert.strictEqual(context.side, 'new');
            assert.strictEqual(context.instructionType, 'clarify');
            assert.strictEqual(context.customInstruction, undefined);
        });

        test('should build context for go-deeper instruction', () => {
            const selection: SelectionState = {
                side: 'old',
                startLine: 3,
                endLine: 5,
                startColumn: 1,
                endColumn: 10,
                selectedText: 'multi\nline\nselection'
            };
            const content = 'line1\nline2\nmulti\nline\nselection\nline6';

            const context = buildAskAIContext(selection, content, 'go-deeper');

            assert.strictEqual(context.instructionType, 'go-deeper');
            assert.strictEqual(context.side, 'old');
            assert.ok(context.surroundingLines.includes('line1'));
            assert.ok(context.surroundingLines.includes('line2'));
            assert.ok(context.surroundingLines.includes('line6'));
        });

        test('should build context for custom instruction', () => {
            const selection: SelectionState = {
                side: 'new',
                startLine: 2,
                endLine: 2,
                startColumn: 1,
                endColumn: 15,
                selectedText: 'security check'
            };
            const content = 'import auth\nsecurity check\nexport default';

            const context = buildAskAIContext(
                selection, 
                content, 
                'custom',
                'Explain the security implications of'
            );

            assert.strictEqual(context.instructionType, 'custom');
            assert.strictEqual(context.customInstruction, 'Explain the security implications of');
        });

        test('should extract surrounding lines correctly', () => {
            const content = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n');
            
            // Selection at line 10
            const surroundingLines = extractSurroundingLines(content, 10, 10);
            
            // Should include 5 lines before (5-9) and 5 lines after (11-15)
            assert.ok(surroundingLines.includes('line5'));
            assert.ok(surroundingLines.includes('line9'));
            assert.ok(surroundingLines.includes('line11'));
            assert.ok(surroundingLines.includes('line15'));
            // Should NOT include the selected line
            assert.ok(!surroundingLines.includes('line10'));
        });

        test('should handle selection at start of file', () => {
            const content = 'line1\nline2\nline3\nline4\nline5';
            
            const surroundingLines = extractSurroundingLines(content, 1, 1);
            
            // Should not include negative lines
            assert.ok(surroundingLines.includes('line2'));
            assert.ok(surroundingLines.includes('line3'));
            assert.ok(!surroundingLines.includes('line1')); // Selected line excluded
        });

        test('should handle selection at end of file', () => {
            const content = 'line1\nline2\nline3\nline4\nline5';
            
            const surroundingLines = extractSurroundingLines(content, 5, 5);
            
            // Should not exceed file bounds
            assert.ok(surroundingLines.includes('line1'));
            assert.ok(surroundingLines.includes('line4'));
            assert.ok(!surroundingLines.includes('line5')); // Selected line excluded
        });

        test('should handle multi-line selection', () => {
            const content = 'line1\nline2\nline3\nline4\nline5\nline6\nline7';
            
            // Selection spans lines 3-5
            const surroundingLines = extractSurroundingLines(content, 3, 5);
            
            // Should exclude selected lines 3, 4, 5
            assert.ok(surroundingLines.includes('line1'));
            assert.ok(surroundingLines.includes('line2'));
            assert.ok(surroundingLines.includes('line6'));
            assert.ok(surroundingLines.includes('line7'));
            assert.ok(!surroundingLines.includes('line3'));
            assert.ok(!surroundingLines.includes('line4'));
            assert.ok(!surroundingLines.includes('line5'));
        });
    });

    suite('Ask AI Context Menu Visibility', () => {

        /**
         * Simulate updateContextMenuForSettings from panel-manager.ts
         */
        function shouldShowAskAI(settings: DiffCommentsSettings): boolean {
            return settings.askAIEnabled === true;
        }

        test('should show Ask AI when enabled in settings', () => {
            const settings: DiffCommentsSettings = {
                showResolved: true,
                highlightColor: 'rgba(255, 235, 59, 0.3)',
                resolvedHighlightColor: 'rgba(76, 175, 80, 0.2)',
                askAIEnabled: true
            };

            assert.strictEqual(shouldShowAskAI(settings), true);
        });

        test('should hide Ask AI when disabled in settings', () => {
            const settings: DiffCommentsSettings = {
                showResolved: true,
                highlightColor: 'rgba(255, 235, 59, 0.3)',
                resolvedHighlightColor: 'rgba(76, 175, 80, 0.2)',
                askAIEnabled: false
            };

            assert.strictEqual(shouldShowAskAI(settings), false);
        });

        test('should hide Ask AI when setting is undefined', () => {
            const settings: DiffCommentsSettings = {
                showResolved: true,
                highlightColor: 'rgba(255, 235, 59, 0.3)',
                resolvedHighlightColor: 'rgba(76, 175, 80, 0.2)'
                // askAIEnabled is undefined
            };

            assert.strictEqual(shouldShowAskAI(settings), false);
        });
    });

    suite('Ask AI Submenu Positioning', () => {

        interface MenuRect {
            left: number;
            right: number;
            top: number;
            bottom: number;
        }

        /**
         * Simulate positionAskAISubmenu logic
         */
        function calculateSubmenuPosition(
            menuRect: MenuRect,
            submenuWidth: number,
            submenuHeight: number,
            windowWidth: number,
            windowHeight: number
        ): { left: string; right: string; top: string } {
            // Check horizontal space
            const spaceOnRight = windowWidth - menuRect.right;
            const spaceOnLeft = menuRect.left;
            
            let left = '100%';
            let right = 'auto';
            
            if (spaceOnRight < submenuWidth && spaceOnLeft > submenuWidth) {
                // Show on left side
                left = 'auto';
                right = '100%';
            }
            
            // Check vertical space
            const submenuBottomIfAlignedToTop = menuRect.top + submenuHeight;
            let top = '-1px';
            
            if (submenuBottomIfAlignedToTop > windowHeight) {
                const overflow = submenuBottomIfAlignedToTop - windowHeight;
                top = `${-overflow - 5}px`;
            }
            
            return { left, right, top };
        }

        test('should position submenu on right when space is available', () => {
            const menuRect: MenuRect = { left: 100, right: 250, top: 100, bottom: 200 };
            const submenuWidth = 180;
            const submenuHeight = 120;
            const windowWidth = 1000;
            const windowHeight = 800;

            const position = calculateSubmenuPosition(
                menuRect, submenuWidth, submenuHeight, windowWidth, windowHeight
            );

            assert.strictEqual(position.left, '100%');
            assert.strictEqual(position.right, 'auto');
        });

        test('should position submenu on left when right space is insufficient', () => {
            const menuRect: MenuRect = { left: 700, right: 850, top: 100, bottom: 200 };
            const submenuWidth = 180;
            const submenuHeight = 120;
            const windowWidth = 1000;
            const windowHeight = 800;

            const position = calculateSubmenuPosition(
                menuRect, submenuWidth, submenuHeight, windowWidth, windowHeight
            );

            // Space on right: 1000 - 850 = 150 < 180
            // Space on left: 700 > 180
            assert.strictEqual(position.left, 'auto');
            assert.strictEqual(position.right, '100%');
        });

        test('should adjust vertical position when submenu would go off bottom', () => {
            const menuRect: MenuRect = { left: 100, right: 250, top: 700, bottom: 800 };
            const submenuWidth = 180;
            const submenuHeight = 150;
            const windowWidth = 1000;
            const windowHeight = 800;

            const position = calculateSubmenuPosition(
                menuRect, submenuWidth, submenuHeight, windowWidth, windowHeight
            );

            // Submenu bottom: 700 + 150 = 850 > 800
            // Overflow: 850 - 800 = 50
            // Expected top: -50 - 5 = -55px
            assert.strictEqual(position.top, '-55px');
        });

        test('should use default vertical position when space is available', () => {
            const menuRect: MenuRect = { left: 100, right: 250, top: 100, bottom: 200 };
            const submenuWidth = 180;
            const submenuHeight = 120;
            const windowWidth = 1000;
            const windowHeight = 800;

            const position = calculateSubmenuPosition(
                menuRect, submenuWidth, submenuHeight, windowWidth, windowHeight
            );

            assert.strictEqual(position.top, '-1px');
        });
    });

    suite('Custom Instruction Dialog', () => {

        /**
         * Simulate custom instruction validation
         */
        function validateCustomInstruction(instruction: string | undefined): boolean {
            if (!instruction) return false;
            return instruction.trim().length > 0;
        }

        /**
         * Simulate text truncation for preview
         */
        function truncateForPreview(text: string, maxLength: number = 100): string {
            if (text.length <= maxLength) {
                return text;
            }
            return text.substring(0, maxLength) + '...';
        }

        test('should validate non-empty custom instruction', () => {
            assert.strictEqual(validateCustomInstruction('Explain this'), true);
            assert.strictEqual(validateCustomInstruction('What does this do?'), true);
        });

        test('should reject empty custom instruction', () => {
            assert.strictEqual(validateCustomInstruction(''), false);
            assert.strictEqual(validateCustomInstruction(undefined), false);
        });

        test('should reject whitespace-only custom instruction', () => {
            assert.strictEqual(validateCustomInstruction('   '), false);
            assert.strictEqual(validateCustomInstruction('\t\n'), false);
        });

        test('should truncate long text for preview', () => {
            const shortText = 'Short text';
            const longText = 'x'.repeat(150);

            assert.strictEqual(truncateForPreview(shortText), shortText);
            assert.strictEqual(truncateForPreview(longText).length, 103); // 100 + '...'
            assert.ok(truncateForPreview(longText).endsWith('...'));
        });

        test('should not truncate text at exactly max length', () => {
            const exactLengthText = 'x'.repeat(100);
            
            assert.strictEqual(truncateForPreview(exactLengthText), exactLengthText);
            assert.ok(!truncateForPreview(exactLengthText).endsWith('...'));
        });
    });

    suite('Ask AI Message Types', () => {

        interface WebviewMessage {
            type: string;
            context?: AskAIContext;
        }

        /**
         * Simulate sendAskAI message building
         */
        function buildAskAIMessage(context: AskAIContext): WebviewMessage {
            return {
                type: 'askAI',
                context
            };
        }

        test('should build correct message for clarify', () => {
            const context: AskAIContext = {
                selectedText: 'test code',
                startLine: 1,
                endLine: 1,
                side: 'new',
                surroundingLines: '',
                instructionType: 'clarify'
            };

            const message = buildAskAIMessage(context);

            assert.strictEqual(message.type, 'askAI');
            assert.strictEqual(message.context?.instructionType, 'clarify');
            assert.strictEqual(message.context?.selectedText, 'test code');
        });

        test('should build correct message for go-deeper', () => {
            const context: AskAIContext = {
                selectedText: 'complex algorithm',
                startLine: 10,
                endLine: 20,
                side: 'old',
                surroundingLines: 'surrounding context',
                instructionType: 'go-deeper'
            };

            const message = buildAskAIMessage(context);

            assert.strictEqual(message.type, 'askAI');
            assert.strictEqual(message.context?.instructionType, 'go-deeper');
            assert.strictEqual(message.context?.side, 'old');
        });

        test('should build correct message for custom instruction', () => {
            const context: AskAIContext = {
                selectedText: 'security check',
                startLine: 5,
                endLine: 5,
                side: 'new',
                surroundingLines: '',
                instructionType: 'custom',
                customInstruction: 'Explain the security implications'
            };

            const message = buildAskAIMessage(context);

            assert.strictEqual(message.type, 'askAI');
            assert.strictEqual(message.context?.instructionType, 'custom');
            assert.strictEqual(message.context?.customInstruction, 'Explain the security implications');
        });
    });

    suite('Instruction Type Labels', () => {

        /**
         * Get label for instruction type (used in comment display)
         */
        function getInstructionLabel(instructionType: DiffAIInstructionType): string {
            const labelMap: Record<DiffAIInstructionType, string> = {
                'clarify': '🤖 **AI Clarification:**',
                'go-deeper': '🔍 **AI Deep Analysis:**',
                'custom': '🤖 **AI Response:**'
            };
            return labelMap[instructionType] || '🤖 **AI Clarification:**';
        }

        test('should return correct label for clarify', () => {
            const label = getInstructionLabel('clarify');
            assert.ok(label.includes('AI Clarification'));
            assert.ok(label.includes('🤖'));
        });

        test('should return correct label for go-deeper', () => {
            const label = getInstructionLabel('go-deeper');
            assert.ok(label.includes('AI Deep Analysis'));
            assert.ok(label.includes('🔍'));
        });

        test('should return correct label for custom', () => {
            const label = getInstructionLabel('custom');
            assert.ok(label.includes('AI Response'));
            assert.ok(label.includes('🤖'));
        });
    });
});

